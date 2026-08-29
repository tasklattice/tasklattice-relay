import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  type AgentPlatformId,
  type KnowledgeSourceDefinition,
  type McpServerDefinition,
  type MemoryResourceView,
  type SkillDefinition,
} from "@tali/contracts";
import { useTranslation } from "react-i18next";
import {
  BookOpenText,
  Boxes,
  ChevronDown,
  CircleHelp,
  Info,
  Network,
  Pencil,
  Plus,
  ServerCog,
  X,
} from "lucide-react";
import { AgentSelect } from "@/components/agents/agent-select";
import { EmbeddingModelSetupNotice } from "@/components/providers/embedding-model-setup-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentProjectId } from "@/hooks/use-project";
import { cn } from "@/lib/utils";
import { SpecializationIcon } from "./specialization-selector";
import type { Specialization, SpecializationId } from "./specializations";
import { SystemPromptViewer } from "./system-prompt-viewer";

export function AgentFoundationStep({
  agentPlatform,
  durableMemories,
  durableMemoriesLoading,
  durableMemoryAvailable,
  durableMemoryFeatureEnabled,
  durableMemoryId,
  embeddingModelsError,
  embeddingModelsPending,
  canManageProject,
  name,
  onAgentPlatformChange,
  onDurableMemoryIdChange,
  onNameChange,
}: {
  agentPlatform: AgentPlatformId;
  durableMemories: readonly MemoryResourceView[];
  durableMemoriesLoading: boolean;
  durableMemoryAvailable: boolean;
  durableMemoryFeatureEnabled: boolean;
  durableMemoryId: string;
  embeddingModelsError: Error | null | undefined;
  embeddingModelsPending: boolean;
  canManageProject: boolean;
  name: string;
  onAgentPlatformChange: (value: AgentPlatformId) => void;
  onDurableMemoryIdChange: (memoryId: string) => void;
  onNameChange: (value: string) => void;
}) {
  const projectId = useCurrentProjectId();
  const { t } = useTranslation("createInstance");

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{t("agentFoundation.title")}</CardTitle>
        <CardDescription>{t("agentFoundation.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Instance name</Label>
          <div className="relative">
            <Input
              id="agent-name"
              required
              maxLength={64}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="e.g. mobile-security-research"
              className="h-12 pr-16"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {name.length}/64
            </span>
          </div>
          {name.length > 0 && name.trim().length < 3 ? (
            <p role="alert" className="text-xs text-destructive">
              Use at least 3 characters.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Required · 3–64 characters
            </p>
          )}
        </div>

        <div className="space-y-2 border-t pt-5">
          <Label htmlFor="instance-agent">Agent definition</Label>
          <AgentSelect
            id="instance-agent"
            value={agentPlatform}
            onValueChange={onAgentPlatformChange}
          />
        </div>

        <div className="border-t pt-5">
          <MemoryCapabilityRow
            agentPlatform={agentPlatform}
            durableMemories={durableMemories}
            durableMemoriesLoading={durableMemoriesLoading}
            durableMemoryAvailable={durableMemoryAvailable}
            durableMemoryFeatureEnabled={durableMemoryFeatureEnabled}
            durableMemoryId={durableMemoryId}
            embeddingModelsError={embeddingModelsError}
            embeddingModelsPending={embeddingModelsPending}
            canManageProject={canManageProject}
            onDurableMemoryIdChange={onDurableMemoryIdChange}
            projectId={projectId}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function skillOption(skill: SkillDefinition): MultiSelectOption {
  return {
    value: skill.id,
    label: skill.name,
    description: skill.description,
    meta: `${skill.category} · v${skill.version}`,
  };
}

function mcpStatus(server: McpServerDefinition): string {
  if (server.status === "HEALTHY") return "Connected";
  if (server.status === "PERMISSION_REQUIRED") return "Permission required";
  if (server.status === "UNAVAILABLE") return "Unavailable";
  return "Not connected";
}

function mcpStatusTone(
  server: McpServerDefinition,
): "danger" | "neutral" | "success" | "warning" {
  if (server.status === "HEALTHY") return "success";
  if (server.status === "PERMISSION_REQUIRED") return "warning";
  if (server.status === "UNAVAILABLE") return "danger";
  return "neutral";
}

export function ToolboxStep({
  canManageProject,
  customSystemPrompt,
  embeddingModelReady,
  embeddingModelsError,
  embeddingModelsPending,
  knowledgeSources,
  mcpServers,
  onCustomSystemPromptChange,
  onKnowledgeSourceIdsChange,
  onMcpServerIdsChange,
  onSkillIdsChange,
  onSpecializationChange,
  onSystemPromptChange,
  selectedKnowledgeSourceIds,
  selectedMcpServerIds,
  selectedSkillIds,
  skills,
  specialization,
  specializations,
  systemPrompt,
}: {
  canManageProject: boolean;
  customSystemPrompt: string;
  embeddingModelReady: boolean;
  embeddingModelsError: Error | null | undefined;
  embeddingModelsPending: boolean;
  knowledgeSources: readonly KnowledgeSourceDefinition[];
  mcpServers: readonly McpServerDefinition[];
  onCustomSystemPromptChange: (value: string) => void;
  onKnowledgeSourceIdsChange: (ids: string[]) => void;
  onMcpServerIdsChange: (ids: string[]) => void;
  onSkillIdsChange: (ids: string[]) => void;
  onSpecializationChange: (id: SpecializationId) => void;
  onSystemPromptChange: (value: string) => void;
  selectedKnowledgeSourceIds: readonly string[];
  selectedMcpServerIds: readonly string[];
  selectedSkillIds: readonly string[];
  skills: readonly SkillDefinition[];
  specialization: Specialization;
  specializations: readonly Specialization[];
  systemPrompt: string;
}) {
  const projectId = useCurrentProjectId();
  const { t } = useTranslation("createInstance");
  const [promptOpen, setPromptOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const skillOptions = skills
    .filter((skill) => skill.status === "PUBLISHED")
    .map(skillOption);
  const mcpOptions: MultiSelectOption[] = mcpServers.map((server) => ({
    value: server.id,
    label: server.name,
    description: `${server.transport} · ${server.tools.length} tools`,
    meta: mcpStatus(server),
    metaTone: mcpStatusTone(server),
    disabled: server.status === "UNAVAILABLE",
  }));
  const knowledgeOptions: MultiSelectOption[] = knowledgeSources.map((source) => ({
    value: source.id,
    label: source.name,
    description: source.description,
    meta: source.status === "REGISTERED"
      ? source.provider.toUpperCase()
      : "Unavailable",
    metaTone: source.status === "REGISTERED" ? "success" : "neutral",
    disabled: !embeddingModelReady || source.status === "UNAVAILABLE",
  }));
  const incompleteMcpServers = selectedMcpServerIds
    .map((id) => mcpServers.find((item) => item.id === id))
    .filter(
      (item): item is McpServerDefinition =>
        Boolean(item && item.status !== "HEALTHY"),
    );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("toolbox.title")}</CardTitle>
          <CardDescription>{t("toolbox.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="toolbox-preset">Toolbox preset</Label>
            <Select
              value={specialization.id}
              onValueChange={(id) => onSpecializationChange(id as SpecializationId)}
            >
              <SelectTrigger
                id="toolbox-preset"
                className="h-auto min-h-14 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {specializations.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="py-3">
                    <span className="flex items-center gap-2">
                      <SpecializationIcon specialization={item} />
                      <span>{item.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">
              {specialization.description}
            </p>
            <p className="text-xs font-medium text-primary">
              {selectedSkillIds.length} Skills · {selectedMcpServerIds.length} MCP Servers · {selectedKnowledgeSourceIds.length} Vector Databases
            </p>
          </div>

          {specialization.id === "custom" ? (
            <div className="space-y-2 border-t pt-5">
              <Label htmlFor="custom-system-prompt">Instructions</Label>
              <Textarea
                id="custom-system-prompt"
                rows={5}
                maxLength={8000}
                value={customSystemPrompt}
                onChange={(event) => onCustomSystemPromptChange(event.target.value)}
                placeholder="Define how this Agent should behave, what evidence it should use, and when it should escalate."
              />
              <div className="flex items-center justify-between gap-3 text-xs">
                <span
                  className={
                    customSystemPrompt.trim().length < 10
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  Instructions require at least 10 characters.
                </span>
                <span className="text-muted-foreground">
                  {customSystemPrompt.length}/8000
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" />
                This preset supplies starting instructions and recommended tools. You can customize both for this Instance.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPromptOpen(true)}
              >
                <Pencil /> Edit instructions
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <CardTitle>Tools and knowledge</CardTitle>
              <p className="text-xs text-muted-foreground">
                {specialization.id === "general-purpose" || specialization.id === "custom"
                  ? "Add the capabilities required for this work."
                  : `${specialization.name} supplies recommended starting capabilities. You can adjust any item.`}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Plus /> Edit toolbox <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setSkillsOpen(true)}>
                  <Boxes /> Skills
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMcpOpen(true)}>
                  <ServerCog /> MCP Servers
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!embeddingModelReady}
                  onSelect={() => setKnowledgeOpen(true)}
                >
                  <BookOpenText /> Vector Databases
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <CapabilityRow
            icon={<Boxes className="size-4" />}
            title="Skills"
            description="Reusable capability packages available to this Agent."
            open={skillsOpen}
            onOpenChange={setSkillsOpen}
            options={skillOptions}
            selectedIds={selectedSkillIds}
            onChange={onSkillIdsChange}
          />
          <CapabilityRow
            icon={<ServerCog className="size-4" />}
            title="MCP Servers"
            description="Connected tools and external systems available to this Agent."
            open={mcpOpen}
            onOpenChange={setMcpOpen}
            options={mcpOptions}
            selectedIds={selectedMcpServerIds}
            onChange={onMcpServerIdsChange}
            footer={
              incompleteMcpServers.length ? (
                <p
                  role="alert"
                  className="flex flex-wrap items-center gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
                >
                  <Info className="size-4" />
                  {incompleteMcpServers.map((item) => item.name).join(", ")} requires connection or access before this Instance is ready.
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 p-0 text-current"
                  >
                    <Link to="/$projectId/mcp-servers" params={{ projectId }}>
                      Connect or request access
                    </Link>
                  </Button>
                </p>
              ) : undefined
            }
          />
          <CapabilityRow
            icon={<Network className="size-4" />}
            title="Vector Databases"
            description="Approved sources the Agent can search for grounded answers."
            open={knowledgeOpen}
            onOpenChange={setKnowledgeOpen}
            options={knowledgeOptions}
            selectedIds={selectedKnowledgeSourceIds}
            onChange={onKnowledgeSourceIdsChange}
            footer={
              embeddingModelsPending ? (
                <p className="text-xs text-muted-foreground">
                  Checking Project embedding model availability…
                </p>
              ) : embeddingModelsError ? (
                <p role="alert" className="text-xs text-destructive">
                  Embedding model availability could not be checked: {embeddingModelsError.message}
                </p>
              ) : !embeddingModelReady ? (
                <EmbeddingModelSetupNotice
                  canManageProject={canManageProject}
                  className="mt-2"
                  projectId={projectId}
                />
              ) : undefined
            }
          />
        </CardContent>
      </Card>

      {specialization.id !== "custom" ? (
        <SystemPromptViewer
          defaultPrompt={specialization.systemPrompt}
          open={promptOpen}
          onApply={onSystemPromptChange}
          onOpenChange={setPromptOpen}
          presetName={specialization.name}
          prompt={systemPrompt}
        />
      ) : null}
    </div>
  );
}

function MemoryCapabilityRow({
  agentPlatform,
  durableMemories,
  durableMemoriesLoading,
  durableMemoryAvailable,
  durableMemoryFeatureEnabled,
  durableMemoryId,
  embeddingModelsError,
  embeddingModelsPending,
  canManageProject,
  onDurableMemoryIdChange,
  projectId,
}: {
  agentPlatform: AgentPlatformId;
  durableMemories: readonly MemoryResourceView[];
  durableMemoriesLoading: boolean;
  durableMemoryAvailable: boolean;
  durableMemoryFeatureEnabled: boolean;
  durableMemoryId: string;
  embeddingModelsError: Error | null | undefined;
  embeddingModelsPending: boolean;
  canManageProject: boolean;
  onDurableMemoryIdChange: (memoryId: string) => void;
  projectId: string;
}) {
  const supportsNative = agentPlatform === "openclaw" || agentPlatform === "hermes";
  const supportsDurable = durableMemoryAvailable && supportsNative;
  const newMemoryValue = "new-memory";
  const sourceValue = durableMemoryId || newMemoryValue;

  return (
    <section aria-labelledby="agent-memory-title" className="rounded-md border p-4">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h3 id="agent-memory-title" className="text-sm font-semibold">Memory</h3>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground">
                <CircleHelp className="size-4" /> Tips
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(90vw,22rem)] p-4">
              <h4 className="text-sm font-semibold">Memory tips</h4>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {supportsDurable
                  ? "Economy uses the Project's managed low-cost Memory defaults. A new Memory is prepared automatically unless you select an existing one."
                  : "Native Memory stores text inside this Instance's Sandbox and does not require an embedding model."}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {supportsDurable
                  ? "Durable Memory remains available after Instance deletion and can be attached to another supported Instance."
                  : "Native Memory is deleted with the Instance and cannot be attached to a replacement Agent."}
              </p>
              {supportsDurable ? (
                <Button asChild variant="link" size="sm" className="mt-2 h-auto min-h-0 p-0">
                  <Link to="/$projectId/memory" params={{ projectId }}>Manage Memory</Link>
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
        <Badge variant={supportsDurable ? "secondary" : "outline"} className="font-normal">
          {supportsDurable ? "Durable" : supportsNative ? "Native" : "Not available"}
        </Badge>
      </div>

      {supportsDurable ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="durable-memory-selection">Memory source</Label>
            <Select
              value={sourceValue}
              onValueChange={(value) => onDurableMemoryIdChange(value === newMemoryValue ? "" : value)}
              disabled={durableMemoriesLoading}
            >
              <SelectTrigger id="durable-memory-selection" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={newMemoryValue}>New Memory · automatic</SelectItem>
                {durableMemories.map((item) => {
                  const inUse = Boolean(item.activeBinding);

                  return (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      disabled={inUse}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.displayName}
                      </span>
                      <Badge
                        variant="outline"
                        className="ml-auto shrink-0 font-normal"
                      >
                        {inUse ? "In use · detach first" : "Available"}
                      </Badge>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Capture policy</Label>
            <div
              aria-label="Economy capture policy, lowest cost"
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-muted/10 px-3"
            >
              <span className="text-sm font-medium">Economy</span>
              <Badge variant="outline" className="font-normal">Lowest cost</Badge>
            </div>
          </div>
        </div>
      ) : supportsNative ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">
            This Agent will use built-in Native text Memory inside its Sandbox.
            Native Memory is removed with the Instance and cannot be reattached.
          </p>
          {embeddingModelsPending ? (
            <p className="text-xs text-muted-foreground">Checking Project embedding models…</p>
          ) : embeddingModelsError ? (
            <p role="alert" className="text-xs text-destructive">
              Embedding readiness could not be checked: {embeddingModelsError.message}
            </p>
          ) : durableMemoryFeatureEnabled ? (
            <EmbeddingModelSetupNotice
              canManageProject={canManageProject}
              className="mt-3"
              projectId={projectId}
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Memory is not available for this Agent definition.
        </p>
      )}
    </section>
  );
}

function CapabilityRow({
  description,
  footer,
  icon,
  onChange,
  onOpenChange,
  open,
  options,
  selectedIds,
  title,
}: {
  description: string;
  footer?: ReactNode;
  icon: ReactNode;
  onChange: (ids: string[]) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  options: readonly MultiSelectOption[];
  selectedIds: readonly string[];
  title: string;
}) {
  const selected = selectedIds
    .map((id) => options.find((option) => option.value === id))
    .filter((option): option is MultiSelectOption => Boolean(option));
  const resolvedSelectedIds = selected.map((option) => option.value);
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-md border"
    >
      <div className="flex min-h-20 items-start gap-3 px-4 py-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <Badge variant="outline" className="font-normal">
              {selected.length} selected
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          {selected.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15"
                  onClick={() =>
                    onChange(
                      resolvedSelectedIds.filter((id) => id !== option.value),
                    )
                  }
                >
                  {option.label}
                  <X className="size-3" />
                  <span className="sr-only">Remove</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">None selected</p>
          )}
        </div>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          >
            <ChevronDown
              className={cn(
                "transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-t bg-muted/10 p-4">
        <MultiSelectCombobox
          ariaLabel={`Select ${title}`}
          emptyMessage={`No ${title.toLowerCase()} match`}
          noOptionsMessage={`No ${title} are available in this Project.`}
          onValueChange={onChange}
          options={options}
          placeholder={`Select ${title.toLowerCase()}…`}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          value={resolvedSelectedIds}
        />
        {footer ? <div className="mt-3">{footer}</div> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
