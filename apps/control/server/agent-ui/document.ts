/** The native document is given an opaque origin by the response CSP sandbox. */
function nativeBootstrap(prefix: string, platform: string, publicBase: string, expiresAt: number) {
  // Native UIs must detect these origin-bound capabilities as unavailable.
  // Do not let an optional service-worker registration abort application startup.
  Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
  const root = new URL(prefix, location.href);
  const mapUrl = (value: string | URL) => {
    const url = new URL(String(value), document.baseURI);
    if (url.host === root.host && !url.pathname.startsWith(root.pathname)) {
      // Hermes canonicalizes its base path without the trailing slash before
      // adding ?profile=... . Treat that exact path as the instance root too.
      const instanceRoot = url.pathname === publicBase.replace(/\/$/, "")
        || url.pathname === root.pathname.replace(/\/$/, "");
      url.pathname = root.pathname + (instanceRoot ? ""
        : url.pathname.startsWith(publicBase) ? url.pathname.slice(publicBase.length) : url.pathname.replace(/^\//, ""));
    }
    return url.href;
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(String(key)) ?? null,
      setItem: (key: string, value: string) => { values.set(String(key), String(value)); },
      removeItem: (key: string) => { values.delete(String(key)); }, clear: () => values.clear() };
    Object.defineProperty(window, name, { value: storage, configurable: false });
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => originalFetch(input instanceof Request
    ? new Request(mapUrl(input.url), input) : mapUrl(input), { ...options, credentials: "omit" });
  const OriginalSocket = window.WebSocket;
  window.WebSocket = class extends OriginalSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(mapUrl(url), protocols); }
  };
  const OriginalEvents = window.EventSource;
  window.EventSource = class extends OriginalEvents {
    constructor(url: string | URL) { super(mapUrl(url), { withCredentials: false }); }
  };
  // Vite's preload helper constructs root-relative CSS URLs at runtime.
  for (const [prototype, property] of [[HTMLLinkElement.prototype, "href"], [HTMLScriptElement.prototype, "src"], [HTMLImageElement.prototype, "src"]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property)!;
    Object.defineProperty(prototype, property, { ...descriptor, set(value: string) { descriptor.set!.call(this, mapUrl(value)); } });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (["LINK", "SCRIPT", "IMG", "SOURCE", "VIDEO", "AUDIO"].includes(this.tagName) && ["src", "href"].includes(name.toLowerCase())) value = mapUrl(value);
    setAttribute.call(this, name, value);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
    return open.call(this, method, mapUrl(url), async, username, password);
  };
  // An opaque document cannot use pushState to change its URL. Use document
  // navigation instead, retaining its capability and the sandbox policy.
  let state: unknown = null;
  const navigationUrl = (url: string | URL) => {
    const target = new URL(mapUrl(url));
    if (target.host !== root.host || !["http:", "https:"].includes(target.protocol)) return target.href;
    target.pathname = publicBase + target.pathname.slice(root.pathname.length);
    return target.href;
  };
  // Some native help text renders plain root-relative anchors outside its router.
  // Rewrite before the browser's default navigation, including Ctrl-click.
  const nativeLink = (event: Event) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (anchor) anchor.href = navigationUrl(anchor.href);
  };
  document.addEventListener("click", nativeLink, true);
  document.addEventListener("auxclick", nativeLink, true);
  Object.defineProperty(history, "state", { get: () => state });
  history.pushState = (value, _title, url) => {
    state = value;
    if (url && navigationUrl(url) !== location.href) location.assign(navigationUrl(url));
  };
  history.replaceState = (value, _title, url) => {
    state = value;
    if (url && navigationUrl(url) !== location.href) location.replace(navigationUrl(url));
  };
  Object.assign(window, { __HERMES_BASE_PATH__: publicBase.replace(/\/$/, ""), __OPENCLAW_CONTROL_UI_BASE_PATH__: publicBase.replace(/\/$/, "") });
  if (platform === "openclaw") {
    const gatewayUrl = new URL(root);
    gatewayUrl.protocol = root.protocol === "https:" ? "wss:" : "ws:";
    // OpenClaw's supported native bootstrap supplies connection settings. This
    // marker has no authority; Control replaces the WS connect authentication.
    Object.assign(window, { __OPENCLAW_NATIVE_CONTROL_AUTH__: { gatewayUrl: gatewayUrl.href, token: "relay-managed" } });
  }
  const lifecycle = root.href + "_relay/session";
  let lastRenewal = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() >= expiresAt) { clearInterval(timer); location.reload(); return; }
    try {
      const response = await originalFetch(lifecycle, { method: "POST", credentials: "omit" });
      if (!response.ok) { clearInterval(timer); location.reload(); }
      else lastRenewal = Date.now();
    } catch {
      // Expired capability responses intentionally cannot grant CORS access.
      if (Date.now() - lastRenewal >= 4 * 60_000) { clearInterval(timer); location.reload(); }
    }
  }, 30_000);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    void originalFetch(lifecycle, { method: "DELETE", credentials: "omit", keepalive: true }).catch(() => {});
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastRenewal >= 4 * 60_000) location.reload(); });
}

export function injectAgentDocument(html: string, prefix: string, platform: string, publicBase = prefix, expiresAt = Date.now() + 60 * 60_000): string {
  const bootstrap = `<base href="${prefix}"><script>(${nativeBootstrap.toString()})(${JSON.stringify(prefix)},${JSON.stringify(platform)},${JSON.stringify(publicBase)},${expiresAt});</script>`;
  // The upstream owns neither the base URL nor the security policy.
  html = html.replace(/<base\b[^>]*>/gi, "").replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh)[^>]*>/gi, "");
  html = html.replace(/(window\.__HERMES_BASE_PATH__\s*=\s*)(["'])(.*?)\2/g, `$1${JSON.stringify(publicBase.replace(/\/$/, ""))}`);
  html = html.replace(/(window\.__HERMES_SESSION_TOKEN__\s*=\s*)(["'])(.*?)\2/g, '$1"relay-managed"');
  html = html.replace(/\b(src|href|action)=(['"])(\/[^'"\s]*)/gi, (original, attribute, quote, path: string) =>
    path.startsWith(prefix) || path.startsWith("//") ? original : `${attribute}=${quote}${prefix}${path.slice(1)}`);
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bootstrap) : bootstrap + html;
}

export function agentDocumentPolicy(origin: string, prefix: string): string {
  const source = `${origin}${prefix}`;
  const ws = source.replace(/^http/, "ws");
  return `sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src 'unsafe-inline' ${source}; style-src 'unsafe-inline' ${source}; img-src ${source} data: blob:; font-src ${source} data:; connect-src ${source} ${ws}; media-src ${source} blob:; base-uri ${source}; form-action ${source}; frame-ancestors 'self'; frame-src 'none'; worker-src 'none'`;
}
