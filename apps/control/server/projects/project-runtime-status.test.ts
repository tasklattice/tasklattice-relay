import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrisma } from "../test/prisma";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import { projectRuntimeNamespace } from "./project-runtime-identity";
import { ProjectRuntimeStatusService } from "./project-runtime-status";

describe("manual Project reinitialization", () => {
  let db: ReturnType<typeof createTestPrisma>;
  const jobs = {
    start: vi.fn(async () => {}),
    enqueueProjectRuntimeReconcile: vi.fn(async () => "job-id"),
    enqueueProjectDeletion: vi.fn(async () => "deletion-job-id"),
  };
  let service: ProjectRuntimeStatusService;
  beforeEach(async () => {
    vi.clearAllMocks();
    const config = developmentControlConfig(); config.runtime_namespaces.enabled = true;
    setControlConfigForTests(config);
    db = createTestPrisma();
    await db.projectRuntimeTarget.create({ data: {
      projectId: "individual", namespace: projectRuntimeNamespace("individual"),
      clusterId: config.runtime_namespaces.cluster_id, status: "ready", observedGeneration: 1,
    } });
    service = new ProjectRuntimeStatusService(db, jobs);
  });
  afterEach(async () => { await db.$disconnect(); setControlConfigForTests(undefined); });
  it("queues a new generation for a previously ready Project, coalescing repeated requests", async () => {
    expect(await service.reinitialize("individual")).toMatchObject({ status: "pending", generation: 2, observedGeneration: 1 });
    expect(await service.reinitialize("individual")).toMatchObject({ status: "pending", generation: 2 });
    expect(jobs.enqueueProjectRuntimeReconcile).toHaveBeenCalledWith("individual", "manual", expect.anything());
  });
  it("retains the existing retry endpoint's no-op behavior for ready Projects", async () => {
    expect(await service.retry("individual")).toMatchObject({ status: "ready", generation: 1 });
    expect(jobs.enqueueProjectRuntimeReconcile).not.toHaveBeenCalled();
  });
  it("recreates a missing runtime mapping with the original Namespace identity", async () => {
    await db.projectRuntimeTarget.delete({ where: { projectId: "individual" } });
    expect(await service.reinitialize("individual")).toMatchObject({ status: "pending", generation: 1 });
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId: "individual" } })).toMatchObject({ namespace: projectRuntimeNamespace("individual") });
  });
  it("resets failure and retry backoff", async () => {
    await db.projectRuntimeTarget.update({ where: { projectId: "individual" }, data: { status: "failed", attempts: 4, lastError: "image pull failed", nextAttemptAt: new Date(Date.now() + 3600000) } });
    expect(await service.reinitialize("individual")).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect((await db.projectRuntimeTarget.findUniqueOrThrow({ where: { projectId: "individual" } })).nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it("does not replace an active Worker lease", async () => {
    await db.projectRuntimeTarget.update({ where: { projectId: "individual" }, data: { leaseOwner: "worker", leaseExpiresAt: new Date(Date.now() + 60000) } });
    await expect(service.reinitialize("individual")).rejects.toMatchObject({ status: 409 });
    expect(jobs.enqueueProjectRuntimeReconcile).not.toHaveBeenCalled();
  });
  it("recovers an expired Worker lease", async () => {
    await db.projectRuntimeTarget.update({ where: { projectId: "individual" }, data: { status: "reconciling", leaseOwner: "worker", leaseExpiresAt: new Date(0) } });
    expect(await service.reinitialize("individual")).toMatchObject({ status: "pending", generation: 2 });
  });
  it("does not resurrect a deleted Project", async () => {
    await db.project.update({ where: { id: "individual" }, data: { deletedAt: new Date() } });
    await expect(service.reinitialize("individual")).rejects.toThrow("being deleted");
    expect(jobs.enqueueProjectRuntimeReconcile).not.toHaveBeenCalled();
  });
  it("rejects a different cluster instead of silently moving resources", async () => {
    await db.projectRuntimeTarget.update({ where: { projectId: "individual" }, data: { clusterId: "another-cluster" } });
    await expect(service.reinitialize("individual")).rejects.toMatchObject({ status: 409 });
    expect(jobs.enqueueProjectRuntimeReconcile).not.toHaveBeenCalled();
  });
});
