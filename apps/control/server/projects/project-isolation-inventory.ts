import { z } from "zod";

// Worker publishes desired, non-secret infrastructure from the same generators
// used by reconciliation. Control needs neither worker.toml nor Helm execution.
export const ISOLATION_NAMESPACE = "tp-aaaaaaaaaaaaa";
export const ISOLATION_PROJECT_ID = "__TALI_PROJECT_ID__";
export const ISOLATION_PROJECT_NAME = "__TALI_PROJECT_NAME__";
export const ISOLATION_NAMESPACE_UID = "__TALI_NAMESPACE_UID__";
export const projectIsolationInventorySchema = z.object({
  controlUrl: z.string(),
  resources: z.array(z.object({
    resource: z.record(z.string(), z.unknown()),
    secretKeys: z.array(z.string()).optional(),
  })),
  unavailable: z.string().optional(),
});
export type ProjectIsolationInventory = z.infer<typeof projectIsolationInventorySchema>;

export function instantiateIsolationInventory(
  inventory: ProjectIsolationInventory,
  input: { namespace: string; projectId: string; projectName: string; uid: string },
): ProjectIsolationInventory {
  function replace(value: unknown): unknown {
    if (typeof value === "string") return value
      .replaceAll(ISOLATION_NAMESPACE, input.namespace)
      .replaceAll(ISOLATION_PROJECT_ID, input.projectId)
      .replaceAll(ISOLATION_PROJECT_NAME, input.projectName)
      .replaceAll(ISOLATION_NAMESPACE_UID, input.uid);
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replace(item)]),
    );
    return value;
  }
  return replace(inventory) as ProjectIsolationInventory;
}
