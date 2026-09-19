import { PatchStrategy, type V1Deployment, type V1Service } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
  KubernetesManagedAgentRuntimeClient,
  managedAgentRevisionKey,
  kubernetesMetadataLabel,
  managedAgentEndpoint,
  managedAgentResourceName,
  pinnedImageReference,
  type ManagedAgentRuntimeInput,
} from "./managed-agent-runtime-client";

const input: ManagedAgentRuntimeInput = {
  sourceType: "container-image",
  agentId: "agent-research-a",
  instanceId: "6ed68a7c-4b63-4c37-a0ce-51a189d567f0",
  projectId: "project-a",
  namespace: "tp-abcdefghijklm",
  name: "Research Agent",
  description: "Handles delegated research and source validation tasks.",
  category: "Research",
  owner: "Research Platform",
  tags: ["Research"],
  usageMode: "CALLABLE",
  image: "ghcr.io/acme/research-agent:v1.4.0",
  containerPort: 8_080,
  agentCardPath: "/.well-known/agent-card.json",
  imagePullSecretName: "registry-credentials",
  command: [],
  args: [],
};

function notFound(): never {
  throw { code: 404 };
}

function readyDeployment(): V1Deployment {
  return {
    metadata: { generation: 1 },
    status: { availableReplicas: 1, observedGeneration: 1 },
  };
}

describe("KubernetesManagedAgentRuntimeClient", () => {
  it("deploys a hardened service and pins the resolved image digest", async () => {
    const apps = {
      readNamespacedDeployment: vi.fn()
        .mockImplementationOnce(notFound)
        .mockResolvedValue(readyDeployment())
        .mockResolvedValue(readyDeployment()),
      deleteNamespacedDeployment: vi.fn(async () => ({})),
    };
    const core = {
      readNamespacedService: vi.fn(notFound),
      listNamespacedPod: vi.fn()
        .mockResolvedValueOnce({
          items: [{
            metadata: {
              name: "tali-a2a-old-6f8b7c9d4f-2nv4m",
              labels: {
                "tali.io/revision-key": managedAgentRevisionKey(input, input.image),
              },
            },
            spec: { containers: [{ name: "agent", image: input.image }] },
            status: {
              containerStatuses: [{
                name: "agent",
                ready: true,
                imageID: "docker-pullable://ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              }],
            },
          }],
        })
        .mockResolvedValueOnce({
          items: [
            {
              metadata: {
                name: "tali-a2a-old-6f8b7c9d4f-2nv4m",
                labels: {
                  "tali.io/revision-key": managedAgentRevisionKey(input, input.image),
                },
              },
              spec: { containers: [{ name: "agent", image: input.image }] },
              status: {
                containerStatuses: [{
                  name: "agent",
                  ready: true,
                  imageID: "docker-pullable://ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                }],
              },
            },
            {
              metadata: {
                name: "tali-a2a-pinned-7f9c8d0e5g-4px6n",
                labels: {
                  "tali.io/revision-key": managedAgentRevisionKey(
                    input,
                    "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  ),
                },
              },
              spec: {
                containers: [{
                  name: "agent",
                  image: "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                }],
              },
              status: {
                containerStatuses: [{
                  name: "agent",
                  ready: true,
                  imageID: "docker-pullable://ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                }],
              },
            },
          ],
        }),
      deleteNamespacedService: vi.fn(async () => ({})),
    };
    const objects = {
      patch: vi.fn(async (_resource: V1Deployment | V1Service) => ({})),
    };
    const client = new KubernetesManagedAgentRuntimeClient(
      apps as never,
      core as never,
      objects as never,
      100,
      1,
    );

    const result = await client.onboard(input);

    const resources = objects.patch.mock.calls.map(([resource]) => resource);
    const service = resources.find((resource) => resource.kind === "Service") as V1Service;
    const deployments = resources.filter((resource) => resource.kind === "Deployment") as V1Deployment[];
    expect(service).toMatchObject({
      metadata: {
        namespace: input.namespace,
        annotations: {
          "tali.io/agent-id": input.agentId,
          "tali.io/agent-name": input.name,
          "tali.io/instance-id": input.instanceId,
          "tali.io/project-id": input.projectId,
        },
      },
      spec: { type: "ClusterIP", ports: [{ port: 8_080, targetPort: "http" }] },
    });
    expect(deployments).toHaveLength(2);
    expect(deployments[0]?.spec?.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      imagePullSecrets: [{ name: "registry-credentials" }],
      securityContext: { seccompProfile: { type: "RuntimeDefault" } },
      containers: [{
        image: input.image,
        imagePullPolicy: "Always",
        readinessProbe: {
          httpGet: {
            path: "/.well-known/agent-card.json",
            port: "http",
            scheme: "HTTP",
          },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
      }],
    });
    expect(deployments[0]?.spec?.template.metadata?.labels).toMatchObject({
      "tali.io/revision-key": managedAgentRevisionKey(input, input.image),
    });
    expect(deployments[1]?.spec?.template.spec?.containers?.[0]).toMatchObject({
      image: "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      imagePullPolicy: "IfNotPresent",
    });
    expect(objects.patch).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      undefined,
      "tali-control-managed-agent",
      false,
      PatchStrategy.ServerSideApply,
    );
    expect(result).toMatchObject({
      endpoint: managedAgentEndpoint(
        input.namespace,
        managedAgentResourceName(input.instanceId),
        input.containerPort,
      ),
      imageDigest: "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      podName: "tali-a2a-pinned-7f9c8d0e5g-4px6n",
    });
  });

  it("waits for the current Pod template revision when the digest is unchanged", async () => {
    const image = "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const immutableInput = { ...input, image };
    const readyPod = {
      metadata: {
        name: "tali-a2a-current-8a0d9e1f6h-5qy7p",
        labels: {
          "tali.io/revision-key": managedAgentRevisionKey(
            immutableInput,
            image,
          ),
        },
      },
      spec: { containers: [{ name: "agent", image }] },
      status: {
        containerStatuses: [{
          name: "agent",
          ready: true,
          imageID: `docker-pullable://${image}`,
        }],
      },
    };
    const apps = {
      readNamespacedDeployment: vi.fn()
        .mockImplementationOnce(notFound)
        .mockResolvedValue(readyDeployment()),
      deleteNamespacedDeployment: vi.fn(),
    };
    const core = {
      readNamespacedService: vi.fn(notFound),
      listNamespacedPod: vi.fn()
        .mockResolvedValueOnce({
          items: [{
            ...readyPod,
            metadata: {
              name: "tali-a2a-previous-7f9c8d0e5g-4px6n",
              labels: { "tali.io/revision-key": "previous-revision" },
            },
          }],
        })
        .mockResolvedValueOnce({ items: [readyPod] }),
      deleteNamespacedService: vi.fn(),
    };
    const client = new KubernetesManagedAgentRuntimeClient(
      apps as never,
      core as never,
      { patch: vi.fn(async () => ({})) } as never,
      100,
      1,
    );

    const result = await client.onboard(immutableInput);

    expect(result.podName).toBe(readyPod.metadata.name);
    expect(core.listNamespacedPod).toHaveBeenCalledTimes(2);
  });

  it("refuses to adopt a resource with different ownership metadata", async () => {
    const apps = {
      readNamespacedDeployment: vi.fn(async () => ({
        metadata: {
          name: managedAgentResourceName(input.instanceId),
          annotations: {
            "tali.io/agent-id": "another-agent",
            "tali.io/instance-id": input.instanceId,
            "tali.io/project-id": input.projectId,
          },
        },
      })),
      deleteNamespacedDeployment: vi.fn(),
    };
    const core = {
      readNamespacedService: vi.fn(notFound),
      listNamespacedPod: vi.fn(),
      deleteNamespacedService: vi.fn(),
    };
    const objects = { patch: vi.fn() };
    const client = new KubernetesManagedAgentRuntimeClient(
      apps as never,
      core as never,
      objects as never,
    );

    await expect(client.onboard(input)).rejects.toThrow("ownership metadata");
    expect(objects.patch).not.toHaveBeenCalled();
  });

  it("deletes only resources owned by the Project Agent", async () => {
    const name = managedAgentResourceName(input.instanceId);
    const ownership = {
      "tali.io/agent-id": input.agentId,
      "tali.io/instance-id": input.instanceId,
      "tali.io/project-id": input.projectId,
    };
    const apps = {
      readNamespacedDeployment: vi.fn(async () => ({
        metadata: { name, annotations: ownership },
      })),
      deleteNamespacedDeployment: vi.fn(async () => ({})),
    };
    const core = {
      readNamespacedService: vi.fn(async () => ({
        metadata: { name, annotations: ownership },
      })),
      listNamespacedPod: vi.fn(),
      deleteNamespacedService: vi.fn(async () => ({})),
    };
    const client = new KubernetesManagedAgentRuntimeClient(
      apps as never,
      core as never,
      { patch: vi.fn() } as never,
    );

    await client.remove({
      agentId: input.agentId,
      instanceId: input.instanceId,
      namespace: input.namespace,
      projectId: input.projectId,
    });

    expect(apps.deleteNamespacedDeployment).toHaveBeenCalledWith({
      name,
      namespace: input.namespace,
      propagationPolicy: "Foreground",
    });
    expect(core.deleteNamespacedService).toHaveBeenCalledWith({
      name,
      namespace: input.namespace,
    });
  });
});

describe("Kubernetes managed A2A metadata", () => {
  it("uses a readable bounded label with a stable hash suffix", () => {
    const label = kubernetesMetadataLabel(
      "Research Agent / Customer Evidence with a deliberately long display name",
    );
    expect(label).toMatch(/^research-agent-customer-evidence/);
    expect(label).toMatch(/[a-f0-9]{10}$/);
    expect(label.length).toBeLessThanOrEqual(63);
  });
});

describe("pinnedImageReference", () => {
  it("preserves the requested repository while replacing a mutable tag", () => {
    expect(pinnedImageReference(
      "registry.example.com:5000/team/agent:latest",
      "containerd://registry.example.com:5000/team/agent@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )).toBe(
      "registry.example.com:5000/team/agent@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("keeps an already immutable image reference", () => {
    const image = "ghcr.io/acme/agent@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    expect(pinnedImageReference(image, undefined)).toBe(image);
  });
});
