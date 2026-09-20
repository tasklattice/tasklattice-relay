import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runInstaller(badChecksum = false) {
  const root = mkdtempSync(join(tmpdir(), "tali-kind-test-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const executable = (name, text) => writeFileSync(join(bin, name), text, { mode: 0o755 });
  executable("curl", `#!${process.execPath}
const fs = require('node:fs'), crypto = require('node:crypto');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DOWNLOADS, JSON.stringify(args) + '\\n');
const body = '#!/bin/sh\\nprintf "%s\\n" "$*" >> "$TEST_KIND_CALLS"\\n';
const hash = process.env.TEST_BAD_CHECKSUM === 'true' ? '0'.repeat(64) : crypto.createHash('sha256').update(body).digest('hex');
fs.writeFileSync(args[args.indexOf('--output') + 1], /sha256(sum)?$/.test(args.at(-1)) ? hash : body);
`);
  executable("sha256sum", `#!${process.execPath}
const fs = require('node:fs'), crypto = require('node:crypto');
const [hash, file] = fs.readFileSync(0, 'utf8').trim().split(/  /);
process.exit(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === hash ? 0 : 1);
`);
  try {
    const result = spawnSync("bash", [resolve("scripts/create-kind-ci.sh")], { encoding: "utf8", env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_PATH: join(root, "path"),
      KIND_VERSION: "v0.31.0", KUBECTL_VERSION: "v1.32.0", KIND_NODE_IMAGE: "kindest/node:test@sha256:pinned",
      KIND_CLUSTER_NAME: "isolated-test", TEST_KIND_CALLS: join(root, "kind-calls"),
      TEST_DOWNLOADS: join(root, "downloads"), TEST_BAD_CHECKSUM: String(badChecksum),
    } });
    const downloads = readFileSync(join(root, "downloads"), "utf8").trim().split("\n").map(JSON.parse);
    if (badChecksum) {
      assert.notEqual(result.status, 0);
      assert.throws(() => readFileSync(join(root, "kind-calls")), { code: "ENOENT" });
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(downloads.length, 4);
      assert.match(readFileSync(join(root, "kind-calls"), "utf8"), /create cluster --name isolated-test --image kindest\/node:test@sha256:pinned --wait 120s/);
      assert.match(readFileSync(join(root, "path"), "utf8"), /tali-kind-tools/);
    }
    for (const args of downloads) {
      assert(args.includes("--retry-all-errors"));
      assert.equal(args[args.indexOf("--retry") + 1], "5");
      assert(args.includes("--max-time"));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("Kind setup retries downloads, verifies both tools and preserves the pinned node image", () => runInstaller());
test("Kind setup never executes a downloaded binary with a bad checksum", () => runInstaller(true));
