import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import { LangGraphPlaybookRuntime } from "../langgraph-playbook-runtime.js";

type SupportPlaybook = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;

interface SupportRouteState {
  normalizedText: string;
  category: "BILLING" | "SECURITY" | "GENERAL" | null;
  team: string;
  priority: "P1" | "P2" | "P3";
  approvalRequired: boolean;
  approvalStatus: "NOT_REQUIRED" | "PENDING";
  response: string;
}

const supportPlaybook: SupportPlaybook = {
  mode: "WORKFLOW",
  engine: { framework: "langgraph", version: "1.4.13" },
  entrypoint: "normalize-input",
  configuration: { demoType: "SUPPORT_ESCALATION_ROUTER" },
  nodes: [
    { id: "normalize-input", type: "TRANSFORM", configuration: {} },
    { id: "classify-case", type: "REASON", configuration: {} },
    { id: "policy-check", type: "VERIFY", configuration: {} },
    { id: "approval-gate", type: "APPROVAL", configuration: {} },
    { id: "response-handoff", type: "RESPONSE", configuration: {} },
    { id: "request-more-information", type: "RESPONSE", configuration: {} },
    { id: "end", type: "END", configuration: {} },
  ],
  transitions: [
    { from: "normalize-input", outcome: "NORMALIZED", to: "classify-case" },
    { from: "normalize-input", outcome: "EMPTY", to: "request-more-information" },
    { from: "classify-case", outcome: "BILLING", to: "policy-check" },
    { from: "classify-case", outcome: "SECURITY", to: "policy-check" },
    { from: "classify-case", outcome: "GENERAL", to: "policy-check" },
    { from: "policy-check", outcome: "APPROVAL_REQUIRED", to: "approval-gate" },
    { from: "policy-check", outcome: "DIRECT", to: "response-handoff" },
    { from: "approval-gate", outcome: "PENDING_APPROVAL", to: "response-handoff" },
    { from: "response-handoff", outcome: "RESPONDED", to: "end" },
    { from: "request-more-information", outcome: "RESPONDED", to: "end" },
  ],
  timeoutMs: 10_000,
};

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export async function runLangGraphSupportDemo(prompt: string) {
  const initialState: SupportRouteState = {
    normalizedText: "",
    category: null,
    team: "General Support",
    priority: "P3",
    approvalRequired: false,
    approvalStatus: "NOT_REQUIRED",
    response: "",
  };
  const runtime = new LangGraphPlaybookRuntime<SupportRouteState>({
    TRANSFORM: async ({ state }) => {
      const normalizedText = normalized(prompt);
      return {
        outcome: normalizedText ? "NORMALIZED" : "EMPTY",
        state: { ...state, normalizedText },
      };
    },
    REASON: async ({ state }) => {
      const billing = containsAny(state.normalizedText, [
        "billing", "invoice", "refund", "credit", "账单", "发票", "退款", "扣费",
      ]);
      const security = containsAny(state.normalizedText, [
        "security", "breach", "credential", "安全", "泄露", "攻击", "凭据",
      ]);
      const outage = containsAny(state.normalizedText, [
        "outage", "production", "down", "故障", "宕机", "生产事故",
      ]);
      const enterprise = containsAny(state.normalizedText, [
        "enterprise", "vip", "strategic", "企业", "大客户", "重点客户",
      ]);
      const category = billing ? "BILLING" : security ? "SECURITY" : "GENERAL";
      const team = billing
        ? enterprise ? "Enterprise Support → Billing Operations" : "Billing Operations"
        : security
          ? "Security Response"
          : enterprise
            ? "Enterprise Support"
            : "General Support";
      const priority = outage && enterprise ? "P1" : outage || security ? "P2" : "P3";
      return {
        outcome: category,
        state: { ...state, category, team, priority },
        attributes: { category, priority },
      };
    },
    VERIFY: async ({ state }) => {
      const approvalRequired = state.category === "BILLING";
      return {
        outcome: approvalRequired ? "APPROVAL_REQUIRED" : "DIRECT",
        state: { ...state, approvalRequired },
        attributes: { approvalRequired },
      };
    },
    APPROVAL: async ({ state }) => ({
      outcome: "PENDING_APPROVAL",
      state: { ...state, approvalStatus: "PENDING" },
      attributes: { approvalStatus: "PENDING" },
    }),
    RESPONSE: async ({ node, state }) => {
      if (node.id === "request-more-information") {
        return {
          outcome: "RESPONDED",
          state: {
            ...state,
            response: "Please add the affected service, customer tier, impact, and requested action before routing this case.",
          },
        };
      }
      const approvalLine = state.approvalRequired
        ? "Approval gate: a billing owner must approve any credit or refund before it is applied."
        : "Approval gate: no financial approval is required for the routing action."
      return {
        outcome: "RESPONDED",
        state: {
          ...state,
          response: [
            "LangGraph support routing result",
            "",
            `Route: ${state.team}`,
            `Category: ${state.category ?? "GENERAL"}`,
            `Priority: ${state.priority}`,
            approvalLine,
            "Next action: acknowledge the case now and attach the responsible team's reviewed remediation plan.",
            "",
            "This run executed a real LangGraph StateGraph with deterministic demo policy data; it did not change an external ticket or account.",
          ].join("\n"),
        },
        attributes: {
          approvalRequired: state.approvalRequired,
          route: state.team,
        },
      };
    },
  });
  const result = await runtime.execute({
    execution: supportPlaybook,
    initialState,
  });
  return {
    text: result.state.response,
    traceEvents: result.trace,
    data: {
      category: result.state.category,
      team: result.state.team,
      priority: result.state.priority,
      approvalRequired: result.state.approvalRequired,
      approvalStatus: result.state.approvalStatus,
      terminalNodeId: result.terminalNodeId,
    },
  };
}
