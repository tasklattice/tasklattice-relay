import { describe, expect, it } from "vitest";
import {
  deriveProjectRuntimeExpertAgentA2aToken,
  signProjectRuntimeBridgeToken,
  signProjectRuntimeCoordinatorToken,
  signProjectRuntimeExpertAgentToken,
  verifyProjectRuntimeBridgeToken,
  verifyProjectRuntimeCoordinatorToken,
  verifyProjectRuntimeExpertAgentToken,
} from "./project-runtime-bridge-token";

describe("Project Runtime Bridge token", () => {
  it("round-trips a Project and Namespace scoped identity", () => {
    const identity = {
      projectId: "project-a",
      namespace: "tp-abcdefghijklmnop",
    };
    const token = signProjectRuntimeBridgeToken(identity, "runner-secret");

    expect(verifyProjectRuntimeBridgeToken(token, "runner-secret"))
      .toEqual(identity);
    expect(() => verifyProjectRuntimeBridgeToken(token, "another-secret"))
      .toThrow("Invalid Project Runtime Bridge token");
  });

  it("rejects payload tampering", () => {
    const token = signProjectRuntimeBridgeToken(
      { projectId: "project-a", namespace: "tp-abcdefghijklmnop" },
      "runner-secret",
    );
    const [prefix, payload, signature] = token.split(".");
    const tampered = `${prefix}.${payload?.slice(0, -1)}x.${signature}`;

    expect(() => verifyProjectRuntimeBridgeToken(tampered, "runner-secret"))
      .toThrow("Invalid Project Runtime Bridge token");
  });
});

describe("Project Runtime Expert Agent token", () => {
  const identity = {
    projectId: "project-a",
    namespace: "tp-abcdefghijklmnop",
    agentId: "11111111-1111-4111-8111-111111111111",
    versionId: "22222222-2222-4222-8222-222222222222",
    contentDigest: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-09-01T00:00:00.000Z",
  };

  it("round-trips a version-pinned runtime identity", () => {
    const token = signProjectRuntimeExpertAgentToken(identity, "control-secret");
    expect(verifyProjectRuntimeExpertAgentToken(
      token,
      "control-secret",
      new Date("2026-08-30T00:00:00.000Z"),
    )).toEqual(identity);
    expect(() => verifyProjectRuntimeExpertAgentToken(
      token,
      "another-secret",
      new Date("2026-08-30T00:00:00.000Z"),
    )).toThrow("Invalid Expert Agent Runtime token");
  });

  it("expires without widening access to an old Version", () => {
    const token = signProjectRuntimeExpertAgentToken(identity, "control-secret");
    expect(() => verifyProjectRuntimeExpertAgentToken(
      token,
      "control-secret",
      new Date("2026-09-01T00:00:00.000Z"),
    )).toThrow("Expert Agent Runtime token has expired");
  });

  it("derives a stable A2A credential pinned to the exact Version", () => {
    const first = deriveProjectRuntimeExpertAgentA2aToken(identity, "control-secret");
    expect(first).toBe(deriveProjectRuntimeExpertAgentA2aToken(identity, "control-secret"));
    expect(first).toMatch(/^tali_a2a_v1_[A-Za-z0-9_-]+$/);
    expect(deriveProjectRuntimeExpertAgentA2aToken(
      { ...identity, versionId: "33333333-3333-4333-8333-333333333333" },
      "control-secret",
    )).not.toBe(first);
  });
});

describe("Project Runtime Coordinator token", () => {
  it("round-trips a Project, Namespace, Coordinator, and fixed Memory identity", () => {
    const identity = {
      projectId: "project-a",
      namespace: "tp-abcdefghijklmnop",
      coordinatorInstanceId: "11111111-1111-4111-8111-111111111111",
      memoryId: "22222222-2222-4222-8222-222222222222",
    };
    const token = signProjectRuntimeCoordinatorToken(identity, "runner-secret");

    expect(verifyProjectRuntimeCoordinatorToken(token, "runner-secret"))
      .toEqual(identity);
    expect(() => verifyProjectRuntimeCoordinatorToken(token, "another-secret"))
      .toThrow("Invalid Project Runtime Coordinator token");
  });

  it("keeps legacy coordinator credentials valid without granting Memory access", () => {
    const identity = {
      projectId: "project-a",
      namespace: "tp-abcdefghijklmnop",
      coordinatorInstanceId: "11111111-1111-4111-8111-111111111111",
    };
    const token = signProjectRuntimeCoordinatorToken(identity, "runner-secret");

    expect(verifyProjectRuntimeCoordinatorToken(token, "runner-secret"))
      .toEqual(identity);
  });

  it("rejects payload tampering", () => {
    const token = signProjectRuntimeCoordinatorToken({
      projectId: "project-a",
      namespace: "tp-abcdefghijklmnop",
      coordinatorInstanceId: "11111111-1111-4111-8111-111111111111",
    }, "runner-secret");
    const [prefix, payload, signature] = token.split(".");
    const tampered = `${prefix}.${payload?.slice(0, -1)}x.${signature}`;

    expect(() => verifyProjectRuntimeCoordinatorToken(tampered, "runner-secret"))
      .toThrow("Invalid Project Runtime Coordinator token");
  });
});
