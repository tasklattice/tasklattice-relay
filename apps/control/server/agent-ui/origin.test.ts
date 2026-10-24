import { describe, expect, it, vi } from "vitest";
vi.mock("../http/request-origin", () => ({ requestOrigin: () => "https://relay.test" }));
import middleware from "../middleware/agent-ui-origin";
const guard = middleware as unknown as (event: { req: Request }) => Response | undefined;
const check = (path: string, method: string, origin: string, cookie = true) => guard({ req: new Request(`https://relay.test${path}`, { method, headers: { origin, ...(cookie ? { cookie: "control=login" } : {}) } }) });
describe("native Agent cannot use Control cookies", () => {
  it("denies opaque-origin reads, writes and native entry creation", () => {
    for (const path of ["/api/v1/projects", "/api/auth/sign-out", "/project/instance/ui/", "/_agent-ui-other/"]) for (const method of ["GET", "POST"]) expect(check(path, method, "null")?.status).toBe(403);
  });
  it("requires same-origin cookie writes and leaves capability validation to the dedicated proxy", () => {
    expect(check("/api/v1/projects", "POST", "https://evil.test")?.status).toBe(403);
    expect(check("/api/v1/projects", "POST", "https://relay.test")).toBeUndefined();
    expect(check("/_agent-ui/session/capability/", "POST", "null")).toBeUndefined();
  });
});
