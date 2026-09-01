import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AccessPolicy,
  AccessPolicyDecision,
  CreateAccessPolicyInput,
  McpServerDefinition,
} from "@tali/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ServerCog, ShieldCheck } from "lucide-react";

import { EntitySheet } from "@/components/shared/entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Draft = {
  name: string;
  selectedServerIds: string[];
  defaults: Record<string, "ALLOW" | "DENY">;
  decisions: Record<string, AccessPolicyDecision>;
};

const emptyDraft: Draft = {
  name: "",
  selectedServerIds: [],
  defaults: {},
  decisions: {},
};

function toolKey(serverId: string, toolName: string): string {
  return `${serverId}\u0000${toolName}`;
}

function draftFor(policy?: AccessPolicy): Draft {
  if (!policy) return emptyDraft;
  return {
    name: policy.name,
    selectedServerIds: policy.serverRules.map((rule) => rule.mcpServerId),
    defaults: Object.fromEntries(
      policy.serverRules.map((rule) => [
        rule.mcpServerId,
        rule.defaultDecision,
      ]),
    ),
    decisions: Object.fromEntries(
      policy.serverRules.flatMap((rule) =>
        rule.tools.map((tool) => [
          toolKey(rule.mcpServerId, tool.toolName),
          tool.decision,
        ]),
      ),
    ),
  };
}

export function AccessPolicyEditorSheet({
  onOpenChange,
  open,
  policy,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  policy?: AccessPolicy;
}) {
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFor(policy));
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
    enabled: open,
  });
  useEffect(() => {
    if (open) {
      setDraft(draftFor(policy));
    }
  }, [open, policy]);

  const selectedServers = useMemo(
    () =>
      (catalog.data?.mcpServers ?? []).filter((server) =>
        draft.selectedServerIds.includes(server.id),
      ),
    [catalog.data, draft.selectedServerIds],
  );
  const mutation = useMutation({
    mutationFn: (status: "DRAFT" | "ACTIVE") => {
      const input: CreateAccessPolicyInput = {
        name: draft.name.trim(),
        status,
        serverRules: selectedServers.map((server) => ({
          mcpServerId: server.id,
          defaultDecision: draft.defaults[server.id] ?? "DENY",
          tools: server.tools.flatMap((tool) => {
            const decision =
              draft.decisions[toolKey(server.id, tool.name)] ?? "INHERIT";
            return decision === "INHERIT"
              ? []
              : [{ toolName: tool.name, decision }];
          }),
        })),
      };
      return policy
        ? api.updateAccessPolicy(policy.id, input)
        : api.createAccessPolicy(input);
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policies"),
        }),
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policy", saved.id),
        }),
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policy-versions", saved.id),
        }),
      ]);
      onOpenChange(false);
    },
  });

  const canSave =
    draft.name.trim().length >= 3 &&
    selectedServers.every((server) => server.tools.length > 0);

  function toggleServer(id: string) {
    setDraft((current) => ({
      ...current,
      selectedServerIds: current.selectedServerIds.includes(id)
        ? current.selectedServerIds.filter((value) => value !== id)
        : [...current.selectedServerIds, id],
      defaults: current.defaults[id]
        ? current.defaults
        : { ...current.defaults, [id]: "DENY" },
    }));
  }

  const loading = catalog.isLoading;
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      width="xl"
      eyebrow="Security"
      title={policy ? "Edit Access Policy" : "Create Access Policy"}
      description="Define reusable MCP authorization rules. Instances select one or more active policies directly."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={
                mutation.isPending || loading || catalog.isError || !canSave
              }
              onClick={() => mutation.mutate("DRAFT")}
            >
              Save as draft
            </Button>
            <Button
              disabled={
                mutation.isPending || loading || catalog.isError || !canSave
              }
              onClick={() => mutation.mutate("ACTIVE")}
            >
              <ShieldCheck />
              {mutation.isPending ? "Synchronizing…" : "Save & activate"}
            </Button>
          </div>
        </div>
      }
    >
      {catalog.isError ? (
        <div
          className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p>{catalog.error.message}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void catalog.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex min-h-72 items-center justify-center border text-sm text-muted-foreground">
          Loading discovered MCP tools…
        </div>
      ) : null}
      {!loading && !catalog.isError ? (
        <div className="space-y-8">
          <section
            aria-labelledby="permission-details-heading"
            className="space-y-5"
          >
            <div>
              <h2
                id="permission-details-heading"
                className="font-sans text-xl font-semibold"
              >
                Permission details
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Select discovered MCP tools, then choose whether each tool is
                allowed or denied.
              </p>
            </div>
            <Field htmlFor="access-policy-name" label="Policy name" required>
              <Input
                id="access-policy-name"
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Research read-only"
              />
            </Field>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">MCP servers</h3>
                <span className="text-xs text-muted-foreground">
                  {selectedServers.length} selected
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(catalog.data?.mcpServers ?? []).map((server) => (
                  <ChoiceCard
                    key={server.id}
                    checked={draft.selectedServerIds.includes(server.id)}
                    onChange={() => toggleServer(server.id)}
                    title={server.name}
                    description={`${server.tools.length} discovered tools · ${server.status}`}
                    icon={
                      server.logoUrl ? (
                        <img
                          src={server.logoUrl}
                          alt=""
                          className="size-7 object-contain"
                        />
                      ) : (
                        <ServerCog className="size-5" />
                      )
                    }
                    disabled={!server.tools.length}
                  />
                ))}
                {!catalog.data?.mcpServers.length ? (
                  <p className="border border-dashed p-6 text-sm text-muted-foreground sm:col-span-2">
                    No MCP Servers are registered. You can still save this
                    policy as a deny-all permission baseline and add tool rules
                    later.
                  </p>
                ) : null}
              </div>
            </div>
            {selectedServers.map((server) => (
              <ServerRules
                key={server.id}
                server={server}
                defaultDecision={draft.defaults[server.id] ?? "DENY"}
                decisions={draft.decisions}
                onDefaultChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    defaults: { ...current.defaults, [server.id]: value },
                  }))
                }
                onDecisionChange={(name, value) =>
                  setDraft((current) => ({
                    ...current,
                    decisions: {
                      ...current.decisions,
                      [toolKey(server.id, name)]: value,
                    },
                  }))
                }
              />
            ))}
            <p className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
              A policy with no MCP Server rules grants no MCP tool access. Deny
              takes precedence when multiple active policies apply.
            </p>
          </section>
        </div>
      ) : null}
      {mutation.error ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive"
        >
          {mutation.error.message}
        </p>
      ) : null}
    </EntitySheet>
  );
}

function ServerRules({
  defaultDecision,
  decisions,
  onDecisionChange,
  onDefaultChange,
  server,
}: {
  defaultDecision: "ALLOW" | "DENY";
  decisions: Record<string, AccessPolicyDecision>;
  onDecisionChange: (name: string, decision: AccessPolicyDecision) => void;
  onDefaultChange: (decision: "ALLOW" | "DENY") => void;
  server: McpServerDefinition;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-16 w-full items-center justify-between gap-4 border-b px-5 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            aria-label={`${open ? "Collapse" : "Expand"} permissions for ${server.name}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              {server.logoUrl ? (
                <img
                  src={server.logoUrl}
                  alt=""
                  className="size-6 shrink-0 object-contain"
                />
              ) : (
                <ServerCog className="size-5 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="truncate font-sans text-base font-semibold">
                    {server.name}
                  </strong>
                  <Badge variant="outline">{server.tools.length} tools</Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Default {defaultDecision.toLowerCase()} · explicit Tool
                  decisions override
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
              {open ? "Collapse" : "Expand"}
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  open && "rotate-180",
                )}
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-0">
            <div className="flex flex-col gap-3 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">
                Default for discovered tools
              </span>
              <Select
                value={defaultDecision}
                onValueChange={(value) =>
                  onDefaultChange(value as "ALLOW" | "DENY")
                }
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DENY">Deny</SelectItem>
                  <SelectItem value="ALLOW">Allow</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="divide-y">
              {server.tools.map((tool) => (
                <div
                  key={tool.name}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">
                      {tool.title ?? tool.name}
                    </strong>
                    <code className="text-[11px] text-muted-foreground">
                      {tool.name}
                    </code>
                    {tool.description ? (
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {tool.description}
                      </span>
                    ) : null}
                  </span>
                  <Select
                    value={
                      decisions[toolKey(server.id, tool.name)] ?? "INHERIT"
                    }
                    onValueChange={(value) =>
                      onDecisionChange(tool.name, value as AccessPolicyDecision)
                    }
                  >
                    <SelectTrigger aria-label={`Decision for ${tool.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INHERIT">Inherit default</SelectItem>
                      <SelectItem value="ALLOW">Allow</SelectItem>
                      <SelectItem value="DENY">Deny</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function ChoiceCard({
  checked,
  description,
  disabled,
  icon,
  onChange,
  title,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  onChange: () => void;
  title: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 border p-4 transition-colors",
        checked && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-4 accent-primary"
      />
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span className="min-w-0">
        <strong className="block truncate text-sm">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

function Field({ children, htmlFor, label, required = false }: { children: ReactNode; htmlFor?: string; label: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} required={required}>{label}</Label>
      {children}
    </div>
  );
}
