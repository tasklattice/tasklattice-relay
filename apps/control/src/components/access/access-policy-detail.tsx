import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  Clock3,
  KeyRound,
  Pencil,
  ServerCog,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { AccessPolicyEditorSheet } from "@/components/access/access-policy-editor-sheet";
import { PageHeader } from "@/components/layout/page-header";
import { RuntimeStatusBadge, StatusBadge } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export function AccessPolicyDetail({
  policyId,
  projectId,
}: {
  policyId: string;
  projectId: string;
}) {
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const policy = useQuery({
    queryKey: scope.key("access-policy", policyId),
    queryFn: () => api.getAccessPolicy(policyId),
  });
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const instances = useQuery({
    queryKey: scope.key("agents"),
    queryFn: api.listInstances,
  });
  const versions = useQuery({
    queryKey: scope.key("access-policy-versions", policyId),
    queryFn: () => api.listAccessPolicyVersions(policyId),
  });
  const statusMutation = useMutation({
    mutationFn: (status: "DRAFT" | "ACTIVE") =>
      api.updateAccessPolicy(policyId, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policy", policyId),
        }),
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policies"),
        }),
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policy-versions", policyId),
        }),
      ]);
    },
  });

  if (policy.isLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
        Loading Access Policy…
      </div>
    );
  }
  if (policy.error || !policy.data) {
    return (
      <div className="space-y-5">
        <Back projectId={projectId} />
        <div className="border border-dashed px-6 py-16 text-center">
          <ShieldCheck className="mx-auto size-7 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">
            Access Policy unavailable
          </h1>
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            {policy.error?.message ?? "Policy not found."}
          </p>
        </div>
      </div>
    );
  }

  const current = policy.data;
  const serverMap = new Map(
    (catalog.data?.mcpServers ?? []).map((server) => [server.id, server]),
  );
  const referencingInstances = (instances.data ?? []).filter((instance) =>
    instance.accessPolicyIds.includes(current.id),
  );

  return (
    <div className="space-y-6">
      <Back projectId={projectId} />
      <PageHeader
        title={current.name}
        badge={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={current.status === "ACTIVE" ? "Active" : "Draft"}
              tone={current.status === "ACTIVE" ? "info" : "neutral"}
            />
            <Badge variant="outline">v{current.revision}</Badge>
          </div>
        }
        description="Reusable MCP tool permissions selected directly by Agent Instances."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit policy
            </Button>
            <Button
              variant={current.status === "ACTIVE" ? "outline" : "default"}
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate(
                  current.status === "ACTIVE" ? "DRAFT" : "ACTIVE",
                )
              }
            >
              {current.status === "ACTIVE" ? <ShieldOff /> : <ShieldCheck />}
              {current.status === "ACTIVE" ? "Deactivate" : "Activate"}
            </Button>
          </div>
        }
      />

      {current.lastReconciliationError ? (
        <div
          role="alert"
          className="border-l-2 border-destructive bg-destructive/5 px-4 py-3"
        >
          <strong className="block text-sm text-destructive">
            LiteLLM synchronization failed
          </strong>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {current.lastReconciliationError}
          </p>
        </div>
      ) : current.status === "ACTIVE" ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-600/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
          This revision is active and reconciled to every referencing Instance.
          {current.lastReconciledAt
            ? ` Last synchronized ${new Date(current.lastReconciledAt).toLocaleString()}.`
            : ""}
        </div>
      ) : null}
      {statusMutation.error ? (
        <p
          role="alert"
          className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive"
        >
          {statusMutation.error.message}
        </p>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">MCP Tools</TabsTrigger>
          <TabsTrigger value="instances">Instances</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Enforcement boundary</CardTitle>
              <CardDescription>
                This policy controls MCP invocation and contains no credentials
                or approval workflow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                <Definition label="Identifier" value={current.id} mono />
                <Definition
                  label="MCP servers"
                  value={String(current.serverRules.length)}
                />
                <Definition
                  label="Referencing Instances"
                  value={
                    instances.isLoading
                      ? "Loading…"
                      : instances.isError
                        ? "Unavailable"
                        : String(referencingInstances.length)
                  }
                />
                <Definition
                  label="Combination rule"
                  value="Deny overrides allow"
                />
                <Definition label="Created by" value={current.createdBy} />
                <Definition
                  label="Created"
                  value={new Date(current.createdAt).toLocaleString()}
                />
                <Definition
                  label="Updated"
                  value={new Date(current.updatedAt).toLocaleString()}
                />
                <Definition
                  label="Runtime state"
                  value={current.status === "ACTIVE" ? "Enforced" : "No effect"}
                />
              </dl>
              {instances.isError ? (
                <div
                  className="mt-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  <p>
                    Referencing Instances are unavailable:{" "}
                    {instances.error.message}
                  </p>
                  <Button
                    type="button"
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() => void instances.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            <Boundary
              icon={ServerCog}
              title="Access Policy"
              body="MCP tool invocation decisions"
            />
            <Boundary
              icon={KeyRound}
              title="Credentials"
              body="Managed separately from tool authorization"
            />
            <Boundary
              icon={ShieldCheck}
              title="Runtime Policy"
              body="Independent sandbox and network boundary"
            />
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-5 space-y-4">
          {current.serverRules.map((rule) => {
            const server = serverMap.get(rule.mcpServerId);
            return (
              <Card key={rule.mcpServerId}>
                <CardHeader className="border-b">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {server?.logoUrl ? (
                      <img
                        src={server.logoUrl}
                        alt=""
                        className="size-6 object-contain"
                      />
                    ) : (
                      <ServerCog className="size-5 text-primary" />
                    )}
                    {server?.name ?? rule.mcpServerId}
                    <Badge variant="outline">
                      Default {rule.defaultDecision.toLowerCase()}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {server?.tools.length ?? 0} currently discovered tools.
                    Explicit decisions are listed below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  {!rule.tools.length ? (
                    <p className="px-5 py-5 text-sm text-muted-foreground">
                      Every tool inherits the server default.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {rule.tools.map((tool) => (
                        <div
                          key={tool.toolName}
                          className="flex items-center justify-between gap-4 px-5 py-4 text-sm"
                        >
                          <code className="min-w-0 truncate text-xs">
                            {tool.toolName}
                          </code>
                          <Badge
                            variant={
                              tool.decision === "DENY" ? "outline" : "secondary"
                            }
                          >
                            {tool.decision}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="instances" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle>Referencing Instances</CardTitle>
              <CardDescription>
                Instances select this policy directly. Assignment changes do not
                create a new policy revision.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {instances.isLoading ? (
                <p className="border p-6 text-sm text-muted-foreground">
                  Loading referencing Instances…
                </p>
              ) : instances.isError ? (
                <div
                  className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
                  role="alert"
                >
                  <p>{instances.error.message}</p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void instances.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : !referencingInstances.length ? (
                <p className="border border-dashed p-6 text-sm text-muted-foreground">
                  No Instances reference this policy.
                </p>
              ) : (
                referencingInstances.map((instance) => (
                  <Link
                    key={instance.id}
                    to="/$projectId/instances/$instanceId"
                    params={{ projectId, instanceId: instance.id }}
                    search={{}}
                    className="flex items-center justify-between gap-4 border p-4 transition-colors hover:bg-muted/35 focus-visible:outline-2"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Boxes className="size-5 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">
                          {instance.name}
                        </strong>
                        <span className="text-xs text-muted-foreground">
                          {instance.agentPlatform} · {instance.model}
                        </span>
                      </span>
                    </span>
                    <RuntimeStatusBadge status={instance.status} />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
              <CardDescription>
                Every user-authored change creates an immutable PostgreSQL
                snapshot.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {versions.isLoading ? (
                <p className="px-5 py-8 text-sm text-muted-foreground">
                  Loading versions…
                </p>
              ) : (
                <div className="divide-y">
                  {(versions.data ?? []).map((version) => (
                    <div
                      key={version.revision}
                      className="grid gap-2 px-5 py-4 sm:grid-cols-[5rem_minmax(0,1fr)_12rem] sm:items-center"
                    >
                      <Badge variant="outline">v{version.revision}</Badge>
                      <span>
                        <strong className="block text-sm">
                          {version.summary}
                        </strong>
                        <span className="text-xs text-muted-foreground">
                          {version.actor}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />{" "}
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AccessPolicyEditorSheet
        open={editing}
        onOpenChange={setEditing}
        policy={current}
      />
    </div>
  );
}

function Back({ projectId }: { projectId: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to="/$projectId/access-policies" params={{ projectId }}>
        <ArrowLeft /> Access Policies
      </Link>
    </Button>
  );
}

function Definition({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-sm font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Boundary({
  body,
  icon: Icon,
  title,
}: {
  body: string;
  icon: typeof ServerCog;
  title: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-5">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>
          <strong className="block text-sm">{title}</strong>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {body}
          </span>
        </span>
      </CardContent>
    </Card>
  );
}
