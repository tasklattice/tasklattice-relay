import type {
  V1Deployment,
  V1Secret,
  V1Service,
} from "@kubernetes/client-node";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import {
  KubernetesProjectRuntimeBridgeClient,
  PROJECT_RUNTIME_BRIDGE_NAME,
  projectRuntimeBridgeResources,
  controlNetworkTarget,
} from "./project-runtime-bridge-client";

const input = {
  namespace: "tp-abcdefghijklm",
  projectId: "project-a",
  projectName: "Project A",
  controlUrl: "http://tali-control.tali.svc.cluster.local:38080",
  token: "project-scoped-token",
};

function serviceFor(controlUrl = input.controlUrl): V1Service {
  const target = controlNetworkTarget(controlUrl);
  return { apiVersion: "v1", kind: "Service",
    metadata: { name: target.serviceName, namespace: target.namespace },
    spec: { selector: { "app.kubernetes.io/component": "control", "app.kubernetes.io/instance": "relay", "app.kubernetes.io/name": "custom-relay" },
      ports: [{ port: target.port, targetPort: 8080 }] } };
}

const configuration = {
  image: "ghcr.io/tasklattice/tali-control:dev",
  imagePullPolicy: "IfNotPresent",
  revision: "test-revision-1",
  imagePullSecrets: [{ name: "registry" }],
  resources: { requests: { cpu: "25m", memory: "64Mi" } },
};

afterEach(() => {
  setWorkerConfigForTests();
  vi.restoreAllMocks();
});

describe("Project Runtime Bridge resources", () => {
  it.each([false, true])("emits no Kubernetes network policies (OCP=%s)", (openshift) => {
    const config = developmentWorkerConfig();
    config.openshift.enabled = openshift;
    setWorkerConfigForTests(config);
    expect(projectRuntimeBridgeResources(input, configuration).map(r => r.kind))
      .toEqual(["Secret", "Service", "Deployment"]);
  });

  it("creates one isolated stateless proxy service without persistent storage", () => {
    const resources = projectRuntimeBridgeResources(input, configuration);
    expect(resources.map((resource) => resource.kind)).toEqual([
      "Secret",
      "Service",
      "Deployment",
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
        readinessProbe: {
          httpGet: { path: "/readyz", port: "http" },
          timeoutSeconds: 3,
          failureThreshold: 1,
        },
        livenessProbe: { httpGet: { path: "/healthz", port: "http" } },
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
  });

  it("rejects a Control endpoint outside the in-cluster Service boundary", () => {
    expect(() => projectRuntimeBridgeResources(
      { ...input, controlUrl: "https://control.example.com" },
      configuration,
    )).toThrow("in-cluster HTTP Service FQDN");
  });

  it("waits for the applied Deployment generation to become available", async () => {
    const objects = { patch: vi.fn(async () => ({})), read: vi.fn(async () => serviceFor()) };
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

    expect(objects.patch).toHaveBeenCalledTimes(3);
    expect(apps.readNamespacedDeployment).toHaveBeenCalledWith({
      name: PROJECT_RUNTIME_BRIDGE_NAME,
      namespace: input.namespace,
    });
  });

  it("reconciles OCP resources idempotently with Namespace ownership and no Expert rollout", async () => {
    const config = developmentWorkerConfig();
    config.openshift.enabled = true;
    setWorkerConfigForTests(config);
    const owner = { apiVersion: "v1", kind: "Namespace", name: input.namespace, uid: "tenant-uid" };
    vi.spyOn(await import("./project-resource-ownership"), "readProjectNamespaceOwner")
      .mockResolvedValue(owner);
    vi.spyOn(await import("./project-image-pull-readiness"), "prepareRuntimeImagePull")
      .mockResolvedValue(configuration.imagePullSecrets);
    const objects = { patch: vi.fn(async () => ({})), read: vi.fn(async () => serviceFor()) };
    const apps = { readNamespacedDeployment: vi.fn(async () => ({
      metadata: { generation: 2 }, status: { observedGeneration: 2, availableReplicas: 1 },
    })) };
    const client = new KubernetesProjectRuntimeBridgeClient(
      { ...configuration, enabled: true }, objects as never, apps as never,
    );
    await client.reconcile(input);
    await client.reconcile(input);
    const calls = objects.patch.mock.calls as unknown as Array<[import("@kubernetes/client-node").KubernetesObject]>;
    expect(calls).toHaveLength(6);
    expect(calls.slice(0, 3)).toEqual(calls.slice(3));
    expect(calls.every(([r]) => r.metadata?.namespace === input.namespace
      && r.metadata?.ownerReferences?.[0]?.uid === owner.uid)).toBe(true);
    expect(calls.some(([r]) => r.kind === "NetworkPolicy")).toBe(false);
    expect(calls.filter(([r]) => r.kind === "Deployment")
      .every(([r]) => r.metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME)).toBe(true);
  });
});
