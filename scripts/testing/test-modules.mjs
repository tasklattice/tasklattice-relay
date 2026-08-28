const ALL_CONTROL_MODULE_IDS = [
  "access",
  "inference",
  "agent-lifecycle",
  "memory",
  "knowledge-a2a",
  "observability",
  "control-ui",
];

export const GOLDEN_PATH_MODULE_ID = "agent-golden-path";

export const testModules = [
  {
    id: "access",
    label: "Access and project governance",
    sourcePatterns: [
      "apps/control/server/access-policies/**",
      "apps/control/server/auth/**",
      "apps/control/server/authorization/**",
      "apps/control/server/departments/department-service.ts",
      "apps/control/server/departments/department-settings-service.ts",
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
    runnerTestPatterns: [],
  },
  {
    id: "inference",
    label: "Providers, models, routing and quota",
    sourcePatterns: [
      "apps/control/server/departments/department-inference-store*",
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
    runnerTestPatterns: [],
  },
  {
    id: "agent-lifecycle",
    label: "Agent lifecycle and runtime control",
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
    runnerTestPatterns: [],
  },
  {
    id: "memory",
    label: "Durable Memory",
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
    runnerTestPatterns: [
      "apps/runner/src/openclaw-durable-memory-plugin.test.ts",
      "apps/runner/src/hermes-config-bootstrap.test.ts",
    ],
  },
  {
    id: "knowledge-a2a",
    label: "Knowledge and A2A",
    sourcePatterns: [
      "apps/control/server/agent-garden/**",
      "apps/control/server/catalog/**",
      "apps/control/server/runtime-bridge/project-agent-runtime-service.ts",
      "apps/control/server/runtime-bridge/project-vector-database-runtime-service*",
      "apps/control/src/components/agent-garden/**",
      "apps/control/src/components/mcp/**",
      "apps/control/src/features/vector-database-file-browser/**",
      "apps/control/src/routes/-agent-garden-routing.test.ts",
      "apps/runner/src/hermes-a2a-plugin*",
      "apps/runner/src/hermes-config-bootstrap*",
      "runtime-integrations/hermes-a2a-plugin/**",
      "runtime-integrations/hermes-vector-database-plugin/**",
    ],
    controlTestPatterns: [
      "apps/control/server/agent-garden/**",
      "apps/control/server/catalog/**",
      "apps/control/server/runtime-bridge/project-vector-database-runtime-service.test.ts",
      "apps/control/src/components/agent-garden/**",
      "apps/control/src/components/mcp/**",
      "apps/control/src/features/vector-database-file-browser/**",
      "apps/control/src/routes/-agent-garden-routing.test.ts",
    ],
    pythonTests: [
      "runtime-integrations/hermes-a2a-plugin/tests/test_client.py",
      "runtime-integrations/hermes-vector-database-plugin/tests/test_client.py",
    ],
    runnerTestPatterns: [
      "apps/runner/src/hermes-a2a-plugin.test.ts",
      "apps/runner/src/hermes-config-bootstrap.test.ts",
    ],
  },
  {
    id: "observability",
    label: "Audit, runs and observability",
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
    runnerTestPatterns: [],
  },
  {
    id: "control-ui",
    label: "Control UI and HTTP contracts",
    sourcePatterns: [
      "apps/control/server/api-contracts/**",
      "apps/control/server/http/**",
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
    runnerTestPatterns: [],
  },
  {
    id: "runtime",
    label: "Runner and Hermes interaction",
    sourcePatterns: [
      "apps/runner/**",
      "infra/docker/Dockerfile.nemoclaw-*",
      "runtime-integrations/**",
      "scripts/bootstrap-hermes-config.py",
      "scripts/build-nemoclaw-sandbox.sh",
      "scripts/patch-hermes-*",
      "scripts/verify-hermes-*",
    ],
    controlTestPatterns: [],
    pythonTests: [
      "runtime-integrations/hermes-a2a-plugin/tests/test_client.py",
      "runtime-integrations/hermes-durable-memory-provider/tests/test_provider.py",
      "runtime-integrations/hermes-run-telemetry/tests/test_plugin.py",
      "runtime-integrations/hermes-vector-database-plugin/tests/test_client.py",
      "runtime-integrations/test_hermes_webui_auth_proxy.py",
    ],
    runnerTestPatterns: ["apps/runner/src/**"],
  },
  {
    id: GOLDEN_PATH_MODULE_ID,
    label: "Agent golden path",
    sourcePatterns: [],
    controlTestPatterns: [
      "apps/control/server/e2e/agent-golden-path.e2e.test.ts",
    ],
    pythonTests: [],
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
  "knowledge-a2a",
  "runtime",
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

export function moduleMatrix(moduleIds) {
  const selected = new Set(moduleIds);
  return {
    include: testModules
      .filter(({ id }) => selected.has(id))
      .map(({ id, label }) => ({ module: id, label })),
  };
}

export function testModule(id) {
  return testModules.find((module) => module.id === id);
}
