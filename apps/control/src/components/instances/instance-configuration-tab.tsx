import { useEffect, useState } from "react";
import { complianceDomainCatalog } from "@tali/contracts";
import type {
  AgentInstanceRole,
  AgentProductForm,
  AgentProtocolView,
  Instance as Agent,
} from "@tali/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Eye, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import type { AgentPlatformPresentation } from "@/lib/agent-platforms";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId } from "@/hooks/use-project";
import { DefinitionList, DetailCardHeader } from "./instance-detail-shared";
import { InstanceInstructionsDialog } from "./instance-instructions-dialog";

export function InstanceConfigurationTab({
  agent,
  form,
  platform,
  protocol,
  role: collaborationRole,
}: {
  agent: Agent;
  form: AgentProductForm;
  platform: AgentPlatformPresentation;
  protocol?: AgentProtocolView;
  role: AgentInstanceRole;
}) {
  const projectId = useCurrentProjectId();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [selectedAccessPolicyIds, setSelectedAccessPolicyIds] = useState(
    agent.accessPolicyIds,
  );
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const accessPolicies = useQuery({
    queryKey: scope.key("access-policies"),
    queryFn: api.listAccessPolicies,
  });
  const currentAccessPolicies = (accessPolicies.data ?? []).filter((policy) =>
    agent.accessPolicyIds.includes(policy.id),
  );
  const accessPolicyOptions: MultiSelectOption[] = (
    accessPolicies.data ?? []
  ).map((policy) => ({
    value: policy.id,
    label: policy.name,
    description: `${policy.serverRules.length} MCP server${policy.serverRules.length === 1 ? "" : "s"}`,
    meta: policy.status === "ACTIVE" ? "Active" : "Draft · not enforced",
    metaTone: policy.status === "ACTIVE" ? "success" : "warning",
    disabled: policy.status !== "ACTIVE",
  }));
  const invalidSelectedPolicyIds = selectedAccessPolicyIds.filter(
    (id) =>
      !accessPolicies.data?.some(
        (policy) => policy.id === id && policy.status === "ACTIVE",
      ),
  );
  const missingSelectedPolicyIds = selectedAccessPolicyIds.filter(
    (id) => !accessPolicies.data?.some((policy) => policy.id === id),
  );
  const selectionChanged =
    selectedAccessPolicyIds.length !== agent.accessPolicyIds.length ||
    selectedAccessPolicyIds.some((id) => !agent.accessPolicyIds.includes(id));
  const updateAccessPolicies = useMutation({
    mutationFn: () =>
      api.updateAgentAccessPolicies(agent.id, selectedAccessPolicyIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scope.key("agent", agent.id),
        }),
        queryClient.invalidateQueries({ queryKey: scope.key("agents") }),
        queryClient.invalidateQueries({
          queryKey: scope.key("access-policies"),
        }),
      ]);
    },
  });
  useEffect(() => {
    if (!updateAccessPolicies.isPending)
      setSelectedAccessPolicyIds(agent.accessPolicyIds);
  }, [agent.accessPolicyIds, updateAccessPolicies.isPending]);
  const role = catalog.data?.specializations.find(
    (item) => item.id === agent.specializationId,
  );
  const managedBy =
    role?.name ?? (agent.specializationId ? agent.specializationId : "Custom");
  return (
    <div
      role="tabpanel"
      aria-label="Configuration"
      className="grid gap-4 pt-5 lg:grid-cols-2"
    >
      <Card>
        <DetailCardHeader
          title="Identity"
          description="Identity captured when this Instance was created."
        />
        <CardContent>
          <DefinitionList
            items={[
              { label: "Agent name", value: agent.name },
              { label: "Description", value: agent.description || "—" },
              { label: "Product form", value: form === "INTERACTIVE" ? "Interactive Agent" : form === "SERVICE" ? "Service Agent" : "Hybrid Agent" },
              { label: "Collaboration role", value: collaborationRole === "SUPERVISOR" ? "Supervisor" : collaborationRole === "SPECIALIST" ? "Specialist" : "Hybrid" },
              { label: "Execution strategy", value: "Runtime-defined" },
              { label: "A2A role", value: protocol?.direction.join(" + ") ?? "Not exposed" },
              { label: "Work profile", value: managedBy },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <DetailCardHeader
          title="Instructions"
          description={
            agent.specializationId === "custom"
              ? "Custom instructions"
              : `Instructions managed by ${managedBy}`
          }
        />
        <CardContent className="flex min-h-36 flex-col items-start justify-between gap-4">
          <p className="line-clamp-3 text-xs leading-6 text-muted-foreground">
            {agent.systemPrompt || "Instruction content is unavailable."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!agent.systemPrompt}
            onClick={() => setInstructionsOpen(true)}
          >
            <Eye />
            View instructions
          </Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <DetailCardHeader
          title="Access Policies"
          description="This Instance references one or more reusable MCP authorization policies directly. Deny overrides allow when rules overlap."
        />
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {currentAccessPolicies.length ? (
              currentAccessPolicies.map((policy) => (
                <Link
                  key={policy.id}
                  to="/$projectId/access-policies/$policyId"
                  params={{ projectId, policyId: policy.id }}
                  className="inline-flex min-h-9 items-center gap-2 border bg-muted/20 px-3 text-xs font-medium transition-colors hover:bg-muted/50"
                >
                  <ShieldCheck className="size-3.5 text-primary" />
                  {policy.name}
                  <Badge variant="outline">{policy.status}</Badge>
                </Link>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No available policy metadata for the current references.
              </p>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <label
                className="text-xs font-medium"
                htmlFor="instance-access-policies"
              >
                Selected policies
              </label>
              <MultiSelectCombobox
                id="instance-access-policies"
                ariaLabel="Select Access Policies"
                value={selectedAccessPolicyIds}
                options={accessPolicyOptions}
                maxSelected={64}
                disabled={accessPolicies.isPending || accessPolicies.isError}
                placeholder={
                  accessPolicies.isPending
                    ? "Loading Access Policies…"
                    : "Select one or more active policies…"
                }
                searchPlaceholder="Search Access Policies…"
                emptyMessage="No Access Policies match"
                onValueChange={(ids) => {
                  setSelectedAccessPolicyIds(ids);
                  updateAccessPolicies.reset();
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={
                !selectionChanged ||
                !selectedAccessPolicyIds.length ||
                Boolean(invalidSelectedPolicyIds.length) ||
                accessPolicies.isPending ||
                accessPolicies.isError ||
                updateAccessPolicies.isPending
              }
              onClick={() => updateAccessPolicies.mutate()}
            >
              {updateAccessPolicies.isPending ? "Applying…" : "Apply policies"}
            </Button>
          </div>
          {accessPolicies.isError ? (
            <div
              className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              <p>{accessPolicies.error.message}</p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => void accessPolicies.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : !accessPolicies.isPending && !accessPolicies.data?.length ? (
            <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
              <Link
                to="/$projectId/access-policies"
                params={{ projectId }}
                className="font-semibold underline underline-offset-4"
              >
                Create an Access Policy
              </Link>{" "}
              before changing this Instance.
            </p>
          ) : invalidSelectedPolicyIds.length ? (
            <div
              role="alert"
              className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <p>
                A selected policy is missing or no longer active. Remove it or
                choose an active replacement.
              </p>
              {missingSelectedPolicyIds.length ? (
                <Button
                  type="button"
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedAccessPolicyIds((current) =>
                      current.filter(
                        (id) => !missingSelectedPolicyIds.includes(id),
                      ),
                    );
                    updateAccessPolicies.reset();
                  }}
                >
                  Remove unavailable references (
                  {missingSelectedPolicyIds.length})
                </Button>
              ) : null}
            </div>
          ) : !selectedAccessPolicyIds.length ? (
            <p role="alert" className="text-xs text-destructive">
              At least one active Access Policy is required.
            </p>
          ) : selectedAccessPolicyIds.length >= 64 ? (
            <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
              Maximum of 64 Access Policies reached. Remove one before selecting
              another.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Changes reconcile this Instance&apos;s LiteLLM MCP permissions
              without changing its Agent workbench or Runtime Policy.
            </p>
          )}
          {updateAccessPolicies.error ? (
            <p role="alert" className="text-xs text-destructive">
              {updateAccessPolicies.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <DetailCardHeader
          title="Managed inference"
          description="TaskLattice Relay resolved this access contract automatically when the Instance was created."
        />
        <CardContent>
          <DefinitionList
            columns={2}
            items={[
              { label: "Inference mode", value: "Platform managed" },
              {
                label: "Inference status",
                value:
                  agent.modelRoutingStatus?.replaceAll("_", " ") ??
                  "Unavailable",
              },
              {
                label: "Data boundary",
                value:
                  complianceDomainCatalog.find(
                    (domain) =>
                      domain.id === agent.modelRoutingComplianceDomain,
                  )?.label ?? agent.modelRoutingComplianceDomain,
              },
              {
                label: "Automatic routing",
                value:
                  agent.modelRoutingCapabilities?.automaticRouting === "ENABLED"
                    ? "Enabled"
                    : "Not enabled",
              },
              {
                label: "Failover",
                value:
                  agent.modelRoutingCapabilities?.failover === "ENABLED"
                    ? "Enabled"
                    : "Not enabled",
              },
              {
                label: "Key fingerprint",
                value: agent.modelRoutingKeyFingerprint ?? "Unavailable",
              },
              { label: "Agent framework", value: platform.name },
              { label: "Runtime", value: platform.runtimeName },
            ]}
          />
        </CardContent>
      </Card>
      <InstanceInstructionsDialog
        managedBy={managedBy}
        prompt={agent.systemPrompt}
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
      />
    </div>
  );
}
