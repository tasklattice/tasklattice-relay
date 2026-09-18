import { afterEach, describe, expect, it, vi } from "vitest";
import { api, projectScopedPath } from "./api";

describe("projectScopedPath", () => {
  it("adds the active project to every resource request", () => {
    expect(projectScopedPath("/api/v1/instances", "ai trading")).toBe(
      "/api/v1/projects/ai%20trading/instances",
    );
  });

  it("preserves existing query parameters and replaces stale project context", () => {
    expect(
      projectScopedPath(
        "/api/v1/projects/old/costs/summary?timezone=Asia%2FShanghai",
        "web3",
      ),
    ).toBe(
      "/api/v1/projects/web3/costs/summary?timezone=Asia%2FShanghai",
    );
  });

  it("leaves pre-authentication requests unchanged without a project", () => {
    expect(projectScopedPath("/api/auth/sign-in/username", null)).toBe(
      "/api/auth/sign-in/username",
    );
  });
});


afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("follows queued resource operations without resubmitting the mutation or changing Project", async () => {
  vi.useFakeTimers();
  const location = { pathname: "/original", assign: vi.fn() };
  vi.stubGlobal("window", { location });
  const statusUrl = "/api/v1/projects/original/resource-operations/test-operation";
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "resource-operation", operationId: "test-operation", statusUrl }), { status: 202 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "running", result: null })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", result: { message: "Removed" } })));
  vi.stubGlobal("fetch", fetcher);
  const result = api.removeGardenAgent("test-agent");
  await vi.advanceTimersByTimeAsync(100);
  location.pathname = "/another-project";
  await vi.advanceTimersByTimeAsync(2100);
  await expect(result).resolves.toEqual({ message: "Removed" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1]?.[0]).toBe(statusUrl);
  expect(fetcher.mock.calls[2]?.[0]).toBe(statusUrl);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
});
