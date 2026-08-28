import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  onboardAgentSchema,
  type AgentGardenEntry,
  type AgentOnboardSourceType,
  type OnboardAgentInput,
} from "@tali/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  GitBranch,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Network,
  PackageCheck,
  Plus,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  CreationFlow,
  type CreationStep,
} from "@/components/shared/creation-flow";
import { EntityDetailList, EntitySheet } from "@/components/shared/entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { AgentGardenIcon } from "./agent-garden-icon";

const steps: readonly CreationStep[] = [
  { label: "Source", description: "Choose how Relay reaches the Agent" },
  { label: "Details", description: "Set catalog identity and access" },
  { label: "Review", description: "Validate A2A compatibility" },
];

interface IdentityDraft {
  category: string;
  description: string;
  name: string;
  owner: string;
  tags: string[];
}

interface ImageDraft {
  agentCardPath: string;
  args: string[];
  command: string[];
  containerPort: number;
  image: string;
  imagePullSecretName: string;
  overrideStartup: boolean;
}

interface RepositoryDraft {
  agentCardPath: string;
  containerPort: number;
  contextDir: string;
  dockerfile: string;
  repositoryUrl: string;
  revision: string;
}

interface ExistingDraft {
  agentCardUrl: string;
  authReference: string;
  authType: "none" | "bearer_token" | "api_key";
  internalNetworkOnly: boolean;
}

function emptyIdentity(): IdentityDraft {
  return {
    name: "",
    description: "",
    category: "Developer Tools",
    owner: "",
    tags: [],
  };
}

function emptyImage(): ImageDraft {
  return {
    image: "",
    containerPort: 8_080,
    agentCardPath: "/.well-known/agent-card.json",
    imagePullSecretName: "",
    command: [],
    args: [],
    overrideStartup: false,
  };
}

function emptyRepository(): RepositoryDraft {
  return {
    repositoryUrl: "",
    revision: "main",
    contextDir: ".",
    dockerfile: "Dockerfile",
    containerPort: 8_080,
    agentCardPath: "/.well-known/agent-card.json",
  };
}

function emptyExisting(): ExistingDraft {
  return {
    agentCardUrl: "",
    authType: "none",
    authReference: "",
    internalNetworkOnly: false,
  };
}

export function RegisterAgentSheet({
  onOpenChange,
  onRegistered,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onRegistered: (agent: AgentGardenEntry) => void;
  open: boolean;
}) {
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState<AgentOnboardSourceType>(
    "container-image",
  );
  const [identity, setIdentity] = useState<IdentityDraft>(emptyIdentity);
  const [image, setImage] = useState<ImageDraft>(emptyImage);
  const [repository, setRepository] = useState<RepositoryDraft>(emptyRepository);
  const [existing, setExisting] = useState<ExistingDraft>(emptyExisting);
  const [formError, setFormError] = useState("");
  const [slowProvision, setSlowProvision] = useState(false);
  const mutation = useMutation({
    mutationFn: api.onboardGardenAgent,
    onSuccess: (agent) => {
      onRegistered(agent);
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSourceType("container-image");
    setIdentity(emptyIdentity());
    setImage(emptyImage());
    setRepository(emptyRepository());
    setExisting(emptyExisting());
    setFormError("");
    setSlowProvision(false);
    mutation.reset();
  }, [open]);

  useEffect(() => {
    if (!mutation.isPending) {
      setSlowProvision(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowProvision(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [mutation.isPending]);

  const candidate = useMemo<unknown>(() => {
    if (sourceType === "container-image") {
      return {
        ...identity,
        sourceType,
        image: image.image,
        containerPort: image.containerPort,
        agentCardPath: image.agentCardPath,
        imagePullSecretName: image.imagePullSecretName,
        command: image.command,
        args: image.args,
        usageMode: "CALLABLE",
      };
    }
    if (sourceType === "git-repository") {
      return {
        ...identity,
        ...repository,
        sourceType,
        usageMode: "CALLABLE",
      };
    }
    return {
      ...identity,
      ...existing,
      sourceType,
    };
  }, [existing, identity, image, repository, sourceType]);
  const parsed = onboardAgentSchema.safeParse(candidate);
  const sourceReady = sourceType === "container-image"
    ? Boolean(image.image.trim())
      && image.containerPort >= 1
      && image.containerPort <= 65_535
      && image.agentCardPath.startsWith("/")
      && (!image.overrideStartup
        || ([...image.command, ...image.args].some((item) => item.trim())
          && [...image.command, ...image.args].every((item) => item.trim())))
    : sourceType === "existing-agent"
      ? isHttpUrl(existing.agentCardUrl)
      : false;

  const selectSource = (next: string) => {
    setSourceType(next as AgentOnboardSourceType);
    setFormError("");
    mutation.reset();
  };

  const advance = () => {
    if (step === 0) {
      if (!sourceReady) return;
      setFormError("");
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? "Review the Agent details.");
        return;
      }
      setFormError("");
      setStep(2);
    }
  };

  const submit = () => {
    const result = onboardAgentSchema.safeParse(candidate);
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Review the Agent onboarding request.");
      setStep(1);
      return;
    }
    setFormError("");
    mutation.mutate(result.data as OnboardAgentInput);
  };

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      eyebrow="Agent Garden"
      title="Onboard Agent"
      description="Add an Agent that publishes an A2A 1.0 Agent Card. Relay can deploy its container image or register an Agent that already runs elsewhere."
      width="xl"
      bodyClassName="p-0 sm:p-0"
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {step === 0 ? (
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setStep((current) => current - 1)}>
              <ArrowLeft /> Back
            </Button>
          )}
          {step < 2 ? (
            <Button
              type="button"
              disabled={mutation.isPending || (step === 0 && !sourceReady)}
              onClick={advance}
            >
              {step === 0 ? "Continue to details" : "Review onboarding"}
              <ArrowRight />
            </Button>
          ) : (
            <Button type="button" disabled={mutation.isPending} onClick={submit}>
              {mutation.isPending ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
              {mutation.isPending
                ? sourceType === "container-image"
                  ? "Deploying & validating…"
                  : "Registering & validating…"
                : sourceType === "container-image"
                  ? "Deploy image & onboard"
                  : "Register & onboard"}
            </Button>
          )}
        </div>
      )}
    >
      <CreationFlow
        steps={steps}
        currentStep={step}
        onStepChange={setStep}
        progressLabel="Onboard Agent progress"
        orientation="sidebar"
      >
        <div className="space-y-6">
          {step === 0 ? (
            <SourceStep
              sourceType={sourceType}
              onSourceChange={selectSource}
              image={image}
              setImage={setImage}
              repository={repository}
              setRepository={setRepository}
              existing={existing}
              setExisting={setExisting}
            />
          ) : null}

          {step === 1 ? (
            <DetailsStep
              sourceType={sourceType}
              identity={identity}
              setIdentity={setIdentity}
              existing={existing}
              setExisting={setExisting}
              error={formError || mutation.error?.message || ""}
            />
          ) : null}

          {step === 2 ? (
            <ReviewStep
              sourceType={sourceType}
              identity={identity}
              image={image}
              existing={existing}
              pending={mutation.isPending}
              slowProvision={slowProvision}
              error={formError || mutation.error?.message || ""}
            />
          ) : null}
        </div>
      </CreationFlow>
    </EntitySheet>
  );
}

function SourceStep({
  existing,
  image,
  onSourceChange,
  repository,
  setExisting,
  setImage,
  setRepository,
  sourceType,
}: {
  existing: ExistingDraft;
  image: ImageDraft;
  onSourceChange: (value: string) => void;
  repository: RepositoryDraft;
  setExisting: (value: ExistingDraft) => void;
  setImage: (value: ImageDraft) => void;
  setRepository: (value: RepositoryDraft) => void;
  sourceType: AgentOnboardSourceType;
}) {
  return (
    <Tabs value={sourceType} onValueChange={onSourceChange}>
      <div>
        <h3 className="text-sm font-semibold">Choose an onboarding source</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Container Image and Existing Agent are available now. Both must expose a valid A2A 1.0 Agent Card.
        </p>
      </div>
      <TabsList variant="line" className="grid h-auto w-full grid-cols-3" aria-label="Agent onboarding source">
        <TabsTrigger value="container-image" className="h-12 px-2"><Box /> <span className="hidden sm:inline">Container Image</span><span className="sm:hidden">Image</span></TabsTrigger>
        <TabsTrigger value="existing-agent" className="h-12 px-2"><Link2 /> <span className="hidden sm:inline">Existing Agent</span><span className="sm:hidden">Existing</span></TabsTrigger>
        <TabsTrigger value="git-repository" disabled className="h-12 px-2" title="Repository onboarding is planned but not yet available"><GitBranch /> <span className="hidden sm:inline">Git Repository · Planned</span><span className="sm:hidden">Repo · Planned</span></TabsTrigger>
      </TabsList>

      <TabsContent value="container-image" className="mt-4 space-y-6">
        <p className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">
          Relay creates a Deployment and internal Service, pins the running image digest, then reads the Agent Card and validates a supported A2A 1.0 interface.
        </p>
        <FormSection icon={Box} title="A2A container image" description="Use the image ENTRYPOINT and CMD by default. The registry must be reachable from the cluster.">
          <Field id="onboard-image" label="OCI image reference">
            <Input id="onboard-image" className="h-11 font-mono" value={image.image} onChange={(event) => setImage({ ...image, image: event.target.value })} placeholder="ghcr.io/acme/research-agent:v1.4.0" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="onboard-port" label="Container port">
              <Input id="onboard-port" className="h-11 font-mono" type="number" min={1} max={65_535} value={image.containerPort} onChange={(event) => setImage({ ...image, containerPort: Number(event.target.value) })} />
            </Field>
            <Field id="onboard-card-path" label="A2A Agent Card path">
              <Input id="onboard-card-path" className="h-11 font-mono" value={image.agentCardPath} onChange={(event) => setImage({ ...image, agentCardPath: event.target.value })} />
            </Field>
          </div>
          <details className="min-w-0 max-w-full border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced container settings</summary>
            <div className="mt-4 min-w-0 space-y-6">
              <Field id="onboard-pull-secret" label="Image pull Secret (optional)">
                <Input id="onboard-pull-secret" className="h-11 font-mono" value={image.imagePullSecretName} onChange={(event) => setImage({ ...image, imagePullSecretName: event.target.value })} placeholder="registry-credentials" />
                <p className="text-xs leading-5 text-muted-foreground">References an existing Kubernetes Secret in this Project namespace.</p>
              </Field>
              <StartupOverrideEditor image={image} setImage={setImage} />
            </div>
          </details>
        </FormSection>
      </TabsContent>

      <TabsContent value="git-repository" className="mt-4 space-y-6">
        <p className="border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm leading-6">
          Repository builds are the next delivery phase. The form documents the contract, but Relay will not accept this source until the isolated build and provenance pipeline is enabled.
        </p>
        <FormSection icon={GitBranch} title="Repository build" description="The future flow will build an immutable OCI image, then use the same runtime path as Container Image.">
          <Field id="onboard-repository" label="Git repository URL">
            <Input id="onboard-repository" className="h-11 font-mono" value={repository.repositoryUrl} onChange={(event) => setRepository({ ...repository, repositoryUrl: event.target.value })} placeholder="https://github.com/acme/research-agent" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="onboard-revision" label="Revision">
              <Input id="onboard-revision" className="h-11 font-mono" value={repository.revision} onChange={(event) => setRepository({ ...repository, revision: event.target.value })} />
            </Field>
            <Field id="onboard-dockerfile" label="Dockerfile">
              <Input id="onboard-dockerfile" className="h-11 font-mono" value={repository.dockerfile} onChange={(event) => setRepository({ ...repository, dockerfile: event.target.value })} />
            </Field>
          </div>
          <Button type="button" variant="outline" onClick={() => onSourceChange("container-image")}>
            <Box /> Use Container Image instead
          </Button>
        </FormSection>
      </TabsContent>

      <TabsContent value="existing-agent" className="mt-4 space-y-6">
        <p className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">
          Register an Agent that already runs elsewhere. Relay discovers its callable endpoint and skills from the published Agent Card.
        </p>
        <FormSection icon={Network} title="Published Agent Card" description="Provide the canonical card URL; the implementation framework does not change the onboarding contract.">
          <Field id="onboard-existing-card" label="A2A Agent Card URL">
            <Input id="onboard-existing-card" className="h-11 font-mono" value={existing.agentCardUrl} onChange={(event) => setExisting({ ...existing, agentCardUrl: event.target.value })} placeholder="https://agents.example.com/.well-known/agent-card.json" />
            <p className="text-xs leading-5 text-muted-foreground">
              Relay selects an A2A 1.0 JSON-RPC or HTTP+JSON interface from the card. Health-only endpoints are not accepted.
            </p>
          </Field>
        </FormSection>
      </TabsContent>
    </Tabs>
  );
}

function DetailsStep({
  error,
  existing,
  identity,
  setExisting,
  setIdentity,
  sourceType,
}: {
  error: string;
  existing: ExistingDraft;
  identity: IdentityDraft;
  setExisting: (value: ExistingDraft) => void;
  setIdentity: (value: IdentityDraft) => void;
  sourceType: AgentOnboardSourceType;
}) {
  return (
    <form className="space-y-7" onSubmit={(event) => event.preventDefault()}>
      <FormSection icon={ServerCog} title="Identity" description="How operators and Coordinators recognize this Agent.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="onboard-name" label="Display name">
            <Input id="onboard-name" className="h-11" value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} placeholder="Research Operations Agent" autoFocus />
          </Field>
          <Field id="onboard-owner" label="Owner">
            <Input id="onboard-owner" className="h-11" value={identity.owner} onChange={(event) => setIdentity({ ...identity, owner: event.target.value })} placeholder="Developer Experience" />
          </Field>
        </div>
        <Field id="onboard-description" label="Description">
          <Textarea id="onboard-description" value={identity.description} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} placeholder="Handles research synthesis, source validation, and delegated analysis tasks." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="onboard-category" label="Category">
            <Input id="onboard-category" className="h-11" value={identity.category} onChange={(event) => setIdentity({ ...identity, category: event.target.value })} />
          </Field>
          <Field id="onboard-tags" label="Capability tags">
            <Input id="onboard-tags" className="h-11" value={identity.tags.join(", ")} onChange={(event) => setIdentity({ ...identity, tags: commaList(event.target.value) })} placeholder="Research, Sources, Analysis" />
          </Field>
        </div>
      </FormSection>

      {sourceType === "container-image" ? (
        <FormSection icon={ShieldCheck} title="Managed A2A runtime policy" description="Image Agents are private Project services and receive delegated tasks through A2A.">
          <div className="divide-y border text-sm">
            <PolicyRow label="Network" value="Project Runtime Namespace only" />
            <PolicyRow label="Kubernetes token" value="Not mounted" />
            <PolicyRow label="Usage" value="Receive delegated tasks" />
            <PolicyRow label="Validation" value="Readiness + A2A 1.0 Agent Card" />
          </div>
        </FormSection>
      ) : null}

      {sourceType === "existing-agent" ? (
        <>
          <FormSection icon={LockKeyhole} title="Authentication" description="Only Secret references are persisted. Credential values never return to the browser.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="onboard-auth-type" label="Authentication type">
                <select id="onboard-auth-type" className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={existing.authType} onChange={(event) => setExisting({ ...existing, authType: event.target.value as ExistingDraft["authType"] })}>
                  <option value="none">None</option>
                  <option value="bearer_token">Bearer token</option>
                  <option value="api_key">API key</option>
                </select>
              </Field>
              {existing.authType !== "none" ? (
                <Field id="onboard-auth-reference" label="Credential Secret reference">
                  <Input id="onboard-auth-reference" className="h-11 font-mono" value={existing.authReference} onChange={(event) => setExisting({ ...existing, authReference: event.target.value })} placeholder="k8s://namespace/secret#A2A_TOKEN" />
                </Field>
              ) : null}
            </div>
            <label className="flex min-h-12 items-start gap-3 border p-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-primary" checked={existing.internalNetworkOnly} onChange={(event) => setExisting({ ...existing, internalNetworkOnly: event.target.checked })} />
              <span><strong className="block">Internal network only</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">Allows approved private endpoints that are not publicly reachable.</span></span>
            </label>
          </FormSection>
          <FormSection icon={ShieldCheck} title="A2A delegation contract" description="All onboarded Agents are callable specialists; Relay derives capabilities from the Agent Card.">
            <div className="divide-y border text-sm">
              <PolicyRow label="Protocol" value="A2A 1.0" />
              <PolicyRow label="Usage" value="Receive delegated tasks" />
              <PolicyRow label="Interface" value="JSON-RPC or HTTP+JSON" />
              <PolicyRow label="Discovery" value="Skills and capabilities from Agent Card" />
            </div>
          </FormSection>
        </>
      ) : null}

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    </form>
  );
}

function ReviewStep({
  error,
  existing,
  identity,
  image,
  pending,
  slowProvision,
  sourceType,
}: {
  error: string;
  existing: ExistingDraft;
  identity: IdentityDraft;
  image: ImageDraft;
  pending: boolean;
  slowProvision: boolean;
  sourceType: AgentOnboardSourceType;
}) {
  const isImage = sourceType === "container-image";
  return (
    <section className="space-y-6">
      <div className="flex items-start gap-4 border bg-muted/20 p-4">
        {isImage ? <Box className="size-11 border p-2 text-primary" /> : <AgentGardenIcon type="a2a" className="size-12" />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{identity.name}</h3>
            <Badge variant="secondary">{isImage ? "A2A Container" : "A2A Standard"}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{identity.description}</p>
        </div>
      </div>
      <EntityDetailList items={isImage
        ? [
            { label: "Image", value: image.image, mono: true },
            { label: "Container port", value: String(image.containerPort), mono: true },
            { label: "Agent Card", value: image.agentCardPath, mono: true },
            { label: "Command", value: image.command.length ? JSON.stringify(image.command) : "Image ENTRYPOINT", mono: image.command.length > 0 },
            { label: "Arguments", value: image.args.length ? JSON.stringify(image.args) : "Image CMD", mono: image.args.length > 0 },
            { label: "Runtime", value: "Project Namespace / internal Service" },
            { label: "Usage", value: "Receive delegated tasks" },
          ]
        : [
            { label: "Agent Card", value: existing.agentCardUrl, mono: true },
            { label: "Protocol", value: "A2A 1.0" },
            { label: "Interface", value: "Discovered from Agent Card" },
            { label: "Usage", value: "Receive delegated tasks" },
            { label: "Owner", value: identity.owner },
            { label: "Authentication", value: existing.authType === "none" ? "None" : `${existing.authType} via Secret reference` },
            { label: "Discovery", value: "Agent Card + supported interface" },
          ]}
      />
      <p className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">
        {isImage
          ? "Relay saves the Garden record, deploys the image, pins its immutable digest, and validates the Agent Card. A failure remains visible for diagnosis and retry."
          : "Relay saves the Project-owned Agent definition, validates its A2A 1.0 Agent Card, and records the selected interface and skills. A failed validation remains visible for diagnosis and retry."}
      </p>
      {pending ? (
        <div role="status" className="flex items-start gap-3 border px-4 py-3 text-sm">
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
          <span><strong className="block">{isImage ? "Deploying Agent container" : "Validating external Agent"}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{slowProvision ? "The cluster is still pulling the image or waiting for readiness. You can keep this panel open." : isImage ? "Waiting for Kubernetes readiness and A2A discovery…" : "Reading the remote Agent metadata…"}</span></span>
        </div>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    </section>
  );
}

function FormSection({ children, description, icon: Icon, title }: { children: ReactNode; description: string; icon: typeof ServerCog; title: string }) {
  return (
    <section className="min-w-0 space-y-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border bg-muted/30"><Icon className="size-4 text-primary" /></span>
        <div className="min-w-0"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function Field({ children, id, label }: { children: ReactNode; id: string; label: string }) {
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"><span className="text-muted-foreground">{label}</span><strong className="font-medium">{value}</strong></div>;
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{children}</p>;
}

function StartupOverrideEditor({
  image,
  setImage,
}: {
  image: ImageDraft;
  setImage: (value: ImageDraft) => void;
}) {
  const startupItems = [...image.command, ...image.args];
  const hasStartupItem = startupItems.some((item) => item.trim());
  const hasBlankStartupItem = startupItems.some((item) => !item.trim());
  const setOverride = (enabled: boolean) => {
    setImage({
      ...image,
      overrideStartup: enabled,
      ...(!enabled ? { command: [], args: [] } : {}),
    });
  };

  return (
    <fieldset className="min-w-0 space-y-4 border-t pt-5">
      <legend className="sr-only">Container startup override</legend>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 border bg-muted/20 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={image.overrideStartup}
          onChange={(event) => setOverride(event.target.checked)}
        />
        <span>
          <strong className="block">Override image startup</strong>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Leave this off to run the image&apos;s existing ENTRYPOINT and CMD.
          </span>
        </span>
      </label>

      {image.overrideStartup ? (
        <div className="min-w-0 space-y-6 border-l-2 border-primary/35 pl-4">
          <p className="text-xs leading-5 text-muted-foreground">
            Each row is one Kubernetes array item. Long values wrap visually without splitting the item; blank rows are not accepted.
          </p>
          <StringListEditor
            id="onboard-command"
            label="Command"
            kubernetesName="ENTRYPOINT override"
            values={image.command}
            placeholder="/usr/local/bin/python"
            addLabel="Add command item"
            onChange={(command) => setImage({ ...image, command })}
          />
          <StringListEditor
            id="onboard-args"
            label="Arguments"
            kubernetesName="CMD override"
            values={image.args}
            placeholder="--host"
            addLabel="Add argument"
            onChange={(args) => setImage({ ...image, args })}
          />
          <div className="space-y-2">
            <p className="text-xs font-medium">Kubernetes preview</p>
            <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-all border bg-muted/30 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground"><code>{`command: ${image.command.length ? JSON.stringify(image.command) : "<image ENTRYPOINT>"}\nargs:    ${image.args.length ? JSON.stringify(image.args) : "<image CMD>"}`}</code></pre>
          </div>
          {!hasStartupItem || hasBlankStartupItem ? (
            <p role="status" className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs leading-5">
              {hasBlankStartupItem
                ? "Complete or remove the blank startup item before continuing."
                : "Add at least one Command or Arguments item, or turn off the override."}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Startup: image ENTRYPOINT + image CMD
        </p>
      )}
    </fieldset>
  );
}

function StringListEditor({
  addLabel,
  id,
  kubernetesName,
  label,
  onChange,
  placeholder,
  values,
}: {
  addLabel: string;
  id: string;
  kubernetesName: string;
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Label>{label}</Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{kubernetesName}; order is preserved.</p>
        </div>
        <Button type="button" variant="outline" className="h-11" onClick={() => onChange([...values, ""])}>
          <Plus /> {addLabel}
        </Button>
      </div>
      {values.length ? (
        <div className="min-w-0 space-y-2">
          {values.map((value, index) => (
            <div key={`${id}-${index}`} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_2.75rem] items-start gap-2">
              <span aria-hidden="true" className="pt-3 font-mono text-xs text-muted-foreground">{index + 1}</span>
              <Textarea
                id={`${id}-${index}`}
                aria-label={`${label} item ${index + 1}`}
                className="field-sizing-content max-h-36 min-h-11 min-w-0 resize-y overflow-y-auto whitespace-pre-wrap break-all font-mono leading-5"
                rows={1}
                wrap="soft"
                value={value}
                onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                placeholder={index === 0 ? placeholder : "Next item"}
                autoFocus={index === values.length - 1 && value === ""}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
                onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="border border-dashed px-3 py-3 text-xs leading-5 text-muted-foreground">
          No {label.toLowerCase()} override. The image default remains active.
        </p>
      )}
    </div>
  );
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
