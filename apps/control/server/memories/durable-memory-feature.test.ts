import { describe, expect, it } from "vitest";
import {
  DurableMemoryEmbeddingRequiredError,
  assertDurableMemoryAvailableForProject,
  durableMemoryAvailableForProject,
  durableMemoryEnabledForProject,
} from "./durable-memory-feature";

describe("Durable Memory feature rollout", () => {
  it("defaults on because Hindsight is the default production provider", () => {
    expect(durableMemoryEnabledForProject("project-a", {})).toBe(true);
  });

  it("can be disabled for an environment without changing Project data", () => {
    expect(durableMemoryEnabledForProject("project-a", {
      TALI_DURABLE_MEMORY_ENABLED: "false",
    })).toBe(false);
  });

  it("uses a Project allowlist as the gradual rollout boundary", () => {
    const environment = {
      TALI_DURABLE_MEMORY_ENABLED: "true",
      TALI_DURABLE_MEMORY_PROJECTS: "project-a, project-c",
    };
    expect(durableMemoryEnabledForProject("project-a", environment)).toBe(true);
    expect(durableMemoryEnabledForProject("project-b", environment)).toBe(false);
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
      {},
    )).resolves.toBe(false);
    await expect(durableMemoryAvailableForProject(
      "project-a",
      availableStore,
      {},
    )).resolves.toBe(true);
    await expect(assertDurableMemoryAvailableForProject(
      "project-a",
      unavailableStore,
      {},
    )).rejects.toBeInstanceOf(DurableMemoryEmbeddingRequiredError);
  });
});
