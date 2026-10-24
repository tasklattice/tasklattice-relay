import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../../scripts/migrate-hermes-legacy-dashboard.py");
const directories: string[] = [];
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tali-hermes-migrate-")));
  directories.push(root);
  const legacy = join(root, "profiles/dashboard-home");
  await mkdir(legacy, { recursive: true });
  return { root, legacy };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

it("archives a generated config across credential-reference rotation and preserves sessions", async () => {
  const { root, legacy } = await fixture();
  const old = "model:\n  api_key: openshell:resolve:env:v123_OPENAI_API_KEY\nmcp_servers:\n  tali:\n    headers:\n      Authorization: Bearer openshell:resolve:env:v123_OPENAI_API_KEY\n";
  await writeFile(join(legacy, "config.yaml"), old);
  await writeFile(join(root, "config.yaml"), `model:\n  api_key: openshell:resolve:env:s${"a".repeat(64)}_OPENAI_API_KEY\nmcp_servers:\n  tali:\n    headers:\n      Authorization: Bearer openshell:resolve:env:s${"a".repeat(64)}_OPENAI_API_KEY\nagent:\n  max_iterations: 20\n`);
  await writeFile(join(legacy, "state.db"), "session evidence");
  execFileSync("python3", [script, "--hermes-dir", root]);
  expect(await readFile(join(root, ".relay-upgrade-138-archive/profiles-dashboard-home-config.yaml"), "utf8")).toBe(old);
  expect(await readFile(join(legacy, "state.db"), "utf8")).toBe("session evidence");
  execFileSync("python3", [script, "--hermes-dir", root]);
});

it("rejects an unknown config conflict without moving the original", async () => {
  const { root, legacy } = await fixture();
  await writeFile(join(root, "config.yaml"), "model: {default: managed}\n");
  const custom = "model: {default: user-custom}\n";
  await writeFile(join(legacy, "config.yaml"), custom);
  const result = spawnSync("python3", [script, "--hermes-dir", root], { encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unrecognized legacy conflict");
  expect(await readFile(join(legacy, "config.yaml"), "utf8")).toBe(custom);
});

it("rejects a symlinked legacy config", async () => {
  const { root, legacy } = await fixture();
  await writeFile(join(root, "config.yaml"), "model: {}\n");
  await symlink(join(root, "config.yaml"), join(legacy, "config.yaml"));
  const result = spawnSync("python3", [script, "--hermes-dir", root], { encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unsafe legacy");
});

it.each([false, true])("preserves populated databases and rejects two populated homes (%s)", async (bothPopulated) => {
  const { root, legacy } = await fixture();
  await mkdir(join(root, "runtime"));
  const create = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('create table sessions(id text)');c.execute('create virtual table messages_fts using fts5(content)');\nif sys.argv[2]=='yes': c.execute("insert into sessions values('existing-session')")\nc.commit();c.close()`;
  execFileSync("python3", ["-c", create, join(root, "runtime/state.db"), bothPopulated ? "yes" : "no"]);
  execFileSync("python3", ["-c", create, join(legacy, "state.db"), "yes"]);
  const before = await readFile(join(legacy, "state.db"));
  const result = spawnSync("python3", [script, "--hermes-dir", root], { encoding: "utf8" });
  expect(result.status).toBe(bothPopulated ? 1 : 0);
  expect(await readFile(join(legacy, "state.db"))).toEqual(before);
  if (bothPopulated) expect(result.stderr).toContain("Both native and legacy Hermes databases contain state");
  else expect(await readFile(join(root, ".relay-upgrade-138-archive/runtime-state.db.empty-before-migration"))).toBeDefined();
});
