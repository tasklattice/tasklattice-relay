import type {
  AgentInstanceCapabilityView,
  AgentProtocolView,
  Instance as Agent,
} from "@tali/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, BrainCircuit, Network, Sparkles } from "lucide-react";
import { InstanceEffectiveAccessPreview } from "@/components/access/instance-effective-access-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId } from "@/hooks/use-project";
import { DetailCardHeader } from "./instance-detail-shared";
import { AgentCapabilityMatrix } from "./instance-agent-profile";

function EmptyCapability({ label }: { label: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No {label} configured
    </p>
  );
}

export function InstanceCapabilitiesTab({
  agent,
  capabilities,
  protocol,
}: {
  agent: Agent;
  capabilities: AgentInstanceCapabilityView;
  protocol?: AgentProtocolView | undefined;
}) {
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const skills = (agent.skillIds ?? []).map(
    (id) =>
      catalog.data?.skills.find((item) => item.id === id) ?? {
        id,
        name: id,
        description: "Catalog details unavailable.",
        version: undefined,
      },
  );
  const mcpServers = (agent.mcpServerIds ?? []).map(
    (id) =>
      catalog.data?.mcpServers.find((item) => item.id === id) ?? {
        id,
        name: id,
        status: "UNCHECKED" as const,
        tools: undefined,
        transport: undefined,
      },
  );
  const knowledgeBases = (agent.knowledgeSourceIds ?? []).map(
    (id) =>
      catalog.data?.vectorDatabases.find((item) => item.id === id) ?? {
        id,
        name: id,
        description: "Catalog details unavailable.",
        provider: undefined,
      },
  );
  return (
    <div role="tabpanel" aria-label="Capabilities" className="space-y-4 pt-5">
      <AgentCapabilityMatrix capabilities={capabilities} protocol={protocol} />
      <InstanceEffectiveAccessPreview agent={agent} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card id="skills" className="scroll-mt-24">
          <DetailCardHeader
            title="Skills"
            description="Reusable capability packages configured for this Agent."
            action={<Sparkles className="size-5 text-primary" />}
          />
          <CardContent className="divide-y">
            {skills.length ? (
              skills.map((skill) => (
                <article key={skill.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium">{skill.name}</h3>
                    {skill.version ? (
                      <Badge variant="secondary">v{skill.version}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {skill.description}
                  </p>
                </article>
              ))
            ) : (
              <EmptyCapability label="Skills" />
            )}
          </CardContent>
        </Card>

        <Card id="mcp-servers" className="scroll-mt-24">
          <DetailCardHeader
            title="MCP Servers"
            description="Connected tools and external systems."
            action={<Network className="size-5 text-primary" />}
          />
          <CardContent className="divide-y">
            {mcpServers.length ? (
              mcpServers.map((server) => {
                const connected = server.status === "HEALTHY";
                return (
                  <article
                    key={server.id}
                    className="py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-medium">{server.name}</h3>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent",
                          connected
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            connected
                              ? "bg-emerald-500"
                              : "bg-muted-foreground",
                          )}
                        />
                        {connected
                          ? "Connected"
                          : server.status === "UNAVAILABLE"
                            ? "Unavailable"
                            : "Disconnected"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {server.transport ?? "Transport unavailable"}
                      {Array.isArray(server.tools)
                        ? ` · ${server.tools.length} tools`
                        : ""}
                    </p>
                  </article>
                );
              })
            ) : (
              <EmptyCapability label="MCP Servers" />
            )}
          </CardContent>
        </Card>

        <Card id="vector-databases" className="scroll-mt-24">
          <DetailCardHeader
            title="Vector Databases"
            description="Approved vector retrieval sources used for grounded answers."
            action={<BookOpen className="size-5 text-primary" />}
          />
          <CardContent className="divide-y">
            {knowledgeBases.length ? (
              knowledgeBases.map((source) => (
                <article key={source.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium">{source.name}</h3>
                    {source.provider ? (
                      <Badge variant="secondary">
                        {source.provider.toUpperCase()}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {source.description}
                  </p>
                </article>
              ))
            ) : (
              <EmptyCapability label="Vector Databases" />
            )}
          </CardContent>
        </Card>

        <Card id="memory" className="scroll-mt-24">
          <DetailCardHeader
            title="Memory"
            description="Project-level context that survives Agent replacement."
            action={<BrainCircuit className="size-5 text-primary" />}
          />
          <CardContent>
            {agent.durableMemoryId ? (
              <div className="space-y-4">
                <div className="rounded-md border p-4">
                  <h3 className="text-sm font-medium">Durable Memory</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Bound through Relay with scoped recall and asynchronous
                    retain.
                  </p>
                  <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                    {agent.durableMemoryId}
                  </p>
                </div>
                <Link
                  to="/$projectId/memory/$memoryId"
                  params={{ projectId, memoryId: agent.durableMemoryId }}
                  className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline underline-offset-4"
                >
                  Open retained Memory
                </Link>
              </div>
            ) : agent.memory ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">
                      {agent.memory.mode === "hybrid"
                        ? "Hybrid memory"
                        : "Native memory"}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {agent.memory.mode === "hybrid"
                        ? "Curated notes with LiteLLM-routed semantic recall."
                        : "Curated MEMORY.md and dated daily notes."}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {agent.memory.citations} citations
                  </Badge>
                </div>
                <dl className="space-y-2 border-t pt-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Scope</dt>
                    <dd className="font-medium">Instance sandbox</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Session recall</dt>
                    <dd className="font-medium">
                      {agent.memory.mode === "hybrid" &&
                      agent.memory.includeSessionTranscripts
                        ? "Included"
                        : "Not indexed"}
                    </dd>
                  </div>
                </dl>
                <Link
                  to="/$projectId/memory"
                  params={{ projectId }}
                  className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline underline-offset-4"
                >
                  Manage Memory
                </Link>
              </div>
            ) : (
              <EmptyCapability label="Memory" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
