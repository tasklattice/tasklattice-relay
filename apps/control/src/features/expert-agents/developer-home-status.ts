import type { StatusTone } from "@/components/shared/status";

export function instanceHealthTone(
  healthyInstances: number,
  currentInstances: number,
): StatusTone | undefined {
  if (currentInstances <= 0) return undefined;
  return healthyInstances === currentInstances ? "success" : "warning";
}
