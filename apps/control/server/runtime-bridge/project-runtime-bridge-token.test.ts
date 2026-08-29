import { describe, expect, it } from "vitest";
import {
  signProjectRuntimeBridgeToken,
  signProjectRuntimeCoordinatorToken,
  verifyProjectRuntimeBridgeToken,
  verifyProjectRuntimeCoordinatorToken,
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
