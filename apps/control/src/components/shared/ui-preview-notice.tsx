import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

export function UiPreviewNotice({
  children,
  title = "UI preview only",
}: {
  children?: ReactNode;
  title?: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 border border-primary/20 bg-primary/[0.035] px-4 py-3 text-sm"
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-link">
        <FlaskConical className="size-4" />
      </span>
      <div className="min-w-0">
        <strong className="font-medium">{title}</strong>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {children ??
            "Interactions on this surface stay in local React state. No policy, credential, or runtime configuration is persisted or applied."}
        </p>
      </div>
    </div>
  );
}
