import { expertAgentDefinitionInputSchema, type ModelRouting, type ExpertAgentDefinitionInput } from "@tali/contracts";

export function personalAgentTemplate(role: "coordinator" | "expert", routing: ModelRouting): ExpertAgentDefinitionInput {
  const coordinator = role === "coordinator";
  const context = coordinator ? {
    goal: "整理已有笔记，形成一个可交付的三点行动清单。",
    intent: "根据以下笔记安排一个任务：客户反馈上手步骤太多，需要简化首次体验。只需要一份行动清单。",
    sourceMessageId: "onboarding-check",
    tasks: [], agents: [{ instanceId: "onboarding-expert", role: "expert", name: "工作专家" }],
  } : {
    task: { title: "整理行动清单", acceptance: "基于给定笔记给出三点可执行建议，并说明它们是建议。" },
    intent: "客户反馈上手步骤太多，需要简化首次体验。只根据此笔记提出建议，不声称做过调研。",
    dependencyArtifacts: [],
  };
  return expertAgentDefinitionInputSchema.parse({
    expectedRevision: 0,
    product: {
      name: coordinator ? "工作协调者" : "工作专家",
      purpose: coordinator ? "把用户的目标整理为可调整的任务计划，分配专家并保留完成记录。" : "根据任务和已有材料整理分析、文本草稿及行动建议，明确证据与未知。",
      targetUsers: ["个人用户与一人公司"],
      capabilities: coordinator ? ["目标澄清", "任务分配", "增量规划"] : ["文本分析", "文档草拟", "证据整理"],
      outOfScope: ["浏览器、文件、代码执行及对外写入", "缺乏证据时声称已验证"],
      inputContract: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      outputContract: { type: "object", required: ["outcome", "text", "citations"], properties: { outcome: { type: "string" }, text: { type: "string" }, citations: { type: "array" }, data: { type: "object" } } },
    },
    policy: { preset: "FLEXIBLE", groundingPolicy: "OPTIONAL", outputMode: "STRUCTURED", actionPolicy: "APPROVAL" },
    delegations: [],
    acceptance: {
      minimumRequiredPassRate: 1,
      cases: [{ id: "work-text", title: "根据给定材料输出有效结构", kind: "HAPPY_PATH", given: "只有给定用户笔记", when: "请求一个文本交付物", then: ["返回有效结构且不调用外部工具"], required: true,
        request: { text: JSON.stringify(context), metadata: {} },
        assertions: [{ type: "STATUS", expected: "ANSWER" }, { type: "OUTPUT_SCHEMA", schema: { type: "object", required: ["outcome", "text", "data"], properties: { outcome: { const: "COMPLETED" }, data: { type: "object", required: ["workResult"] } } } }, { type: "EXECUTION_PATH", requiredNodeIds: ["work.model"], forbiddenNodeIds: [] }],
      }],
      suites: [{ id: "work-readiness", name: "Work readiness", description: "真实模型的结构输出验证；不代表领域正确性认证。", required: true, caseIds: ["work-text"] }],
    },
    safety: {
      guardrails: [{ id: "context-only", category: "TOOL_USE", rule: "Only model completion using supplied context is allowed; no external tools.", violationBehavior: "REJECT", required: true }],
      prohibitedBehaviors: ["Inventing external execution or verified evidence"], noEvidenceBehavior: "UNKNOWN", allowGeneralModelFallback: false,
    },
    execution: { mode: "AGENTIC", engine: { framework: "relay-work-text", version: "1" }, modelRoutingId: routing.id,
      instruction: coordinator ? "你是工作协调者，依据用户意图更新计划，用最少必要的任务推进交付。保留已有成果，解释变更原因。" : "你是工作专家，依据提供的任务、用户材料和验收标准完成文本草稿。将建议、事实和缺失证据区分清楚。",
      configuration: { engineType: "WORK_TEXT", workRole: role, developmentStatus: "IMPLEMENTED" }, maxSteps: 1, timeoutMs: 60000,
    },
    resources: [{ kind: "MODEL_ROUTING", resourceId: routing.id, revision: routing.configurationHash.startsWith("sha256:") ? routing.configurationHash : `sha256:${routing.configurationHash}`, access: "INVOKE", required: true }],
  });
}
