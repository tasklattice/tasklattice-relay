import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Boxes,
  Clock3,
  Plus,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { AccessPolicyEditorSheet } from "@/components/access/access-policy-editor-sheet";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export function AccessPolicies({ projectId }: { projectId: string }) {
  const scope = useProjectQueryScope();
  const [creating, setCreating] = useState(false);
  const policies = useQuery({
    queryKey: scope.key("access-policies"),
    queryFn: api.listAccessPolicies,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access Policies"
        description="Define reusable MCP tool permissions that Agent Instances select directly. Active revisions are enforced by LiteLLM."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/$projectId/mcp-servers" params={{ projectId }}>
                <ServerCog /> MCP Servers
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link
                to="/$projectId/instances"
                params={{ projectId }}
                search={{}}
              >
                <Boxes /> Instances
              </Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create policy
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Policies</CardTitle>
          <CardDescription>
            Draft revisions are inert. Active policies are combined with deny
            taking precedence over allow.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {policies.isLoading ? (
            <div className="px-5 py-16 text-center text-sm text-muted-foreground">
              Loading Access Policies from PostgreSQL…
            </div>
          ) : policies.error ? (
            <div className="px-5 py-12 text-center">
              <p role="alert" className="text-sm text-destructive">
                {policies.error.message}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void policies.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : !policies.data?.length ? (
            <div className="px-5 py-16 text-center">
              <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-4 font-semibold">No Access Policies yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Create a policy from discovered MCP tools, then select it
                directly when creating or configuring an Instance.
              </p>
              <Button className="mt-5" onClick={() => setCreating(true)}>
                <Plus /> Create first policy
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_10rem] gap-4 border-b bg-muted/25 px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
                <span>Policy</span>
                <span>Status</span>
                <span>Servers</span>
                <span>Version</span>
                <span>Updated</span>
              </div>
              <div className="divide-y">
                {policies.data.map((policy) => (
                  <Link
                    key={policy.id}
                    to="/$projectId/access-policies/$policyId"
                    params={{ projectId, policyId: policy.id }}
                    className="group relative grid min-h-24 gap-3 px-5 py-4 transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_10rem] md:items-center md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="size-4 shrink-0 text-link" />
                        <strong className="truncate">{policy.name}</strong>
                        {policy.lastReconciliationError ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/30 text-destructive"
                          >
                            Sync failed
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 block max-w-xl text-xs leading-5 text-muted-foreground">
                        {policy.serverRules.length} MCP server
                        {policy.serverRules.length === 1 ? "" : "s"} · deny
                        overrides allow
                      </span>
                    </span>
                    <DataCell
                      label="Status"
                      value={
                        <Badge
                          variant={
                            policy.status === "ACTIVE" ? "secondary" : "outline"
                          }
                        >
                          {policy.status}
                        </Badge>
                      }
                    />
                    <DataCell
                      icon={ServerCog}
                      label="Servers"
                      value={policy.serverRules.length}
                    />
                    <DataCell label="Version" value={`v${policy.revision}`} />
                    <DataCell
                      icon={Clock3}
                      label="Updated"
                      value={new Date(policy.updatedAt).toLocaleString(
                        undefined,
                        { dateStyle: "medium" },
                      )}
                    />
                    <ArrowRight className="absolute right-4 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:hidden" />
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs leading-5 text-muted-foreground">
        Access Policies govern MCP tool invocation only. Routing,
        credentials, and OpenShell Runtime Policies remain separate controls.
      </p>
      <AccessPolicyEditorSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function DataCell({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <span className="text-sm">
      <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">
        {label}
      </span>
      <span className="flex items-center gap-1.5 font-medium">
        {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
        {value}
      </span>
    </span>
  );
}
