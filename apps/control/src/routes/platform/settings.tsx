import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  agentPlatforms,
  type AuthorizationCapabilityDefinitionView,
  type BuiltinRoleView,
  builtinProjectRoleIds,
  canonicalExternalRoleGroupPath,
  departmentRoleIds,
  departmentIdSchema,
  departmentNameSchema,
  externalRoleBindingInputSchema,
  isProjectCapability,
  mapAgentPlatforms,
  type ExternalRoleBindingInput,
  type ExternalRoleBindingScope,
  type AgentPlatformId,
  platformRoleIds,
  platformSettingsSections,
  providerPresets,
  scopedEntityIdFromName,
  scopedEntityIdLimits,
  scopedEntityNameLimits,
  type PlatformOrganizationView,
  type PlatformInfrastructureValidationView,
  type PlatformSecuritySettingsView,
  type PlatformSettingsSection,
  type PlatformSettingsView,
  type UpdatePlatformEmailSettingsInput,
  type UpdatePlatformSettingsInput,
  type ValidatePlatformInfrastructureSettingsInput,
  type ValidatePlatformEmailSettingsInput,
  type ValidatePlatformSsoSettingsInput,
} from "@tali/contracts";
import {
  Building2,
  Box,
  CheckCircle2,
  ChevronDown,
  Container,
  Database,
  KeyRound,
  Mail,
  Network,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ServerCog,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { AgentPlatformIcon } from "@/components/agents/agent-platform-icon";
import { ContextSidebarLayout } from "@/components/layout/context-sidebar-layout";
import {
  ContextSettingsMobileNavigation,
  ContextSettingsSidebar,
  type ContextSettingsSectionGroup,
} from "@/components/layout/context-settings-navigation";
import { CreateProjectSheet } from "@/components/project/create-project-sheet";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { ProviderIcon } from "@/components/providers/provider-icon";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProject } from "@/hooks/use-project";
import {
  groupProjectCapabilities,
  type PermissionGroup,
} from "@/features/account/permission-groups";
import {
  ProjectPermissionGroup,
  ProjectPermissionLegend,
} from "@/features/account/project-permission-group";
import { PlatformPeopleTable } from "@/features/platform/platform-people-table";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import {
  createPlatformDepartment,
  getPlatformOrganization,
  getPlatformPeople,
  getPlatformRoleCatalog,
  getPlatformSettings,
  platformOrganizationQueryKey,
  platformPeopleQueryKey,
  platformRoleCatalogQueryKey,
  platformSettingsQueryKey,
  replaceExternalRoleBindings,
  updatePlatformSecuritySettings,
  updatePlatformEmailSettings,
  updatePlatformInfrastructureSettings,
  updatePlatformSettings,
  validatePlatformEmailSettings,
  validatePlatformInfrastructureSettings,
  validatePlatformSsoSettings,
} from "@/services/platform-settings";

export const Route = createFileRoute("/platform/settings")({
  validateSearch: (search): { section?: PlatformSettingsSection } => ({
    ...(typeof search.section === "string"
      && platformSettingsSections.includes(search.section as PlatformSettingsSection)
      ? { section: search.section as PlatformSettingsSection }
      : {}),
  }),
  component: PlatformSettingsPage,
});

const sectionGroups = [
  {
    label: "People & access",
    items: [
      { id: "departments", label: "Departments", icon: Building2 },
      { id: "people", label: "People", icon: Users },
      { id: "project-roles", label: "Roles & Capabilities", icon: ShieldCheck },
    ],
  },
  {
    label: "Runtime & sandbox",
    items: [
      { id: "infrastructure", label: "Infrastructure", icon: ServerCog },
      { id: "runtime", label: "Runtime", icon: Container },
      { id: "sandbox", label: "Sandbox", icon: Box },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "model-providers", label: "Model Providers", icon: Network },
      { id: "security", label: "Security & SSO", icon: Shield },
      { id: "email", label: "Email Delivery", icon: Mail },
    ],
  },
] as const satisfies readonly ContextSettingsSectionGroup<PlatformSettingsSection>[];

function PlatformSettingsPage() {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const { section = "departments" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: platformSettingsQueryKey,
    queryFn: getPlatformSettings,
    enabled: user?.systemRole === "platform_administrator",
  });
  const save = useMutation({
    mutationFn: updatePlatformSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(platformSettingsQueryKey, updated);
    },
  });

  const changeSection = (next: PlatformSettingsSection) => {
    save.reset();
    void navigate({ replace: true, search: { section: next } });
  };
  const renderLayout = (content: ReactNode) => (
    <ContextSidebarLayout
      sidebarWidth="15rem"
      standaloneSidebar
      sidebar={(
        <ContextSettingsSidebar
          ariaLabel="Platform settings sections"
          disabled={user?.systemRole !== "platform_administrator"}
          groups={sectionGroups}
          header={(
            <>
              <strong className="font-display text-xl font-medium">Platform</strong>
              <span className="text-xs text-muted-foreground">Platform Administrator</span>
            </>
          )}
          section={section}
          onSectionChange={changeSection}
        />
      )}
      mobileNavigation={(
        <ContextSettingsMobileNavigation
          ariaLabel="Platform settings section"
          disabled={user?.systemRole !== "platform_administrator"}
          groups={sectionGroups}
          section={section}
          onSectionChange={changeSection}
        />
      )}
    >
      {content}
    </ContextSidebarLayout>
  );

  if (user?.systemRole !== "platform_administrator") {
    return renderLayout(
      <section className="mx-auto max-w-xl px-6 py-16 text-center" role="alert">
        <span className="mx-auto grid size-12 place-items-center rounded-full border bg-muted/35 text-muted-foreground">
          <ShieldAlert className="size-5" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-light tracking-[0.005em]">Platform access required</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Platform Setting is available only to a Platform Administrator. Department
          and Project administrator roles do not inherit this platform scope.
        </p>
        {currentProject ? (
          <Button asChild variant="outline" className="mt-6">
            <Link to="/$projectId" params={{ projectId: currentProject.id }}>
              Return to Project
            </Link>
          </Button>
        ) : null}
      </section>,
    );
  }

  if (settings.isPending) return renderLayout(<PlatformSettingsSkeleton />);
  if (settings.error || !settings.data) {
    return renderLayout(
      <section className="mx-auto max-w-xl px-6 py-16 text-center" role="alert">
        <ShieldAlert className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Platform settings unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {settings.error?.message ?? "The platform configuration could not be loaded."}
        </p>
        <Button className="mt-5" variant="outline" onClick={() => void settings.refetch()}>
          <RefreshCw />
          Try again
        </Button>
      </section>,
    );
  }

  const update = (input: UpdatePlatformSettingsInput) => save.mutate(input);

  return renderLayout(
    <div className="mx-auto w-full max-w-[1600px] space-y-7 p-5 sm:p-6 lg:p-8">
      <PageHeader
        title="Platform Setting"
        badge={
          <Badge className="border-primary/20 bg-primary/7 text-primary" variant="outline">
            <ShieldCheck />
            Platform Administrator
          </Badge>
        }
        description="Manage Departments, people, Project Role definitions, global Runtime and Sandbox defaults, Provider admission, and platform authentication. Quotas remain governed at the Department scope."
      />

      {save.isSuccess ? (
        <p className="flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300" role="status">
          <CheckCircle2 className="size-4" />
          Platform settings saved as revision {save.data.revision}.
        </p>
      ) : null}
      {save.error ? (
        <p className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {save.error.message}
        </p>
      ) : null}

      <section className="min-w-0">
        {section === "departments" ? <DepartmentsSettings /> : null}
        {section === "people" ? <PeopleSettings /> : null}
        {section === "project-roles" ? <RolePresetsSettings /> : null}
        {section === "infrastructure" ? (
          <InfrastructureSettings settings={settings.data} />
        ) : null}
        {section === "runtime" ? (
          <RuntimeImagesSettings
            settings={settings.data}
          />
        ) : null}
        {section === "sandbox" ? (
          <SandboxSettings settings={settings.data} />
        ) : null}
        {section === "model-providers" ? (
          <ModelProviderSettings
            key={`providers-${settings.data.revision}`}
            settings={settings.data}
            saving={save.isPending}
            onSave={update}
          />
        ) : null}
        {section === "security" ? <SecuritySettings settings={settings.data} /> : null}
        {section === "email" ? <EmailSettings settings={settings.data} /> : null}
      </section>
    </div>,
  );
}

function InfrastructureSettings({ settings }: { settings: PlatformSettingsView }) {
  const queryClient = useQueryClient();
  const current = settings.infrastructure;
  const [controlInternalUrl, setControlInternalUrl] = useState(current.controlInternalUrl);
  const [runnerUrl, setRunnerUrl] = useState(current.runner.url);
  const [runnerToken, setRunnerToken] = useState("");
  const [litellmUrl, setLitellmUrl] = useState(current.litellm.url);
  const [litellmMasterKey, setLitellmMasterKey] = useState("");
  const [namespacesEnabled, setNamespacesEnabled] = useState(
    current.runtimeNamespaces.enabled,
  );
  const [clusterId, setClusterId] = useState(current.runtimeNamespaces.clusterId);
  const validate = useMutation({
    mutationFn: validatePlatformInfrastructureSettings,
  });
  const save = useMutation({
    mutationFn: updatePlatformInfrastructureSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData<PlatformSettingsView>(
        platformSettingsQueryKey,
        (value) => value ? { ...value, infrastructure: updated } : value,
      );
      setControlInternalUrl(updated.controlInternalUrl);
      setRunnerUrl(updated.runner.url);
      setRunnerToken("");
      setLitellmUrl(updated.litellm.url);
      setLitellmMasterKey("");
      setNamespacesEnabled(updated.runtimeNamespaces.enabled);
      setClusterId(updated.runtimeNamespaces.clusterId);
      validate.reset();
    },
  });
  const draft = useMemo<ValidatePlatformInfrastructureSettingsInput>(() => ({
    controlInternalUrl: controlInternalUrl.trim(),
    runner: {
      url: runnerUrl.trim(),
      token: runnerToken
        ? { action: "replace", value: runnerToken }
        : { action: "preserve" },
    },
    litellm: {
      url: litellmUrl.trim(),
      masterKey: litellmMasterKey
        ? { action: "replace", value: litellmMasterKey }
        : { action: "preserve" },
    },
    runtimeNamespaces: {
      enabled: namespacesEnabled,
      clusterId: clusterId.trim(),
    },
  }), [
    clusterId,
    controlInternalUrl,
    litellmMasterKey,
    litellmUrl,
    namespacesEnabled,
    runnerToken,
    runnerUrl,
  ]);
  const dirty =
    draft.controlInternalUrl !== current.controlInternalUrl
    || draft.runner.url !== current.runner.url
    || Boolean(runnerToken)
    || draft.litellm.url !== current.litellm.url
    || Boolean(litellmMasterKey)
    || draft.runtimeNamespaces.enabled !== current.runtimeNamespaces.enabled
    || draft.runtimeNamespaces.clusterId !== current.runtimeNamespaces.clusterId;
  const complete = Boolean(
    draft.controlInternalUrl
    && draft.runner.url
    && (current.runner.tokenConfigured || runnerToken)
    && draft.litellm.url
    && (current.litellm.masterKeyConfigured || litellmMasterKey)
    && draft.runtimeNamespaces.clusterId,
  );
  const change = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    validate.reset();
    save.reset();
  };
  const validation = validate.data;

  return (
    <SettingsSection
      title="Infrastructure"
      description="Configure the live Control, Runner, LiteLLM, and Runtime Namespace connections. A draft must pass every probe before it can be saved."
      action={<Badge variant="outline" className="h-8 text-muted-foreground"><PlugZap />Validation required</Badge>}
    >
      <div className="grid gap-8 xl:grid-cols-2 xl:gap-x-10">
        <fieldset className="min-w-0 space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold">
            <ServerCog className="size-4 text-muted-foreground" />
            Control and Runner
          </legend>
          <p className="text-xs leading-5 text-muted-foreground">
            Control uses its internal URL for Sandbox callbacks. Runner credentials stay encrypted and are never returned to the browser.
          </p>
          <div className="space-y-2">
            <Label htmlFor="infrastructure-control-url">Control internal URL</Label>
            <Input
              id="infrastructure-control-url"
              type="url"
              className="h-11 font-mono text-xs"
              value={controlInternalUrl}
              onChange={(event) => change(setControlInternalUrl, event.target.value)}
              placeholder="http://tali-relay-control:38080"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="infrastructure-runner-url">Runner URL</Label>
              <Input
                id="infrastructure-runner-url"
                type="url"
                className="h-11 font-mono text-xs"
                value={runnerUrl}
                onChange={(event) => change(setRunnerUrl, event.target.value)}
                placeholder="http://tali-relay-runner:9090"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="infrastructure-runner-token">Runner token</Label>
              <Input
                id="infrastructure-runner-token"
                type="password"
                autoComplete="new-password"
                className="h-11 font-mono text-xs"
                value={runnerToken}
                onChange={(event) => change(setRunnerToken, event.target.value)}
                placeholder={current.runner.tokenConfigured ? "Leave blank to keep current token" : "Enter Runner token"}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0 space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold">
            <Database className="size-4 text-muted-foreground" />
            LiteLLM gateway
          </legend>
          <p className="text-xs leading-5 text-muted-foreground">
            Validation calls LiteLLM's authenticated health endpoint. The master key is encrypted before it is stored.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="infrastructure-litellm-url">LiteLLM URL</Label>
              <Input
                id="infrastructure-litellm-url"
                type="url"
                className="h-11 font-mono text-xs"
                value={litellmUrl}
                onChange={(event) => change(setLitellmUrl, event.target.value)}
                placeholder="http://tali-relay-litellm:4000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="infrastructure-litellm-key">Master key</Label>
              <Input
                id="infrastructure-litellm-key"
                type="password"
                autoComplete="new-password"
                className="h-11 font-mono text-xs"
                value={litellmMasterKey}
                onChange={(event) => change(setLitellmMasterKey, event.target.value)}
                placeholder={current.litellm.masterKeyConfigured ? "Leave blank to keep current key" : "Enter LiteLLM master key"}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0 space-y-4 xl:col-span-2">
          <legend className="flex items-center gap-2 text-sm font-semibold">
            <Box className="size-4 text-muted-foreground" />
            Runtime Namespaces
          </legend>
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
            New Projects receive a stable 19-character Kubernetes Namespace that is also valid as an OpenShell Workspace. Validation prevents changing the cluster identity while existing Runtime Targets belong to another cluster.
          </p>
          <div className="grid gap-4 md:grid-cols-[minmax(13rem,0.7fr)_minmax(13rem,1fr)] md:items-end">
            <label className="flex min-h-11 items-center justify-between gap-4 rounded-md border px-3 py-2">
              <span>
                <span className="block text-sm font-medium">Manage Namespaces</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Applies to new Projects</span>
              </span>
              <Switch
                checked={namespacesEnabled}
                onCheckedChange={(value) => change(setNamespacesEnabled, value)}
                aria-label="Manage Runtime Namespaces"
              />
            </label>
            <div className="space-y-2">
              <Label htmlFor="infrastructure-cluster-id">Cluster ID</Label>
              <Input
                id="infrastructure-cluster-id"
                className="h-11 font-mono text-xs"
                value={clusterId}
                onChange={(event) => change(setClusterId, event.target.value)}
                placeholder="in-cluster"
              />
            </div>
          </div>
        </fieldset>
      </div>

      {validation ? <InfrastructureValidationSummary validation={validation} /> : null}
      {validate.error ? (
        <p className="mt-6 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {validate.error.message}
        </p>
      ) : null}
      {save.isSuccess ? (
        <p className="mt-6 flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300" role="status">
          <CheckCircle2 className="size-4" />Infrastructure configuration saved.
        </p>
      ) : null}
      {save.error ? (
        <p className="mt-6 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {save.error.message}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          className="h-11"
          variant="outline"
          disabled={!complete || validate.isPending || save.isPending}
          onClick={() => validate.mutate(draft)}
        >
          {validate.isPending ? <Spinner /> : <ShieldCheck />}
          Validate configuration
        </Button>
        <Button
          className="h-11"
          disabled={!dirty || !validation || validate.isPending || save.isPending}
          onClick={() => validation && save.mutate({
            ...draft,
            validationToken: validation.validationToken,
          })}
        >
          {save.isPending ? <Spinner /> : <Save />}
          Save verified configuration
        </Button>
      </div>
    </SettingsSection>
  );
}

function InfrastructureValidationSummary({
  validation,
}: {
  validation: PlatformInfrastructureValidationView;
}) {
  return (
    <div className="mt-6 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200" role="status">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4" />Configuration validated
      </p>
      <p className="mt-1 text-xs leading-5">
        Control is healthy, Runner responded in {validation.runner.mode} mode, LiteLLM is reachable{validation.litellm.version ? ` (${validation.litellm.version})` : ""}, and {validation.runtimeNamespaces.existingTargetCount} existing Runtime Target{validation.runtimeNamespaces.existingTargetCount === 1 ? "" : "s"} match the cluster identity. Save before {new Date(validation.expiresAt).toLocaleTimeString()}.
      </p>
    </div>
  );
}

function RuntimeImagesSettings({ settings }: { settings: PlatformSettingsView }) {
  const queryClient = useQueryClient();
  const [images, setImages] = useState(() => mapAgentPlatforms(
    (platform) => settings.runtimeImages[platform.id] ?? "",
  ));
  const imageSave = useMutation({
    mutationFn: ({ platform, value }: { platform: AgentPlatformId; value: string }) =>
      updatePlatformSettings(settingsInput(settings, {
        runtimeImages: {
          ...settings.runtimeImages,
          [platform]: value.trim() || null,
        },
      })),
    onSuccess: (updated) => {
      queryClient.setQueryData(platformSettingsQueryKey, updated);
    },
  });
  const anySaving = imageSave.isPending;
  return (
    <SettingsSection
      title="Runtime sandbox images"
      description="Set the default image used when a new Supervisor Instance is provisioned. Existing Sandboxes are not restarted or migrated."
      action={<Badge variant="outline" className="h-8 text-muted-foreground"><Container />New Instances only</Badge>}
    >
      <div className="divide-y border-y">
        {agentPlatforms.map((platform) => (
          <RuntimeImageRow
            key={platform.id}
            effective={settings.effectiveRuntimeImages[platform.id]}
            error={imageSave.variables?.platform === platform.id ? imageSave.error : null}
            onChange={(value) => {
              imageSave.reset();
              setImages((current) => ({ ...current, [platform.id]: value }));
            }}
            onReset={() => {
              imageSave.reset();
              setImages((current) => ({ ...current, [platform.id]: "" }));
            }}
            onSave={() => imageSave.mutate({
              platform: platform.id,
              value: images[platform.id],
            })}
            overridden={settings.runtimeImages[platform.id] !== null}
            platform={platform.id}
            saved={imageSave.isSuccess && imageSave.variables?.platform === platform.id}
            saving={imageSave.isPending && imageSave.variables?.platform === platform.id}
            saveDisabled={anySaving}
            value={images[platform.id]}
            persistedValue={settings.runtimeImages[platform.id] ?? ""}
          />
        ))}
      </div>
      <p className="mt-5 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-amber-900 dark:text-amber-200">
        Use immutable tags or digests for release environments. Clearing an override returns that Runtime to the image supplied by the Runner deployment.
      </p>
    </SettingsSection>
  );
}

function RuntimeImageRow({ effective, error, onChange, onReset, onSave, overridden, persistedValue, platform, saveDisabled, saved, saving, value }: { effective: string; error: Error | null; onChange: (value: string) => void; onReset: () => void; onSave: () => void; overridden: boolean; persistedValue: string; platform: AgentPlatformId; saveDisabled: boolean; saved: boolean; saving: boolean; value: string }) {
  const presentation = getAgentPlatformPresentation(platform);
  const dirty = value !== persistedValue;
  return (
    <div className="grid gap-5 py-5 lg:min-h-40 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(24rem,1.45fr)_10rem] lg:grid-rows-[1.25rem_2.75rem_1.25rem_1.25rem] lg:gap-x-5 lg:gap-y-2 lg:py-4">
      <div className="flex min-w-0 items-start gap-3 lg:col-start-1 lg:row-start-2 lg:row-span-3 lg:self-start">
        <AgentPlatformIcon platform={presentation} className="size-12" imageClassName="size-9" />
        <span className="min-w-0">
          <strong className="block truncate text-sm">{presentation.name}</strong>
          <span className="mt-0.5 block text-xs text-muted-foreground">Core Agent runtime</span>
          <Badge variant="outline" className={overridden ? "mt-2 border-primary/25 text-primary" : "mt-2 text-muted-foreground"}>{overridden ? "Platform override" : "Deployment default"}</Badge>
        </span>
      </div>
      <div className="grid min-w-0 gap-2 lg:contents">
        <Label className="flex h-5 items-center lg:col-start-2 lg:row-start-1" htmlFor={`runtime-${platform}`}>Container image reference</Label>
        <Input id={`runtime-${platform}`} className="h-11 font-mono text-xs lg:col-start-2 lg:row-start-2" value={value} onChange={(event) => onChange(event.target.value)} placeholder={effective} />
        <div className="min-w-0 text-xs lg:col-start-2 lg:row-start-3 lg:self-center">
          <span className="text-muted-foreground">Effective image</span>
          <code className="ml-2 break-all" title={value || effective}>{value || effective}</code>
        </div>
        <div className="min-h-5 lg:col-start-2 lg:row-start-4 lg:self-center">
          {saved && !dirty ? <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300" role="status"><CheckCircle2 className="size-3.5" />Image setting saved.</p> : null}
          {error ? <p className="line-clamp-1 text-xs text-destructive" title={error.message} role="alert">{error.message}</p> : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:contents">
        <Button className="h-11 lg:col-start-3 lg:row-start-2 lg:w-40" disabled={!dirty || saveDisabled} onClick={onSave}>
          {saving ? <Spinner /> : <Save />}
          Save image
        </Button>
        <Button className="h-11 lg:col-start-3 lg:row-start-3 lg:row-span-2 lg:w-40 lg:self-end" variant="outline" disabled={!value || saving} onClick={onReset}>
          <RotateCcw />
          Use deployment
        </Button>
      </div>
    </div>
  );
}

function SandboxSettings({ settings }: { settings: PlatformSettingsView }) {
  const queryClient = useQueryClient();
  const [cpu, setCpu] = useState(settings.sandbox.cpu ?? "");
  const [memory, setMemory] = useState(settings.sandbox.memory ?? "");
  const [deletionTimeoutSeconds, setDeletionTimeoutSeconds] = useState(
    settings.runtimePolicy.namespaceDeletionTimeoutSeconds,
  );
  const defaultsSave = useMutation({
    mutationFn: () => updatePlatformSettings(settingsInput(settings, {
      sandbox: {
        cpu: cpu.trim() || null,
        memory: memory.trim() || null,
      },
    })),
    onSuccess: (updated) => {
      queryClient.setQueryData(platformSettingsQueryKey, updated);
    },
  });
  const policySave = useMutation({
    mutationFn: (namespaceDeletionTimeoutSeconds: number) =>
      updatePlatformSettings(settingsInput(settings, {
        runtimePolicy: { namespaceDeletionTimeoutSeconds },
      })),
    onSuccess: (updated) => {
      queryClient.setQueryData(platformSettingsQueryKey, updated);
    },
  });
  const cpuValid = !cpu.trim()
    || /^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?|0\.\d+)$/.test(cpu.trim());
  const memoryValid = !memory.trim()
    || /^[1-9]\d*(?:\.\d+)?(?:Ki|Mi|Gi|Ti|K|M|G|T)?$/.test(memory.trim());
  const defaultsDirty = cpu !== (settings.sandbox.cpu ?? "")
    || memory !== (settings.sandbox.memory ?? "");
  const policyDirty = deletionTimeoutSeconds
    !== settings.runtimePolicy.namespaceDeletionTimeoutSeconds;
  const timeoutValid = Number.isInteger(deletionTimeoutSeconds)
    && deletionTimeoutSeconds >= 10
    && deletionTimeoutSeconds <= 1_800;
  const anySaving = defaultsSave.isPending || policySave.isPending;
  const runtime = settings.sandboxRuntime;
  const deploymentRows = [
    ["Runner mode", runtime.mode ?? "Unavailable", "Deployment"],
    ["Gateway endpoint", runtime.gatewayEndpoint ?? "Unavailable", "Deployment"],
    ["Workspace", runtime.workspace ?? "Unavailable", "Deployment"],
    ["Service route base", runtime.serviceBaseUrl ?? "Unavailable", "Deployment"],
    [
      "Kubernetes service CIDRs",
      runtime.kubernetesServiceCidrs?.join(", ") ?? "Unavailable",
      "Deployment",
    ],
    ["Gateway image", runtime.gatewayImage ?? "Unavailable", "Deployment"],
    ["Supervisor image", runtime.supervisorImage ?? "Unavailable", "Deployment"],
    [
      "OpenShell base image",
      runtime.defaultImage ?? "Unavailable",
      runtime.defaultImagePullPolicy
        ? `Deployment · ${runtime.defaultImagePullPolicy}`
        : "Deployment",
    ],
    [
      "Gateway transport security",
      runtime.tlsDisabled === undefined
        ? "Unavailable"
        : runtime.tlsDisabled
          ? "TLS disabled"
          : "TLS enabled",
      "Deployment",
    ],
  ] as const;

  return (
    <SettingsSection
      title="Sandbox"
      description="Configure defaults read when Relay creates a new OpenShell Sandbox. Existing Sandboxes keep their current resources and image."
      action={(
        <Badge
          variant="outline"
          className={runtime.available
            ? "h-8 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
            : "h-8 text-muted-foreground"}
        >
          <Box />
          {runtime.available ? "OpenShell connected" : "OpenShell unavailable"}
        </Badge>
      )}
    >
      <div className="border-y">
        <div className="grid gap-5 py-5 lg:min-h-40 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(11.5rem,0.725fr)_minmax(11.5rem,0.725fr)_10rem] lg:grid-rows-[1.25rem_2.75rem_1.25rem_1.25rem] lg:gap-x-4 lg:gap-y-2 lg:py-4">
          <div className="flex min-w-0 items-start gap-3 lg:col-start-1 lg:row-start-2 lg:row-span-3 lg:self-start">
            <span className="grid size-12 shrink-0 place-items-center rounded-md border bg-muted/25 text-muted-foreground">
              <Box className="size-5" />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm">OpenShell resources</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">New Sandboxes only</span>
              <Badge variant="outline" className={settings.sandbox.cpu || settings.sandbox.memory ? "mt-2 border-primary/25 text-primary" : "mt-2 text-muted-foreground"}>
                {settings.sandbox.cpu || settings.sandbox.memory
                  ? "Platform override"
                  : "Deployment default"}
              </Badge>
            </span>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:contents">
            <div className="grid gap-2 lg:contents">
              <Label className="flex h-5 items-center lg:col-start-2 lg:row-start-1" htmlFor="sandbox-cpu">CPU</Label>
              <Input
                id="sandbox-cpu"
                className="h-11 font-mono text-xs lg:col-start-2 lg:row-start-2"
                value={cpu}
                placeholder={settings.effectiveSandbox.cpu}
                aria-invalid={!cpuValid}
                onChange={(event) => {
                  defaultsSave.reset();
                  setCpu(event.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground lg:col-start-2 lg:row-start-3 lg:self-center">
                Effective <code className="ml-1">{cpu || settings.effectiveSandbox.cpu}</code>
              </p>
            </div>
            <div className="grid gap-2 lg:contents">
              <Label className="flex h-5 items-center lg:col-start-3 lg:row-start-1" htmlFor="sandbox-memory">Memory</Label>
              <Input
                id="sandbox-memory"
                className="h-11 font-mono text-xs lg:col-start-3 lg:row-start-2"
                value={memory}
                placeholder={settings.effectiveSandbox.memory}
                aria-invalid={!memoryValid}
                onChange={(event) => {
                  defaultsSave.reset();
                  setMemory(event.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground lg:col-start-3 lg:row-start-3 lg:self-center">
                Effective <code className="ml-1">{memory || settings.effectiveSandbox.memory}</code>
              </p>
            </div>
            <div className="min-h-5 text-xs sm:col-span-2 lg:col-start-2 lg:col-span-2 lg:row-start-4 lg:self-center">
              {!cpuValid || !memoryValid ? (
                <p className="text-destructive" role="alert">
                  Use Kubernetes quantities such as 500m CPU and 2Gi memory.
                </p>
              ) : defaultsSave.isSuccess && !defaultsDirty ? (
                <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300" role="status">
                  <CheckCircle2 className="size-3.5" />Sandbox defaults saved.
                </p>
              ) : defaultsSave.error ? (
                <p className="text-destructive" role="alert">{defaultsSave.error.message}</p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:contents">
            <Button
              className="h-11 lg:col-start-4 lg:row-start-2 lg:w-40"
              disabled={!defaultsDirty || !cpuValid || !memoryValid || anySaving}
              onClick={() => defaultsSave.mutate()}
            >
              {defaultsSave.isPending ? <Spinner /> : <Save />}
              Save defaults
            </Button>
            <Button
              className="h-11 lg:col-start-4 lg:row-start-3 lg:row-span-2 lg:w-40 lg:self-end"
              variant="outline"
              disabled={(!cpu && !memory) || anySaving}
              onClick={() => {
                defaultsSave.reset();
                setCpu("");
                setMemory("");
              }}
            >
              <RotateCcw />
              Use deployment
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-7">
        <div>
          <h3 className="text-sm font-semibold">Project Sandbox lifecycle</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            This platform policy applies when Relay waits for a Project Runtime Namespace to be deleted.
          </p>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_10rem] lg:grid-rows-[1.25rem_2.75rem_auto] lg:gap-x-4">
          <Label className="flex h-5 items-center lg:col-start-1 lg:row-start-1" htmlFor="sandbox-namespace-deletion-timeout">Namespace deletion timeout</Label>
          <div className="flex max-w-md items-center gap-3 lg:col-start-1 lg:row-start-2">
            <Input
              id="sandbox-namespace-deletion-timeout"
              type="number"
              min={10}
              max={1800}
              className="h-11"
              value={deletionTimeoutSeconds}
              aria-invalid={!timeoutValid}
              onChange={(event) => {
                policySave.reset();
                setDeletionTimeoutSeconds(Number(event.target.value));
              }}
            />
            <span className="shrink-0 text-sm text-muted-foreground">seconds</span>
          </div>
          <Button
            className="h-11 w-full lg:col-start-2 lg:row-start-2 lg:w-40"
            disabled={!policyDirty || !timeoutValid || anySaving}
            onClick={() => policySave.mutate(deletionTimeoutSeconds)}
          >
            {policySave.isPending ? <Spinner /> : <Save />}
            Save policy
          </Button>
          <div className="max-w-md space-y-1 text-xs leading-5 lg:col-start-1 lg:row-start-3">
            <p className="text-muted-foreground">
              Allowed range: 10–1,800 seconds. Active deletion jobs read the latest Platform revision.
            </p>
            {!timeoutValid ? <p className="text-destructive" role="alert">Enter a whole number from 10 to 1,800.</p> : null}
            {policySave.isSuccess && !policyDirty ? <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300" role="status"><CheckCircle2 className="size-3.5" />Lifecycle policy saved.</p> : null}
            {policySave.error ? <p className="text-destructive" role="alert">{policySave.error.message}</p> : null}
          </div>
        </div>
      </div>

      <div className="mt-7 border-t pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">OpenShell deployment configuration</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Cluster-owned values are visible here for diagnosis but remain read-only. Agent images are resolved when a Sandbox starts and remain editable in Runtime.
            </p>
          </div>
          <Button asChild variant="outline" className="h-11 shrink-0">
            <Link to="/platform/settings" search={{ section: "runtime" }}>
              <Container />
              Edit Agent images
            </Link>
          </Button>
        </div>
        <dl className="mt-5 divide-y border-y">
          {agentPlatforms.map((platform) => (
            <SandboxReadOnlyRow
              key={platform.id}
              label={`${platform.name} Agent image`}
              value={settings.effectiveRuntimeImages[platform.id]}
              source="Runtime setting"
            />
          ))}
          {deploymentRows.map(([label, value, source]) => (
            <SandboxReadOnlyRow key={label} label={label} value={value} source={source} />
          ))}
        </dl>
      </div>
    </SettingsSection>
  );
}

function SandboxReadOnlyRow({ label, source, value }: { label: string; source: string; value: string }) {
  return (
    <div className="grid min-h-16 gap-2 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-center">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs">{value}</dd>
      <dd><Badge variant="outline" className="text-muted-foreground">{source}</Badge></dd>
    </div>
  );
}

function ModelProviderSettings({ onSave, saving, settings }: SettingsEditorProps) {
  const [enabled, setEnabled] = useState(() => new Set(settings.enabledProviderKinds));
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = providerPresets.filter((provider) => `${provider.name} ${provider.category} ${provider.description}`.toLowerCase().includes(normalized));
  const nextKinds = providerPresets.map((provider) => provider.id).filter((id) => enabled.has(id));
  const dirty = JSON.stringify(nextKinds) !== JSON.stringify(settings.enabledProviderKinds);
  return (
    <SettingsSection
      title="Model Provider admission"
      description="Choose which Provider types Project Administrators may connect. Credentials and registered models remain isolated inside each Project."
      action={<SaveButton dirty={dirty} saving={saving} onClick={() => onSave(settingsInput(settings, { enabledProviderKinds: nextKinds }))} />}
    >
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input className="h-11 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Provider catalog…" /></div>
        <span className="text-xs text-muted-foreground">{enabled.size} enabled · {providerPresets.length - enabled.size} blocked</span>
      </div>
      <div className="divide-y">
        {visible.map((provider) => {
          const checked = enabled.has(provider.id);
          return (
            <div key={provider.id} className="grid min-h-[76px] gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-3"><ProviderIcon presetId={provider.id} className="size-10 shrink-0" /><span className="min-w-0"><strong className="block truncate text-sm">{provider.name}</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">{provider.description}</span></span></div>
              <Badge variant="outline" className="w-fit">{provider.category}</Badge>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 sm:justify-end"><span className="text-xs font-medium">{checked ? "Allowed" : "Blocked"}</span><Switch checked={checked} onCheckedChange={(next) => setEnabled((current) => { const copy = new Set(current); if (next) copy.add(provider.id); else copy.delete(provider.id); return copy; })} aria-label={`${checked ? "Disable" : "Enable"} ${provider.name}`} /></label>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function DepartmentsSettings() {
  const { user } = useAuth();
  const { refreshProjects } = useProject();
  const queryClient = useQueryClient();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createDepartmentOpen, setCreateDepartmentOpen] = useState(false);
  const organization = useQuery({ queryKey: platformOrganizationQueryKey, queryFn: getPlatformOrganization });
  const departments = organization.data?.departments ?? [];
  const departmentOptions = useMemo(() => departments.map(({ id, name }) => ({ id, name })), [departments]);
  return (
    <div>
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between lg:p-6">
        <div><h2 className="font-sans text-lg font-semibold">Departments</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Create the organization structure and assign an initial Department Administrator. Department and Project administration remain separate scopes.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" disabled={!departments.some((department) => department.status === "active")} onClick={() => setCreateProjectOpen(true)}><Plus />Create Project</Button>
          <Button className="h-11" disabled={organization.isPending} onClick={() => setCreateDepartmentOpen(true)}><Plus />Create Department</Button>
        </div>
      </div>
      {organization.isPending ? <div className="grid min-h-64 place-items-center"><Spinner /></div> : organization.error ? <div className="m-5 border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive" role="alert">{organization.error.message}</div> : departments.length ? <div className="divide-y border-b">{departments.map((department) => <DepartmentRow key={department.id} department={department} />)}</div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><Building2 className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">No Departments</h3><p className="mt-1 text-xs text-muted-foreground">Create the first Department and assign its administrator.</p><Button className="mt-5" onClick={() => setCreateDepartmentOpen(true)}><Plus />Create Department</Button></div></div>}
      <CreateDepartmentSheet
        key={String(createDepartmentOpen)}
        open={createDepartmentOpen}
        people={organization.data?.people ?? []}
        onOpenChange={setCreateDepartmentOpen}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: platformOrganizationQueryKey }),
            queryClient.invalidateQueries({ queryKey: platformSettingsQueryKey }),
          ]);
        }}
      />
      <CreateProjectSheet
        authority="platform"
        departmentOptions={departmentOptions}
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        user={user}
        onCreated={async () => {
          await Promise.all([
            refreshProjects(),
            queryClient.invalidateQueries({ queryKey: platformOrganizationQueryKey }),
            queryClient.invalidateQueries({ queryKey: platformSettingsQueryKey }),
          ]);
        }}
      />
    </div>
  );
}

function DepartmentRow({ department }: { department: PlatformOrganizationView["departments"][number] }) {
  const administrators = department.members.filter((member) => member.role === "administrator");
  return (
    <div className="grid min-h-24 gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)_8rem_8rem] lg:items-center lg:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{department.name}</strong><code className="text-[11px] text-muted-foreground">{department.id}</code><Badge variant="outline" className={department.status === "active" ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-300" : ""}>{department.status}</Badge></div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{department.description || "No Department description."}</p>
      </div>
      <div className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">Department Administrator</span>
        <span className="mt-1 block truncate text-xs font-medium">{administrators.map((person) => person.displayName).join(", ") || "Unassigned"}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:contents">
        <div><span className="block text-[11px] text-muted-foreground">Projects</span><strong className="mt-1 block font-mono text-sm">{department.projects.length}</strong></div>
        <div><span className="block text-[11px] text-muted-foreground">People</span><strong className="mt-1 block font-mono text-sm">{department.members.length}</strong></div>
      </div>
    </div>
  );
}

function PeopleSettings() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  const people = useQuery({
    queryKey: [
      ...platformPeopleQueryKey,
      { departmentId, page, pageSize, projectId, search },
    ],
    queryFn: () => getPlatformPeople({
      departmentId: departmentId || undefined,
      page,
      pageSize,
      projectId: projectId || undefined,
      search,
    }),
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    if (people.data && people.data.pagination.page !== page) {
      setPage(people.data.pagination.page);
    }
  }, [page, people.data]);
  const projectOptions = (people.data?.filters.projects ?? []).filter(
    (project) => !departmentId || project.departmentId === departmentId,
  );
  const filtersActive = Boolean(searchInput || departmentId || projectId);
  const changeDepartment = (value: string) => {
    const nextDepartmentId = value === "all-departments" ? "" : value;
    setDepartmentId(nextDepartmentId);
    if (
      projectId
      && !people.data?.filters.projects.some((project) =>
        project.id === projectId
        && (!nextDepartmentId || project.departmentId === nextDepartmentId),
      )
    ) {
      setProjectId("");
    }
    setPage(1);
  };
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setDepartmentId("");
    setProjectId("");
    setPage(1);
  };
  return (
    <div>
      <div className="border-b p-5 lg:p-6">
        <h2 className="font-sans text-lg font-semibold">People</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Search onboarded human identities and verify their Platform, Department, and Project administrative scopes. Project Role definitions are managed separately.
        </p>
      </div>
      <div className="grid gap-3 border-b px-5 py-4 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_15rem_17rem_auto] lg:px-6">
        <div className="relative min-w-0">
          <Label htmlFor="people-search" className="sr-only">Search people</Label>
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            id="people-search"
            className="h-11 pl-9"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, username, or email…"
          />
        </div>
        <Select
          value={departmentId || "all-departments"}
          onValueChange={changeDepartment}
        >
          <SelectTrigger className="h-11 w-full" aria-label="Filter by Department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-departments">All Departments</SelectItem>
            {people.data?.filters.departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={projectId || "all-projects"}
          onValueChange={(value) => {
            setProjectId(value === "all-projects" ? "" : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-11 w-full" aria-label="Filter by Project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-projects">All Projects</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name} · {project.departmentName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!filtersActive}
          onClick={clearFilters}
        >
          Clear filters
        </Button>
      </div>
      {people.isPending ? (
        <div className="grid min-h-64 place-items-center"><Spinner /></div>
      ) : people.error ? (
        <div className="m-5 flex min-h-24 items-center justify-between gap-4 border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <span>{people.error.message}</span>
          <Button type="button" variant="outline" onClick={() => people.refetch()}>
            Retry
          </Button>
        </div>
      ) : people.data ? (
        <PlatformPeopleTable
          isFetching={people.isFetching}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
          page={people.data.pagination.page}
          pageSize={people.data.pagination.pageSize}
          people={people.data.data}
          total={people.data.pagination.total}
          totalPages={people.data.pagination.totalPages}
        />
      ) : null}
    </div>
  );
}

function RolePresetsSettings() {
  const roleCatalog = useQuery({
    queryKey: platformRoleCatalogQueryKey,
    queryFn: getPlatformRoleCatalog,
  });
  const administrationRoles = roleCatalog.data?.roles.filter(
    ({ family }) => family === "ADMINISTRATION",
  ) ?? [];
  const projectBusinessRoles = roleCatalog.data?.roles.filter(
    ({ family }) => family === "PROJECT_BUSINESS",
  ) ?? [];
  return (
    <section aria-labelledby="project-roles-title">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between lg:p-6">
        <div>
          <h2 id="project-roles-title" className="font-sans text-lg font-semibold">Roles &amp; Capabilities</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review the persisted system Role catalog used by authorization and SSO. Administration Roles are isolated by Platform, Department, and Project scope; business Roles apply only inside a Project.
          </p>
        </div>
        {roleCatalog.data ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <Badge variant="outline" className="font-mono">
              {roleCatalog.data.roles.length} built-in Roles
            </Badge>
            <Badge variant="outline" className="font-mono">
              Catalog revision {roleCatalog.data.revision}
            </Badge>
          </div>
        ) : null}
      </div>
      {roleCatalog.isPending ? (
        <div className="grid min-h-40 place-items-center"><Spinner /></div>
      ) : roleCatalog.error ? (
        <div className="m-5 border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {roleCatalog.error.message}
        </div>
      ) : roleCatalog.data?.roles.length ? (
        <div>
          <RoleCatalogGroup
            capabilities={roleCatalog.data.capabilities}
            description="System administration authority at three explicit, non-inheriting scopes."
            roles={administrationRoles}
            title="Administration"
          />
          <RoleCatalogGroup
            capabilities={roleCatalog.data.capabilities}
            description="Human work performed inside a Project after explicit Project membership is established."
            roles={projectBusinessRoles}
            title="Project business roles"
          />
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center p-8 text-center">
          <div>
            <Shield className="mx-auto size-7 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-semibold">No built-in Roles</h3>
            <p className="mt-1 text-xs text-muted-foreground">The persisted Role catalog is empty.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function RoleCatalogGroup({
  capabilities,
  description,
  roles,
  title,
}: {
  capabilities: readonly AuthorizationCapabilityDefinitionView[];
  description: string;
  roles: readonly BuiltinRoleView[];
  title: string;
}) {
  return (
    <section aria-label={title} className="border-b">
      <div className="border-b bg-muted/15 px-5 py-4 lg:px-6">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y">
        {roles.map((role) => (
          <RoleCatalogRow key={role.id} capabilities={capabilities} role={role} />
        ))}
      </div>
    </section>
  );
}

function scopedCapabilityGroups(
  role: BuiltinRoleView,
  definitions: readonly AuthorizationCapabilityDefinitionView[],
): PermissionGroup[] {
  const available = definitions.filter(({ scope }) => scope === role.scope);
  const effective = new Set(role.capabilities);
  if (role.scope === "PROJECT") {
    const groups = groupProjectCapabilities(
      role.capabilities.filter(isProjectCapability),
    );
    const grouped = new Set(groups.flatMap(({ items }) =>
      items.map(({ capability }) => capability),
    ));
    const systemOnly = available.filter(({ id }) => !grouped.has(id));
    if (systemOnly.length) {
      groups.push({
        id: "project-system-only",
        title: "System-only Project operations",
        description: "Registered Project capabilities intentionally excluded from every human Role.",
        items: systemOnly.map(({ id }) => ({ capability: id, enabled: effective.has(id) })),
      });
    }
    return groups;
  }

  const groupDefinitions = role.scope === "PLATFORM"
    ? [
        {
          id: "platform-core",
          title: "Platform governance",
          description: "Platform visibility, settings, organization, people, and Role catalog access.",
          prefixes: [
            "CAP_PLATFORM_VIEW",
            "CAP_PLATFORM_SETTINGS_",
            "CAP_PLATFORM_DEPARTMENT_",
            "CAP_PLATFORM_PROJECT_",
            "CAP_PLATFORM_PEOPLE_",
            "CAP_PLATFORM_ROLE_",
          ],
        },
        {
          id: "platform-runtime",
          title: "Runtime & Sandbox",
          description: "Global Runtime images, Sandbox defaults, and lifecycle policy.",
          prefixes: ["CAP_PLATFORM_RUNTIME_", "CAP_PLATFORM_SANDBOX_"],
        },
        {
          id: "platform-integrations",
          title: "Integrations",
          description: "Provider admission, SSO, and email delivery configuration.",
          prefixes: [
            "CAP_PLATFORM_PROVIDER_",
            "CAP_PLATFORM_SECURITY_",
            "CAP_PLATFORM_EMAIL_",
          ],
        },
      ]
    : [
        {
          id: "department-core",
          title: "Department governance",
          description: "Department visibility and settings.",
          prefixes: ["CAP_DEPARTMENT_VIEW", "CAP_DEPARTMENT_SETTINGS_"],
        },
        {
          id: "department-people",
          title: "People & membership",
          description: "Department membership, invitations, and administrator assignment.",
          prefixes: ["CAP_DEPARTMENT_MEMBER_"],
        },
        {
          id: "department-projects",
          title: "Projects & quota",
          description: "Department Project portfolio and Department-level quota boundaries.",
          prefixes: ["CAP_DEPARTMENT_PROJECT_", "CAP_DEPARTMENT_QUOTA_"],
        },
      ];

  return groupDefinitions.map((group) => ({
    ...group,
    items: available
      .filter(({ id }) => group.prefixes.some((prefix) => id.startsWith(prefix)))
      .map(({ id }) => ({ capability: id, enabled: effective.has(id) })),
  })).filter(({ items }) => items.length > 0);
}

function RoleCatalogRow({
  capabilities,
  role,
}: {
  capabilities: readonly AuthorizationCapabilityDefinitionView[];
  role: BuiltinRoleView;
}) {
  const groups = scopedCapabilityGroups(role, capabilities);
  const totalCapabilities = groups.reduce((total, group) => total + group.items.length, 0);
  const enabledCapabilities = groups.reduce(
    (total, group) => total + group.items.filter((item) => item.enabled).length,
    0,
  );
  return (
    <Collapsible className="group/role-preset">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="grid min-h-24 w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-4 lg:px-6"
        >
          <span className="col-span-2 flex min-w-0 items-start gap-3 md:col-span-1">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-md border bg-muted/25 text-muted-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{role.name}</strong>
                <code className="text-[11px] text-muted-foreground">{role.id}</code>
              </span>
              <span className="mt-1 block max-w-3xl text-xs leading-5 text-muted-foreground">{role.description}</span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 md:justify-end">
            <Badge variant="outline" className="font-mono">{role.scope}</Badge>
            <Badge variant="secondary" className="font-mono tabular-nums">{enabledCapabilities}/{totalCapabilities} CAPs enabled</Badge>
            <Badge variant="outline">Built-in</Badge>
            <Badge variant="outline">Read-only</Badge>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/role-preset:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t bg-muted/10 px-5 py-5 lg:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="mr-1 font-medium">Grant relations</span>
              {role.relations.length
                ? role.relations.map((relation) => (
                    <Badge key={relation} variant="outline" className="font-mono text-[10px] text-muted-foreground">{relation}</Badge>
                  ))
                : <span className="text-muted-foreground">Not qualified by a Project resource relation.</span>}
            </div>
            <ProjectPermissionLegend />
          </div>
          <div className="mt-4 space-y-2">
            {groups.map((group, index) => (
              <ProjectPermissionGroup
                key={group.id}
                defaultOpen={index === 0}
                description={group.description}
                items={group.items}
                title={group.title}
              />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CreateDepartmentSheet({ onCreated, onOpenChange, open, people }: { onCreated: () => void | Promise<void>; onOpenChange: (open: boolean) => void; open: boolean; people: PlatformOrganizationView["people"] }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [administratorUserId, setAdministratorUserId] = useState("");
  const resetFields = () => {
    setName("");
    setId("");
    setIdEdited(false);
    setDescription("");
    setAdministratorUserId("");
  };
  const create = useMutation({
    mutationFn: createPlatformDepartment,
    onSuccess: async () => {
      await onCreated();
      resetFields();
      onOpenChange(false);
    },
  });
  const activePeople = people.filter((person) => person.status === "active");
  const validatedName = departmentNameSchema.safeParse(name);
  const validatedId = departmentIdSchema.safeParse(id);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate({
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || null,
      administratorUserId,
    });
  };
  const close = () => {
    if (create.isPending) return;
    resetFields();
    create.reset();
    onOpenChange(false);
  };
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      eyebrow="Department"
      title="New Department"
      description="Create a durable organization boundary and assign the person accountable for Department administration."
      width="md"
      footer={(
        <>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={close}>Cancel</Button>
          <Button type="submit" form="create-department-form" disabled={create.isPending || !validatedName.success || !validatedId.success || !administratorUserId}>{create.isPending ? <Spinner /> : <Plus />}Create Department</Button>
        </>
      )}
    >
      <form id="create-department-form" onSubmit={submit} className="space-y-7">
        <div className="space-y-2">
          <Label htmlFor="department-name">Department name</Label>
          <Input id="department-name" autoFocus value={name} maxLength={scopedEntityNameLimits.max} aria-invalid={Boolean(name) && !validatedName.success} onChange={(event) => { const next = event.target.value; setName(next); if (!idEdited) setId(scopedEntityIdFromName(next)); create.reset(); }} placeholder="Research & Development" />
          <p className="text-xs leading-5 text-muted-foreground">{scopedEntityNameLimits.min}–{scopedEntityNameLimits.max} characters. Slashes, backslashes, and control characters are not allowed.</p>
          {name && !validatedName.success ? <p className="text-xs text-destructive" role="alert">{validatedName.error.issues[0]?.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="department-id">Department ID</Label>
          <Input id="department-id" className="font-mono" value={id} maxLength={scopedEntityIdLimits.max} aria-invalid={Boolean(id) && !validatedId.success} onChange={(event) => { setIdEdited(true); setId(event.target.value.toLowerCase()); create.reset(); }} placeholder="research-development" aria-describedby="department-id-help" />
          <p id="department-id-help" className="text-xs leading-5 text-muted-foreground">Immutable ID used in APIs, ownership references, and SSO paths. Use {scopedEntityIdLimits.min}–{scopedEntityIdLimits.max} lowercase letters, numbers, or hyphens.</p>
          {id && !validatedId.success ? <p className="text-xs text-destructive" role="alert">{validatedId.error.issues[0]?.message}</p> : null}
        </div>
        <div className="space-y-2"><Label htmlFor="department-description">Description</Label><Textarea id="department-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this Department owns…" /></div>
        <div className="space-y-2"><Label htmlFor="department-administrator">Initial Department Administrator</Label><Select value={administratorUserId} onValueChange={setAdministratorUserId}><SelectTrigger id="department-administrator" size="lg" className="w-full"><SelectValue placeholder="Select an active person" /></SelectTrigger><SelectContent>{activePeople.map((person) => <SelectItem key={person.id} value={person.id}>{person.displayName} · {person.email}</SelectItem>)}</SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">This assignment does not grant Platform Administrator or Project Administrator access.</p></div>
        {create.error ? <p className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{create.error.message}</p> : null}
      </form>
    </EntitySheet>
  );
}

function SecuritySettings({ settings }: { settings: PlatformSettingsView }) {
  const { security } = settings;
  const queryClient = useQueryClient();
  const [localAuthenticationEnabled, setLocalAuthenticationEnabled] = useState(
    security.localAuthenticationEnabled,
  );
  const [enabled, setEnabled] = useState(security.sso.enabled);
  const [displayName, setDisplayName] = useState(security.sso.displayName);
  const [issuer, setIssuer] = useState(security.sso.issuer);
  const [clientId, setClientId] = useState(security.sso.clientId);
  const [groupClaim, setGroupClaim] = useState(security.sso.groupClaim);
  const [clientSecret, setClientSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [bindings, setBindings] = useState<ExternalRoleBindingInput[]>(
    security.sso.roleBindings.map((binding) => ({
      id: binding.id,
      enabled: binding.enabled,
      group: binding.group,
      scope: binding.scope,
      departmentId: binding.departmentId,
      projectId: binding.projectId,
      roleId: binding.roleId,
    })),
  );
  const [bindingSheetOpen, setBindingSheetOpen] = useState(false);

  const applySecurity = (updated: PlatformSecuritySettingsView) => {
    queryClient.setQueryData<PlatformSettingsView>(
      platformSettingsQueryKey,
      (current) => current
        ? { ...current, revision: current.revision + 1, security: updated }
        : current,
    );
    setEnabled(updated.sso.enabled);
    setLocalAuthenticationEnabled(updated.localAuthenticationEnabled);
    setDisplayName(updated.sso.displayName);
    setIssuer(updated.sso.issuer);
    setClientId(updated.sso.clientId);
    setGroupClaim(updated.sso.groupClaim);
    setClientSecret("");
    setClearSecret(false);
  };
  const validateSso = useMutation({ mutationFn: validatePlatformSsoSettings });
  const updateSecurity = useMutation({
    mutationFn: updatePlatformSecuritySettings,
    onSuccess: (updated) => {
      applySecurity(updated);
      validateSso.reset();
    },
  });
  const updateBindings = useMutation({
    mutationFn: (next: ExternalRoleBindingInput[]) =>
      replaceExternalRoleBindings({ bindings: next }),
    onSuccess: (updated) => {
      setBindings(updated.map((binding) => ({
        id: binding.id,
        enabled: binding.enabled,
        group: binding.group,
        scope: binding.scope,
        departmentId: binding.departmentId,
        projectId: binding.projectId,
        roleId: binding.roleId,
      })));
      queryClient.setQueryData<PlatformSettingsView>(
        platformSettingsQueryKey,
        (current) => current
          ? {
              ...current,
              security: {
                ...current.security,
                sso: { ...current.security.sso, roleBindings: updated },
              },
            }
          : current,
      );
      setBindingSheetOpen(false);
    },
  });
  const dirty = localAuthenticationEnabled !== security.localAuthenticationEnabled
    || enabled !== security.sso.enabled
    || displayName !== security.sso.displayName
    || issuer !== security.sso.issuer
    || clientId !== security.sso.clientId
    || groupClaim !== security.sso.groupClaim
    || Boolean(clientSecret)
    || clearSecret;
  const configuredSecret = Boolean(clientSecret)
    || (security.sso.clientSecretConfigured && !clearSecret);
  const clientSecretUpdate: ValidatePlatformSsoSettingsInput["sso"]["clientSecret"] = clientSecret
    ? { action: "replace", value: clientSecret }
    : clearSecret
      ? { action: "clear" }
      : { action: "preserve" };
  const complete = (localAuthenticationEnabled || enabled) && (!enabled
    || (Boolean(displayName.trim())
      && Boolean(issuer.trim())
      && Boolean(clientId.trim())
      && Boolean(groupClaim.trim())
      && configuredSecret));
  const validationComplete = complete;
  const busy = updateSecurity.isPending
    || validateSso.isPending
    || updateBindings.isPending;
  const editable = security.canEditOnline && !busy;
  const draftChanged = () => {
    updateSecurity.reset();
    validateSso.reset();
  };

  const save = () => {
    if (!validateSso.data) return;
    updateSecurity.mutate({
      localAuthenticationEnabled,
      sso: {
        clientId: clientId.trim(),
        clientSecret: clientSecretUpdate,
        displayName: displayName.trim(),
        enabled,
        groupClaim: groupClaim.trim(),
        issuer: issuer.trim(),
      },
      validationToken: validateSso.data.validationToken,
    });
  };

  const validate = () => {
    validateSso.mutate({
      localAuthenticationEnabled,
      sso: {
        clientId: clientId.trim(),
        clientSecret: clientSecretUpdate,
        displayName: displayName.trim(),
        enabled,
        groupClaim: groupClaim.trim(),
        issuer: issuer.trim(),
      },
    });
  };

  return (
    <SettingsSection
      title="Authentication & SSO"
      description="Configure database-owned local and OIDC sign-in. Validate the complete authentication draft before saving it."
      action={<Badge variant="outline" className="border-primary/25 text-primary">Validation required</Badge>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SecurityStatusRow icon={KeyRound} title="Local authentication" description="Username and password sign-in for locally managed accounts." enabled={localAuthenticationEnabled} />
        <SecurityStatusRow icon={Shield} title={displayName || "Enterprise SSO"} description="OIDC discovery, PKCE, and ID-token verification through Better Auth." enabled={enabled} />
      </div>

      {security.configurationError ? (
        <p className="mt-5 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {security.configurationError} Replace the Client secret and save.
        </p>
      ) : null}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="flex min-h-11 items-center justify-between gap-4 rounded-md border px-3 py-2 lg:col-span-2">
          <span><Label htmlFor="security-local-enabled">Enable local authentication</Label><span className="mt-0.5 block text-xs text-muted-foreground">Keep enabled until a validated SSO administrator can recover access.</span></span>
          <Switch id="security-local-enabled" disabled={!editable} checked={localAuthenticationEnabled} onCheckedChange={(next) => { draftChanged(); setLocalAuthenticationEnabled(next); }} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-oidc-display-name">Provider display name</Label>
          <Input id="security-oidc-display-name" className="h-11" disabled={!editable} value={displayName} onChange={(event) => { draftChanged(); setDisplayName(event.target.value); }} placeholder="Company SSO" />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4 self-end rounded-md border px-3 py-2">
          <span><Label htmlFor="security-oidc-enabled">Enable OIDC sign-in</Label><span className="mt-0.5 block text-xs text-muted-foreground">Discovery is validated before activation.</span></span>
          <Switch id="security-oidc-enabled" disabled={!editable} checked={enabled} onCheckedChange={(next) => { draftChanged(); setEnabled(next); }} />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="security-oidc-issuer">OIDC issuer</Label>
          <Input id="security-oidc-issuer" type="url" className="h-11 font-mono text-xs" disabled={!editable} value={issuer} onChange={(event) => { draftChanged(); setIssuer(event.target.value); }} placeholder="https://identity.example.com/realms/tali" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-oidc-client-id">Client ID</Label>
          <Input id="security-oidc-client-id" className="h-11 font-mono text-xs" disabled={!editable} value={clientId} onChange={(event) => { draftChanged(); setClientId(event.target.value); }} placeholder="tali-control-plane" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-oidc-group-claim">Group claim</Label>
          <Input id="security-oidc-group-claim" className="h-11 font-mono text-xs" disabled={!editable} value={groupClaim} onChange={(event) => { draftChanged(); setGroupClaim(event.target.value); }} placeholder="groups" />
          <p className="text-xs leading-5 text-muted-foreground">Claim containing complete Keycloak Group paths in the verified ID token.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-oidc-client-secret">Client secret</Label>
          <Input
            id="security-oidc-client-secret"
            type="password"
            autoComplete="new-password"
            className="h-11 font-mono text-xs"
            disabled={!editable}
            value={clientSecret}
            onChange={(event) => {
              draftChanged();
              setClientSecret(event.target.value);
              if (event.target.value) setClearSecret(false);
            }}
            placeholder={security.sso.clientSecretConfigured ? "Leave blank to keep current secret" : "Enter Client secret"}
          />
          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-xs text-muted-foreground">
            <Switch
              disabled={!editable || Boolean(clientSecret)}
              checked={clearSecret}
              onCheckedChange={(next) => { draftChanged(); setClearSecret(next); }}
              aria-label="Clear stored Client secret"
            />
            Clear the stored Client secret on save
          </label>
        </div>
        <ReadOnlySetting id="security-oidc-callback" label="Callback URL" value={security.sso.callbackUrl} />
      </div>
      <div className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Validate and apply</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Validation checks the local recovery credential and, when enabled, OIDC Discovery and JWKS.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button className="h-11" variant="outline" disabled={!editable || !validationComplete} onClick={validate}>
              {validateSso.isPending ? <Spinner /> : <ShieldCheck />}
              Validate security
            </Button>
            <Button className="h-11" disabled={!editable || !dirty || !complete || !validateSso.isSuccess} onClick={save}>
              {updateSecurity.isPending ? <Spinner /> : <Save />}
              Save verified security
            </Button>
          </div>
        </div>
        {dirty && !validateSso.isSuccess ? (
          <p className="mt-3 text-xs text-muted-foreground">Validation is required before the authentication configuration can be saved.</p>
        ) : null}
        {validateSso.data ? (
          <div className="mt-4 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200" role="status">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" />Authentication configuration validated</p>
            <p className="mt-1 text-xs leading-5">{validateSso.data.localCredentialReady ? "The local recovery credential is ready. " : ""}{enabled ? `Discovery issuer matched and ${validateSso.data.signingKeyCount} JWKS signing ${validateSso.data.signingKeyCount === 1 ? "key was" : "keys were"} found. ` : ""}Save before {new Date(validateSso.data.expiresAt).toLocaleTimeString()}.</p>
          </div>
        ) : null}
        {validateSso.error ? <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{validateSso.error.message}</p> : null}
        {updateSecurity.isSuccess ? <p className="mt-4 flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300" role="status"><CheckCircle2 className="size-4" />Authentication settings applied to new requests.</p> : null}
        {updateSecurity.error ? <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{updateSecurity.error.message}</p> : null}
      </div>
      <div className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Group role bindings</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              Match complete Keycloak Group paths to one explicit Platform, Department, or Project Role. Group names are never parsed as authority by themselves.
            </p>
          </div>
          <Button className="h-11" variant="outline" disabled={!editable} onClick={() => { updateBindings.reset(); setBindingSheetOpen(true); }}>
            <Plus />
            Add binding
          </Button>
        </div>
        {bindings.length ? (
          <div className="mt-4 divide-y border-y">
            {bindings.map((binding) => {
              const view = security.sso.roleBindings.find(({ id }) => id === binding.id);
              const target = binding.scope === "PLATFORM"
                ? "Platform"
                : binding.scope === "DEPARTMENT"
                  ? `Department · ${view?.departmentName ?? binding.departmentId}`
                  : `Project · ${view?.projectName ?? binding.projectId}`;
              return (
                <div key={binding.id ?? binding.group} className="grid min-w-0 gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_14rem_15rem_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium" title={binding.group}>{binding.group}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{target}</p>
                  </div>
                  <code className="text-xs font-semibold">{binding.roleId}</code>
                  <div className="text-xs text-muted-foreground">
                    {view?.lastMatchedAt
                      ? `Last matched ${new Date(view.lastMatchedAt).toLocaleString()}`
                      : "Not matched yet"}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Switch
                      checked={binding.enabled}
                      disabled={!editable}
                      aria-label={`${binding.enabled ? "Disable" : "Enable"} ${binding.group}`}
                      onCheckedChange={(checked) => {
                        updateBindings.reset();
                        updateBindings.mutate(bindings.map((item) =>
                          item === binding ? { ...item, enabled: checked } : item
                        ));
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11"
                      disabled={!editable}
                      aria-label={`Delete ${binding.group}`}
                      onClick={() => {
                        updateBindings.reset();
                        updateBindings.mutate(bindings.filter((item) => item !== binding));
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 border-y py-8 text-center text-sm text-muted-foreground">
            No Group role bindings are configured. SSO users can authenticate but receive no SSO-managed Platform, Department, or Project Role.
          </div>
        )}
        {updateBindings.isSuccess ? (
          <p className="mt-4 flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300" role="status">
            <CheckCircle2 className="size-4" />Group role bindings saved.
          </p>
        ) : null}
        {updateBindings.error ? (
          <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{updateBindings.error.message}</p>
        ) : null}
      </div>
      <ExternalRoleBindingSheet
        {...(updateBindings.error ? { error: updateBindings.error.message } : {})}
        open={bindingSheetOpen}
        onOpenChange={setBindingSheetOpen}
        pending={updateBindings.isPending}
        onSave={(binding) => {
          updateBindings.reset();
          updateBindings.mutate([...bindings, binding]);
        }}
      />
      <div className="mt-6 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-amber-900 dark:text-amber-200">
        Authentication policy and the Client secret are stored in the Platform database. The secret is encrypted and is never returned to the browser.
      </div>
    </SettingsSection>
  );
}

const externalRoleLabels: Record<ExternalRoleBindingInput["roleId"], string> = {
  ROLE_PLATFORM_ADMIN: "Platform Administrator",
  ROLE_DEPARTMENT_ADMIN: "Department Administrator",
  ROLE_DEPARTMENT_MEMBER: "Department Member",
  ROLE_PROJECT_ADMIN: "Project Administrator",
  ROLE_AUDITOR: "Auditor",
  ROLE_AGENT_DEVELOPER: "Agent Developer",
  ROLE_USER: "User",
  ROLE_REVIEWER: "Reviewer",
};

function ExternalRoleBindingSheet({
  error,
  onOpenChange,
  onSave,
  open,
  pending,
}: {
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (binding: ExternalRoleBindingInput) => void;
  open: boolean;
  pending: boolean;
}) {
  const organization = useQuery({
    queryKey: platformOrganizationQueryKey,
    queryFn: getPlatformOrganization,
    enabled: open,
  });
  const [scope, setScope] = useState<ExternalRoleBindingScope>("PROJECT");
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [roleId, setRoleId] = useState<ExternalRoleBindingInput["roleId"]>(
    "ROLE_AGENT_DEVELOPER",
  );

  const selectedDepartment = organization.data?.departments.find(
    (department) => department.id === departmentId,
  );
  const roleOptions: readonly ExternalRoleBindingInput["roleId"][] =
    scope === "PLATFORM"
      ? platformRoleIds
      : scope === "DEPARTMENT"
        ? departmentRoleIds
        : builtinProjectRoleIds;
  const canonicalGroup = canonicalExternalRoleGroupPath({
    scope,
    departmentId: scope === "PLATFORM" ? null : departmentId || null,
    projectId: scope === "PROJECT" ? projectId || null : null,
    roleId,
  }) ?? "";
  const draft: ExternalRoleBindingInput = {
    enabled: true,
    group: canonicalGroup,
    scope,
    departmentId: scope === "PLATFORM" ? null : departmentId || null,
    projectId: scope === "PROJECT" ? projectId || null : null,
    roleId,
  };
  const valid = externalRoleBindingInputSchema.safeParse(draft).success;

  const reset = () => {
    setScope("PROJECT");
    setDepartmentId("");
    setProjectId("");
    setRoleId("ROLE_AGENT_DEVELOPER");
  };
  const close = () => {
    if (pending) return;
    reset();
    onOpenChange(false);
  };
  const changeScope = (next: ExternalRoleBindingScope) => {
    setScope(next);
    setDepartmentId("");
    setProjectId("");
    setRoleId(
      next === "PLATFORM"
        ? "ROLE_PLATFORM_ADMIN"
        : next === "DEPARTMENT"
          ? "ROLE_DEPARTMENT_ADMIN"
          : "ROLE_AGENT_DEVELOPER",
    );
  };

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => next ? onOpenChange(true) : close()}
      eyebrow="Security & SSO"
      title="New Group role binding"
      description="Select an internal scope and stable Role ID, then create the exact matching Group path in Keycloak."
      width="md"
      footer={(
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Cancel</Button>
          <Button type="submit" form="external-role-binding-form" disabled={pending || !valid}>
            {pending ? <Spinner /> : <Plus />}Save binding
          </Button>
        </>
      )}
    >
      <form
        id="external-role-binding-form"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(draft);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="binding-scope">Scope</Label>
          <Select value={scope} onValueChange={(value) => changeScope(value as ExternalRoleBindingScope)}>
            <SelectTrigger id="binding-scope" size="lg" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PLATFORM">Platform</SelectItem>
              <SelectItem value="DEPARTMENT">Department</SelectItem>
              <SelectItem value="PROJECT">Project</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope !== "PLATFORM" ? (
          <div className="space-y-2">
            <Label htmlFor="binding-department">Department</Label>
            <Select value={departmentId} onValueChange={(value) => { setDepartmentId(value); setProjectId(""); }}>
              <SelectTrigger id="binding-department" size="lg" className="w-full"><SelectValue placeholder={organization.isPending ? "Loading Departments…" : "Select Department"} /></SelectTrigger>
              <SelectContent>
                {organization.data?.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>{department.name} · {department.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {scope === "PROJECT" ? (
          <div className="space-y-2">
            <Label htmlFor="binding-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!departmentId}>
              <SelectTrigger id="binding-project" size="lg" className="w-full"><SelectValue placeholder="Select Project" /></SelectTrigger>
              <SelectContent>
                {selectedDepartment?.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name} · {project.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="binding-role">Role</Label>
          <Select value={roleId} onValueChange={(value) => setRoleId(value as ExternalRoleBindingInput["roleId"])}>
            <SelectTrigger id="binding-role" size="lg" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role} value={role}>{externalRoleLabels[role]} · {role}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="binding-group">Keycloak Group path</Label>
          <Input
            id="binding-group"
            className="h-11 font-mono text-xs"
            value={canonicalGroup}
            readOnly
            aria-readonly="true"
            placeholder={canonicalGroup || "/tali/d/department-id/p/project-id/r/ROLE_ID"}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Generated from the selected scope, stable IDs, and Role. Matching is exact and case-sensitive.
          </p>
        </div>
        {error ? (
          <p className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
        ) : null}
      </form>
    </EntitySheet>
  );
}

function EmailSettings({ settings }: { settings: PlatformSettingsView }) {
  const { email } = settings;
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(email.enabled);
  const [host, setHost] = useState(email.host);
  const [port, setPort] = useState(email.port);
  const [secure, setSecure] = useState(email.secure);
  const [username, setUsername] = useState(email.username);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromAddress, setFromAddress] = useState(email.fromAddress);
  const [fromName, setFromName] = useState(email.fromName);
  const [replyTo, setReplyTo] = useState(email.replyTo);
  const updateEmail = useMutation({
    mutationFn: updatePlatformEmailSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData<PlatformSettingsView>(platformSettingsQueryKey, (current) => current ? { ...current, revision: current.revision + 1, email: updated } : current);
      setPassword("");
      setClearPassword(false);
    },
  });
  const validateEmail = useMutation({
    mutationFn: validatePlatformEmailSettings,
  });
  const draftChanged = () => {
    updateEmail.reset();
  };
  const connectionChanged = () => {
    draftChanged();
    validateEmail.reset();
  };
  const passwordConfigured = Boolean(password)
    || (email.passwordConfigured && !clearPassword);
  const passwordUpdate: UpdatePlatformEmailSettingsInput["password"] = password
    ? { action: "replace", value: password }
    : clearPassword
      ? { action: "clear" }
      : { action: "preserve" };
  const dirty = enabled !== email.enabled
    || host !== email.host
    || port !== email.port
    || secure !== email.secure
    || username !== email.username
    || Boolean(password)
    || clearPassword
    || fromAddress !== email.fromAddress
    || fromName !== email.fromName
    || replyTo !== email.replyTo;
  const complete = !enabled || (
    Boolean(host.trim())
    && Boolean(fromAddress.trim())
    && Boolean(fromName.trim())
    && Boolean(username.trim()) === passwordConfigured
  );
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65_535;
  const validationComplete = enabled
    && Boolean(host.trim())
    && portValid
    && Boolean(username.trim()) === passwordConfigured;
  const save = () => updateEmail.mutate({
    enabled,
    fromAddress: fromAddress.trim(),
    fromName: fromName.trim(),
    host: host.trim(),
    password: passwordUpdate,
    port,
    replyTo: replyTo.trim(),
    secure,
    username: username.trim(),
  });
  const testConnection = () => {
    const input: ValidatePlatformEmailSettingsInput = {
      host: host.trim(),
      password: passwordUpdate,
      port,
      secure,
      username: username.trim(),
    };
    validateEmail.mutate(input);
  };

  return (
    <SettingsSection
      title="Email delivery"
      description="Configure the platform SMTP service used for Project invitations. Email delivery is stored and managed only in the Platform database."
      action={<Badge variant="outline" className="border-primary/25 text-primary">Database managed</Badge>}
    >
      <div className="flex min-h-16 items-center justify-between gap-4 border-y py-3">
        <span><strong className="block text-sm">Invitation email delivery</strong><span className="mt-0.5 block text-xs text-muted-foreground">Send invitations to people who do not yet have a Relay account.</span></span>
        <Switch checked={enabled} onCheckedChange={(next) => { connectionChanged(); setEnabled(next); }} aria-label="Enable invitation email delivery" />
      </div>
      {email.configurationError ? <p className="mt-5 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{email.configurationError} Replace the SMTP password and save.</p> : null}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="email-smtp-host">SMTP host</Label><Input id="email-smtp-host" className="h-11 font-mono text-xs" value={host} onChange={(event) => { connectionChanged(); setHost(event.target.value); }} placeholder="smtp.example.com" /></div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="space-y-2"><Label htmlFor="email-smtp-port">Port</Label><Input id="email-smtp-port" type="number" min={1} max={65535} className="h-11" value={port} aria-invalid={!portValid} onChange={(event) => { connectionChanged(); setPort(Number(event.target.value)); }} />{!portValid ? <p className="text-xs text-destructive" role="alert">Enter a port from 1 to 65,535.</p> : null}</div>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-md border px-3"><Switch checked={secure} onCheckedChange={(next) => { connectionChanged(); setSecure(next); }} aria-label="Use implicit TLS" /><span className="text-xs font-medium">Implicit TLS</span></label>
        </div>
        <div className="space-y-2"><Label htmlFor="email-smtp-username">Username</Label><Input id="email-smtp-username" className="h-11 font-mono text-xs" value={username} onChange={(event) => { connectionChanged(); setUsername(event.target.value); }} placeholder="Optional for an internal relay" /></div>
        <div className="space-y-2">
          <Label htmlFor="email-smtp-password">Password</Label>
          <Input id="email-smtp-password" type="password" autoComplete="new-password" className="h-11 font-mono text-xs" value={password} onChange={(event) => { connectionChanged(); setPassword(event.target.value); if (event.target.value) setClearPassword(false); }} placeholder={email.passwordConfigured ? "Leave blank to keep current password" : "Enter SMTP password"} />
          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-xs text-muted-foreground"><Switch disabled={Boolean(password)} checked={clearPassword} onCheckedChange={(next) => { connectionChanged(); setClearPassword(next); }} aria-label="Clear stored SMTP password" />Clear the stored password on save</label>
        </div>
        <div className="space-y-2"><Label htmlFor="email-from-address">From address</Label><Input id="email-from-address" type="email" className="h-11" value={fromAddress} onChange={(event) => { draftChanged(); setFromAddress(event.target.value); }} placeholder="invites@example.com" /></div>
        <div className="space-y-2"><Label htmlFor="email-from-name">From name</Label><Input id="email-from-name" className="h-11" value={fromName} onChange={(event) => { draftChanged(); setFromName(event.target.value); }} placeholder="TaskLattice Relay" /></div>
        <div className="space-y-2 lg:col-span-2"><Label htmlFor="email-reply-to">Reply-to</Label><Input id="email-reply-to" type="email" className="h-11" value={replyTo} onChange={(event) => { draftChanged(); setReplyTo(event.target.value); }} placeholder="Optional support address" /></div>
      </div>
      <p className="mt-6 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-amber-900 dark:text-amber-200">The SMTP password is encrypted in the Platform database and is never returned to the browser. There is no deployment-file fallback.</p>
      <div className="mt-7 border-t pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Test and apply</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Test the SMTP handshake and authentication, then save the validated connection for invitation delivery.</p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button className="h-11 w-full sm:w-auto" variant="outline" disabled={!validationComplete || validateEmail.isPending || updateEmail.isPending} onClick={testConnection}>
              {validateEmail.isPending ? <Spinner /> : <PlugZap />}
              Test connection
            </Button>
            <Button className="h-11 w-full sm:w-auto" disabled={updateEmail.isPending || validateEmail.isPending || !dirty || !complete || !portValid || (enabled && !validateEmail.isSuccess)} onClick={save}>
              {updateEmail.isPending ? <Spinner /> : <Save />}
              Save email settings
            </Button>
          </div>
        </div>
        {enabled && dirty && !validateEmail.isSuccess ? <p className="mt-3 text-xs text-muted-foreground">A successful connection test is required before enabled email delivery settings can be saved.</p> : null}
        {validateEmail.data ? (
          <div className="mt-4 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200" role="status">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" />SMTP connection verified</p>
            <p className="mt-1 text-xs leading-5">Connected to {validateEmail.data.host}:{validateEmail.data.port} with {validateEmail.data.secure ? "implicit TLS" : "SMTP negotiation"}. {validateEmail.data.authentication === "authenticated" ? "Authentication succeeded." : "The server does not require configured credentials."}</p>
          </div>
        ) : null}
        {validateEmail.error ? <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{validateEmail.error.message}</p> : null}
        {updateEmail.isSuccess ? <p className="mt-4 flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300" role="status"><CheckCircle2 className="size-4" />Email delivery settings saved.</p> : null}
        {updateEmail.error ? <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{updateEmail.error.message}</p> : null}
      </div>
    </SettingsSection>
  );
}

function SecurityStatusRow({ description, enabled, icon: Icon, title }: { description: string; enabled: boolean; icon: typeof Shield; title: string }) {
  return <div className="flex min-h-20 items-center gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{title}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span><Badge variant="outline" className={enabled ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-300" : ""}>{enabled ? "Enabled" : "Disabled"}</Badge></div>;
}

function ReadOnlySetting({ id, label, placeholder, value }: { id: string; label: string; placeholder?: string; value: string }) {
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} readOnly className="h-11 font-mono text-xs" value={value} placeholder={placeholder} /></div>;
}

function SettingsSection({ action, children, description, title }: { action: ReactNode; children: ReactNode; description: string; title: string }) {
  return <div><div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between lg:p-6"><div><h2 className="font-sans text-lg font-semibold">{title}</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p></div>{action}</div><div className="p-5 lg:p-6">{children}</div></div>;
}

function SaveButton({ dirty, onClick, saving }: { dirty: boolean; onClick: () => void; saving: boolean }) {
  return <Button className="h-11" disabled={!dirty || saving} onClick={onClick}>{saving ? <Spinner /> : <Save />}Save changes</Button>;
}

function PlatformSettingsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] p-5 sm:p-6 lg:p-8" aria-label="Loading Platform Setting">
      <div className="h-24 animate-pulse rounded-md bg-muted/65" />
      <div className="mt-7 grid gap-5 border-t pt-6 2xl:grid-cols-2">
        <div className="h-80 animate-pulse rounded-md bg-muted/45" />
        <div className="h-80 animate-pulse rounded-md bg-muted/35" />
      </div>
    </div>
  );
}

type SettingsEditorProps = {
  onSave: (input: UpdatePlatformSettingsInput) => void;
  saving: boolean;
  settings: PlatformSettingsView;
};

function settingsInput(
  settings: PlatformSettingsView,
  patch: Partial<UpdatePlatformSettingsInput>,
): UpdatePlatformSettingsInput {
  return {
    runtimeImages: patch.runtimeImages ?? settings.runtimeImages,
    sandbox: patch.sandbox ?? settings.sandbox,
    runtimePolicy: patch.runtimePolicy ?? settings.runtimePolicy,
    enabledProviderKinds:
      patch.enabledProviderKinds ?? settings.enabledProviderKinds,
  };
}
