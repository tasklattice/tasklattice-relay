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
  const ready = Boolean(name.trim() && purpose.trim().length >= 20);

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
      description="Define the product promise and choose its execution model. The definition remains editable until you Publish a Version."
      width="lg"
      footer={(
        <>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-muted-foreground">
              Saves an editable Agent definition. No Version or Instance is created.
            </span>
            <Button
              type="submit"
              form={formId}
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
        className="mx-auto max-w-2xl space-y-7"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="space-y-5">
          <legend className="sr-only">Agent definition</legend>
          <div className="space-y-2">
            <Label htmlFor="new-agent-name">Agent name</Label>
            <Input
              id="new-agent-name"
              autoFocus
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

          <div className="space-y-2">
            <Label htmlFor="new-agent-purpose">What should it accomplish?</Label>
            <Textarea
              id="new-agent-purpose"
              disabled={pending}
              maxLength={12_000}
              value={purpose}
              className="min-h-36 resize-y text-base leading-7"
              placeholder="Help engineering leads evaluate release risk from approved test results and deployment evidence. It should explain uncertainty and never invent missing signals."
              onChange={(event) => {
                setPurpose(event.target.value);
                if (create.isError) create.reset();
              }}
            />
            <div className="flex items-start justify-between gap-4 text-xs text-muted-foreground">
              <span id="agent-create-readiness">
                {purpose.trim().length < 20
                  ? "Describe the outcome and boundaries in at least 20 characters."
                  : "The Project model may enrich this into an editable starting definition."}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {purpose.length}/12000
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <div>
            <legend className="text-base font-semibold">Choose the execution model</legend>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This determines how the Agent makes decisions and which editor opens next.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <BuildMethodChoice
              active={executionMode === "AGENTIC"}
              description="The model interprets each request, chooses tools, and adapts its steps within your Guardrails."
              detail="Develop with instructions, model routing, tools, and knowledge."
              icon={Bot}
              name="agent-build-method"
              onChange={() => setExecutionMode("AGENTIC")}
              title="Adaptive Agent"
              value="AGENTIC"
            />
            <BuildMethodChoice
              active={executionMode === "WORKFLOW"}
              description="Requests follow explicit LangGraph nodes, conditions, approvals, and failure paths you design."
              detail="Develop with the Workflow editor and node inspector."
              icon={Workflow}
              name="agent-build-method"
              onChange={() => setExecutionMode("WORKFLOW")}
              title="Workflow Agent"
              value="WORKFLOW"
            />
          </div>
          <div className="border-l-2 border-border pl-4 text-xs leading-5 text-muted-foreground">
            <strong className="text-foreground">Chat and Voice are not separate Agent types in Relay.</strong>{" "}
            API, Webhook, Embed, A2A, Chat, and Voice are delivery channels configured when a published Version becomes an Instance. Availability depends on the runtime release surface.
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
                Your name, description, and build method are preserved.
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
  return (
    <label className={cn(
      "group relative min-h-44 cursor-pointer border p-4 transition-colors",
      "hover:border-foreground/20 hover:bg-muted/25",
      "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/25",
      "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55",
      active && "border-primary bg-primary/5 hover:border-primary hover:bg-primary/5",
    )}>
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={active}
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
      <span className="mt-2 block text-sm leading-6 text-muted-foreground">
        {description}
      </span>
      <span className="mt-3 block border-t pt-3 text-xs leading-5 text-muted-foreground">
        {detail}
      </span>
    </label>
  );
}
