import type { ExpertAgentDefinitionInput } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { createInitialAgentDefinition } from "./create-agent-definition";
import {
  bindAgentResource,
  developerInstruction,
  patchAgentProduct,
  removeAgentResource,
} from "./agent-development-model";

function definition(): ExpertAgentDefinitionInput {
  return createInitialAgentDefinition({
    executionMode: "AGENTIC",
    name: "Release analyst",
    purpose: "Evaluate release risk from approved evidence without inventing signals.",
  });
}

describe("Agent development model", () => {
  it("keeps Purpose out of new developer instructions", () => {
    const value = definition();
    expect(developerInstruction(value)).not.toContain(value.product.purpose);
    expect(developerInstruction(value)).not.toContain("UNKNOWN");
  });

  it("removes the legacy Product purpose prefix without changing Behavior", () => {
    const value = definition();
    const legacy = {
      ...value,
      execution: {
        ...value.execution,
        instruction: [
          `Product purpose: ${value.product.purpose}`,
          "Use only capabilities and resources that are explicitly bound to this Agent.",
          "Return UNKNOWN or request more information instead of inventing facts.",
          "Group results by repository.",
        ].join("\n\n"),
      },
    } as ExpertAgentDefinitionInput;
    expect(developerInstruction(legacy)).toBe("Group results by repository.");
    expect(patchAgentProduct(legacy, { purpose: "A new purpose" })).toMatchObject({
      product: { purpose: "A new purpose" },
      execution: { instruction: "Group results by repository." },
    });
  });

  it("keeps Model Routing binding and execution routing in sync", () => {
    const bound = bindAgentResource(definition(), {
      kind: "MODEL_ROUTING",
      resourceId: "project-default",
      name: "Project default",
      status: "READY",
      ready: true,
      revision: "sha256:abc",
      detail: "balanced",
    });
    expect(bound.resources).toContainEqual(expect.objectContaining({
      kind: "MODEL_ROUTING",
      resourceId: "project-default",
      access: "INVOKE",
    }));
    expect(bound.execution).toMatchObject({ modelRoutingId: "project-default" });

    const removed = removeAgentResource(bound, {
      kind: "MODEL_ROUTING",
      resourceId: "project-default",
    });
    expect(removed.resources).toHaveLength(0);
    expect(removed.execution).toMatchObject({ modelRoutingId: "unassigned-model-routing" });
  });
});
