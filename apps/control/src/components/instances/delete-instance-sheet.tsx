import { BrainCircuit, ServerCog } from "lucide-react";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";

export function DeleteInstanceSheet({
  deleting,
  error,
  instanceName,
  retainsMemory = false,
  onConfirm,
  onOpenChange,
  open,
}: {
  deleting: boolean;
  error?: string;
  instanceName: string;
  retainsMemory?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <DeleteEntitySheet
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Instance"
      description={(
        <>
          Delete <strong>{instanceName}</strong> and clean up its runtime resources in the background. {retainsMemory ? "Its Durable Memory will be kept." : null}
        </>
      )}
      entityName={instanceName}
      confirmLabel="Delete Instance"
      pendingLabel="Deleting…"
      deleting={deleting}
      onConfirm={onConfirm}
      {...(error ? { error } : {})}
    >
      <div className="flex gap-3 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3">
        <ServerCog className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="text-xs leading-5 text-muted-foreground">
          The Instance disappears immediately. Runtime cleanup continues in the background and may take a few minutes.
        </p>
      </div>
      {retainsMemory ? (
        <div className="flex gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3">
          <BrainCircuit className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-xs leading-5 text-muted-foreground">
            The Agent instance will be deleted. Its Memory will be kept and can be attached to another Agent.
          </p>
        </div>
      ) : null}
    </DeleteEntitySheet>
  );
}
