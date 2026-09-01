import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  complianceDomainCatalog,
  type ModelDeployment,
  type ModelRoutingPolicy,
} from "@tali/contracts";
import {
  Activity,
  Check,
  CircleAlert,
  Info,
  KeyRound,
  Plus,
  Route,
  ShieldCheck,
  Tag,
  Trash2,
} from "lucide-react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInferenceManagement } from "./inference-management-context";
import { createUuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

type RoutingMode = "single" | "complexity" | "semantic";

const routingModeDescriptions: Record<RoutingMode, string> = {
  single: "Send every request to one primary model.",
  complexity:
    "Use an efficient model for ordinary requests and a stronger model for difficult requests.",
  semantic:
    "Match requests to representative examples and route them to intent-specific models.",
};

interface SemanticRouteDraft {
  id: string;
  intent: string;
  description: string;
  modelDeploymentId: string;
  utterances: string;
}

const newSemanticRoute = (index: number): SemanticRouteDraft => ({
  id: createUuid(),
  intent: index === 0 ? "coding" : "",
  description:
    index === 0 ? "Programming, debugging, and software design requests." : "",
  modelDeploymentId: "",
  utterances:
    index === 0
      ? "Help me debug this TypeScript function\nDesign an API for this service"
      : "",
});

export function CreateModelRoutingSheet({
  availableModels,
  defaultIsDefault,
  modelsError,
  modelsLoading,
  onOpenChange,
  onRegisterModels,
  open,
}: {
  availableModels: ModelDeployment[];
  defaultIsDefault: boolean;
  modelsError?: string;
  modelsLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onRegisterModels: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const { client, key, scopeLabel } = useInferenceManagement();
  const gateways = useQuery({
    queryKey: key("inference-gateways"),
    queryFn: client.listInferenceGateways,
    enabled: open,
  });
  const [name, setName] = useState("");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("single");
  const [primaryModelId, setPrimaryModelId] = useState("");
  const [complexModelId, setComplexModelId] = useState("");
  const [embeddingModelId, setEmbeddingModelId] = useState("");
  const [fallbackModelId, setFallbackModelId] = useState("none");
  const [retries, setRetries] = useState("2");
  const [semanticRoutes, setSemanticRoutes] = useState<SemanticRouteDraft[]>([
    newSemanticRoute(0),
  ]);
  const [makeDefault, setMakeDefault] = useState(defaultIsDefault);
  const [attempted, setAttempted] = useState(false);
  const gateway = gateways.data?.[0];
  const chatModels = useMemo(
    () =>
      availableModels.filter(
        (model) => model.status === "VALIDATED" && model.modelType === "llm",
      ),
    [availableModels],
  );
  const embeddingModels = useMemo(
    () =>
      availableModels.filter(
        (model) =>
          model.status === "VALIDATED"
          && model.modelType === "text-embedding",
      ),
    [availableModels],
  );
  const primaryModel = chatModels.find(
    (model) => model.id === primaryModelId,
  );
  const sameBoundaryChatModels = chatModels.filter(
    (model) => model.complianceDomain === primaryModel?.complianceDomain,
  );
  const sameBoundaryEmbeddingModels = embeddingModels.filter(
    (model) => model.complianceDomain === primaryModel?.complianceDomain,
  );
  const complexModel = sameBoundaryChatModels.find(
    (model) => model.id === complexModelId,
  );
  const embeddingModel = sameBoundaryEmbeddingModels.find(
    (model) => model.id === embeddingModelId,
  );
  const fallbackModel = sameBoundaryChatModels.find(
    (model) => model.id === fallbackModelId,
  );
  const parsedSemanticRoutes = semanticRoutes.map((route) => ({
    intent: route.intent.trim(),
    description: route.description.trim(),
    modelDeploymentId: route.modelDeploymentId,
    utterances: route.utterances
      .split("\n")
      .map((utterance) => utterance.trim())
      .filter(Boolean),
    scoreThreshold: 0.5,
  }));
  const semanticRoutesValid =
    parsedSemanticRoutes.length > 0
    && parsedSemanticRoutes.every(
      (route) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.intent)
        && route.description.length >= 3
        && route.modelDeploymentId !== primaryModel?.id
        && sameBoundaryChatModels.some(
          (model) => model.id === route.modelDeploymentId,
        )
        && route.utterances.length >= 2,
    )
    && new Set(parsedSemanticRoutes.map((route) => route.intent)).size
      === parsedSemanticRoutes.length
    && new Set(parsedSemanticRoutes.map((route) => route.modelDeploymentId)).size
      === parsedSemanticRoutes.length;
  const fallbackIds = fallbackModel ? [fallbackModel.id] : [];
  const routingPolicy: ModelRoutingPolicy | undefined =
    routingMode === "single" && primaryModel
      ? {
          version: 1,
          mode: "SINGLE",
          modelDeploymentId: primaryModel.id,
          fallbackModelDeploymentIds: fallbackIds,
          retries: Number(retries),
        }
      : routingMode === "complexity" && primaryModel && complexModel
        ? {
            version: 1,
            mode: "COMPLEXITY",
            simpleModelDeploymentId: primaryModel.id,
            complexModelDeploymentId: complexModel.id,
            fallbackModelDeploymentIds: fallbackIds,
            retries: Number(retries),
          }
        : routingMode === "semantic"
          && primaryModel
          && embeddingModel
          && semanticRoutesValid
          ? {
              version: 1,
              mode: "SEMANTIC",
              defaultModelDeploymentId: primaryModel.id,
              embeddingModelDeploymentId: embeddingModel.id,
              routes: parsedSemanticRoutes,
              fallbackModelDeploymentIds: fallbackIds,
              retries: Number(retries),
            }
          : undefined;

  useEffect(() => {
    if (!open) return;
    setName("");
    setRoutingMode("single");
    setPrimaryModelId("");
    setComplexModelId("");
    setEmbeddingModelId("");
    setFallbackModelId("none");
    setRetries("2");
    setSemanticRoutes([newSemanticRoute(0)]);
    setMakeDefault(defaultIsDefault);
    setAttempted(false);
  }, [defaultIsDefault, open]);

  useEffect(() => {
    if (!open || primaryModelId || !chatModels.length) return;
    setPrimaryModelId(chatModels[0]!.id);
  }, [chatModels, open, primaryModelId]);

  useEffect(() => {
    if (!primaryModel) return;
    if (
      routingMode === "complexity"
      && !sameBoundaryChatModels.some(
        (model) => model.id === complexModelId,
      )
    ) {
      setComplexModelId(
        sameBoundaryChatModels.find(
          (model) => model.id !== primaryModel.id,
        )?.id ?? "",
      );
    }
    if (
      routingMode === "semantic"
      && !sameBoundaryEmbeddingModels.some(
        (model) => model.id === embeddingModelId,
      )
    ) {
      setEmbeddingModelId(sameBoundaryEmbeddingModels[0]?.id ?? "");
    }
    if (
      fallbackModelId !== "none"
      && (
        !sameBoundaryChatModels.some(
          (model) => model.id === fallbackModelId,
        )
        || fallbackModelId === primaryModel.id
        || fallbackModelId === complexModelId
        || semanticRoutes.some(
          (route) => route.modelDeploymentId === fallbackModelId,
        )
      )
    ) {
      setFallbackModelId("none");
    }
  }, [
    complexModelId,
    embeddingModelId,
    fallbackModelId,
    primaryModel,
    routingMode,
    sameBoundaryChatModels,
    sameBoundaryEmbeddingModels,
    semanticRoutes,
  ]);

  const mutation = useMutation({
    mutationFn: () =>
      client.createModelRouting({
        name,
        description: "",
        gatewayId: gateway?.id ?? "",
        routingPolicy: routingPolicy!,
        complianceDomain: primaryModel?.complianceDomain ?? "GLOBAL",
        isDefault: makeDefault,
        keyPolicy: { perInstance: true, rotationDays: 90 },
        auditPolicy: {
          controlPlane: true,
          requestLogs: true,
          capturePrompts: false,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: key("model-routings"),
      });
      onOpenChange(false);
    },
  });
  const nameValid = name.trim().length >= 2;
  const gatewayAvailable = Boolean(gateways.data?.length);
  const submit = () => {
    setAttempted(true);
    if (!nameValid || !routingPolicy || !gatewayAvailable) return;
    mutation.mutate();
  };

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      eyebrow="Routing"
      title="Create Routing"
      description="Create one stable model identity with routing, resilience, and data residency controls."
      width="lg"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            className="min-w-44"
            disabled={
              mutation.isPending
              || gateways.isPending
              || !gatewayAvailable
              || modelsLoading
            }
            onClick={submit}
          >
            {mutation.isPending ? "Synchronizing…" : "Create Routing"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <SectionTitle
            icon={Tag}
            title="Routing identity"
            description="Name the workload policy, not the underlying Provider model."
          />
          <div className="max-w-2xl">
            <Field
              label="Routing name"
              htmlFor="routing-name"
              required
              help={
                attempted && !nameValid
                  ? "Enter at least 2 characters."
                  : "Examples: General assistant, Production reasoning."
              }
              invalid={attempted && !nameValid}
            >
              <Input
                id="routing-name"
                required
                value={name}
                aria-invalid={attempted && !nameValid}
                onChange={(event) => setName(event.target.value)}
                placeholder="General assistant"
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4 border-t pt-5">
          <SectionTitle
            icon={Route}
            title="Routing"
            description="Choose how requests are routed to registered models."
          />
          <div className="max-w-sm">
            <Field
              label="Routing method"
              htmlFor="routing-routing-method"
              required
              help={routingModeDescriptions[routingMode]}
            >
              <Select
                required
                value={routingMode}
                onValueChange={(value) =>
                  setRoutingMode(value as RoutingMode)
                }
              >
                <SelectTrigger id="routing-routing-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Fixed model</SelectItem>
                  <SelectItem value="complexity">By complexity</SelectItem>
                  <SelectItem value="semantic">By intent</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid items-start gap-4 sm:grid-cols-2">
            <ModelField
              id="routing-primary-model"
              label={
                routingMode === "complexity"
                  ? "Simple requests"
                  : routingMode === "semantic"
                    ? "Default model"
                    : "Primary model"
              }
              models={chatModels}
              value={primaryModelId}
              onChange={setPrimaryModelId}
              placeholder="Choose a text generation model"
              help={
                primaryModel
                  ? `${primaryModel.providerName} · ${boundaryLabel(primaryModel)}`
                  : "Only validated text generation models are shown."
              }
              invalid={attempted && !primaryModel}
            />

            {routingMode === "complexity" ? (
              <ModelField
                id="routing-complex-model"
                label="Complex requests"
                models={sameBoundaryChatModels.filter(
                  (model) => model.id !== primaryModel?.id,
                )}
                value={complexModelId}
                onChange={setComplexModelId}
                placeholder="Choose a stronger model"
                help="COMPLEX and REASONING requests use this model."
                invalid={attempted && !complexModel}
              />
            ) : routingMode === "semantic" ? (
              <ModelField
                id="routing-embedding-model"
                label="Routing embedding model"
                models={sameBoundaryEmbeddingModels}
                value={embeddingModelId}
                onChange={setEmbeddingModelId}
                placeholder="Choose an embedding model"
                help="The last user message is embedded before matching an intent."
                invalid={attempted && !embeddingModel}
              />
            ) : null}
          </div>

          {routingMode === "complexity" ? (
            <div className="border-l-2 border-primary/40 bg-primary/[0.035] px-4 py-3 text-xs leading-5 text-muted-foreground">
              SIMPLE and MEDIUM requests use the efficient model; COMPLEX and
              REASONING requests use the stronger model.
            </div>
          ) : null}

          {routingMode === "semantic" ? (
            <SemanticRoutesEditor
              attempted={attempted}
              models={sameBoundaryChatModels.filter(
                (model) => model.id !== primaryModel?.id,
              )}
              routes={semanticRoutes}
              onChange={setSemanticRoutes}
            />
          ) : null}

          {modelsError ? (
            <p
              role="alert"
              className="border-l-2 border-destructive bg-destructive/5 p-3 text-xs text-destructive"
            >
              {modelsError}
            </p>
          ) : null}
          {!modelsLoading && !chatModels.length ? (
            <div className="flex flex-col gap-3 border-l-2 border-amber-500 bg-amber-500/5 p-3 text-xs leading-5 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
                Register and validate a text generation model before creating
                routing.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRegisterModels}
              >
                Register models
              </Button>
            </div>
          ) : null}
          {!gateways.isPending && !gatewayAvailable ? (
            <p
              role="alert"
              className="flex gap-2 border-l-2 border-destructive bg-destructive/5 p-3 text-xs text-destructive"
            >
              <CircleAlert className="size-4 shrink-0" />
              No model gateway is available for this {scopeLabel}.
            </p>
          ) : null}
        </section>

        <section className="space-y-4 border-t pt-5">
          <SectionTitle
            icon={ShieldCheck}
            title="Resilience & boundary"
            description="Keep retries and failover inside the same declared data boundary."
          />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <ModelField
              id="routing-fallback-model"
              label="Fallback model"
              models={sameBoundaryChatModels.filter(
                (model) =>
                  model.id !== primaryModel?.id
                  && model.id !== complexModel?.id
                  && !semanticRoutes.some(
                    (route) => route.modelDeploymentId === model.id,
                  ),
              )}
              value={fallbackModelId}
              onChange={setFallbackModelId}
              placeholder="No fallback"
              allowNone
              help="Used after the selected model exhausts retries."
            />
            <Field
              label="Retries"
              htmlFor="routing-retries"
              required
              help="Attempts on the selected model before fallback is used."
            >
              <Select value={retries} onValueChange={setRetries} required>
                <SelectTrigger id="routing-retries">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <PolicyFact
              icon={ShieldCheck}
              label="Data boundary"
              value={
                primaryModel
                  ? boundaryLabel(primaryModel)
                  : "Choose a model"
              }
            />
            <PolicyFact
              icon={KeyRound}
              label="Credentials"
              value="Isolated per Instance"
            />
            <PolicyFact
              icon={Activity}
              label="Audit"
              value="Control plane + requests"
            />
          </div>
          <button
            type="button"
            aria-pressed={makeDefault}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 border px-3 text-left text-sm transition-colors",
              makeDefault && "border-primary bg-primary/5",
            )}
            onClick={() => setMakeDefault((value) => !value)}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center border",
                makeDefault
                  && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {makeDefault ? <Check className="size-3.5" /> : null}
            </span>
            <span>
              <strong className="block font-medium">{scopeLabel} default</strong>
              <span className="text-xs text-muted-foreground">
                Automatically selected for new Instances in this {scopeLabel}.
              </span>
            </span>
          </button>
        </section>

        {attempted && !routingPolicy ? (
          <p role="alert" className="flex gap-2 text-xs text-destructive">
            <CircleAlert className="size-4 shrink-0" />
            Complete the selected routing strategy before creating this
            routing.
          </p>
        ) : null}
        {mutation.error ? (
          <p role="alert" className="flex gap-2 text-xs text-destructive">
            <CircleAlert className="size-4 shrink-0" />
            {mutation.error.message}
          </p>
        ) : null}
      </div>
    </EntitySheet>
  );
}

function SemanticRoutesEditor({
  attempted,
  models,
  onChange,
  routes,
}: {
  attempted: boolean;
  models: ModelDeployment[];
  onChange: (routes: SemanticRouteDraft[]) => void;
  routes: SemanticRouteDraft[];
}) {
  const update = (id: string, values: Partial<SemanticRouteDraft>) =>
    onChange(
      routes.map((route) => route.id === id ? { ...route, ...values } : route),
    );
  return (
    <div className="space-y-3 border bg-muted/[0.08] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Intent routes</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Add at least two representative user messages per intent. Requests
            route to the closest semantic match and otherwise use the default
            model. Each intent targets one distinct non-default model.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            Examples are routing references, not prompt templates. Avoid
            secrets and personal data.
          </TooltipContent>
        </Tooltip>
      </div>
      {routes.map((route, index) => {
        const utteranceCount = route.utterances
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean).length;
        const valid =
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.intent)
          && route.description.trim().length >= 3
          && Boolean(route.modelDeploymentId)
          && routes.filter(
            (candidate) =>
              candidate.modelDeploymentId === route.modelDeploymentId,
          ).length === 1
          && utteranceCount >= 2;
        return (
          <div key={route.id} className="space-y-3 border bg-background p-3">
            <div className="flex items-center justify-between">
              <strong className="text-xs">Intent {index + 1}</strong>
              {routes.length > 1 ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove intent ${index + 1}`}
                  onClick={() =>
                    onChange(routes.filter((item) => item.id !== route.id))
                  }
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`semantic-intent-${route.id}`} required>Intent key</Label>
                <Input
                  id={`semantic-intent-${route.id}`}
                  required
                  value={route.intent}
                  aria-invalid={attempted && !valid}
                  placeholder="coding"
                  onChange={(event) =>
                    update(route.id, { intent: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`semantic-model-${route.id}`} required>
                  Target model
                </Label>
                <Select
                  required
                  value={route.modelDeploymentId}
                  onValueChange={(value) =>
                    update(route.id, { modelDeploymentId: value })
                  }
                >
                  <SelectTrigger id={`semantic-model-${route.id}`}>
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.displayName} · {model.providerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`semantic-description-${route.id}`} required>
                Description
              </Label>
              <Input
                id={`semantic-description-${route.id}`}
                required
                value={route.description}
                placeholder="Programming and debugging requests"
                onChange={(event) =>
                  update(route.id, { description: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`semantic-examples-${route.id}`} required>
                Example user messages
              </Label>
              <Textarea
                id={`semantic-examples-${route.id}`}
                className="min-h-24 font-mono text-xs"
                required
                value={route.utterances}
                placeholder={"Help me debug this function\nDesign a REST API"}
                onChange={(event) =>
                  update(route.id, { utterances: event.target.value })
                }
              />
              <p
                className={cn(
                  "text-xs",
                  attempted && utteranceCount < 2
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                One example per line · {utteranceCount} added
              </p>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          onChange([...routes, newSemanticRoute(routes.length)])
        }
      >
        <Plus />
        Add intent
      </Button>
    </div>
  );
}

function ModelField({
  allowNone = false,
  help,
  id,
  invalid = false,
  label,
  models,
  onChange,
  placeholder,
  value,
}: {
  allowNone?: boolean;
  help: string;
  id: string;
  invalid?: boolean;
  label: string;
  models: ModelDeployment[];
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Field label={label} htmlFor={id} help={help} invalid={invalid} required={!allowNone}>
      <Select value={value} onValueChange={onChange} required={!allowNone}>
        <SelectTrigger id={id} aria-invalid={invalid}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowNone ? <SelectItem value="none">No fallback</SelectItem> : null}
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.displayName} · {model.providerName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function SectionTitle({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof ShieldCheck;
  title: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Field({
  children,
  help,
  htmlFor,
  invalid,
  label,
  required = false,
}: {
  children: ReactNode;
  help: string;
  htmlFor?: string;
  invalid?: boolean;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} required={required}>{label}</Label>
      {children}
      <p
        className={cn(
          "min-h-5 text-xs leading-5",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {help}
      </p>
    </div>
  );
}

function PolicyFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-20 gap-3 border p-3">
      <Icon className="size-4 shrink-0 text-primary" />
      <span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong className="mt-1 block text-xs font-medium">{value}</strong>
      </span>
    </div>
  );
}

function boundaryLabel(model: ModelDeployment): string {
  return complianceDomainCatalog.find(
    (domain) => domain.id === model.complianceDomain,
  )?.label ?? model.complianceDomain;
}
