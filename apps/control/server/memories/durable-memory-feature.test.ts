import { describe, expect, it } from "vitest";
import { durableMemoryEnabledForProject } from "./durable-memory-feature";

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
});
