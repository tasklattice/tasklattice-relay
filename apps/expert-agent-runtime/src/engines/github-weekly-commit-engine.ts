import type { ExpertAgentVersionSnapshot } from "@tali/contracts";
import { z } from "zod";
import type {
  ExpertAgentEngine,
  ExpertAgentExecutionResult,
  ExpertAgentTraceEvent,
} from "../runtime-types.js";

const configurationSchema = z.object({
  engineType: z.literal("GITHUB_WEEKLY_COMMIT_SUMMARIZER"),
  owner: z.string().trim().min(1).max(120),
  repo: z.string().trim().min(1).max(120),
  branch: z.string().trim().min(1).max(240).nullable().default(null),
  timeZone: z.string().trim().min(1).max(120).default("Asia/Shanghai"),
  githubMcpServerId: z.string().trim().min(1).max(240),
  allowedRepositories: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
  locale: z.literal("zh-CN").default("zh-CN"),
  developmentStatus: z.enum(["DESIGN", "IMPLEMENTED"]).optional(),
  requiredProjectResources: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
}).strict();

const requestOptionsSchema = z.object({
  githubId: z.string().trim().min(1).max(240).optional(),
  period: z.enum(["DAY", "WEEK"]).default("WEEK"),
  repository: z.string().trim().min(3).max(300).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  repo: z.string().trim().min(1).max(120).optional(),
  since: z.string().trim().min(1).max(100).optional(),
  until: z.string().trim().min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(240).nullable().optional(),
  author: z.string().trim().min(1).max(240).nullable().optional(),
  grouping: z.enum(["NONE", "DAY", "WEEK", "AUTHOR"]).default("WEEK"),
}).strip();

const groundedSummarySchema = z.object({
  headline: z.string().trim().min(1).max(240),
  themes: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(1_000),
    commitShas: z.array(z.string().min(7).max(64)).max(100),
  }).strict()).max(12),
  risks: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(1_000),
    evidenceShas: z.array(z.string().min(7).max(64)).min(1).max(100),
  }).strict()).max(12),
}).strict();

export interface NormalizedGitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authoredAt: string;
  url: string | null;
  isMerge: boolean;
  isBot: boolean;
}

function trace(
  step: string,
  status: ExpertAgentTraceEvent["status"],
  summary: string,
  attributes: ExpertAgentTraceEvent["attributes"] = {},
): ExpertAgentTraceEvent {
  return { step, status, summary, occurredAt: new Date().toISOString(), attributes };
}

function timeZoneParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekday: part("weekday"),
  };
}

function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day);
  let snapshot = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(snapshot));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    const represented = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    snapshot = desired - (represented - snapshot);
  }
  return new Date(snapshot);
}

export function currentWeekWindow(now: Date, timeZone: string): {
  since: Date;
  until: Date;
} {
  const local = timeZoneParts(now, timeZone);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .indexOf(local.weekday);
  if (weekday < 0) throw new Error(`Unsupported localized weekday ${local.weekday}.`);
  const daysSinceMonday = (weekday + 6) % 7;
  const nominalDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  nominalDate.setUTCDate(nominalDate.getUTCDate() - daysSinceMonday);
  return {
    since: zonedMidnightUtc(
      nominalDate.getUTCFullYear(),
      nominalDate.getUTCMonth() + 1,
      nominalDate.getUTCDate(),
      timeZone,
    ),
    until: now,
  };
}

function requestedWindow(input: {
  since?: string;
  until?: string;
  now: Date;
  period: "DAY" | "WEEK";
  timeZone: string;
}): { since: Date; until: Date } {
  if (!input.since && !input.until) {
    if (input.period === "WEEK") return currentWeekWindow(input.now, input.timeZone);
    const local = timeZoneParts(input.now, input.timeZone);
    return {
      since: zonedMidnightUtc(local.year, local.month, local.day, input.timeZone),
      until: input.now,
    };
  }
  if (!input.since || !input.until) {
    throw new Error("A custom GitHub range requires both since and until.");
  }
  const since = new Date(input.since);
  const until = new Date(input.until);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("GitHub since and until must be valid ISO dates or timestamps.");
  }
  if (since.getTime() > until.getTime()) {
    throw new Error("GitHub since must not be later than until.");
  }
  if (until.getTime() - since.getTime() > 366 * 24 * 60 * 60 * 1_000) {
    throw new Error("A GitHub activity range cannot exceed 366 days.");
  }
  return { since, until };
}

function requestRepository(input: {
  configuredOwner: string;
  configuredRepo: string;
  options: z.infer<typeof requestOptionsSchema>;
  allowedRepositories: string[];
}): { owner: string; repo: string } {
  let owner = input.options.owner ?? input.configuredOwner;
  let repo = input.options.repo ?? input.configuredRepo;
  if (input.options.repository) {
    const parts = input.options.repository.split("/");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new Error("GitHub repository must use owner/repo format.");
    }
    [owner, repo] = parts as [string, string];
  }
  const requested = `${owner}/${repo}`.toLocaleLowerCase();
  const configured = `${input.configuredOwner}/${input.configuredRepo}`.toLocaleLowerCase();
  const allowed = input.allowedRepositories.map((value) => value.toLocaleLowerCase());
  if (requested !== configured && !allowed.includes("*") && !allowed.includes(requested)) {
    throw new Error(`Repository ${owner}/${repo} is outside this Agent Version's allowlist.`);
  }
  return { owner, repo };
}

function groupKey(commit: NormalizedGitHubCommit, grouping: z.infer<typeof requestOptionsSchema>["grouping"]): string {
  if (grouping === "AUTHOR") return commit.author;
  if (grouping === "DAY") return commit.authoredAt.slice(0, 10);
  if (grouping === "WEEK") {
    const date = new Date(commit.authoredAt);
    const weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday);
    return `Week of ${date.toISOString().slice(0, 10)}`;
  }
  return "All activity";
}

function parseJsonText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    throw new Error("GitHub MCP list_commits returned non-JSON text.");
  }
}

function commitArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return commitArray(parseJsonText(value));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (record.isError === true) {
    const message = Array.isArray(record.content)
      ? record.content
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const text = (item as Record<string, unknown>).text;
          return typeof text === "string" ? text.trim() : "";
        })
        .filter(Boolean)
        .join(" ")
      : "";
    throw new Error(message || "GitHub MCP list_commits failed.");
  }
  for (const key of ["commits", "items", "data", "result", "structuredContent"]) {
    if (record[key] !== undefined) {
      const nested = commitArray(record[key]);
      if (nested.length || Array.isArray(record[key])) return nested;
    }
  }
  if (Array.isArray(record.content)) {
    return record.content.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const text = (item as Record<string, unknown>).text;
      return typeof text === "string" ? commitArray(text) : [];
    });
  }
  return [];
}

function stringAt(record: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : null;
}

function normalizeCommit(value: unknown): NormalizedGitHubCommit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sha = stringAt(record, ["sha"]);
  const message = stringAt(record, ["commit", "message"])
    ?? stringAt(record, ["message"]);
  const authoredAt = stringAt(record, ["commit", "author", "date"])
    ?? stringAt(record, ["commit", "committer", "date"])
    ?? stringAt(record, ["authoredAt"]);
  if (!sha || !message || !authoredAt || Number.isNaN(Date.parse(authoredAt))) return null;
  const login = stringAt(record, ["author", "login"]);
  const author = login
    ?? stringAt(record, ["commit", "author", "name"])
    ?? "Unknown";
  const authorType = stringAt(record, ["author", "type"]);
  const parents = Array.isArray(record.parents) ? record.parents : [];
  const firstLine = message.split("\n", 1)[0]!.trim();
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: firstLine,
    author,
    authoredAt: new Date(authoredAt).toISOString(),
    url: stringAt(record, ["html_url"]) ?? stringAt(record, ["url"]),
    isMerge: parents.length > 1 || /^merge\b/i.test(firstLine),
    isBot: authorType === "Bot"
      || /\[bot\]$/i.test(author)
      || /(^|[-_ ])bot($|[-_ ])/i.test(author),
  };
}

function validateGroundedSummary(value: unknown, commits: NormalizedGitHubCommit[]) {
  const parsed = groundedSummarySchema.parse(value);
  const known = new Set(commits.flatMap((commit) => [commit.sha, commit.shortSha]));
  const references = [
    ...parsed.themes.flatMap((theme) => theme.commitShas),
    ...parsed.risks.flatMap((risk) => risk.evidenceShas),
  ];
  if (references.some((sha) => !known.has(sha))) {
    throw new Error("Model summary referenced a commit outside the normalized fact set.");
  }
  return parsed;
}

function renderSummary(input: {
  owner: string;
  repo: string;
  since: Date;
  until: Date;
  commits: NormalizedGitHubCommit[];
  modelSummary: z.infer<typeof groundedSummarySchema> | null;
  grouping: z.infer<typeof requestOptionsSchema>["grouping"];
}): string {
  const merges = input.commits.filter((commit) => commit.isMerge).length;
  const bots = input.commits.filter((commit) => commit.isBot).length;
  const authorCounts = new Map<string, number>();
  input.commits.forEach((commit) => {
    authorCounts.set(commit.author, (authorCounts.get(commit.author) ?? 0) + 1);
  });
  const authors = [...authorCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([author, count]) => `${author}（${count}）`)
    .join("、") || "无";
  const lines = [
    `# ${input.owner}/${input.repo} GitHub 活动摘要`,
    "",
    `统计区间：${input.since.toISOString()} 至 ${input.until.toISOString()}`,
    `提交总数：${input.commits.length}；合并提交：${merges}；Bot 提交：${bots}`,
    `贡献者：${authors}`,
  ];
  if (!input.commits.length) {
    return [...lines, "", "本周当前尚无提交。"].join("\n");
  }
  if (input.modelSummary) {
    lines.push("", `## ${input.modelSummary.headline}`);
    input.modelSummary.themes.forEach((theme) => {
      lines.push(
        `- ${theme.title}：${theme.summary}（证据：${theme.commitShas.join(", ")}）`,
      );
    });
    if (input.modelSummary.risks.length) {
      lines.push("", "## 需要关注");
      input.modelSummary.risks.forEach((risk) => {
        lines.push(
          `- ${risk.title}：${risk.summary}（证据：${risk.evidenceShas.join(", ")}）`,
        );
      });
    }
  }
  lines.push("", "## 提交明细");
  const grouped = new Map<string, NormalizedGitHubCommit[]>();
  input.commits.slice(0, 100).forEach((commit) => {
    const key = groupKey(commit, input.grouping);
    grouped.set(key, [...(grouped.get(key) ?? []), commit]);
  });
  grouped.forEach((commits, key) => {
    if (input.grouping !== "NONE") lines.push(`### ${key}`);
    commits.forEach((commit) => {
      const labels = [commit.isMerge ? "merge" : "", commit.isBot ? "bot" : ""]
        .filter(Boolean).join(", ");
      lines.push(
        `- ${commit.shortSha} ${commit.message} — ${commit.author}${labels ? ` [${labels}]` : ""}`,
      );
    });
  });
  return lines.join("\n");
}

export class GitHubWeeklyCommitEngine implements ExpertAgentEngine {
  readonly mode = "AGENTIC" as const;
  constructor(private readonly now: () => Date = () => new Date()) {}

  supports(snapshot: ExpertAgentVersionSnapshot): boolean {
    return snapshot.execution.mode === "AGENTIC"
      && snapshot.execution.configuration.engineType
        === "GITHUB_WEEKLY_COMMIT_SUMMARIZER";
  }

  async execute(input: Parameters<ExpertAgentEngine["execute"]>[0]): Promise<ExpertAgentExecutionResult> {
    if (input.envelope.snapshot.execution.mode !== "AGENTIC") {
      throw new Error("GitHub Weekly Commit Engine requires AGENTIC execution.");
    }
    const configuration = configurationSchema.parse(
      input.envelope.snapshot.execution.configuration,
    );
    const requestOptions = requestOptionsSchema.parse(
      input.request.metadata.github ?? input.request.metadata,
    );
    const repository = requestRepository({
      configuredOwner: configuration.owner,
      configuredRepo: configuration.repo,
      options: requestOptions,
      allowedRepositories: configuration.allowedRepositories,
    });
    const window = requestedWindow({
      ...(requestOptions.since ? { since: requestOptions.since } : {}),
      ...(requestOptions.until ? { until: requestOptions.until } : {}),
      now: this.now(),
      period: requestOptions.period,
      timeZone: configuration.timeZone,
    });
    const branch = requestOptions.branch === undefined ? configuration.branch : requestOptions.branch;
    const events: ExpertAgentTraceEvent[] = [
      trace("github.list_commits", "STARTED", "Collecting commits from bound GitHub MCP.", {
        owner: repository.owner,
        repo: repository.repo,
        since: window.since.toISOString(),
        until: window.until.toISOString(),
      }),
    ];
    const collected: NormalizedGitHubCommit[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await input.resources.callMcpTool({
        serverId: configuration.githubMcpServerId,
        toolName: "list_commits",
        arguments: {
          owner: repository.owner,
          repo: repository.repo,
          ...(branch ? { sha: branch } : {}),
          ...((requestOptions.githubId ?? requestOptions.author) ? { author: requestOptions.githubId ?? requestOptions.author } : {}),
          since: window.since.toISOString(),
          until: window.until.toISOString(),
          page,
          perPage: 100,
        },
      });
      const pageItems = commitArray(response);
      collected.push(...pageItems.map(normalizeCommit).filter(
        (commit): commit is NormalizedGitHubCommit => commit !== null,
      ));
      if (pageItems.length < 100) break;
      if (page === 100) throw new Error("GitHub commit pagination exceeded 10,000 items.");
    }
    const commits = [...new Map(collected.map((commit) => [commit.sha, commit])).values()]
      .filter((commit) => {
        const timestamp = Date.parse(commit.authoredAt);
        const requestedAuthor = requestOptions.githubId ?? requestOptions.author;
        const authorMatches = !requestedAuthor
          || commit.author.toLocaleLowerCase() === requestedAuthor.toLocaleLowerCase();
        return authorMatches
          && timestamp >= window.since.getTime()
          && timestamp <= window.until.getTime();
      })
      .sort((left, right) => right.authoredAt.localeCompare(left.authoredAt));
    events.push(trace(
      "github.list_commits",
      "COMPLETED",
      "GitHub commits normalized and independently time-filtered.",
      { commitCount: commits.length },
    ));

    let modelSummary: z.infer<typeof groundedSummarySchema> | null = null;
    if (commits.length) {
      events.push(trace("summary.grounded_model", "STARTED", "Generating themes from normalized facts."));
      try {
        const completion = await input.resources.completeModel({
          modelRoutingId: input.envelope.snapshot.execution.modelRoutingId,
          temperature: 0,
          system: [
            "你是工程周报分类器。只能使用输入 JSON 中的提交事实。",
            "不得新增 SHA、作者、数量或日期。所有主题和风险必须引用 commitShas。",
            "只返回符合 JSON Schema 的对象。",
          ].join(" "),
          user: JSON.stringify({
            repository: `${repository.owner}/${repository.repo}`,
            window: {
              since: window.since.toISOString(),
              until: window.until.toISOString(),
            },
            commits,
          }),
          responseJsonSchema: {
            type: "object",
            required: ["headline", "themes", "risks"],
            additionalProperties: false,
            properties: {
              headline: { type: "string" },
              themes: { type: "array" },
              risks: { type: "array" },
            },
          },
        });
        modelSummary = validateGroundedSummary(completion, commits);
        events.push(trace("summary.grounded_model", "COMPLETED", "Grounded model summary validated."));
      } catch (error) {
        events.push(trace(
          "summary.grounded_model",
          "FAILED",
          "Model output failed grounding validation; deterministic facts were retained.",
          { error: error instanceof Error ? error.message.slice(0, 500) : "unknown" },
        ));
      }
    } else {
      events.push(trace("summary.grounded_model", "SKIPPED", "No commits required summarization."));
    }

    const mergeCount = commits.filter((commit) => commit.isMerge).length;
    const botCount = commits.filter((commit) => commit.isBot).length;
    return {
      outcome: "COMPLETED",
      text: renderSummary({
        owner: repository.owner,
        repo: repository.repo,
        since: window.since,
        until: window.until,
        commits,
        modelSummary,
        grouping: requestOptions.grouping,
      }),
      data: {
        grounding: {
          verified: true,
          kind: "TOOL_OUTPUT",
          toolName: "list_commits",
          emptyResult: commits.length === 0,
        },
        repository: `${repository.owner}/${repository.repo}`,
        branch,
        author: requestOptions.githubId ?? requestOptions.author ?? null,
        githubId: requestOptions.githubId ?? requestOptions.author ?? null,
        period: requestOptions.period,
        grouping: requestOptions.grouping,
        timeZone: configuration.timeZone,
        since: window.since.toISOString(),
        until: window.until.toISOString(),
        commitCount: commits.length,
        mergeCount,
        botCount,
        commits,
      },
      citations: commits.map((commit) => ({
        sourceId: commit.sha,
        title: `${commit.shortSha} ${commit.message}`,
        uri: commit.url,
        excerpt: null,
        revision: commit.sha,
      })),
      trace: events,
    };
  }
}
