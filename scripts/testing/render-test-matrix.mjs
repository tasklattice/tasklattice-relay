#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { matchesAny, testModules } from "./test-modules.mjs";
import { testScenarios } from "./test-scenarios.mjs";

const root = resolve(import.meta.dirname, "../..");

function listVitest(cwd, config) {
  const cli = resolve(root, "node_modules/vitest/vitest.mjs");
  const args = [cli, "list"];
  if (config) args.push("--config", config);
  // Keep --json last. Vitest accepts an optional output path after this flag;
  // placing source paths after it can overwrite a test file.
  args.push("--json");
  const result = spawnSync(process.execPath, args, {
    cwd: resolve(root, cwd),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Vitest list failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout)
    .map((entry) => ({
      ...entry,
      file: relative(root, entry.file).replaceAll("\\", "/"),
    }))
    .filter((entry) => !/\.live\.test\.(?:ts|tsx)$/.test(entry.file));
}

function countPython(path) {
  const source = readFileSync(resolve(root, path), "utf8");
  return [...source.matchAll(/^\s*(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/gm)].length;
}

function countNode(path) {
  const source = readFileSync(resolve(root, path), "utf8");
  return [...source.matchAll(/(?:^|\s)test\s*\(/gm)].length;
}

const vitest = [
  ...listVitest("apps/control", "vitest.config.ts"),
  ...listVitest("apps/runner"),
  ...listVitest("apps/example-mcp-server"),
];

const rows = testModules.map((module) => {
  const patterns = [
    ...module.controlTestPatterns,
    ...module.runnerTestPatterns,
    ...(module.workspaceTests ?? []).flatMap((entry) => entry.patterns),
  ];
  const listed = vitest.filter((entry) => matchesAny(entry.file, patterns));
  const explicitFiles = [...module.pythonTests, ...module.nodeTests];
  const cases = listed.length
    + module.pythonTests.reduce((sum, path) => sum + countPython(path), 0)
    + module.nodeTests.reduce((sum, path) => sum + countNode(path), 0);
  const scenarios = testScenarios.filter((scenario) => scenario.module === module.id);
  return {
    block: module.block ?? module.scope,
    id: module.id,
    label: module.label,
    files: new Set([...listed.map((entry) => entry.file), ...explicitFiles]).size,
    cases,
    integrations: scenarios.filter((scenario) => scenario.execution === "automatic").length,
    live: scenarios.filter((scenario) => scenario.execution === "manual").length,
  };
});

const lines = [
  "# Test coverage matrix",
  "",
  "> Generated from executable module ownership and Vitest/Python/Node discovery. Counts are not stored in a hand-maintained document.",
  "",
  "| Block | Module | Unit/component files | Unit/component cases | Automatic integrations | Manual deployed/live E2E stages |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
  ...rows.map((row) =>
    `| ${row.block} | \`${row.id}\` | ${row.files} | ${row.cases} | ${row.integrations} | ${row.live} |`,
  ),
  "",
  "## Integration and E2E scenario catalog",
  "",
  "| Layer | Module | Scenario | Trigger | Cost guard | Command | Evidence |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...testScenarios.map((scenario) =>
    `| ${scenario.layer} | \`${scenario.module}\` | \`${scenario.id}\` | ${scenario.execution} | ${scenario.cost} | \`${scenario.command}\` | ${scenario.evidence} |`,
  ),
  "",
  "Automatic integrations use local deterministic fixtures and must not read `DEEPSEEK_API_KEY` or `NVAPI_API_KEY`. Live model scenarios are manual-only and use the deployed cost-safe SINGLE Routing.",
  "",
];

const markdown = lines.join("\n");
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
}
