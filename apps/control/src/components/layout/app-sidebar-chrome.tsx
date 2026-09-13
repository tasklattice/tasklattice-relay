import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountMenu } from "@/components/account/account-menu";
import { useAccessContext } from "@/components/auth/access-context-provider";
import type { AuthUser } from "@/components/auth/auth-provider";
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebarBrandLink({
  compact,
  projectId,
}: {
  compact: boolean;
  projectId: string;
}) {
  const { t } = useTranslation("sidebar");
  const { setOpenMobile } = useSidebar();
  const { active } = useAccessContext();
  const href = active?.target ?? `/${encodeURIComponent(projectId)}`;

  return (
    <a
      href={href}
      onClick={() => setOpenMobile(false)}
      className="flex min-h-11 min-w-0 items-center gap-3 px-2 focus-visible:outline-2 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      aria-label={t("brandHome")}
    >
      <BrandLogo compact={compact} />
    </a>
  );
}

export function AppSidebarUtilityFooter({
  collapsed,
  logout,
  pathname,
  projectId,
  user,
}: {
  collapsed: boolean;
  logout: () => void | Promise<void>;
  pathname: string;
  projectId: string;
  user: AuthUser | null;
}) {
  const { t } = useTranslation("sidebar");
  const { setOpenMobile } = useSidebar();
  const helpActive = pathname.replace(/\/$/, "") === `/${encodeURIComponent(projectId)}/help`;

  return (
    <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={helpActive}
            tooltip={t("help.label")}
          >
            <Link
              to="/$projectId/help"
              params={{ projectId }}
              onClick={() => setOpenMobile(false)}
              aria-current={helpActive ? "page" : undefined}
              aria-label={t("help.label")}
            >
              <CircleHelp />
              <span>{t("help.label")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div className="mt-2 border-t border-sidebar-border pt-3">
        <AccountMenu
          collapsed={collapsed}
          onLogout={logout}
          projectId={projectId}
          user={user}
        />
      </div>
    </SidebarFooter>
  );
}
