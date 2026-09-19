import type {
  V1Deployment,
  V1Secret,
  V1Service,
} from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  KubernetesProjectRuntimeBridgeClient,
  PROJECT_RUNTIME_BRIDGE_NAME,
  projectRuntimeBridgeResources,
} from "./project-runtime-bridge-client";

const input = {
  namespace: "tp-abcdefghijklmnop",
  projectId: "project-a",
  projectName: "Project A",
  controlUrl: "http://tali-control.tali.svc.cluster.local:38080",
  token: "project-scoped-token",
};

const configuration = {
  image: "ghcr.io/tasklattice/tali-control:dev",
  imagePullPolicy: "IfNotPresent",
  revision: "test-revision-1",
  imagePullSecrets: [{ name: "registry" }],
  resources: { requests: { cpu: "25m", memory: "64Mi" } },
};

describe("Project Runtime Bridge resources", () => {
  it("creates one isolated stateless proxy service without persistent storage", () => {
    const resources = projectRuntimeBridgeResources(input, configuration);
    expect(resources.map((resource) => resource.kind)).toEqual([
      "Secret",
      "Service",
      "Deployment",
      "NetworkPolicy",
    ]);
    expect(resources.every(
      (resource) => resource.metadata?.namespace === input.namespace,
    )).toBe(true);

    const secret = resources[0] as V1Secret;
    expect(secret.stringData).toEqual({
      "project-token": input.token,
    });
    const service = resources[1] as V1Service;
    expect(service).toMatchObject({
      metadata: { name: PROJECT_RUNTIME_BRIDGE_NAME },
      spec: { type: "ClusterIP", ports: [{ port: 8080 }] },
    });
    const deployment = resources[2] as V1Deployment;
    expect(deployment.spec?.strategy?.type).toBe("Recreate");
    expect(
      deployment.spec?.template.metadata?.annotations?.[
        "tali.io/project-runtime-token-checksum"
      ],
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      deployment.spec?.template.metadata?.annotations?.[
        "tali.io/project-runtime-bridge-revision"
      ],
    ).toBe("test-revision-1");
    expect(deployment.spec?.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      containers: [{
        image: configuration.image,
        args: ["apps/control/.output/runtime-bridge/project-runtime-bridge.mjs"],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          runAsNonRoot: true,
        },
        volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
      }],
      volumes: [{ name: "tmp", emptyDir: {} }],
    });
    expect(deployment.spec?.template.spec?.volumes).toEqual([
      { name: "tmp", emptyDir: {} },
    ]);
    expect(deployment.spec?.template.spec?.containers[0]?.volumeMounts).toEqual([
      { name: "tmp", mountPath: "/tmp" },
    ]);
    const tokenEnvironment = deployment.spec?.template.spec?.containers[0]
      ?.env?.find((item) => item.name === "TALI_PROJECT_RUNTIME_TOKEN");
    expect(tokenEnvironment).toMatchObject({
      valueFrom: {
        secretKeyRef: {
          name: PROJECT_RUNTIME_BRIDGE_NAME,
          key: "project-token",
        },
      },
    });
    expect(tokenEnvironment).not.toHaveProperty("value");
    const networkPolicy = resources[3] as unknown as {
      spec: { egress: Array<Record<string, unknown>> };
    };
    expect(networkPolicy.spec.egress[1]).toEqual({
      to: [{
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "tali" },
        },
        podSelector: {
          matchLabels: { "app.kubernetes.io/component": "control" },
        },
      }],
      ports: [
        { port: 38_080, protocol: "TCP" },
        { port: 8080, protocol: "TCP" },
      ],
    });
  });

  it("rejects a Control endpoint outside the in-cluster Service boundary", () => {
    expect(() => projectRuntimeBridgeResources(
      { ...input, controlUrl: "https://control.example.com" },
      configuration,
    )).toThrow("in-cluster HTTP Service FQDN");
  });

  it("waits for the applied Deployment generation to become available", async () => {
    const objects = { patch: vi.fn(async () => ({})) };
    const apps = {
      readNamespacedDeployment: vi.fn(async () => ({
        metadata: { generation: 3 },
        status: { observedGeneration: 3, availableReplicas: 1 },
      })),
    };
    const client = new KubernetesProjectRuntimeBridgeClient(
      { ...configuration, enabled: true },
      objects as never,
      apps as never,
    );

    await client.reconcile(input);

    expect(objects.patch).toHaveBeenCalledTimes(4);
    expect(apps.readNamespacedDeployment).toHaveBeenCalledWith({
      name: PROJECT_RUNTIME_BRIDGE_NAME,
      namespace: input.namespace,
    });
  });
});
