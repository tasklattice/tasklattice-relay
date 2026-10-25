import type {
  AccessPolicy,
  Instance as Agent,
  McpServerDefinition,
} from "@tali/contracts";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const activePolicyCount = bound.filter(
    (policy) => policy.status === "ACTIVE",
  ).length;

  return (
    <section
      aria-label="Effective MCP access"
      className="space-y-3 border-t pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-xs font-medium">Effective tool access</h4>
        {!policies.isLoading &&
        !catalog.isLoading &&
        !policies.isError &&
        !catalog.isError ? (
          <p className="text-xs text-muted-foreground">
            {activePolicyCount} active{" "}
            {activePolicyCount === 1 ? "policy" : "policies"} ·{" "}
            {tools.filter((tool) => tool.decision === "ALLOW").length} allowed
            tools
          </p>
        ) : null}
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
        <p className="text-xs text-muted-foreground">
          Calculating effective access…
        </p>
      ) : !tools.length ? (
        selectedServers.length ? (
          <p className="text-xs text-muted-foreground">
            No tools discovered from the attached MCP Servers.
          </p>
        ) : null
      ) : (
        <div className="overflow-x-auto border">
          <table
            aria-label="Effective MCP tool permissions"
            className="w-full min-w-[680px] text-left text-sm"
          >
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
                  <td className="px-4 py-4 font-medium">{tool.server.name}</td>
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
                  <td className="px-4 py-4 text-xs">LiteLLM key permission</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
