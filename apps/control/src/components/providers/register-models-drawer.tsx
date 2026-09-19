import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  modelCapabilities,
  modelTypes,
  providerConnectionDraftSchema,
  providerPresets,
  type ModelCapability,
  type ModelDeployment,
  type ModelType,
  type ProviderAccount,
  type ProviderConnectionDraft,
  type ProviderConnectionCreationResult,
  type ProviderDiscoveryResult,
  type ProviderKind,
  type ProviderModelSelection,
} from "@tali/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Plus,
  ServerCog,
  TriangleAlert,
  X,
} from "lucide-react";
import { canSelectModel, filterModels, registeredModelIds } from "./model-selection";
import { ProviderPicker } from "./provider-picker";
import {
  createProviderDraft,
  providerUiRegistry,
} from "./provider-ui-registry";
import type { ProviderConfigurator } from "./configurators/types";
import {
  CreationFlow,
  type CreationStep,
} from "@/components/shared/creation-flow";
import { StatusBadge } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useInferenceManagement } from "./inference-management-context";
import { cn } from "@/lib/utils";

const modelTypeLabels: Record<ModelType, string> = {
  llm: "Text generation",
  "text-embedding": "Embedding",
  "speech-to-text": "Speech to text",
};

const capabilityLabels: Record<ModelCapability, string> = {
  reasoning: "Reasoning",
  vision: "Vision",
  ocr: "OCR",
  "document-understanding": "Documents",
  "tool-calling": "Tools",
  "structured-output": "Structured output",
  code: "Code",
  multilingual: "Multilingual",
};

const providerLabel = (kind: ProviderKind) =>
  providerPresets.find((provider) => provider.id === kind)?.name ?? kind;

function hasHttpsEndpoint(draft: ProviderConnectionDraft): boolean {
  const endpoint = (draft.config as Record<string, unknown>).endpoint;
  return typeof endpoint === "string" && /^https:\/\//i.test(endpoint.trim());
}

type Step = "source" | "models" | "complete";
type CredentialMode = "existing" | "new";

const registrationSteps: readonly CreationStep[] = [
  { label: "Provider", description: "Choose Provider and credentials" },
  { label: "Review models", description: "Select discovered deployments" },
  { label: "Complete", description: "Review registration results" },
];

interface RegistrationSummary {
  providerName: string;
  models: ModelDeployment[];
  failures: Array<{ model: ProviderModelSelection; message: string }>;
}

const emptyAccounts: ProviderAccount[] = [];

export function RegisterModelsDrawer({
  accounts = emptyAccounts,
  registeredModels,
  canConfigureProvider = true,
  initialAccount,
  initialMode,
  intent = "register-models",
  onOpenChange,
  open,
}: {
  accounts?: ProviderAccount[];
  registeredModels: ModelDeployment[];
  canConfigureProvider?: boolean;
  initialAccount?: ProviderAccount | undefined;
  initialMode?: CredentialMode | undefined;
  intent?: "add-provider" | "register-models";
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { client, key, scopeLabel } = useInferenceManagement();
  const queryClient = useQueryClient();
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const addingProvider = intent === "add-provider";
  const availableAccounts = useMemo(
    () => initialAccount ? [initialAccount] : accounts,
    [accounts, initialAccount],
  );
  const defaultCredentialMode = addingProvider
    ? "new"
    : initialAccount
    ? "existing"
    : initialMode ?? (availableAccounts.length ? "existing" : "new");
  const [step, setStep] = useState<Step>("source");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(
    defaultCredentialMode,
  );
  const [accountId, setAccountId] = useState(initialAccount?.id ?? accounts[0]?.id ?? "");
  const [draft, setDraft] = useState<ProviderConnectionDraft>(
    () => createProviderDraft("openai"),
  );
  const [providerSelected, setProviderSelected] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discovery, setDiscovery] = useState<ProviderDiscoveryResult>();
  const [models, setModels] = useState<ProviderModelSelection[]>([]);
  const [manualModelId, setManualModelId] = useState("");
  const [manualModelType, setManualModelType] = useState<ModelType>("llm");
  const [summary, setSummary] = useState<RegistrationSummary>();

  const wasOpen = useRef(false);
  const existingIds = registeredModelIds(registeredModels, credentialMode === "existing" ? accountId : undefined);
  const activeAccount = availableAccounts.find(
    (account) => account.id === accountId,
  );
  const discover = useMutation({
    mutationFn: () =>
      credentialMode === "existing"
        ? client.discoverProviderAccountModels(accountId)
        : client.discoverProviderModels(draft),
    onSuccess: (result) => {
      setDiscovery(result);
      setModels([]);
      setStep("models");
    },
  });
  const register = useMutation({
    mutationFn: async (): Promise<RegistrationSummary> => {
      if (!models.length || models.length > 100) throw new Error("Select between 1 and 100 models.");
      if (models.some((model) => existingIds.has(model.modelId))) throw new Error("A selected model is already registered. Remove it from the selection before continuing.");
      if (credentialMode === "new") {
        if (!canConfigureProvider) throw new Error("You do not have permission to configure a Provider.");
        const result = await client.registerProviderAccount({
          connection: draft,
          models,
          // Preserve the legacy registration contract until Routing owns policy.
          complianceDomain: (draft.provider === "qwen" || draft.provider === "moonshot")
            && draft.config.region === "cn" ? "CN_MAINLAND" : "GLOBAL",
        });
        return {
          providerName: result.models[0]?.providerName
            ?? providerLabel(result.account.providerKind),
          models: result.models,
          failures: result.failures,
        };
      }
      if (!activeAccount) throw new Error("Choose saved Provider credentials.");
      const results = await Promise.allSettled(
        models.map((model) => client.registerModelDeployment({
          providerAccountId: activeAccount.id,
          ...model,
        })),
      );
      const registered: ModelDeployment[] = [];
      const failures: ProviderConnectionCreationResult["failures"] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.status === "VALIDATED") {
          registered.push(result.value);
        } else {
          failures.push({
            model: models[index]!,
            message: result.status === "rejected"
              ? result.reason instanceof Error ? result.reason.message : "Model registration failed."
              : result.value.validationMessage,
          });
        }
      });
      return {
        providerName: registered[0]?.providerName ?? providerLabel(activeAccount.providerKind),
        models: registered,
        failures,
      };
    },
    onSuccess: async (result) => {
      setSummary(result);
      setStep("complete");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: key("provider-accounts"),
        }),
        queryClient.invalidateQueries({
          queryKey: key("model-deployments"),
        }),
        queryClient.invalidateQueries({ queryKey: key("provider-cost") }),
      ]);
    },
  });

  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setStep("source");
    setCredentialMode(defaultCredentialMode);
    setAccountId(initialAccount?.id ?? availableAccounts[0]?.id ?? "");
    setDraft(createProviderDraft("openai"));
    setProviderSelected(false);
    setErrors({});
    setDiscovery(undefined);
    setModels([]);
    setManualModelId("");
    setManualModelType("llm");
    setSummary(undefined);
    discover.reset();
    register.reset();
  }, [availableAccounts, defaultCredentialMode, initialAccount, open]);

  useEffect(() => {
    if (
      !open
      || credentialMode !== "new"
      || providerSelected
    ) return;
    const timer = window.setTimeout(
      () => providerTriggerRef.current?.focus(),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [credentialMode, open, providerSelected]);

  const pending = discover.isPending || register.isPending;
  const sourceChanged = () => {
    setDiscovery(undefined); setModels([]); setManualModelId("");
    setErrors({}); discover.reset(); register.reset();
  };
  const selectProvider = (kind: ProviderKind) => {
    sourceChanged();
    setDraft(createProviderDraft(kind));
    setProviderSelected(true);
    setErrors({});
  };
  const validateAndDiscover = () => {
    if (credentialMode === "existing") {
      if (activeAccount) discover.mutate();
      return;
    }
    if (!providerSelected || !canConfigureProvider) return;
    const parsed = providerConnectionDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path.at(-1) ?? "form"),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setErrors({});
    discover.mutate();
  };
  const definition = providerUiRegistry[draft.provider];
  const Configurator = definition.Component as ProviderConfigurator;
  const supportedTypes = (
    providerPresets.find(
      (provider) => provider.id === discovery?.providerKind,
    )?.modelTypes ?? modelTypes
  ) as readonly ModelType[];
  const currentWizardStep = step === "source" ? 0 : step === "models" ? 1 : 2;
  const changeWizardStep = (next: number) => {
    if (pending || step === "complete") return;
    if (next === 0) setStep("source");
    if (next === 1 && discovery) setStep("models");
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      direction="right"
    >
      <DrawerContent className="!w-full sm:!w-[min(96vw,64rem)]">
        <DrawerHeader className="relative border-b pr-16">
          <DrawerTitle className="text-xl sm:text-2xl">
            {addingProvider ? "Add Provider" : "Register models"}
          </DrawerTitle>
          <DrawerDescription>
            {addingProvider
              ? `Configure a Provider and register at least one validated model for this ${scopeLabel}.`
              : `Choose a Provider, discover available models, and register the validated models this ${scopeLabel} can use.`}
          </DrawerDescription>
          <DrawerClose asChild>
            <Button
              aria-label="Close drawer"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4"
              disabled={pending}
            >
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <fieldset disabled={pending} className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-busy={pending}>
          <CreationFlow
            steps={registrationSteps}
            currentStep={currentWizardStep}
            onStepChange={changeWizardStep}
            progressLabel="Register models progress"
            orientation="sidebar"
            canNavigateBack={!pending && step !== "complete"}
          >
            {step === "source" ? (
            <div className="space-y-6">
              {!addingProvider && !initialAccount && canConfigureProvider && availableAccounts.length ? (
                <div
                  role="radiogroup"
                  aria-label="Provider credential source"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <SourceChoice
                    active={credentialMode === "existing"}
                    title="Use saved credentials"
                    description={`Discover models with Provider credentials already saved for this ${scopeLabel}.`}
                    onClick={() => { sourceChanged(); setCredentialMode("existing"); }}
                  />
                  <SourceChoice
                    active={credentialMode === "new"}
                    title="Use new credentials"
                    description="Enter Provider credentials, then discover and register models."
                    onClick={() => { sourceChanged(); setCredentialMode("new"); }}
                  />
                </div>
              ) : null}

              {credentialMode === "existing" ? (
                <div className="space-y-2">
                  <Label htmlFor="provider-credentials" required>Saved credentials</Label>
                  <Select value={accountId} onValueChange={(id) => { sourceChanged(); setAccountId(id); }} disabled={pending} required>
                    <SelectTrigger id="provider-credentials">
                      <SelectValue placeholder="Choose credentials" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {providerLabel(account.providerKind)} ·{" "}
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Credentials stay on the server and are used only for
                    discovery and LiteLLM registration.
                  </p>
                  {activeAccount?.skipTlsVerify ? (
                    <p className="flex gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      TLS certificate verification is disabled for discovery
                      and inference through this Provider.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="space-y-3 border-b pb-5">
                    <div className="flex items-start gap-2.5">
                      <ServerCog
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <div>
                        <h3 className="flex items-center gap-1 text-sm font-semibold">Provider <RequiredMark /></h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Choose your Provider, then enter credentials to discover models.
                        </p>
                      </div>
                    </div>
                    <ProviderPicker
                      ref={providerTriggerRef}
                      disabled={pending}
                      value={providerSelected ? draft.provider : undefined}
                      onChange={selectProvider}
                    />
                  </section>

                  {providerSelected ? (
                    <section className="space-y-5">
                      <div className="flex items-start gap-2.5">
                        <KeyRound
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <div>
                          <h3 className="text-sm font-semibold">
                            Credentials & endpoint
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Credentials are stored server-side. Review the endpoint
                            and enter the credentials for your Provider.
                          </p>
                        </div>
                      </div>
                      <Configurator
                        value={draft}
                        onChange={(next) => {
                          sourceChanged();
                          setDraft(hasHttpsEndpoint(next) ? next : { ...next, skipTlsVerify: false });
                        }}
                        errors={errors}
                        disabled={pending}
                      />
                      {hasHttpsEndpoint(draft) ? (
                        <div className="space-y-3 border border-amber-500/30 bg-amber-500/5 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                              <div>
                                <Label htmlFor="provider-skip-tls-verify">
                                  Skip TLS certificate verification
                                </Label>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  Use only for a trusted endpoint with a private
                                  or self-signed certificate.
                                </p>
                              </div>
                            </div>
                            <Switch
                              id="provider-skip-tls-verify"
                              aria-label="Skip TLS certificate verification"
                              checked={draft.skipTlsVerify === true}
                              disabled={pending}
                              onCheckedChange={(skipTlsVerify) => { sourceChanged(); setDraft({ ...draft, skipTlsVerify }); }}
                            />
                          </div>
                          {draft.skipTlsVerify ? (
                            <p className="border-l-2 border-amber-500 pl-3 text-xs leading-5 text-amber-800 dark:text-amber-300">
                              Certificate-chain and hostname verification will
                              be disabled for model discovery and all inference
                              requests using this Provider.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {errors.form ? (
                        <p
                          role="alert"
                          className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
                        >
                          {errors.form}
                        </p>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              )}
              {discover.error ? (
                <p
                  role="alert"
                  className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {discover.error.message}
                </p>
              ) : null}
            </div>
          ) : step === "models" && discovery ? (
            <ModelDiscoveryStep
              discovery={discovery}
              existingIds={existingIds}
              pending={pending}
              manualModelId={manualModelId}
              manualModelType={manualModelType}
              models={models}
              setManualModelId={setManualModelId}
              setManualModelType={setManualModelType}
              setModels={setModels}
              supportedTypes={supportedTypes}
            />
          ) : step === "complete" && summary ? (
            <SummaryStep intent={intent} summary={summary} />
          ) : null}
            {register.error ? (
              <RegistrationError error={register.error} />
            ) : register.isPending ? (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
              >
                <Spinner className="mt-0.5" />
                Registering models and waiting for LiteLLM workers to synchronize.
                This can take up to 40 seconds.
              </div>
            ) : null}
          </CreationFlow>
        </fieldset>

        <DrawerFooter>
          {step === "source" ? (
            <div className="flex items-center justify-between">
              <DrawerClose asChild>
                <Button variant="outline" disabled={pending}>
                  Cancel
                </Button>
              </DrawerClose>
              <Button
                onClick={validateAndDiscover}
                disabled={
                  pending
                  || (credentialMode === "existing"
                    ? !activeAccount
                    : !providerSelected)
                }
              >
                {discover.isPending ? <Spinner /> : null}
                Discover models
                <ArrowRight />
              </Button>
            </div>
          ) : step === "models" ? (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => setStep("source")}
                disabled={pending}
              >
                <ArrowLeft />
                Back
              </Button>
              <Button
                variant="create"
                disabled={!models.length || models.length > 100 || pending || models.some((model) => existingIds.has(model.modelId))}
                onClick={() => register.mutate()}
              >
                {register.isPending ? <Spinner /> : null}
                {register.isPending
                  ? "Registering…"
                  : `Register ${models.length || ""} model${models.length === 1 ? "" : "s"}`}
                {!register.isPending ? <ArrowRight /> : null}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <DrawerClose asChild>
                <Button>Done</Button>
              </DrawerClose>
            </div>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function RegistrationError({ error }: { error: Error }) {
  const [copyState, setCopyState] =
    useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    setCopyState("idle");
  }, [error]);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(error.message);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1_600);
  };

  return (
    <div
      role="alert"
      data-vaul-no-drag
      className="mt-4 border-l-2 border-destructive bg-destructive/5 p-3 text-destructive"
      style={{ userSelect: "text" }}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Model registration failed</p>
          <p className="mt-1 text-xs leading-5">
            LiteLLM could not validate one or more models. Review the details
            below, then retry.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 bg-background text-foreground"
          onClick={() => void copyDetails()}
        >
          {copyState === "copied" ? <Check /> : <Copy />}
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy details"}
        </Button>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-destructive/20 pt-3 font-mono text-[11px] leading-5">
        {error.message}
      </pre>
    </div>
  );
}

function SourceChoice({
  active,
  description,
  onClick,
  title,
}: {
  active: boolean;
  description: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={cn(
        "min-h-24 border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
      )}
      onClick={onClick}
    >
      <strong className="text-sm">{title}</strong>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

export function ModelDiscoveryStep({
  discovery,
  existingIds,
  pending,
  manualModelId,
  manualModelType,
  models,
  setManualModelId,
  setManualModelType,
  setModels,
  supportedTypes,
}: {
  discovery: ProviderDiscoveryResult;
  existingIds: ReadonlySet<string>;
  pending: boolean;
  manualModelId: string;
  manualModelType: ModelType;
  models: ProviderModelSelection[];
  setManualModelId: (value: string) => void;
  setManualModelType: (value: ModelType) => void;
  setModels: (models: ProviderModelSelection[]) => void;
  supportedTypes: readonly ModelType[];
}) {
  const [search, setSearch] = useState("");
  const [selectedSearch, setSelectedSearch] = useState("");
  const selected = new Set(models.map((model) => model.modelId));
  const filteredCatalog = filterModels(discovery.models, search);
  const filteredSelected = filterModels(models, selectedSearch);
  const update = (next: ProviderModelSelection) =>
    setModels(
      models.map((model) => model.modelId === next.modelId ? next : model),
    );
  const toggle = (model: ProviderModelSelection) =>
    setModels(
      selected.has(model.modelId)
        ? models.filter((item) => item.modelId !== model.modelId)
        : [...models, cloneSelection(model)],
    );
  return (
    <div className="space-y-6">
      <section aria-label="Selected models" className="space-y-3 rounded-lg border border-primary/25 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Selected models</h3>
          <span role="status" aria-live="polite" className="text-sm text-link">{models.length} selected</span>
        </div>
        <Input aria-label="Search selected models" placeholder="Search selected models by name or ID" value={selectedSearch} onChange={(event) => setSelectedSearch(event.target.value)} />
        <div className="max-h-72 divide-y overflow-y-auto">
          {filteredSelected.map((model) => <div key={model.modelId} className="py-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 size-4 shrink-0 text-link" />
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm">{model.displayName}</strong><code className="block break-all text-xs text-muted-foreground">{model.modelId}</code></span>
              {!discovery.models.some((item) => item.modelId === model.modelId) ? <Badge variant="outline">Manual</Badge> : null}
              <Button type="button" variant="ghost" size="icon" disabled={pending} aria-label={`Remove ${model.modelId} from selection`} onClick={() => toggle(model)}><X /></Button>
            </div>
            {existingIds.has(model.modelId) ? <p role="alert" className="mt-2 text-xs text-destructive">Already registered. Remove this model from the selection.</p> : null}
            <ModelClassificationEditor model={model} supportedTypes={supportedTypes} onChange={update} />
          </div>)}
          {!filteredSelected.length ? <p className="py-3 text-sm text-muted-foreground">{models.length ? "No selected models match your search." : "Select at least one model from the catalog or add a model ID manually."}</p> : null}
        </div>
      </section>
      <section className="space-y-3" aria-label="Discovered models">
        {models.length > 100 ? <p role="alert" className="text-sm text-destructive">Register up to 100 models at a time. Remove models from the selection to continue.</p> : null}
        <h3 className="text-sm font-semibold">Discovered models · {discovery.models.length}</h3>
        <p className="text-xs text-muted-foreground">Already registered models are marked below. Search and select additional models to register.</p>
        <Input aria-label="Search discovered models" placeholder="Search by model name or ID" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {filteredCatalog.map((model) => {
            const registered = existingIds.has(model.modelId);
            const checked = selected.has(model.modelId);
            return <button key={model.modelId} type="button" aria-pressed={checked} disabled={registered || pending}
              aria-label={`${model.displayName} ${model.modelId}${registered ? " · Already registered" : ""}`}
              onClick={() => toggle(model)} className={cn("flex w-full items-center gap-3 p-3 text-left hover:bg-muted/30 disabled:opacity-60", checked && "bg-primary/5")}>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-sm border", (checked || registered) && "border-primary bg-primary text-primary-foreground")}>{checked || registered ? <Check className="size-3.5" /> : null}</span>
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm">{model.displayName}</strong><code className="block break-all text-xs text-muted-foreground">{model.modelId}</code></span>
              <Badge variant="outline">{registered ? "Registered" : checked ? "Selected" : modelTypeLabels[model.modelType]}</Badge>
            </button>;
          })}
          {!filteredCatalog.length ? <p className="p-4 text-sm text-muted-foreground">{discovery.models.length ? "No models match your search." : "No models discovered. Add a model ID manually below."}</p> : null}
        </div>
      </section>

      <section className="space-y-3 border bg-muted/10 p-4">
        <h3 className="text-sm font-semibold">Register a model ID manually</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
          <Input
            aria-label="Manual model ID"
            placeholder="Model or deployment ID"
            maxLength={160}
            value={manualModelId}
            onChange={(event) => setManualModelId(event.target.value)}
          />
          <Select
            value={manualModelType}
            onValueChange={(value) =>
              setManualModelType(value as ModelType)
            }
          >
            <SelectTrigger aria-label="Manual model type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelTypes
                .filter((type) => supportedTypes.includes(type))
                .map((type) => (
                  <SelectItem key={type} value={type}>
                    {modelTypeLabels[type]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !canSelectModel(manualModelId, models, existingIds)}
            onClick={() => {
              const id = manualModelId.trim();
              if (!canSelectModel(id, models, existingIds)) return;
              setSelectedSearch("");
              setModels([
                ...models,
                {
                  modelId: id,
                  displayName: id,
                  modelType: manualModelType,
                },
              ]);
              setManualModelId("");
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
      </section>
    </div>
  );
}

function ModelClassificationEditor({
  model,
  onChange,
  supportedTypes,
}: {
  model: ProviderModelSelection;
  onChange: (model: ProviderModelSelection) => void;
  supportedTypes: readonly ModelType[];
}) {
  return (
    <div className="ml-8 mt-3 grid gap-3 border-t pt-3 sm:grid-cols-[11rem_1fr]">
      <Select
        value={model.modelType}
        onValueChange={(value) => {
          const modelType = value as ModelType;
          const {
            capabilities: _capabilities,
            inputModalities: _inputModalities,
            outputModalities: _outputModalities,
            ...identity
          } = model;
          onChange({
            ...identity,
            modelType,
          });
        }}
      >
        <SelectTrigger aria-label={`Type for ${model.displayName}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {supportedTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {modelTypeLabels[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-1.5">
        {modelCapabilities.map((capability) => {
          const active = model.capabilities?.includes(capability) ?? false;
          return (
            <button
              key={capability}
              type="button"
              aria-pressed={active}
              className={cn(
                "rounded-sm border px-2 py-1 text-[11px]",
                active
                  ? "border-primary/30 bg-primary/10 text-link"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() =>
                onChange({
                  ...model,
                  capabilities: active
                    ? (model.capabilities ?? []).filter(
                        (item) => item !== capability,
                      )
                    : [...(model.capabilities ?? []), capability],
                })
              }
            >
              {capabilityLabels[capability]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SummaryStep({
  intent,
  summary,
}: {
  intent: "add-provider" | "register-models";
  summary: RegistrationSummary;
}) {
  return (
    <div className="space-y-6">
      <div className={cn("flex items-start gap-3 border p-4", summary.failures.length ? "bg-warning-surface" : "bg-success-surface")}>
        {summary.failures.length ? <TriangleAlert className="mt-0.5 size-5 text-warning-foreground" /> : <CheckCircle2 className="mt-0.5 size-5 text-success-foreground" />}
        <div>
          <strong>
            {summary.failures.length
              ? summary.models.length ? "Registration partially completed" : "No models registered"
              : intent === "add-provider"
              ? `${summary.providerName} added`
              : `Models registered from ${summary.providerName}`}
          </strong>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.models.length} model
            {summary.models.length === 1 ? "" : "s"} passed the LiteLLM
            capability probe.
          </p>
        </div>
      </div>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Ready models</h3>
        <div className="divide-y border">
          {summary.models.map((model) => (
            <div
              key={model.id}
              className="flex min-h-14 items-center justify-between gap-3 px-3 py-2"
            >
              <span>
                <strong className="block text-sm">{model.displayName}</strong>
                <span className="font-mono text-xs text-muted-foreground">
                  {model.modelId}
                </span>
              </span>
              <StatusBadge label="Ready" tone="success" />
            </div>
          ))}
        </div>
      </section>
      {summary.failures.length ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Needs attention</h3>
          <div className="divide-y border border-amber-500/40">
            {summary.failures.map(({ message, model }) => (
              <div key={model.modelId} className="px-3 py-3">
                <strong className="text-sm">{model.displayName}</strong>
                <p className="mt-1 text-xs text-muted-foreground">{message}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function cloneSelection(
  model: ProviderDiscoveryResult["models"][number],
): ProviderModelSelection {
  return {
    ...model,
    ...(model.capabilities
      ? { capabilities: [...model.capabilities] }
      : {}),
    ...(model.inputModalities
      ? { inputModalities: [...model.inputModalities] }
      : {}),
    ...(model.outputModalities
      ? { outputModalities: [...model.outputModalities] }
      : {}),
  };
}
