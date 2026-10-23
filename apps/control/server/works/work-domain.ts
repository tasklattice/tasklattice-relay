import { createHash } from "node:crypto";
import {
  workPlanSchema,
  type WorkState,
  type WorkPlan,
  type WorkTask,
} from "@tali/contracts";
import { canonicalJson } from "../expert-agents/expert-agent-domain";

export class WorkError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "work_conflict",
  ) {
    super(message);
  }
}
export const workHash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export const taskScopeHash = ({
  id,
  title,
  acceptance,
  ownerInstanceId,
  dependencies,
  sourceMessageId,
}: WorkTask) =>
  workHash({
    id,
    title,
    acceptance,
    ownerInstanceId,
    dependencies,
    sourceMessageId,
  });
export function applyWorkPlan(
  state: WorkState,
  raw: unknown,
  sourceMessageId: string,
): WorkPlan {
  const plan = workPlanSchema.parse(raw);
  const ids = new Set<string>();
  const next = new Map(state.tasks.map((task) => [task.id, task]));
  for (const change of plan.changes) {
    if (ids.has(change.id)) throw new WorkError("计划中有重复任务 ID。");
    ids.add(change.id);
    const previous = next.get(change.id);
    if (previous && ["done", "cancelled"].includes(previous.status))
      throw new WorkError("已完成或已取消任务不可覆盖；请创建关联的新任务。");
    if (previous?.status === "running")
      throw new WorkError("执行中的任务须先停止，再调整范围。");
    if (["running", "done"].includes(change.status))
      throw new WorkError("计划不能声称任务已经执行或完成。");
    if (
      change.ownerInstanceId &&
      !state.agents.some(
        (a) => a.instanceId === change.ownerInstanceId && a.role === "expert",
      )
    )
      throw new WorkError("任务负责人必须是本工作群绑定的专家实例。");
    if (change.replaces && !state.tasks.some((t) => t.id === change.replaces))
      throw new WorkError("被替代任务不存在。");
    next.set(change.id, { ...change, sourceMessageId });
  }
  if (next.size > 200)
    throw new WorkError("工作群任务已达上限，请拆分工作群。");
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new WorkError("任务依赖不能形成循环。");
    if (visited.has(id)) return;
    const task = next.get(id);
    if (!task) throw new WorkError("任务依赖不存在。");
    visiting.add(id);
    for (const dependency of task.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of next.keys()) visit(id);
  for (const running of state.tasks.filter(
    (task) => task.status === "running",
  )) {
    const visitedDependencies = new Set<string>();
    const check = (id: string) => {
      if (visitedDependencies.has(id)) return;
      visitedDependencies.add(id);
      if (ids.has(id))
        throw new WorkError("调整会影响正在执行的下游任务，请先停止相关执行。");
      for (const dependency of next.get(id)?.dependencies ?? [])
        check(dependency);
    };
    for (const dependency of running.dependencies) check(dependency);
  }
  state.tasks = [...next.values()];
  return plan;
}
export function executionGate(
  input: {
    status: string;
    leaseUntil: Date | null;
    fence: number;
    approvedHash: string;
    input: unknown;
    approvalExpiresAt: Date;
  },
  fence: number,
  now: Date,
) {
  if (
    input.status !== "running" ||
    input.fence !== fence ||
    !input.leaseUntil ||
    input.leaseUntil <= now
  )
    throw new WorkError("执行租约失效或已请求停止。", 409, "run_fenced");
  if (
    input.approvalExpiresAt <= now ||
    input.approvedHash !== workHash(input.input)
  )
    throw new WorkError(
      "授权已过期或执行参数发生变化。",
      403,
      "approval_required",
    );
}
