import { Boxes, Network } from "lucide-react";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";

export function DeleteModelRoutingSheet({
  consumers,
  deleting,
  error,
  onConfirm,
  onOpenChange,
  onViewConsumers,
  open,
  routingName,
}: {
  consumers: number;
  deleting: boolean;
  error?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onViewConsumers: () => void;
  open: boolean;
  routingName: string;
}) {
  const blocked = consumers > 0;

  return (
    <DeleteEntitySheet
      open={open}
      onOpenChange={onOpenChange}
      title={blocked ? "Routing cannot be deleted" : "Delete routing"}
      description={blocked
        ? `${consumers} active ${consumers === 1 ? "Instance is" : "Instances are"} still using this routing.`
        : <>Delete <strong>{routingName}</strong> while keeping registered models.</>}
      entityName={routingName}
      confirmLabel="Delete routing"
      deleting={deleting}
      onConfirm={onConfirm}
      blocked={blocked}
      blockedAction={onViewConsumers}
      blockedActionLabel="View consumers"
      {...(error ? { error } : {})}
      impactDescription="Its LiteLLM route and dedicated team are permanently removed. Registered models are not changed."
    >
      {blocked ? (
        <div role="alert" className="flex gap-3 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm">
          <Boxes className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <span>
            <strong className="block">Move {consumers} active {consumers === 1 ? "consumer" : "consumers"} first</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Open Consumers to find every Instance that must be reassigned.
            </span>
          </span>
        </div>
      ) : (
        <div className="flex gap-3 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3">
          <Network className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-xs leading-5 text-muted-foreground">
            New requests stop using this route immediately. Existing model registrations are not changed.
          </p>
        </div>
      )}
    </DeleteEntitySheet>
  );
}
