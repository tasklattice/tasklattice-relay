import type { AgentInstanceDetail } from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import { Activity, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentProjectId } from "@/hooks/use-project";
import { DetailCardHeader, RelativeTime } from "./instance-detail-shared";

const ansiEscapePattern = new RegExp("\\u001B\\[[0-?]*[ -/]*[@-~]", "g");

function readableLifecycleEvent(value: string) {
  return value.replace(ansiEscapePattern, "").trim();
}

export function AgentInstanceActivityTab({
  detail,
  error,
  loading = false,
  onRetry,
}: {
  detail: AgentInstanceDetail;
  error?: Error;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const projectId = useCurrentProjectId();
  const lifecycleLogs = detail.instance.logs
    .slice(-8)
    .reverse()
    .map(readableLifecycleEvent);
  const hasMoreLifecycleLogs =
    detail.instance.logs.length > lifecycleLogs.length;
  return (
    <div role="tabpanel" aria-label="Activity" className="pt-5">
      <Card className="min-w-0">
        <DetailCardHeader title="Lifecycle" />
        <CardContent>
          {loading ? (
            <p role="status" className="pb-3 text-sm text-muted-foreground">
              Loading lifecycle events…
            </p>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="mb-3 space-y-2 border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive"
            >
              <p>Lifecycle events could not be loaded. {error.message}</p>
              {onRetry ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          <ol className="space-y-0">
            <li className="relative flex gap-3 border-b py-4">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-link">
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
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Clock3 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-xs leading-5">{entry}</p>
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
    </div>
  );
}
