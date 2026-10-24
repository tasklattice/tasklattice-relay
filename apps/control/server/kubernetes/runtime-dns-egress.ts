import type { V1NetworkPolicyPort } from "@kubernetes/client-node";
import { getWorkerConfig } from "../config/worker-config";

export function runtimeDnsEgressPorts(): V1NetworkPolicyPort[] {
  // OCP exposes DNS on Service port 53 but serves it on Pod port 5353.
  // Policies enforced after Service DNAT must allow that destination too.
  const ports = getWorkerConfig().openshift.enabled ? [53, 5353] : [53];
  return ports.flatMap((port) => [
    { port, protocol: "UDP" },
    { port, protocol: "TCP" },
  ]);
}
