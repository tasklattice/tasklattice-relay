import { describe, expect, it } from "vitest";
import {
  availableCapabilityIds,
  changeSpecializationSelection,
  previewSpecializationChange,
  reconcileCapabilitySelection,
  specializationSelections,
  updateCapabilitySelection,
} from "./capability-selection";

describe("capability selection sources", () => {
  it("keeps only Toolbox preset items that are available in the current Project", () => {
    expect(availableCapabilityIds(
      ["workday", "missing-server", "workday"],
      ["workday", "github"],
    )).toEqual(["workday"]);
  });

  it("removes selections when their catalog resources disappear", () => {
    expect(reconcileCapabilitySelection([
      { id: "workday", source: "specialization" },
      { id: "missing-server", source: "manual" },
    ], ["workday"])).toEqual([
      { id: "workday", source: "specialization" },
    ]);
  });

  it("marks newly selected capabilities as manual and preserves existing sources", () => {
    expect(updateCapabilitySelection(
      specializationSelections(["policy-search", "onboarding"]),
      ["policy-search", "data-extraction"],
    )).toEqual([
      { id: "policy-search", source: "specialization" },
      { id: "data-extraction", source: "manual" },
    ]);
  });

  it("replaces preset items while preserving manual additions", () => {
    expect(changeSpecializationSelection([
      { id: "policy-search", source: "specialization" },
      { id: "data-extraction", source: "manual" },
    ], ["web-research", "citation-builder", "data-extraction"])).toEqual([
      { id: "data-extraction", source: "manual" },
      { id: "web-research", source: "specialization" },
      { id: "citation-builder", source: "specialization" },
    ]);
  });

  it("describes remove, add, and keep effects before a preset change", () => {
    expect(previewSpecializationChange([
      { id: "policy-search", source: "specialization" },
      { id: "onboarding", source: "specialization" },
      { id: "data-extraction", source: "manual" },
    ], ["web-research", "citation-builder"])).toEqual({
      remove: ["policy-search", "onboarding"],
      add: ["web-research", "citation-builder"],
      keep: ["data-extraction"],
    });
  });
});
