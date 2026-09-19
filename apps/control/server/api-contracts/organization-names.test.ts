import {
  departmentIdSchema,
  departmentNameSchema,
  projectIdSchema,
  projectNameSchema,
  scopedEntityIdFromName,
} from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { createProjectInputSchema } from "./schemas";

describe("Department and Project naming rules", () => {
  it("normalizes display-name width and spacing without restricting languages", () => {
    expect(departmentNameSchema.parse("  Research\t＆ Development  ")).toBe(
      "Research & Development",
    );
    expect(projectNameSchema.parse("客户支持")).toBe("客户支持");
  });

  it("rejects path separators, control characters, and punctuation-only names", () => {
    for (const name of ["Research/AI", "Research\\AI", "Research\nAI", "---"]) {
      expect(projectNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it("uses stable lowercase path-safe IDs", () => {
    expect(scopedEntityIdFromName("Research & Development")).toBe(
      "research-development",
    );
    expect(departmentIdSchema.parse("engineering-01")).toBe("engineering-01");
    expect(projectIdSchema.parse("agent-platform")).toBe("agent-platform");
    for (const id of ["Agent_Platform", "-agent", "agent-", "a"]) {
      expect(projectIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("accepts Project creation without a client-supplied ID", () => {
    expect(createProjectInputSchema.parse({
      departmentId: "dep1",
      invitations: [],
      name: "AI Platform",
    })).toEqual({
      departmentId: "dep1",
      invitations: [],
      name: "AI Platform",
    });
  });

  it("rejects client-supplied Project IDs, including canonical-looking IDs", () => {
    for (const id of ["agent-platform", "tp-v3i65n4c7jslorbf"]) {
      expect(createProjectInputSchema.safeParse({
        departmentId: "dep1", invitations: [], name: "AI Platform", id,
      }).success).toBe(false);
    }
  });
});
