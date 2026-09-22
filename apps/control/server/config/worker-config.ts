import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { z } from "zod";

const resources = z.record(z.string(), z.unknown());
const pullPolicy = z.enum(["Always", "IfNotPresent", "Never"]);
const pullSecrets = z.array(z.object({ name: z.string().min(1) }));
const runtimeConfig = z
  .object({
    enabled: z.boolean().default(false),
    image: z.string().default(""),
    imagePullPolicy: pullPolicy.default("IfNotPresent"),
    imagePullSecrets: pullSecrets.default([]),
    resources: resources.default({}),
    revision: z.string().default(""),
    readyTimeoutMs: z.number().int().positive().default(120000),
  })
  .strict();
const openShellConfig = z
  .object({
    enabled: z.boolean().default(false),
    targetRouting: z.boolean().default(false),
    chart: z.string().default("/opt/tali/helm/openshell.tgz"),
    releaseName: z.string().default("openshell"),
    serviceNamePrefix: z.string().default("openshell-"),
    gatewayImageRepository: z.string().default(""),
    gatewayImageTag: z.string().default(""),
    gatewayResources: resources.default({}),
    gatewayPodSecurityContext: z.record(z.string(), z.unknown()).default({}),
    gatewaySecurityContext: z.record(z.string(), z.unknown()).default({}),
    imagePullPolicy: pullPolicy.default("IfNotPresent"),
    imagePullSecrets: pullSecrets.default([]),
    supervisorImageRepository: z.string().default(""),
    supervisorImageTag: z.string().default(""),
    supervisorImagePullPolicy: pullPolicy.default("IfNotPresent"),
    sandboxImage: z.string().default(""),
    sandboxImagePullPolicy: pullPolicy.default("IfNotPresent"),
    sandboxImagePullSecrets: pullSecrets.default([]),
    workspaceDefaultStorageSize: z.string().default("1Gi"),
    workspaceStorageClass: z.string().optional(),
    certgenActiveDeadlineSeconds: z.number().int().positive().default(300),
    helmTimeoutSeconds: z.number().int().positive().default(600),
    helmProcessTimeoutSeconds: z.number().int().positive().default(2100),
    helmBin: z.string().default("helm"),
    ownerRenderer: z
      .string()
      .default("/app/scripts/project-openshell-owner.mjs"),
  })
  .strict()
  .refine((value) => value.helmTimeoutSeconds > value.certgenActiveDeadlineSeconds, {
    message: "helmTimeoutSeconds must exceed certgenActiveDeadlineSeconds",
  })
  .refine((value) => value.helmProcessTimeoutSeconds >= value.helmTimeoutSeconds * 3 + 60, {
    message: "helmProcessTimeoutSeconds must allow three Helm phases plus 60 seconds",
  });
const workerConfigSchema = z
  .object({
    provisioning: z
      .object({ timeoutMs: z.number().int().positive().default(600000) })
      .strict()
      .prefault({}),
    project_openshell: openShellConfig.prefault({}),
    project_runtime_bridge: runtimeConfig.prefault({}),
    expert_agent_runtime: runtimeConfig.prefault({}),
    resource_ownership: z
      .object({
        controlRelease: z.string().default(""),
        controlNamespace: z.string().default(""),
        enabled: z.boolean().default(false),
        sourceTrackingId: z.string().default(""),
        installationId: z.string().default(""),
      })
      .strict()
      .prefault({}),

    healthPort: z.number().int().min(1).max(65535).default(9090),
    role: z.string().min(1).default("tali-control-worker"),
    docling: z
      .object({
        enabled: z.boolean().default(true),
        baseUrl: z.string().url().default("http://localhost:5001"),
        apiKey: z.string().optional(),
      })
      .strict()
      .prefault({}),
  })
  .strict();
const schema = z
  .object({
    worker: workerConfigSchema.superRefine((value, context) => {
      for (const key of [
        "project_runtime_bridge",
        "expert_agent_runtime",
      ] as const) {
        if (value[key].enabled && !value[key].image)
          context.addIssue({
            code: "custom",
            path: [key, "image"],
            message: "Enabled runtimes require an image.",
          });
      }
      if (value.project_openshell.enabled) {
        for (const key of [
          "gatewayImageRepository",
          "gatewayImageTag",
          "supervisorImageRepository",
          "supervisorImageTag",
          "sandboxImage",
        ] as const) {
          if (!value.project_openshell[key])
            context.addIssue({
              code: "custom",
              path: ["project_openshell", key],
              message: "Enabled OpenShell requires an image.",
            });
        }
      }
    }),
  })
  .strict();
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
let cached: WorkerConfig | undefined;
export function developmentWorkerConfig(): WorkerConfig {
  return schema.parse({ worker: {} }).worker;
}
export function getWorkerConfig(): WorkerConfig {
  if (cached) return cached;
  const path = process.env.TALI_WORKER_CONFIG;
  if (!path && process.env.NODE_ENV === "production")
    throw new Error(
      "TALI_WORKER_CONFIG must point to worker.toml in Worker processes.",
    );
  const result = schema.safeParse(
    path ? parse(readFileSync(path, "utf8")) : { worker: {} },
  );
  if (!result.success)
    throw new Error(
      `Invalid Worker configuration: ${z.prettifyError(result.error)}`,
    );
  return (cached = result.data.worker);
}
export function setWorkerConfigForTests(value?: WorkerConfig): void {
  cached = value;
}
