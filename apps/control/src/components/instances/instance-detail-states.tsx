import { AlertTriangle, ArrowLeft, SearchX, ShieldX } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProjectId } from "@/hooks/use-project";

export function InstanceDetailSkeleton() {
  return (
    <div aria-label="Loading Instance detail" className="space-y-5">
      <div className="flex items-center gap-4 border-b pb-5"><Skeleton className="size-11" /><Skeleton className="size-14" /><div className="space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-72" /></div><div className="ml-auto hidden gap-2 md:flex"><Skeleton className="h-11 w-32" /><Skeleton className="h-11 w-32" /><Skeleton className="h-11 w-24" /></div></div>
      <div className="flex gap-4 border-b py-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-24" />)}</div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    </div>
  );
}

function State({ icon: Icon, title, description, retry }: { icon: typeof AlertTriangle; title: string; description: string; retry?: () => void }) {
  const projectId = useCurrentProjectId();
  return (
    <Card className="mx-auto mt-16 max-w-xl">
      <CardContent className="flex min-h-72 flex-col items-center justify-center text-center">
        <Icon className="size-8 text-muted-foreground" />
        <h1 className="mt-4 font-display text-[1.625rem] font-light leading-tight tracking-[0.005em]">{title}</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {retry ? <Button type="button" onClick={retry}>Retry</Button> : null}
          <Button asChild variant="outline"><Link to="/$projectId/instances" params={{ projectId }}><ArrowLeft />Back to Instances</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function InstanceDetailErrorState({ onRetry }: { onRetry: () => void }) {
  return <State icon={AlertTriangle} title="Unable to load Instance" description="The control plane could not load this Instance. Retry the request or return to the Instances list." retry={onRetry} />;
}

export function InstanceNotFoundState() {
  return <State icon={SearchX} title="Instance not found" description="The Instance may have been deleted or you may not have access." />;
}

export function InstanceAccessDeniedState() {
  return <State icon={ShieldX} title="Instance access denied" description="Your active access role does not permit viewing this Instance. Switch access or return to the Instances list." />;
}
