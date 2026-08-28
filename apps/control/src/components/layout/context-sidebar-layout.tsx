import type { CSSProperties, ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/auth-provider";
import {
  AppSidebarBrandLink,
  AppSidebarUtilityFooter,
} from "@/components/layout/app-sidebar-chrome";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import {
  Sidebar,
  SidebarHeader,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import { useProject } from "@/hooks/use-project";
import { cn } from "@/lib/utils";

interface ContextSidebarLayoutProps {
  children: ReactNode;
  mobileNavigation: ReactNode;
  sidebar: ReactNode;
  sidebarWidth?: string;
  standaloneSidebar?: boolean;
}

export function ContextSidebarLayout({
  children,
  mobileNavigation,
  sidebar,
  sidebarWidth = "16rem",
  standaloneSidebar = false,
}: ContextSidebarLayoutProps) {
  const { logout, user } = useAuth();
  const { currentProject } = useProject();
  const { isMobile } = useSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const projectId = currentProject?.id ?? "proj1";
  const standaloneMobileSidebar = standaloneSidebar && isMobile;

  return (
    <div
      className="flex min-h-svh w-full bg-background"
      style={{ "--sidebar-width": sidebarWidth } as CSSProperties}
    >
      <Sidebar
        collapsible={standaloneMobileSidebar ? "offcanvas" : "none"}
        mobileDescription="Navigate administration settings and Account actions."
        mobileTitle="Administration navigation"
        className={cn(
          "border-r border-sidebar-border",
          !standaloneMobileSidebar
            && "sticky top-0 hidden h-svh shrink-0 self-start lg:flex",
        )}
      >
        {standaloneSidebar ? (
          <SidebarHeader className="gap-1.5 border-b border-sidebar-border p-2">
            <AppSidebarBrandLink compact={false} projectId={projectId} />
          </SidebarHeader>
        ) : null}
        {sidebar}
        {standaloneSidebar ? (
          <AppSidebarUtilityFooter
            collapsed={false}
            logout={logout}
            pathname={pathname}
            projectId={projectId}
            user={user}
          />
        ) : null}
      </Sidebar>

      <SidebarInset className="min-h-svh">
        <WorkspaceHeader showSidebarTrigger={!standaloneSidebar || isMobile} />
        <div className="border-b border-border p-4 lg:hidden">
          {mobileNavigation}
        </div>
        {children}
      </SidebarInset>
    </div>
  );
}
