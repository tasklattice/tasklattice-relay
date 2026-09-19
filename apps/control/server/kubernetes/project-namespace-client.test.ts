import { getWorkerConfig, setWorkerConfigForTests, developmentWorkerConfig } from "../config/worker-config";
import { getControlConfig, setControlConfigForTests } from "../config/control-config";
import { PatchStrategy, type V1Namespace } from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KubernetesProjectNamespaceClient } from "./project-namespace-client";

function apiError(code: number, message: string) {
  return { body: { message }, code };
}

function namespace(projectId: string, uid = "namespace-uid"): V1Namespace {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      annotations: { "tali.io/project-id": projectId },
      name: "tp-abcdefghijklm",
      uid,
    },
  };
}

function client(input?: {
  createNamespace?: ReturnType<typeof vi.fn>;
  deleteNamespace?: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
  readNamespace?: ReturnType<typeof vi.fn>;
}) {
  const core = {
    createNamespace: input?.createNamespace ?? vi.fn(async () => namespace("project-a")),
    deleteNamespace: input?.deleteNamespace ?? vi.fn(async () => ({})),
    readNamespace: input?.readNamespace ?? vi.fn(async () => namespace("project-a")),
  };
  const objects = {
    patch: input?.patch ?? vi.fn(async () => namespace("project-a")),
  };
  return {
    client: new KubernetesProjectNamespaceClient(
      core as never,
      objects as never,
    ),
    core,
    objects,
  };
}

const input = {
  namespace: "tp-abcdefghijklm",
  projectId: "project-a",
  projectName: "Customer Support",
};

describe("KubernetesProjectNamespaceClient", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds deployment-configured Argo visibility to an existing Project without recreating it", async () => {
    getWorkerConfig().resource_ownership.sourceTrackingId = "relay:apps/Deployment:tali/relay-control";
    getWorkerConfig().resource_ownership.installationId = "internal";
    const fake = client();
    await fake.client.reconcile(input);
    expect(fake.core.createNamespace).not.toHaveBeenCalled();
    expect(fake.core.deleteNamespace).not.toHaveBeenCalled();
    expect(fake.objects.patch).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        name: input.namespace,
        annotations: expect.objectContaining({
          "argocd.argoproj.io/tracking-id": "relay:apps/Deployment:tali/relay-control",
          "argocd.argoproj.io/installation-id": "internal",
          "argocd.argoproj.io/sync-options": "Prune=false,Delete=false",
        }),
      }),
    }), undefined, undefined, "tali-control-project-runtime", false, PatchStrategy.ServerSideApply);
    expect(fake.objects.patch.mock.calls[0]?.[0]?.metadata?.ownerReferences).toBeUndefined();
  });

  it("creates a missing Namespace through the typed Core API", async () => {
    const fake = client({
      readNamespace: vi.fn(async () => {
        throw apiError(404, "not found");
      }),
    });

    await expect(fake.client.reconcile(input)).resolves.toBeUndefined();

    expect(fake.core.createNamespace).toHaveBeenCalledWith({
      body: expect.objectContaining({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: expect.objectContaining({
          annotations: {
            "tali.io/project-id": "project-a",
            "tali.io/project-name": "Customer Support",
          },
          labels: expect.objectContaining({
            "tali.io/project-name": "customer-support",
          }),
          name: input.namespace,
        }),
      }),
    });
    expect(fake.objects.patch).not.toHaveBeenCalled();
  });

  it("server-side applies only Relay metadata to an owned Namespace", async () => {
    const fake = client();

    await expect(fake.client.reconcile(input)).resolves.toBeUndefined();

    expect(fake.objects.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: expect.objectContaining({ name: input.namespace }),
      }),
      undefined,
      undefined,
      "tali-control-project-runtime",
      false,
      PatchStrategy.ServerSideApply,
    );
  });

  it("refuses to adopt an existing Namespace owned by another Project", async () => {
    const fake = client({
      readNamespace: vi.fn(async () => namespace("project-b")),
    });

    await expect(fake.client.reconcile(input)).rejects.toThrow(
      "found Project project-b",
    );
    expect(fake.objects.patch).not.toHaveBeenCalled();
  });

  it("checks ownership after a concurrent create conflict", async () => {
    const readNamespace = vi
      .fn()
      .mockRejectedValueOnce(apiError(404, "not found"))
      .mockResolvedValueOnce(namespace("project-b"));
    const fake = client({
      createNamespace: vi.fn(async () => {
        throw apiError(409, "already exists");
      }),
      readNamespace,
    });

    await expect(fake.client.reconcile(input)).rejects.toThrow(
      "found Project project-b",
    );
    expect(fake.objects.patch).not.toHaveBeenCalled();
  });

  it("deletes with a Namespace UID precondition", async () => {
    const readNamespace = vi
      .fn()
      .mockResolvedValueOnce(namespace("project-a", "uid-a"))
      .mockRejectedValueOnce(apiError(404, "not found"));
    const fake = client({ readNamespace });

    await expect(
      fake.client.deleteAndWait(input.namespace, input.projectId, 10_000),
    ).resolves.toBeUndefined();

    expect(fake.core.deleteNamespace).toHaveBeenCalledWith({
      body: {
        apiVersion: "v1",
        kind: "DeleteOptions",
        preconditions: { uid: "uid-a" },
      },
      name: input.namespace,
    });
  });
});

afterEach(() => setControlConfigForTests(undefined));

afterEach(() => setWorkerConfigForTests(undefined));
