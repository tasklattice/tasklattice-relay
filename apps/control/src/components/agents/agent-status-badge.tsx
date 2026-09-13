import type { InstanceStatus } from "@tali/contracts";
import { RuntimeStatusBadge } from "@/components/shared/status";

export function AgentStatusBadge({ status }: { status: InstanceStatus }) {
  return <RuntimeStatusBadge status={status} />;
}
