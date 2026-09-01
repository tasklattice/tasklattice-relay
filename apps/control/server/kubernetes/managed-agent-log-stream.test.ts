import type { A2aAgentInstance } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import { KubernetesManagedAgentLogStream } from "./managed-agent-log-stream";

const instance: A2aAgentInstance = {
  id: "c70149f6-7dc5-40e2-b0d3-4f2f548ea728",
  agentId: "managed-github-daily-triage-fb53a856",
  kind: "A2A",
  name: "GitHub Daily Triage",
  description: "A managed A2A specialist used for delegated GitHub triage tasks.",
  runtime: "kubernetes",
  status: "READY",
  runtimeNamespace: "tp-pcpaznt4ypgomhwn",
  deploymentName: "tali-a2a-12156ad3de4f83e7",
  serviceName: "tali-a2a-12156ad3de4f83e7",
  podName: "tali-a2a-12156ad3de4f83e7-7954479887-6ntc2",
  labelSelector: "tali.io/instance-key=managed",
  imageReference: "python:3.13-slim",
  imageDigest: "python@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  endpoint: "http://tali-a2a.tp.svc.cluster.local:8080",
  agentCardUrl: "http://tali-a2a.tp.svc.cluster.local:8080/.well-known/agent-card.json",
  a2a: null,
  skills: [],
  createdAt: "2026-08-26T01:00:00.000Z",
  updatedAt: "2026-08-26T01:00:00.000Z",
  logs: [],
  error: null,
};

function ownedPod(projectId = "isolation-1") {
  return {
    metadata: {
      annotations: {
        "tali.io/project-id": projectId,
        "tali.io/agent-id": instance.agentId,
        "tali.io/instance-id": instance.id,
      },
      labels: { "tali.io/runtime-kind": "managed-a2a" },
    },
    spec: { containers: [{ name: "agent" }] },
  };
}

describe("KubernetesManagedAgentLogStream", () => {
  it("verifies Pod ownership, follows the agent container, and redacts secrets", async () => {
    const controller = new AbortController();
    const core = { readNamespacedPod: vi.fn(async () => ownedPod()) };
    const logs = {
      log: vi.fn(async (_namespace, _pod, _container, stream) => {
        stream.write("2026-08-26 authorization=Bearer-secret\n");
        stream.write("2026-08-26 request complete\n");
        return controller;
      }),
    };
    const output: string[] = [];
    const client = new KubernetesManagedAgentLogStream(core as never, logs as never);
    const handle = await client.open(
      "isolation-1",
      instance,
      { tailLines: 300, timestamps: true, previous: false },
      { onData: (data) => output.push(data), onError: vi.fn(), onEnd: vi.fn() },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(core.readNamespacedPod).toHaveBeenCalledWith({
      name: instance.podName,
      namespace: instance.runtimeNamespace,
    });
    expect(logs.log).toHaveBeenCalledWith(
      instance.runtimeNamespace,
      instance.podName,
      "agent",
      expect.anything(),
      { follow: true, previous: false, tailLines: 300, timestamps: true },
    );
    expect(output.join("")).toContain("authorization=[REDACTED]");
    expect(output.join("")).toContain("request complete");
    handle.close();
    expect(controller.signal.aborted).toBe(true);
  });

  it("refuses a Pod from another Project before opening its logs", async () => {
    const core = { readNamespacedPod: vi.fn(async () => ownedPod("another-project")) };
    const logs = { log: vi.fn() };
    const client = new KubernetesManagedAgentLogStream(core as never, logs as never);

    await expect(client.open(
      "isolation-1",
      instance,
      { tailLines: 50, timestamps: true, previous: false },
      { onData: vi.fn(), onError: vi.fn(), onEnd: vi.fn() },
    )).rejects.toThrow("ownership metadata");
    expect(logs.log).not.toHaveBeenCalled();
  });

  it("resolves and follows an Agent Developer runtime without weakening ownership checks", async () => {
    const controller = new AbortController();
    const core = {
      listNamespacedPod: vi.fn(async () => ({
        items: [{
          metadata: {
            name: "tali-expert-a1b2c3-7d9f",
            annotations: {
              "tali.io/project-id": "isolation-1",
              "tali.io/agent-id": "6bf695e2-55c9-49d3-a54d-e5818eea6318",
            },
            labels: { "tali.io/runtime-kind": "expert-agent-a2a" },
          },
          spec: { containers: [{ name: "expert-agent" }] },
          status: { phase: "Running" },
        }],
      })),
    };
    const logs = {
      log: vi.fn(async () => controller),
    };
    const client = new KubernetesManagedAgentLogStream(core as never, logs as never);
    const handle = await client.openProjectAgent(
      "isolation-1",
      {
        agentId: "6bf695e2-55c9-49d3-a54d-e5818eea6318",
        namespace: "tp-pcpaznt4ypgomhwn",
        workloadName: "tali-expert-a1b2c3",
      },
      { tailLines: 100, timestamps: true, previous: false },
      { onData: vi.fn(), onError: vi.fn(), onEnd: vi.fn() },
    );

    expect(core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: "tp-pcpaznt4ypgomhwn",
      labelSelector: "app.kubernetes.io/instance=tali-expert-a1b2c3",
    });
    expect(logs.log).toHaveBeenCalledWith(
      "tp-pcpaznt4ypgomhwn",
      "tali-expert-a1b2c3-7d9f",
      "expert-agent",
      expect.anything(),
      { follow: true, previous: false, tailLines: 100, timestamps: true },
    );
    handle.close();
  });
});
