import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  ExpertAgentContractDraft,
  ExpertAgentExecutionMode,
} from "@tali/contracts";
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Workflow,
} from "lucide-react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  createInitialAgentDefinition,
  isInitialAgentDefinitionReady,
  slugifyExpertAgentName,
} from "./create-agent-definition";

const formId = "create-expert-agent-form";

type DefinitionPhase = "DRAFTING" | "SAVING" | null;

interface CreateAgentInput {
  executionMode: ExpertAgentExecutionMode;
  name: string;
  purpose: string;
}

export function CreateExpertAgentSheet({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (agentId: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [executionMode, setExecutionMode] =
    useState<ExpertAgentExecutionMode>("AGENTIC");
  const [phase, setPhase] = useState<DefinitionPhase>(null);

  const resetForm = () => {
    setName("");
    setPurpose("");
    setExecutionMode("AGENTIC");
    setPhase(null);
  };

  const create = useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      let draft: ExpertAgentContractDraft | undefined;
      setPhase("DRAFTING");
      try {
        const result = await api.draftExpertAgentContract(input.purpose);
        if (result.status === "GENERATED") draft = result.draft;
      } catch {
        // Contract generation is an optional accelerator. Agent creation has a
        // deterministic scaffold and must remain available without a model.
      }

      setPhase("SAVING");
      return api.createExpertAgent({
        slug: slugifyExpertAgentName(input.name),
        executionMode: input.executionMode,
        definition: createInitialAgentDefinition({
          executionMode: input.executionMode,
          name: input.name,
          purpose: input.purpose,
          ...(draft ? { draft } : {}),
        }),
      });
    },
    onSuccess: async (result) => {
      await onCreated(result.id);
      resetForm();
    },
    onSettled: () => setPhase(null),
  });

  useEffect(() => {
    if (!open) {
      resetForm();
      create.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = create.isPending;
  const ready = isInitialAgentDefinitionReady({ name, purpose });

  const close = () => {
    if (pending) return;
    resetForm();
    create.reset();
    onOpenChange(false);
  };

  const submit = () => {
    if (!ready || pending) return;
    create.mutate({
      executionMode,
      name: name.trim(),
      purpose: purpose.trim(),
    });
  };

  const progressLabel = phase === "DRAFTING"
    ? "Preparing the starting definition…"
    : phase === "SAVING"
      ? "Saving Agent definition…"
      : "Start developing";

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => next ? onOpenChange(true) : close()}
      title="Define Agent"
      description="Describe what this Agent should accomplish and choose how it should work."
      width="lg"
      footer={(
        <>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <div className="flex w-full min-w-0 flex-1 items-center justify-end gap-4 sm:w-auto">
            <span className="hidden text-xs text-muted-foreground md:inline">
              You can change these settings later.
            </span>
            <Button
              type="submit"
              form={formId}
              className="w-full sm:w-auto"
              disabled={!ready || pending}
              aria-describedby="agent-create-readiness"
            >
              {pending ? <Spinner /> : <ArrowRight />}
              {progressLabel}
            </Button>
          </div>
        </>
      )}
    >
      <form
        id={formId}
        className="mx-auto max-w-2xl space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="space-y-5">
          <legend className="sr-only">Agent definition</legend>
          <div className="space-y-2.5">
            <Label htmlFor="new-agent-purpose" className="text-base font-semibold">
              What should this Agent do?
            </Label>
            <Textarea
              id="new-agent-purpose"
              autoFocus
              required
              minLength={20}
              disabled={pending}
              maxLength={12_000}
              value={purpose}
              aria-describedby="agent-create-readiness"
              aria-invalid={purpose.trim().length > 0 && purpose.trim().length < 20}
              className="min-h-36 resize-y text-base leading-7"
              placeholder="Help engineering leads evaluate release risk from approved test results and deployment evidence. Explain uncertainty and never invent missing signals."
              onChange={(event) => {
                setPurpose(event.target.value);
                if (create.isError) create.reset();
              }}
            />
            <p id="agent-create-readiness" className="text-xs leading-5 text-muted-foreground">
              {purpose.trim().length > 0 && purpose.trim().length < 20
                ? "Add a little more detail so the Agent has a clear direction."
                : "Describe the desired outcome and important boundaries."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-agent-name">Agent name</Label>
            <Input
              id="new-agent-name"
              required
              disabled={pending}
              maxLength={120}
              value={name}
              placeholder="Release risk analyst"
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                if (create.isError) create.reset();
              }}
            />
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="text-base font-semibold">How should it work?</legend>
          <p className="-mt-3 text-sm leading-6 text-muted-foreground">
            Choose how much freedom the Agent has when deciding what to do next.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <BuildMethodChoice
              active={executionMode === "AGENTIC"}
              description="Decides how to complete each request dynamically using available knowledge, tools, and actions."
              detail="Best for assistants, research, analysis, support, and open-ended tasks."
              icon={Bot}
              name="agent-build-method"
              onChange={() => setExecutionMode("AGENTIC")}
              title="Adaptive"
              value="AGENTIC"
            />
            <BuildMethodChoice
              active={executionMode === "WORKFLOW"}
              description="Follows explicit steps, conditions, approvals, and failure paths that you define."
              detail="Best for repeatable processes that require predictable execution and tighter control."
              icon={Workflow}
              name="agent-build-method"
              onChange={() => setExecutionMode("WORKFLOW")}
              title="Structured Workflow"
              value="WORKFLOW"
            />
          </div>
        </fieldset>

        {create.isError ? (
          <div role="alert" className="flex gap-3 border border-destructive/25 bg-destructive/5 p-4">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Agent could not be created
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {create.error instanceof Error
                  ? create.error.message
                  : "Review the definition and try again."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your intent, name, and execution method are preserved.
              </p>
            </div>
          </div>
        ) : null}

        {pending ? (
          <p role="status" aria-live="polite" className="sr-only">
            {progressLabel}
          </p>
        ) : null}
      </form>
    </EntitySheet>
  );
}

function BuildMethodChoice({
  active,
  description,
  detail,
  icon: Icon,
  name,
  onChange,
  title,
  value,
}: {
  active: boolean;
  description: string;
  detail: string;
  icon: typeof Bot;
  name: string;
  onChange: () => void;
  title: string;
  value: ExpertAgentExecutionMode;
}) {
  const choiceId = `agent-build-method-${value.toLowerCase()}`;
  const descriptionId = `${choiceId}-description`;
  const detailId = `${choiceId}-detail`;

  return (
    <label className={cn(
      "group relative h-full min-h-52 cursor-pointer rounded-md border border-border/80 bg-card/50 p-4 transition-colors",
      "hover:border-primary/35 hover:bg-primary-surface/35",
      "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/25",
      "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55",
      active && "border-primary bg-primary-surface/70 hover:border-primary hover:bg-primary-surface/70",
    )}>
      <input
        id={choiceId}
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={active}
        aria-describedby={`${descriptionId} ${detailId}`}
        onChange={onChange}
      />
      <span className="flex items-start justify-between gap-4">
        <span className={cn(
          "grid size-10 place-items-center border bg-background text-muted-foreground",
          active && "border-primary text-primary",
        )}>
          <Icon className="size-4" />
        </span>
        <span className={cn(
          "grid size-5 place-items-center rounded-full border text-transparent",
          active && "border-primary bg-primary text-primary-foreground",
        )} aria-hidden>
          <Check className="size-3.5" />
        </span>
      </span>
      <strong className="mt-4 block text-base">{title}</strong>
      <span id={descriptionId} className="mt-2 block text-sm leading-6 text-foreground/80">
        {description}
      </span>
      <span id={detailId} className="mt-4 block border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
        {detail}
      </span>
    </label>
  );
}
