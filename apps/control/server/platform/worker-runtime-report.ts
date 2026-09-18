import { z } from "zod";
const schema = z.object({
  reportedAt: z.string().datetime(),
  workerId: z.string(),
  ready: z.boolean(),
  projectTargetRouting: z.boolean(),
  kubernetesAccess: z.boolean(),
  sandbox: z
    .object({
      gatewayImage: z.string(),
      supervisorImage: z.string(),
      defaultImage: z.string(),
      defaultImagePullPolicy: z.enum(["Always", "IfNotPresent", "Never"]),
      tlsDisabled: z.boolean(),
    })
    .optional(),
});
export type WorkerRuntimeReport = z.infer<typeof schema>;
export function readWorkerRuntime(
  value: unknown,
): WorkerRuntimeReport | undefined {
  const result = schema.safeParse(value);
  if (
    !result.success ||
    Date.now() - Date.parse(result.data.reportedAt) > 120000
  )
    return undefined;
  return result.data;
}
export function requireWorkerRuntime(value: unknown): WorkerRuntimeReport {
  const report = readWorkerRuntime(value);
  if (!report?.ready || !report.kubernetesAccess)
    throw new Error(
      "No ready Worker with verified Kubernetes resource access has reported recently.",
    );
  return report;
}
