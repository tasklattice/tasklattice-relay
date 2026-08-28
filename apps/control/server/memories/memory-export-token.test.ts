import { describe, expect, it } from "vitest";
import { signMemoryExportToken, verifyMemoryExportToken } from "./memory-export-token";

const secret = "memory-export-test-secret-at-least-32-characters";
const identity = { actorId: "actor-a", memoryId: "memory-a", projectId: "project-a" };

describe("Memory export authorization", () => {
  it("is scoped to the actor, Project, Memory, and expiry", () => {
    const now = Date.parse("2026-08-28T00:00:00.000Z");
    const signed = signMemoryExportToken({ ...identity, ttlSeconds: 60 }, secret, now);
    expect(verifyMemoryExportToken(signed.token, identity, secret, now)).toMatchObject(identity);
    expect(() => verifyMemoryExportToken(
      signed.token,
      { ...identity, memoryId: "memory-b" },
      secret,
      now,
    )).toThrow("invalid or expired");
    expect(() => verifyMemoryExportToken(signed.token, identity, secret, now + 61_000))
      .toThrow("invalid or expired");
  });

  it("rejects tampering without exposing claim details", () => {
    const signed = signMemoryExportToken(identity, secret);
    expect(() => verifyMemoryExportToken(`${signed.token}x`, identity, secret))
      .toThrow("invalid or expired");
  });
});
