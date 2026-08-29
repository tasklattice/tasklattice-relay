import { describe, expect, it } from "vitest";
import { HindsightMemoryProvider } from "./hindsight-memory-provider";
import { createMemoryProvider } from "./memory-provider-factory";

describe("createMemoryProvider", () => {
  it("uses Hindsight as the only production default", () => {
    const provider = createMemoryProvider({
      hindsight: {
        baseUrl: "http://hindsight.internal:8888",
        apiKey: "test-only-key",
      },
    });
    expect(provider).toBeInstanceOf(HindsightMemoryProvider);
    expect(provider.kind).toBe("hindsight");
  });

  it("rejects unreviewed provider configuration", () => {
    expect(() => createMemoryProvider({
      provider: "fake",
      hindsight: {
        baseUrl: "http://hindsight.internal:8888",
        apiKey: "test-only-key",
      },
    })).toThrow("Unsupported Memory provider configuration: fake.");
  });
});
