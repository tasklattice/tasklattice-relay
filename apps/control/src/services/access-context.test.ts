import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessContextRequestError, classifyAccessContextError } from "@/lib/access-context-error";
import { getAccessContext, selectAccessContext } from "./access-context";

afterEach(() => vi.unstubAllGlobals());

describe("access context failures", () => {
  it.each([
    ["CONTROL_ORIGIN_CONFIGURATION_ERROR", "configuration"],
    ["CONTROL_ORIGIN_FORBIDDEN", "origin"],
    ["CONTROL_ISOLATED_ORIGIN_FORBIDDEN", "origin"],
    ["access_context_not_assigned", "contextUnavailable"],
    ["access_denied", "forbidden"],
  ] as const)("preserves %s and distinguishes its recovery", async (code, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      type: `urn:tali:problem:${code}`, status: 403, code, detail: "Safe server detail.",
    }, { status: 403, headers: { "content-type": "application/problem+json" } })));

    const failure = await selectAccessContext({
      level: "platform", roleId: "ROLE_PLATFORM_ADMIN", resourceId: null,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AccessContextRequestError);
    expect(failure).toMatchObject({ status: 403, code, message: "Safe server detail." });
    expect(classifyAccessContextError(failure)).toBe(kind);
  });

  it("supports the previous code/message origin response during rolling upgrades", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      code: "CONTROL_ORIGIN_CONFIGURATION_ERROR", message: "Sign-in configuration error.",
    }, { status: 403 })));
    const failure = await getAccessContext().catch((error: unknown) => error);
    expect(classifyAccessContextError(failure)).toBe("configuration");
  });

  it.each([
    [401, "authentication"], [403, "forbidden"], [429, "rateLimit"], [502, "service"],
  ] as const)("retains HTTP status %i for a non-JSON proxy response", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy failure</html>", { status })));
    const failure = await getAccessContext().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status });
    expect(classifyAccessContextError(failure)).toBe(kind);
  });

  it("does not infer expired options from a generic denial or arbitrary error text", () => {
    const failure = new AccessContextRequestError(403, "access_denied",
      "Access denied: this access context is not assigned to your Account.");
    expect(classifyAccessContextError(failure)).toBe("forbidden");
    expect(classifyAccessContextError(new Error("private internal error"))).toBe("unknown");
  });

  it("keeps a failed connection distinct from an HTTP rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failure = await getAccessContext().catch((error: unknown) => error);
    expect(classifyAccessContextError(failure)).toBe("network");
  });

  it("returns the refreshed options without submitting a selection", async () => {
    const state = { active: null, options: [] };
    const fetch = vi.fn().mockResolvedValue(Response.json(state));
    vi.stubGlobal("fetch", fetch);
    expect(await getAccessContext()).toEqual(state);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/v1/access-context", expect.not.objectContaining({ method: "PUT" }));
  });
});
