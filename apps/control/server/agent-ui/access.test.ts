import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ find: vi.fn(), get: vi.fn(), target: vi.fn(), authorize: vi.fn(), owner: vi.fn() }));
vi.mock("../db/prisma", () => ({ prisma: () => ({ agentUiSession: { findUnique: mocks.find }, agentRecord: { findUnique: mocks.owner } }) }));
vi.mock("../services", () => ({ getInstanceServiceForProject: () => ({ store: { get: mocks.get }, runnerRuntimeTarget: mocks.target }) }));
vi.mock("../authorization/admission-control", () => ({ ProjectAdmissionService: class { authorize = mocks.authorize; } }));
import { validateAgentUiSession } from "./access";

const id = "11111111-1111-4111-8111-111111111111";
const credential = "a".repeat(43);
function record() { return { id, createdAt: new Date(), credentialHash: createHash("sha256").update(credential).digest("hex"), actorId: "user-a", authSessionId: "login-a", projectId: "project-a", instanceId: "instance-a", sandboxName: "sandbox-a", namespace: "project-a", platform: "hermes", generation: "created:operation-a", expiresAt: new Date(Date.now() + 60_000), authSession: { userId: "user-a", expiresAt: new Date(Date.now() + 60_000), user: { id: "user-a", status: "active" }, accessContext: { level: "PROJECT", resourceId: "project-a", roleId: "ROLE_PROJECT_ADMIN" } } }; }
describe("Agent access revocation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.find.mockResolvedValue(record());
    mocks.get.mockResolvedValue({ status: "READY", agentPlatform: "hermes", sandboxName: "sandbox-a", createdAt: "created", operationId: "operation-a" });
    mocks.target.mockResolvedValue({ namespace: "project-a" });
    mocks.owner.mockResolvedValue({ ownerUserId: "user-a", deletedAt: null });
  });
  it("reauthorizes every use against the original user and instance", async () => {
    await validateAgentUiSession(id, credential);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "user-a", "CAP_AGENT_INSTANCE_INTERACT", expect.objectContaining({ resourceId: "instance-a", relation: "OWNER" }), "admin");
  });
  it("rejects a guessed credential, missing login, expiry and disabled user", async () => {
    await expect(validateAgentUiSession(id, "b".repeat(43))).rejects.toBeInstanceOf(Response);
    mocks.find.mockResolvedValue(null);
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    mocks.find.mockResolvedValue({ ...record(), expiresAt: new Date(0) });
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    mocks.find.mockResolvedValue({ ...record(), createdAt: new Date(0) });
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    const otherLogin = record(); otherLogin.authSession.userId = "different-user"; mocks.find.mockResolvedValue(otherLogin);
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    const disabled = record(); disabled.authSession.user.status = "disabled"; mocks.find.mockResolvedValue(disabled);
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
  });
  it("rejects runtime replacement, project namespace changes and revoked permission", async () => {
    mocks.get.mockResolvedValue({ status: "READY", agentPlatform: "hermes", sandboxName: "sandbox-a", createdAt: "created", operationId: "operation-b" });
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    mocks.target.mockResolvedValue({ namespace: "project-b" });
    await expect(validateAgentUiSession(id, credential)).rejects.toBeInstanceOf(Response);
    mocks.authorize.mockRejectedValue(new Error("Revoked"));
    await expect(validateAgentUiSession(id, credential)).rejects.toThrow("Revoked");
  });
});
