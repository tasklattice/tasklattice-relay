import { useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
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
      <header className="flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6 lg:px-8">
        {showSidebarTrigger ? (
          <SidebarTrigger label={t("navigation.toggle")} />
        ) : null}
        <HeaderBreadcrumb pathname={pathname} />
        <button
          disabled
          className="ml-auto hidden h-9 w-64 cursor-not-allowed items-center gap-2 rounded-full border border-transparent bg-secondary px-3 text-sm text-muted-foreground/70 md:flex"
        >
          <Search className="size-3.5" />
          {t("search.label")}
          <span className="ml-auto text-[11px] font-medium">{t("search.planned")}</span>
        </button>
      </header>
    </div>
  );
}
