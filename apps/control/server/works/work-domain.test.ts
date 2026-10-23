import { describe, expect, it } from "vitest";
import {
  isOwnWorkMessage,
  workCommandSchema,
  type WorkState,
  type WorkTask,
} from "@tali/contracts";
import { applyWorkPlan, executionGate, workHash } from "./work-domain";
const state = (): WorkState => ({
  title: "Work",
  goal: "Goal",
  ownerUserId: "one",
  memberUserIds: ["one", "two"],
  agents: [
    {
      instanceId: "expert",
      name: "Expert",
      role: "expert",
      versionId: "v1",
      capability: "Draft",
    },
  ],
  tasks: [],
  artifacts: [],
  defaultView: "chat",
  modelCallLimit: 20,
  modelCallsUsed: 0,
});
const task = (id = "R-1", dependencies: string[] = []): WorkTask => ({
  id,
  title: "Deliverable",
  status: "todo",
  ownerInstanceId: "expert",
  reason: "User intent",
  dependencies,
  acceptance: "Verified",
  replaces: null,
  sourceMessageId: "m1",
});
describe("Work domain safety", () => {
  it("uses trusted IDs for two humans and an Agent, regardless of matching names", () => {
    expect(isOwnWorkMessage({ kind: "human", userId: "one" }, "one")).toBe(
      true,
    );
    expect(isOwnWorkMessage({ kind: "human", userId: "two" }, "one")).toBe(
      false,
    );
    expect(isOwnWorkMessage({ kind: "agent", userId: "one" }, "one")).toBe(
      false,
    );
  });
  it("rejects forged author and arbitrary agent commands", () => {
    expect(
      workCommandSchema.safeParse({
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: 0,
        action: { type: "message", text: "hello", userId: "admin" },
      }).success,
    ).toBe(false);
  });
  it("supports zero tasks and incremental splitting without replacing completed history", () => {
    const s = state();
    s.tasks = [{ ...task(), status: "done" }];
    applyWorkPlan(s, { reply: "Simple answer", changes: [] }, "m2");
    applyWorkPlan(
      s,
      {
        reply: "Followup",
        changes: [{ ...task("R-2", ["R-1"]), replaces: "R-1" }],
      },
      "m3",
    );
    expect(s.tasks.map((t) => t.id)).toEqual(["R-1", "R-2"]);
    expect(s.tasks[0]?.status).toBe("done");
    expect(s.tasks[1]?.sourceMessageId).toBe("m3");
  });
  it.each(["done", "running", "cancelled"] as const)(
    "cannot overwrite %s tasks",
    (status) => {
      const s = state();
      s.tasks = [{ ...task(), status }];
      expect(() =>
        applyWorkPlan(s, { reply: "edit", changes: [task()] }, "m2"),
      ).toThrow();
    },
  );
  it.each(
    [
      [task("R-1", ["R-2"]), task("R-2", ["R-1"])],
      [task("R-1", ["absent"])],
      [task(), task()],
      [{ ...task(), ownerInstanceId: "foreign" }],
      [{ ...task(), status: "done" }],
    ].map((changes) => ({ changes })),
  )("rejects invalid graph or authority $changes", ({ changes }) => {
    expect(() =>
      applyWorkPlan(state(), { reply: "plan", changes }, "m2"),
    ).toThrow();
  });
  it("blocks changes to upstream context of a running task", () => {
    const s = state();
    s.tasks = [task("R-1"), { ...task("R-2", ["R-1"]), status: "running" }];
    expect(() =>
      applyWorkPlan(
        s,
        { reply: "defer", changes: [{ ...task("R-1"), status: "deferred" }] },
        "m2",
      ),
    ).toThrow();
    expect(s.tasks[0]?.status).toBe("todo");
  });
  const input = { intent: "Draft only" };
  const run = () => ({
    status: "running",
    fence: 2,
    leaseUntil: new Date(Date.now() + 60000),
    input,
    approvedHash: workHash(input),
    approvalExpiresAt: new Date(Date.now() + 60000),
  });
  it.each([
    { status: "cancel_requested" },
    { fence: 1 },
    { leaseUntil: new Date(0) },
    { approvalExpiresAt: new Date(0) },
    { approvedHash: "changed" },
    { input: { intent: "Send email" } },
  ])("blocks tool dispatch when authorization/lease changes %j", (change) => {
    expect(() =>
      executionGate({ ...run(), ...change }, 2, new Date()),
    ).toThrow();
  });
});
