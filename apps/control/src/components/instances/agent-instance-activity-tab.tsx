import type { AgentInstanceDetail } from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  MessagesSquare,
  Network,
  Radio,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentProjectId } from "@/hooks/use-project";
import { DetailCardHeader, RelativeTime } from "./instance-detail-shared";

const ansiEscapePattern = new RegExp("\\u001B\\[[0-?]*[ -/]*[@-~]", "g");

function readableLifecycleEvent(value: string) {
  return value.replace(ansiEscapePattern, "").trim();
}

export function AgentInstanceActivityTab({
  detail,
}: {
  detail: AgentInstanceDetail;
}) {
  const projectId = useCurrentProjectId();
  const lifecycleLogs = detail.instance.logs
    .slice(-8)
    .reverse()
    .map(readableLifecycleEvent);
  const hasMoreLifecycleLogs =
    detail.instance.logs.length > lifecycleLogs.length;
  const discoverable =
    detail.status === "READY" && detail.capabilities.acceptsDelegation;
  return (
    <div
      role="tabpanel"
      aria-label="Activity"
      className="grid gap-4 pt-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(19rem,.6fr)]"
    >
      <Card className="min-w-0">
        <DetailCardHeader
          title="Agent activity"
          description="Lifecycle evidence for this Agent Instance. Coordination and invocation events use the same work model when available."
        />
        <CardContent>
          <ol className="space-y-0">
            <li className="relative flex gap-3 border-b py-4">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Activity className="size-4" />
              </span>
              <div className="min-w-0">
                <strong className="text-sm">Agent Instance created</strong>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {detail.runtimeView.type} runtime registered{" "}
                  <RelativeTime value={detail.createdAt} />.
                </p>
              </div>
            </li>
            {lifecycleLogs.length
              ? lifecycleLogs.map((entry, index) => (
                  <li
                    key={`${index}-${entry}`}
                    className="relative flex gap-3 border-b py-4 last:border-b-0"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <strong className="text-sm">Lifecycle event</strong>
                      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                        {entry}
                      </p>
                    </div>
                  </li>
                ))
              : null}
          </ol>
          {hasMoreLifecycleLogs ? (
            <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
              Showing the latest {lifecycleLogs.length} of{" "}
              {detail.instance.logs.length} lifecycle entries.
              {detail.kind === "SUPERVISOR" ? (
                <>
                  {" "}
                  <Link
                    to="/$projectId/instances/$instanceId"
                    params={{ projectId, instanceId: detail.id }}
                    search={{ tab: "logs" }}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    View complete output in Logs
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <DetailCardHeader
            title="Coordination"
            description="Whether this Agent can plan and delegate work to other Agents."
            action={<Network className="size-5 text-primary" />}
          />
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <strong className="text-sm">
                  {detail.capabilities.canDelegate
                    ? "Coordinates work"
                    : detail.capabilities.canPlan
                      ? "Plans its own work"
                      : "Focused execution"}
                </strong>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {detail.capabilities.canDelegate
                    ? "Delegation and child-run evidence will appear in this activity stream."
                    : "This Agent does not delegate work to other Agent Instances."}
                </p>
              </div>
              <Badge variant="outline">
                {detail.capabilities.canDelegate ? "Enabled" : "Not enabled"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <DetailCardHeader
            title="Delegated work"
            description="Whether compatible Agents can discover and invoke this Instance."
            action={
              detail.capabilities.acceptsDelegation ? (
                <MessagesSquare className="size-5 text-primary" />
              ) : (
                <Radio className="size-5 text-muted-foreground" />
              )
            }
          />
          <CardContent>
            <strong className="text-sm">
              {discoverable
                ? "Discoverable in this Project"
                : detail.capabilities.acceptsDelegation
                  ? "Temporarily unavailable for delegation"
                  : "Does not accept delegated work"}
            </strong>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {detail.capabilities.acceptsDelegation
                ? "Discovery also requires a READY Instance, a valid protocol profile, and a reachable endpoint."
                : "This work profile is used directly rather than through the Project callable registry."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
