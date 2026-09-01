import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  Building2,
  ChevronDown,
  CircleUserRound,
  LoaderCircle,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountAvatar } from "@/components/account/account-avatar";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { storeProjectId } from "@/lib/project-storage";
import type {
  AccessContextLevel,
  AccessContextOption,
} from "@/services/access-context";
import { useAccessContext } from "./access-context-provider";
import { useAuth, type AuthUser } from "./auth-provider";

const groupPresentation: Record<AccessContextLevel, {
  descriptionKey:
    | "groups.platform.description"
    | "groups.department.description"
    | "groups.project.description";
  icon: LucideIcon;
  titleKey:
    | "groups.platform.title"
    | "groups.department.title"
    | "groups.project.title";
}> = {
  platform: {
    descriptionKey: "groups.platform.description",
    icon: Settings2,
    titleKey: "groups.platform.title",
  },
  department: {
    descriptionKey: "groups.department.description",
    icon: Building2,
    titleKey: "groups.department.title",
  },
  project: {
    descriptionKey: "groups.project.description",
    icon: Boxes,
    titleKey: "groups.project.title",
  },
};

const levels: AccessContextLevel[] = ["platform", "department", "project"];

function AccessAccountMenu({
  onLogout,
  user,
}: {
  onLogout: () => void | Promise<void>;
  user: AuthUser | null;
}) {
  const { t } = useTranslation("sidebar");
  const displayName = user?.displayName || user?.username || t("account.user");
  const accountType = user?.hasPassword
    ? t("account.localAccount")
    : t("account.ssoAccount");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.openMenu", { displayName })}
          className="group flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-secondary sm:gap-2.5 sm:px-2"
        >
          <AccountAvatar
            identity={user}
            className="size-8 shrink-0"
          />
          <span className="hidden min-w-0 md:block">
            <strong className="block max-w-40 truncate text-xs font-semibold leading-4">
              {displayName}
            </strong>
            <span className="block max-w-40 truncate text-[11px] leading-4 text-muted-foreground">
              {accountType}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-3 px-3 py-2.5 font-normal">
          <AccountAvatar identity={user} className="size-10 shrink-0" />
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
          <Link to="/account">
            <CircleUserRound className="size-4" />
            {t("account.account")}
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

export function AccessHeader({
  onLogout,
  user,
}: {
  onLogout: () => void | Promise<void>;
  user: AuthUser | null;
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-[4.5rem] max-w-4xl items-center gap-3 px-5 sm:px-8">
        <BrandLogo className="shrink-0" />
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <LanguageSwitcher
            compactOnMobile
            size="default"
            className="h-11 bg-background sm:min-w-32"
          />
          <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <AccessAccountMenu onLogout={onLogout} user={user} />
        </div>
      </div>
    </header>
  );
}

const rolePresentationKeys = {
  ROLE_PLATFORM_ADMIN: {
    description: "roles.platformAdministrator.description",
    label: "roles.platformAdministrator.label",
  },
  ROLE_DEPARTMENT_ADMIN: {
    description: "roles.departmentAdministrator.description",
    label: "roles.departmentAdministrator.label",
  },
  ROLE_PROJECT_ADMIN: {
    description: "roles.projectAdministrator.description",
    label: "roles.projectAdministrator.label",
  },
  ROLE_AGENT_DEVELOPER: {
    description: "roles.agentDeveloper.description",
    label: "roles.agentDeveloper.label",
  },
  ROLE_USER: {
    description: "roles.user.description",
    label: "roles.user.label",
  },
  ROLE_AUDITOR: {
    description: "roles.auditor.description",
    label: "roles.auditor.label",
  },
  ROLE_REVIEWER: {
    description: "roles.reviewer.description",
    label: "roles.reviewer.label",
  },
} as const satisfies Record<AccessContextOption["roleId"], {
  description: `roles.${string}.description`;
  label: `roles.${string}.label`;
}>;

function AccessOptionRow({
  current,
  onSelect,
  option,
  selectionPending,
  selecting,
}: {
  current: boolean;
  onSelect: (option: AccessContextOption) => void;
  option: AccessContextOption;
  selectionPending: boolean;
  selecting: boolean;
}) {
  const { t } = useTranslation("access");
  const rolePresentation = rolePresentationKeys[option.roleId];

  return (
    <button
      type="button"
      aria-busy={selecting}
      disabled={selectionPending}
      onClick={() => onSelect(option)}
      className="group flex min-h-20 w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:bg-muted/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-60 sm:px-5"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
        <ShieldCheck className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="truncate text-sm font-semibold">
            {option.resourceName}
          </strong>
          {current ? <Badge variant="outline">{t("current")}</Badge> : null}
        </span>
        <span className="mt-1 block text-xs font-medium text-foreground/80">
          {t(rolePresentation.label)}
        </span>
        <span className="mt-1 hidden text-xs leading-5 text-muted-foreground md:block">
          {t(rolePresentation.description)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground">
        {selecting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        <span className="hidden sm:inline">
          {current ? t("actions.continue") : t("actions.useAccess")}
        </span>
        {!selecting ? <ArrowRight className="size-4" /> : null}
      </span>
    </button>
  );
}

export function AccessContextSelection() {
  const { t } = useTranslation("access");
  const { logout, user } = useAuth();
  const { active, error: loadError, loading, options, reload, select } = useAccessContext();
  const [query, setQuery] = useState("");
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const autoSelectionStarted = useRef(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      const rolePresentation = rolePresentationKeys[option.roleId];
      return [
        option.resourceName,
        option.roleLabel,
        option.description,
        t(rolePresentation.label),
        t(rolePresentation.description),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [options, query, t]);

  const choose = useCallback(async (option: AccessContextOption) => {
    setSelectingId(option.id);
    setSelectionError("");
    try {
      const selected = await select(option);
      if (selected.level === "project" && selected.resourceId) {
        storeProjectId(selected.resourceId);
      }
      window.location.assign(selected.target);
    } catch (reason) {
      setSelectionError(
        reason instanceof Error ? reason.message : t("error.selectionFallback"),
      );
      setSelectingId(null);
    }
  }, [select, t]);

  useEffect(() => {
    if (
      loading
      || active
      || options.length !== 1
      || autoSelectionStarted.current
    ) {
      return;
    }
    autoSelectionStarted.current = true;
    void choose(options[0]!);
  }, [active, choose, loading, options]);

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AccessHeader onLogout={logout} user={user} />

      <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
          {t("kicker")}
        </p>
        <h1 className="mt-4 font-display text-4xl font-light tracking-[-0.005em] sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          {t("description")}
        </p>

        {options.length > 6 ? (
          <label className="relative mt-8 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("search.label")}
              className="h-11 pl-10"
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}

        {loadError || selectionError ? (
          <div className="mt-7 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            <strong className="font-semibold">{t("error.title")}</strong>
            <span className="mt-1 block">{selectionError || loadError}</span>
            {loadError ? (
              <Button className="mt-3" size="sm" variant="outline" onClick={() => void reload()}>
                {t("actions.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-10 flex min-h-40 items-center justify-center border text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : null}

        {!loading && !options.length && !loadError ? (
          <div className="mt-10 border px-6 py-10 text-center">
            <h2 className="font-display text-2xl font-medium">
              {t("empty.title")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {t("empty.description")}
            </p>
          </div>
        ) : null}

        {!loading ? (
          <div className="mt-9 space-y-8">
            {levels.map((level) => {
              const group = filtered.filter((option) => option.level === level);
              if (!group.length) return null;
              const presentation = groupPresentation[level];
              const Icon = presentation.icon;
              return (
                <section key={level} aria-labelledby={`access-${level}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <Icon className="size-4 text-muted-foreground" />
                    <span>
                      <h2 id={`access-${level}`} className="text-sm font-semibold">
                        {t(presentation.titleKey)}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(presentation.descriptionKey)}
                      </p>
                    </span>
                    <Badge className="ml-auto" variant="secondary">
                      {group.length}
                    </Badge>
                  </div>
                  <div className="divide-y overflow-hidden rounded-md border bg-card">
                    {group.map((option) => (
                      <AccessOptionRow
                        key={option.id}
                        current={active?.id === option.id}
                        onSelect={(selected) => void choose(selected)}
                        option={option}
                        selectionPending={selectingId !== null}
                        selecting={selectingId === option.id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {!loading && options.length && !filtered.length ? (
          <p className="mt-10 border px-5 py-8 text-center text-sm text-muted-foreground">
            {t("search.noMatches", { query })}
          </p>
        ) : null}
      </section>
    </main>
  );
}
