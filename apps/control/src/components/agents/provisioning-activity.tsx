import type { InstanceStatus, ProvisioningStage } from "@tali/contracts";
import { AlertTriangle, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { ProvisioningLog } from "@/components/agents/provisioning-log";
import { resolveProvisioningState } from "@/components/agents/provisioning-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

export function ProvisioningActivity({
  action,
  error,
  logs,
  stage,
  status,
}: {
  action?: ReactNode;
  error?: string;
  logs: string[];
  stage?: ProvisioningStage;
  status: InstanceStatus;
}) {
  const state = resolveProvisioningState({
    status,
    ...(stage ? { stage } : {}),
  });
  const live = status === "PROVISIONING";

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {live ? <Spinner className="size-4 text-link" /> : status === "FAILED" ? <AlertTriangle className="size-4 text-destructive" /> : <ScrollText className="size-4" />}
              {state.statusLabel}
            </CardTitle>
            <CardDescription className="mt-2">{state.statusDescription}</CardDescription>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 py-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="font-medium">Runtime initialization</span>
            <span className="tabular-nums text-muted-foreground">{state.progress}%</span>
          </div>
          <Progress
            value={state.progress}
            aria-label="Runtime initialization progress"
            aria-valuetext={`${state.statusLabel}, ${state.progress}%`}
            className="h-2"
          />
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-2 border-l-2 border-destructive bg-destructive/5 px-3 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        <ProvisioningLog lines={logs} state={status === "FAILED" ? "failed" : live ? "live" : "complete"} />
      </CardContent>
    </Card>
  );
}
