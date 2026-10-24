import type {
  V1Deployment,
  V1Secret,
  V1Service,
  V1NetworkPolicy,
} from "@kubernetes/client-node";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import {
  KubernetesProjectRuntimeBridgeClient,
  PROJECT_RUNTIME_BRIDGE_NAME,
  projectRuntimeBridgeResources,
} from "./project-runtime-bridge-client";

const input = {
  namespace: "tp-abcdefghijklm",
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

afterEach(() => {
  setWorkerConfigForTests();
  vi.restoreAllMocks();
});

describe("Project Runtime Bridge resources", () => {
  it("adds DNS access for already-running OCP runtimes without changing their policies", () => {
    const config = developmentWorkerConfig();
    config.openshift.enabled = true;
    setWorkerConfigForTests(config);
    const resources = projectRuntimeBridgeResources(input, configuration);
    const dns = resources.find((r) => r.metadata?.name === "tali-runtime-dns") as V1NetworkPolicy;
    expect(dns.metadata?.namespace).toBe(input.namespace);
    expect(dns.spec).toEqual({
      podSelector: {
        matchLabels: { "app.kubernetes.io/managed-by": "tali" },
        matchExpressions: [{ key: "app.kubernetes.io/name", operator: "In",
          values: [PROJECT_RUNTIME_BRIDGE_NAME, "tali-expert-agent"] }],
      },
      policyTypes: ["Egress"],
      egress: [{ ports: [
        { port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" },
        { port: 5353, protocol: "UDP" }, { port: 5353, protocol: "TCP" },
      ] }],
    });
    // Re-entry emits the same stable object; no per-Agent resource is modified.
    expect(projectRuntimeBridgeResources(input, configuration)).toEqual(resources);
    expect(resources.filter((r) => r.kind === "Deployment")).toHaveLength(1);
    config.openshift.enabled = false;
    setWorkerConfigForTests(config);
    expect(projectRuntimeBridgeResources(input, configuration)
      .some((r) => r.metadata?.name === "tali-runtime-dns")).toBe(false);
  });

  it.each([false, true])("allows the DNS backend ports for the configured cluster (OCP=%s)", (openshift) => {
    const config = developmentWorkerConfig();
    config.openshift.enabled = openshift;
    setWorkerConfigForTests(config);
    const policy = projectRuntimeBridgeResources(input, configuration)[3] as import("@kubernetes/client-node").V1NetworkPolicy;
    expect(policy.spec?.egress?.[0]?.ports).toEqual(
      (openshift ? [53, 5353] : [53]).flatMap((port) => [
        { port, protocol: "UDP" }, { port, protocol: "TCP" },
      ]),
    );
    expect(policy.spec?.podSelector?.matchLabels).toEqual({
      "app.kubernetes.io/name": PROJECT_RUNTIME_BRIDGE_NAME,
    });
  });

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

  it.each([
    ["http://relay-control.control-plane.svc.cluster.local", [80, 8080]],
    ["http://relay-control.control-plane.svc.cluster.local:8080", [8080]],
    ["http://relay-control.control-plane.svc.cluster.local:38080", [38080, 8080]],
  ])("allows Service and Pod ports in the actual Control namespace: %s", (controlUrl, ports) => {
    const policy = projectRuntimeBridgeResources({ ...input, controlUrl }, configuration)[3];
    expect(policy).toMatchObject({
      spec: {
        egress: [
          { ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] },
          {
            // Both selectors must match the same peer, not two OR'ed peers.
            to: [{
              namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "control-plane" } },
              podSelector: { matchLabels: { "app.kubernetes.io/component": "control" } },
            }],
            ports: ports.map((port) => ({ port, protocol: "TCP" })),
          },
        ],
      },
    });
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

  it("reconciles OCP DNS upgrades idempotently with Namespace ownership and no Expert rollout", async () => {
    const config = developmentWorkerConfig();
    config.openshift.enabled = true;
    setWorkerConfigForTests(config);
    const owner = { apiVersion: "v1", kind: "Namespace", name: input.namespace, uid: "tenant-uid" };
    vi.spyOn(await import("./project-resource-ownership"), "readProjectNamespaceOwner")
      .mockResolvedValue(owner);
    vi.spyOn(await import("./project-image-pull-readiness"), "prepareRuntimeImagePull")
      .mockResolvedValue(configuration.imagePullSecrets);
    const objects = { patch: vi.fn(async () => ({})) };
    const apps = { readNamespacedDeployment: vi.fn(async () => ({
      metadata: { generation: 2 }, status: { observedGeneration: 2, availableReplicas: 1 },
    })) };
    const client = new KubernetesProjectRuntimeBridgeClient(
      { ...configuration, enabled: true }, objects as never, apps as never,
    );
    await client.reconcile(input);
    await client.reconcile(input);
    const calls = objects.patch.mock.calls as unknown as Array<[import("@kubernetes/client-node").KubernetesObject]>;
    expect(calls).toHaveLength(10);
    expect(calls.slice(0, 5)).toEqual(calls.slice(5));
    expect(calls.every(([r]) => r.metadata?.namespace === input.namespace
      && r.metadata?.ownerReferences?.[0]?.uid === owner.uid)).toBe(true);
    expect(calls.filter(([r]) => r.metadata?.name === "tali-runtime-dns")).toHaveLength(2);
    expect(calls.filter(([r]) => r.kind === "Deployment")
      .every(([r]) => r.metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME)).toBe(true);
  });
});
