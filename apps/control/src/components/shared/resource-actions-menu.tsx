import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Items select an operation; mutation belongs in the destination sheet. */
export function ResourceActionsMenu({
  resourceName,
  actions,
}: {
  resourceName: string;
  actions: readonly {
    label: string;
    icon?: ReactNode;
    disabledReason?: string;
    destructive?: boolean;
    onSelect: () => void;
  }[];
}) {
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`More actions for ${resourceName}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={Boolean(action.disabledReason)}
            className={
              action.destructive
                ? "text-destructive focus:text-destructive"
                : undefined
            }
            onSelect={action.onSelect}
          >
            {action.icon}
            <span>
              {action.label}
              {action.disabledReason ? (
                <span className="block text-xs font-normal">
                  {action.disabledReason}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
