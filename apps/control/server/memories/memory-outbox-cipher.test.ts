import { describe, expect, it } from "vitest";
import { MemoryOutboxCipher } from "./memory-outbox-cipher";

describe("MemoryOutboxCipher", () => {
  it("authenticates the Project, Memory, and idempotency scope", () => {
    const secret = () => "test-memory-outbox-secret-with-32-characters";
    const cipher = new MemoryOutboxCipher("project-a", secret);
    const envelope = cipher.encrypt(
      { text: "private conversation" },
      "memory-a",
      "retain-a",
    );

    expect(envelope).not.toContain("private conversation");
    expect(cipher.decrypt(envelope, "memory-a", "retain-a")).toEqual({
      text: "private conversation",
    });
    expect(() => cipher.decrypt(envelope, "memory-b", "retain-a")).toThrow();
    expect(() =>
      new MemoryOutboxCipher("project-b", secret).decrypt(
        envelope,
        "memory-a",
        "retain-a",
      )
    ).toThrow();
  });
});
