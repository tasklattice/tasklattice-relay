import type {
  V1ConfigMap,
  V1Deployment,
  V1Secret,
  V1Service,
} from "@kubernetes/client-node";
import type { ExpertAgentRuntimeEnvelope } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  KubernetesExpertAgentRuntimeClient,
  expertAgentRuntimeEndpoint,
  expertAgentRuntimeResourceName,
  expertAgentRuntimeResources,
} from "./expert-agent-runtime-client";

const envelope = {
  versionId: "22222222-2222-4222-8222-222222222222",
  versionNumber: 1,
  contentDigest: `sha256:${"a".repeat(64)}`,
  snapshot: {
    agentId: "11111111-1111-4111-8111-111111111111",
    execution: {
      mode: "AGENTIC",
      engine: { framework: "TALI_EXPERT_RUNTIME", version: "0.1.0" },
    },
  },
} as unknown as ExpertAgentRuntimeEnvelope;

const input = {
  projectId: "project-a",
  projectName: "Project A",
  namespace: "tp-abcdefghijklmnop",
  instanceId: "33333333-3333-4333-8333-333333333333",
  agentId: envelope.snapshot.agentId,
  agentName: "GitHub Weekly Commit Summary",
  envelope,
  runtimeToken: "runtime-secret-token",
  a2aBearerToken: "a2a-secret-token",
};

const configuration = {
  image: "ghcr.io/tasklattice/expert-agent-runtime@sha256:abc",
  imagePullPolicy: "IfNotPresent",
  imagePullSecrets: [{ name: "registry" }],
  resources: { requests: { cpu: "50m", memory: "96Mi" } },
  revision: "runtime-0.1.0",
};

describe("Expert Agent Kubernetes Runtime", () => {
  it("pins one immutable Version envelope and secret-scoped credentials", () => {
    const resources = expertAgentRuntimeResources(input, configuration);
    expect(resources.map((resource) => resource.kind)).toEqual([
      "ConfigMap",
      "Secret",
      "Service",
      "Deployment",
      "NetworkPolicy",
    ]);
    expect(resources.every(
      (resource) => resource.metadata?.namespace === input.namespace,
    )).toBe(true);

    const configMap = resources[0] as V1ConfigMap;
    expect(JSON.parse(configMap.data?.["version.json"] ?? "null"))
      .toEqual(envelope);
    const secret = resources[1] as V1Secret;
    expect(secret.stringData).toEqual({
      "runtime-token": input.runtimeToken,
      "a2a-token": input.a2aBearerToken,
    });
    const service = resources[2] as V1Service;
    expect(service.spec?.ports?.[0]?.port).toBe(8080);

    const deployment = resources[3] as V1Deployment;
    expect(deployment.spec?.strategy?.type).toBe("Recreate");
    expect(deployment.spec?.template.spec?.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      seccompProfile: { type: "RuntimeDefault" },
    });
    const container = deployment.spec?.template.spec?.containers[0];
    expect(container).toMatchObject({
      image: configuration.image,
      readinessProbe: { httpGet: { path: "/healthz" } },
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        runAsNonRoot: true,
      },
    });
    expect(container?.env?.find(
      (item) => item.name === "TALI_EXPERT_AGENT_RUNTIME_TOKEN",
    )).toMatchObject({
      valueFrom: { secretKeyRef: { key: "runtime-token" } },
    });
    expect(JSON.stringify(deployment)).not.toContain(input.runtimeToken);
    expect(JSON.stringify(deployment)).not.toContain(input.a2aBearerToken);

    const policy = resources[4] as unknown as {
      spec: { egress: Array<Record<string, unknown>> };
    };
    expect(policy.spec.egress).toHaveLength(2);
    expect(JSON.stringify(policy)).toContain("tali-agent-runtime-bridge");
  });

  it("waits for the exact Deployment generation to become available", async () => {
    const objects = {
      patch: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    };
    const apps = {
      readNamespacedDeployment: vi.fn(async () => ({
        metadata: { generation: 5 },
        status: {
          observedGeneration: 5,
          availableReplicas: 1,
          updatedReplicas: 1,
        },
      })),
    };
    const client = new KubernetesExpertAgentRuntimeClient(
      { ...configuration, enabled: true },
      objects as never,
      apps as never,
    );
    await expect(client.activate(input)).resolves.toEqual({
      endpoint: expertAgentRuntimeEndpoint(
        input.namespace,
        expertAgentRuntimeResourceName(input.instanceId),
      ),
      resourceName: expertAgentRuntimeResourceName(input.instanceId),
      engineVersion: "0.1.0",
    });
    expect(objects.patch).toHaveBeenCalledTimes(5);
  });
});
