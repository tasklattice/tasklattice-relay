import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  createMcpServerDefinitionSchema,
  type CreateMcpServerDefinitionInput,
  type McpServerDefinition,
  type McpServerTemplate,
} from "@tali/contracts";
import {
  Activity,
  Braces,
  ChevronRight,
  CircleGauge,
  LockKeyhole,
  Pencil,
  Plus,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { McpTemplateCatalog } from "@/components/mcp/mcp-template-catalog";
import { McpBrandIcon, resolveMcpServerBrand } from "@/components/mcp/mcp-brand-icon";
import { McpToolList } from "@/components/mcp/mcp-tool-list";
import { EntityDetailList, EntitySheet } from "@/components/shared/entity-sheet";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { formatPlatformDateTime } from "@/lib/platform-preferences";

export const Route = createFileRoute("/$projectId/mcp-servers")({ component: McpServers });

const emptyDraft: CreateMcpServerDefinitionInput = {
  name: "",
  alias: "",
  description: "",
  category: "Custom",
  transport: "http",
  endpoint: "",
  args: [],
  environment: [],
  authType: "none",
  authReference: "",
  accessGroups: [],
  allowedTools: [],
  readOnlyTools: [],
  extraHeaders: [],
  staticHeaders: [],
  internalNetworkOnly: false,
};

function editableServer(server: McpServerDefinition): CreateMcpServerDefinitionInput {
  const {
    id: _id,
    litellmServerId: _litellmServerId,
    status: _status,
    tools: _tools,
    lastDiscoveryAttemptAt: _lastDiscoveryAttemptAt,
    lastDiscoveredAt: _lastDiscoveredAt,
    lastDiscoveryError: _lastDiscoveryError,
    ...input
  } = server;
  return input;
}

function draftFromTemplate(template: McpServerTemplate): CreateMcpServerDefinitionInput {
  return {
    ...emptyDraft,
    templateId: template.id,
    name: template.name,
    alias: template.id.replace(/[^a-zA-Z0-9_]/g, "_"),
    description: template.description,
    category: template.category,
    sourceUrl: template.sourceUrl,
    transport: template.transport,
    ...(template.endpointPlaceholder ? { endpoint: template.endpointPlaceholder } : {}),
    ...(template.command ? { command: template.command } : {}),
    args: template.args,
    authType: template.defaultAuthType,
    ...(template.defaultAuthType === "oauth2"
      ? {
          oauth: {
            flow: "authorization_code" as const,
          },
        }
      : {}),
  };
}

function McpServers() {
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const catalog = useQuery({ queryKey: scope.key("resource-catalog"), queryFn: api.getResourceCatalog });
  const items = catalog.data?.mcpServers ?? [];
  const templates = catalog.data?.mcpServerTemplates ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateMcpServerDefinitionInput>(emptyDraft);
  const stdioAllowed = templates.some((template) =>
    template.id === draft.templateId && template.transport === "stdio");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = items.find((item) => item.id === selectedId);

  const saveServer = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateMcpServerDefinitionInput }) =>
      id ? api.updateMcpServer(id, input) : api.createMcpServer(input),
    onSuccess: async (server) => {
      setSelectedId(server.id);
      setFormOpen(false);
      setFormError("");
      setDetailOpen(true);
      setNotice(server.status === "HEALTHY"
        ? `LiteLLM registration completed. ${server.tools.length} tools were discovered and bound to this Project.`
        : `The desired configuration was saved, but LiteLLM reconciliation needs attention: ${server.lastDiscoveryError ?? server.status}.`);
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
    },
  });
  const checkServer = useMutation({
    mutationFn: (server: McpServerDefinition) => api.discoverMcpServer(server.id),
    onSuccess: async (server) => {
      setNotice(server.status === "HEALTHY"
        ? `LiteLLM discovery completed. ${server.tools.length} tools are ready for Access Policies.`
        : `Discovery failed: ${server.lastDiscoveryError ?? server.status}.`);
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
    },
  });
  const deleteServer = useMutation({
    mutationFn: (id: string) => api.deleteResource("mcp-servers", id),
    onSuccess: async () => {
      setDeleteOpen(false);
      setDetailOpen(false);
      setSelectedId("");
      setNotice("MCP Server, its Project permission binding, and its local tool snapshot were removed.");
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
    },
  });

  const openForm = (item?: McpServerDefinition, template?: McpServerTemplate) => {
    saveServer.reset();
    setDetailOpen(false);
    setCatalogOpen(false);
    setFormOpen(true);
    setEditingId(item?.id ?? null);
    setDraft(item ? editableServer(item) : template ? draftFromTemplate(template) : emptyDraft);
    setFormError("");
    setNotice("");
  };
  const save = () => {
    const oauth = draft.oauth ? {
      ...draft.oauth,
      authorizationUrl: draft.oauth.authorizationUrl || undefined,
      tokenUrl: draft.oauth.tokenUrl || undefined,
      registrationUrl: draft.oauth.registrationUrl || undefined,
    } : undefined;
    const parsed = createMcpServerDefinitionSchema.safeParse({
      ...draft,
      endpoint: draft.endpoint || undefined,
      specPath: draft.specPath || undefined,
      command: draft.command || undefined,
      logoUrl: draft.logoUrl || undefined,
      sourceUrl: draft.sourceUrl || undefined,
      oauth,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Review the MCP configuration.");
      return;
    }
    setFormError("");
    saveServer.mutate({
      ...(editingId ? { id: editingId } : {}),
      input: parsed.data,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="MCP Servers"
        description="Project-isolated MCP connections, tools, and LiteLLM access controls."
        actions={<Button className="h-11" onClick={() => setCatalogOpen(true)}><Plus /> Register MCP</Button>}
      />
      {catalog.isPending ? <p className="border p-4 text-sm text-muted-foreground">Loading MCP servers from PostgreSQL and LiteLLM…</p> : null}
      {catalog.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive">{catalog.error.message}</p> : null}
      {checkServer.error || deleteServer.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive">{(checkServer.error ?? deleteServer.error)?.message}</p> : null}
      {notice ? <p role="status" className="border-l-2 border-primary bg-muted/40 px-4 py-3 text-sm">{notice}</p> : null}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Registered servers</CardTitle>
          <CardDescription>{items.length} Project-owned LiteLLM MCP integrations.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {items.length ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                checkServer.reset();
                deleteServer.reset();
                setSelectedId(item.id);
                setDetailOpen(true);
                setNotice("");
              }}
              className="grid min-h-24 w-full gap-3 border-b px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[minmax(0,1fr)_150px_120px_auto] sm:items-center"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-card shadow-xs">
                  <McpBrandIcon
                    brand={resolveMcpServerBrand(item, templates)}
                    className="size-6"
                    logoUrl={item.logoUrl}
                  />
                </span>
                <span className="min-w-0">
                  <strong className="block">{item.name}</strong>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{item.endpoint ?? `${item.command} ${item.args.join(" ")}`}</span>
                </span>
              </span>
              <span className="text-xs"><span className="block text-muted-foreground">Category</span><strong className="mt-1 block">{item.category}</strong></span>
              <span className="text-xs"><span className="block text-muted-foreground">Tools</span><strong className="mt-1 block">{item.tools.length}</strong></span>
              <StatusDot label={item.status} tone={item.status === "HEALTHY" ? "success" : item.status === "UNAVAILABLE" ? "danger" : "neutral"} />
            </button>
          )) : (
            <div className="px-6 py-16 text-center">
              <ServerCog className="mx-auto size-6 text-muted-foreground" />
              <strong className="mt-3 block">No MCP servers</strong>
              <p className="mt-1 text-xs text-muted-foreground">Choose a built-in integration or register a custom server.</p>
              <Button className="mt-5" variant="outline" onClick={() => setCatalogOpen(true)}>Browse integrations <ChevronRight /></Button>
            </div>
          )}
        </CardContent>
      </Card>

      <EntitySheet
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        eyebrow="MCP Catalog"
        title="Add MCP Server"
        description="Start from a reviewed integration or define a custom LiteLLM MCP Server."
        width="xl"
        footer={<Button variant="outline" onClick={() => setCatalogOpen(false)}>Cancel</Button>}
      >
        <McpTemplateCatalog templates={templates} onCustom={() => openForm()} onSelect={(template) => openForm(undefined, template)} />
      </EntitySheet>

      <EntitySheet
        open={detailOpen && Boolean(selected)}
        onOpenChange={setDetailOpen}
        eyebrow="MCP Server"
        title={selected?.name ?? "MCP server details"}
        description="Connection health, discovered tools, and effective Project access."
        width="lg"
        footer={(
          <>
            <Button variant="destructive" disabled={deleteServer.isPending} onClick={() => { deleteServer.reset(); setDetailOpen(false); setDeleteOpen(true); }}>
              <Trash2 />Remove MCP
            </Button>
            <Button variant="outline" onClick={() => selected && openForm(selected)}><Pencil /> Update configuration</Button>
            <Button disabled={checkServer.isPending} onClick={() => selected && checkServer.mutate(selected)}>
              <Activity />{checkServer.isPending ? "Discovering…" : "Refresh tools"}
            </Button>
          </>
        )}
      >
        {selected ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <StatusDot label={selected.status} tone={selected.status === "HEALTHY" ? "success" : selected.status === "PERMISSION_REQUIRED" ? "warning" : selected.status === "UNAVAILABLE" ? "danger" : "neutral"} />
              <span className="text-xs text-muted-foreground">{selected.tools.length} discovered tools</span>
            </div>
            <EntityDetailList items={[
              { label: "LiteLLM Server ID", value: selected.litellmServerId, mono: true },
              { label: "Connection", value: selected.endpoint ?? `${selected.command} ${selected.args.join(" ")}`, mono: true },
              { label: "Transport", value: selected.transport.toUpperCase() },
              { label: "Authentication", value: selected.authType === "none" ? "None" : `${selected.authType} via Secret reference` },
              { label: "Project boundary", value: "Current LiteLLM Team only" },
              { label: "Last discovered", value: selected.lastDiscoveredAt ? formatPlatformDateTime(selected.lastDiscoveredAt) : "Never" },
            ]} />
            <section className="border bg-muted/25 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Permission Management / Access Control</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Public key access is always disabled. The Project Team is the ceiling; each Instance Key is restricted again to its explicitly assigned Servers and Tools.</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {(selected.accessGroups.length ? selected.accessGroups : ["No access groups"]).map((group) => <span key={group} className="border bg-background px-2 py-1">{group}</span>)}
                    {selected.internalNetworkOnly ? <span className="border bg-background px-2 py-1">Internal network only</span> : null}
                  </div>
                </div>
              </div>
            </section>
            {selected.lastDiscoveryError ? (
              <p role="alert" className="border-l-2 border-amber-500 bg-amber-500/5 p-3 text-sm leading-5">
                <strong className="block text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">Latest reconciliation failed</strong>
                <span className="mt-1 block text-muted-foreground">{selected.lastDiscoveryError}</span>
              </p>
            ) : null}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-semibold"><Braces className="size-4" /> Discovered tools</p>
                <span className="text-xs text-muted-foreground">{selected.tools.length} total</span>
              </div>
              <McpToolList tools={selected.tools} />
            </section>
            {notice ? <p role="status" className="border-l-2 border-primary bg-primary/5 p-3 text-sm">{notice}</p> : null}
          </div>
        ) : null}
      </EntitySheet>

      {selected ? (
        <DeleteEntitySheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete MCP Server"
          description={<>Remove <strong>{selected.name}</strong> from this Project.</>}
          entityName={selected.name}
          confirmLabel="Delete MCP"
          deleting={deleteServer.isPending}
          onConfirm={() => deleteServer.mutate(selected.id)}
          {...(deleteServer.error instanceof Error ? { error: deleteServer.error.message } : {})}
          impactDescription="The MCP Server disappears from this Project. Its LiteLLM registration and Project access are permanently removed."
        />
      ) : null}

      <EntitySheet
        open={formOpen}
        onOpenChange={(open) => {
          if (!saveServer.isPending) {
            setFormOpen(open);
            if (!open) {
              setFormError("");
              saveServer.reset();
            }
          }
        }}
        eyebrow="MCP Server"
        title={editingId ? "Update MCP Server" : `Register ${draft.name || "MCP Server"}`}
        description="TaskLattice Relay stores desired state and Secret references; LiteLLM owns the connection and tool execution."
        width="xl"
        footer={(
          <>
            <Button variant="outline" disabled={saveServer.isPending} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="mcp-server-form" disabled={saveServer.isPending}>{saveServer.isPending ? "Reconciling…" : editingId ? "Save & discover" : "Register & discover"}</Button>
          </>
        )}
      >
        <form id="mcp-server-form" className="space-y-7" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <FormSection icon={ServerCog} title="Identity" description="How administrators and Agents recognize this integration.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" id="mcp-name" required><Input id="mcp-name" className="h-11" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="GitHub" autoFocus /></Field>
              <Field label="Tool prefix / alias" id="mcp-alias" required><Input id="mcp-alias" className="h-11 font-mono" required value={draft.alias} onChange={(event) => setDraft({ ...draft, alias: event.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} placeholder="github" /></Field>
            </div>
            <Field label="Description" id="mcp-description" required><Textarea id="mcp-description" required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
          </FormSection>

          <FormSection icon={CircleGauge} title="Connection" description="LiteLLM supports Streamable HTTP, SSE, stdio, and OpenAPI-backed tools.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Transport" id="mcp-transport" required>
                <select id="mcp-transport" required className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as CreateMcpServerDefinitionInput["transport"] })}>
                  <option value="http">Streamable HTTP (recommended)</option>
                  <option value="sse">Server-Sent Events (SSE)</option>
                  <option value="stdio" disabled={!stdioAllowed}>Standard Input/Output (reviewed templates only)</option>
                  <option value="openapi">OpenAPI Spec</option>
                </select>
              </Field>
              <Field label="Category" id="mcp-category" required><Input id="mcp-category" className="h-11" required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></Field>
            </div>
            {draft.transport === "stdio" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Reviewed command" id="mcp-command" required><Input id="mcp-command" className="h-11 font-mono" value={draft.command ?? ""} disabled /></Field>
                  <Field label="Reviewed arguments" id="mcp-args" required><Input id="mcp-args" className="h-11 font-mono" value={draft.args.join(" ")} disabled /></Field>
                </div>
                <ReferenceRows
                  title="Environment variables"
                  rows={draft.environment}
                  namePlaceholder="DATABASE_URL"
                  onChange={(environment) => setDraft({ ...draft, environment })}
                />
              </>
            ) : draft.transport === "openapi" ? (
              <Field label="OpenAPI spec path or URL" id="mcp-spec" required><Input id="mcp-spec" className="h-11 font-mono" required value={draft.specPath ?? ""} onChange={(event) => setDraft({ ...draft, specPath: event.target.value })} placeholder="https://api.example.com/openapi.json" /></Field>
            ) : (
              <Field label="MCP endpoint" id="mcp-endpoint" required><Input id="mcp-endpoint" className="h-11 font-mono" required value={draft.endpoint ?? ""} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://mcp.example.com/mcp" /></Field>
            )}
          </FormSection>

          <FormSection icon={LockKeyhole} title="Authentication" description="Only Secret references are persisted. Values are resolved on the server and never returned to the browser.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Authentication type" id="mcp-auth-type" required>
                <select id="mcp-auth-type" required className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.authType} onChange={(event) => setDraft({ ...draft, authType: event.target.value as CreateMcpServerDefinitionInput["authType"] })}>
                  <option value="none">None</option>
                  <option value="bearer_token">Bearer token</option>
                  <option value="api_key">API key</option>
                  <option value="basic">Basic authentication</option>
                  <option value="authorization">Authorization header</option>
                  <option value="oauth2">OAuth 2.0</option>
                  <option value="aws_sigv4">AWS SigV4</option>
                </select>
              </Field>
              {draft.authType !== "none" && draft.authType !== "oauth2" ? (
                <Field label="Credential Secret reference" id="mcp-auth-reference" required><Input id="mcp-auth-reference" className="h-11 font-mono" required value={draft.authReference} onChange={(event) => setDraft({ ...draft, authReference: event.target.value })} placeholder="k8s://namespace/secret#TOKEN" /></Field>
              ) : null}
            </div>
            {draft.authType === "oauth2" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="OAuth flow" id="mcp-oauth-flow" required>
                  <select id="mcp-oauth-flow" required className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.oauth?.flow ?? "authorization_code"} onChange={(event) => setDraft({ ...draft, oauth: { ...draft.oauth, flow: event.target.value as "authorization_code" | "client_credentials" } })}>
                    <option value="authorization_code">Authorization code</option>
                    <option value="client_credentials">Client credentials</option>
                  </select>
                </Field>
                <Field label="Token URL (optional)" id="mcp-token-url"><Input id="mcp-token-url" className="h-11 font-mono" value={draft.oauth?.tokenUrl ?? ""} onChange={(event) => setDraft({ ...draft, oauth: { flow: draft.oauth?.flow ?? "authorization_code", tokenUrl: event.target.value, ...(draft.oauth?.authorizationUrl ? { authorizationUrl: draft.oauth.authorizationUrl } : {}), ...(draft.oauth?.registrationUrl ? { registrationUrl: draft.oauth.registrationUrl } : {}) } })} placeholder="Leave blank for MCP OAuth discovery" /></Field>
              </div>
            ) : null}
          </FormSection>

          <FormSection icon={ShieldCheck} title="Permission Management / Access Control" description="Project isolation is mandatory; optional controls can narrow access further.">
            <div className="border bg-muted/25 p-4 text-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 text-primary" />
                <div><strong>Allow all LiteLLM Keys: Off</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Fixed by TaskLattice Relay. This Server is added only to the current Project Team and selected Instance Keys.</p></div>
              </div>
            </div>
            <ToggleRow
              label="Internal network only"
              description="Mark the endpoint as unavailable from the public internet."
              checked={draft.internalNetworkOnly}
              onChange={(internalNetworkOnly) => setDraft({ ...draft, internalNetworkOnly })}
            />
            <Field label="MCP Access Groups" id="mcp-groups"><Input id="mcp-groups" className="h-11" value={draft.accessGroups.join(", ")} onChange={(event) => setDraft({ ...draft, accessGroups: commaList(event.target.value) })} placeholder="engineering, production-read" /></Field>
            <Field label="Allowed tools" id="mcp-allowed-tools"><Input id="mcp-allowed-tools" className="h-11 font-mono" value={draft.allowedTools.join(", ")} onChange={(event) => setDraft({ ...draft, allowedTools: commaList(event.target.value) })} placeholder="Leave blank to allow all discovered tools" /></Field>
            <Field label="Declared read-only tools" id="mcp-read-only-tools"><Input id="mcp-read-only-tools" className="h-11 font-mono" value={(draft.readOnlyTools ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, readOnlyTools: commaList(event.target.value) })} placeholder="Project Admin attestation, e.g. list_commits" /></Field>
            <Field label="Forwarded request headers" id="mcp-extra-headers"><Input id="mcp-extra-headers" className="h-11 font-mono" value={draft.extraHeaders.join(", ")} onChange={(event) => setDraft({ ...draft, extraHeaders: commaList(event.target.value) })} placeholder="X-Request-ID, X-Tenant-ID" /></Field>
            <ReferenceRows title="Static headers" rows={draft.staticHeaders} namePlaceholder="Authorization" onChange={(staticHeaders) => setDraft({ ...draft, staticHeaders })} />
          </FormSection>

          {formError || saveServer.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError || saveServer.error?.message}</p> : null}
        </form>
      </EntitySheet>
    </div>
  );
}

function FormSection({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: typeof ServerCog;
  title: string;
}) {
  return (
    <section className="space-y-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border bg-muted/30"><Icon className="size-4 text-primary" /></span>
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function Field({ children, id, label, required = false }: { children: ReactNode; id: string; label: string; required?: boolean }) {
  return <div className="space-y-2"><Label htmlFor={id} required={required}>{label}</Label>{children}</div>;
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-5 border p-4 text-left">
      <span><strong className="text-sm">{label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} /></span>
    </button>
  );
}

function ReferenceRows({
  namePlaceholder,
  onChange,
  rows,
  title,
}: {
  namePlaceholder: string;
  onChange: (rows: Array<{ name: string; valueReference: string }>) => void;
  rows: Array<{ name: string; valueReference: string }>;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3"><Label required={rows.length > 0}>{title}</Label><Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, { name: "", valueReference: "" }])}><Plus /> Add</Button></div>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]">
          <Input className="h-10 font-mono" required aria-label={`${title} name ${index + 1}`} value={row.name} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder={namePlaceholder} />
          <Input className="h-10 font-mono" required aria-label={`${title} Secret reference ${index + 1}`} value={row.valueReference} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, valueReference: event.target.value } : item))} placeholder="k8s://namespace/secret#KEY" />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title} row ${index + 1}`} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button>
        </div>
      ))}
      {!rows.length ? <p className="border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">No {title.toLowerCase()} configured.</p> : null}
    </div>
  );
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
