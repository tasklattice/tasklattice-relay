import {
  AppsV1Api,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  type KubernetesObject,
  type V1ConfigMap,
  type V1Deployment,
  type V1Secret,
  type V1Service,
} from "@kubernetes/client-node";
import { createHash } from "node:crypto";
import type { ExpertAgentRuntimeEnvelope } from "@tali/contracts";
import { PROJECT_RUNTIME_BRIDGE_NAME } from "./project-runtime-bridge-client";

const FIELD_MANAGER = "tali-control-expert-agent-runtime";
const CONTAINER_PORT = 8080;

export interface ExpertAgentRuntimeDeploymentInput {
  projectId: string;
  projectName: string;
  namespace: string;
  instanceId: string;
  agentId: string;
  agentName: string;
  envelope: ExpertAgentRuntimeEnvelope;
  runtimeToken: string;
  a2aBearerToken: string;
}

export interface ExpertAgentRuntimeDeploymentResult {
  endpoint: string;
  resourceName: string;
  engineVersion: string;
}

export interface ExpertAgentRuntimeClient {
  activate(
    input: ExpertAgentRuntimeDeploymentInput,
  ): Promise<ExpertAgentRuntimeDeploymentResult>;
  deactivate(input: {
    namespace: string;
    instanceId: string;
  }): Promise<void>;
}

export interface ExpertAgentRuntimeConfiguration {
  enabled: boolean;
  image: string;
  imagePullPolicy: string;
  imagePullSecrets: Array<{ name: string }>;
  resources: Record<string, unknown>;
  revision: string;
}

type ExpertRuntimeObjectApi = Pick<KubernetesObjectApi, "delete" | "patch">;
type ExpertRuntimeAppsApi = Pick<AppsV1Api, "readNamespacedDeployment">;

function configurationFromEnvironment(): ExpertAgentRuntimeConfiguration {
  const enabled = process.env.EXPERT_AGENT_RUNTIMES_ENABLED === "true";
  const image = process.env.EXPERT_AGENT_RUNTIME_IMAGE?.trim() ?? "";
  if (enabled && !image) {
    throw new Error(
      "EXPERT_AGENT_RUNTIME_IMAGE is required when Expert Agent Runtimes are enabled.",
    );
  }
  const imagePullSecrets = JSON.parse(
    process.env.EXPERT_AGENT_RUNTIME_IMAGE_PULL_SECRETS_JSON ?? "[]",
  ) as unknown;
  if (!Array.isArray(imagePullSecrets)) {
    throw new Error("EXPERT_AGENT_RUNTIME_IMAGE_PULL_SECRETS_JSON must be an array.");
  }
  return {
    enabled,
    image,
    imagePullPolicy: process.env.EXPERT_AGENT_RUNTIME_IMAGE_PULL_POLICY
      ?? "IfNotPresent",
    imagePullSecrets: imagePullSecrets as Array<{ name: string }>,
    resources: JSON.parse(
      process.env.EXPERT_AGENT_RUNTIME_RESOURCES_JSON ?? "{}",
    ) as Record<string, unknown>,
    revision: process.env.EXPERT_AGENT_RUNTIME_REVISION ?? image,
  };
}

export function expertAgentRuntimeResourceName(instanceId: string): string {
  return `tali-expert-${createHash("sha256")
    .update(instanceId)
    .digest("hex")
    .slice(0, 16)}`;
}

export function expertAgentRuntimeEndpoint(
  namespace: string,
  resourceName: string,
): string {
  return `http://${resourceName}.${namespace}.svc.cluster.local:${CONTAINER_PORT}/a2a`;
}

function labels(input: ExpertAgentRuntimeDeploymentInput): Record<string, string> {
  return {
    "app.kubernetes.io/component": "expert-agent",
    "app.kubernetes.io/instance": expertAgentRuntimeResourceName(input.instanceId),
    "app.kubernetes.io/managed-by": "tali",
    "app.kubernetes.io/name": "tali-expert-agent",
    "app.kubernetes.io/part-of": "tali",
    "tali.io/agent-key": createHash("sha256")
      .update(input.instanceId).digest("hex").slice(0, 24),
    "tali.io/runtime-kind": "expert-agent-a2a",
  };
}

function annotations(input: ExpertAgentRuntimeDeploymentInput): Record<string, string> {
  return {
    "tali.io/project-id": input.projectId,
    "tali.io/instance-id": input.instanceId,
    "tali.io/agent-id": input.agentId,
    "tali.io/agent-name": input.agentName,
    "tali.io/version-id": input.envelope.versionId,
    "tali.io/version-number": String(input.envelope.versionNumber),
    "tali.io/content-digest": input.envelope.contentDigest,
  };
}

export function expertAgentRuntimeResources(
  input: ExpertAgentRuntimeDeploymentInput,
  configuration: Omit<ExpertAgentRuntimeConfiguration, "enabled">,
): KubernetesObject[] {
  const name = expertAgentRuntimeResourceName(input.instanceId);
  const resourceLabels = labels(input);
  const metadata = {
    name,
    namespace: input.namespace,
    labels: resourceLabels,
    annotations: annotations(input),
  };
  const endpoint = expertAgentRuntimeEndpoint(input.namespace, name);
  const bridgeUrl = `http://${PROJECT_RUNTIME_BRIDGE_NAME}.${input.namespace}.svc.cluster.local:8080`;
  const configMap: V1ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata,
    data: { "version.json": JSON.stringify(input.envelope) },
  };
  const secret: V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata,
    type: "Opaque",
    stringData: {
      "runtime-token": input.runtimeToken,
      "a2a-token": input.a2aBearerToken,
    },
  };
  const service: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata,
    spec: {
      type: "ClusterIP",
      selector: { "tali.io/agent-key": resourceLabels["tali.io/agent-key"]! },
      ports: [{ name: "http", port: CONTAINER_PORT, targetPort: "http" }],
    },
  };
  const deployment: V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata,
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: {
        matchLabels: { "tali.io/agent-key": resourceLabels["tali.io/agent-key"]! },
      },
      template: {
        metadata: {
          labels: resourceLabels,
          annotations: {
            ...annotations(input),
            "tali.io/expert-runtime-revision": configuration.revision,
            "tali.io/runtime-token-checksum": createHash("sha256")
              .update(input.runtimeToken).digest("hex"),
          },
        },
        spec: {
          automountServiceAccountToken: false,
          imagePullSecrets: configuration.imagePullSecrets,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [{
            name: "expert-agent",
            image: configuration.image,
            imagePullPolicy: configuration.imagePullPolicy,
            env: [
              { name: "PORT", value: String(CONTAINER_PORT) },
              { name: "TALI_EXPERT_AGENT_VERSION_FILE", value: "/etc/tali/expert-agent/version.json" },
              { name: "TALI_PROJECT_RUNTIME_BRIDGE_URL", value: bridgeUrl },
              { name: "TALI_A2A_PUBLIC_URL", value: endpoint },
              {
                name: "TALI_EXPERT_AGENT_RUNTIME_TOKEN",
                valueFrom: {
                  secretKeyRef: { name, key: "runtime-token" },
                },
              },
              {
                name: "TALI_A2A_BEARER_TOKEN",
                valueFrom: { secretKeyRef: { name, key: "a2a-token" } },
              },
            ],
            ports: [{ name: "http", containerPort: CONTAINER_PORT }],
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
            volumeMounts: [{
              name: "version",
              mountPath: "/etc/tali/expert-agent",
              readOnly: true,
            }],
          }],
          volumes: [{ name: "version", configMap: { name } }],
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
        matchLabels: { "tali.io/agent-key": resourceLabels["tali.io/agent-key"]! },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{
        from: [{ podSelector: {} }],
        ports: [{ port: CONTAINER_PORT, protocol: "TCP" }],
      }],
      egress: [
        { ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] },
        {
          to: [{
            podSelector: {
              matchLabels: { "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME },
            },
          }],
          ports: [{ port: 8080, protocol: "TCP" }],
        },
      ],
    },
  };
  return [configMap, secret, service, deployment, networkPolicy];
}

export class KubernetesExpertAgentRuntimeClient
implements ExpertAgentRuntimeClient {
  private readonly objects: ExpertRuntimeObjectApi;
  private readonly apps: ExpertRuntimeAppsApi;

  constructor(
    private readonly configuration = configurationFromEnvironment(),
    objects?: ExpertRuntimeObjectApi,
    apps?: ExpertRuntimeAppsApi,
  ) {
    if (objects || apps) {
      if (!objects || !apps) {
        throw new Error("Both Kubernetes object and Apps clients are required.");
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

  async activate(
    input: ExpertAgentRuntimeDeploymentInput,
  ): Promise<ExpertAgentRuntimeDeploymentResult> {
    if (!this.configuration.enabled) {
      throw new Error("Expert Agent Runtime deployments are disabled.");
    }
    const name = expertAgentRuntimeResourceName(input.instanceId);
    for (const resource of expertAgentRuntimeResources(input, this.configuration)) {
      await this.objects.patch(
        resource,
        undefined,
        undefined,
        FIELD_MANAGER,
        false,
        PatchStrategy.ServerSideApply,
      );
    }
    const timeoutMs = Number(process.env.EXPERT_AGENT_RUNTIME_READY_TIMEOUT_MS ?? "120000");
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const deployment = await this.apps.readNamespacedDeployment({
        name,
        namespace: input.namespace,
      });
      if (
        deployment.metadata?.generation
        && deployment.status?.observedGeneration === deployment.metadata.generation
        && (deployment.status.availableReplicas ?? 0) >= 1
        && (deployment.status.updatedReplicas ?? 0) >= 1
      ) {
        return {
          endpoint: expertAgentRuntimeEndpoint(input.namespace, name),
          resourceName: name,
          engineVersion: input.envelope.snapshot.execution.engine.version,
        };
      }
      if (Date.now() >= deadline) {
        throw new Error(`Expert Agent Runtime did not become ready within ${timeoutMs}ms.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  async deactivate(input: { namespace: string; instanceId: string }): Promise<void> {
    if (!this.configuration.enabled) {
      throw new Error("Expert Agent Runtime deployments are disabled.");
    }
    const name = expertAgentRuntimeResourceName(input.instanceId);
    for (const resource of [
      { apiVersion: "apps/v1", kind: "Deployment" },
      { apiVersion: "v1", kind: "Service" },
      { apiVersion: "v1", kind: "Secret" },
      { apiVersion: "v1", kind: "ConfigMap" },
      { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy" },
    ]) {
      try {
        await this.objects.delete({
          ...resource,
          metadata: { name, namespace: input.namespace },
        });
      } catch (error) {
        const status = error && typeof error === "object"
          ? Number(
              (error as { statusCode?: unknown; code?: unknown }).statusCode
              ?? (error as { code?: unknown }).code,
            )
          : 0;
        if (status !== 404) throw error;
      }
    }
  }
}

export function createExpertAgentRuntimeClient(): ExpertAgentRuntimeClient {
  return new KubernetesExpertAgentRuntimeClient();
}
