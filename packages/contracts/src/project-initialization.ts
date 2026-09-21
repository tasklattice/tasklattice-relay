import { z } from "zod";

export const projectNamespaceCheckSchema = z.object({
  checkedAt: z.string(),
  namespace: z.string(),
  clusterId: z.string(),
  healthy: z.boolean(),
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(["passed", "failed", "unavailable"]),
    message: z.string(),
  })),
});

export type ProjectNamespaceCheck = z.infer<typeof projectNamespaceCheckSchema>;
