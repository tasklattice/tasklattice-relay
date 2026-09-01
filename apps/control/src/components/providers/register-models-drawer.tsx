import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  complianceDomainCatalog,
  modelCapabilities,
  modelTypes,
  providerConnectionDraftSchema,
  providerPresets,
  providerSupportsComplianceDomain,
  type ComplianceDomain,
  type ModelCapability,
  type ModelDeployment,
  type ModelType,
  type ProviderAccount,
  type ProviderConnectionDraft,
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
  Globe2,
  Info,
  KeyRound,
  Minus,
  Plus,
  ServerCog,
  TriangleAlert,
  X,
} from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

const validationStatusLabels = {
  PASS: "Passed",
  FAIL: "Failed",
  SKIP: "Not required",
} as const;

function hasHttpsEndpoint(draft: ProviderConnectionDraft): boolean {
  const endpoint = (draft.config as Record<string, unknown>).endpoint;
  return typeof endpoint === "string" && /^https:\/\//i.test(endpoint.trim());
}

type Step = "source" | "models" | "complete";
type CredentialMode = "existing" | "new";

const registrationSteps: readonly CreationStep[] = [
  { label: "Provider", description: "Choose source and boundary" },
  { label: "Review models", description: "Select discovered deployments" },
  { label: "Complete", description: "Review registration results" },
];

interface RegistrationSummary {
  providerName: string;
  models: ModelDeployment[];
  failures: Array<{ model: ProviderModelSelection; message: string }>;
}

export function RegisterModelsDrawer({
  accounts = [],
  initialAccount,
  initialMode,
  intent = "register-models",
  onOpenChange,
  open,
}: {
  accounts?: ProviderAccount[];
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
  const [complianceDomain, setComplianceDomain] =
    useState<ComplianceDomain | "">("");
  const [summary, setSummary] = useState<RegistrationSummary>();

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
      setModels(result.models[0] ? [cloneSelection(result.models[0])] : []);
      setStep("models");
    },
  });
  const register = useMutation({
    mutationFn: async (): Promise<RegistrationSummary> => {
      if (credentialMode === "new") {
        if (!complianceDomain) {
          throw new Error("Choose a data boundary before configuring a Provider.");
        }
        const result = await client.registerProviderAccount({
          connection: draft,
          models,
          complianceDomain,
        });
        return {
          providerName: result.models[0]?.providerName
            ?? providerLabel(result.account.providerKind),
          models: result.models,
          failures: result.failures,
        };
      }
      if (!activeAccount) throw new Error("Choose saved Provider credentials.");
      const results = await Promise.all(
        models.map(async (model) => {
          const created = await client.registerModelDeployment({
            providerAccountId: activeAccount.id,
            ...model,
          });
          return { created, source: model };
        }),
      );
      return {
        providerName: results[0]?.created.providerName
          ?? providerLabel(activeAccount.providerKind),
        models: results
          .filter(({ created }) => created.status === "VALIDATED")
          .map(({ created }) => created),
        failures: results
          .filter(({ created }) => created.status !== "VALIDATED")
          .map(({ created, source }) => ({
            model: source,
            message: created.validationMessage,
          })),
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
    if (!open) return;
    setStep("source");
    setCredentialMode(defaultCredentialMode);
    setAccountId(initialAccount?.id ?? availableAccounts[0]?.id ?? "");
    setDraft(createProviderDraft("openai"));
    setProviderSelected(false);
    setErrors({});
    setDiscovery(undefined);
    setModels([]);
    setManualModelId("");
    setComplianceDomain("");
    setSummary(undefined);
    discover.reset();
    register.reset();
  }, [availableAccounts, defaultCredentialMode, initialAccount, open]);

  useEffect(() => {
    if (
      !open
      || credentialMode !== "new"
      || !complianceDomain
      || providerSelected
    ) return;
    const timer = window.setTimeout(
      () => providerTriggerRef.current?.focus(),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [complianceDomain, credentialMode, open, providerSelected]);

  const pending = discover.isPending || register.isPending;
  const selectProvider = (kind: ProviderKind) => {
    if (!complianceDomain) return;
    setDraft(createProviderDraft(kind, complianceDomain));
    setProviderSelected(true);
    setErrors({});
  };
  const changeComplianceDomain = () => {
    setComplianceDomain("");
    setProviderSelected(false);
    setDraft(createProviderDraft("openai"));
    setErrors({});
    discover.reset();
  };
  const validateAndDiscover = () => {
    if (credentialMode === "existing") {
      if (activeAccount) discover.mutate();
      return;
    }
    if (!providerSelected || !complianceDomain) return;
    if (!providerSupportsComplianceDomain(draft.provider, complianceDomain)) {
      setErrors({
        form: "This Provider is not available inside the selected compliance boundary.",
      });
      return;
    }
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
  const selectedComplianceDomain = complianceDomainCatalog.find(
    (domain) => domain.id === complianceDomain,
  );
  const availableProviderCount = complianceDomain
    ? providerPresets.filter((provider) =>
        providerSupportsComplianceDomain(provider.id, complianceDomain)
      ).length
    : 0;
  const currentWizardStep = step === "source" ? 0 : step === "models" ? 1 : 2;
  const changeWizardStep = (next: number) => {
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
      <DrawerContent className="!w-full sm:!w-[min(100vw,44rem)]">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CreationFlow
            steps={registrationSteps}
            currentStep={currentWizardStep}
            onStepChange={changeWizardStep}
            progressLabel="Register models progress"
            orientation="sidebar"
            canNavigateBack={step !== "complete"}
          >
            {step === "source" ? (
            <div className="space-y-6">
              {!addingProvider && !initialAccount && availableAccounts.length ? (
                <div
                  role="radiogroup"
                  aria-label="Provider credential source"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <SourceChoice
                    active={credentialMode === "existing"}
                    title="Use saved credentials"
                    description={`Discover models with Provider credentials already saved for this ${scopeLabel}.`}
                    onClick={() => setCredentialMode("existing")}
                  />
                  <SourceChoice
                    active={credentialMode === "new"}
                    title="Use new credentials"
                    description="Enter Provider credentials, then discover and register models."
                    onClick={() => setCredentialMode("new")}
                  />
                </div>
              ) : null}

              {credentialMode === "existing" ? (
                <div className="space-y-2">
                  <Label htmlFor="provider-credentials" required>Saved credentials</Label>
                  <Select value={accountId} onValueChange={setAccountId} required>
                    <SelectTrigger id="provider-credentials">
                      <SelectValue placeholder="Choose credentials" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {providerLabel(account.providerKind)} ·{" "}
                          {
                            complianceDomainCatalog.find(
                              (domain) => domain.id === account.complianceDomain,
                            )?.label
                          }
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
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <Globe2
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="flex items-center gap-1 text-sm font-semibold">
                              Compliance boundary <RequiredMark />
                            </h3>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="size-3.5 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                A routing constraint, not a legal certification.
                                Routing only combines models inside the same
                                boundary.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Choose where Provider endpoints and routing fallbacks
                            are allowed to operate.
                          </p>
                        </div>
                      </div>
                      {providerSelected ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          disabled={pending}
                          onClick={changeComplianceDomain}
                        >
                          Change
                        </Button>
                      ) : null}
                    </div>
                    <select
                      id="provider-compliance-boundary"
                      aria-label="Compliance boundary"
                      required
                      value={complianceDomain}
                      disabled={pending || providerSelected}
                      onChange={(event) => {
                        setComplianceDomain(
                          event.target.value as ComplianceDomain,
                        );
                        setProviderSelected(false);
                        setErrors({});
                      }}
                      className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="" disabled>
                        Select a compliance boundary
                      </option>
                      {complianceDomainCatalog.map((domain) => (
                        <option key={domain.id} value={domain.id}>
                          {domain.label}
                        </option>
                      ))}
                    </select>
                    <div
                      className={cn(
                        "border-l-2 px-3 py-2 text-xs leading-5",
                        selectedComplianceDomain
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-muted/20 text-muted-foreground",
                      )}
                    >
                      {selectedComplianceDomain
                        ? selectedComplianceDomain.description
                        : "TaskLattice Relay uses this boundary to filter Provider configurations before credentials are entered."}
                    </div>
                  </section>

                  <section className="space-y-3 border-b pb-5">
                    <div className="flex items-start gap-2.5">
                      <ServerCog
                        aria-hidden
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          complianceDomain
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      />
                      <div>
                        <h3 className="flex items-center gap-1 text-sm font-semibold">Provider <RequiredMark /></h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {complianceDomain
                            ? `${availableProviderCount} Provider configurations are available in ${selectedComplianceDomain?.label}.`
                            : "Select a compliance boundary to unlock the Provider catalog."}
                        </p>
                      </div>
                    </div>
                    <ProviderPicker
                      ref={providerTriggerRef}
                      complianceDomain={complianceDomain || undefined}
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
                            Credentials are stored server-side. The endpoint
                            defaults to the selected compliance boundary.
                          </p>
                        </div>
                      </div>
                      <Configurator
                        value={draft}
                        onChange={(next) =>
                          setDraft(hasHttpsEndpoint(next)
                            ? next
                            : { ...next, skipTlsVerify: false })
                        }
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
                              onCheckedChange={(skipTlsVerify) =>
                                setDraft({ ...draft, skipTlsVerify })
                              }
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
        </div>

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
                    : !providerSelected || !complianceDomain)
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
                disabled={!models.length || pending}
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

function ModelDiscoveryStep({
  discovery,
  manualModelId,
  manualModelType,
  models,
  setManualModelId,
  setManualModelType,
  setModels,
  supportedTypes,
}: {
  discovery: ProviderDiscoveryResult;
  manualModelId: string;
  manualModelType: ModelType;
  models: ProviderModelSelection[];
  setManualModelId: (value: string) => void;
  setManualModelType: (value: ModelType) => void;
  setModels: (models: ProviderModelSelection[]) => void;
  supportedTypes: readonly ModelType[];
}) {
  const selected = new Set(models.map((model) => model.modelId));
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
      <div
        className={cn(
          "border-l-2 px-4 py-3 text-sm",
          discovery.checks.some((check) => check.status === "FAIL")
            ? "border-amber-500 bg-amber-500/5"
            : "border-emerald-500 bg-emerald-500/5",
        )}
      >
        <strong>
          {discovery.mode === "remote"
            ? "Live model catalog"
            : discovery.mode === "suggested"
              ? "Recommended models"
              : "Manual model registration"}
        </strong>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {discovery.message}
        </p>
      </div>
      <ul
        aria-label="Provider validation checks"
        className="grid gap-2 sm:grid-cols-3"
      >
        {discovery.checks.map((check) => (
          <li
            key={check.id}
            className="flex min-h-11 items-center gap-2.5 border px-3 text-xs"
            title={`${check.label}: ${validationStatusLabels[check.status]}`}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full",
                check.status === "PASS"
                  && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                check.status === "FAIL"
                  && "bg-destructive/10 text-destructive",
                check.status === "SKIP"
                  && "bg-muted text-muted-foreground",
              )}
            >
              {check.status === "PASS" ? (
                <Check className="size-3.5 stroke-[2.5]" />
              ) : check.status === "FAIL" ? (
                <X className="size-3.5 stroke-[2.5]" />
              ) : (
                <Minus className="size-3.5 stroke-[2.5]" />
              )}
            </span>
            <span className="font-medium">{check.label}</span>
            <span className="sr-only">
              {validationStatusLabels[check.status]}
            </span>
          </li>
        ))}
      </ul>

      {discovery.models.length ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Discovered models</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Type and capabilities are inferred from Provider metadata.
                Review selected models before registration.
              </p>
            </div>
            <Badge variant="outline">{models.length} selected</Badge>
          </div>
          <div className="max-h-[28rem] divide-y overflow-y-auto border">
            {discovery.models.map((discovered) => {
              const selectedModel = models.find(
                (model) => model.modelId === discovered.modelId,
              );
              return (
                <div
                  key={discovered.modelId}
                  className={cn(
                    "p-3",
                    selectedModel && "bg-primary/[0.035]",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={Boolean(selectedModel)}
                    onClick={() => toggle(cloneSelection(discovered))}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center border",
                        selectedModel
                          && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {selectedModel ? <Check className="size-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {discovered.displayName}
                      </strong>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {discovered.modelId}
                      </span>
                    </span>
                    <Badge variant="outline">
                      {modelTypeLabels[discovered.modelType]}
                    </Badge>
                  </button>
                  {selectedModel ? (
                    <ModelClassificationEditor
                      model={selectedModel}
                      supportedTypes={supportedTypes}
                      onChange={update}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 border bg-muted/10 p-4">
        <h3 className="text-sm font-semibold">Register a model ID manually</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
          <Input
            aria-label="Manual model ID"
            placeholder="Model or deployment ID"
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
            disabled={!manualModelId.trim() || selected.has(manualModelId.trim())}
            onClick={() => {
              const id = manualModelId.trim();
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
                  ? "border-primary/30 bg-primary/10 text-primary"
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

function SummaryStep({
  intent,
  summary,
}: {
  intent: "add-provider" | "register-models";
  summary: RegistrationSummary;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 border bg-emerald-500/5 p-4">
        <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
        <div>
          <strong>
            {intent === "add-provider"
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
