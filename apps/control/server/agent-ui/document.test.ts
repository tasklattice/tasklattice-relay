import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { injectAgentDocument } from "./document";

describe("native Agent document navigation", () => {
  it("canonicalizes Hermes profile URLs without duplicating the public instance path", async () => {
    const prefix = `/_agent-ui/session/${"a".repeat(43)}/`;
    const publicBase = "/project/instance/ui/";
    const href = `http://localhost:38080${publicBase}`;
    const fetch = vi.fn(async (_input: unknown, _options?: unknown) => new Response());
    const replace = vi.fn(), assign = vi.fn();
    const element = class { setAttribute() {} };
    const link = class {}, script = class {}, img = class {};
    for (const [type, property] of [[link, "href"], [script, "src"], [img, "src"]] as const) {
      Object.defineProperty(type.prototype, property, { configurable: true, get() { return ""; }, set() {} });
    }
    const navigator = class {};
    const xhr = class { open() {} };
    const history = {} as History;
    const window = { fetch, WebSocket: class {}, EventSource: class {}, addEventListener() {} };
    const html = injectAgentDocument("<head></head>", prefix, "hermes", publicBase);
    const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    runInNewContext(bootstrap, { window, history, location: { href, replace, assign },
      document: { baseURI: new URL(prefix, href).href, addEventListener() {} },
      URL, Request, Navigator: navigator, Element: element, XMLHttpRequest: xhr,
      HTMLLinkElement: link, HTMLScriptElement: script, HTMLImageElement: img,
      setInterval() { return 0; }, clearInterval() {} });
    history.replaceState({}, "", publicBase.slice(0, -1) + "?profile=default");
    expect(replace).toHaveBeenLastCalledWith(href + "?profile=default");
    history.pushState({}, "", publicBase + "config?profile=default");
    expect(assign).toHaveBeenLastCalledWith(href + "config?profile=default");
    await window.fetch(new URL(publicBase.slice(0, -1) + "?profile=default", href));
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(`http://localhost:38080${prefix}?profile=default`);
  });
});
