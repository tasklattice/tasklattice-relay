#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// NemoClaw v0.0.123 keeps mcporter 0.7.3 but pins vulnerable transitive
// dependencies. Replace only this graph; retain upstream integrity checks,
// npm ci, transport smoke tests and the high/critical audit gate.
const upstreamHashes = {
  "package.json": "7219fdcce72998c999dc14dd45f9e8ed12ea16822964d1721d434044d6d59edb",
  "package-lock.json": "720c0e3ec2efcccd2c820ce2a39d733f7bd5bf9d3e6fb95310e7f6cd369db83c",
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = value => createHash("sha256").update(value).digest("hex");
const source = process.argv[2];
if (!source) throw new Error("Usage: patch-nemoclaw-mcporter-runtime.mjs <NemoClaw source>");
const replacements = Object.entries(upstreamHashes).map(([name, expected]) => {
  const path = join(source, "agents/openclaw/mcporter-runtime", name);
  const current = readFileSync(path);
  const replacement = readFileSync(join(root, "infra/npm/mcporter-runtime", name));
  if (hash(current) !== expected && !current.equals(replacement)) {
    throw new Error(`Unrecognized upstream mcporter ${name}; review the new NemoClaw dependency graph before applying this overlay.`);
  }
  return { path, replacement };
});
// Validate both files before writing either; repeated application is safe.
for (const { path, replacement } of replacements) writeFileSync(path, replacement);
console.log("Applied locked mcporter security updates without changing mcporter 0.7.3.");
