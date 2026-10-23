import { randomUUID } from "node:crypto";
import { workStateSchema, type WorkState } from "@tali/contracts";
import type { PrismaClient, WorkRunRecord } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import {
  appendWorkEvent,
  authorizedWorkInstance,
  lockWork,
  workAccess,
} from "./work-service";
import {
  applyWorkPlan,
  executionGate,
  taskScopeHash,
  WorkError,
  workHash,
} from "./work-domain";
import {
  productionWorkExecution,
  workDraftSchema,
  type WorkExecution,
} from "./work-runtime";

export class WorkWorker {
  constructor(
    readonly db: PrismaClient = prisma(),
    readonly execute: WorkExecution = productionWorkExecution(db),
  ) {}
  async tick() {
    // Expired leases are not blindly retried: inference may have been billed.
    const expired = await this.db.workRunRecord.findMany({
      where: {
        status: { in: ["running", "cancel_requested"] },
        leaseUntil: { lt: new Date() },
      },
      take: 25,
    });
    for (const run of expired) await this.expire(run);
    const candidates = await this.db.workRunRecord.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: 4,
    });
    await Promise.all(candidates.map((run) => this.process(run)));
  }
  async expire(run: WorkRunRecord) {
    await this.db.$transaction(async (db) => {
      const row = await lockWork(db, run.projectId, run.workId);
      const current = await db.workRunRecord.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (
        !["running", "cancel_requested"].includes(current.status) ||
        !current.leaseUntil ||
        current.leaseUntil > new Date()
      )
        return;
      const dispatched = await db.workEventRecord.count({
        where: {
          projectId: run.projectId,
          workId: run.workId,
          commandKey: { startsWith: `tool:${run.id}:` },
        },
      });
      const status = dispatched ? "outcome_unknown" : "stopped";
      const reason = dispatched
        ? "执行租约已过期，结果与计费需核实；没有自动重试"
        : "执行租约已过期，调用尚未发出；可以重新授权";
      const state = workStateSchema.parse(row.state);
      const task = state.tasks.find((t) => t.id === run.taskId);
      if (task && task.status === "running") {
        task.status = "todo";
        task.reason = reason;
      }
      await db.workRunRecord.update({
        where: { id: run.id },
        data: {
          status,
          reason,
          fence: { increment: 1 },
          leaseUntil: null,
          finishedAt: new Date(),
        },
      });
      await appendWorkEvent(db, row, state, {
        key: `expired:${run.id}:${current.fence}`,
        hash: workHash(reason),
        type: "run_expired",
        summary: reason,
        actorId: run.instanceId,
        details: { runId: run.id, status },
      });
    });
  }
  async process(candidate: WorkRunRecord) {
    const claim = await this.db.workRunRecord.updateMany({
      where: { id: candidate.id, status: "queued", fence: candidate.fence },
      data: {
        status: "running",
        fence: { increment: 1 },
        leaseUntil: new Date(Date.now() + 90_000),
        startedAt: new Date(),
      },
    });
    if (!claim.count) return;
    const run = await this.db.workRunRecord.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const controller = new AbortController();
    let invoked = false;
    const timer = setInterval(() => {
      void this.db.workRunRecord
        .findUnique({ where: { id: run.id } })
        .then((current) => {
          if (
            !current ||
            current.status !== "running" ||
            current.fence !== run.fence ||
            !current.leaseUntil ||
            current.leaseUntil <= new Date()
          )
            controller.abort();
        })
        .catch(() => controller.abort());
    }, 500);
    timer.unref();
    try {
      await this.guard(run, false);
      const result = await this.execute(
        run,
        async () => {
          if (invoked) throw new WorkError("单次授权只允许一次模型调用。", 403);
          await this.guard(run, true);
          invoked = true;
        },
        controller.signal,
      );
      await this.finish(run, result);
    } catch (error) {
      // Never copy provider error bodies (which can contain credentials/context) to chat.
      const reason =
        error instanceof WorkError
          ? error.message
          : "运行服务不可用或返回无效结果；请检查实例与模型连接";
      await this.fail(run, invoked ? "outcome_unknown" : "blocked", reason);
    } finally {
      clearInterval(timer);
    }
  }
  async guard(run: WorkRunRecord, reserve: boolean) {
    await this.db.$transaction(async (db) => {
      const row = await lockWork(db, run.projectId, run.workId);
      await workAccess(db, run.projectId, run.workId, run.requestedBy);
      const current = await db.workRunRecord.findUniqueOrThrow({
        where: { id: run.id },
      });
      executionGate(current, run.fence, new Date());
      const state = workStateSchema.parse(row.state);
      const authorized = await authorizedWorkInstance(
        db,
        run.projectId,
        run.instanceId,
        run.requestedBy,
      );
      if (
        !state.agents.some(
          (a) =>
            a.instanceId === run.instanceId &&
            a.versionId === authorized.version.id,
        )
      )
        throw new WorkError("绑定实例发生变化，需要重新授权。", 403);
      if (state.modelCallsUsed >= state.modelCallLimit)
        throw new WorkError("模型调用额度已用完。", 403, "budget_exceeded");
      if (reserve) {
        state.modelCallsUsed++;
        await appendWorkEvent(db, row, state, {
          key: `tool:${run.id}:${run.fence}`,
          hash: current.approvedHash,
          type: "model_dispatch",
          summary: "已预留一次模型调用；未开放外部工具",
          actorId: run.instanceId,
          details: { runId: run.id },
        });
      }
    });
  }
  async finish(run: WorkRunRecord, result: unknown) {
    await this.db.$transaction(async (db) => {
      const row = await lockWork(db, run.projectId, run.workId);
      const current = await db.workRunRecord.findUniqueOrThrow({
        where: { id: run.id },
      });
      executionGate(current, run.fence, new Date());
      await workAccess(db, run.projectId, run.workId, run.requestedBy);
      const state = workStateSchema.parse(row.state);
      const input = run.input as {
        sourceMessageId: string;
        contextHash: string;
        task: WorkState["tasks"][number] | null;
      };
      let reply: string;
      if (run.kind === "plan") {
        const latest = await db.workMessageRecord.findFirst({
          where: {
            projectId: run.projectId,
            workId: run.workId,
            kind: "human",
          },
          orderBy: { createdAt: "desc" },
        });
        if (
          latest?.id !== input.sourceMessageId ||
          workHash({
            tasks: state.tasks,
            agents: state.agents,
            goal: state.goal,
          }) !== input.contextHash
        )
          throw new WorkError("意图或任务已更新，旧计划没有应用，请重新规划。");
        reply = applyWorkPlan(state, result, input.sourceMessageId).reply;
      } else {
        const draft = workDraftSchema.parse(result);
        const task = state.tasks.find((t) => t.id === run.taskId);
        if (
          !task ||
          task.status !== "running" ||
          task.ownerInstanceId !== run.instanceId
        )
          throw new WorkError("任务状态已改变，旧执行不能发布结果。");
        const versions = state.artifacts.filter((a) => a.taskId === task.id);
        state.artifacts.push({
          id: randomUUID(),
          taskId: task.id,
          runId: run.id,
          sourceMessageId: input.sourceMessageId,
          instanceId: run.instanceId,
          taskScopeHash: taskScopeHash(task),
          title: draft.title,
          content: draft.content,
          version: versions.length + 1,
          previousId: versions.at(-1)?.id ?? null,
          status: "draft",
          evidence: draft.evidence,
          verifiedBy: null,
        });
        task.status = "decision";
        task.reason = "草稿已生成，等待核实证据与交付";
        reply = `已生成「${draft.title}」草稿，请核实后确认交付。`;
      }
      await db.workMessageRecord.create({
        data: {
          projectId: run.projectId,
          workId: run.workId,
          id: randomUUID(),
          kind: "agent",
          instanceId: run.instanceId,
          name:
            state.agents.find((a) => a.instanceId === run.instanceId)?.name ??
            run.instanceId,
          text: reply,
          source: "runtime",
        },
      });
      await db.workRunRecord.update({
        where: { id: run.id },
        data: { status: "succeeded", finishedAt: new Date(), leaseUntil: null },
      });
      await appendWorkEvent(db, row, state, {
        key: `result:${run.id}:${run.fence}`,
        hash: workHash(result),
        type: "run_result",
        summary:
          run.kind === "plan" ? "协调者已更新任务安排" : "专家已提交草稿",
        actorId: run.instanceId,
        details: { runId: run.id, result },
      });
    });
  }
  async fail(run: WorkRunRecord, status: string, reason: string) {
    await this.db.$transaction(async (db) => {
      const row = await lockWork(db, run.projectId, run.workId);
      const current = await db.workRunRecord.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (current.status === "cancel_requested") {
        const dispatched = await db.workEventRecord.count({
          where: {
            projectId: run.projectId,
            workId: run.workId,
            commandKey: { startsWith: `tool:${run.id}:` },
          },
        });
        status = dispatched ? "outcome_unknown" : "stopped";
        reason = dispatched
          ? "已阻止新调用并中止等待；在途模型请求的结果与计费尚未核实"
          : "已停止，模型调用尚未发出";
      } else if (current.status !== "running" || current.fence !== run.fence) {
        const key = `late:${run.id}:${run.fence}`;
        const recorded = await db.workEventRecord.findUnique({
          where: {
            projectId_workId_commandKey: {
              projectId: run.projectId,
              workId: run.workId,
              commandKey: key,
            },
          },
        });
        if (!recorded)
          await appendWorkEvent(db, row, workStateSchema.parse(row.state), {
            key,
            hash: workHash(reason),
            type: "late_result_discarded",
            summary: "迟到执行已忽略，任务与产物未被覆盖",
            actorId: run.instanceId,
            details: { runId: run.id, rejectedFence: run.fence, reason },
          });
        return;
      }
      const state = workStateSchema.parse(row.state);
      const task = state.tasks.find((t) => t.id === run.taskId);
      if (task && task.status !== "done") {
        task.status = "todo";
        task.reason = reason;
      }
      await db.workRunRecord.update({
        where: { id: run.id },
        data: { status, reason, finishedAt: new Date(), leaseUntil: null },
      });
      await appendWorkEvent(db, row, state, {
        key: `failure:${run.id}:${run.fence}`,
        hash: workHash(reason),
        type: "run_blocked",
        summary: reason,
        actorId: run.instanceId,
        details: { runId: run.id, status },
      });
    });
  }
}
export function startWorkWorker(worker = new WorkWorker()) {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void worker
      .tick()
      .catch(() =>
        console.error(
          "Work worker iteration failed; durable runs remain in PostgreSQL.",
        ),
      )
      .finally(() => {
        busy = false;
      });
  }, 1000);
  return () => clearInterval(timer);
}
