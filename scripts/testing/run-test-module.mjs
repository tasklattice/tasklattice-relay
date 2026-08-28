#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny, testModule } from "./test-modules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const moduleId = process.argv[2];
const module = testModule(moduleId);
if (!module) {
  console.error(`Unknown test module: ${moduleId ?? "<missing>"}`);
  process.exit(2);
}

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

const candidateTests = [
  ...filesBelow(join(root, "apps/control")),
  ...filesBelow(join(root, "apps/runner")),
]
  .map((path) => relative(root, path).replaceAll("\\", "/"))
  .filter((path) => /\.test\.(?:ts|tsx)$/.test(path))
  .filter((path) => !/\.live\.test\.(?:ts|tsx)$/.test(path));

function selected(patterns) {
  return candidateTests.filter((path) => matchesAny(path, patterns));
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const controlTests = selected(module.controlTestPatterns)
  .map((path) => relative("apps/control", path));
const runnerTests = selected(module.runnerTestPatterns)
  .map((path) => relative("apps/runner", path));

console.log(`\n[test-module] ${module.label} (${module.id})`);
if (controlTests.length) {
  console.log(`[test-module] ${controlTests.length} Control test files`);
  run("npm", [
    "run",
    "test",
    "--workspace",
    "@tali/control",
    "--",
    ...controlTests,
  ]);
}
if (runnerTests.length) {
  console.log(`[test-module] ${runnerTests.length} Runner test files`);
  run("npm", [
    "run",
    "test",
    "--workspace",
    "@tali/runner",
    "--",
    ...runnerTests,
  ]);
}
for (const test of module.pythonTests) {
  console.log(`[test-module] Python ${test}`);
  run("python3", [test]);
}
for (const test of module.nodeTests) {
  console.log(`[test-module] Node ${test}`);
  run("node", ["--test", test]);
}
if (
  !controlTests.length
  && !runnerTests.length
  && !module.pythonTests.length
  && !module.nodeTests.length
) {
  throw new Error(`Test module ${module.id} did not resolve any tests.`);
}
