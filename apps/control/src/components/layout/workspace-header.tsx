import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HeaderBreadcrumb } from "@/components/layout/header-breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function WorkspaceHeader({ showSidebarTrigger = true }: {
  showSidebarTrigger?: boolean;
}) {
  const { t } = useTranslation("sidebar");
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="sticky top-0 z-30 bg-background">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4 sm:px-6">
        {showSidebarTrigger ? (
          <SidebarTrigger label={t("navigation.toggle")} />
        ) : null}
        <HeaderBreadcrumb pathname={pathname} />

      </header>
    </div>
  );
}
