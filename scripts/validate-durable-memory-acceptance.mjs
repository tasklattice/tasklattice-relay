#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(label, command, args, cwd = root) {
  console.log(`\n[durable-memory] ${label}`);
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env });
}

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) return filesBelow(target);
    return statSync(target).isFile() ? [target] : [];
  });
}

function validateProductionHasNoMemoryMocks() {
  const roots = [
    join(root, "apps/control/server/memories"),
    join(root, "apps/control/src/features/memory"),
    join(root, "apps/runner/src"),
  ];
  const violations = roots.flatMap(filesBelow)
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path))
    .filter((path) => !path.includes("/testing/"))
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return /FakeMemoryProvider|fake-memory-provider|mockMemory(?:Data|Items|Conversations)|memoryDemoData/.test(source);
    })
    .map((path) => relative(root, path));
  if (violations.length) {
    throw new Error(`Production Durable Memory mock/fallback references found:\n${violations.join("\n")}`);
  }
  const factory = readFileSync(
    join(root, "apps/control/server/memories/memory-provider-factory.ts"),
    "utf8",
  );
  if (!factory.includes("HindsightMemoryProvider") || /FakeMemoryProvider/.test(factory)) {
    throw new Error("Production Memory provider factory must select only Hindsight.");
  }
}

const controlTests = [
  "server/instances/instance-service.test.ts",
  "server/memories/durable-memory-feature.test.ts",
  "server/memories/hindsight-memory-provider.integration.test.ts",
  "server/memories/memory-domain.test.ts",
  "server/memories/memory-export-token.test.ts",
  "server/memories/memory-governance-service.test.ts",
  "server/memories/memory-metrics.test.ts",
  "server/memories/memory-outbox-cipher.test.ts",
  "server/memories/memory-provider-factory.test.ts",
  "server/memories/memory-provider.contract.test.ts",
  "server/memories/memory-repository.test.ts",
  "server/memories/memory-service.test.ts",
  "server/projects/project-deletion-service.test.ts",
  "server/runtime-bridge/project-memory-runtime-service.test.ts",
  "server/runtime-bridge/project-runtime-bridge-token.test.ts",
  "server/audit-logs/audit-request.test.ts",
  "server/audit-logs/audit-log-service.test.ts",
  "server/authorization/admission-control.test.ts",
  "server/authorization/builtin-roles.test.ts",
  "server/authorization/project-capability-admission-middleware.test.ts",
  "server/authorization/route-capabilities.test.ts",
  "server/observability/structured-logger.test.ts",
  "src/components/agents/durable-memory-selection.test.ts",
  "src/components/layout/app-shell-navigation.test.ts",
  "src/features/memory/memory-ui.test.ts",
  "src/hooks/use-project-permissions.test.ts",
  "src/routes/-memory-routing.test.ts",
];

run(
  "Scenarios 1-13, 15 and security/observability behavior",
  join(root, "node_modules/.bin/vitest"),
  ["run", "--maxWorkers=4", "--testTimeout=15000", ...controlTests],
  join(root, "apps/control"),
);
run(
  "OpenClaw and Hermes runtime integration",
  join(root, "node_modules/.bin/vitest"),
  [
    "run",
    "src/openclaw-durable-memory-plugin.test.ts",
    "src/hermes-config-bootstrap.test.ts",
  ],
  join(root, "apps/runner"),
);
run("Pinned Hindsight live integration", "npm", ["run", "test:hindsight:integration"]);
run("Kubernetes and monitoring manifests", "node", ["scripts/validate-helm-resources.mjs"]);
run("OpenShift arbitrary-UID manifests", "node", ["scripts/validate-helm-openshift.mjs"]);
run("Database upgrade compatibility", "node", ["scripts/validate-prisma-migrations.mjs"]);

validateProductionHasNoMemoryMocks();

const scenarios = [
  "1 automatic Memory provisioning and binding",
  "2 Agent deletion preserves Memory/Bank/content as unbound",
  "3 same-runtime OpenClaw continuity",
  "4 Hermes/OpenClaw cross-runtime continuity",
  "5 Fact revision changes current recall",
  "6 invalidate and restore",
  "7 Conversation evidence redaction/deletion invalidates derived content",
  "8 provider outage fails open and outbox delivers exactly once after recovery",
  "9 Project/Memory/Bank/runtime-token isolation",
  "10 bound deletion block and verified retryable Bank deletion",
  "11 secrets excluded from provider, logs, audit, export, metrics and UI",
  "12 role capability and UI visibility matrix",
  "13 reproducible UI loading/empty/error/degraded/deletion/conflict states",
  "14 OpenShift non-root/read-only/minimal-RBAC rendering",
  "15 additive migration over an existing Project/Instance database",
  "16 production Memory build has no mock provider or fixed fallback data",
];
console.log("\nDurable Memory acceptance passed:");
for (const scenario of scenarios) console.log(`- ${scenario}`);
