import type {
  AgentPlatformId,
  HttpEndpoint,
  RunnerHealth,
  RunnerSandbox,
  SandboxAuditEvent,
  RunnerRuntimeTarget,
} from "@tali/contracts";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";

export interface CreateSandboxInput {
  name: string;
  agentPlatform: AgentPlatformId;
  providerName: string;
  model: string;
  inferenceEndpoint: string;
  policyYaml: string;
  systemPrompt: string;
  apiKey?: string;
  instanceId: string;
  projectRuntimeBridgeToken?: string;
  durableMemoryEnabled?: boolean;
  sandboxImage?: string;
  sandboxResources?: {
    cpu?: string;
    memory?: string;
  };
  runTelemetry: {
    endpoint: string;
    token: string;
  };
  memory?:
    | {
        mode: "native";
        citations: "auto" | "on" | "off";
      }
    | {
        mode: "hybrid";
        embeddingModel: string;
        includeSessionTranscripts: boolean;
        citations: "auto" | "on" | "off";
        maxResults: number;
        minScore: number;
      };
}

export type { RunnerRuntimeTarget } from "@tali/contracts";

export interface RunnerClient {
  createSandbox(
    input: CreateSandboxInput,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox>;
  getSandbox(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox>;
  getSandboxInteraction(
    name: string,
    agentPlatform: AgentPlatformId,
    subject: string,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<HttpEndpoint>;
  getSandboxAudit(
    name: string,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<SandboxAuditEvent[]>;
  destroySandbox(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox>;
  getHealth(): Promise<RunnerHealth>;
  terminalWebSocketUrl(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<string>;
  authorizationHeaders(): Promise<Record<string, string>>;
}

export class NemoClawRunnerClient implements RunnerClient {
  constructor(
    private readonly baseUrlOverride?: string,
    private readonly tokenOverride?: string,
  ) {}

  private async connection(): Promise<{ baseUrl: string; token: string }> {
    const runtime = this.baseUrlOverride !== undefined && this.tokenOverride !== undefined
      ? undefined
      : await loadPlatformRuntimeConfiguration();
    const baseUrl = (this.baseUrlOverride ?? runtime?.runner.url ?? "").replace(/\/$/, "");
    const token = this.tokenOverride ?? runtime?.runner.token ?? "";
    if (!baseUrl || !token) {
      throw new Error(
        "Runner is not configured. Validate and save Runtime Connections in Platform Setting.",
      );
    }
    return { baseUrl, token };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 15_000,
  ): Promise<T> {
    const { baseUrl, token } = await this.connection();
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await response.json()) as T | { error: string };
    if (!response.ok) {
      throw new Error(
        "error" in (payload as object)
          ? (payload as { error: string }).error
          : `Runner returned ${response.status}`,
      );
    }
    return payload as T;
  }

  createSandbox(
    input: CreateSandboxInput,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox> {
    return this.request<RunnerSandbox>("/v1/sandboxes", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        ...(runtimeTarget ? { runtimeTarget } : {}),
      }),
    });
  }

  getSandbox(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox> {
    const query = new URLSearchParams({ agentPlatform });
    if (runtimeTarget) query.set("runtimeTarget", runtimeTarget.namespace);
    return this.request<RunnerSandbox>(
      `/v1/sandboxes/${encodeURIComponent(name)}?${query}`,
    );
  }

  getSandboxInteraction(
    name: string,
    agentPlatform: AgentPlatformId,
    subject: string,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<HttpEndpoint> {
    const query = new URLSearchParams({ agentPlatform, subject });
    if (runtimeTarget) query.set("runtimeTarget", runtimeTarget.namespace);
    return this.request<HttpEndpoint>(
      `/v1/sandboxes/${encodeURIComponent(name)}/interaction?${query}`,
    );
  }

  async getSandboxAudit(
    name: string,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<SandboxAuditEvent[]> {
    const query = new URLSearchParams();
    if (runtimeTarget) query.set("runtimeTarget", runtimeTarget.namespace);
    return (
      await this.request<{ data: SandboxAuditEvent[] }>(
        `/v1/sandboxes/${encodeURIComponent(name)}/audit${query.size ? `?${query}` : ""}`,
      )
    ).data;
  }

  destroySandbox(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<RunnerSandbox> {
    const query = new URLSearchParams({ agentPlatform });
    if (runtimeTarget) query.set("runtimeTarget", runtimeTarget.namespace);
    return this.request<RunnerSandbox>(
      `/v1/sandboxes/${encodeURIComponent(name)}?${query}`,
      { method: "DELETE" },
      90_000,
    );
  }

  getHealth(): Promise<RunnerHealth> {
    return this.request<RunnerHealth>("/health");
  }

  async terminalWebSocketUrl(
    name: string,
    agentPlatform: AgentPlatformId,
    runtimeTarget?: RunnerRuntimeTarget,
  ): Promise<string> {
    const { baseUrl } = await this.connection();
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/v1/sandboxes/${encodeURIComponent(name)}/terminal`;
    url.searchParams.set("agentPlatform", agentPlatform);
    if (runtimeTarget)
      url.searchParams.set("runtimeTarget", runtimeTarget.namespace);
    return url.toString();
  }

  async authorizationHeaders(): Promise<Record<string, string>> {
    const { token } = await this.connection();
    return { authorization: `Bearer ${token}` };
  }
}
