import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelDeployment, ProviderModelSelection } from "@tali/contracts";
import {
  canSelectModel,
  filterModels,
  registeredModelIds,
} from "./model-selection";
import { ModelDiscoveryStep, SummaryStep } from "./register-models-drawer";

const manual: ProviderModelSelection = {
  modelId: "private/model-v2",
  displayName: "Private model",
  modelType: "llm",
};

describe("Provider model selection", () => {
  it("scopes duplicate detection to the selected Provider, including failed registrations", () => {
    const models = [
      { providerAccountId: "one", modelId: "shared", status: "FAILED" },
      { providerAccountId: "two", modelId: "other", status: "VALIDATED" },
    ] as ModelDeployment[];
    expect([...registeredModelIds(models, "one")]).toEqual(["shared"]);
    expect([...registeredModelIds(models, undefined)]).toEqual([]);
  });
  it("searches both names and IDs without mutating the selection", () => {
    const selected = [manual];
    expect(filterModels(selected, " PRIVATE ")).toEqual(selected);
    expect(filterModels(selected, "MODEL-V2")).toEqual(selected);
    expect(filterModels(selected, "missing")).toEqual([]);
    expect(selected).toEqual([manual]);
  });
  it("rejects blank, duplicate, registered, and overlong manual IDs", () => {
    const registered = new Set(["existing"]);
    for (const id of [" ", " private/model-v2 ", "existing", "x".repeat(161)]) {
      expect(canSelectModel(id, [manual], registered)).toBe(false);
    }
    expect(canSelectModel("new-model", [manual], registered)).toBe(true);
  });
  it("renders manually selected models even when discovery is empty", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelDiscoveryStep, {
        discovery: {
          providerKind: "openai",
          mode: "manual",
          models: [],
          checks: [],
          message: "Manual catalog",
        },
        existingIds: new Set<string>(),
        pending: false,
        models: [manual],
        manualModelId: "",
        manualModelType: "llm",
        setManualModelId: () => {},
        setManualModelType: () => {},
        setModels: () => {},
        supportedTypes: ["llm"],
      }),
    );
    expect(markup).toContain("Private model");
    expect(markup).toContain("Remove private/model-v2 from selection");
    expect(markup).toContain("Search selected models");
    expect(markup).toContain("Search discovered models");
  });
  it("does not describe zero successful registrations as success", () => {
    const markup = renderToStaticMarkup(
      createElement(SummaryStep, {
        intent: "register-models",
        summary: {
          providerName: "Example",
          models: [],
          failures: [{ model: manual, message: "Probe rejected" }],
        },
      }),
    );
    expect(markup).toContain("No models registered");
    expect(markup).toContain("Probe rejected");
    expect(markup).not.toContain("Models registered from Example");
  });
});
