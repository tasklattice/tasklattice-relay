import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), proxy: vi.fn() }));
vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return { agentUiUrl: actual.agentUiUrl, createAgentUiSession: mocks.session };
});
vi.mock("./proxy", () => ({ proxyAgentRequest: mocks.proxy }));
import entry from "../routes/[projectId]/[instanceId]/ui/index.get";
import resource from "../routes/[projectId]/[instanceId]/ui/[...path].get";

const base = "/project-a/instance-a/ui/";
const contentUrl = `/_agent-ui/session/${"a".repeat(43)}/`;
type Event = { req: Request; context: { params: { projectId: string; instanceId: string } } };
const serve = entry as unknown as (event: Event) => Promise<Response>;

describe("native UI as an Instance resource", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ contentUrl });
    mocks.proxy.mockResolvedValue(new Response("native document"));
  });

  it.each([
    [base.slice(0, -1), ""],
    [base, ""],
    [base + "chat?profile=default", "chat?profile=default"],
    [base + "config/providers?tab=model", "config/providers?tab=model"],
  ])("authorizes and resolves %s within this Instance", async (path, upstream) => {
    expect(resource).toBe(entry);
    const req = new Request(`https://relay.test${path}`);
    const response = await serve({ req, context: { params: { projectId: "project-a", instanceId: "instance-a" } } });
    expect(mocks.session).toHaveBeenCalledWith(req, "project-a", "instance-a", true);
    expect(mocks.proxy.mock.calls[0]?.[0].url).toBe(`https://relay.test${contentUrl}${upstream}`);
    expect(mocks.proxy.mock.calls[0]?.[1]).toBe(base);
    expect(await response.text()).toBe("native document");
  });

  it("rejects access before forwarding a native resource", async () => {
    mocks.session.mockRejectedValue(new Response(null, { status: 401 }));
    const response = await serve({ req: new Request(`https://relay.test${base}config`),
      context: { params: { projectId: "project-a", instanceId: "instance-a" } } });
    expect(response.status).toBe(401);
    expect(mocks.proxy).not.toHaveBeenCalled();
  });
});
