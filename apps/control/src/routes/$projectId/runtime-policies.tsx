import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SandboxPolicy } from "@tali/contracts";
import { AlertTriangle, FileLock2, LockKeyhole, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { RuntimePolicyEditorDrawer } from "@/components/runtime-policies/runtime-policy-editor-drawer";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { EntityDetailList, EntitySheet } from "@/components/shared/entity-sheet";
import { StatusDot } from "@/components/shared/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";

export const Route = createFileRoute("/$projectId/runtime-policies")({ component: PolicyPage });

function PolicyPage() {
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; policy?: SandboxPolicy }>({ open: false });
  const catalog = useQuery({ queryKey: scope.key("runtime-policies"), queryFn: api.listRuntimePolicies });
  const selected = catalog.data?.policies.find((policy) => policy.id === selectedId);
  const remove = useMutation({
    mutationFn: api.deleteRuntimePolicy,
    onSuccess: async () => {
      setDeleteOpen(false);
      setDetailOpen(false);
      setSelectedId("");
      await queryClient.invalidateQueries({ queryKey: scope.key("runtime-policies") });
    },
  });

  const deleteSelected = () => {
    if (!selected || selected.immutable) return;
    remove.reset();
    setDetailOpen(false);
    setDeleteOpen(true);
  };
  const openCreate = () => {
    setDetailOpen(false);
    setEditor({ open: true });
  };
  const openEdit = () => {
    if (!selected || selected.immutable) return;
    setDetailOpen(false);
    setEditor({ open: true, policy: selected });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runtime Policies"
        description="Manage reusable OpenShell boundaries. Built-in policies come from the deployment ConfigMap; custom policies are managed here."
        actions={<Button variant="create" className="h-11" onClick={openCreate}><Plus />Create Policy</Button>}
      />
      {catalog.error ? (
        <div role="alert" className="flex min-h-28 items-center justify-between gap-4 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span>{catalog.error.message}</span>
          <Button variant="outline" onClick={() => void catalog.refetch()}>Retry</Button>
        </div>
      ) : catalog.isPending ? (
        <div className="flex min-h-64 items-center justify-center gap-3 border text-sm text-muted-foreground"><Spinner />Loading Policy catalog…</div>
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Available policies</CardTitle>
            <CardDescription>Each Instance resolves a catalog entry, then passes the validated YAML to OpenShell at Sandbox creation.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {catalog.data?.policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  remove.reset();
                  setSelectedId(policy.id);
                  setDetailOpen(true);
                }}
                className="grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <FileLock2 className="size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{policy.name}</strong>
                    {policy.id === catalog.data.defaultPolicyId ? <Badge variant="secondary">Default</Badge> : null}
                    <Badge variant="outline">{policy.source === "BUILT_IN" ? "Built-in" : "Custom"}</Badge>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{policy.description}</span>
                </span>
                <StatusDot label={policy.enforcement} tone="success" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <EntitySheet
        open={detailOpen && Boolean(selected)}
        onOpenChange={setDetailOpen}
        eyebrow="Runtime Policy"
        title={selected?.name ?? "Policy details"}
        description={selected?.description ?? "Review this OpenShell runtime boundary."}
        width="lg"
        footer={selected?.immutable ? (
          <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
        ) : (
          <>
            <Button variant="destructive" disabled={remove.isPending} onClick={deleteSelected}>
              <Trash2 />{remove.isPending ? "Deleting…" : "Delete Policy"}
            </Button>
            <Button variant="edit" onClick={openEdit}><Pencil />Edit Policy</Button>
          </>
        )}
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot label={selected.enforcement} tone="success" />
                {selected.id === catalog.data?.defaultPolicyId ? <Badge variant="secondary">Default</Badge> : null}
                <Badge variant="outline">{selected.source === "BUILT_IN" ? "Built-in" : "Custom"}</Badge>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{selected.id}</span>
            </div>

            <EntityDetailList items={[
              { label: "Enforcement", value: selected.enforcement },
              { label: "Network access", value: selected.networkAccess },
              { label: "Source", value: selected.source === "BUILT_IN" ? "Deployment ConfigMap" : "Project managed" },
              { label: "Editable", value: selected.immutable ? "No" : "Yes" },
            ]} />

            {selected.immutable ? (
              <p className="flex items-start gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">
                <LockKeyhole className="mt-1 size-4 shrink-0" />
                Managed by the deployment ConfigMap. Built-in policies cannot be edited or deleted in the console.
              </p>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <strong className="text-sm">Policy YAML</strong>
                <span className="font-mono text-xs text-muted-foreground">OpenShell schema v1</span>
              </div>
              <pre className="max-h-[460px] overflow-auto border bg-muted/45 p-4 font-mono text-[11px] leading-5"><code>{selected.policyYaml}</code></pre>
            </div>

            <p className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-1 size-4 shrink-0" />
              Provider-composed inference access remains managed by OpenShell; this policy controls additional Sandbox access.
            </p>
            {selected.id === catalog.data?.defaultPolicyId ? (
              <p className="flex items-start gap-3 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm leading-6">
                <AlertTriangle className="mt-1 size-4 shrink-0 text-amber-600" />
                The default policy permits arbitrary shell and file operations in Sandbox-owned writable paths. OpenShell still rejects root execution and globally wildcarded network egress.
              </p>
            ) : null}
            {remove.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">{remove.error.message}</p> : null}
          </div>
        ) : null}
      </EntitySheet>

      {selected && !selected.immutable ? (
        <DeleteEntitySheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete Runtime Policy"
          description={<>Delete the custom Policy <strong>{selected.name}</strong>.</>}
          entityName={selected.name}
          confirmLabel="Delete Policy"
          deleting={remove.isPending}
          onConfirm={() => remove.mutate(selected.id)}
          {...(remove.error instanceof Error ? { error: remove.error.message } : {})}
          impactDescription="Existing Sandbox resources are not restarted or changed."
        />
      ) : null}

      <RuntimePolicyEditorDrawer
        open={editor.open}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        policy={editor.policy}
        templatePolicyYaml={catalog.data?.templatePolicyYaml ?? ""}
        onSaved={(policy) => setSelectedId(policy.id)}
      />
    </div>
  );
}
