import { readFileSync } from "node:fs";
import { z } from "zod";

const positive = z.number().int().positive();
const port = positive.max(65535);
const schema = z.object({
  schemaVersion: z.literal(1).default(1),
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: port.default(9090),
    token: z.string().min(1).default("local-dev-token"),
    mode: z.enum(["nemoclaw", "openshell-kubernetes", "fixture"]).default("openshell-kubernetes"),
    shutdownTimeoutMs: positive.default(540000),
  }).strict().prefault({}),
  openshell: z.object({
    binary: z.string().min(1).default("openshell"),
    projectTargetRouting: z.boolean().default(false),
    gatewayEndpointTemplate: z.string().default("http://openshell-{namespace}.{namespace}.svc.cluster.local:8080"),
    gatewayEndpoint: z.string().url().default("http://openshell.openshell.svc.cluster.local:8080"),
    workspace: z.string().default("default"),
    serviceBaseUrl: z.string().url().default("http://openshell.localhost:8080"),
    serviceProxy: z.object({
      enabled: z.boolean().default(false),
      host: z.string().default("0.0.0.0"),
      port: port.default(8080),
    }).strict().prefault({}),
    kubernetesServiceCidrs: z.array(z.string().min(1)).default(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]),
    nemoclawVersion: z.string().min(1).default("0.0.123"),
    dashboardPort: z.string().default("18789"),
    deletePollIntervalMs: positive.default(500),
    deleteTimeoutMs: positive.default(60000),
    gatewayReadyTimeoutMs: positive.default(180000),
    startTimeoutMs: positive.default(180000),
    sandbox: z.object({
      cpu: z.string().default("1"),
      cpuRequest: z.string().optional(),
      memory: z.string().default("2Gi"),
      images: z.object({
        openclaw: z.string().min(1).optional(),
        hermes: z.string().min(1).optional(),
        deepagents: z.string().min(1).optional(),
      }).strict().prefault({}),
    }).strict().prefault({}),
  }).strict().prefault({}),
}).strict();

export type RunnerConfig = z.infer<typeof schema>;
let cached: RunnerConfig | undefined;

export function getRunnerConfig(): RunnerConfig {
  if (cached) return cached;
  const path = process.env.TALI_RUNNER_CONFIG;
  if (!path && process.env.NODE_ENV === "production") {
    throw new Error("TALI_RUNNER_CONFIG must point to runner.json in production.");
  }
  const result = schema.safeParse(path ? JSON.parse(readFileSync(path, "utf8")) : {});
  if (!result.success) throw new Error(`Invalid Runner configuration: ${z.prettifyError(result.error)}`);
  cached = result.data;
  return cached;
}

export function setRunnerConfigForTests(config?: RunnerConfig): void {
  cached = config;
}
