import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  A2aStandardAgentInstanceDetail,
  AgentInstanceRole,
  ProjectAgentInstanceDetail,
} from "@tali/contracts";
import {
  ArrowRight,
  FileJson,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { AgentGardenIcon } from "@/components/agent-garden/agent-garden-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { AgentInstanceActivityTab } from "./agent-instance-activity-tab";
import { AgentLiveLogs } from "./agent-live-logs";
import { DeleteInstanceSheet } from "./delete-instance-sheet";
import type { InstanceDetailTab } from "./instance-detail-model";
import {
  CopyableValue,
  DefinitionList,
  DetailCardHeader,
  RelativeTime,
} from "./instance-detail-shared";
import { InstanceTabs } from "./instance-detail-tabs";
import { AgentCapabilityMatrix } from "./instance-agent-profile";
import {
  InstanceDetailHeader,
  InstanceResourceSection,
  InstanceSummaryLink,
  InstanceUnavailablePanel,
} from "./instance-detail-layout";

type ServiceAgentInstanceDetail =
  A2aStandardAgentInstanceDetail | ProjectAgentInstanceDetail;

function workProfileLabel(role: AgentInstanceRole) {
  return role === "SUPERVISOR"
    ? "Supervisor"
    : role === "HYBRID"
      ? "Hybrid"
      : "Specialist";
}

function A2aHeader({
  detail,
  canManage,
  refreshing,
  onRefresh,
  onDelete,
}: {
  detail: ServiceAgentInstanceDetail;
  canManage: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const projectId = useCurrentProjectId();
  return (
    <InstanceDetailHeader
      name={detail.name}
      status={detail.status}
      icon={<AgentGardenIcon type="a2a" className="size-11 shrink-0" />}
      metadata={
        <>
          <span>
            {detail.platform.name} ·{" "}
            {detail.runtimeView.managed ? "Kubernetes" : "External runtime"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Updated <RelativeTime value={detail.updatedAt} />
          </span>
        </>
      }
      actions={
        <>
          {detail.kind === "PROJECT_AGENT" ? (
            <Button asChild className="min-h-11">
              <Link
                to="/$projectId/agents/$agentId"
                params={{ projectId, agentId: detail.definition.id }}
              >
                <PencilLine /> Open in Agent Developer
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={!canManage || refreshing}
              onClick={onRefresh}
              title={
                !canManage
                  ? "You do not have permission to rediscover this Agent Card."
                  : undefined
              }
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />{" "}
              {refreshing ? "Rediscovering…" : "Rediscover Agent Card"}
            </Button>
          )}
          {detail.kind === "A2A" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-h-11">
                  More <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link
                    to="/$projectId/agent-garden/$agentId"
                    params={{ projectId, agentId: detail.definition.id }}
                  >
                    <FileJson /> View definition
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={!canManage}
                  onSelect={onDelete}
                >
                  <Trash2 /> Remove Instance
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
    />
  );
}

function A2aOverview({ detail }: { detail: ServiceAgentInstanceDetail }) {
  const projectId = useCurrentProjectId();
  const protocol = detail.protocols[0];
  return (
    <div role="tabpanel" aria-label="Overview" className="space-y-5 pt-5">
      {detail.description ? (
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {detail.description}
        </p>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card variant="data">
          <DetailCardHeader title="Capabilities" />
          <div>
            <InstanceSummaryLink
              instanceId={detail.id}
              icon={Sparkles}
              label="Advertised skills"
              value={protocol?.skills.length ?? 0}
              hash="specialist-skills"
            />
            <InstanceSummaryLink
              instanceId={detail.id}
              icon={FileJson}
              label="Agent Card"
              value={protocol?.agentCardStatus ?? "Not advertised"}
              tab="configuration"
              hash="protocol"
            />
            {detail.kind === "PROJECT_AGENT" ? (
              <InstanceSummaryLink
                instanceId={detail.id}
                icon={PencilLine}
                label="Deployed version"
                value={`v${detail.instance.versionNumber}`}
                tab="configuration"
                hash="identity"
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <DetailCardHeader title="Operating context" />
          <CardContent>
            <DefinitionList
              items={[
                {
                  label: "Collaboration role",
                  value: workProfileLabel(detail.role),
                },
                {
                  label: "Protocol",
                  value: protocol
                    ? `A2A ${protocol.version}`
                    : "Not advertised",
                },
                { label: "Scope", value: "Current Project only" },
              ]}
            />
            <Button asChild variant="link" className="mt-3 min-h-11 px-0">
              <Link
                to="/$projectId/instances/$instanceId"
                params={{ projectId, instanceId: detail.id }}
                search={{ tab: "configuration" }}
              >
                View configuration <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function A2aConfiguration({ detail }: { detail: ServiceAgentInstanceDetail }) {
  const protocol = detail.protocols[0];
  const runtimeFacts = [
    { label: "Image", value: detail.runtimeView.imageReference },
    { label: "Image digest", value: detail.runtimeView.imageDigest },
    { label: "Namespace", value: detail.runtimeView.namespace },
    { label: "Workload", value: detail.runtimeView.workloadName },
    { label: "Pod", value: detail.runtimeView.podName },
  ]
    .filter(({ value }) => Boolean(value))
    .map(({ label, value }) => ({
      label,
      value: <CopyableValue value={value} />,
    }));
  return (
    <div
      role="tabpanel"
      aria-label="Configuration"
      className="grid items-start gap-4 pt-5 lg:grid-cols-2"
    >
      <Card id="identity" className="scroll-mt-24">
        <DetailCardHeader title="Identity" />
        <CardContent>
          <DefinitionList
            items={[
              {
                label: "Instance ID",
                value: <CopyableValue value={detail.id} />,
              },
              {
                label: "Product form",
                value:
                  detail.form === "SERVICE"
                    ? "Service Agent"
                    : detail.form === "INTERACTIVE"
                      ? "Interactive Agent"
                      : "Hybrid Agent",
              },
              {
                label: "Collaboration role",
                value: workProfileLabel(detail.role),
              },
              ...(detail.executionStrategy
                ? [
                    {
                      label: "Execution strategy",
                      value: detail.executionStrategy.replaceAll("_", " "),
                    },
                  ]
                : []),
              {
                label: "Definition ID",
                value: <CopyableValue value={detail.definition.id} />,
              },
              ...(detail.kind === "PROJECT_AGENT"
                ? [
                    {
                      label: "Deployed version",
                      value: `v${detail.instance.versionNumber}`,
                    },
                    {
                      label: "Content digest",
                      value: (
                        <CopyableValue value={detail.instance.contentDigest} />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </CardContent>
      </Card>
      {detail.runtimeView.managed ? (
        <Card>
          <DetailCardHeader title="Runtime configuration" />
          <CardContent>
            {runtimeFacts.length ? (
              <DefinitionList items={runtimeFacts} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Deployment details are not available.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card
        id="protocol"
        className={
          detail.runtimeView.managed
            ? "scroll-mt-24 lg:col-span-2"
            : "scroll-mt-24"
        }
      >
        <DetailCardHeader title="A2A configuration" />
        <CardContent className="space-y-4">
          {protocol ? (
            <>
              <DefinitionList
                columns={detail.runtimeView.managed ? 2 : 1}
                items={[
                  { label: "Protocol", value: `A2A ${protocol.version}` },
                  {
                    label: "Binding",
                    value: protocol.binding ?? "Not advertised",
                  },
                  {
                    label: "Direction",
                    value: protocol.direction.join(", ") || "Not advertised",
                  },
                  {
                    label: "Discovery status",
                    value: protocol.agentCardStatus,
                  },
                  {
                    label: "Endpoint",
                    value: <CopyableValue value={protocol.endpoint} />,
                  },
                  {
                    label: "Agent Card URL",
                    value: <CopyableValue value={protocol.agentCardUrl} />,
                  },
                  ...(protocol.lastDiscoveredAt
                    ? [
                        {
                          label: "Last discovered",
                          value: (
                            <RelativeTime value={protocol.lastDiscoveredAt} />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {protocol.lastDiscoveryError ? (
                <p role="alert" className="text-sm text-destructive">
                  {protocol.lastDiscoveryError}
                </p>
              ) : null}
              <details className="rounded-md border">
                <summary className="cursor-pointer px-4 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  Normalized protocol JSON
                </summary>
                <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-[11px] leading-5">
                  {JSON.stringify(protocol, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No A2A protocol has been advertised.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function A2aCapabilities({ detail }: { detail: ServiceAgentInstanceDetail }) {
  const protocol = detail.protocols[0];
  return (
    <div role="tabpanel" aria-label="Capabilities" className="space-y-4 pt-5">
      <AgentCapabilityMatrix
        capabilities={detail.capabilities}
        protocol={protocol}
      />
      <Card variant="data" className="@container/resources">
        <DetailCardHeader title="Advertised capabilities" />
        <InstanceResourceSection
          id="specialist-skills"
          title="Specialist skills"
          icon={Sparkles}
        >
          {protocol?.skills.length ? (
            protocol.skills.map((skill) => (
              <article
                key={skill.id}
                className="min-w-0 border-b pb-4 last:border-b-0 last:pb-0"
              >
                <h4 className="text-sm font-medium">{skill.name}</h4>
                {skill.description ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {skill.description}
                  </p>
                ) : null}
                {skill.tags.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {skill.tags.join(" · ")}
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              No skills advertised.
            </p>
          )}
        </InstanceResourceSection>
      </Card>
    </div>
  );
}

function A2aLogs({
  detail,
  canViewLogs,
}: {
  detail: ServiceAgentInstanceDetail;
  canViewLogs: boolean;
}) {
  const unavailableReason = !canViewLogs
    ? "You do not have permission to view Agent logs."
    : !detail.runtimeView.managed
      ? "Relay can show stdout and stderr only for Agents hosted in its managed runtime."
      : detail.status !== "READY"
        ? "Runtime logs become available after the managed Agent is ready."
        : !detail.runtimeView.podName && !detail.runtimeView.workloadName
          ? "The managed Agent workload is not currently available."
          : undefined;

  return (
    <div role="tabpanel" aria-label="Logs" className="space-y-4 pt-5">
      {!unavailableReason &&
      (detail.runtimeView.podName || detail.runtimeView.workloadName) ? (
        <AgentLiveLogs
          instanceId={detail.id}
          podName={
            detail.runtimeView.podName ?? detail.runtimeView.workloadName!
          }
        />
      ) : (
        <InstanceUnavailablePanel
          icon={SquareTerminal}
          title="Runtime logs unavailable"
          reason={unavailableReason ?? "Runtime logs are not available."}
        />
      )}
    </div>
  );
}

function DisabledTerminal({ reason }: { reason: string }) {
  return (
    <div role="tabpanel" aria-label="Terminal" className="pt-5">
      <InstanceUnavailablePanel
        icon={SquareTerminal}
        title="Executable terminal is not exposed"
        reason={reason}
      />
    </div>
  );
}

export function A2aInstanceDetail({
  activeTab,
  canManage,
  canViewLogs,
  detail,
}: {
  activeTab: InstanceDetailTab;
  canManage: boolean;
  canViewLogs: boolean;
  detail: ServiceAgentInstanceDetail;
}) {
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rediscoverOpen, setRediscoverOpen] = useState(false);
  const storedLogs = useQuery({
    queryKey: scope.key("agent-logs", detail.id),
    queryFn: () => api.getInstanceLogs(detail.id),
    enabled: canViewLogs && activeTab === "activity",
    retry: 1,
    staleTime: 5_000,
  });
  const observedDetail = {
    ...detail,
    instance: {
      ...detail.instance,
      logs: storedLogs.data?.logs ?? [],
      error: storedLogs.data?.error ?? null,
    },
  } as ServiceAgentInstanceDetail;
  const refresh = useMutation({
    mutationFn: async () => {
      if (detail.kind !== "A2A") {
        throw new Error("Project Agents are managed in Agent Developer.");
      }
      await api.discoverGardenAgent(detail.definition.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scope.key("agent", detail.id),
        }),
        queryClient.invalidateQueries({ queryKey: scope.key("agent-garden") }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (detail.kind !== "A2A") {
        return Promise.reject(
          new Error("Project Agents are managed in Agent Developer."),
        );
      }
      return detail.definition.source === "BUILT_IN"
        ? api.removeGardenInstance(detail.id)
        : api.removeGardenAgent(detail.definition.id);
    },
    onSuccess: async () => {
      await Promise.all(
        ["agent-garden", "agents", "runtime-inventory"].map((key) =>
          queryClient.invalidateQueries({ queryKey: scope.key(key) }),
        ),
      );
      await navigate({
        to: "/$projectId/instances",
        params: { projectId },
        replace: true,
      });
    },
  });
  const terminal = {
    enabled: false,
    disabledReason:
      detail.observability.terminal.reason ??
      "This runtime does not expose an executable terminal.",
  };
  const logs = {
    enabled: canViewLogs && detail.runtimeView.managed,
    disabledReason: !canViewLogs
      ? "You do not have permission to view Agent logs."
      : "Runtime logs are available only for Agents hosted by Relay.",
  };
  return (
    <div>
      <A2aHeader
        detail={observedDetail}
        canManage={canManage}
        refreshing={refresh.isPending}
        onRefresh={() => {
          refresh.reset();
          setRediscoverOpen(true);
        }}
        onDelete={() => setDeleteOpen(true)}
      />
      <InstanceTabs
        active={activeTab}
        instanceId={detail.id}
        logs={logs}
        terminal={terminal}
      />
      {activeTab === "overview" ? (
        <A2aOverview detail={observedDetail} />
      ) : null}
      {activeTab === "configuration" ? (
        <A2aConfiguration detail={observedDetail} />
      ) : null}
      {activeTab === "capabilities" ? (
        <A2aCapabilities detail={observedDetail} />
      ) : null}
      {activeTab === "activity" ? (
        <AgentInstanceActivityTab
          detail={observedDetail}
          loading={canViewLogs && storedLogs.isPending}
          {...(canViewLogs && storedLogs.error
            ? { error: storedLogs.error }
            : {})}
          onRetry={() => void storedLogs.refetch()}
        />
      ) : null}
      {activeTab === "logs" ? (
        <A2aLogs detail={observedDetail} canViewLogs={canViewLogs} />
      ) : null}
      {activeTab === "terminal" ? (
        <DisabledTerminal reason={terminal.disabledReason} />
      ) : null}
      <EntitySheet
        open={rediscoverOpen}
        onOpenChange={setRediscoverOpen}
        pending={refresh.isPending}
        width="md"
        title="Rediscover Agent Card"
        description={`${detail.name} · ${detail.status}. Refresh the advertised A2A contract from its saved Agent Card URL.`}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => setRediscoverOpen(false)}
            >
              {refresh.isSuccess ? "Done" : "Cancel"}
            </Button>
            <Button
              type="button"
              variant="edit"
              disabled={!canManage || refresh.isPending || refresh.isSuccess}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw className={refresh.isPending ? "animate-spin" : ""} />
              {refresh.isPending ? "Rediscovering…" : "Rediscover Agent Card"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DefinitionList
            items={[
              {
                label: "Agent Card URL",
                value: (
                  <CopyableValue
                    value={
                      detail.protocols[0]?.agentCardUrl ??
                      (detail.kind === "A2A"
                        ? detail.definition.agentCardUrl
                        : undefined)
                    }
                  />
                ),
              },
              {
                label: "Discovery status",
                value: detail.protocols[0]?.agentCardStatus ?? "Not advertised",
              },
            ]}
          />
          <p className="text-sm leading-6 text-muted-foreground">
            This updates the saved protocol and advertised skills used for
            delegation.
          </p>
          {refresh.error instanceof Error ? (
            <p role="alert" className="text-sm text-destructive">
              {refresh.error.message}
            </p>
          ) : null}
          {refresh.isSuccess ? (
            <p role="status" className="text-sm text-success">
              Agent Card rediscovered.
            </p>
          ) : null}
        </div>
      </EntitySheet>
      {canManage && detail.kind === "A2A" ? (
        <DeleteInstanceSheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          instanceName={detail.name}
          deleting={remove.isPending}
          onConfirm={() => remove.mutate()}
          {...(remove.error instanceof Error
            ? { error: remove.error.message }
            : {})}
        />
      ) : null}
    </div>
  );
}
