import { useEffect, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "./auth-provider";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { error, loading, user } = useAuth();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    if (loading || user) return;
    const redirect = encodeURIComponent(pathname);
    window.location.replace(`/login?redirect=${redirect}`);
  }, [loading, pathname, user]);

  if (loading || !user) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div className="text-center">
          <LoaderCircle className="mx-auto size-6 animate-spin text-link" />
          <p className="mt-3 text-sm text-muted-foreground">
            {error || "Checking your Project session…"}
          </p>
        </div>
      </main>
    );
  }

  return children;
}
