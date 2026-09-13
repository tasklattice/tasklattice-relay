import type {
  ExpertAgentDefinitionInput,
  ExpertAgentResourceBinding,
} from "@tali/contracts";
import type { ExpertAgentAvailableResource } from "./expert-agent-types";

type ProductPatch = Partial<ExpertAgentDefinitionInput["product"]>;

const defaultDeveloperInstruction =
  "Reason and respond using the request context and resources bound to this Agent.";

const legacyGeneratedInstructionParagraphs = new Set([
  "Use only capabilities and resources that are explicitly bound to this Agent.",
  "Return UNKNOWN or request more information instead of inventing facts.",
]);

export function developerInstruction(definition: ExpertAgentDefinitionInput): string {
  if (definition.execution.mode !== "AGENTIC") return "";
  const prefix = `Product purpose: ${definition.product.purpose}`;
  const withoutPurpose = definition.execution.instruction.startsWith(prefix)
    ? definition.execution.instruction.slice(prefix.length).trimStart()
    : definition.execution.instruction;
  const developerAuthored = withoutPurpose
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !legacyGeneratedInstructionParagraphs.has(paragraph))
    .join("\n\n");
  return developerAuthored || defaultDeveloperInstruction;
}

export function patchDeveloperInstruction(
  definition: ExpertAgentDefinitionInput,
  instruction: string,
): ExpertAgentDefinitionInput {
  if (definition.execution.mode !== "AGENTIC") return definition;
  return {
    ...definition,
    execution: { ...definition.execution, instruction },
  };
}

export function patchAgentProduct(
  definition: ExpertAgentDefinitionInput,
  patch: ProductPatch,
): ExpertAgentDefinitionInput {
  const next = {
    ...definition,
    product: { ...definition.product, ...patch },
  };
  if (patch.purpose === undefined || definition.execution.mode !== "AGENTIC") {
    return next;
  }
  const instruction = developerInstruction(definition);
  return {
    ...next,
    execution: { ...definition.execution, instruction },
  };
}

function bindingAccess(kind: ExpertAgentAvailableResource["kind"]): ExpertAgentResourceBinding["access"] {
  return kind === "MODEL_ROUTING" ? "INVOKE" : "READ";
}

export function bindAgentResource(
  definition: ExpertAgentDefinitionInput,
  resource: ExpertAgentAvailableResource,
): ExpertAgentDefinitionInput {
  if (!resource.revision) return definition;
  const binding: ExpertAgentResourceBinding = {
    kind: resource.kind,
    resourceId: resource.resourceId,
    revision: resource.revision,
    access: bindingAccess(resource.kind),
    required: true,
  };
  const resources = definition.resources.filter((item) =>
    resource.kind === "MODEL_ROUTING"
      ? item.kind !== "MODEL_ROUTING"
      : !(item.kind === resource.kind && item.resourceId === resource.resourceId)
  );
  const next = { ...definition, resources: [...resources, binding] };
  if (resource.kind !== "MODEL_ROUTING" || next.execution.mode !== "AGENTIC") {
    return next;
  }
  return {
    ...next,
    execution: { ...next.execution, modelRoutingId: resource.resourceId },
  };
}

export function removeAgentResource(
  definition: ExpertAgentDefinitionInput,
  binding: Pick<ExpertAgentResourceBinding, "kind" | "resourceId">,
): ExpertAgentDefinitionInput {
  const next = {
    ...definition,
    resources: definition.resources.filter((item) =>
      !(item.kind === binding.kind && item.resourceId === binding.resourceId)
    ),
  };
  if (
    binding.kind !== "MODEL_ROUTING"
    || next.execution.mode !== "AGENTIC"
    || next.execution.modelRoutingId !== binding.resourceId
  ) {
    return next;
  }
  return {
    ...next,
    execution: { ...next.execution, modelRoutingId: "unassigned-model-routing" },
  };
}
