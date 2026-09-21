import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { checkProjectNamespace, getProjectRuntime, reinitializeProject } from "@/services/project";
import type { Project } from "@/types/project";

const statusLabels: Record<string, string> = {
  pending: "Queued", reconciling: "Initializing", retry: "Retry scheduled",
  ready: "Ready", failed: "Failed", deleting: "Deleting",
};

export function ProjectInitializationSettings({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runtimeKey = ["project", project.id, "runtime"];
  const runtime = useQuery({
    queryKey: runtimeKey,
    queryFn: () => getProjectRuntime(project.id),
    refetchInterval: (query) => ["pending", "reconciling", "retry"].includes(query.state.data?.status ?? "") ? 3000 : 30000,
  });
  const check = useQuery({
    // Recheck the cluster when Worker finishes a new generation or changes state.
    queryKey: ["project", project.id, "namespace-check", runtime.data?.status, runtime.data?.observedGeneration],
    queryFn: () => checkProjectNamespace(project.id),
    enabled: !!runtime.data,
    retry: false,
  });
  const initialize = useMutation({
    mutationFn: () => reinitializeProject(project.id),
    onSuccess: (data) => {
      queryClient.setQueryData(runtimeKey, data);
      void queryClient.invalidateQueries({ queryKey: ["project", project.id, "namespace-check"] });
    },
  });
  const canInitialize = project.activeRole === "admin"
    && project.effectiveCapabilities.includes("CAP_RUNTIME_OPERATION_RECONCILE");
  const status = runtime.data?.status;
  const recordedStatus = runtime.isError ? "Unavailable" : status ? statusLabels[status] ?? status : "Loading…";
  const submitted = initialize.isSuccess;
  const finished = submitted && status === "ready"
    && (runtime.data?.observedGeneration ?? 0) >= initialize.data.generation;

  return (
    <section className="space-y-4 p-5" aria-labelledby="project-initialization-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 id="project-initialization-title" className="text-lg font-semibold">Project initialization</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Check the live tenant Namespace and repair Project infrastructure through the background Worker.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={check.isFetching || runtime.isFetching} onClick={() => {
            setDetailsOpen(true);
            void runtime.refetch();
            void check.refetch();
          }}>
            <RefreshCw className={check.isFetching ? "animate-spin motion-reduce:animate-none" : ""} />
            {check.isFetching ? "Checking…" : "Check Namespace"}
          </Button>
          {canInitialize ? <Button variant="edit" disabled={status === "deleting" || initialize.isPending} onClick={() => {
            initialize.reset(); setOpen(true);
          }}>Reinitialize Project</Button> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">Recorded initialization <Badge variant="outline">{recordedStatus}</Badge></span>
        {runtime.data?.updatedAt ? <span className="text-xs text-muted-foreground">Updated {new Date(runtime.data.updatedAt).toLocaleString()}</span> : null}
      </div>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="rounded-md border bg-card">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto min-h-11 w-full justify-between gap-4 whitespace-normal px-4 py-3 text-left text-foreground">
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-semibold" role="status">{runtime.isError ? "Initialization status unavailable" : runtime.data?.lastError ? "Initialization needs attention" : check.isFetching ? "Checking Kubernetes…" : check.isError ? "Namespace check unavailable" : check.data ? check.data.healthy ? "Namespace verified" : "Namespace needs attention" : "Namespace not yet checked"}</span>
              {check.data ? <span className="block text-xs font-normal text-muted-foreground">Last checked {new Date(check.data.checkedAt).toLocaleString()}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
              {detailsOpen ? "Hide details" : "View details"}
              <ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-4" aria-busy={check.isFetching}>
        {runtime.error ? <p role="alert" className="text-sm text-destructive">{runtime.error.message}</p> : null}
        {runtime.data?.lastError ? <p role="alert" className="whitespace-pre-wrap break-words border-l-2 border-destructive pl-3 text-sm text-destructive">{runtime.data.lastError}</p> : null}
        {check.error ? <p role="alert" className="text-sm text-destructive">{check.error.message}</p> : null}
        {check.data ? <>
          <p className="break-words font-mono text-xs text-muted-foreground">{check.data.clusterId} / {check.data.namespace}</p>
          <ul className="divide-y" aria-label="Namespace checks">
            {check.data.checks.map((item) => <li key={item.id} className="flex items-start gap-3 py-3">
              {item.status === "passed" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.label} <span className="ml-2 text-xs font-normal text-muted-foreground">{item.status === "passed" ? "Passed" : item.status === "failed" ? "Failed" : "Unavailable"}</span></p>
                <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.message}</p>
              </div>
            </li>)}
          </ul>
        </> : <p className="text-sm text-muted-foreground">The check reads Kubernetes directly and verifies Namespace mapping, ownership, phase, and Relay metadata.</p>}
        <p className="text-xs text-muted-foreground">Namespace verification does not certify that every Agent or Gateway Pod is healthy.</p>
        </CollapsibleContent>
      </Collapsible>

      <Sheet open={open} onOpenChange={(next) => { if (!initialize.isPending) setOpen(next); }}>
        <SheetContent className="gap-0 sm:max-w-lg" closeDisabled={initialize.isPending}>
          <SheetHeader className="border-b p-5">
            <SheetTitle>Reinitialize Project</SheetTitle>
            <SheetDescription>Repair infrastructure for {project.name}.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="space-y-3 text-sm">
              <div><dt className="text-muted-foreground">Project</dt><dd className="mt-1 break-words font-medium">{project.name}</dd></div>
              <div><dt className="text-muted-foreground">Project ID</dt><dd className="mt-1 break-all font-mono text-xs">{project.id}</dd></div>
              <div><dt className="text-muted-foreground">Recorded initialization</dt><dd className="mt-1">{recordedStatus}</dd></div>
            </dl>
            <p className="text-sm leading-6 text-muted-foreground">Worker will create a missing Namespace and reconcile its OpenShell Gateway and runtime bridge using the deployed configuration. Existing resources are updated in place; Pods may roll out if their configuration changes.</p>
            <p className="text-sm leading-6 text-muted-foreground">This action does not delete the Namespace or reset Project data. Data already removed outside Relay is not restored.</p>
            {submitted ? <div role="status" className="rounded-md border bg-muted/30 p-4 text-sm">
              <p className="font-medium">{finished ? "Initialization completed" : status === "failed" ? "Initialization failed" : "Initialization queued"}</p>
              <p className="mt-1 text-muted-foreground">{finished ? "Worker has finished. Review the latest Namespace check on this page." : status === "failed" ? runtime.data?.lastError ?? "Review the error, then try again." : "Worker progress is shown here automatically. You can close this panel while it runs."}</p>
            </div> : null}
            {initialize.error ? <p role="alert" className="break-words text-sm text-destructive">{initialize.error.message}</p> : null}
          </div>
          <SheetFooter className="flex-row border-t p-5">
            <Button variant="outline" disabled={initialize.isPending} onClick={() => setOpen(false)}>{submitted ? "Close" : "Cancel"}</Button>
            {(!submitted || status === "failed") ? <Button variant="edit" disabled={initialize.isPending || !canInitialize || status === "deleting"} onClick={() => initialize.mutate()}>
              {initialize.isPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
              {initialize.isPending ? "Queueing…" : "Reinitialize Project"}
            </Button> : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
