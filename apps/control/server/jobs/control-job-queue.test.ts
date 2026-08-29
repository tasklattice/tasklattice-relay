import { describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import {
  CONTROL_JOB_QUEUES,
  PgBossControlJobQueue,
} from "./control-job-queue";

function bossClient(input?: { sendResult?: string | null }) {
  const createQueue = vi.fn(async () => undefined);
  const send = vi.fn(async () =>
    input?.sendResult === undefined
      ? "00000000-0000-4000-8000-000000000201"
      : input.sendResult
  );
  const start = vi.fn(async function (this: unknown) { return this; });
  const updateQueue = vi.fn(async () => undefined);
  return {
    boss: {
      createQueue,
      send,
      start,
      updateQueue,
    } as unknown as PgBoss,
    createQueue,
    send,
    start,
    updateQueue,
  };
}

describe("PgBossControlJobQueue", () => {
  it("creates durable queues and schedules Project deletion with its grace date", async () => {
    const fake = bossClient();
    const queue = new PgBossControlJobQueue(fake.boss);
    const scheduledFor = new Date("2026-08-27T10:00:00.000Z");

    await expect(queue.enqueueProjectDeletion("project-a", scheduledFor))
      .resolves.toBe("00000000-0000-4000-8000-000000000201");
    expect(fake.createQueue).toHaveBeenCalledWith(
      CONTROL_JOB_QUEUES.projectDeletion,
      expect.objectContaining({
        deadLetter: CONTROL_JOB_QUEUES.deadLetter,
        policy: "exclusive",
        retryBackoff: true,
        retryLimit: 25,
      }),
    );
    expect(fake.send).toHaveBeenCalledWith(
      CONTROL_JOB_QUEUES.projectDeletion,
      { projectId: "project-a" },
      expect.objectContaining({
        group: { id: "project-a" },
        priority: 100,
        singletonKey: "project-a",
        startAfter: scheduledFor,
      }),
    );
  });

  it("treats a duplicate Runtime reconciliation as already queued", async () => {
    const fake = bossClient({ sendResult: null });
    const queue = new PgBossControlJobQueue(fake.boss);

    await expect(queue.enqueueProjectRuntimeReconcile(
      "project-a",
      "periodic",
    )).resolves.toBeUndefined();
    expect(fake.send).toHaveBeenCalledWith(
      CONTROL_JOB_QUEUES.projectRuntimeReconcile,
      { projectId: "project-a", reason: "periodic" },
      expect.objectContaining({ singletonKey: "project-a" }),
    );
  });

  it("groups Vector Document ingestion by Project database and keys retries by ingestion job", async () => {
    const fake = bossClient();
    const queue = new PgBossControlJobQueue(fake.boss);
    const payload = {
      projectId: "project-a",
      databaseId: "research-vectors",
      ingestionJobId: "00000000-0000-4000-8000-000000000301",
    };

    await expect(queue.enqueueVectorDocumentIngestion(payload))
      .resolves.toBe("00000000-0000-4000-8000-000000000201");
    expect(fake.send).toHaveBeenCalledWith(
      CONTROL_JOB_QUEUES.vectorDocumentIngestion,
      payload,
      expect.objectContaining({
        group: { id: "project-a:research-vectors" },
        singletonKey: payload.ingestionJobId,
      }),
    );
  });

  it("serializes Instance lifecycle work per Instance and prioritizes deletion", async () => {
    const fake = bossClient();
    const queue = new PgBossControlJobQueue(fake.boss);
    const payload = {
      projectId: "project-a",
      instanceId: "00000000-0000-4000-8000-000000000401",
      operationId: "00000000-0000-4000-8000-000000000402",
      action: "delete" as const,
    };

    await expect(queue.enqueueInstanceLifecycle(payload))
      .resolves.toBe("00000000-0000-4000-8000-000000000201");
    expect(fake.send).toHaveBeenCalledWith(
      CONTROL_JOB_QUEUES.instanceLifecycle,
      payload,
      expect.objectContaining({
        group: { id: `${payload.projectId}:${payload.instanceId}` },
        priority: 90,
        singletonKey:
          `${payload.projectId}:${payload.instanceId}:${payload.action}`,
      }),
    );
  });
});
