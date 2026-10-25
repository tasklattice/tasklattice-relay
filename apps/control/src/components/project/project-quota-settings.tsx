import { PageHeader } from "@/components/layout/page-header";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProjectQuota, UpdateProjectQuotaInput } from "@tali/contracts";
import { Bot, CircleDollarSign, Gauge, Plug, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { getProjectQuota, updateProjectQuota } from "@/services/project";
import type { Project } from "@/types/project";

type FormState = {
  hardBudgetUsd: string;
  budgetDuration: "1d" | "7d" | "30d";
  tpmLimit: string;
  maxInstances: string;
  maxMcpIntegrations: string;
  maxKnowledgeBaseIntegrations: string;
};

const emptyForm: FormState = {
  hardBudgetUsd: "",
  budgetDuration: "30d",
  tpmLimit: "",
  maxInstances: "",
  maxMcpIntegrations: "",
  maxKnowledgeBaseIntegrations: "",
};

export function ProjectQuotaSettings({ project }: { project: Project }) {
  const canEdit = useProjectPermissions().canManageProject;
  const quota = useQuery({
    queryKey: ["project-quota", project.id],
    queryFn: () => getProjectQuota(project.id),
  });
  const [form, setForm] = useState<FormState>(emptyForm);
  useEffect(() => {
    if (!quota.data) return;
    setForm({
      hardBudgetUsd: field(quota.data.hardBudgetUsd),
      budgetDuration: quota.data.budgetDuration ?? "30d",
      tpmLimit: field(quota.data.tpmLimit),
      maxInstances: field(quota.data.maxInstances),
      maxMcpIntegrations: field(quota.data.maxMcpIntegrations),
      maxKnowledgeBaseIntegrations: field(quota.data.maxKnowledgeBaseIntegrations),
    });
  }, [quota.data]);
  const save = useMutation({
    mutationFn: (input: UpdateProjectQuotaInput) => updateProjectQuota(project.id, input),
    onSuccess: (data) => quota.refetch().then(() => data),
  });

  if (quota.isLoading) {
    return <div className="grid min-h-72 place-items-center"><Spinner /></div>;
  }
  if (quota.isError || !quota.data) {
    return (
      <div className="p-6 text-sm text-destructive" role="alert">
        {quota.error?.message ?? "Project quota could not be loaded."}
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      hardBudgetUsd: numberOrNull(form.hardBudgetUsd),
      budgetDuration: form.hardBudgetUsd ? form.budgetDuration : null,
      tpmLimit: numberOrNull(form.tpmLimit),
      maxInstances: numberOrNull(form.maxInstances),
      maxMcpIntegrations: numberOrNull(form.maxMcpIntegrations),
      maxKnowledgeBaseIntegrations: numberOrNull(form.maxKnowledgeBaseIntegrations),
    });
  };

  return (
    <form className="divide-y" onSubmit={submit}>
      <div className="space-y-6 pb-6">
        <PageHeader title="Quota" description="Spend, throughput, and resource limits for this Project." actions={<SyncStatus quota={quota.data} />} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UsageCard
            icon={CircleDollarSign}
            label="Spend"
            value={`$${quota.data.usage.spendUsd.toFixed(2)}`}
            current={quota.data.usage.spendUsd}
            limit={quota.data.hardBudgetUsd}
            limitLabel={quota.data.hardBudgetUsd === null ? "Unlimited" : `$${quota.data.hardBudgetUsd.toFixed(2)} / ${quota.data.budgetDuration}`}
          />
          <UsageCard
            icon={Gauge}
            label="Cumulative tokens"
            value={formatNumber(quota.data.usage.totalTokens)}
            current={quota.data.usage.totalTokens}
            limit={null}
            limitLabel="Statistics only"
          />
          <UsageCard
            icon={Bot}
            label="Instances"
            value={formatNumber(quota.data.usage.instances)}
            current={quota.data.usage.instances}
            limit={quota.data.maxInstances}
          />
          <UsageCard
            icon={Plug}
            label="Integrations"
            value={formatNumber(quota.data.usage.mcpIntegrations + quota.data.usage.knowledgeBaseIntegrations)}
            current={quota.data.usage.mcpIntegrations + quota.data.usage.knowledgeBaseIntegrations}
            limit={sumLimits(quota.data.maxMcpIntegrations, quota.data.maxKnowledgeBaseIntegrations)}
          />
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <section className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold">LiteLLM Team limits</h4>
            <p className="mt-1 text-xs text-muted-foreground">Applied to every human member and Instance Service Account in this Project.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <QuotaField
              id="hard-budget"
              label="Hard budget (USD)"
              value={form.hardBudgetUsd}
              placeholder="Unlimited"
              step="0.01"
              disabled={!canEdit}
              onChange={(hardBudgetUsd) => setForm((value) => ({ ...value, hardBudgetUsd }))}
            />
            <div className="space-y-2">
              <Label htmlFor="budget-duration">Budget reset</Label>
              <Select
                disabled={!canEdit || !form.hardBudgetUsd}
                value={form.budgetDuration}
                onValueChange={(budgetDuration) => setForm((value) => ({ ...value, budgetDuration: budgetDuration as FormState["budgetDuration"] }))}
              >
                <SelectTrigger id="budget-duration" className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Daily</SelectItem>
                  <SelectItem value="7d">Every 7 days</SelectItem>
                  <SelectItem value="30d">Every 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <QuotaField
              id="tpm-limit"
              label="Tokens per minute (TPM)"
              value={form.tpmLimit}
              placeholder="Unlimited"
              disabled={!canEdit}
              onChange={(tpmLimit) => setForm((value) => ({ ...value, tpmLimit }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Cumulative token count is visible above but is not a hard limit in this version.
          </p>
        </section>

        <section className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold">TALI resource capacity</h4>
            <p className="mt-1 text-xs text-muted-foreground">Existing resources are preserved; new additions are blocked at the limit.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <QuotaField
              id="instance-limit"
              label="Instances"
              value={form.maxInstances}
              placeholder="Unlimited"
              disabled={!canEdit}
              onChange={(maxInstances) => setForm((value) => ({ ...value, maxInstances }))}
            />
            <QuotaField
              id="mcp-limit"
              label="MCP integrations"
              value={form.maxMcpIntegrations}
              placeholder="Unlimited"
              disabled={!canEdit}
              onChange={(maxMcpIntegrations) => setForm((value) => ({ ...value, maxMcpIntegrations }))}
            />
            <QuotaField
              id="knowledge-limit"
              label="Vector Database integrations"
              value={form.maxKnowledgeBaseIntegrations}
              placeholder="Unlimited"
              disabled={!canEdit}
              onChange={(maxKnowledgeBaseIntegrations) => setForm((value) => ({ ...value, maxKnowledgeBaseIntegrations }))}
            />
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Empty means unlimited. Set a resource limit to 0 to prevent new additions.
        </p>
        {canEdit ? (
          <Button className="h-11" type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <RefreshCw />}
            Save and sync
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Members have view-only access.</p>
        )}
        {save.isError ? <p className="text-sm text-destructive" role="alert">{save.error.message}</p> : null}
      </div>
    </form>
  );
}

function QuotaField(props: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  step?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        className="h-11"
        type="number"
        min="0"
        step={props.step ?? "1"}
        inputMode="numeric"
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  value,
  current,
  limit,
  limitLabel,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  current: number;
  limit: number | null;
  limitLabel?: string;
}) {
  const percentage = limit && limit > 0 ? Math.min(100, current / limit * 100) : 0;
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{label}</div>
      <p className="mt-3 font-sans text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{limitLabel ?? (limit === null ? "Unlimited" : `of ${formatNumber(limit)}`)}</p>
      {limit !== null ? <Progress className="mt-3" value={percentage} /> : null}
    </div>
  );
}

function SyncStatus({ quota }: { quota: ProjectQuota }) {
  const variant = quota.syncStatus === "synced" ? "secondary" : quota.syncStatus === "failed" ? "destructive" : "outline";
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Badge variant={variant}>{quota.syncStatus === "synced" ? "LiteLLM synced" : quota.syncStatus === "failed" ? "Sync failed" : "Sync pending"}</Badge>
      {quota.lastSyncError ? <span className="max-w-sm text-xs text-destructive">{quota.lastSyncError}</span> : null}
    </div>
  );
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function field(value: number | null): string {
  return value === null ? "" : String(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function sumLimits(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}
