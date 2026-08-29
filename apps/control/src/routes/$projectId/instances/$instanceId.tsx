import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type {
  InstanceLifecycleOperation,
  SupervisorAgentInstanceDetail,
} from "@tali/contracts";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AgentCreationExperience } from "@/components/agents/agent-creation-experience";
import { A2aInstanceDetail } from "@/components/instances/a2a-instance-detail";
import { AgentInstanceActivityTab } from "@/components/instances/agent-instance-activity-tab";
import { DeleteInstanceSheet } from "@/components/instances/delete-instance-sheet";
import { InstanceAuditorLogTab } from "@/components/instances/instance-auditor-log-tab";
import { InstanceCapabilitiesTab } from "@/components/instances/instance-capabilities-tab";
import { InstanceConfigurationTab } from "@/components/instances/instance-configuration-tab";
import { InstanceHeader } from "@/components/instances/instance-detail-header";
import {
  instanceDetailTabSearchValues,
  getInstanceAccessState,
  normalizeInstanceDetailTab,
  resolveAvailableInstanceDetailTab,
  type InstanceDetailTab,
} from "@/components/instances/instance-detail-model";
import {
  InstanceDetailErrorState,
  InstanceDetailSkeleton,
  InstanceNotFoundState,
} from "@/components/instances/instance-detail-states";
import { InstanceTabs } from "@/components/instances/instance-detail-tabs";
import { InstanceOverviewTab } from "@/components/instances/instance-overview-tab";
import { InstanceTerminalTab } from "@/components/instances/instance-terminal-tab";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import { ApiError, api, projectScopedPath } from "@/lib/api";

const tabSearch = z.preprocess(
  (value) =>
    typeof value === "string" &&
    instanceDetailTabSearchValues.includes(
      value as (typeof instanceDetailTabSearchValues)[number],
    )
      ? value
      : undefined,
  z.enum(instanceDetailTabSearchValues).optional(),
);

export const Route = createFileRoute("/$projectId/instances/$instanceId")({
  validateSearch: z.object({
    creating: z.boolean().optional(),
    operationId: z.string().uuid().optional(),
    tab: tabSearch,
  }),
  component: AgentDetail,
});

function AgentDetail() {
  const { instanceId, projectId } = Route.useParams();
  const search = Route.useSearch();
  const activeTab = normalizeInstanceDetailTab(search.tab);
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const permissions = useProjectPermissions();
  const detail = useQuery({
    queryKey: scope.key("agent", instanceId),
    queryFn: () => api.getInstance(instanceId),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (activeTab === "terminal" || activeTab === "logs") return 5_000;
      if (status !== "PROVISIONING" && status !== "DESTROYING") return false;
      return typeof document !== "undefined" &&
        document.visibilityState === "hidden"
        ? 15_000
        : 5_000;
    },
  });
  const creationOperation = useQuery({
    queryKey: scope.key(
      "instance-lifecycle-operation",
      instanceId,
      search.operationId ?? "none",
    ),
    queryFn: () =>
      api.getInstanceLifecycleOperation(instanceId, search.operationId!),
    enabled: Boolean(search.creating && search.operationId),
    retry: 2,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" ? false : 1_500;
    },
  });
  useEffect(() => {
    if (!search.creating || !search.operationId) return;
    const queryKey = scope.key(
      "instance-lifecycle-operation",
      instanceId,
      search.operationId,
    );
    const source = new EventSource(
      projectScopedPath(
        `/api/v1/instances/${encodeURIComponent(instanceId)}/operations/${encodeURIComponent(search.operationId)}/events`,
        projectId,
      ),
    );
    source.onmessage = (message) => {
      const operation = JSON.parse(message.data) as InstanceLifecycleOperation;
      queryClient.setQueryData(queryKey, operation);
      if (operation.status === "succeeded" || operation.status === "failed") {
        source.close();
        void detail.refetch();
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [
    detail,
    instanceId,
    projectId,
    queryClient,
    scope,
    search.creating,
    search.operationId,
  ]);

  if (detail.isPending) return <InstanceDetailSkeleton />;
  if (detail.error instanceof ApiError && detail.error.status === 404)
    return <InstanceNotFoundState />;
  if (detail.isError || !detail.data)
    return <InstanceDetailErrorState onRetry={() => void detail.refetch()} />;
  if (search.creating && detail.data.kind === "SUPERVISOR") {
    return (
      <AgentCreationExperience
        agent={detail.data.instance}
        {...(creationOperation.data
          ? { operation: creationOperation.data }
          : {})}
      />
    );
  }
  if (detail.data.kind === "A2A") {
    return (
      <A2aInstanceDetail
        activeTab={activeTab}
        canManage={permissions.canManageResources}
        canViewLogs={permissions.canViewAgentLogs}
        detail={detail.data}
      />
    );
  }
  return (
    <SupervisorInstanceDetail
      activeTab={activeTab}
      detail={detail.data}
      projectId={projectId}
    />
  );
}

function SupervisorInstanceDetail({
  activeTab,
  detail,
  projectId,
}: {
  activeTab: InstanceDetailTab;
  detail: SupervisorAgentInstanceDetail;
  projectId: string;
}) {
  const agentId = detail.id;
  const agent = detail.instance;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const permissions = useProjectPermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const modelRouting = useQuery({
    queryKey: scope.key("model-routing", agent.modelRoutingId),
    queryFn: () => api.getModelRouting(agent.modelRoutingId),
    retry: 1,
    staleTime: 30_000,
  });
  const interaction = useQuery({
    queryKey: scope.key("agent-interaction", agentId),
    queryFn: () => api.getInstanceInteraction(agentId),
    enabled: permissions.canInteractWithAgents && agent.status === "READY",
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 4 * 60_000,
  });
  const runtimeLogs = useQuery({
    queryKey: scope.key("agent-logs", agentId),
    queryFn: () => api.getInstanceLogs(agentId),
    enabled: permissions.canViewAgentLogs,
    retry: 1,
    staleTime: 5_000,
    refetchInterval:
      permissions.canViewAgentLogs && agent.status === "PROVISIONING"
        ? 5_000
        : false,
  });
  const terminalTargets = useQuery({
    queryKey: scope.key("agent-terminal-targets", agentId),
    queryFn: () => api.getTerminalTargets(agentId),
    enabled: permissions.canUseAgentTerminal && agent.status === "READY",
    retry: 1,
    staleTime: 5_000,
    refetchInterval: activeTab === "terminal" ? 5_000 : false,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteInstance(agentId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: scope.key("agents") });
      await navigate({
        to: "/$projectId/instances",
        params: { projectId },
        search: result.retainedMemory
          ? {
              retainedMemory: result.retainedMemory.id,
              retainedMemoryName: result.retainedMemory.displayName,
            }
          : {},
        replace: true,
      });
    },
  });
  const terminalWasOpen = useRef(false);
  const [terminalNotice, setTerminalNotice] = useState("");
  const interactionEndpoint =
    interaction.data?.httpEndpoint ??
    (permissions.canInteractWithAgents &&
    agent.status === "READY" &&
    agent.httpEndpoint?.status === "READY"
      ? {
          ...agent.httpEndpoint,
          reason: interaction.isError
            ? "Secure Web UI access could not be issued. Try refreshing this page."
            : "Preparing secure Web UI access…",
        }
      : undefined);
  const visibleAgent = {
    ...agent,
    ...(runtimeLogs.data
      ? {
          logs: runtimeLogs.data.logs,
          ...(runtimeLogs.data.error ? { error: runtimeLogs.data.error } : {}),
        }
      : {}),
    ...(interactionEndpoint ? { httpEndpoint: interactionEndpoint } : {}),
  };
  const access = getInstanceAccessState(
    visibleAgent,
    terminalTargets.data,
    {
      canExecAgent: permissions.canUseAgentTerminal,
      checking:
        permissions.canUseAgentTerminal &&
        agent.status === "READY" &&
        terminalTargets.isPending,
      ...(terminalTargets.error
        ? { unavailableReason: "Terminal availability could not be verified." }
        : {}),
    },
    permissions.canInteractWithAgents,
  );
  const renderedTab = resolveAvailableInstanceDetailTab(
    activeTab,
    access.terminal,
  );

  useEffect(() => {
    if (activeTab !== "terminal") return;
    if (access.terminal.enabled) {
      terminalWasOpen.current = true;
      return;
    }
    if (agent.status === "READY" && terminalTargets.isPending) return;
    if (terminalWasOpen.current) {
      setTerminalNotice(
        "Terminal disconnected because the agent is no longer healthy.",
      );
    }
    terminalWasOpen.current = false;
    void navigate({
      to: "/$projectId/instances/$instanceId",
      params: { projectId, instanceId: agentId },
      search: { tab: "overview" },
      replace: true,
    });
  }, [
    access.terminal.enabled,
    activeTab,
    agent.status,
    agentId,
    navigate,
    projectId,
    terminalTargets.isPending,
  ]);

  const platform = getAgentPlatformPresentation(agent.agentPlatform);
  return (
    <div>
      <InstanceHeader
        access={access}
        agent={visibleAgent}
        canDelete={permissions.canDeleteAgents}
        capabilities={detail.capabilities}
        platform={platform}
        onDelete={() => setDeleteOpen(true)}
      />
      <InstanceTabs
        active={renderedTab}
        instanceId={agentId}
        terminal={access.terminal}
      />
      {terminalNotice ? (
        <p
          role="status"
          className="mt-4 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm"
        >
          {terminalNotice}
        </p>
      ) : null}
      {renderedTab === "overview" ? (
        <InstanceOverviewTab
          access={access}
          agent={visibleAgent}
          capabilities={detail.capabilities}
          platform={platform}
          {...(modelRouting.data?.name
            ? { modelRoutingName: modelRouting.data.name }
            : {})}
        />
      ) : null}
      {renderedTab === "configuration" ? (
        <InstanceConfigurationTab agent={visibleAgent} platform={platform} />
      ) : null}
      {renderedTab === "capabilities" ? (
        <InstanceCapabilitiesTab
          agent={visibleAgent}
          capabilities={detail.capabilities}
          protocol={detail.protocols[0]}
        />
      ) : null}
      {renderedTab === "activity" ? (
        <AgentInstanceActivityTab
          detail={{ ...detail, instance: visibleAgent }}
        />
      ) : null}
      {renderedTab === "logs" ? (
        <InstanceAuditorLogTab
          agent={visibleAgent}
          includeSandboxAudit={permissions.canViewSensitiveAgentAudit}
        />
      ) : null}
      {renderedTab === "terminal" ? (
        <InstanceTerminalTab
          agent={visibleAgent}
          targets={(terminalTargets.data ?? []).filter(
            (target) => target.available,
          )}
        />
      ) : null}
      {permissions.canDeleteAgents ? (
        <DeleteInstanceSheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          instanceName={visibleAgent.name}
          retainsMemory={Boolean(visibleAgent.durableMemoryId)}
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
