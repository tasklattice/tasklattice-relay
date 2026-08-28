import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Building2,
  LoaderCircle,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { storeProjectId } from "@/lib/project-storage";
import type {
  AccessContextLevel,
  AccessContextOption,
} from "@/services/access-context";
import { useAccessContext } from "./access-context-provider";
import { useAuth } from "./auth-provider";

const groupPresentation: Record<AccessContextLevel, {
  description: string;
  icon: LucideIcon;
  title: string;
}> = {
  platform: {
    description: "Platform-wide administration",
    icon: Settings2,
    title: "Platform",
  },
  department: {
    description: "Department-scoped administration",
    icon: Building2,
    title: "Departments",
  },
  project: {
    description: "Project business and operational work",
    icon: Boxes,
    title: "Projects",
  },
};

const levels: AccessContextLevel[] = ["platform", "department", "project"];

function AccessOptionRow({
  current,
  onSelect,
  option,
  selecting,
}: {
  current: boolean;
  onSelect: (option: AccessContextOption) => void;
  option: AccessContextOption;
  selecting: boolean;
}) {
  return (
    <button
      type="button"
      disabled={selecting}
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
          {current ? <Badge variant="outline">Current</Badge> : null}
        </span>
        <span className="mt-1 block text-xs font-medium text-foreground/80">
          {option.roleLabel}
        </span>
        <span className="mt-1 hidden text-xs leading-5 text-muted-foreground md:block">
          {option.description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground">
        {selecting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        <span className="hidden sm:inline">{current ? "Continue" : "Use access"}</span>
        {!selecting ? <ArrowRight className="size-4" /> : null}
      </span>
    </button>
  );
}

export function AccessContextSelection() {
  const { logout, user } = useAuth();
  const { active, error: loadError, loading, options, reload, select } = useAccessContext();
  const [query, setQuery] = useState("");
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const autoSelectionStarted = useRef(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => [
      option.resourceName,
      option.roleLabel,
      option.description,
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [options, query]);

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
        reason instanceof Error ? reason.message : "Unable to select access.",
      );
      setSelectingId(null);
    }
  }, [select]);

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
      <header className="border-b">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <BrandLogo />
          <span className="ml-auto hidden text-right sm:block">
            <strong className="block text-xs font-semibold">
              {user?.displayName || user?.username}
            </strong>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {user?.email}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            <LogOut />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
          Account access
        </p>
        <h1 className="mt-4 font-display text-4xl font-light tracking-[-0.005em] sm:text-5xl">
          Choose how to enter
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Select one assigned role and scope for this session. You can switch
          access later from the Account menu.
        </p>

        {options.length > 6 ? (
          <label className="relative mt-8 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search assigned access"
              className="h-11 pl-10"
              placeholder="Search Departments, Projects, or roles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}

        {loadError || selectionError ? (
          <div className="mt-7 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            <strong className="font-semibold">Access selection failed</strong>
            <span className="mt-1 block">{selectionError || loadError}</span>
            {loadError ? (
              <Button className="mt-3" size="sm" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-10 flex min-h-40 items-center justify-center border text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            Loading assigned access…
          </div>
        ) : null}

        {!loading && !options.length && !loadError ? (
          <div className="mt-10 border px-6 py-10 text-center">
            <h2 className="font-display text-2xl font-medium">No access assigned</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Your Account is active, but it has no Platform, Department, or
              Project role. Contact an administrator to request access.
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
                        {presentation.title}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {presentation.description}
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
            No assigned access matches “{query}”.
          </p>
        ) : null}
      </section>
    </main>
  );
}
