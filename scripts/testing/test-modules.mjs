const ALL_CONTROL_MODULE_IDS = [
  "access",
  "inference",
  "agent-lifecycle",
  "memory",
  "vector-database",
  "a2a",
  "observability",
  "control-ui",
];

export const GOLDEN_PATH_MODULE_ID = "agent-golden-path";

export const TEST_BLOCKS = ["control-plane", "data-plane"];

export const testModules = [
  {
    id: "access",
    block: "control-plane",
    label: "Control / Access and project governance",
    sourcePatterns: [
      "apps/control/server/access-policies/**",
      "apps/control/server/auth/**",
      "apps/control/server/authorization/**",
      "apps/control/server/departments/department-service.ts",
      "apps/control/server/departments/department-settings-service.ts",
      "apps/control/server/departments/department-access.ts",
      "apps/control/server/email/**",
      "apps/control/server/notifications/**",
      "apps/control/server/platform/**",
      "apps/control/server/profiles/**",
      "apps/control/server/projects/**",
      "apps/control/server/runtime-bridge/project-runtime-bridge-token*",
      "apps/control/src/components/account/**",
      "apps/control/src/components/auth/**",
      "apps/control/src/components/project/**",
      "apps/control/src/features/account/**",
      "apps/control/src/hooks/use-project-permissions*",
      "apps/control/src/hooks/use-project-query-scope*",
      "apps/control/src/routes/-access-policies-routing.test.ts",
      "apps/control/src/services/**",
      "apps/control/src/types/**",
      "charts/tali-relay/templates/keycloak.yaml",
      "scripts/configure-dev-keycloak-sso.sh",
      "scripts/validate-development-defaults.mjs",
    ],
    controlTestPatterns: [
      "apps/control/server/access-policies/**",
      "apps/control/server/auth/**",
      "apps/control/server/authorization/**",
      "apps/control/server/departments/department-service.test.ts",
      "apps/control/server/departments/department-settings-service.test.ts",
      "apps/control/server/email/**",
      "apps/control/server/notifications/**",
      "apps/control/server/platform/**",
      "apps/control/server/profiles/**",
      "apps/control/server/projects/**",
      "apps/control/server/runtime-bridge/project-runtime-bridge-token.test.ts",
      "apps/control/src/components/account/**",
      "apps/control/src/components/auth/**",
      "apps/control/src/components/project/**",
      "apps/control/src/features/account/**",
      "apps/control/src/hooks/use-project-permissions.test.ts",
      "apps/control/src/hooks/use-project-query-scope.test.ts",
      "apps/control/src/routes/-access-policies-routing.test.ts",
    ],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: [],
  },
  {
    id: "inference",
    block: "control-plane",
    label: "Control / Providers, models, routing and quota",
    sourcePatterns: [
      "apps/control/server/departments/department-inference-store*",
      "apps/control/server/departments/department-budget-lock.ts",
      "apps/control/server/departments/department-inference-service.ts",
      "apps/control/server/departments/department-resource-assignment-service.ts",
      "apps/control/server/model-routings/**",
      "apps/control/server/providers/**",
      "apps/control/server/quotas/**",
      "apps/control/src/components/providers/**",
      "apps/control/src/features/model-cost/**",
    ],
    controlTestPatterns: [
      "apps/control/server/departments/department-inference-store.test.ts",
      "apps/control/server/model-routings/**",
      "apps/control/server/providers/**",
      "apps/control/server/quotas/**",
      "apps/control/src/components/providers/**",
      "apps/control/src/features/model-cost/**",
    ],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: [],
  },
  {
    id: "agent-lifecycle",
    block: "control-plane",
    label: "Control / Agent lifecycle, Worker and runtime control",
    sourcePatterns: [
      "apps/control/server/instances/**",
      "apps/control/server/jobs/**",
      "apps/control/server/kubernetes/**",
      "apps/control/server/runtime/**",
      "apps/control/server/runtime-policies/**",
      "apps/control/server/terminal/**",
      "apps/control/server/workers/**",
      "apps/control/src/components/agents/**",
      "apps/control/src/components/instances/**",
      "apps/control/src/lib/agent-platforms*",
      "apps/control/src/lib/terminal-session*",
      "apps/control/src/routes/*instances*",
    ],
    controlTestPatterns: [
      "apps/control/server/instances/**",
      "apps/control/server/jobs/**",
      "apps/control/server/kubernetes/**",
      "apps/control/server/runtime/**",
      "apps/control/server/runtime-policies/**",
      "apps/control/server/terminal/**",
      "apps/control/server/workers/**",
      "apps/control/src/components/agents/**",
      "apps/control/src/components/instances/**",
      "apps/control/src/lib/agent-platforms.test.ts",
      "apps/control/src/lib/terminal-session.test.ts",
    ],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: [],
  },
  {
    id: "memory",
    block: "control-plane",
    label: "Control / Durable Memory",
    sourcePatterns: [
      "apps/control/server/memories/**",
      "apps/control/server/runtime-bridge/memory-runtime-sanitizer.ts",
      "apps/control/server/runtime-bridge/project-memory-runtime-service*",
      "apps/control/src/components/agents/durable-memory-selection*",
      "apps/control/src/features/memory/**",
      "apps/control/src/routes/-memory-routing.test.ts",
      "apps/runner/src/openclaw-durable-memory-plugin*",
      "apps/runner/src/hermes-config-bootstrap*",
      "runtime-integrations/hermes-durable-memory-provider/**",
    ],
    controlTestPatterns: [
      "apps/control/server/memories/**",
      "apps/control/server/runtime-bridge/project-memory-runtime-service.test.ts",
      "apps/control/src/components/agents/durable-memory-selection.test.ts",
      "apps/control/src/features/memory/**",
      "apps/control/src/routes/-memory-routing.test.ts",
    ],
    pythonTests: [
      "runtime-integrations/hermes-durable-memory-provider/tests/test_provider.py",
    ],
    nodeTests: [],
    runnerTestPatterns: [
      "apps/runner/src/openclaw-durable-memory-plugin.test.ts",
      "apps/runner/src/hermes-config-bootstrap.test.ts",
    ],
  },
  {
    id: "vector-database",
    block: "control-plane",
    label: "Control / Vector Database, Docling, chunking and embedding",
    sourcePatterns: [
      "apps/control/server/catalog/**",
      "apps/control/server/runtime-bridge/project-vector-database-runtime-service*",
      "apps/control/src/features/vector-database-file-browser/**",
      "apps/runner/src/hermes-config-bootstrap*",
      "runtime-integrations/hermes-vector-database-plugin/**",
    ],
    controlTestPatterns: [
      "apps/control/server/catalog/**",
      "apps/control/server/runtime-bridge/project-vector-database-runtime-service.test.ts",
      "apps/control/src/features/vector-database-file-browser/**",
    ],
    pythonTests: [
      "runtime-integrations/hermes-vector-database-plugin/tests/test_client.py",
    ],
    nodeTests: [],
    runnerTestPatterns: [
      "apps/runner/src/hermes-config-bootstrap.test.ts",
    ],
  },
  {
    id: "a2a",
    block: "control-plane",
    label: "Control / A2A Registry, discovery and delegation",
    sourcePatterns: [
      "apps/control/server/agent-garden/**",
      "apps/control/server/runtime-bridge/project-agent-runtime-service.ts",
      "apps/control/src/components/agent-garden/**",
      "apps/control/src/components/mcp/**",
      "apps/control/src/routes/-agent-garden-routing.test.ts",
      "apps/example-mcp-server/src/a2a*",
      "apps/runner/src/hermes-a2a-plugin*",
      "runtime-integrations/hermes-a2a-plugin/**",
    ],
    controlTestPatterns: [
      "apps/control/server/agent-garden/**",
      "apps/control/src/components/agent-garden/**",
      "apps/control/src/components/mcp/**",
      "apps/control/src/routes/-agent-garden-routing.test.ts",
    ],
    pythonTests: [
      "runtime-integrations/hermes-a2a-plugin/tests/test_client.py",
    ],
    nodeTests: [],
    runnerTestPatterns: [
      "apps/runner/src/hermes-a2a-plugin.test.ts",
    ],
    workspaceTests: [{
      workspace: "@tali/example-mcp-server",
      root: "apps/example-mcp-server",
      patterns: ["apps/example-mcp-server/src/a2a.test.ts"],
    }],
  },
  {
    id: "observability",
    block: "control-plane",
    label: "Control / Audit, runs and observability",
    sourcePatterns: [
      "apps/control/server/audit-logs/**",
      "apps/control/server/observability/**",
      "apps/control/server/overview/**",
      "apps/control/server/runs/**",
      "apps/control/server/traces/**",
      "apps/control/src/features/audit-logs/**",
      "apps/control/src/features/traces/**",
      "runtime-integrations/hermes-run-telemetry/**",
    ],
    controlTestPatterns: [
      "apps/control/server/audit-logs/**",
      "apps/control/server/observability/**",
      "apps/control/server/overview/**",
      "apps/control/server/runs/**",
      "apps/control/src/features/audit-logs/**",
      "apps/control/src/features/traces/**",
    ],
    pythonTests: [
      "runtime-integrations/hermes-run-telemetry/tests/test_plugin.py",
    ],
    nodeTests: [],
    runnerTestPatterns: [],
  },
  {
    id: "control-ui",
    block: "control-plane",
    label: "Control / UI shell and HTTP contracts",
    sourcePatterns: [
      "apps/control/server/*.ts",
      "apps/control/server/api-contracts/**",
      "apps/control/server/config/**",
      "apps/control/server/http/**",
      "apps/control/server/middleware/**",
      "apps/control/server/plugins/**",
      "apps/control/server/routes/**",
      "apps/control/server/secrets/**",
      "apps/control/server/tools/**",
      "apps/control/src/**",
      "apps/control/src/components/layout/**",
      "apps/control/src/components/shared/**",
      "apps/control/src/components/ui/**",
      "apps/control/src/i18n/**",
      "apps/control/src/lib/api*",
      "apps/control/src/lib/csv*",
      "apps/control/src/lib/help-content*",
      "apps/control/src/lib/project-storage*",
      "apps/control/src/lib/uuid*",
      "apps/control/src/styles.typography.test.ts",
    ],
    controlTestPatterns: [
      "apps/control/server/api-contracts/**",
      "apps/control/server/http/**",
      "apps/control/src/components/layout/**",
      "apps/control/src/components/shared/**",
      "apps/control/src/components/ui/**",
      "apps/control/src/i18n/**",
      "apps/control/src/lib/api.test.ts",
      "apps/control/src/lib/csv.test.ts",
      "apps/control/src/lib/help-content.test.ts",
      "apps/control/src/lib/project-storage.test.ts",
      "apps/control/src/lib/uuid.test.ts",
      "apps/control/src/styles.typography.test.ts",
    ],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: [],
  },
  {
    id: "openshell-isolation",
    block: "data-plane",
    label: "Data / OpenShell multi-tenant isolation",
    sourcePatterns: [
      "apps/control/server/kubernetes/project-namespace-client*",
      "apps/control/server/kubernetes/project-openshell-gateway-client*",
      "apps/control/server/projects/project-runtime-target-service*",
      "apps/runner/src/openshell.ts",
      "apps/runner/src/project-service-proxy.ts",
      "apps/runner/src/runtime-target*",
      "charts/tali-relay/**",
    ],
    controlTestPatterns: [
      "apps/control/server/kubernetes/project-namespace-client.test.ts",
      "apps/control/server/kubernetes/project-openshell-gateway-client.test.ts",
      "apps/control/server/projects/project-runtime-target-service.test.ts",
    ],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: ["apps/runner/src/runtime-target.test.ts"],
  },
  {
    id: "runtime",
    block: "data-plane",
    label: "Data / Hermes, OpenClaw and DeepAgents runtimes",
    sourcePatterns: [
      "apps/runner/src/agent-platform.ts",
      "apps/runner/src/index.ts",
      "apps/runner/src/nemoclaw*",
      "infra/docker/Dockerfile.nemoclaw-*",
      "scripts/build-nemoclaw-sandbox.sh",
      "scripts/patch-hermes-*",
      "scripts/verify-hermes-*",
    ],
    controlTestPatterns: [],
    pythonTests: [],
    nodeTests: [],
    runnerTestPatterns: [
      "apps/runner/src/nemoclaw*.test.ts",
    ],
  },
  {
    id: "runtime-integrations",
    block: "data-plane",
    label: "Data / Runtime A2A, Memory, Vector Database, telemetry and Web UI integrations",
    sourcePatterns: [
      "apps/runner/src/hermes-a2a-plugin*",
      "apps/runner/src/hermes-config-bootstrap*",
      "apps/runner/src/openclaw-durable-memory-plugin*",
      "apps/example-mcp-server/**",
      "runtime-integrations/**",
      "apps/control/server/runtime-bridge/project-runtime-bridge-auth.ts",
      "apps/control/server/runtime-bridge/project-runtime-bridge-server.ts",
      "scripts/bootstrap-hermes-config.py",
    ],
    controlTestPatterns: [],
    pythonTests: [
      "runtime-integrations/hermes-a2a-plugin/tests/test_client.py",
      "runtime-integrations/hermes-durable-memory-provider/tests/test_provider.py",
      "runtime-integrations/hermes-run-telemetry/tests/test_plugin.py",
      "runtime-integrations/hermes-vector-database-plugin/tests/test_client.py",
      "runtime-integrations/test_hermes_webui_auth_proxy.py",
    ],
    nodeTests: [],
    runnerTestPatterns: [
      "apps/runner/src/hermes-a2a-plugin.test.ts",
      "apps/runner/src/hermes-config-bootstrap.test.ts",
      "apps/runner/src/openclaw-durable-memory-plugin.test.ts",
    ],
    workspaceTests: [{
      workspace: "@tali/example-mcp-server",
      root: "apps/example-mcp-server",
      patterns: ["apps/example-mcp-server/src/basic-auth.test.ts"],
    }],
  },
  {
    id: GOLDEN_PATH_MODULE_ID,
    scope: "cross-plane",
    label: "Cross-plane / Agent golden path",
    sourcePatterns: [
      ".github/workflows/live-hermes-e2e.yml",
      "scripts/testing/live-hermes-e2e-lib.mjs",
      "scripts/testing/live-hermes-golden-path*",
    ],
    controlTestPatterns: [
      "apps/control/server/e2e/agent-golden-path.e2e.test.ts",
    ],
    pythonTests: [],
    nodeTests: [
      "scripts/testing/live-hermes-golden-path.test.mjs",
    ],
    runnerTestPatterns: [],
  },
];

const GLOBAL_PATTERNS = [
  ".github/actions/setup-node-workspace/**",
  ".github/workflows/pr-ci.yml",
  "apps/control/prisma/**",
  "apps/control/prisma.config.ts",
  "apps/control/server/db/**",
  "apps/control/server/generated/**",
  "apps/control/server/test/**",
  "apps/control/tsconfig.json",
  "apps/control/vitest.config.ts",
  "apps/control/vite*.config.ts",
  "apps/runner/tsconfig.json",
  "package-lock.json",
  "package.json",
  "packages/contracts/**",
  "scripts/testing/**",
  "tsconfig.base.json",
];

const GOLDEN_PATH_DEPENDENCIES = new Set([
  "access",
  "inference",
  "agent-lifecycle",
  "memory",
  "vector-database",
  "a2a",
  "openshell-isolation",
  "runtime",
  "runtime-integrations",
]);

function escapeRegularExpression(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegularExpression(pattern) {
  const source = pattern
    .split("**")
    .map((part) => escapeRegularExpression(part).replaceAll("*", "[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

export function matchesAny(path, patterns) {
  return patterns.some((pattern) => globToRegularExpression(pattern).test(path));
}

export function selectTestModuleIds(changedPaths) {
  const normalized = [...new Set(changedPaths.map((path) => path.trim()))]
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (normalized.some((path) => matchesAny(path, GLOBAL_PATTERNS))) {
    return testModules.map(({ id }) => id);
  }

  const selected = new Set();
  for (const path of normalized) {
    let matched = false;
    for (const module of testModules) {
      if (matchesAny(path, module.sourcePatterns)) {
        selected.add(module.id);
        matched = true;
      }
    }
    // A new Control file must not silently escape tests while the map catches up.
    if (!matched && path.startsWith("apps/control/")) {
      for (const id of ALL_CONTROL_MODULE_IDS) selected.add(id);
    }
  }
  if ([...selected].some((id) => GOLDEN_PATH_DEPENDENCIES.has(id))) {
    selected.add(GOLDEN_PATH_MODULE_ID);
  }
  return testModules
    .map(({ id }) => id)
    .filter((id) => selected.has(id));
}

export function sourceOwnerModuleIds(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return testModules
    .filter((module) => matchesAny(normalized, module.sourcePatterns))
    .map(({ id }) => id);
}

export function isGlobalTestInfrastructurePath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return matchesAny(normalized, GLOBAL_PATTERNS);
}

export function moduleMatrix(moduleIds) {
  const selected = new Set(moduleIds);
  return {
    include: testModules
      .filter(({ id }) => selected.has(id))
      .map(({ id, label, block, scope }) => ({
        module: id,
        label,
        block: block ?? scope,
      })),
  };
}

export function testModule(id) {
  return testModules.find((module) => module.id === id);
}
