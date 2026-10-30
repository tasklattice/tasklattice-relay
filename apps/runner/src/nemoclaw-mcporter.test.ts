import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const overlay = join(root, "infra/npm/mcporter-runtime");
const patch = join(root, "scripts/patch-nemoclaw-mcporter-runtime.mjs");
const read = (name: string) => readFileSync(join(overlay, name), "utf8");

describe("OpenClaw mcporter security overlay", () => {
  it("preserves mcporter and pins every occurrence of patched dependencies", () => {
    const manifest = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(manifest.dependencies).toEqual({ mcporter: "0.7.3" });
    expect(lock.packages["node_modules/mcporter"].version).toBe("0.7.3");
    expect(manifest.overrides).toMatchObject({
      "@modelcontextprotocol/sdk": "1.32.0", "fast-uri": "3.1.9", "proxy-addr": "2.0.8",
      "@hono/node-server": "2.1.5", hono: "4.13.11", "ip-address": "10.7.4", qs: "6.17.1",
    });
    for (const [name, version] of Object.entries(manifest.overrides)) {
      const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith(`node_modules/${name}`));
      expect(entries.length, name).toBeGreaterThan(0);
      for (const [, value] of entries) expect((value as { version: string }).version, name).toBe(version);
    }
  });

  it("is reentrant and rejects upstream drift before changing either file", () => {
    const source = mkdtempSync(join(tmpdir(), "relay-mcporter-overlay-"));
    const destination = join(source, "agents/openclaw/mcporter-runtime");
    mkdirSync(destination, { recursive: true });
    const invoke = () => spawnSync(process.execPath, [patch, source], { encoding: "utf8" });
    try {
      for (const name of ["package.json", "package-lock.json"]) copyFileSync(join(overlay, name), join(destination, name));
      expect(invoke().status).toBe(0);
      expect(invoke().status).toBe(0);
      const before = readFileSync(join(destination, "package.json"), "utf8");
      writeFileSync(join(destination, "package-lock.json"), '{"upstream":"changed"}\n');
      const result = invoke();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Unrecognized upstream mcporter package-lock.json");
      expect(readFileSync(join(destination, "package.json"), "utf8")).toBe(before);
      expect(readFileSync(join(destination, "package-lock.json"), "utf8")).toBe('{"upstream":"changed"}\n');
    } finally { rmSync(source, { recursive: true, force: true }); }
  });

  it("applies the graph before the upstream OpenClaw build", () => {
    const build = readFileSync(join(root, "scripts/build-nemoclaw-sandbox.sh"), "utf8");
    expect(build.indexOf("patch-nemoclaw-mcporter-runtime.mjs")).toBeLessThan(build.indexOf('resolved_base_image="$NEMOCLAW_BASE_IMAGE"'));
    expect(build).toContain('if [ "$AGENT_PLATFORM" = "openclaw" ]; then\n  node "$REPOSITORY_ROOT/scripts/patch-nemoclaw-mcporter-runtime.mjs"');
  });
});
