import { describe, it, expect, afterEach, vi } from "vitest";
import { validatePersonalEndpoint } from "./personal-onboarding-service";
import { personalAgentTemplate } from "../works/personal-agent-template";
import { projectRouteAdmissionPolicy } from "../authorization/route-capabilities";
import { personalConnectSchema, type ModelRouting } from "@tali/contracts";

afterEach(() => vi.unstubAllEnvs());
describe("personal onboarding boundaries", () => {
  it("rejects arbitrary/private destinations unless the deployment explicitly allows that origin", () => {
    vi.stubEnv("TALI_PERSONAL_PROVIDER_ORIGINS", "");
    for (const url of ["http://127.0.0.1:4000/v1", "https://api.openai.com.evil.test/v1", "https://key@api.openai.com/v1", "https://api.openai.com/v1?key=secret"])
      expect(() => validatePersonalEndpoint("openai", url)).toThrow();
    expect(() => validatePersonalEndpoint("custom-openai-compatible", "https://example.test/v1")).toThrow();
    vi.stubEnv("TALI_PERSONAL_PROVIDER_ORIGINS", "https://example.test");
    expect(() => validatePersonalEndpoint("custom-openai-compatible", "https://example.test/v1")).not.toThrow();
    expect(() => validatePersonalEndpoint("openai", "https://api.openai.com/v1")).not.toThrow();
    expect(() => validatePersonalEndpoint("nvidia-nim", "https://integrate.api.nvidia.com/v1")).not.toThrow();
    expect(() => validatePersonalEndpoint("nvidia-nim", "https://integrate.api.nvidia.com.evil.test/v1")).toThrow();
    expect(personalConnectSchema.safeParse({ expectedRevision: 0, provider: "nvidia-nim", endpoint: "https://integrate.api.nvidia.com/v1", apiKey: "test", modelId: "openai/gpt-oss-20b", budgetUsd: 1 }).success).toBe(true);
  });
  it("requires an explicit positive bounded budget and exposes only three onboarding routes", () => {
    expect(personalConnectSchema.safeParse({ expectedRevision: 0, provider: "openai", endpoint: "https://api.openai.com/v1", apiKey: "test", modelId: "test", budgetUsd: 0 }).success).toBe(false);
    for (const [method, tail] of [["GET", ""], ["POST", "/connect"], ["POST", "/prepare"]])
      expect(projectRouteAdmissionPolicy(method!, `/api/v1/projects/p/personal-onboarding${tail}`)?.requirements).toEqual([{ capability: "CAP_PROJECT_VIEW", resourceType: "PersonalOnboarding" }]);
    expect(projectRouteAdmissionPolicy("DELETE", "/api/v1/projects/p/personal-onboarding")).toBeUndefined();
  });
  it("pins two different executable roles to one routing, with real release evaluations and no external tools", () => {
    const routing = { id: "routing", configurationHash: `sha256:${"a".repeat(64)}` } as ModelRouting;
    for (const role of ["coordinator", "expert"] as const) {
      const template = personalAgentTemplate(role, routing);
      expect(template.execution.configuration).toMatchObject({ engineType: "WORK_TEXT", workRole: role });
      expect(template.resources).toEqual([{ kind: "MODEL_ROUTING", resourceId: "routing", revision: routing.configurationHash, access: "INVOKE", required: true }]);
      expect(template.acceptance.suites?.[0]?.required).toBe(true);
      expect(template.acceptance.cases[0]?.request).toBeDefined();
      expect(template.safety.allowGeneralModelFallback).toBe(false);
    }
  });
});
