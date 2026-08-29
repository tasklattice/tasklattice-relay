import { Link } from "@tanstack/react-router";
import { ArrowRight, DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmbeddingModelSetupNotice({
  canManageProject,
  className,
  projectId,
  showAction = true,
}: {
  canManageProject: boolean;
  className?: string;
  projectId: string;
  showAction?: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-4 border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-700/70 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <DatabaseZap className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div>
          <strong className="text-sm">Embedding model required</strong>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Register and validate a text-embedding model in this Project, or
            inherit one from its Department, to enable Durable Memory and
            Vector Databases.
          </p>
          {!canManageProject ? (
            <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
              Ask a Project Administrator to configure the model.
            </p>
          ) : null}
        </div>
      </div>
      {showAction && canManageProject ? (
        <Button asChild variant="outline" className="h-11 shrink-0 bg-background">
          <Link
            to="/$projectId/setting"
            params={{ projectId }}
            search={{ section: "models" }}
          >
            Configure embedding <ArrowRight />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
