import type {
  Instance as Agent,
  InstanceLifecycleOperation,
} from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import confetti from "canvas-confetti";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, ExternalLink, RotateCw, TerminalSquare } from "lucide-react";
import { useEffect } from "react";
import { ProvisioningLog } from "@/components/agents/provisioning-log";
import { resolveProvisioningState } from "@/components/agents/provisioning-state";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import { cn } from "@/lib/utils";
import { useCurrentProjectId } from "@/hooks/use-project";

const creationSteps = [
  { label: "Initializing", threshold: 8 },
  { label: "Provisioning runtime", threshold: 38 },
  { label: "Deploying Agent", threshold: 78 },
  { label: "Finalizing", threshold: 100 },
] as const;

export function AgentCreationExperience({
  agent,
  operation,
}: {
  agent: Agent;
  operation?: InstanceLifecycleOperation;
}) {
  const projectId = useCurrentProjectId();
  const fallbackState = resolveProvisioningState({
    status: agent.status,
    ...(agent.provisioningStage ? { stage: agent.provisioningStage } : {}),
  });
  const progress = operation?.progress ?? fallbackState.progress;
  const lifecycleStatus = operation?.status;
  const logs = operation?.events.map((event) => event.message) ?? agent.logs;

  if (lifecycleStatus === "succeeded" || agent.status === "READY") {
    return <ReadyState agent={agent} logs={logs} />;
  }
  if (lifecycleStatus === "failed" || agent.status === "FAILED") {
    return (
      <FailedState
        agent={agent}
        {...(operation?.errorSummary ? { error: operation.errorSummary } : {})}
        logs={logs}
      />
    );
  }

  return (
    <main aria-live="polite" className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-5xl flex-col items-center justify-center px-4 py-12 text-center">
      <div className="relative grid size-20 place-items-center rounded-full bg-primary/5">
        <Spinner className="size-12 text-primary" />
        <span className="absolute grid size-9 place-items-center rounded-full bg-background text-xs font-semibold tabular-nums shadow-sm">{progress}%</span>
      </div>
      <h1 className="mt-6 font-display text-3xl font-light tracking-[0.005em]">Creating your Supervisor…</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">We received the request for <strong className="font-medium text-foreground">{agent.name}</strong>. This page updates automatically while its Supervisor runtime and permissions are prepared.</p>

      <div className="mt-10 w-full rounded-lg border bg-card px-5 py-6 text-left sm:px-8">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium">{operation?.currentMessage ?? fallbackState.definition.description}</span>
          <span className="tabular-nums text-muted-foreground">{progress}%</span>
        </div>
        <Progress value={progress} aria-label="Supervisor creation progress" aria-valuetext={`${progress}% complete`} className="mt-3 h-2" />
        <ol className="mt-7 grid gap-4 sm:grid-cols-4">
          {creationSteps.map((step, index) => {
            const complete = progress >= step.threshold;
            const previousThreshold = creationSteps[index - 1]?.threshold ?? 0;
            const active = !complete && progress >= previousThreshold;
            return (
              <li key={step.label} className="flex items-center gap-2.5 text-xs sm:block">
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border", complete && "border-primary bg-primary text-primary-foreground", active && "border-primary text-primary")}>
                  {complete ? <Check className="size-3.5" /> : active ? <Spinner className="size-3.5" /> : <Circle className="size-2 fill-current text-muted-foreground/30" />}
                </span>
                <span className={cn("sm:mt-2 sm:block", (complete || active) ? "font-medium text-foreground" : "text-muted-foreground")}>{step.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <CreationDetails logs={logs} state="live" />
      <Button asChild variant="ghost" className="mt-3"><Link to="/$projectId/instances" params={{ projectId }}>Continue in background</Link></Button>
    </main>
  );
}

function ReadyState({ agent, logs }: { agent: Agent; logs: string[] }) {
  const projectId = useCurrentProjectId();
  const platform = getAgentPlatformPresentation(agent.agentPlatform);
  const endpointReady = agent.httpEndpoint?.status === "READY" && Boolean(agent.httpEndpoint.url);

  useEffect(() => {
    const celebrationKey = `tali:agent-ready:${agent.id}`;

    try {
      if (window.sessionStorage.getItem(celebrationKey)) return;
      window.sessionStorage.setItem(celebrationKey, "true");
    } catch {
      // Confetti is decorative; storage restrictions should never block the ready state.
    }

    void confetti({
      particleCount: 110,
      spread: 76,
      startVelocity: 42,
      origin: { y: 0.34 },
      colors: ["#4338ca", "#6366f1", "#10b981", "#f59e0b", "#ec4899"],
      disableForReducedMotion: true,
      zIndex: 60,
    });
  }, [agent.id]);

  return (
    <main aria-live="polite" className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center">
      <div className="relative grid size-28 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="size-16" strokeWidth={1.6} />
      </div>
      <h1 className="mt-7 font-display text-3xl font-light tracking-[0.005em]">Your Supervisor is ready</h1>
      <p className="mt-2 text-sm text-muted-foreground"><strong className="font-medium text-foreground">{agent.name}</strong> is deployed and ready to use.</p>
      <div className="mt-8 flex w-full max-w-xl flex-col justify-center gap-3 sm:flex-row">
        <Button asChild size="lg" className="min-w-48"><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: agent.id }}>Open Supervisor <ArrowRight /></Link></Button>
        {endpointReady && agent.httpEndpoint?.url ? (
          <Button asChild size="lg" variant="outline" className="min-w-48"><a href={agent.httpEndpoint.url} target="_blank" rel="noreferrer">Open Web <ExternalLink /></a></Button>
        ) : (
          <Button asChild size="lg" variant="outline" className="min-w-48"><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: agent.id }}><TerminalSquare /> Open {platform.name}</Link></Button>
        )}
      </div>
      <CreationDetails logs={logs} state="complete" />
    </main>
  );
}

function FailedState({
  agent,
  error,
  logs,
}: {
  agent: Agent;
  error?: string;
  logs: string[];
}) {
  const projectId = useCurrentProjectId();
  return (
    <main aria-live="assertive" className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center">
      <span className="grid size-24 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-12" /></span>
      <h1 className="mt-7 font-display text-3xl font-light tracking-[0.005em]">We couldn’t create this Supervisor</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{error ?? agent.error ?? "Provisioning stopped before the runtime became available."}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button asChild><Link to="/$projectId/instances" params={{ projectId }} search={{ create: "instance" }}><RotateCw /> Try again</Link></Button>
        <Button asChild variant="outline"><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: agent.id }}>Open Supervisor details</Link></Button>
      </div>
      <CreationDetails logs={logs} state="failed" defaultOpen />
    </main>
  );
}

function CreationDetails({ defaultOpen = false, logs, state }: { defaultOpen?: boolean; logs: string[]; state: "complete" | "failed" | "live" }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="mt-5 w-full text-left">
      <div className="flex justify-center">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm">View creation details <ChevronDown /></Button></CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-3">
        <ProvisioningLog lines={logs} state={state} />
      </CollapsibleContent>
    </Collapsible>
  );
}
