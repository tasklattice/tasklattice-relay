import { createHash } from "node:crypto";
import { getWorkerConfig } from "../config/worker-config";
import { projectArgoAnnotations } from "./project-resource-ownership";
import { reconcileProjectImagePuller } from "./project-image-puller";
import {
  CoreV1Api,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  type V1Namespace,
} from "@kubernetes/client-node";
const FIELD_MANAGER = "tali-control-project-runtime";

export interface ProjectNamespaceInput {
  namespace: string;
  projectId: string;
  projectName: string;
}

export interface ProjectNamespaceClient {
  reconcile(input: ProjectNamespaceInput): Promise<void>;
  deleteAndWait(
    namespace: string,
    projectId: string,
    timeoutMs: number,
  ): Promise<void>;
}

type NamespaceCoreApi = Pick<
  CoreV1Api,
  "createNamespace" | "deleteNamespace" | "readNamespace"
>;

type NamespaceObjectApi = Pick<KubernetesObjectApi, "patch" | "read">;

interface KubernetesErrorLike {
  body?: unknown;
  code?: unknown;
  statusCode?: unknown;
}

export function projectNameLabel(projectName: string): string {
  const normalized = projectName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 63)
    .replace(/[-_.]+$/g, "");
  if (normalized) return normalized;
  return `project-${createHash("sha256")
    .update(projectName)
    .digest("hex")
    .slice(0, 12)}`;
}

function managedLabels(projectName: string): Record<string, string> {
  return {
    "app.kubernetes.io/managed-by": "tali",
    "app.kubernetes.io/part-of": "tali",
    "tali.io/project-name": projectNameLabel(projectName),
    "tali.io/runtime-target": "true",
  };
}

export function projectNamespaceResource(
  input: ProjectNamespaceInput,
): V1Namespace {
  const { controlRelease, controlNamespace } = getWorkerConfig().resource_ownership;
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: input.namespace,
      labels: managedLabels(input.projectName),
      annotations: {
        ...projectArgoAnnotations(input.namespace),
        ...(controlRelease && controlNamespace ? {
          "tali.io/control-release": controlRelease,
          "tali.io/control-namespace": controlNamespace,
        } : {}),
        "tali.io/project-id": input.projectId,
        "tali.io/project-name": input.projectName,
      },
    },
  };
}

function kubernetesStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as KubernetesErrorLike;
  for (const value of [candidate.code, candidate.statusCode]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function kubernetesErrorDetail(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const body = (error as KubernetesErrorLike).body;
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return error instanceof Error ? error.message : "Unknown Kubernetes API error.";
}

function reconciliationError(action: string, error: unknown): Error {
  const status = kubernetesStatusCode(error);
  return new Error(
    `Project Runtime Namespace ${action} failed${status ? ` (${status})` : ""}: ${kubernetesErrorDetail(error)}`,
    { cause: error },
  );
}

class DisabledProjectNamespaceClient implements ProjectNamespaceClient {
  async reconcile(): Promise<void> {}
  async deleteAndWait(): Promise<void> {}
}

class UnavailableProjectNamespaceClient implements ProjectNamespaceClient {
  private unavailable(): never {
    throw new Error(
      "Project Runtime Namespaces are enabled, but the Kubernetes in-cluster API is unavailable.",
    );
  }
  async reconcile(): Promise<void> {
    this.unavailable();
  }
  async deleteAndWait(): Promise<void> {
    this.unavailable();
  }
}

export class KubernetesProjectNamespaceClient
  implements ProjectNamespaceClient
{
  private readonly core: NamespaceCoreApi;
  private readonly objects: NamespaceObjectApi;

  constructor(core?: NamespaceCoreApi, objects?: NamespaceObjectApi) {
    if (core || objects) {
      if (!core || !objects) {
        throw new Error(
          "Both Kubernetes CoreV1Api and KubernetesObjectApi clients are required.",
        );
      }
      this.core = core;
      this.objects = objects;
      return;
    }

    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromCluster();
    this.core = kubeConfig.makeApiClient(CoreV1Api);
    this.objects = KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  async reconcile(input: ProjectNamespaceInput): Promise<void> {
    const desired = projectNamespaceResource(input);
    let existing = await this.readNamespace(input.namespace);
    if (!existing) {
      let created: V1Namespace | undefined;
      try {
        created = await this.core.createNamespace({ body: desired });
      } catch (error) {
        if (kubernetesStatusCode(error) !== 409) {
          throw reconciliationError("creation", error);
        }
      }
      if (created) {
        await reconcileProjectImagePuller(this.objects, created, input.projectId);
        return;
      }

      // Another actor created the same name after our read. Never adopt it
      // until its Relay owner annotation has been checked.
      existing = await this.readNamespace(input.namespace);
      if (!existing) {
        throw new Error(
          `Project Runtime Namespace ${input.namespace} reported a create conflict but could not be read.`,
        );
      }
    }

    this.assertNamespaceOwnership(existing, input.namespace, input.projectId);
    try {
      await this.objects.patch(
        desired,
        undefined,
        undefined,
        FIELD_MANAGER,
        false,
        PatchStrategy.ServerSideApply,
      );
    } catch (error) {
      throw reconciliationError("server-side apply", error);
    }
    // Initialization calls this before any Gateway hooks or runtime Pods.
    await reconcileProjectImagePuller(this.objects, existing, input.projectId);
  }

  async deleteAndWait(
    namespace: string,
    projectId: string,
    timeoutMs: number,
  ): Promise<void> {
    const existing = await this.readOwnedNamespace(namespace, projectId);
    if (!existing) return;
    try {
      await this.core.deleteNamespace({
        name: namespace,
        body: {
          apiVersion: "v1",
          kind: "DeleteOptions",
          ...(existing.metadata?.uid
            ? { preconditions: { uid: existing.metadata.uid } }
            : {}),
        },
      });
    } catch (error) {
      if (kubernetesStatusCode(error) !== 404) {
        throw reconciliationError("deletion", error);
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (await this.readOwnedNamespace(namespace, projectId)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Project Runtime Namespace ${namespace} is still terminating after ${timeoutMs}ms.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  private async readNamespace(
    namespace: string,
  ): Promise<V1Namespace | undefined> {
    try {
      return await this.core.readNamespace({ name: namespace });
    } catch (error) {
      if (kubernetesStatusCode(error) === 404) return undefined;
      throw reconciliationError("read", error);
    }
  }

  private async readOwnedNamespace(
    namespace: string,
    projectId: string,
  ): Promise<V1Namespace | undefined> {
    const existing = await this.readNamespace(namespace);
    if (!existing) return undefined;
    this.assertNamespaceOwnership(existing, namespace, projectId);
    return existing;
  }

  private assertNamespaceOwnership(
    existing: V1Namespace,
    namespace: string,
    projectId: string,
  ): void {
    const owner = existing.metadata?.annotations?.["tali.io/project-id"];
    if (owner !== projectId) {
      throw new Error(
        `Refusing to manage Kubernetes Namespace ${namespace}: expected Project ${projectId}, found ${owner ? `Project ${owner}` : "no tali.io/project-id owner"}.`,
      );
    }
  }
}

export function createProjectNamespaceClient(
  config: { enabled: boolean },
): ProjectNamespaceClient {
  if (!config.enabled) return new DisabledProjectNamespaceClient();
  if (!process.env.KUBERNETES_SERVICE_HOST) {
    return new UnavailableProjectNamespaceClient();
  }
  return new KubernetesProjectNamespaceClient();
}
