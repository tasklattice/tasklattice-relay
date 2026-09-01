import { describe, expect, it, vi } from "vitest";
import { listGitHubCommits } from "./github.js";

describe("listGitHubCommits", () => {
  it("calls the fixed GitHub REST origin with bounded pagination", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([{ sha: "abc1234" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(listGitHubCommits({
      owner: "tasklattice",
      repo: "tasklattice-relay",
      since: "2026-08-24T00:00:00.000Z",
      until: "2026-08-30T12:00:00.000Z",
      page: 1,
      perPage: 100,
    }, request)).resolves.toEqual([{ sha: "abc1234" }]);
    const url = request.mock.calls[0]![0] as URL;
    expect(url.origin).toBe("https://api.github.com");
    expect(url.pathname).toBe("/repos/tasklattice/tasklattice-relay/commits");
    expect(url.searchParams.get("per_page")).toBe("100");
  });

  it("does not expose an upstream error body", async () => {
    const request = vi.fn(async () => new Response("sensitive upstream detail", { status: 403 }));
    await expect(listGitHubCommits({
      owner: "tasklattice",
      repo: "tasklattice-relay",
      page: 1,
      perPage: 1,
    }, request)).rejects.toThrow("GitHub list commits returned HTTP 403.");
  });
});
