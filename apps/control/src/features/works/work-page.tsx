import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  LayoutPanelLeft,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
  Users,
  X,
} from "lucide-react";
import {
  isOwnWorkMessage,
  type WorkCommand,
  type WorkSnapshot,
  type WorkTask,
  type PersonalOnboardingStatus,
} from "@tali/contracts";
import { useAuth } from "@/components/auth/auth-provider";
import { useProject } from "@/hooks/use-project";
import { BrandMark } from "@/components/brand/brand-logo";
import { ProjectSwitcher } from "@/components/project/project-switcher";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "./work.css";
import { PersonalOnboarding } from "./personal-onboarding";

async function request<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(
    url,
    data
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }
      : { cache: "no-store" },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.detail ?? `请求失败（${response.status}）`);
  return body as T;
}
type WorkList = Array<{
  id: string;
  title: string;
  goal: string;
  decisions: number;
}>;
type Candidate = { id: string; name: string; capability: string };
const runLabels: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  blocked: "运行受阻",
  cancel_requested: "正在请求停止",
  stopped: "已停止",
  outcome_unknown: "结果待核实",
  reviewed_unknown: "已核查并结束本次尝试",
  succeeded: "执行结束",
};
const columns = [
  {
    name: "待开始",
    statuses: ["todo", "deferred", "cancelled"],
    color: "neutral",
  },
  { name: "执行中", statuses: ["running"], color: "active" },
  { name: "待你决定", statuses: ["decision"], color: "warning" },
  { name: "已完成", statuses: ["done"], color: "success" },
];

export function WorkPage() {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as { work?: string };
  const projectId = currentProject?.id ?? "";
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/works`;
  const client = useQueryClient();
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [goal, setGoal] = useState("");
  const [startPlanning, setStartPlanning] = useState(true);
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useState<"chat" | "board" | "artifacts">("chat");
  const [artifactId, setArtifactId] = useState<string | null>(null),
    [evidence, setEvidence] = useState("");
  const [reviewRunId, setReviewRunId] = useState<string | null>(null),
    [reviewEvidence, setReviewEvidence] = useState("");
  const [bindingId, setBindingId] = useState(""),
    [bindingRole, setBindingRole] = useState<"coordinator" | "expert">(
      "coordinator",
    );
  const messageEnd = useRef<HTMLDivElement>(null);
  const pendingCommand = useRef<{ action: string; key: string } | null>(null);
  const pendingCreate = useRef<{ input: string; key: string } | null>(null);
  const workId = search.work;
  const [setupOpen, setSetupOpen] = useState(false), [setupSkipped, setSetupSkipped] = useState(false);
  const onboarding = useQuery({
    queryKey: ["personal-onboarding", projectId, user?.id],
    queryFn: () => request<PersonalOnboardingStatus>(`/api/v1/projects/${encodeURIComponent(projectId)}/personal-onboarding`),
    enabled: !!projectId,
    refetchInterval: (query) => query.state.data?.busy || (setupOpen && query.state.data?.status !== "READY") ? 2000 : false,
  });
  const listKey = ["works", projectId, user?.id];
  const snapshotKey = ["work", projectId, user?.id, workId];
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => request<WorkList>(base),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: () => request<WorkSnapshot>(`${base}/${workId}`),
    enabled: !!projectId && !!workId,
    refetchInterval: 3000,
  });
  const candidates = useQuery({
    queryKey: ["work-candidates", projectId, user?.id],
    queryFn: () => request<Candidate[]>(`${base}/candidates`),
    enabled: !!projectId,
    staleTime: 30_000,
  });
  const work = snapshot.isError ? undefined : snapshot.data;
  useEffect(() => {
    setError("");
    setText("");
    setArtifactId(null);
    setEvidence("");
    setReviewRunId(null);
    setReviewEvidence("");
    setBindingId("");
    setSetupOpen(false);
  }, [workId, projectId]);
  useEffect(() => { setSetupSkipped(false); }, [projectId]);
  useEffect(() => {
    if (work?.state.defaultView) setView(work.state.defaultView);
  }, [work?.id, work?.state.defaultView]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [work?.messages.length]);
  // Cursor replay also triggers snapshots after reconnect; snapshots remain the
  // sole renderer input, so repeated events never duplicate messages or cards.
  useEffect(() => {
    if (!work) return;
    const controller = new AbortController();
    const refresh = () => {
      void request<Array<{ sequence: number }>>(
        `${base}/${work.id}/events?after=${work.revision}`,
      )
        .then((events) => {
          if (events.length && !controller.signal.aborted)
            void client.invalidateQueries({ queryKey: snapshotKey });
        })
        .catch(() => undefined);
    };
    window.addEventListener("online", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("online", refresh);
    };
  }, [work?.revision, work?.id]);
  async function command(action: WorkCommand["action"]) {
    if (!work || busy) return false;
    setBusy(true);
    setError("");
    const encoded = JSON.stringify({ projectId, workId, action });
    if (pendingCommand.current?.action !== encoded)
      pendingCommand.current = { action: encoded, key: crypto.randomUUID() };
    try {
      const result = await request<WorkSnapshot>(
        `${base}/${work.id}/commands`,
        {
          expectedRevision: work.revision,
          idempotencyKey: pendingCommand.current.key,
          action,
        },
      );
      pendingCommand.current = null;
      client.setQueryData(snapshotKey, result);
      void client.invalidateQueries({ queryKey: listKey });
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "提交失败，输入已保留。",
      );
      void snapshot.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    const shouldPlan = onboarding.data?.status === "READY" && startPlanning;
    const input = JSON.stringify({ projectId, title, goal, startPlanning: shouldPlan });
    if (pendingCreate.current?.input !== input)
      pendingCreate.current = { input, key: crypto.randomUUID() };
    try {
      const result = await request<{ id: string }>(base, {
        title,
        goal,
        idempotencyKey: pendingCreate.current.key,
        startPlanning: shouldPlan,
      });
      pendingCreate.current = null;
      setCreating(false);
      setTitle("");
      setGoal("");
      await client.invalidateQueries({ queryKey: listKey });
      void navigate({
        to: "/$projectId/works",
        params: { projectId },
        search: { work: result.id },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  const artifact = work?.state.artifacts.find((a) => a.id === artifactId);
  const lastIntent = work?.messages.filter((m) => m.kind === "human").at(-1);
  const activeRuns =
    work?.runs.filter((run) =>
      ["queued", "running", "cancel_requested"].includes(run.status),
    ) ?? [];
  const coordinator = work?.state.agents.find((a) => a.role === "coordinator");
  function showSource(task: WorkTask) {
    document
      .getElementById(`message-${task.sourceMessageId}`)
      ?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    document.getElementById(`message-${task.sourceMessageId}`)?.focus();
  }
  return (
    <div className="work-shell" data-view={view}>
      <aside className="work-nav" aria-label="Project 与工作群">
        <a href={`/${projectId}/works`} className="work-brand">
          <BrandMark className="size-7" />
          <strong>Relay</strong>
        </a>
        <div className="work-project">
          <span className="work-caption">PROJECT</span>
          <ProjectSwitcher
            onProjectSettingsOpen={() => {
              window.location.href = `/${projectId}/setting`;
            }}
            onProjectSwitchSuccess={() => {
              // ProjectProvider has already replaced the Project path. A Work
              // selection belongs to the previous Project and must not follow it.
              router.history.replace(window.location.pathname);
            }}
          />
        </div>
        <div className="work-nav-label">
          <span>工作群</span>
          <button aria-label="新建工作群" onClick={() => setCreating(true)}>
            <Plus size={17} />
          </button>
        </div>
        <nav className="work-list">
          {list.isPending && <p role="status">正在载入工作群…</p>}
          {list.isError && (
            <button onClick={() => void list.refetch()}>载入失败 · 重试</button>
          )}
          {list.data?.map((item) => (
            <a
              key={item.id}
              href={`/${projectId}/works?work=${item.id}`}
              aria-current={workId === item.id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                void navigate({
                  to: "/$projectId/works",
                  params: { projectId },
                  search: { work: item.id },
                });
              }}
            >
              <MessageSquare size={16} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.decisions ? `${item.decisions} 项待你决定` : "持续协作"}
                </small>
              </span>
            </a>
          ))}
          <button className="work-new" onClick={() => setCreating(true)}>
            <Plus size={16} />
            新建工作群
          </button>
        </nav>
        <footer>
          <p>每件大工作，一个协作空间</p>
          {onboarding.data?.eligible && <button onClick={() => setSetupOpen(true)}>模型与团队{onboarding.data.status !== "READY" ? " · 待设置" : ""}</button>}
          {onboarding.data?.eligible && <a href={`/${projectId}/cost?groupBy=work&range=7d${workId ? `&filters=${encodeURIComponent(`work=${workId}`)}` : ""}`}>用量与费用</a>}
          <a href={`/${projectId}/help`}>帮助与文档</a>
          <a href="/access">切换角色</a>
          <a href="/account">
            <span className="work-avatar">{user?.displayName.slice(0, 1)}</span>
            {user?.displayName}
          </a>
        </footer>
      </aside>
      {onboarding.data?.eligible && (setupOpen || (!workId && !setupSkipped && onboarding.data.status !== "READY")) ? (
        <PersonalOnboarding key={projectId} projectId={projectId} status={onboarding.data}
          onBegin={() => setSetupOpen(true)}
          onContinue={() => { setSetupOpen(false); setSetupSkipped(true); setCreating(true); }}
          onSkip={() => { setSetupOpen(false); setSetupSkipped(true); }} />
      ) : !work ? (
        <main className="work-welcome">
          {snapshot.isError ? (
            <>
              <h1>暂时无法打开这个工作群</h1>
              <p>{snapshot.error.message}</p>
              <Button onClick={() => void snapshot.refetch()}>
                <RefreshCw />
                重新载入
              </Button>
            </>
          ) : workId && snapshot.isPending ? (
            <p role="status">正在打开工作群…</p>
          ) : (
            <>
              <BrandMark className="size-12" />
              <h1>这次，你想完成什么？</h1>
              <p>
                给一件工作一个持续的协作空间。先聊清楚目标，
                <br />
                需要时再安排任务、分配专家、整理交付。
              </p>
              <Button onClick={() => setCreating(true)}>
                <Plus />
                开始一件工作
              </Button>
              {list.data?.length ? (
                <p className="work-caption">也可以从左侧继续已有的工作群。</p>
              ) : (
                <p className="work-caption">
                  无需先创建任务卡，就可以开始讨论。
                </p>
              )}
            </>
          )}
        </main>
      ) : (
        <>
          <main className="work-conversation">
            <header className="work-header">
              <h1>{work.state.title}</h1>
              <button
                title={view === "chat" ? "打开任务看板" : "收起看板"}
                aria-label={view === "chat" ? "打开任务看板" : "收起看板"}
                onClick={() =>
                  void command({
                    type: "view",
                    view: view === "chat" ? "board" : "chat",
                  })
                }
              >
                <LayoutPanelLeft size={19} />
              </button>
            </header>
            <section className="work-context">
              <span className="work-caption work-accent">◉ 本群目标</span>
              <p>{work.state.goal}</p>
              <details className="work-members">
                <summary>
                  <Users size={15} />
                  群成员{" "}
                  <span>
                    {work.state.memberUserIds.length} 位人类 ·{" "}
                    {work.state.agents.length} 个实例
                  </span>
                  <ChevronRight size={14} />
                </summary>
                <div className="work-member-details">
                  {work.state.agents.map((agent) => (
                    <div key={agent.instanceId}>
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.role === "coordinator" ? "协调者" : "专家"} ·{" "}
                        {agent.instanceId}
                      </small>
                      <p>{agent.capability}</p>
                    </div>
                  ))}
                  {work.state.ownerUserId === user?.id && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void command({
                          type: "bind",
                          instanceId: bindingId,
                          role: bindingRole,
                        });
                      }}
                    >
                      <label>
                        分配已有实例
                        <select
                          value={bindingId}
                          onChange={(event) => setBindingId(event.target.value)}
                        >
                          <option value="">选择已授权、已就绪的实例</option>
                          {candidates.data?.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        职责
                        <select
                          value={bindingRole}
                          onChange={(event) =>
                            setBindingRole(
                              event.target.value as typeof bindingRole,
                            )
                          }
                        >
                          <option value="coordinator">协调者</option>
                          <option value="expert">专家</option>
                        </select>
                      </label>
                      <Button size="sm" disabled={!bindingId || busy}>
                        分配
                      </Button>
                      {!candidates.data?.length && (
                        <p>
                          这个 Project
                          还是空的，尚未配置可运行的专家。可以先记录目标与想法；配置就绪后继续执行。
                        </p>
                      )}
                    </form>
                  )}
                </div>
              </details>
            </section>
            <div className="work-messages" aria-label="工作群聊天">
              {!work.messages.length && (
                <div className="work-empty">
                  <MessageSquare />
                  <h2>先说说你的想法</h2>
                  <p>目标、讨论和成果会留在这里。简单问题不必变成任务。</p>
                </div>
              )}
              {work.messages.map((message) => (
                <article
                  key={message.id}
                  id={`message-${message.id}`}
                  tabIndex={-1}
                  className={`work-message ${isOwnWorkMessage(message, user?.id ?? "") ? "own" : ""}`}
                >
                  <span
                    className={`work-avatar ${message.kind === "agent" ? "agent" : ""}`}
                  >
                    {message.name.slice(0, 1)}
                  </span>
                  <div>
                    <div className="work-message-author">
                      <strong>{message.name}</strong>
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {message.kind === "agent" && <small>Agent</small>}
                    </div>
                    <p>{message.text}</p>
                    {work.state.tasks
                      .filter((task) => task.sourceMessageId === message.id)
                      .map((task) => (
                        <button
                          className="work-reference"
                          key={task.id}
                          onClick={() => {
                            void command({ type: "view", view: "board" });
                            document.getElementById(`task-${task.id}`)?.focus();
                          }}
                        >
                          <span>{task.id}</span>
                          {task.title}
                          <ChevronRight size={14} />
                        </button>
                      ))}
                  </div>
                </article>
              ))}
              <div ref={messageEnd} />
            </div>
            <div className="work-compose-area">
              {work.runs[0] && work.runs[0].status !== "succeeded" && (
                <div className="work-run-status" role="status">
                  <strong>
                    {runLabels[work.runs[0].status] ?? work.runs[0].status}
                  </strong>
                  <span>
                    {work.runs[0].reason ?? "任务已持久化；Worker 就绪后继续。"}
                  </span>
                </div>
              )}
              {error && (
                <p className="work-error" role="alert">
                  {error}
                </p>
              )}
              {activeRuns.map((run) => (
                <button
                  key={run.id}
                  className="work-stop"
                  disabled={busy || run.status === "cancel_requested"}
                  onClick={() =>
                    void command({ type: "cancel", runId: run.id })
                  }
                >
                  <Square size={12} />
                  {run.status === "cancel_requested"
                    ? "停止请求已提交"
                    : "停止本次执行"}
                </button>
              ))}
              {work.runs
                .filter((run) => run.status === "outcome_unknown")
                .map((run) => (
                  <button
                    key={run.id}
                    className="work-stop"
                    onClick={() => {
                      setReviewRunId(run.id);
                      setReviewEvidence("");
                    }}
                  >
                    核查{run.kind === "plan" ? "规划" : run.taskId}的执行与计费
                    →
                  </button>
                ))}
              <form
                className="work-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void command({ type: "message", text, source: "text" }).then(
                    (ok) => {
                      if (ok) setText("");
                    },
                  );
                }}
              >
                <textarea
                  aria-label="发送工作群消息"
                  placeholder="和这个工作群说说你的想法…"
                  value={text}
                  maxLength={8000}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    )
                      event.currentTarget.form?.requestSubmit();
                  }}
                />
                <div>
                  <small>⌘ Enter 发送 · 语音：后续版本</small>
                  <button
                    type="submit"
                    className="work-send"
                    disabled={busy || !text.trim()}
                    aria-label="发送消息"
                  >
                    <ArrowUp size={21} />
                  </button>
                </div>
              </form>
              <div className="work-compose-footer">
                <span>规划与生成草稿各调用一次模型，计入 Project 用量。</span>
                {lastIntent && (
                  <button
                    disabled={
                      busy ||
                      !coordinator ||
                      activeRuns.some((r) => r.kind === "plan")
                    }
                    title={
                      !coordinator
                        ? "请在群成员中分配协调者"
                        : "授权一次模型调用，仅处理本工作群上下文"
                    }
                    onClick={() =>
                      void command({
                        type: "plan",
                        sourceMessageId: lastIntent.id,
                      })
                    }
                  >
                    请协调者规划 →
                  </button>
                )}
              </div>
            </div>
          </main>
          {view !== "chat" && (
            <section className="work-deliverables" aria-label="任务与产物">
              <header className="work-header">
                <div className="work-tabs">
                  <button
                    aria-pressed={view === "board"}
                    onClick={() =>
                      void command({ type: "view", view: "board" })
                    }
                  >
                    任务看板 <span>{work.state.tasks.length}</span>
                  </button>
                  <button
                    aria-pressed={view === "artifacts"}
                    onClick={() =>
                      void command({ type: "view", view: "artifacts" })
                    }
                  >
                    产物 <span>{work.state.artifacts.length}</span>
                  </button>
                </div>
                <button
                  aria-label="收起右侧面板"
                  onClick={() => void command({ type: "view", view: "chat" })}
                >
                  <X size={18} />
                </button>
              </header>
              {view === "board" ? (
                <div
                  className="work-board"
                  tabIndex={0}
                  aria-label="任务看板，可横向滚动"
                >
                  {columns.map((column) => (
                    <section className="work-column" key={column.name}>
                      <h2>
                        <i data-color={column.color} />
                        {column.name}
                        <span>
                          {
                            work.state.tasks.filter((t) =>
                              column.statuses.includes(t.status),
                            ).length
                          }
                        </span>
                      </h2>
                      {work.state.tasks
                        .filter((t) => column.statuses.includes(t.status))
                        .map((task) => (
                          <article
                            key={task.id}
                            id={`task-${task.id}`}
                            tabIndex={-1}
                            className={`work-task ${task.status === "running" ? "active" : ""}`}
                          >
                            <small>{task.id}</small>
                            <h3>{task.title}</h3>
                            {["deferred", "cancelled"].includes(
                              task.status,
                            ) && (
                              <span className="work-tag">
                                {task.status === "deferred" ? "暂缓" : "已取消"}
                              </span>
                            )}
                            <p>{task.reason}</p>
                            <p className="work-task-owner">
                              {work.state.agents.find(
                                (a) => a.instanceId === task.ownerInstanceId,
                              )?.name ?? "尚未分配负责人"}
                            </p>
                            <details>
                              <summary>验收与依赖</summary>
                              <p>{task.acceptance}</p>
                              <p>
                                {task.dependencies.length
                                  ? task.dependencies.join("、")
                                  : "没有前置依赖"}
                              </p>
                            </details>
                            <button
                              className="work-reference"
                              onClick={() => showSource(task)}
                            >
                              <MessageSquare size={14} />
                              返回讨论
                              <ChevronRight size={14} />
                            </button>
                            {work.state.artifacts
                              .filter((a) => a.taskId === task.id)
                              .map((a) => (
                                <button
                                  className="work-reference"
                                  key={a.id}
                                  onClick={() => {
                                    setArtifactId(a.id);
                                    setEvidence("");
                                  }}
                                >
                                  <FileText size={14} />
                                  {a.title} · v{a.version}
                                  <ChevronRight size={14} />
                                </button>
                              ))}
                            {["todo", "decision"].includes(task.status) && (
                              <button
                                className="work-task-run"
                                disabled={
                                  busy ||
                                  !task.ownerInstanceId ||
                                  task.dependencies.some(
                                    (id) =>
                                      work.state.tasks.find((t) => t.id === id)
                                        ?.status !== "done",
                                  )
                                }
                                onClick={() =>
                                  void command({
                                    type: "execute",
                                    taskId: task.id,
                                  })
                                }
                              >
                                授权生成草稿 →
                              </button>
                            )}
                          </article>
                        ))}
                      {!work.state.tasks.some((t) =>
                        column.statuses.includes(t.status),
                      ) && (
                        <p className="work-column-empty">
                          {column.name === "待开始"
                            ? "需要交付时，再安排任务"
                            : "暂无任务"}
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="work-artifacts">
                  {!work.state.artifacts.length && (
                    <div className="work-empty">
                      <FileText />
                      <h2>成果会汇集到这里</h2>
                      <p>草稿经过验证后，再确认交付。</p>
                    </div>
                  )}
                  {work.state.artifacts.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setArtifactId(a.id);
                        setEvidence("");
                      }}
                    >
                      <FileText />
                      <span>
                        <strong>{a.title}</strong>
                        <small>
                          v{a.version} ·{" "}
                          {a.status === "draft"
                            ? "草稿"
                            : a.status === "verified"
                              ? "已验证"
                              : "已交付"}
                        </small>
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              )}
              <section className="work-recent">
                <h2>
                  最近变化 <small>记录到 #{work.revision}</small>
                </h2>
                <div>
                  {work.events.slice(-3).map((event) => (
                    <article key={event.sequence}>
                      <small>#{event.sequence}</small>
                      <p>{event.summary}</p>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          )}
        </>
      )}
      <Dialog
        open={!!reviewRunId}
        onOpenChange={(open) => {
          if (!open) setReviewRunId(null);
        }}
      >
        <DialogContent className="work-dialog">
          <DialogHeader>
            <DialogTitle>核查执行结果</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reviewRunId)
                void command({
                  type: "resolve_unknown",
                  runId: reviewRunId,
                  evidence: reviewEvidence,
                }).then((ok) => {
                  if (ok) setReviewRunId(null);
                });
            }}
          >
            <p>
              先在 Provider / Project
              用量记录中核实这次请求的结果与费用。记录证据后结束本次尝试；不会自动重试，也不会将任务标为完成。
            </p>
            <p>执行编号：{reviewRunId}</p>
            <label>
              核查依据
              <textarea
                required
                maxLength={8000}
                value={reviewEvidence}
                onChange={(event) => setReviewEvidence(event.target.value)}
                placeholder="填写查询位置、请求记录与核查结论。"
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy || !reviewEvidence.trim()}>
              已核查，结束本次尝试
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="work-dialog">
          <DialogHeader>
            <DialogTitle>开始一件工作</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              工作群名称
              <input
                required
                value={title}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：新产品发布准备"
              />
            </label>
            <label>
              希望达成什么？
              <textarea
                required
                value={goal}
                maxLength={8000}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="说明目标、已有背景和你期待的结果。"
              />
            </label>
            <p>{onboarding.data?.status === "READY" ? "协调者和专家会自动加入。先描述目标，再请协调者规划任务。" : "先创建讨论空间；需要交付时，再请协调者拆分任务。"}</p>
            {onboarding.data?.status === "READY" && <label className="work-start-planning"><input type="checkbox" checked={startPlanning} onChange={(event) => setStartPlanning(event.target.checked)} />创建后请协调者规划（一次模型调用）</label>}
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy || !title.trim() || !goal.trim()}>
              {busy ? "正在创建…" : "创建工作群"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!artifact}
        onOpenChange={(open) => {
          if (!open) setArtifactId(null);
        }}
      >
        <DialogContent className="work-dialog work-artifact-dialog">
          <DialogHeader>
            <DialogTitle>
              {artifact?.title} · v{artifact?.version}
            </DialogTitle>
          </DialogHeader>
          {artifact && (
            <>
              <p className="work-caption">
                {artifact.status === "draft"
                  ? "草稿 · 尚未验证"
                  : artifact.status === "verified"
                    ? "已验证 · 待交付"
                    : "已确认交付"}{" "}
                · {artifact.taskId}
              </p>
              <div className="work-artifact-content">{artifact.content}</div>
              <details>
                <summary>来源与证据</summary>
                <p>
                  实例：{artifact.instanceId}
                  <br />
                  执行：{artifact.runId}
                  <br />
                  来源消息：{artifact.sourceMessageId}
                </p>
                <p>{artifact.evidence || "尚无验证证据"}</p>
              </details>
              {artifact.status === "draft" && (
                <>
                  <label>
                    记录你的验证证据
                    <textarea
                      value={evidence}
                      onChange={(event) => setEvidence(event.target.value)}
                      placeholder="说明检查了什么，哪些验收标准已满足。"
                    />
                  </label>
                  <Button
                    disabled={busy || !evidence.trim()}
                    onClick={() =>
                      void command({
                        type: "verify",
                        artifactId: artifact.id,
                        evidence,
                      })
                    }
                  >
                    <Check />
                    记录验证
                  </Button>
                </>
              )}
              {artifact.status === "verified" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void command({ type: "deliver", artifactId: artifact.id })
                  }
                >
                  确认交付
                </Button>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
