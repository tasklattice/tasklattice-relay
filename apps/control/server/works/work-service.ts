import { randomUUID } from "node:crypto";
import {
  createWorkSchema,
  workCommandSchema,
  workStateSchema,
  expertAgentVersionSnapshotSchema,
  personalSetupStateSchema,
  type WorkState,
  type WorkSnapshot,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { membershipHasAccess } from "../projects/project-access";
import { ownsPersonalProject } from "../projects/personal-project-access";
import { WorkError, workHash, taskScopeHash } from "./work-domain";

export type WorkDatabase = Prisma.TransactionClient;
export const workKey = (projectId: string, id: string) => ({
  projectId_id: { projectId, id },
});
export const workJson = (value: unknown) => value as Prisma.InputJsonValue;
export async function requireWorkProject(
  db: WorkDatabase,
  projectId: string,
  userId: string,
) {
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { user: true, project: { include: { department: true } } },
  });
  if (
    !member ||
    !membershipHasAccess(member) ||
    member.user.status !== "active" ||
    member.project.deletedAt ||
    member.project.department.status !== "active"
  )
    throw new WorkError("无权访问这个 Project。", 403, "access_denied");
  return member.user;
}
export async function lockWork(
  db: WorkDatabase,
  projectId: string,
  workId: string,
) {
  await db.$queryRaw`SELECT id FROM tasklattice.works WHERE project_id=${projectId} AND id=${workId}::uuid FOR UPDATE`;
  const row = await db.workRecord.findUnique({
    where: workKey(projectId, workId),
  });
  if (!row) throw new WorkError("工作群不存在或未向你开放。", 404, "not_found");
  return row;
}
export async function workAccess(
  db: WorkDatabase,
  projectId: string,
  workId: string,
  userId: string,
) {
  await requireWorkProject(db, projectId, userId);
  const row = await db.workRecord.findUnique({
    where: workKey(projectId, workId),
  });
  if (!row || !workStateSchema.parse(row.state).memberUserIds.includes(userId))
    throw new WorkError("工作群不存在或未向你开放。", 404, "not_found");
  return row;
}
export async function authorizedWorkInstance(
  db: WorkDatabase,
  projectId: string,
  instanceId: string,
  userId: string,
) {
  const instance = await db.agentRecord.findFirst({
    where: {
      projectId,
      id: instanceId,
      deletedAt: null,
      kind: { in: ["PROJECT_AGENT", "WORK_AGENT"] },
    },
    include: { agentVersion: true, developedAgent: true },
  });
  const access = instance?.developedAgentId
    ? await db.expertAgentMemberRecord.findFirst({
        where: { projectId, agentId: instance.developedAgentId, userId },
      })
    : null;
  if (
    !instance ||
    (!access && instance.ownerUserId !== userId) ||
    instance.developedAgent?.deletedAt ||
    !instance.agentVersion
  )
    throw new WorkError(
      "实例不可用或未授权给当前用户。",
      403,
      "instance_access_denied",
    );
  const snapshot = expertAgentVersionSnapshotSchema.parse(
    instance.agentVersion.snapshot,
  );
  if (
    snapshot.execution.mode !== "AGENTIC" ||
    (instance.payload as { status?: string }).status !== "READY"
  )
    throw new WorkError(
      "需要已就绪、固定发布版本的 Agent 实例。",
      409,
      "runtime_unavailable",
    );
  return { instance, snapshot, version: instance.agentVersion };
}
export async function appendWorkEvent(
  db: WorkDatabase,
  row: { projectId: string; id: string; revision: number },
  state: WorkState,
  input: {
    key: string;
    hash: string;
    type: string;
    summary: string;
    actorId: string;
    details?: unknown;
  },
) {
  await db.workRecord.update({
    where: workKey(row.projectId, row.id),
    data: {
      revision: row.revision + 1,
      state: workJson(workStateSchema.parse(state)),
    },
  });
  await db.workEventRecord.create({
    data: {
      projectId: row.projectId,
      workId: row.id,
      sequence: row.revision + 1,
      commandKey: input.key,
      commandHash: input.hash,
      type: input.type,
      summary: input.summary,
      actorId: input.actorId,
      details: workJson(input.details ?? {}),
    },
  });
}
export class WorkService {
  constructor(readonly db: PrismaClient = prisma()) {}
  async list(projectId: string, userId: string) {
    await requireWorkProject(this.db, projectId, userId);
    const rows = await this.db.workRecord.findMany({
      where: {
        projectId,
        state: { path: ["memberUserIds"], array_contains: [userId] },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return rows.map((row) => {
      const state = workStateSchema.parse(row.state);
      return {
        id: row.id,
        title: state.title,
        goal: state.goal,
        revision: row.revision,
        decisions: state.tasks.filter((t) => t.status === "decision").length,
      };
    });
  }
  async candidates(projectId: string, userId: string) {
    await requireWorkProject(this.db, projectId, userId);
    const rows = await this.db.agentRecord.findMany({
      where: {
        projectId,
        kind: { in: ["PROJECT_AGENT", "WORK_AGENT"] },
        deletedAt: null,
        OR: [
          { ownerUserId: userId },
          { developedAgent: { members: { some: { userId } } } },
        ],
      },
      take: 100,
    });
    const candidates = [];
    for (const row of rows) {
      try {
        const { snapshot } = await authorizedWorkInstance(
          this.db,
          projectId,
          row.id,
          userId,
        );
        candidates.push({
          id: row.id,
          name: snapshot.product.name,
          capability: snapshot.product.purpose,
        });
      } catch {
        /* Unready/unauthorized instances are not offered. */
      }
    }
    return candidates;
  }
  async create(projectId: string, userId: string, raw: unknown) {
    const input = createWorkSchema.parse(raw);
    await requireWorkProject(this.db, projectId, userId);
    const state: WorkState = {
      title: input.title,
      goal: input.goal,
      ownerUserId: userId,
      memberUserIds: [userId],
      agents: [],
      tasks: [],
      artifacts: [],
      defaultView: "chat",
      modelCallLimit: 20,
      modelCallsUsed: 0,
    };
    const setup = await this.db.personalOnboardingRecord.findUnique({ where: { projectId } });
    if (setup?.status === "READY" && await ownsPersonalProject(this.db, projectId, userId)) {
      const defaults = personalSetupStateSchema.parse(setup.state);
      for (const [role, instanceId] of [["coordinator", defaults.coordinatorInstanceId], ["expert", defaults.expertInstanceId]] as const) {
        if (!instanceId) continue;
        const { snapshot, version } = await authorizedWorkInstance(this.db, projectId, instanceId, userId);
        state.agents.push({ role, instanceId, name: snapshot.product.name, versionId: version.id, capability: snapshot.product.purpose });
      }
    }
    const row = await this.db.workRecord
      .upsert({
        where: {
          projectId_createdBy_creationKey: {
            projectId,
            createdBy: userId,
            creationKey: input.idempotencyKey,
          },
        },
        update: {},
        create: {
          projectId,
          id: randomUUID(),
          createdBy: userId,
          creationKey: input.idempotencyKey,
          state: workJson(state),
        },
      })
      .catch(async (error: unknown) => {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "P2002"
        )
          throw error;
        const existing = await this.db.workRecord.findUnique({
          where: {
            projectId_createdBy_creationKey: {
              projectId,
              createdBy: userId,
              creationKey: input.idempotencyKey,
            },
          },
        });
        if (!existing) throw error;
        return existing;
      });
    const prior = workStateSchema.parse(row.state);
    if (prior.title !== input.title || prior.goal !== input.goal)
      throw new WorkError("同一请求编号不能用于不同的工作群。");
    if (input.startPlanning) {
      if (!prior.agents.some((a) => a.role === "coordinator")) throw new WorkError("团队尚未就绪，可以先创建讨论空间。");
      // Stable keys recover a lost HTTP response without duplicate intent or calls.
      const key = (action: string) => {
        const h = workHash([row.id, input.idempotencyKey, action]);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
      };
      const message = await this.command(projectId, row.id, userId, { expectedRevision: row.revision, idempotencyKey: key("intent"), action: { type: "message", text: input.goal } });
      const source = await this.db.workMessageRecord.findUniqueOrThrow({ where: { projectId_workId_id: { projectId, workId: row.id, id: key("intent") } } });
      await this.command(projectId, row.id, userId, { expectedRevision: message.revision, idempotencyKey: key("plan"), action: { type: "plan", sourceMessageId: source.id } });
    }
    return { id: row.id };
  }
  async snapshot(
    projectId: string,
    workId: string,
    userId: string,
  ): Promise<WorkSnapshot> {
    return this.db.$transaction(
      async (db) => {
        const row = await workAccess(db, projectId, workId, userId);
        const [messages, events, runs] = await Promise.all([
          db.workMessageRecord.findMany({
            where: { projectId, workId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
          db.workEventRecord.findMany({
            where: { projectId, workId },
            orderBy: { sequence: "desc" },
            take: 50,
          }),
          db.workRunRecord.findMany({
            where: { projectId, workId },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        ]);
        return {
          id: workId,
          projectId,
          revision: row.revision,
          state: workStateSchema.parse(row.state),
          messages: messages.map((m) => ({
            ...m,
            kind: m.kind as "human" | "agent",
            createdAt: m.createdAt.toISOString(),
          })),
          events: events.reverse().map((e) => ({
            sequence: e.sequence,
            type: e.type,
            summary: e.summary,
            createdAt: e.createdAt.toISOString(),
          })),
          runs: runs.map((r) => ({
            id: r.id,
            taskId: r.taskId,
            instanceId: r.instanceId,
            status: r.status,
            reason: r.reason,
            kind: r.kind,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async events(
    projectId: string,
    workId: string,
    userId: string,
    after: number,
  ) {
    await workAccess(this.db, projectId, workId, userId);
    return this.db.workEventRecord.findMany({
      where: { projectId, workId, sequence: { gt: after } },
      select: { sequence: true, type: true, summary: true, createdAt: true },
      orderBy: { sequence: "asc" },
      take: 200,
    });
  }
  async command(
    projectId: string,
    workId: string,
    userId: string,
    raw: unknown,
  ) {
    const command = workCommandSchema.parse(raw);
    const digest = workHash({ userId, action: command.action });
    await this.db.$transaction(async (db) => {
      const user = await requireWorkProject(db, projectId, userId);
      const row = await lockWork(db, projectId, workId);
      const state = workStateSchema.parse(row.state);
      if (!state.memberUserIds.includes(userId))
        throw new WorkError("工作群不存在或未向你开放。", 404, "not_found");
      const previous = await db.workEventRecord.findUnique({
        where: {
          projectId_workId_commandKey: {
            projectId,
            workId,
            commandKey: command.idempotencyKey,
          },
        },
      });
      if (previous) {
        if (previous.commandHash !== digest)
          throw new WorkError("请求编号已被其他操作使用。");
        return;
      }
      if (row.revision !== command.expectedRevision)
        throw new WorkError(
          "工作群已有更新，请刷新后重新提交。输入仍会保留。",
          409,
          "revision_conflict",
        );
      const action = command.action;
      let summary: string = action.type;
      if (action.type === "message") {
        await db.workMessageRecord.create({
          data: {
            projectId,
            workId,
            id: command.idempotencyKey,
            kind: "human",
            userId,
            name: user.displayName,
            text: action.text,
            source: action.source,
          },
        });
        summary = "新增讨论";
      } else if (action.type === "members") {
        if (state.ownerUserId !== userId || !action.userIds.includes(userId))
          throw new WorkError("只有创建者能调整成员，且不能移除自己。", 403);
        for (const id of action.userIds)
          await requireWorkProject(db, projectId, id);
        state.memberUserIds = [...new Set(action.userIds)];
        summary = "工作群成员已更新";
      } else if (action.type === "bind") {
        if (state.ownerUserId !== userId)
          throw new WorkError("只有创建者能分配实例。", 403);
        const { snapshot, version } = await authorizedWorkInstance(
          db,
          projectId,
          action.instanceId,
          userId,
        );
        if (snapshot.execution.configuration.engineType === "WORK_TEXT" && snapshot.execution.configuration.workRole !== action.role)
          throw new WorkError("这个默认专家的职责已固定，请选择对应角色。");
        if (
          await db.workRunRecord.count({
            where: {
              projectId,
              workId,
              status: { in: ["queued", "running", "cancel_requested"] },
            },
          })
        )
          throw new WorkError("请先停止现有执行，再调整实例。");
        state.agents = state.agents.filter(
          (a) =>
            a.instanceId !== action.instanceId &&
            !(action.role === "coordinator" && a.role === "coordinator"),
        );
        state.agents.push({
          instanceId: action.instanceId,
          name: snapshot.product.name,
          role: action.role,
          versionId: version.id,
          capability: snapshot.product.purpose,
        });
        summary = "成员实例已分配";
      } else if (action.type === "view") {
        state.defaultView = action.view;
        summary = "视图偏好已保存";
      } else if (action.type === "plan" || action.type === "execute") {
        const task =
          action.type === "execute"
            ? state.tasks.find((t) => t.id === action.taskId)
            : undefined;
        if (
          action.type === "execute" &&
          (!task || !["todo", "decision"].includes(task.status))
        )
          throw new WorkError("该任务当前不能执行。");
        if (
          task?.dependencies.some(
            (id) => state.tasks.find((t) => t.id === id)?.status !== "done",
          )
        )
          throw new WorkError("上游交付尚未完成。");
        const binding =
          action.type === "plan"
            ? state.agents.find((a) => a.role === "coordinator")
            : state.agents.find(
                (a) =>
                  a.instanceId === task?.ownerInstanceId && a.role === "expert",
              );
        if (!binding)
          throw new WorkError(
            "尚未分配可用实例；展开群成员后分配协调者和专家。",
            409,
            "runtime_unavailable",
          );
        const authorized = await authorizedWorkInstance(
          db,
          projectId,
          binding.instanceId,
          userId,
        );
        if (authorized.version.id !== binding.versionId)
          throw new WorkError("实例版本已改变，请重新分配后授权。");
        if (state.modelCallsUsed >= state.modelCallLimit)
          throw new WorkError(
            "本工作群的模型调用额度已用完。",
            403,
            "budget_exceeded",
          );
        if (
          await db.workRunRecord.count({
            where: {
              projectId,
              workId,
              ...(task ? { taskId: task.id } : { kind: "plan" }),
              status: {
                in: [
                  "queued",
                  "running",
                  "cancel_requested",
                  "outcome_unknown",
                ],
              },
            },
          })
        )
          throw new WorkError("已有执行或结果尚未核实，不能重复派发。");
        const sourceMessageId =
          action.type === "plan"
            ? action.sourceMessageId
            : task!.sourceMessageId;
        const source = await db.workMessageRecord.findUnique({
          where: {
            projectId_workId_id: { projectId, workId, id: sourceMessageId },
          },
        });
        if (!source || source.kind !== "human")
          throw new WorkError("需要本工作群的人类意图消息。");
        // The immutable approval authorizes one model-only operation. No browser, shell,
        // file, memory, MCP or remote side effects are delegated to this runtime.
        const history =
          action.type === "plan"
            ? await db.workMessageRecord.findMany({
                where: {
                  projectId,
                  workId,
                  createdAt: { lte: source.createdAt },
                },
                select: {
                  id: true,
                  kind: true,
                  userId: true,
                  instanceId: true,
                  text: true,
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 12,
              })
            : [];
        const dependencyArtifacts = task
          ? state.artifacts
              .filter(
                (a) =>
                  a.status === "delivered" &&
                  a.taskId &&
                  task.dependencies.includes(a.taskId),
              )
              .map((a) => ({
                id: a.id,
                taskId: a.taskId,
                version: a.version,
                content: a.content,
                evidence: a.evidence,
              }))
          : [];
        const input = {
          sourceMessageId,
          intent: source.text,
          history: history.reverse(),
          dependencyArtifacts,
          goal: state.goal,
          task: task ?? null,
          tasks: action.type === "plan" ? state.tasks : [],
          agents: state.agents,
          versionId: binding.versionId,
          contextHash: workHash({
            tasks: state.tasks,
            agents: state.agents,
            goal: state.goal,
          }),
        };
        await db.workRunRecord.create({
          data: {
            id: randomUUID(),
            projectId,
            workId,
            taskId: task?.id ?? null,
            instanceId: binding.instanceId,
            requestedBy: userId,
            kind: action.type,
            input: workJson(input),
            approvedHash: workHash(input),
            approvalExpiresAt: new Date(Date.now() + 15 * 60_000),
            planRevision: row.revision + 1,
          },
        });
        if (task) {
          task.status = "running";
          task.reason = "已排队，等待 Worker 取得执行租约";
        }
        summary =
          action.type === "plan"
            ? "已授权协调者规划（一次模型调用）"
            : `已授权执行 ${task!.id}（一次模型调用）`;
      } else if (action.type === "cancel") {
        const run = await db.workRunRecord.findFirst({
          where: { id: action.runId, projectId, workId },
        });
        if (!run || !["queued", "running"].includes(run.status))
          throw new WorkError("执行不可停止或已结束。");
        await db.workRunRecord.update({
          where: { id: run.id },
          data: {
            status: run.status === "queued" ? "stopped" : "cancel_requested",
            fence: { increment: 1 },
            reason: "用户请求停止；在途模型计费可能仍发生",
          },
        });
        const task = state.tasks.find((t) => t.id === run.taskId);
        if (task) {
          task.status = "todo";
          task.reason = "停止请求已提交，等待运行状态确认";
        }
        summary = "停止请求已记录，新工具调用已禁止";
      } else if (action.type === "resolve_unknown") {
        const run = await db.workRunRecord.findFirst({
          where: { id: action.runId, projectId, workId },
        });
        if (
          !run ||
          run.status !== "outcome_unknown" ||
          (run.requestedBy !== userId && state.ownerUserId !== userId)
        )
          throw new WorkError("只有请求者或创建者能核查这次执行。", 403);
        // This runtime permits only inference. A human records gateway/usage
        // reconciliation; closing never retries or declares a result delivered.
        await db.workRunRecord.update({
          where: { id: run.id },
          data: { status: "reviewed_unknown", reason: action.evidence },
        });
        summary = "已记录执行与计费核查；若需再次执行，必须重新授权";
      } else if (action.type === "verify" || action.type === "deliver") {
        const artifact = state.artifacts.find(
          (a) => a.id === action.artifactId,
        );
        if (!artifact) throw new WorkError("产物不存在。", 404);
        if (artifact.status === "delivered")
          throw new WorkError("已交付产物不可修改。");
        const task = state.tasks.find((t) => t.id === artifact.taskId);
        if (
          !task ||
          ["running", "done", "cancelled"].includes(task.status) ||
          taskScopeHash(task) !== artifact.taskScopeHash ||
          state.artifacts.some(
            (a) => a.taskId === artifact.taskId && a.version > artifact.version,
          )
        )
          throw new WorkError("任务范围或产物版本已改变，旧草稿不能确认交付。");
        if (action.type === "verify") {
          artifact.status = "verified";
          artifact.evidence = action.evidence;
          artifact.verifiedBy = userId;
          summary = "已记录人工验证证据";
        } else {
          if (artifact.status !== "verified")
            throw new WorkError("产物须先通过验证。");
          artifact.status = "delivered";
          const task = state.tasks.find((t) => t.id === artifact.taskId);
          if (task) {
            task.status = "done";
            task.reason = "产物已验证并确认交付";
          }
          summary = "产物已确认交付";
        }
      }
      await appendWorkEvent(db, row, state, {
        key: command.idempotencyKey,
        hash: digest,
        type: action.type,
        summary,
        actorId: userId,
        details: action,
      });
    });
    return this.snapshot(projectId, workId, userId);
  }
}
