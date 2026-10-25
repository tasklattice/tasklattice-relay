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
import { Eye, Pencil, ShieldCheck } from "lucide-react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId, useProject } from "@/hooks/use-project";
import { DefinitionList, DetailCardHeader } from "./instance-detail-shared";
import { InstanceInstructionsDialog } from "./instance-instructions-dialog";

export function InstanceConfigurationTab({
  agent,
  form,
  protocol,
  role: collaborationRole,
}: {
  agent: Agent;
  form: AgentProductForm;
  protocol?: AgentProtocolView;
  role: AgentInstanceRole;
}) {
  const projectId = useCurrentProjectId();
  const { currentProject } = useProject();
  const canEditPolicies =
    currentProject?.effectiveCapabilities.includes(
      "CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN",
    ) ?? false;
  const [policiesOpen, setPoliciesOpen] = useState(false);
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
  const currentAccessPolicies = agent.accessPolicyIds.map(
    (id) =>
      accessPolicies.data?.find((policy) => policy.id === id) ?? {
        id,
        name: id,
        status: undefined,
      },
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
    if (!policiesOpen) setSelectedAccessPolicyIds(agent.accessPolicyIds);
  }, [agent.accessPolicyIds, policiesOpen]);
  const role = catalog.data?.specializations.find(
    (item) => item.id === agent.specializationId,
  );
  const managedBy =
    role?.name ?? (agent.specializationId ? agent.specializationId : "Custom");
  return (
    <div
      role="tabpanel"
      aria-label="Configuration"
      className="grid items-start gap-4 pt-5 lg:grid-cols-2"
    >
      <Card>
        <DetailCardHeader title="Identity" />
        <CardContent>
          <DefinitionList
            items={[
              {
                label: "Instance ID",
                value: <span className="font-mono">{agent.id}</span>,
              },
              ...(agent.description
                ? [{ label: "Description", value: agent.description }]
                : []),
              {
                label: "Product form",
                value:
                  form === "INTERACTIVE"
                    ? "Interactive Agent"
                    : form === "SERVICE"
                      ? "Service Agent"
                      : "Hybrid Agent",
              },
              {
                label: "Collaboration role",
                value:
                  collaborationRole === "SUPERVISOR"
                    ? "Supervisor"
                    : collaborationRole === "SPECIALIST"
                      ? "Specialist"
                      : "Hybrid",
              },
              {
                label: "A2A role",
                value: protocol?.direction.join(" + ") ?? "Not exposed",
              },
              { label: "Work profile", value: managedBy },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <DetailCardHeader
          title="Instructions"
          {...(agent.specializationId === "custom"
            ? {}
            : { description: `Managed by ${managedBy}` })}
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
          action={
            <Button
              type="button"
              variant="outline"
              disabled={!canEditPolicies}
              onClick={() => {
                setSelectedAccessPolicyIds(agent.accessPolicyIds);
                updateAccessPolicies.reset();
                setPoliciesOpen(true);
              }}
            >
              <Pencil /> Edit policies
            </Button>
          }
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
                  <ShieldCheck className="size-3.5 text-link" />
                  {policy.name}
                  <Badge variant="outline">
                    {policy.status ?? "Metadata unavailable"}
                  </Badge>
                </Link>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No Access Policies attached.
              </p>
            )}
          </div>
          {accessPolicies.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading Access Policies…
            </p>
          ) : accessPolicies.isError ? (
            <div role="alert" className="space-y-2 text-xs text-destructive">
              <p>{accessPolicies.error.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void accessPolicies.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}
          {!canEditPolicies ? (
            <p className="text-xs text-muted-foreground">
              You do not have permission to change this Instance's Access
              Policies.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <DetailCardHeader title="Managed inference" />
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
            ]}
          />
        </CardContent>
      </Card>
      <EntitySheet
        open={policiesOpen}
        onOpenChange={setPoliciesOpen}
        pending={updateAccessPolicies.isPending}
        width="md"
        eyebrow="Instance access"
        title="Edit Access Policies"
        description={`${agent.name} · ${agent.status}. Applying changes updates this Instance's MCP tool permissions.`}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={updateAccessPolicies.isPending}
              onClick={() => setPoliciesOpen(false)}
            >
              {updateAccessPolicies.isSuccess ? "Done" : "Cancel"}
            </Button>
            <Button
              type="button"
              variant="edit"
              disabled={
                !canEditPolicies ||
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
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-3">
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
                disabled={
                  accessPolicies.isPending ||
                  accessPolicies.isError ||
                  updateAccessPolicies.isPending
                }
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
          </div>
          {accessPolicies.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading Access Policies…
            </p>
          ) : accessPolicies.isError ? (
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
            <p className="border-l-2 border-warning-border bg-warning-surface px-3 py-2 text-xs">
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
            <p className="border-l-2 border-warning-border bg-warning-surface px-3 py-2 text-xs">
              Maximum of 64 Access Policies reached. Remove one before selecting
              another.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only active policies are enforced. Deny overrides allow when rules
              overlap.
            </p>
          )}
          {updateAccessPolicies.error ? (
            <p role="alert" className="text-xs text-destructive">
              {updateAccessPolicies.error.message}
            </p>
          ) : null}
          {updateAccessPolicies.isSuccess ? (
            <p role="status" className="text-sm text-success">
              Access Policies updated.
            </p>
          ) : null}
        </div>
      </EntitySheet>
      <InstanceInstructionsDialog
        managedBy={managedBy}
        prompt={agent.systemPrompt}
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
      />
    </div>
  );
}
