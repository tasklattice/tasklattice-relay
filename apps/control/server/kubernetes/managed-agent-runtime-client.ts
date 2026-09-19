import { createHash } from "node:crypto";
import { kubernetesResourceName } from "@tali/contracts/resource-identity";
import { readProjectNamespaceOwner, withNamespaceOwner } from "./project-resource-ownership";
import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  type V1Deployment,
  type V1Pod,
  type V1Service,
} from "@kubernetes/client-node";
import type { OnboardContainerImageAgentInput } from "@tali/contracts";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";

const FIELD_MANAGER = "tali-control-managed-agent";
const DEFAULT_ONBOARD_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MANAGED_AGENT_TEMPLATE_VERSION = "2";

type ManagedAgentAppsApi = Pick<
  AppsV1Api,
  "deleteNamespacedDeployment" | "readNamespacedDeployment"
>;

type ManagedAgentCoreApi = Pick<
  CoreV1Api,
  "deleteNamespacedService" | "listNamespacedPod" | "readNamespacedService"
>;

type ManagedAgentObjectApi = Pick<KubernetesObjectApi, "patch">;

interface KubernetesErrorLike {
  body?: unknown;
  code?: unknown;
  statusCode?: unknown;
}

export interface ManagedAgentRuntimeInput
  extends OnboardContainerImageAgentInput {
  agentId: string;
  instanceId: string;
  namespace: string;
  projectId: string;
}

export interface ManagedAgentRuntimeResult {
  agentCardUrl: string;
  deploymentName: string;
  endpoint: string;
  imageDigest: string;
  imageReference: string;
  namespace: string;
  podName: string;
  serviceName: string;
}

export interface ManagedAgentRuntimeClient {
  onboard(input: ManagedAgentRuntimeInput): Promise<ManagedAgentRuntimeResult>;
  remove(input: {
    agentId: string;
    instanceId: string;
    namespace: string;
    projectId: string;
  }): Promise<void>;
}

type ManagedAgentOwnership = Pick<
  ManagedAgentRuntimeInput,
  "agentId" | "instanceId" | "namespace" | "projectId"
>;

export function managedAgentResourceName(instanceId: string): string {
  return kubernetesResourceName("instance", instanceId);
}

function managedAgentKey(agentId: string): string {
  return createHash("sha256").update(agentId).digest("hex").slice(0, 24);
}

function managedInstanceKey(instanceId: string): string {
  return createHash("sha256").update(instanceId).digest("hex").slice(0, 24);
}

function managedProjectKey(projectId: string): string {
  return createHash("sha256").update(projectId).digest("hex").slice(0, 24);
}

export function managedAgentRevisionKey(
  input: ManagedAgentRuntimeInput,
  image: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      MANAGED_AGENT_TEMPLATE_VERSION,
      input.agentId,
      input.instanceId,
      input.projectId,
      input.name,
      input.description,
      input.category,
      input.owner,
      input.containerPort,
      input.agentCardPath,
      input.image,
      input.imagePullSecretName,
      input.command,
      input.args,
      image,
    ]))
    .digest("hex")
    .slice(0, 24);
}

export function kubernetesMetadataLabel(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const readable = normalized.slice(0, 48).replace(/[^a-z0-9]+$/g, "") || "agent";
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${readable}-${suffix}`.slice(0, 63).replace(/[^a-z0-9]+$/g, "");
}

function managedLabels(input: ManagedAgentRuntimeInput): Record<string, string> {
  return {
    "app.kubernetes.io/component": "a2a-agent",
    "app.kubernetes.io/instance": managedAgentResourceName(input.instanceId),
    "app.kubernetes.io/managed-by": "tali",
    "app.kubernetes.io/name": "tali-managed-agent",
    "app.kubernetes.io/part-of": "tali",
    "tali.io/agent-name": kubernetesMetadataLabel(input.name),
    "tali.io/agent-key": managedAgentKey(input.agentId),
    "tali.io/instance-key": managedInstanceKey(input.instanceId),
    "tali.io/project-key": managedProjectKey(input.projectId),
    "tali.io/runtime-kind": "managed-a2a",
  };
}

function managedAnnotations(
  input: Pick<
    ManagedAgentRuntimeInput,
    | "agentId"
    | "category"
    | "image"
    | "instanceId"
    | "name"
    | "owner"
    | "projectId"
  >,
): Record<string, string> {
  return {
    "tali.io/agent-id": input.agentId,
    "tali.io/agent-name": input.name,
    "tali.io/agent-category": input.category,
    "tali.io/agent-owner": input.owner,
    "tali.io/instance-id": input.instanceId,
    "tali.io/project-id": input.projectId,
    "tali.io/source-image": input.image,
  };
}

export function managedAgentEndpoint(
  namespace: string,
  serviceName: string,
  port: number,
): string {
  return `http://${serviceName}.${namespace}.svc.cluster.local:${port}`;
}

function deploymentResource(
  input: ManagedAgentRuntimeInput,
  image: string,
): V1Deployment {
  const name = managedAgentResourceName(input.instanceId);
  const labels = managedLabels(input);
  const endpoint = managedAgentEndpoint(
    input.namespace,
    name,
    input.containerPort,
  );
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace: input.namespace,
      annotations: managedAnnotations(input),
      labels,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "tali.io/instance-key": labels["tali.io/instance-key"]!,
        },
      },
      template: {
        metadata: {
          annotations: managedAnnotations(input),
          labels: {
            ...labels,
            "tali.io/revision-key": managedAgentRevisionKey(input, image),
          },
        },
        spec: {
          automountServiceAccountToken: false,
          ...(input.imagePullSecretName
            ? { imagePullSecrets: [{ name: input.imagePullSecretName }] }
            : {}),
          securityContext: {
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "agent",
              image,
              imagePullPolicy: managedImagePullPolicy(image),
              ...(input.command.length ? { command: input.command } : {}),
              ...(input.args.length ? { args: input.args } : {}),
              env: [
                { name: "PORT", value: String(input.containerPort) },
                { name: "TALI_PROJECT_ID", value: input.projectId },
                { name: "TALI_AGENT_ID", value: input.agentId },
                { name: "TALI_INSTANCE_ID", value: input.instanceId },
                { name: "TALI_A2A_BASE_URL", value: endpoint },
              ],
              ports: [
                {
                  name: "http",
                  containerPort: input.containerPort,
                  protocol: "TCP",
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: input.agentCardPath,
                  port: "http",
                  scheme: "HTTP",
                },
                initialDelaySeconds: 1,
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 30,
              },
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
            },
          ],
        },
      },
    },
  };
}

function serviceResource(input: ManagedAgentRuntimeInput): V1Service {
  const name = managedAgentResourceName(input.instanceId);
  const labels = managedLabels(input);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name,
      namespace: input.namespace,
      annotations: managedAnnotations(input),
      labels,
    },
    spec: {
      type: "ClusterIP",
      selector: { "tali.io/instance-key": labels["tali.io/instance-key"]! },
      ports: [
        {
          name: "http",
          port: input.containerPort,
          protocol: "TCP",
          targetPort: "http",
        },
      ],
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

function imageRepository(image: string): string {
  const withoutDigest = image.split("@", 1)[0]!;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  return lastColon > lastSlash
    ? withoutDigest.slice(0, lastColon)
    : withoutDigest;
}

function isDevelopmentImage(image: string): boolean {
  return image.split("@", 1)[0]!.endsWith(":dev");
}

function managedImagePullPolicy(image: string): "Always" | "IfNotPresent" {
  return image.includes("@sha256:") || isDevelopmentImage(image)
    ? "IfNotPresent"
    : "Always";
}

export function pinnedImageReference(
  requestedImage: string,
  imageId: string | undefined,
): string | undefined {
  if (requestedImage.includes("@sha256:")) return requestedImage;
  if (!imageId) return undefined;
  const normalized = imageId.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (normalized.includes("@sha256:")) return normalized;
  const digest = normalized.match(/sha256:[a-f0-9]{64}/i)?.[0];
  return digest ? `${imageRepository(requestedImage)}@${digest}` : undefined;
}

function readyAgentPod(
  pods: V1Pod[],
  expectedImage?: string,
  expectedRevisionKey?: string,
): V1Pod | undefined {
  for (const pod of pods) {
    const container = pod.spec?.containers.find(
      (candidate) => candidate.name === "agent",
    );
    if (expectedImage && container?.image !== expectedImage) continue;
    if (
      expectedRevisionKey &&
      pod.metadata?.labels?.["tali.io/revision-key"] !== expectedRevisionKey
    ) continue;
    const status = pod.status?.containerStatuses?.find(
      (container) => container.name === "agent" && container.ready,
    );
    if (status?.imageID) return pod;
  }
  return undefined;
}

function imageIdFromPod(pod: V1Pod | undefined): string | undefined {
  return pod?.status?.containerStatuses?.find(
    (container) => container.name === "agent" && container.ready,
  )?.imageID;
}

class DisabledManagedAgentRuntimeClient implements ManagedAgentRuntimeClient {
  private unavailable(): never {
    throw new Error(
      "Container Image onboarding requires Project Runtime Namespaces to be enabled.",
    );
  }

  async onboard(): Promise<ManagedAgentRuntimeResult> {
    return this.unavailable();
  }

  async remove(): Promise<void> {
    return this.unavailable();
  }
}

class UnavailableManagedAgentRuntimeClient
  implements ManagedAgentRuntimeClient
{
  private unavailable(): never {
    throw new Error(
      "Container Image onboarding is enabled, but the Kubernetes in-cluster API is unavailable.",
    );
  }

  async onboard(): Promise<ManagedAgentRuntimeResult> {
    return this.unavailable();
  }

  async remove(): Promise<void> {
    return this.unavailable();
  }
}

export class KubernetesManagedAgentRuntimeClient
  implements ManagedAgentRuntimeClient
{
  private readonly apps: ManagedAgentAppsApi;
  private readonly core: ManagedAgentCoreApi;
  private readonly objects: ManagedAgentObjectApi;

  constructor(
    apps?: ManagedAgentAppsApi,
    core?: ManagedAgentCoreApi,
    objects?: ManagedAgentObjectApi,
    private readonly timeoutMs = DEFAULT_ONBOARD_TIMEOUT_MS,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {
    if (apps || core || objects) {
      if (!apps || !core || !objects) {
        throw new Error(
          "Apps, Core, and Kubernetes Object API clients are all required.",
        );
      }
      this.apps = apps;
      this.core = core;
      this.objects = objects;
      return;
    }
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromCluster();
    this.apps = kubeConfig.makeApiClient(AppsV1Api);
    this.core = kubeConfig.makeApiClient(CoreV1Api);
    this.objects = KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  async onboard(
    input: ManagedAgentRuntimeInput,
  ): Promise<ManagedAgentRuntimeResult> {
    await this.assertExistingOwnership(input);
    const owner = await readProjectNamespaceOwner(input.namespace, input.projectId);
    await this.apply(withNamespaceOwner(serviceResource(input), owner));
    await this.apply(withNamespaceOwner(deploymentResource(input, input.image), owner));
    let readyPod = await this.waitUntilReady(input, input.image);
    const imageId = imageIdFromPod(readyPod);
    const localDevelopmentImage = isDevelopmentImage(input.image)
      && imageId?.startsWith("docker://");
    const pinnedImage = localDevelopmentImage
      ? input.image
      : pinnedImageReference(input.image, imageId);
    if (!pinnedImage) {
      throw new Error(
        "The Agent container started, but Kubernetes did not report an immutable image digest.",
      );
    }
    if (pinnedImage !== input.image) {
      await this.apply(withNamespaceOwner(deploymentResource(input, pinnedImage), owner));
      readyPod = await this.waitUntilReady(input, pinnedImage);
    }

    const podName = readyPod?.metadata?.name;
    if (!podName) {
      throw new Error(
        "The Agent container became ready, but Kubernetes did not report its Pod name.",
      );
    }
    const name = managedAgentResourceName(input.instanceId);
    const endpoint = managedAgentEndpoint(
      input.namespace,
      name,
      input.containerPort,
    );
    return {
      agentCardUrl: new URL(input.agentCardPath, `${endpoint}/`).toString(),
      deploymentName: name,
      endpoint,
      imageDigest: pinnedImage,
      imageReference: input.image,
      namespace: input.namespace,
      podName,
      serviceName: name,
    };
  }

  async remove(input: {
    agentId: string;
    instanceId: string;
    namespace: string;
    projectId: string;
  }): Promise<void> {
    const existing = await this.assertExistingOwnership(input);
    const deploymentName = existing.deployment?.metadata?.name;
    const serviceName = existing.service?.metadata?.name;
    if (deploymentName) {
      await this.apps.deleteNamespacedDeployment({
        name: deploymentName,
        namespace: input.namespace,
        propagationPolicy: "Foreground",
      });
    }
    if (serviceName) {
      await this.core.deleteNamespacedService({
        name: serviceName,
        namespace: input.namespace,
      });
    }
  }

  private async apply(resource: V1Deployment | V1Service): Promise<void> {
    await this.objects.patch(
      resource,
      undefined,
      undefined,
      FIELD_MANAGER,
      false,
      PatchStrategy.ServerSideApply,
    );
  }

  private async assertExistingOwnership(input: ManagedAgentOwnership): Promise<{
    deployment?: V1Deployment;
    service?: V1Service;
  }> {
    const name = managedAgentResourceName(input.instanceId);
    const [deployment, service] = await Promise.all([
      this.readDeployment(input.namespace, name),
      this.readService(input.namespace, name),
    ]);
    for (const resource of [deployment, service]) {
      if (!resource) continue;
      const annotations = resource.metadata?.annotations;
      if (
        annotations?.["tali.io/project-id"] !== input.projectId ||
        annotations?.["tali.io/agent-id"] !== input.agentId ||
        annotations?.["tali.io/instance-id"] !== input.instanceId
      ) {
        throw new Error(
          `Refusing to manage Kubernetes resource ${input.namespace}/${name}: ownership metadata does not match this Agent.`,
        );
      }
    }
    return {
      ...(deployment ? { deployment } : {}),
      ...(service ? { service } : {}),
    };
  }

  private async readDeployment(
    namespace: string,
    name: string,
  ): Promise<V1Deployment | undefined> {
    try {
      return await this.apps.readNamespacedDeployment({ name, namespace });
    } catch (error) {
      if (kubernetesStatusCode(error) === 404) return undefined;
      throw error;
    }
  }

  private async readService(
    namespace: string,
    name: string,
  ): Promise<V1Service | undefined> {
    try {
      return await this.core.readNamespacedService({ name, namespace });
    } catch (error) {
      if (kubernetesStatusCode(error) === 404) return undefined;
      throw error;
    }
  }

  private async waitUntilReady(
    input: ManagedAgentRuntimeInput,
    expectedImage: string,
  ): Promise<V1Pod> {
    const name = managedAgentResourceName(input.instanceId);
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const [deployment, pods] = await Promise.all([
        this.apps.readNamespacedDeployment({
          name,
          namespace: input.namespace,
        }),
        this.core.listNamespacedPod({
          namespace: input.namespace,
          labelSelector:
            `tali.io/instance-key=${managedInstanceKey(input.instanceId)}`,
        }),
      ]);
      const readyPod = readyAgentPod(
        pods.items,
        expectedImage,
        managedAgentRevisionKey(input, expectedImage),
      );
      if (
        readyPod &&
        (deployment.status?.availableReplicas ?? 0) >= 1 &&
        deployment.status?.observedGeneration === deployment.metadata?.generation
      ) {
        return readyPod;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error(
      `Agent image ${expectedImage} did not become ready within ${this.timeoutMs}ms. Review the image entrypoint, port, and pull credentials.`,
    );
  }
}

export function createManagedAgentRuntimeClient(): ManagedAgentRuntimeClient {
  let kubernetes: KubernetesManagedAgentRuntimeClient | undefined;
  const current = async (): Promise<ManagedAgentRuntimeClient> => {
    if (!(await loadPlatformRuntimeConfiguration()).runtimeNamespaces.enabled)
      return new DisabledManagedAgentRuntimeClient();
    if (!process.env.KUBERNETES_SERVICE_HOST)
      return new UnavailableManagedAgentRuntimeClient();
    return (kubernetes ??= new KubernetesManagedAgentRuntimeClient());
  };
  return {
    async onboard(input) {
      return (await current()).onboard(input);
    },
    async remove(input) {
      return (await current()).remove(input);
    },
  };
}
