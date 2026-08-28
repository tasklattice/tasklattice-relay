import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import {
  GOLDEN_PATH_MODULE_ID,
  matchesAny,
  moduleMatrix,
  selectTestModuleIds,
  testModules,
} from "./test-modules.mjs";

const root = resolve(import.meta.dirname, "../..");

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

test("selects only the direct UI module for an isolated visual helper", () => {
  assert.deepEqual(
    selectTestModuleIds(["apps/control/src/components/ui/select.tsx"]),
    ["control-ui"],
  );
});

test("adds the cross-component golden path to core Agent dependencies", () => {
  assert.deepEqual(
    selectTestModuleIds([
      "apps/control/server/memories/memory-service.ts",
      "apps/control/server/agent-garden/agent-discovery.ts",
    ]),
    ["memory", "knowledge-a2a", GOLDEN_PATH_MODULE_ID],
  );
});

test("runs every module for shared contracts and test infrastructure", () => {
  const expected = testModules.map(({ id }) => id);
  assert.deepEqual(
    selectTestModuleIds(["packages/contracts/src/instances.ts"]),
    expected,
  );
  assert.deepEqual(
    selectTestModuleIds(["scripts/testing/run-test-module.mjs"]),
    expected,
  );
});

test("fails safe for an unmapped Control path", () => {
  const selected = selectTestModuleIds([
    "apps/control/server/new-component/new-service.ts",
  ]);
  for (const id of [
    "access",
    "inference",
    "agent-lifecycle",
    "memory",
    "knowledge-a2a",
    "observability",
    "control-ui",
    GOLDEN_PATH_MODULE_ID,
  ]) {
    assert.ok(selected.includes(id), `expected ${id} to be selected`);
  }
});

test("does not schedule test jobs for documentation-only changes", () => {
  const modules = selectTestModuleIds(["docs/testing-strategy.md"]);
  assert.deepEqual(modules, []);
  assert.deepEqual(moduleMatrix(modules), { include: [] });
});

test("assigns every deterministic Control, Runner and runtime integration test", () => {
  const sourceTests = [
    ...filesBelow(join(root, "apps/control")),
    ...filesBelow(join(root, "apps/runner")),
  ]
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => /\.test\.(?:ts|tsx)$/.test(path))
    .filter((path) => !/\.live\.test\.(?:ts|tsx)$/.test(path));
  const sourcePatterns = testModules.flatMap((module) => [
    ...module.controlTestPatterns,
    ...module.runnerTestPatterns,
  ]);
  assert.deepEqual(
    sourceTests.filter((path) => !matchesAny(path, sourcePatterns)),
    [],
  );

  const pythonTests = filesBelow(join(root, "runtime-integrations"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => /(?:^|\/)test_.*\.py$/.test(path));
  const assignedPythonTests = new Set(
    testModules.flatMap((module) => module.pythonTests),
  );
  assert.deepEqual(
    pythonTests.filter((path) => !assignedPythonTests.has(path)),
    [],
  );
});
