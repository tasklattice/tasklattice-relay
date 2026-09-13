import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SandboxPolicy, SandboxPolicyInput } from "@tali/contracts";
import { FilePlus2, Save, ShieldCheck } from "lucide-react";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";

export function RuntimePolicyEditorDrawer({
  open,
  onOpenChange,
  policy,
  templatePolicyYaml,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: SandboxPolicy | undefined;
  templatePolicyYaml: string;
  onSaved?: (policy: SandboxPolicy) => void;
}) {
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const [value, setValue] = useState<SandboxPolicyInput>({
    name: "",
    description: "",
    networkAccess: "Managed inference only",
    policyYaml: templatePolicyYaml,
  });
  const mutation = useMutation({
    mutationFn: (input: SandboxPolicyInput) =>
      policy ? api.updateRuntimePolicy(policy.id, input) : api.createRuntimePolicy(input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: scope.key("runtime-policies") });
      onSaved?.(saved);
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    setValue(policy ? {
      name: policy.name,
      description: policy.description,
      networkAccess: policy.networkAccess,
      policyYaml: policy.policyYaml,
    } : {
      name: "",
      description: "",
      networkAccess: "Managed inference only",
      policyYaml: templatePolicyYaml,
    });
    mutation.reset();
  }, [open, policy, templatePolicyYaml]);

  const update = <Key extends keyof SandboxPolicyInput>(key: Key, next: SandboxPolicyInput[Key]) =>
    setValue((current) => ({ ...current, [key]: next }));

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      eyebrow="OpenShell Policy"
      title={policy ? `Edit ${policy.name}` : "Create Policy"}
      description="Define a reusable OpenShell YAML boundary. TaskLattice Relay always preserves the writable runtime paths required by OpenClaw."
      width="lg"
      bodyClassName="p-0"
      footer={(
        <>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button form="policy-editor-form" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : policy ? <Save /> : <FilePlus2 />}
            {mutation.isPending ? "Validating Policy…" : policy ? "Save changes" : "Create Policy"}
          </Button>
        </>
      )}
    >
        <form
          id="policy-editor-form"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"
          onSubmit={(event) => { event.preventDefault(); mutation.mutate(value); }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="policy-name" required>Policy name</Label>
              <Input id="policy-name" value={value.name} onChange={(event) => update("name", event.target.value)} minLength={3} required placeholder="Internal development" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-network-access" required>Access summary</Label>
              <Input id="policy-network-access" value={value.networkAccess} onChange={(event) => update("networkAccess", event.target.value)} minLength={3} required placeholder="api.example.com · read-only" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-description" required>Description</Label>
            <Input id="policy-description" value={value.description} onChange={(event) => update("description", event.target.value)} minLength={10} required placeholder="Explain what this boundary permits and why." />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="policy-yaml" required>Policy YAML</Label>
              <span className="font-mono text-xs text-muted-foreground">OpenShell schema v1</span>
            </div>
            <Textarea id="policy-yaml" className="min-h-[360px] resize-y font-mono text-xs leading-5" value={value.policyYaml} onChange={(event) => update("policyYaml", event.target.value)} spellCheck={false} required />
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              TaskLattice Relay validates version 1 YAML and adds the OpenClaw runtime baseline. OpenShell still rejects root execution and globally wildcarded egress.
            </p>
          </div>
          {mutation.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutation.error.message}</p> : null}
        </form>
    </EntitySheet>
  );
}
