import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { V1Namespace } from "@kubernetes/client-node";
import { createTestPrisma } from "../test/prisma";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import { projectRuntimeNamespace } from "./project-runtime-identity";
import { ProjectNamespaceCheckService } from "./project-namespace-check";

describe("Project Namespace live check", () => {
  let db: ReturnType<typeof createTestPrisma>;
  const namespace = projectRuntimeNamespace("individual");
  let observed: V1Namespace;
  beforeEach(async () => {
    const config = developmentControlConfig();
    config.runtime_namespaces.enabled = true;
    setControlConfigForTests(config);
    db = createTestPrisma();
    await db.projectRuntimeTarget.create({ data: {
      projectId: "individual", namespace, clusterId: config.runtime_namespaces.cluster_id, status: "ready",
    } });
    observed = {
      metadata: { name: namespace, annotations: { "tali.io/project-id": "individual", "tali.io/project-name": "admin" }, labels: {
        "app.kubernetes.io/managed-by": "tali", "app.kubernetes.io/part-of": "tali",
        "tali.io/runtime-target": "true", "tali.io/project-name": "admin",
      } }, status: { phase: "Active" },
    };
  });
  afterEach(async () => { await db.$disconnect(); setControlConfigForTests(undefined); });

  it("verifies the live Namespace without mutating recorded initialization", async () => {
    const read = vi.fn(async () => observed);
    const result = await new ProjectNamespaceCheckService(db, read).check("individual");
    expect(result.healthy).toBe(true);
    expect(result.checks).toHaveLength(6);
    expect(read).toHaveBeenCalledWith(namespace);
  });
  it.each([404, 403, 500])("reports Kubernetes %s even when the database says ready", async (code) => {
    const read = vi.fn(async () => { throw { code }; });
    const result = await new ProjectNamespaceCheckService(db, read).check("individual");
    expect(result.healthy).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({ id: "namespace", status: code === 404 ? "failed" : "unavailable" });
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId: "individual" } })).toMatchObject({ status: "ready", generation: 1 });
  });
  it("rejects another Project's Namespace ownership", async () => {
    observed.metadata!.annotations!["tali.io/project-id"] = "another-project";
    const result = await new ProjectNamespaceCheckService(db, async () => observed).check("individual");
    expect(result.healthy).toBe(false);
    expect(result.checks.find((check) => check.id === "owner")?.status).toBe("failed");
  });
  it("reports terminating Namespaces and missing management metadata", async () => {
    observed.metadata!.deletionTimestamp = new Date();
    observed.metadata!.labels = {};
    const result = await new ProjectNamespaceCheckService(db, async () => observed).check("individual");
    expect(result.checks.filter((check) => check.status === "failed").map((check) => check.id)).toEqual(["phase", "metadata"]);
  });
  it.each(["clusterId", "namespace"] as const)("does not read Kubernetes when the target %s is wrong", async (field) => {
    await db.projectRuntimeTarget.update({ where: { projectId: "individual" }, data: { [field]: "wrong-target" } });
    const read = vi.fn(async () => observed);
    const result = await new ProjectNamespaceCheckService(db, read).check("individual");
    expect(result.healthy).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("reports a missing runtime mapping", async () => {
    await db.projectRuntimeTarget.delete({ where: { projectId: "individual" } });
    const result = await new ProjectNamespaceCheckService(db, async () => observed).check("individual");
    expect(result.checks.find((check) => check.id === "target")?.status).toBe("failed");
    expect(result.healthy).toBe(false);
  });
});
