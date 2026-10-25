import type { Instance } from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentProjectId } from "@/hooks/use-project";
import type { InstanceDetailTab } from "./instance-detail-model";
import { InstanceStatusBadge } from "./instance-detail-shared";

export function InstanceDetailHeader({
  actions,
  icon,
  metadata,
  name,
  status,
}: {
  actions: ReactNode;
  icon: ReactNode;
  metadata: ReactNode;
  name: string;
  status: Instance["status"];
}) {
  const projectId = useCurrentProjectId();
  return (
    <header className="border-b">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pb-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
          >
            <Link
              to="/$projectId/instances"
              params={{ projectId }}
              aria-label="Back to Instances"
            >
              <ArrowLeft />
            </Link>
          </Button>
          {icon}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 max-w-full break-words font-display text-2xl font-semibold tracking-[-0.02em]">
                {name}
              </h1>
              <InstanceStatusBadge status={status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {metadata}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}

export function InstanceSummaryLink({
  hash,
  icon: Icon,
  instanceId,
  label,
  tab = "capabilities",
  value,
}: {
  hash?: string;
  icon: LucideIcon;
  instanceId: string;
  label: string;
  tab?: InstanceDetailTab;
  value: ReactNode;
}) {
  const projectId = useCurrentProjectId();
  return (
    <Link
      to="/$projectId/instances/$instanceId"
      params={{ projectId, instanceId }}
      search={{ tab }}
      {...(hash ? { hash } : {})}
      className="flex min-h-14 items-center gap-3 border-b px-5 py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      <span className="min-w-0 break-words text-right text-xs text-muted-foreground">
        {value}
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function InstanceResourceSection({
  children,
  icon: Icon,
  id,
  title,
}: {
  children: ReactNode;
  icon: LucideIcon;
  id: string;
  title: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="grid scroll-mt-24 gap-4 border-b p-5 last:border-b-0 @xl/resources:grid-cols-[10rem_minmax(0,1fr)]"
    >
      <h3
        id={`${id}-heading`}
        className="flex items-start gap-2 text-sm font-semibold"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {title}
      </h3>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export function InstanceUnavailablePanel({
  icon: Icon,
  reason,
  title,
}: {
  icon: LucideIcon;
  reason: string;
  title: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {reason}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
