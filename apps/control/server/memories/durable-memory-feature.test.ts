import { describe, expect, it } from "vitest";
import {
  DurableMemoryEmbeddingRequiredError,
  assertDurableMemoryAvailableForProject,
  durableMemoryAvailableForProject,
  durableMemoryEnabledForProject,
} from "./durable-memory-feature";

describe("Durable Memory feature rollout", () => {
  it("defaults on because Hindsight is the default production provider", () => {
    expect(durableMemoryEnabledForProject("project-a", { enabled: true, projectAllowlist: [] })).toBe(true);
  });

  it("can be disabled for an environment without changing Project data", () => {
    expect(durableMemoryEnabledForProject("project-a", {
      enabled: false,
      projectAllowlist: [],
    })).toBe(false);
  });

  it("uses a Project allowlist as the gradual rollout boundary", () => {
    const environment = {
      enabled: true,
      projectAllowlist: ["project-a", "project-c"],
    };
    expect(durableMemoryEnabledForProject("project-a", environment)).toBe(true);
    expect(durableMemoryEnabledForProject("project-b", environment)).toBe(false);
  });

  it("does not let an allowlist bypass the master switch", () => {
    expect(durableMemoryEnabledForProject("project-a", {
      enabled: false, projectAllowlist: ["project-a"],
    })).toBe(false);
  });

  it("requires a validated embedding model in the effective Project inventory", async () => {
    const unavailableStore = { listModelDeployments: async () => [] };
    const availableStore = {
      listModelDeployments: async () => [{
        modelType: "text-embedding",
        status: "VALIDATED",
      }],
    };

    await expect(durableMemoryAvailableForProject(
      "project-a",
      unavailableStore,
      { enabled: true, projectAllowlist: [] },
    )).resolves.toBe(false);
    await expect(durableMemoryAvailableForProject(
      "project-a",
      availableStore,
      { enabled: true, projectAllowlist: [] },
    )).resolves.toBe(true);
    await expect(assertDurableMemoryAvailableForProject(
      "project-a",
      unavailableStore,
      { enabled: true, projectAllowlist: [] },
    )).rejects.toBeInstanceOf(DurableMemoryEmbeddingRequiredError);
  });
});
