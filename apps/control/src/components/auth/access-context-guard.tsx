import { useEffect, type ReactNode } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import type { AccessContextOption } from "@/services/access-context";
import { useAccessContext } from "./access-context-provider";

export function routeMatchesAccessContext(
  pathname: string,
  context: AccessContextOption,
): boolean {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (normalized === "/account" || normalized === "/access") return true;
  if (/^\/[^/]+\/(?:help|notifications)$/.test(normalized)) return true;
  if (context.level === "platform") {
    return normalized === "/platform/settings";
  }
  if (context.level === "department") {
    return normalized === `/departments/${encodeURIComponent(context.resourceId ?? "")}`;
  }
  const firstSegment = normalized.split("/").filter(Boolean)[0] ?? "";
  return firstSegment === encodeURIComponent(context.resourceId ?? "");
}

export function AccessContextGuard({ children }: { children: ReactNode }) {
  const { active, error, loading, options, reload, select } = useAccessContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (loading || error) return;
    if (!active && options.length === 1) {
      void select(options[0]!).then((selected) => {
        window.location.replace(selected.target);
      });
      return;
    }
    if (!active) {
      window.location.replace(`/access?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!routeMatchesAccessContext(pathname, active)) {
      window.location.replace(active.target);
    }
  }, [active, error, loading, options, pathname, select]);

  if (error) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div className="max-w-sm text-center">
          <BrandLogo compact />
          <h1 className="mt-7 font-display text-2xl font-light tracking-[0.005em]">
            Account access unavailable
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
          <Button className="mt-6" variant="outline" onClick={() => void reload()}>
            <RotateCcw />
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (loading || !active) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div className="text-center">
          <LoaderCircle className="mx-auto size-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            Preparing your access…
          </p>
        </div>
      </main>
    );
  }

  return children;
}
