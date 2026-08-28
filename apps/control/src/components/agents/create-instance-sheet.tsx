import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  defaultAgentPlatformId,
  isAgentPlatformId,
  type AccessPolicy,
  type AgentPlatformId,
  type CreateInstanceInput,
  type ModelRouting,
  type SandboxPolicy,
} from "@tali/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleHelp,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { activeDefaultAccessPolicyId } from "@/components/agents/access-policy-selection";
import { ChangeToolboxPresetDialog } from "@/components/agents/change-specialization-dialog";
import {
  availableCapabilityIds,
  changeSpecializationSelection,
  previewSpecializationChange,
  reconcileCapabilitySelection,
  specializationSelections,
  updateCapabilitySelection,
  type SelectedCapability,
} from "@/components/agents/capability-selection";
import {
  AgentFoundationStep,
  ToolboxStep,
} from "@/components/agents/agent-creation-steps";
import {
  bindableDurableMemories,
  supportsDurableMemoryPlatform,
} from "@/components/agents/durable-memory-selection";
import {
  getSpecialization,
  type SpecializationId,
} from "@/components/agents/specializations";
import { CreationFlow } from "@/components/shared/creation-flow";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId, useProject } from "@/hooks/use-project";

function capabilityName(
  id: string,
  skills: readonly { id: string; name: string }[],
  mcpServers: readonly { id: string; name: string }[],
  knowledgeSources: readonly { id: string; name: string }[],
): string {
  return (
    skills.find((item) => item.id === id)?.name ??
    mcpServers.find((item) => item.id === id)?.name ??
    knowledgeSources.find((item) => item.id === id)?.name ??
    id
  );
}

function selectedIds(items: readonly SelectedCapability[]): string[] {
  return items.map((item) => item.id);
}

const CREATE_INSTANCE_DRAFT_VERSION = 7;
const CREATE_INSTANCE_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CreateInstanceFormValues {
  name: string;
  description: string;
  agentPlatform: AgentPlatformId;
  policyId: string;
  accessPolicyIds: string[];
  modelRoutingId: string;
}

interface CreateInstanceDraft {
  version: typeof CREATE_INSTANCE_DRAFT_VERSION;
  updatedAt: number;
  step: number;
  values: CreateInstanceFormValues;
  specializationId: SpecializationId;
  customSystemPrompt: string;
  systemPrompt: string;
  instructionsTouched: boolean;
  selectedSkills: SelectedCapability[];
  selectedMcps: SelectedCapability[];
  selectedKnowledgeSources: SelectedCapability[];
  skillsTouched: boolean;
  mcpsTouched: boolean;
  knowledgeSourcesTouched: boolean;
  durableMemoryId: string;
  capabilitiesInitialized: boolean;
}

function createInstanceDraftStorageKey(
  projectId: string,
  initialAgentPlatform: AgentPlatformId,
  initialSpecializationId: string,
): string {
  return [
    "tali:create-instance-draft",
    CREATE_INSTANCE_DRAFT_VERSION,
    projectId,
    initialAgentPlatform,
    initialSpecializationId,
  ].join(":");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSelectedCapabilityArray(
  value: unknown,
): value is SelectedCapability[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as { id?: unknown; source?: unknown };
    return typeof candidate.id === "string"
      && (candidate.source === "manual" || candidate.source === "specialization");
  });
}

function readCreateInstanceDraft(storageKey: string): CreateInstanceDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<CreateInstanceDraft>;
    const values = draft.values;
    const current = Date.now();
    if (
      draft.version !== CREATE_INSTANCE_DRAFT_VERSION
      || typeof draft.updatedAt !== "number"
      || current - draft.updatedAt > CREATE_INSTANCE_DRAFT_MAX_AGE_MS
      || typeof draft.step !== "number"
      || !values
      || typeof values.name !== "string"
      || typeof values.description !== "string"
      || !isAgentPlatformId(values.agentPlatform)
      || typeof values.policyId !== "string"
      || !isStringArray(values.accessPolicyIds)
      || typeof values.modelRoutingId !== "string"
      || typeof draft.specializationId !== "string"
      || typeof draft.customSystemPrompt !== "string"
      || typeof draft.systemPrompt !== "string"
      || typeof draft.instructionsTouched !== "boolean"
      || !isSelectedCapabilityArray(draft.selectedSkills)
      || !isSelectedCapabilityArray(draft.selectedMcps)
      || !isSelectedCapabilityArray(draft.selectedKnowledgeSources)
      || typeof draft.skillsTouched !== "boolean"
      || typeof draft.mcpsTouched !== "boolean"
      || typeof draft.knowledgeSourcesTouched !== "boolean"
      || typeof draft.durableMemoryId !== "string"
      || typeof draft.capabilitiesInitialized !== "boolean"
    ) {
      clearCreateInstanceDraft(storageKey);
      return null;
    }
    return {
      ...(draft as CreateInstanceDraft),
      step: Math.min(3, Math.max(0, Math.floor(draft.step))),
    };
  } catch {
    clearCreateInstanceDraft(storageKey);
    return null;
  }
}

function writeCreateInstanceDraft(
  storageKey: string,
  draft: Omit<CreateInstanceDraft, "updatedAt" | "version">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        ...draft,
        updatedAt: Date.now(),
        version: CREATE_INSTANCE_DRAFT_VERSION,
      } satisfies CreateInstanceDraft),
    );
  } catch {
    // Draft persistence is a recovery aid; storage restrictions must not block creation.
  }
}

function clearCreateInstanceDraft(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // The creation flow remains usable when browser storage is unavailable.
  }
}

export function CreateInstanceSheet({
  initialAgentPlatform = defaultAgentPlatformId,
  initialSpecializationId = "general-purpose",
  onOpenChange,
  open,
}: {
  initialAgentPlatform?: AgentPlatformId;
  initialSpecializationId?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const navigate = useNavigate();
  const projectId = useCurrentProjectId();
  const { currentProject } = useProject();
  const durableMemoryEnabled = currentProject?.features?.durableMemory !== false;
  const scope = useProjectQueryScope();
  const { t } = useTranslation("createInstance");
  const draftStorageKey = createInstanceDraftStorageKey(
    projectId,
    initialAgentPlatform,
    initialSpecializationId,
  );
  const [restoredDraft, setRestoredDraft] =
    useState<CreateInstanceDraft | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const hydratedDraftKeyRef = useRef<string | null>(null);
  const steps = [
    {
      label: t("agentFoundation.title"),
      description: t("agentFoundation.stepDescription"),
    },
    {
      label: t("toolbox.title"),
      description: t("toolbox.stepDescription"),
    },
    {
      label: t("securityBoundaries.title"),
      description: t("securityBoundaries.stepDescription"),
    },
    {
      label: t("review.title"),
      description: t("review.stepDescription"),
    },
  ];
  const [step, setStep] = useState(0);
  const [specializationId, setSpecializationId] = useState<SpecializationId>(
    initialSpecializationId,
  );
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [systemPromptInitialized, setSystemPromptInitialized] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<SelectedCapability[]>(
    [],
  );
  const [selectedMcps, setSelectedMcps] = useState<SelectedCapability[]>([]);
  const [selectedKnowledgeSources, setSelectedKnowledgeSources] = useState<
    SelectedCapability[]
  >([]);
  const [skillsTouched, setSkillsTouched] = useState(false);
  const [mcpsTouched, setMcpsTouched] = useState(false);
  const [knowledgeSourcesTouched, setKnowledgeSourcesTouched] = useState(false);
  const [durableMemoryId, setDurableMemoryId] = useState("");
  const [capabilitiesInitialized, setCapabilitiesInitialized] = useState(false);
  const [draftFormValues, setDraftFormValues] =
    useState<CreateInstanceFormValues>({
      name: "",
      description: "",
      agentPlatform: initialAgentPlatform,
      policyId: "",
      accessPolicyIds: [],
      modelRoutingId: "",
    });
  const [pendingSpecializationId, setPendingSpecializationId] =
    useState<SpecializationId | null>(null);
  const resourceCatalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const skills = resourceCatalog.data?.skills ?? [];
  const mcpServers = resourceCatalog.data?.mcpServers ?? [];
  const knowledgeSources = resourceCatalog.data?.vectorDatabases ?? [];
  const specializations = resourceCatalog.data?.specializations ?? [];
  const specialization = getSpecialization(specializations, specializationId);
  const pendingSpecialization = pendingSpecializationId
    ? getSpecialization(specializations, pendingSpecializationId)
    : null;
  const accessPolicies = useQuery({
    queryKey: scope.key("access-policies"),
    queryFn: api.listAccessPolicies,
  });
  const modelRoutings = useQuery({
    queryKey: scope.key("model-routings"),
    queryFn: api.listModelRoutings,
  });
  const durableMemories = useQuery({
    queryKey: scope.key("durable-memories", "agent-create"),
    queryFn: () => api.listMemories({ limit: 100, statuses: ["ready", "unbound"] }),
    enabled: durableMemoryEnabled,
  });
  const policies = useQuery({
    queryKey: scope.key("runtime-policies"),
    queryFn: api.listRuntimePolicies,
  });
  const defaultModelRoutings = (modelRoutings.data ?? []).filter(
    (routing) => routing.isDefault,
  );
  const defaultModelRouting =
    defaultModelRoutings.length === 1 ? defaultModelRoutings[0] : undefined;
  const defaultAccessPolicyId = activeDefaultAccessPolicyId(
    accessPolicies.data ?? [],
  );
  const accessPolicyOptions: MultiSelectOption[] = (
    accessPolicies.data ?? []
  ).map((policy) => ({
    value: policy.id,
    label: policy.name,
    description: `${policy.serverRules.length} MCP server${policy.serverRules.length === 1 ? "" : "s"}`,
    meta: policy.status === "ACTIVE" ? "Active" : "Draft · not enforced",
    metaTone: policy.status === "ACTIVE" ? "success" : "warning",
    disabled: policy.status !== "ACTIVE",
  }));
  const currentSystemPrompt = systemPrompt;
  const incompleteMcps = selectedIds(selectedMcps)
    .map((id) => mcpServers.find((item) => item.id === id))
    .filter((item) => item && item.status !== "HEALTHY");
  const mutation = useMutation({
    mutationFn: api.createInstance,
    onSuccess: (accepted) => {
      clearCreateInstanceDraft(draftStorageKey);
      void navigate({
        to: "/$projectId/instances/$instanceId",
        params: { projectId, instanceId: accepted.instanceId },
        search: { creating: true, operationId: accepted.operation.id },
      });
    },
  });
  const form = useForm({
    defaultValues: draftFormValues,
    onSubmit: ({ value }) => {
      return mutation.mutateAsync({
        ...value,
        runtime: "openshell",
        systemPrompt: currentSystemPrompt,
        specializationId,
        skillIds: selectedIds(selectedSkills),
        mcpServerIds: selectedIds(selectedMcps),
        knowledgeSourceIds: selectedIds(selectedKnowledgeSources),
        ...(durableMemoryEnabled
          && supportsDurableMemoryPlatform(value.agentPlatform)
          && durableMemoryId
          ? { durableMemoryId }
          : {}),
      } satisfies CreateInstanceInput);
    },
  });

  const availableDurableMemories = bindableDurableMemories(
    durableMemories.data?.items ?? [],
  );

  const persistDraftSnapshot = (
    values: CreateInstanceFormValues = draftFormValues,
  ) => {
    if (!draftHydrated || !open || mutation.isSuccess) return;
    writeCreateInstanceDraft(draftStorageKey, {
      step,
      values,
      specializationId,
      customSystemPrompt,
      systemPrompt,
      instructionsTouched,
      selectedSkills,
      selectedMcps,
      selectedKnowledgeSources,
      skillsTouched,
      mcpsTouched,
      knowledgeSourcesTouched,
      durableMemoryId,
      capabilitiesInitialized,
    });
  };

  useEffect(() => {
    if (hydratedDraftKeyRef.current === draftStorageKey) return;
    hydratedDraftKeyRef.current = draftStorageKey;
    const draft = readCreateInstanceDraft(draftStorageKey);
    if (draft) {
      setRestoredDraft(draft);
      setStep(draft.step);
      setDraftFormValues(draft.values);
      form.setFieldValue("name", draft.values.name);
      form.setFieldValue("description", draft.values.description);
      form.setFieldValue("agentPlatform", draft.values.agentPlatform);
      form.setFieldValue("policyId", draft.values.policyId);
      form.setFieldValue("accessPolicyIds", draft.values.accessPolicyIds);
      form.setFieldValue("modelRoutingId", draft.values.modelRoutingId);
      setSpecializationId(draft.specializationId);
      setCustomSystemPrompt(draft.customSystemPrompt);
      setSystemPrompt(draft.systemPrompt);
      setInstructionsTouched(draft.instructionsTouched);
      setSystemPromptInitialized(true);
      setSelectedSkills(draft.selectedSkills);
      setSelectedMcps(draft.selectedMcps);
      setSelectedKnowledgeSources(draft.selectedKnowledgeSources);
      setSkillsTouched(draft.skillsTouched);
      setMcpsTouched(draft.mcpsTouched);
      setKnowledgeSourcesTouched(draft.knowledgeSourcesTouched);
      setDurableMemoryId(draft.durableMemoryId);
      setCapabilitiesInitialized(draft.capabilitiesInitialized);
    }
    setDraftHydrated(true);
  }, [draftStorageKey, form]);

  useEffect(() => {
    persistDraftSnapshot();
  }, [
    capabilitiesInitialized,
    customSystemPrompt,
    draftHydrated,
    draftStorageKey,
    draftFormValues,
    durableMemoryId,
    instructionsTouched,
    knowledgeSourcesTouched,
    mcpsTouched,
    mutation.isSuccess,
    open,
    selectedKnowledgeSources,
    selectedMcps,
    selectedSkills,
    skillsTouched,
    specializationId,
    step,
    systemPrompt,
  ]);

  useEffect(() => {
    if (
      !draftHydrated
      || !policies.data?.defaultPolicyId
      || draftFormValues.policyId
    )
      return;
    form.setFieldValue("policyId", policies.data.defaultPolicyId);
    setDraftFormValues((current) => ({
      ...current,
      policyId: policies.data?.defaultPolicyId ?? current.policyId,
    }));
  }, [draftFormValues.policyId, draftHydrated, form, policies.data?.defaultPolicyId]);

  useEffect(() => {
    if (
      !draftHydrated ||
      !defaultAccessPolicyId ||
      draftFormValues.accessPolicyIds.length
    )
      return;
    form.setFieldValue("accessPolicyIds", [defaultAccessPolicyId]);
    setDraftFormValues((current) => ({
      ...current,
      accessPolicyIds: current.accessPolicyIds.length
        ? current.accessPolicyIds
        : [defaultAccessPolicyId],
    }));
  }, [defaultAccessPolicyId, draftFormValues.accessPolicyIds.length, draftHydrated, form]);

  useEffect(() => {
    if (
      !draftHydrated
      || !defaultModelRouting?.id
      || draftFormValues.modelRoutingId
    )
      return;
    form.setFieldValue("modelRoutingId", defaultModelRouting.id);
    setDraftFormValues((current) => ({
      ...current,
      modelRoutingId: current.modelRoutingId || defaultModelRouting.id,
    }));
  }, [defaultModelRouting?.id, draftFormValues.modelRoutingId, draftHydrated, form]);

  useEffect(() => {
    if (!draftHydrated || !specialization || systemPromptInitialized) return;
    setSystemPrompt(
      specialization.id === "custom"
        ? customSystemPrompt
        : specialization.systemPrompt,
    );
    setSystemPromptInitialized(true);
  }, [customSystemPrompt, draftHydrated, specialization, systemPromptInitialized]);

  useEffect(() => {
    if (
      !draftHydrated
      || !resourceCatalog.data
      || !specialization
      || capabilitiesInitialized
    )
      return;
    setSelectedSkills(
      specializationSelections(
        availableCapabilityIds(
          specialization.defaultSkillIds,
          skills.map((item) => item.id),
        ),
      ),
    );
    setSelectedMcps(
      specializationSelections(
        availableCapabilityIds(
          specialization.defaultMcpServerIds,
          mcpServers.map((item) => item.id),
        ),
      ),
    );
    setSelectedKnowledgeSources(
      specializationSelections(
        availableCapabilityIds(
          specialization.defaultKnowledgeSourceIds,
          knowledgeSources.map((item) => item.id),
        ),
      ),
    );
    setCapabilitiesInitialized(true);
  }, [
    capabilitiesInitialized,
    draftHydrated,
    knowledgeSources,
    mcpServers,
    resourceCatalog.data,
    skills,
    specialization,
  ]);

  useEffect(() => {
    if (!capabilitiesInitialized) return;
    setSelectedSkills((current) => {
      const next = reconcileCapabilitySelection(
        current,
        skills.map((item) => item.id),
      );
      return next.length === current.length ? current : next;
    });
    setSelectedMcps((current) => {
      const next = reconcileCapabilitySelection(
        current,
        mcpServers.map((item) => item.id),
      );
      return next.length === current.length ? current : next;
    });
    setSelectedKnowledgeSources((current) => {
      const next = reconcileCapabilitySelection(
        current,
        knowledgeSources.map((item) => item.id),
      );
      return next.length === current.length ? current : next;
    });
  }, [capabilitiesInitialized, knowledgeSources, mcpServers, skills]);

  const policyName = (id: string) =>
    policies.data?.policies.find((policy) => policy.id === id)?.name ??
    (id || "Required");

  const applySpecialization = (id: SpecializationId) => {
    const next = getSpecialization(specializations, id);
    if (!next) return;
    const nextSkills = changeSpecializationSelection(
      selectedSkills,
      availableCapabilityIds(
        next.defaultSkillIds,
        skills.map((item) => item.id),
      ),
    );
    const nextMcps = changeSpecializationSelection(
      selectedMcps,
      availableCapabilityIds(
        next.defaultMcpServerIds,
        mcpServers.map((item) => item.id),
      ),
    );
    const nextKnowledgeSources = changeSpecializationSelection(
      selectedKnowledgeSources,
      availableCapabilityIds(
        next.defaultKnowledgeSourceIds,
        knowledgeSources.map((item) => item.id),
      ),
    );
    setSpecializationId(id);
    setSelectedSkills(nextSkills);
    setSelectedMcps(nextMcps);
    setSelectedKnowledgeSources(nextKnowledgeSources);
    setSkillsTouched(nextSkills.some((item) => item.source === "manual"));
    setMcpsTouched(nextMcps.some((item) => item.source === "manual"));
    setKnowledgeSourcesTouched(
      nextKnowledgeSources.some((item) => item.source === "manual"),
    );
    if (!instructionsTouched)
      setSystemPrompt(id === "custom" ? customSystemPrompt : next.systemPrompt);
    setPendingSpecializationId(null);
  };

  const requestSpecializationChange = (id: SpecializationId) => {
    if (id === specializationId) return;
    if (
      instructionsTouched ||
      skillsTouched ||
      mcpsTouched ||
      knowledgeSourcesTouched
    )
      setPendingSpecializationId(id);
    else applySpecialization(id);
  };

  const pendingChange = useMemo(() => {
    if (!pendingSpecialization) return { add: [], keep: [], remove: [] };
    const skillChange = previewSpecializationChange(
      selectedSkills,
      availableCapabilityIds(
        pendingSpecialization.defaultSkillIds,
        skills.map((item) => item.id),
      ),
    );
    const mcpChange = previewSpecializationChange(
      selectedMcps,
      availableCapabilityIds(
        pendingSpecialization.defaultMcpServerIds,
        mcpServers.map((item) => item.id),
      ),
    );
    const knowledgeChange = previewSpecializationChange(
      selectedKnowledgeSources,
      availableCapabilityIds(
        pendingSpecialization.defaultKnowledgeSourceIds,
        knowledgeSources.map((item) => item.id),
      ),
    );
    return {
      add: [...skillChange.add, ...mcpChange.add, ...knowledgeChange.add].map((id) =>
        capabilityName(id, skills, mcpServers, knowledgeSources),
      ),
      keep: [...skillChange.keep, ...mcpChange.keep, ...knowledgeChange.keep].map((id) =>
        capabilityName(id, skills, mcpServers, knowledgeSources),
      ),
      remove: [...skillChange.remove, ...mcpChange.remove, ...knowledgeChange.remove].map((id) =>
        capabilityName(id, skills, mcpServers, knowledgeSources),
      ),
    };
  }, [knowledgeSources, mcpServers, pendingSpecialization, selectedKnowledgeSources, selectedMcps, selectedSkills, skills]);

  const discardAndClose = () => {
    clearCreateInstanceDraft(draftStorageKey);
    onOpenChange(false);
  };

  const shellProps = {
    description:
      "Deploy one Project-scoped Instance from a reusable Agent definition.",
    eyebrow: "Agent Instance",
    onOpenChange: (next: boolean) => {
      if (mutation.isPending) return;
      if (!next) discardAndClose();
    },
    open,
    title: "Create Agent Instance",
    width: "xl" as const,
  };

  if (!draftHydrated)
    return (
      <EntitySheet
        {...shellProps}
        footer={
          <Button variant="outline" onClick={discardAndClose}>
            Cancel
          </Button>
        }
      >
        <div className="flex min-h-72 items-center justify-center border text-sm text-muted-foreground">
          Restoring your creation draft…
        </div>
      </EntitySheet>
    );

  if (resourceCatalog.isPending)
    return (
      <EntitySheet
        {...shellProps}
        footer={
          <Button variant="outline" onClick={discardAndClose}>
            Cancel
          </Button>
        }
      >
        <div className="flex min-h-72 items-center justify-center border text-sm text-muted-foreground">
          Loading Toolbox presets and resource catalog from PostgreSQL…
        </div>
      </EntitySheet>
    );
  if (resourceCatalog.error)
    return (
      <EntitySheet
        {...shellProps}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={discardAndClose}>
              Close
            </Button>
            <Button onClick={() => void resourceCatalog.refetch()}>
              Try again
            </Button>
          </div>
        }
      >
        <p
          role="alert"
          className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
        >
          {resourceCatalog.error.message}
        </p>
      </EntitySheet>
    );
  if (!specialization)
    return (
      <EntitySheet
        {...shellProps}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={discardAndClose}>
              Close
            </Button>
            <Button onClick={() => void resourceCatalog.refetch()}>
              Refresh catalog
            </Button>
          </div>
        }
      >
        <p
          role="alert"
          className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
        >
          The PostgreSQL catalog does not contain a Toolbox preset.
        </p>
      </EntitySheet>
    );

  return (
    <>
      <EntitySheet
        {...shellProps}
        bodyClassName="p-0 sm:p-0"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {step === 0 ? (
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={discardAndClose}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setStep((current) => Math.max(0, current - 1))}
              >
                <ArrowLeft /> Back
              </Button>
            )}
            {step === 0 ? (
              <form.Subscribe
                selector={(state) => [
                  state.values.name,
                  state.values.agentPlatform,
                ]}
              >
                {([name, agentPlatform]) => {
                  const instanceName = String(name).trim();
                  const unavailableMemory = durableMemoryEnabled
                    && supportsDurableMemoryPlatform(
                      agentPlatform as AgentPlatformId,
                    )
                    && Boolean(durableMemoryId)
                    && !availableDurableMemories.some(
                      (item) => item.id === durableMemoryId,
                    );
                  const reason = instanceName.length < 3
                    ? "Enter an Instance name using 3–64 characters."
                    : unavailableMemory
                      ? "Choose an available Memory or create a new one."
                      : "";
                  return (
                    <FooterAction reason={reason}>
                      <Button
                        type="button"
                        aria-describedby={reason ? "create-instance-action-reason" : undefined}
                        disabled={Boolean(reason)}
                        onClick={() => setStep(1)}
                      >
                        Next: Toolbox <ArrowRight />
                      </Button>
                    </FooterAction>
                  );
                }}
              </form.Subscribe>
            ) : step === 1 ? (
              <FooterAction
                reason={
                  currentSystemPrompt.trim().length < 10
                    ? "Instructions require at least 10 characters."
                    : ""
                }
              >
                <Button
                  type="button"
                  aria-describedby={
                    currentSystemPrompt.trim().length < 10
                      ? "create-instance-action-reason"
                      : undefined
                  }
                  disabled={currentSystemPrompt.trim().length < 10}
                  onClick={() => setStep(2)}
                >
                  Next: Security Boundaries <ArrowRight />
                </Button>
              </FooterAction>
            ) : step === 2 ? (
              <form.Subscribe
                selector={(state) => [
                  state.values.policyId,
                  state.values.accessPolicyIds,
                  state.values.modelRoutingId,
                ]}
              >
                {([policyId, accessPolicyIds, modelRoutingId]) => {
                  const selectedIds = Array.isArray(accessPolicyIds)
                    ? accessPolicyIds.map(String)
                    : [];
                  const selectedAreActive = selectedIds.every((id) =>
                    accessPolicies.data?.some(
                      (policy) =>
                        policy.id === id && policy.status === "ACTIVE",
                    ),
                  );
                  const selectedModelIsReady = modelRoutings.data?.some(
                    (routing) =>
                      routing.id === String(modelRoutingId) &&
                      routing.status === "READY",
                  );
                  const reason = policies.isPending
                    || accessPolicies.isPending
                    || modelRoutings.isPending
                    ? "Checking policies and routing…"
                    : policies.error
                      ? "Sandbox Policies could not be loaded. Try again above."
                      : accessPolicies.error
                        ? "Access Policies could not be loaded. Try again above."
                        : modelRoutings.error
                          ? "Model Routing could not be loaded. Try again above."
                          : !String(policyId)
                            ? "Select a Sandbox Policy."
                            : !selectedIds.length
                              ? "Select at least one active Access Policy."
                              : !selectedAreActive
                                ? "Replace inactive or unavailable Access Policies."
                                : !selectedModelIsReady
                                  ? "Select a ready Model Routing."
                                  : "";
                  return (
                    <FooterAction key="next-review" reason={reason}>
                      <Button
                        type="button"
                        aria-describedby={reason ? "create-instance-action-reason" : undefined}
                        disabled={Boolean(reason)}
                        onClick={() => setStep(3)}
                      >
                        Next: Review <ArrowRight />
                      </Button>
                    </FooterAction>
                  );
                }}
              </form.Subscribe>
            ) : (
              <form.Subscribe
                selector={(state) => [
                  state.canSubmit,
                  state.isSubmitting,
                  state.values.policyId,
                  state.values.accessPolicyIds,
                  state.values.modelRoutingId,
                ]}
              >
                {([
                  canSubmit,
                  isSubmitting,
                  policyId,
                  accessPolicyIds,
                  modelRoutingId,
                ]) => {
                  const selectedIds = Array.isArray(accessPolicyIds)
                    ? accessPolicyIds.map(String)
                    : [];
                  const selectedAreActive = selectedIds.every((id) =>
                    accessPolicies.data?.some(
                      (policy) =>
                        policy.id === id && policy.status === "ACTIVE",
                    ),
                  );
                  const selectedModelIsReady = modelRoutings.data?.some(
                    (routing) =>
                      routing.id === String(modelRoutingId) &&
                      routing.status === "READY",
                  );
                  const reason = policies.isPending
                    || accessPolicies.isPending
                    || modelRoutings.isPending
                    ? "Checking policies and routing…"
                    : policies.error
                      || accessPolicies.error
                      || modelRoutings.error
                      ? "Resolve the policy or routing loading error before creating."
                      : !canSubmit
                        ? "Review the required fields before creating this Instance."
                        : !String(policyId)
                          || !selectedIds.length
                          || !selectedAreActive
                          ? "Complete the required Security Boundaries."
                          : !selectedModelIsReady
                            ? "Select a ready Model Routing."
                            : "";
                  return (
                    <FooterAction key="approve-create" reason={reason}>
                      <Button
                        type="button"
                        aria-describedby={reason ? "create-instance-action-reason" : undefined}
                        disabled={
                          Boolean(reason) ||
                          Boolean(isSubmitting) ||
                          mutation.isPending ||
                          accessPolicies.isPending ||
                          accessPolicies.isError ||
                          modelRoutings.isPending ||
                          modelRoutings.isError
                        }
                        onClick={() => void form.handleSubmit()}
                      >
                        <ShieldCheck />{" "}
                        {mutation.isPending
                          ? "Creating Instance…"
                          : "Approve and Create Instance"}
                      </Button>
                    </FooterAction>
                  );
                }}
              </form.Subscribe>
            )}
          </div>
        }
      >
        <CreationFlow
          steps={steps}
          currentStep={step}
          onStepChange={setStep}
          progressLabel={t("progressLabel")}
          orientation="sidebar"
        >
          {restoredDraft ? (
            <p
              role="status"
              className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-xs leading-5"
            >
              Your unfinished Instance draft was restored for this browser tab.
            </p>
          ) : null}
          {step === 0 ? (
            <CreationReadinessNotice
              accessPolicies={accessPolicies.data ?? []}
              accessPoliciesError={accessPolicies.error}
              accessPoliciesPending={accessPolicies.isPending}
              onRetryAccessPolicies={() => void accessPolicies.refetch()}
              modelRoutings={modelRoutings.data ?? []}
              modelRoutingsError={modelRoutings.error}
              modelRoutingsPending={modelRoutings.isPending}
              onRetryModelRoutings={() => void modelRoutings.refetch()}
              onRetryRuntimePolicies={() => void policies.refetch()}
              projectId={projectId}
              runtimePolicies={policies.data?.policies ?? []}
              runtimePoliciesError={policies.error}
              runtimePoliciesPending={policies.isPending}
            />
          ) : null}
          <form
            onSubmit={(event) => event.preventDefault()}
            className="min-w-0 space-y-5"
          >
            {step === 0 ? (
              <form.Subscribe
                selector={(state) => [
                  state.values.name,
                  state.values.agentPlatform,
                ]}
              >
                {([name, agentPlatform]) => (
                  <AgentFoundationStep
                    name={String(name)}
                    agentPlatform={agentPlatform as AgentPlatformId}
                    durableMemories={durableMemories.data?.items ?? []}
                    durableMemoriesLoading={durableMemories.isPending}
                    durableMemoryEnabled={durableMemoryEnabled}
                    durableMemoryId={durableMemoryId}
                    onNameChange={(value) => {
                      const values = {
                        ...draftFormValues,
                        name: value,
                      };
                      form.setFieldValue("name", value);
                      setDraftFormValues(values);
                      persistDraftSnapshot(values);
                    }}
                    onAgentPlatformChange={(value) => {
                      const values = {
                        ...draftFormValues,
                        agentPlatform: value,
                      };
                      form.setFieldValue("agentPlatform", value);
                      setDraftFormValues(values);
                      persistDraftSnapshot(values);
                    }}
                    onDurableMemoryIdChange={setDurableMemoryId}
                  />
                )}
              </form.Subscribe>
            ) : null}

            {step === 1 ? (
              <ToolboxStep
                specialization={specialization}
                specializations={specializations}
                skills={skills}
                mcpServers={mcpServers}
                knowledgeSources={knowledgeSources}
                customSystemPrompt={customSystemPrompt}
                selectedSkillIds={selectedIds(selectedSkills)}
                selectedMcpServerIds={selectedIds(selectedMcps)}
                selectedKnowledgeSourceIds={selectedIds(
                  selectedKnowledgeSources,
                )}
                onCustomSystemPromptChange={(value) => {
                  setCustomSystemPrompt(value);
                  setSystemPrompt(value);
                  setInstructionsTouched(true);
                }}
                onSpecializationChange={requestSpecializationChange}
                onSystemPromptChange={(value) => {
                  setSystemPrompt(value);
                  setInstructionsTouched(true);
                }}
                systemPrompt={currentSystemPrompt}
                onSkillIdsChange={(ids) => {
                  setSelectedSkills(
                    updateCapabilitySelection(selectedSkills, ids),
                  );
                  setSkillsTouched(true);
                }}
                onMcpServerIdsChange={(ids) => {
                  setSelectedMcps(
                    updateCapabilitySelection(selectedMcps, ids),
                  );
                  setMcpsTouched(true);
                }}
                onKnowledgeSourceIdsChange={(ids) => {
                  setSelectedKnowledgeSources(
                    updateCapabilitySelection(selectedKnowledgeSources, ids),
                  );
                  setKnowledgeSourcesTouched(true);
                }}
              />
            ) : null}

            {step === 2 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-5" /> Security Boundaries
                  </CardTitle>
                  <CardDescription>
                    Set the access, execution, and model-routing boundaries for
                    this Instance.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <section
                    className="space-y-3"
                    aria-label="Access Policies"
                  >
                    <form.Field name="accessPolicyIds">
                      {(field) => {
                        const selectedIds = field.state.value;
                        const invalidIds = selectedIds.filter(
                          (id) =>
                            !accessPolicies.data?.some(
                              (policy) =>
                                policy.id === id && policy.status === "ACTIVE",
                            ),
                        );
                        const missingIds = selectedIds.filter(
                          (id) =>
                            !accessPolicies.data?.some(
                              (policy) => policy.id === id,
                            ),
                        );
                        const activeCount = (accessPolicies.data ?? []).filter(
                          (policy) => policy.status === "ACTIVE",
                        ).length;
                        return (
                          <div className="space-y-2">
                            <div className="flex flex-col gap-1 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <FieldLabel
                                htmlFor="instance-access-policies"
                                label="Access Policies"
                                tip="One or more active policies define the MCP tools this Instance may invoke. Deny overrides allow when policies overlap."
                              />
                              <Link
                                to="/$projectId/access-policies"
                                params={{ projectId }}
                                className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                              >
                                Manage Access Policies
                              </Link>
                            </div>
                            <MultiSelectCombobox
                              id="instance-access-policies"
                              ariaLabel="Select Access Policies"
                              value={selectedIds}
                              options={accessPolicyOptions}
                              maxSelected={64}
                              disabled={
                                accessPolicies.isPending ||
                                accessPolicies.isError ||
                                !activeCount
                              }
                              placeholder={
                                accessPolicies.isPending
                                  ? "Loading Access Policies…"
                                  : "Select one or more active policies…"
                              }
                              searchPlaceholder="Search Access Policies…"
                              emptyMessage="No Access Policies match"
                              onValueChange={(ids) => {
                                const values = {
                                  ...draftFormValues,
                                  accessPolicyIds: ids,
                                };
                                field.handleChange(ids);
                                setDraftFormValues(values);
                                persistDraftSnapshot(values);
                              }}
                            />
                            {accessPolicies.isError ? (
                              <div
                                className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
                                role="alert"
                              >
                                <p>{accessPolicies.error.message}</p>
                                <Button
                                  className="mt-2"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void accessPolicies.refetch()}
                                >
                                  Try again
                                </Button>
                              </div>
                            ) : !accessPolicies.isPending &&
                              !accessPolicies.data?.length ? (
                              <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                <Link
                                  to="/$projectId/access-policies"
                                  params={{ projectId }}
                                  className="font-semibold underline underline-offset-4"
                                >
                                  Create an Access Policy
                                </Link>{" "}
                                to continue.
                              </p>
                            ) : !accessPolicies.isPending && !activeCount ? (
                              <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                <Link
                                  to="/$projectId/access-policies"
                                  params={{ projectId }}
                                  className="font-semibold underline underline-offset-4"
                                >
                                  Activate an Access Policy
                                </Link>{" "}
                                to continue. Draft policies are not enforced.
                              </p>
                            ) : invalidIds.length ? (
                              <div
                                className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
                                role="alert"
                              >
                                <p>
                                  A selected policy is missing or no longer
                                  active. Remove it or choose an active
                                  replacement.
                                </p>
                                {missingIds.length ? (
                                  <Button
                                    type="button"
                                    className="mt-2"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const availableIds = selectedIds.filter(
                                        (id) => !missingIds.includes(id),
                                      );
                                      const values = {
                                        ...draftFormValues,
                                        accessPolicyIds: availableIds,
                                      };
                                      field.handleChange(availableIds);
                                      setDraftFormValues(values);
                                      persistDraftSnapshot(values);
                                    }}
                                  >
                                    Remove unavailable references (
                                    {missingIds.length})
                                  </Button>
                                ) : null}
                              </div>
                            ) : !selectedIds.length ? (
                              <p className="text-xs text-muted-foreground">
                                At least one active Access Policy is required.
                              </p>
                            ) : selectedIds.length >= 64 ? (
                              <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                Maximum of 64 Access Policies reached. Remove one
                                before selecting another.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {selectedIds.length} selected · conflicting
                                rules resolve to deny.
                              </p>
                            )}
                          </div>
                        );
                      }}
                    </form.Field>
                  </section>

                  <Separator />

                  <section
                    className="space-y-3"
                    aria-labelledby="works-on-heading"
                  >
                    <h3
                      id="works-on-heading"
                      className="flex items-center gap-2 text-sm font-semibold"
                    >
                      <Waypoints className="size-4" /> Execution
                    </h3>
                    <div className="space-y-5">
                      <form.Field name="policyId">
                        {(field) => (
                          <div className="space-y-2">
                            <div className="flex flex-col gap-1 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <FieldLabel
                                label="Sandbox Policy"
                                tip="Controls the files, commands, and network resources the Agent can access while it runs."
                              />
                              <Link
                                to="/$projectId/runtime-policies"
                                params={{ projectId }}
                                className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                              >
                                Manage Sandbox Policies
                              </Link>
                            </div>
                            <Select
                              value={field.state.value}
                              disabled={
                                policies.isPending || Boolean(policies.error)
                              }
                              onValueChange={(policyId) => {
                                const values = {
                                  ...draftFormValues,
                                  policyId,
                                };
                                field.handleChange(policyId);
                                setDraftFormValues(values);
                                persistDraftSnapshot(values);
                              }}
                            >
                              <SelectTrigger
                                aria-label="Sandbox Policy"
                                className="h-auto min-h-14 w-full"
                              >
                                <SelectValue
                                  placeholder={
                                    policies.isPending
                                      ? "Loading permissions…"
                                      : "Select a permission"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {policies.data?.policies.map((policy) => (
                                  <SelectItem key={policy.id} value={policy.id}>
                                    {policy.name} · {policy.networkAccess}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {policies.error ? (
                              <p
                                role="alert"
                                className="text-xs text-destructive"
                              >
                                {policies.error.message}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Controls the files, commands, and network
                                resources this Agent can access.
                              </p>
                            )}
                          </div>
                        )}
                      </form.Field>
                      <form.Field name="modelRoutingId">
                        {(field) => {
                          const selectedRouting = modelRoutings.data?.find(
                            (routing) => routing.id === field.state.value,
                          );
                          const hasReadyRouting = modelRoutings.data?.some(
                            (routing) => routing.status === "READY",
                          );
                          return (
                            <div className="space-y-2">
                              <div className="flex flex-col gap-1 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <FieldLabel
                                  htmlFor="instance-model-routing"
                                  label="Routing"
                                  tip="Select the LiteLLM-managed routing configuration for this Instance. The Project default is preselected when available."
                                />
                                <nav
                                  aria-label="Manage routing settings"
                                  className="flex flex-wrap items-center gap-x-5"
                                >
                                  <Link
                                    to="/$projectId/setting"
                                    params={{ projectId }}
                                    search={{ section: "models" }}
                                    className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                                  >
                                    Manage Models
                                  </Link>
                                  <Link
                                    to="/$projectId/setting"
                                    params={{ projectId }}
                                    search={{ section: "routing" }}
                                    className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                                  >
                                    Manage Routing
                                  </Link>
                                </nav>
                              </div>
                              <Select
                                value={field.state.value}
                                disabled={
                                  modelRoutings.isPending ||
                                  modelRoutings.isError ||
                                  !modelRoutings.data?.length
                                }
                                onValueChange={(modelRoutingId) => {
                                  const values = {
                                    ...draftFormValues,
                                    modelRoutingId,
                                  };
                                  field.handleChange(modelRoutingId);
                                  setDraftFormValues(values);
                                  persistDraftSnapshot(values);
                                }}
                              >
                                <SelectTrigger
                                  id="instance-model-routing"
                                  aria-label="Routing"
                                  className="h-auto min-h-14 w-full"
                                >
                                  <SelectValue
                                    placeholder={
                                      modelRoutings.isPending
                                        ? "Loading routing…"
                                        : "Select a ready routing"
                                    }
                                  >
                                    {selectedRouting ? (
                                      <ModelRoutingIdentity
                                        routing={selectedRouting}
                                      />
                                    ) : null}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {modelRoutings.data?.map((routing) => (
                                    <SelectItem
                                      key={routing.id}
                                      value={routing.id}
                                      disabled={routing.status !== "READY"}
                                      className="py-3"
                                    >
                                      <ModelRoutingIdentity
                                        routing={routing}
                                        showDescription
                                      />
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {modelRoutings.isError ? (
                                <div
                                  className="text-xs text-destructive"
                                  role="alert"
                                >
                                  <p>{modelRoutings.error.message}</p>
                                  <Button
                                    className="mt-2"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void modelRoutings.refetch()}
                                  >
                                    Try again
                                  </Button>
                                </div>
                              ) : !modelRoutings.isPending &&
                                !modelRoutings.data?.length ? (
                                <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                  Configure routing before creating an
                                  Instance.
                                </p>
                              ) : !modelRoutings.isPending &&
                                !hasReadyRouting ? (
                                <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                  No ready routing is available. Resolve
                                  validation before creating an Instance.
                                </p>
                              ) : selectedRouting?.status !== "READY" ? (
                                <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
                                  Select a ready routing to continue.
                                </p>
                              ) : (
                                <p
                                  aria-live="polite"
                                  className="text-xs text-muted-foreground"
                                >
                                  {selectedRouting.isDefault
                                    ? "Project default selected"
                                    : "Instance-specific override"}
                                  {" · "}an isolated LiteLLM key will be
                                  provisioned for this Instance.
                                </p>
                              )}
                            </div>
                          );
                        }}
                      </form.Field>
                    </div>
                    <form.Subscribe
                      selector={(state) => [
                        state.values.accessPolicyIds,
                        state.values.agentPlatform,
                        state.values.policyId,
                        state.values.modelRoutingId,
                      ]}
                    >
                      {([
                        accessPolicyIds,
                        agentPlatform,
                        policyId,
                        modelRoutingId,
                      ]) => {
                        const count = Array.isArray(accessPolicyIds)
                          ? accessPolicyIds.length
                          : 0;
                        const selectedRouting = modelRoutings.data?.find(
                          (routing) =>
                            routing.id === String(modelRoutingId),
                        );
                        return count && policyId ? (
                          <p className="border-l-2 border-primary bg-primary/5 px-3 py-2.5 text-xs leading-5">
                            <strong>
                              {
                                getAgentPlatformPresentation(
                                  agentPlatform as AgentPlatformId,
                                ).name
                              }
                            </strong>{" "}
                            uses{" "}
                            <strong>
                              {count} Access{" "}
                              {count === 1 ? "Policy" : "Policies"}
                            </strong>{" "}
                            inside the{" "}
                            <strong>{policyName(String(policyId))}</strong>{" "}
                            OpenShell boundary
                            {selectedRouting ? (
                              <>
                                , with inference routed through{" "}
                                <strong>{selectedRouting.name}</strong>
                              </>
                            ) : null}
                            .
                          </p>
                        ) : null;
                      }}
                    </form.Subscribe>
                  </section>
                </CardContent>
              </Card>
            ) : null}

            {step === 3 ? (
              <form.Subscribe selector={(state) => state.values}>
                {(values) => (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Check className="size-5" /> Review & Create
                      </CardTitle>
                      <CardDescription>
                        Confirm the deployment safeguards first, then review the
                        Agent definition and Toolbox.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-0">
                      <div className="pb-2">
                        <ReviewAssessment
                          accessPolicyNames={(accessPolicies.data ?? [])
                            .filter((policy) =>
                              values.accessPolicyIds.includes(policy.id),
                            )
                            .map((policy) => policy.name)}
                          incompleteMcpNames={incompleteMcps
                            .map((item) => item?.name)
                            .filter((name): name is string => Boolean(name))}
                        />
                      </div>

                      <ReviewGroup
                        title="Security Boundaries"
                        description="Execution, access, and inference controls applied to this Instance."
                      >
                        <dl className="grid gap-5 sm:grid-cols-3">
                          <ReviewFact
                            label="Sandbox Policy"
                            value={policyName(values.policyId)}
                          />
                          <ReviewFact
                            label="Routing"
                            value={
                              modelRoutings.data?.find(
                                (routing) =>
                                  routing.id === values.modelRoutingId,
                              )?.name ?? "Unavailable"
                            }
                          />
                          <ReviewFact
                            label="Access Policies"
                            value={
                              (accessPolicies.data ?? [])
                                .filter((policy) =>
                                  values.accessPolicyIds.includes(policy.id),
                                )
                                .map((policy) => policy.name)
                                .join(", ") || "Unavailable"
                            }
                          />
                        </dl>
                      </ReviewGroup>

                      <Separator />

                      <ReviewGroup
                        title="Agent Definition"
                        description="The reusable Agent definition, deployed Instance name, and Memory continuity."
                      >
                        <dl className="grid gap-5 sm:grid-cols-3">
                          <ReviewFact
                            label="Instance name"
                            value={values.name}
                          />
                          <ReviewFact
                            label="Agent definition"
                            value={
                              getAgentPlatformPresentation(values.agentPlatform)
                                .name
                            }
                          />
                          <ReviewFact
                            label="Memory"
                            value={
                              !durableMemoryEnabled
                                || !supportsDurableMemoryPlatform(values.agentPlatform)
                                ? "Workbench-managed"
                                : durableMemoryId
                                  ? `Continue · ${availableDurableMemories.find((item) => item.id === durableMemoryId)?.displayName ?? "Existing Memory"}`
                                  : "Durable Memory · automatic"
                            }
                          />
                        </dl>
                      </ReviewGroup>

                      <Separator />

                      <ReviewGroup
                        title="Toolbox"
                        description="Instructions, tools, and knowledge available to this Instance."
                      >
                        <dl className="mb-5 grid gap-5 border-b pb-5 sm:grid-cols-2">
                          <ReviewFact
                            label="Preset"
                            value={specialization.name}
                          />
                          <ReviewFact
                            label="Instructions"
                            value={
                              specialization.id === "custom" ||
                              currentSystemPrompt !== specialization.systemPrompt
                                ? "Customized for this Instance"
                                : "Using preset instructions"
                            }
                          />
                        </dl>
                        <div className="grid gap-5 md:grid-cols-3">
                          <ReviewSection
                            title={`Skills (${selectedSkills.length})`}
                          >
                            {selectedSkills.length ? (
                              selectedSkills.map((item) => (
                                <ReviewPill
                                  key={item.id}
                                  label={capabilityName(
                                    item.id,
                                    skills,
                                    mcpServers,
                                    knowledgeSources,
                                  )}
                                  source={item.source}
                                />
                              ))
                            ) : (
                              <EmptyReview label="No Skills selected" />
                            )}
                          </ReviewSection>
                          <ReviewSection
                            title={`MCP Servers (${selectedMcps.length})`}
                          >
                            {selectedMcps.length ? (
                              selectedMcps.map((item) => (
                                <ReviewPill
                                  key={item.id}
                                  label={capabilityName(
                                    item.id,
                                    skills,
                                    mcpServers,
                                    knowledgeSources,
                                  )}
                                  source={item.source}
                                />
                              ))
                            ) : (
                              <EmptyReview label="No MCP Servers selected" />
                            )}
                          </ReviewSection>
                          <ReviewSection
                            title={`Vector Databases (${selectedKnowledgeSources.length})`}
                          >
                            {selectedKnowledgeSources.length ? (
                              selectedKnowledgeSources.map((item) => (
                                <ReviewPill
                                  key={item.id}
                                  label={
                                    knowledgeSources.find(
                                      (source) => source.id === item.id,
                                    )?.name ?? item.id
                                  }
                                  source={item.source}
                                />
                              ))
                            ) : (
                              <EmptyReview label="No Vector Database selected" />
                            )}
                          </ReviewSection>
                        </div>
                      </ReviewGroup>

                    </CardContent>
                  </Card>
                )}
              </form.Subscribe>
            ) : null}

            {mutation.error ? (
              <p
                role="alert"
                className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {mutation.error.message}
              </p>
            ) : null}
          </form>
        </CreationFlow>
      </EntitySheet>
      {pendingSpecialization ? (
        <ChangeToolboxPresetDialog
          open
          add={pendingChange.add}
          keep={pendingChange.keep}
          remove={pendingChange.remove}
          fromName={specialization.name}
          toName={pendingSpecialization.name}
          instructionsCustomized={instructionsTouched}
          onCancel={() => setPendingSpecializationId(null)}
          onConfirm={() => applySpecialization(pendingSpecialization.id)}
        />
      ) : null}
    </>
  );
}

function FooterAction({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:items-end">
      {reason ? (
        <p
          id="create-instance-action-reason"
          role="status"
          className="max-w-sm text-xs leading-5 text-muted-foreground"
        >
          {reason}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function CreationReadinessNotice({
  accessPolicies,
  accessPoliciesError,
  accessPoliciesPending,
  modelRoutings,
  modelRoutingsError,
  modelRoutingsPending,
  onRetryAccessPolicies,
  onRetryModelRoutings,
  onRetryRuntimePolicies,
  projectId,
  runtimePolicies,
  runtimePoliciesError,
  runtimePoliciesPending,
}: {
  accessPolicies: readonly AccessPolicy[];
  accessPoliciesError: Error | null;
  accessPoliciesPending: boolean;
  modelRoutings: readonly ModelRouting[];
  modelRoutingsError: Error | null;
  modelRoutingsPending: boolean;
  onRetryAccessPolicies: () => void;
  onRetryModelRoutings: () => void;
  onRetryRuntimePolicies: () => void;
  projectId: string;
  runtimePolicies: readonly SandboxPolicy[];
  runtimePoliciesError: Error | null;
  runtimePoliciesPending: boolean;
}) {
  const pending = accessPoliciesPending
    || modelRoutingsPending
    || runtimePoliciesPending;
  const hasActiveAccessPolicy = accessPolicies.some(
    (policy) => policy.status === "ACTIVE",
  );
  const hasReadyRouting = modelRoutings.some(
    (routing) => routing.status === "READY",
  );
  const hasError = Boolean(
    accessPoliciesError || modelRoutingsError || runtimePoliciesError,
  );
  const hasMissingPrerequisite = !pending
    && (!hasActiveAccessPolicy || !runtimePolicies.length || !hasReadyRouting);

  if (!pending && !hasError && !hasMissingPrerequisite) return null;

  return (
    <section
      aria-labelledby="creation-readiness-heading"
      className="border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <h3 id="creation-readiness-heading" className="text-sm font-semibold">
            Creation readiness
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Resolve these Project prerequisites before the final review. Your
            draft stays in this browser tab if you leave to configure them.
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-5">
            {pending ? (
              <li role="status">Checking policies and routing…</li>
            ) : null}
            {accessPoliciesError ? (
              <li className="flex flex-wrap items-center gap-x-2">
                <span>Access Policies could not be loaded.</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                  onClick={onRetryAccessPolicies}
                >
                  Try again
                </Button>
              </li>
            ) : !accessPoliciesPending && !hasActiveAccessPolicy ? (
              <li>
                <Button
                  asChild
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                >
                  <Link to="/$projectId/access-policies" params={{ projectId }}>
                    Create or activate an Access Policy
                  </Link>
                </Button>
              </li>
            ) : null}
            {runtimePoliciesError ? (
              <li className="flex flex-wrap items-center gap-x-2">
                <span>Sandbox Policies could not be loaded.</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                  onClick={onRetryRuntimePolicies}
                >
                  Try again
                </Button>
              </li>
            ) : !runtimePoliciesPending && !runtimePolicies.length ? (
              <li>
                <Button
                  asChild
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                >
                  <Link to="/$projectId/runtime-policies" params={{ projectId }}>
                    Configure a Sandbox Policy
                  </Link>
                </Button>
              </li>
            ) : null}
            {modelRoutingsError ? (
              <li className="flex flex-wrap items-center gap-x-2">
                <span>Model Routing could not be loaded.</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                  onClick={onRetryModelRoutings}
                >
                  Try again
                </Button>
              </li>
            ) : !modelRoutingsPending && !hasReadyRouting ? (
              <li>
                <Button
                  asChild
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-current"
                >
                  <Link
                    to="/$projectId/setting"
                    params={{ projectId }}
                    search={{ section: "routing" }}
                  >
                    Configure a ready Model Routing
                  </Link>
                </Button>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ReviewGroup({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="py-6 first:pt-0">
      <div className="mb-5">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
    </div>
  );
}

function ReviewSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ReviewPill({
  label,
  source,
}: {
  label: string;
  source: SelectedCapability["source"];
}) {
  return (
    <span className="mb-1.5 mr-1.5 inline-flex min-h-8 items-center gap-2 rounded-sm border bg-muted/40 px-2.5 text-xs font-medium">
      {label}
      <span className="text-[10px] font-normal text-muted-foreground">
        {source === "specialization" ? "Preset" : "Added"}
      </span>
    </span>
  );
}

function EmptyReview({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground">{label}</p>;
}

function ModelRoutingIdentity({
  routing,
  showDescription = false,
}: {
  routing: ModelRouting;
  showDescription?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3 text-left">
      <span className="grid size-8 shrink-0 place-items-center rounded-sm border bg-muted/40 text-muted-foreground">
        <Waypoints className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <strong className="text-sm">{routing.name}</strong>
          {routing.isDefault ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Project default
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {routing.publicModelAlias} · {routing.status.replaceAll("_", " ")}
        </span>
        {showDescription && routing.description ? (
          <span className="mt-0.5 block max-w-lg truncate text-[11px] text-muted-foreground">
            {routing.description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function FieldLabel({
  htmlFor,
  label,
  tip,
}: {
  htmlFor?: string;
  label: string;
  tip: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <CircleHelp className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-72 leading-5"
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function ReviewAssessment({
  accessPolicyNames,
  incompleteMcpNames,
}: {
  accessPolicyNames: readonly string[];
  incompleteMcpNames: readonly string[];
}) {
  const warnings = [
    ...(!accessPolicyNames.length
      ? [
          "Select at least one active Access Policy before creating this Instance.",
        ]
      : []),
    ...(incompleteMcpNames.length
      ? [
          `Complete the connection or access request for ${incompleteMcpNames.join(", ")} before relying on those tools.`,
        ]
      : []),
  ];

  return (
    <section
      aria-labelledby="creation-assessment-heading"
      className={
        warnings.length
          ? "border border-amber-500/30 bg-amber-500/5 p-4"
          : "border border-emerald-500/30 bg-emerald-500/5 p-4"
      }
    >
      <div className="flex items-start gap-3">
        {warnings.length ? (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
        ) : (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        )}
        <div className="min-w-0">
          <h3
            id="creation-assessment-heading"
            className="text-sm font-semibold"
          >
            {warnings.length
              ? "Ready with attention required"
              : "Ready to create"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Required deployment controls are complete: Agent definition,
            Memory, Toolbox, Access Policies, Sandbox Policy, and Routing.
          </p>
          {accessPolicyNames.length ? (
            <p className="mt-2 text-xs leading-5">
              <span className="text-muted-foreground">
                Effective Access Policies:
              </span>{" "}
              <strong>{accessPolicyNames.join(", ")}</strong>
            </p>
          ) : null}
          {warnings.length ? (
            <ul className="mt-2 space-y-1 text-xs leading-5">
              {warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
