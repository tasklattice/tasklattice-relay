import { describe, expect, it, vi } from "vitest";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import type { RunnerClient } from "../runtime/nemoclaw-runner-client";
import { createTestPrisma } from "../test/prisma";
import { MemoryRepository } from "../memories/memory-repository";
import { MemoryService } from "../memories/memory-service";
import { FakeMemoryProvider } from "../memories/testing/fake-memory-provider";
import {
  PROJECT_DELETION_GRACE_PERIOD_MS,
  ProjectDeletionService,
  type ProjectRuntimeTargetCleanup,
} from "./project-deletion-service";

function deletionDependencies() {
  const destroySandbox = vi.fn(async () => ({ phase: "NOT_FOUND" }));
  const revokeKey = vi.fn(async () => undefined);
  const deleteProjectTeam = vi.fn(async () => undefined);
  return {
    deleteProjectTeam,
    destroySandbox,
    litellm: {
      baseUrl: "http://litellm.test",
      deleteProjectTeam,
      revokeKey,
    } as unknown as LiteLLMAdminClient,
    revokeKey,
    runner: { destroySandbox } as unknown as RunnerClient,
  };
}

describe("ProjectDeletionService", () => {
  it("destroys runtime resources and keeps business tombstones", async () => {
    const db = createTestPrisma();
    const dependencies = deletionDependencies();
    const requestedAt = new Date("2026-08-15T08:00:00.000Z");
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: requestedAt, deletedBy: "local-admin" },
    });
    const scheduledFor = new Date(
      requestedAt.getTime() + PROJECT_DELETION_GRACE_PERIOD_MS,
    );
    await db.projectDeletionTask.create({
      data: {
        projectId: "individual",
        nextAttemptAt: scheduledFor,
        scheduledFor,
        status: "running",
      },
    });
    await db.agentRecord.create({
      data: {
        projectId: "individual",
        id: "cleanup-agent",
        ownerUserId: "local-admin",
        createdAt: requestedAt,
        payload: {
          agentPlatform: "openclaw",
          id: "cleanup-agent",
          liteLLMTokenId: "instance-key-1",
          name: "Cleanup Agent",
          sandboxName: "tali-cleanup-agent",
          status: "READY",
        },
      },
    });
    await db.projectQuotaRecord.update({
      where: { projectId: "individual" },
      data: { litellmTeamId: "project-team-1" },
    });
    const memoryProvider = new FakeMemoryProvider();
    const memoryService = new MemoryService(
      new MemoryRepository("individual", db),
      () => memoryProvider,
      () => "project-cleanup-test-secret-with-32-characters",
    );
    const preparedMemory = await memoryService.prepareForAgent({
      actorId: "local-admin",
      displayName: "Cleanup Agent",
      instanceId: "cleanup-agent",
      requestIdempotencyKey: "project-cleanup-memory",
      runtimeType: "openclaw",
    });
    const deleteProjectNamespace = vi.fn(async () => true);
    const service = new ProjectDeletionService(
      db,
      dependencies.runner,
      dependencies.litellm,
      {
        externalCleanupEnabled: true,
        memoryServiceFactory: () => memoryService,
      },
      {
        deleteProjectNamespace,
      } satisfies ProjectRuntimeTargetCleanup,
    );

    await expect(service.purge("individual")).resolves.toBe(true);
    expect(dependencies.destroySandbox).toHaveBeenCalledWith(
      "tali-cleanup-agent",
      "openclaw",
    );
    expect(dependencies.revokeKey).toHaveBeenCalledWith("instance-key-1");
    expect(dependencies.deleteProjectTeam).toHaveBeenCalledWith("project-team-1");
    expect(deleteProjectNamespace).toHaveBeenCalledWith("individual");
    expect(memoryProvider.hasBank(preparedMemory.memory.providerRef!)).toBe(false);
    await expect(db.memoryRecord.findUnique({
      where: {
        projectId_id: {
          projectId: "individual",
          id: preparedMemory.memory.id,
        },
      },
    })).resolves.toMatchObject({ status: "deleted", providerRef: null });
    await expect(db.memoryBinding.findUnique({
      where: {
        projectId_id: {
          projectId: "individual",
          id: preparedMemory.binding.id,
        },
      },
    })).resolves.toMatchObject({ status: "detached" });
    await expect(db.project.findUnique({ where: { id: "individual" } }))
      .resolves.toMatchObject({ deletedAt: requestedAt });
    await expect(db.agentRecord.count({ where: { projectId: "individual" } }))
      .resolves.toBe(1);
    await expect(db.agentRecord.findUnique({
      where: {
        projectId_id: { projectId: "individual", id: "cleanup-agent" },
      },
    })).resolves.toMatchObject({ deletedAt: requestedAt });
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({
      leaseExpiresAt: null,
      leaseOwner: null,
      status: "completed",
    });
  });

  it("keeps the tombstone when external cleanup fails", async () => {
    const db = createTestPrisma();
    const requestedAt = new Date("2026-08-15T08:00:00.000Z");
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: requestedAt, deletedBy: "local-admin" },
    });
    const scheduledFor = new Date(
      requestedAt.getTime() + PROJECT_DELETION_GRACE_PERIOD_MS,
    );
    await db.projectDeletionTask.create({
      data: {
        projectId: "individual",
        nextAttemptAt: scheduledFor,
        scheduledFor,
      },
    });
    await db.agentRecord.create({
      data: {
        projectId: "individual",
        id: "retry-agent",
        ownerUserId: "local-admin",
        createdAt: requestedAt,
        payload: {
          agentPlatform: "openclaw",
          id: "retry-agent",
          name: "Retry Agent",
          sandboxName: "tali-retry-agent",
          status: "READY",
        },
      },
    });
    const runner = {
      destroySandbox: vi.fn(async () => {
        throw new Error("Runner unavailable");
      }),
    } as unknown as RunnerClient;
    const service = new ProjectDeletionService(
      db,
      runner,
      deletionDependencies().litellm,
      { externalCleanupEnabled: false },
    );

    await expect(service.purge("individual")).rejects.toThrow(
      "Runner unavailable",
    );
    await expect(db.project.findUnique({ where: { id: "individual" } }))
      .resolves.toMatchObject({ deletedAt: requestedAt });
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({
      attempts: 0,
      status: "scheduled",
    });
  });

  it("keeps Project cleanup retryable until provider Bank absence is verified", async () => {
    const db = createTestPrisma();
    const requestedAt = new Date("2026-08-15T08:00:00.000Z");
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: requestedAt, deletedBy: "local-admin" },
    });
    await db.projectDeletionTask.create({
      data: {
        projectId: "individual",
        nextAttemptAt: requestedAt,
        scheduledFor: requestedAt,
      },
    });
    const provider = new FakeMemoryProvider();
    const reference = await provider.createMemory({
      projectId: "individual",
      memoryId: "00000000-0000-4000-8000-000000000099",
      displayName: "Project teardown Memory",
      idempotencyKey: "project-teardown-memory",
    });
    const memory = await db.memoryRecord.create({
      data: {
        projectId: "individual",
        displayName: "Project teardown Memory",
        idempotencyKey: "project-teardown-memory",
        provider: provider.kind,
        providerRef: reference.providerRef,
        status: "unbound",
      },
    });
    const memoryService = new MemoryService(
      new MemoryRepository("individual", db),
      () => provider,
      () => "project-cleanup-test-secret-with-32-characters",
    );
    const deleteProjectNamespace = vi.fn(async () => true);
    const service = new ProjectDeletionService(
      db,
      deletionDependencies().runner,
      deletionDependencies().litellm,
      {
        externalCleanupEnabled: false,
        memoryServiceFactory: () => memoryService,
      },
      { deleteProjectNamespace },
    );

    provider.setUnavailable(true);
    await expect(service.purge("individual")).rejects.toThrow(
      "temporarily unavailable",
    );
    expect(provider.hasBank(reference.providerRef)).toBe(true);
    expect(deleteProjectNamespace).not.toHaveBeenCalled();
    await expect(db.memoryRecord.findUnique({
      where: { projectId_id: { projectId: "individual", id: memory.id } },
    })).resolves.toMatchObject({ status: "deletion_failed" });
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({ status: "scheduled" });

    provider.setUnavailable(false);
    await db.projectDeletionTask.update({
      where: { projectId: "individual" },
      data: { status: "running" },
    });
    await expect(service.purge("individual")).resolves.toBe(true);
    expect(provider.hasBank(reference.providerRef)).toBe(false);
    expect(deleteProjectNamespace).toHaveBeenCalledWith("individual");
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({ status: "completed" });
  });
});
