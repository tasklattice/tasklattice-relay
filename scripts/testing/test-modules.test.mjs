import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import {
  GOLDEN_PATH_MODULE_ID,
  TEST_BLOCKS,
  isGlobalTestInfrastructurePath,
  matchesAny,
  moduleMatrix,
  selectTestModuleIds,
  sourceOwnerModuleIds,
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

test("routes Keycloak integration changes through Access and the golden path", () => {
  const modules = selectTestModuleIds(["scripts/configure-dev-keycloak-sso.sh"]);
  assert.ok(modules.includes("access"));
  assert.ok(modules.includes(GOLDEN_PATH_MODULE_ID));
});

test("organizes modules under Control and Data, with one cross-block suite", () => {
  assert.deepEqual(
    [...new Set(testModules.map(({ block }) => block).filter(Boolean))],
    TEST_BLOCKS,
  );
  assert.ok(
    testModules.filter(({ block }) => block === "control-plane").length >= 2,
  );
  assert.ok(
    testModules.filter(({ block }) => block === "data-plane").length >= 2,
  );
  assert.deepEqual(
    testModules.filter(({ scope }) => scope === "cross-plane").map(({ id }) => id),
    [GOLDEN_PATH_MODULE_ID],
  );
});

test("gives every production source an explicit module owner", () => {
  const productionSources = [
    ...filesBelow(join(root, "apps/control")),
    ...filesBelow(join(root, "apps/runner")),
    ...filesBelow(join(root, "runtime-integrations")),
  ]
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => /\.(?:mjs|py|ts|tsx)$/.test(path))
    .filter((path) => !/(?:^|\/)(?:\.output|node_modules)(?:\/|$)/.test(path))
    .filter((path) => !/\.test\.(?:mjs|ts|tsx)$/.test(path))
    .filter((path) => !/(?:^|\/)test_.*\.py$/.test(path))
    .filter((path) => !isGlobalTestInfrastructurePath(path));
  assert.deepEqual(
    productionSources.filter((path) => sourceOwnerModuleIds(path).length === 0),
    [],
  );
});

test("requires every module row to resolve deterministic test evidence", () => {
  const sourceTests = [
    ...filesBelow(join(root, "apps/control")),
    ...filesBelow(join(root, "apps/runner")),
  ]
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => /\.test\.(?:ts|tsx)$/.test(path))
    .filter((path) => !/\.live\.test\.(?:ts|tsx)$/.test(path));
  for (const module of testModules) {
    const matchedSourceTests = sourceTests.filter((path) => matchesAny(path, [
      ...module.controlTestPatterns,
      ...module.runnerTestPatterns,
    ]));
    const explicitTests = [...module.pythonTests, ...module.nodeTests]
      .filter((path) => existsSync(join(root, path)));
    assert.ok(
      matchedSourceTests.length + explicitTests.length > 0,
      `${module.id} does not resolve any deterministic test evidence`,
    );
  }
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

  const nodeTests = filesBelow(join(root, "scripts/testing"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => /\.test\.mjs$/.test(path))
    .filter((path) => !path.endsWith("/test-modules.test.mjs"));
  const assignedNodeTests = new Set(
    testModules.flatMap((module) => module.nodeTests),
  );
  assert.deepEqual(
    nodeTests.filter((path) => !assignedNodeTests.has(path)),
    [],
  );
});
