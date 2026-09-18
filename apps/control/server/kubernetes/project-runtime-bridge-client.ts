import { getWorkerConfig } from "../config/worker-config";
import {
  AppsV1Api,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  type KubernetesObject,
  type V1Deployment,
  type V1PersistentVolumeClaim,
  type V1Secret,
  type V1Service,
} from "@kubernetes/client-node";
import { createHash } from "node:crypto";
import { readProjectNamespaceOwner, withNamespaceOwner } from "./project-resource-ownership";
import type { ProjectNamespaceInput } from "./project-namespace-client";

const FIELD_MANAGER = "tali-control-project-runtime-bridge";
export const PROJECT_RUNTIME_BRIDGE_NAME = "tali-agent-runtime-bridge";
const CONTROL_CONTAINER_PORT = 8080;

export interface ProjectRuntimeBridgeInput extends ProjectNamespaceInput {
  controlUrl: string;
  token: string;
}

export interface ProjectRuntimeBridgeClient {
  reconcile(input: ProjectRuntimeBridgeInput): Promise<void>;
}

interface ProjectRuntimeBridgeConfiguration {
  enabled: boolean;
  image: string;
  imagePullPolicy: string;
  revision: string;
  imagePullSecrets: Array<{ name: string }>;
  resources: Record<string, unknown>;
  storageClass?: string | undefined;
  storageSize: string;
}

type RuntimeBridgeObjectApi = Pick<KubernetesObjectApi, "patch">;
type RuntimeBridgeAppsApi = Pick<AppsV1Api, "readNamespacedDeployment">;

function labels(): Record<string, string> {
  return {
    "app.kubernetes.io/component": "agent-runtime-bridge",
    "app.kubernetes.io/managed-by": "tali",
    "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME,
    "app.kubernetes.io/part-of": "tali",
    "tali.io/runtime-kind": "project-agent-runtime-bridge",
  };
}

function annotations(input: ProjectNamespaceInput): Record<string, string> {
  return {
    "tali.io/project-id": input.projectId,
    "tali.io/project-name": input.projectName,
  };
}

export function controlNetworkTarget(controlUrl: string): {
  namespace: string;
  port: number;
} {
  const url = new URL(controlUrl);
  const host = url.hostname.split(".");
  if (
    url.protocol !== "http:"
    || host.length !== 5
    || host[2] !== "svc"
    || host[3] !== "cluster"
    || host[4] !== "local"
    || !host[0]
    || !host[1]
  ) {
    throw new Error(
      "Project Runtime Bridge Control URL must be an in-cluster HTTP Service FQDN.",
    );
  }
  return {
    namespace: host[1],
    port: url.port ? Number(url.port) : 80,
  };
}

export function projectRuntimeBridgeResources(
  input: ProjectRuntimeBridgeInput,
  configuration: Omit<ProjectRuntimeBridgeConfiguration, "enabled">,
): KubernetesObject[] {
  const control = controlNetworkTarget(input.controlUrl);
  const controlPorts = [...new Set([control.port, CONTROL_CONTAINER_PORT])];
  const metadata = {
    name: PROJECT_RUNTIME_BRIDGE_NAME,
    namespace: input.namespace,
    annotations: annotations(input),
    labels: labels(),
  };
  const secret: V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata,
    type: "Opaque",
    stringData: { "project-token": input.token },
  };
  const persistentVolumeClaim: V1PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata,
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: configuration.storageSize } },
      ...(configuration.storageClass
        ? { storageClassName: configuration.storageClass }
        : {}),
    },
  };
  const service: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata,
    spec: {
      type: "ClusterIP",
      selector: { "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME },
      ports: [{ name: "http", port: 8080, targetPort: "http" }],
    },
  };
  const bridgeUrl = `http://${PROJECT_RUNTIME_BRIDGE_NAME}.${input.namespace}.svc.cluster.local:8080`;
  const deployment: V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata,
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: {
        matchLabels: { "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME },
      },
      template: {
        metadata: {
          annotations: {
            ...annotations(input),
            "tali.io/project-runtime-token-checksum": createHash("sha256")
              .update(input.token)
              .digest("hex"),
            "tali.io/project-runtime-bridge-revision": configuration.revision,
          },
          labels: labels(),
        },
        spec: {
          automountServiceAccountToken: false,
          imagePullSecrets: configuration.imagePullSecrets,
          securityContext: { seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "runtime-bridge",
            image: configuration.image,
            imagePullPolicy: configuration.imagePullPolicy,
            command: ["node"],
            args: ["apps/control/.output/runtime-bridge/project-runtime-bridge.mjs"],
            env: [
              { name: "PORT", value: "8080" },
              { name: "TALI_CONTROL_INTERNAL_URL", value: input.controlUrl },
              { name: "TALI_PROJECT_ID", value: input.projectId },
              { name: "TALI_PROJECT_RUNTIME_BRIDGE_URL", value: bridgeUrl },
              {
                name: "TALI_PROJECT_RUNTIME_TOKEN",
                valueFrom: {
                  secretKeyRef: {
                    name: PROJECT_RUNTIME_BRIDGE_NAME,
                    key: "project-token",
                  },
                },
              },
            ],
            ports: [{ name: "http", containerPort: 8080 }],
            readinessProbe: {
              httpGet: { path: "/healthz", port: "http" },
              initialDelaySeconds: 1,
              periodSeconds: 3,
            },
            livenessProbe: {
              httpGet: { path: "/healthz", port: "http" },
              initialDelaySeconds: 10,
              periodSeconds: 10,
            },
            resources: configuration.resources,
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
              readOnlyRootFilesystem: true,
              runAsNonRoot: true,
            },
            volumeMounts: [
              { name: "tmp", mountPath: "/tmp" },
              {
                name: "project-capabilities",
                mountPath: "/project-capabilities",
              },
            ],
          }],
          volumes: [
            { name: "tmp", emptyDir: {} },
            {
              name: "project-capabilities",
              persistentVolumeClaim: { claimName: PROJECT_RUNTIME_BRIDGE_NAME },
            },
          ],
        },
      },
    },
  };
  const networkPolicy: KubernetesObject & { spec: Record<string, unknown> } = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata,
    spec: {
      podSelector: {
        matchLabels: { "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [{ podSelector: {} }], ports: [{ port: 8080, protocol: "TCP" }] }],
      egress: [
        { ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] },
        {
          to: [{
            namespaceSelector: {
              matchLabels: {
                "kubernetes.io/metadata.name": control.namespace,
              },
            },
            podSelector: {
              matchLabels: {
                "app.kubernetes.io/component": "control",
              },
            },
          }],
          ports: controlPorts.map((port) => ({ port, protocol: "TCP" })),
        },
      ],
    },
  };
  return [secret, persistentVolumeClaim, service, deployment, networkPolicy];
}

export class KubernetesProjectRuntimeBridgeClient
  implements ProjectRuntimeBridgeClient
{
  private readonly objects: RuntimeBridgeObjectApi;
  private readonly apps: RuntimeBridgeAppsApi;

  constructor(
    private readonly configuration: ProjectRuntimeBridgeConfiguration = getWorkerConfig().project_runtime_bridge,
    objects?: RuntimeBridgeObjectApi,
    apps?: RuntimeBridgeAppsApi,
  ) {
    if (objects || apps) {
      if (!objects || !apps) {
        throw new Error(
          "Both Kubernetes object and Apps clients are required for Project Runtime Bridge reconciliation.",
        );
      }
      this.objects = objects;
      this.apps = apps;
      return;
    }
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromCluster();
    this.objects = KubernetesObjectApi.makeApiClient(kubeConfig);
    this.apps = kubeConfig.makeApiClient(AppsV1Api);
  }

  async reconcile(input: ProjectRuntimeBridgeInput): Promise<void> {
    if (!this.configuration.enabled) return;
    if (!input.controlUrl) {
      throw new Error("Control internal URL is required for Project Runtime Bridge reconciliation.");
    }
    const owner = await readProjectNamespaceOwner(input.namespace, input.projectId);
    for (const resource of projectRuntimeBridgeResources(input, this.configuration)) {
      await this.objects.patch(
        withNamespaceOwner(resource, owner),
        undefined,
        undefined,
        FIELD_MANAGER,
        false,
        PatchStrategy.ServerSideApply,
      );
    }
    const timeoutMs = getWorkerConfig().project_runtime_bridge.readyTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const deployment = await this.apps.readNamespacedDeployment({
        name: PROJECT_RUNTIME_BRIDGE_NAME,
        namespace: input.namespace,
      });
      if (
        deployment.metadata?.generation
        && deployment.status?.observedGeneration === deployment.metadata.generation
        && (deployment.status.availableReplicas ?? 0) >= 1
      ) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Project Runtime Bridge did not become ready within ${timeoutMs}ms.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

class DisabledProjectRuntimeBridgeClient
  implements ProjectRuntimeBridgeClient
{
  async reconcile(): Promise<void> {}
}

export function createProjectRuntimeBridgeClient(): ProjectRuntimeBridgeClient {
  return getWorkerConfig().project_runtime_bridge.enabled
    ? new KubernetesProjectRuntimeBridgeClient()
    : new DisabledProjectRuntimeBridgeClient();
}
