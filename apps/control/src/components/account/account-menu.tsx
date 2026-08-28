import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Bell, ChevronDown, CircleUserRound, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AccountAvatar } from "@/components/account/account-avatar";
import { useAccessContext } from "@/components/auth/access-context-provider";
import type { AuthUser } from "@/components/auth/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getNotifications,
  notificationsQueryKey,
} from "@/services/notifications";

type AccountMenuProps = {
  collapsed?: boolean;
  onLogout: () => void | Promise<void>;
  projectId: string;
  user: AuthUser | null;
};

function UserAvatar({
  user,
  size = "default",
}: {
  user: AuthUser | null;
  size?: "default" | "large";
}) {
  return (
    <AccountAvatar
      identity={user}
      motion="always"
      className={cn(
        size === "large" ? "size-10" : "size-7",
      )}
    />
  );
}

export function AccountMenu({
  collapsed = false,
  onLogout,
  projectId,
  user,
}: AccountMenuProps) {
  const { t } = useTranslation("sidebar");
  const { active } = useAccessContext();
  const displayName = user?.displayName || user?.username || t("account.user");
  const accountLabel = user?.hasPassword
    ? t("account.localAccount")
    : t("account.ssoAccount");
  const activeAccessLabel = active
    ? `${active.roleLabel} · ${active.resourceName}`
    : accountLabel;
  const notifications = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: getNotifications,
    staleTime: 30_000,
  });
  const unreadCount = notifications.data?.unreadCount ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.openMenu", { displayName })}
          className={cn(
            "group flex items-center rounded-md text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/55 data-[state=open]:bg-sidebar-accent",
            collapsed
              ? "mx-auto size-11 justify-center"
              : "h-9 w-full gap-2.5 px-3",
          )}
        >
          <UserAvatar user={user} />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 text-left">
                <strong className="block truncate text-xs">
                  {displayName}
                </strong>
                <span className="block truncate text-[10px] text-sidebar-foreground/55">
                  {activeAccessLabel}
                </span>
              </span>
              <ChevronDown className="size-3.5 text-sidebar-foreground/55 transition-transform group-data-[state=open]:rotate-180" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? "start" : "center"}
        side={collapsed ? "right" : "top"}
        className="w-64"
      >
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <UserAvatar
            user={user}
            size="large"
          />
          <span className="min-w-0">
            <strong className="block truncate text-sm font-semibold">
              {displayName}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {user?.email || user?.username}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/access">
            <ArrowLeftRight className="size-4" />
            Switch access
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account">
            <CircleUserRound className="size-4" />
            {t("account.account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/$projectId/notifications" params={{ projectId }}>
            <Bell className="size-4" />
            {t("account.notifications")}
            {unreadCount ? (
              <span className="ml-auto min-w-5 rounded-sm bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={() => void onLogout()}
        >
          <LogOut className="size-4" />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
