import type {
  AccessPolicy,
  Instance as Agent,
  McpServerDefinition,
} from "@tali/contracts";
import { useQuery } from "@tanstack/react-query";
import { Bot, ServerCog, ShieldCheck } from "lucide-react";

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

type EffectiveTool = {
  decision: "ALLOW" | "DENY";
  policies: string[];
  server: McpServerDefinition;
  toolName: string;
};

export function effectiveTools(
  accessPolicyIds: readonly string[],
  policies: AccessPolicy[],
  servers: McpServerDefinition[],
): EffectiveTool[] {
  const selectedPolicyIds = new Set(accessPolicyIds);
  const active = policies.filter(
    (policy) => policy.status === "ACTIVE" && selectedPolicyIds.has(policy.id),
  );
  return servers.flatMap((server) =>
    server.tools.map((tool) => {
      const applied = active.flatMap((policy) =>
        policy.serverRules
          .filter((rule) => rule.mcpServerId === server.id)
          .map((rule) => ({
            name: policy.name,
            decision:
              rule.tools.find((item) => item.toolName === tool.name)
                ?.decision ?? "INHERIT",
            defaultDecision: rule.defaultDecision,
          })),
      );
      const decisions = applied.map((item) =>
        item.decision === "INHERIT" ? item.defaultDecision : item.decision,
      );
      const ceilingAllows =
        !server.allowedTools.length || server.allowedTools.includes(tool.name);
      return {
        server,
        toolName: tool.name,
        decision:
          ceilingAllows &&
          decisions.includes("ALLOW") &&
          !decisions.includes("DENY")
            ? ("ALLOW" as const)
            : ("DENY" as const),
        policies: applied.map((item) => item.name),
      };
    }),
  );
}

export function EffectiveMcpAccess({ agent }: { agent: Agent }) {
  const scope = useProjectQueryScope();
  const policies = useQuery({
    queryKey: scope.key("access-policies"),
    queryFn: api.listAccessPolicies,
  });
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const selectedServers = (catalog.data?.mcpServers ?? []).filter((server) =>
    (agent.mcpServerIds ?? []).includes(server.id),
  );
  const bound = (policies.data ?? []).filter((policy) =>
    agent.accessPolicyIds.includes(policy.id),
  );
  const tools = effectiveTools(
    agent.accessPolicyIds,
    policies.data ?? [],
    selectedServers,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-link" />
          Effective MCP access
          <Badge variant="outline">
            {bound.filter((policy) => policy.status === "ACTIVE").length} active
            policies
          </Badge>
        </CardTitle>
        <CardDescription>
          Computed from persisted policy revisions. Deny wins when multiple
          active policies address the same tool.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact icon={Bot} label="Instance" value={agent.name} />
          <Fact
            icon={ShieldCheck}
            label="Selected policies"
            value={String(bound.length)}
          />
          <Fact
            icon={ServerCog}
            label="Allowed tools"
            value={String(
              tools.filter((tool) => tool.decision === "ALLOW").length,
            )}
          />
        </div>
        {policies.isError || catalog.isError ? (
          <div
            className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            <p>{policies.error?.message ?? catalog.error?.message}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() =>
                void Promise.all([policies.refetch(), catalog.refetch()])
              }
            >
              Try again
            </Button>
          </div>
        ) : policies.isLoading || catalog.isLoading ? (
          <p className="border p-6 text-sm text-muted-foreground">
            Calculating effective access…
          </p>
        ) : !tools.length ? (
          <p className="border border-dashed p-6 text-sm text-muted-foreground">
            No discovered MCP tools are in scope. The effective MCP server list
            is empty.
          </p>
        ) : (
          <div className="overflow-x-auto border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b bg-muted/35 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">MCP server</th>
                  <th className="px-4 py-3 font-medium">Tool</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3 font-medium">Policy source</th>
                  <th className="px-4 py-3 font-medium">Enforced by</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tools.map((tool) => (
                  <tr key={`${tool.server.id}:${tool.toolName}`}>
                    <td className="px-4 py-4 font-medium">
                      {tool.server.name}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {tool.toolName}
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        variant={
                          tool.decision === "ALLOW" ? "secondary" : "outline"
                        }
                      >
                        {tool.decision}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">
                      {tool.policies.join(", ") || "No active policy"}
                    </td>
                    <td className="px-4 py-4 text-xs">
                      LiteLLM key permission
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 border p-4">
      <Icon className="mt-0.5 size-4 shrink-0 text-link" />
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong className="mt-1 block truncate text-sm">{value}</strong>
      </span>
    </div>
  );
}
