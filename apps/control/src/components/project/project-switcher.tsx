import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  Check,
  ChevronsUpDown,
  LoaderCircle,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProjectAvatar } from "@/components/project/project-item";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useProject } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { defaultLanguage, normalizeLanguage } from "@/i18n/config";
import { cn } from "@/lib/utils";

export function ProjectSwitcher({
  collapsed = false,
  onProjectSettingsOpen,
  onProjectSwitchSuccess,
}: {
  collapsed?: boolean;
  onProjectSettingsOpen: () => void;
  onProjectSwitchSuccess: (projectName: string) => void;
}) {
  const { i18n, t } = useTranslation("sidebar");
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
    defaultLanguage;
  const {
    availableProjects: projects,
    currentProject,
    isSwitching,
    loading,
    selectProject,
    switchingProjectId,
  } = useProject();
  const permissions = useProjectPermissions();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [switchError, setSwitchError] = useState("");

  const departmentGroups = useMemo(() => {
    const groups = Array.from(
      projects.reduce(
        (groupMap, project) => {
          const group = groupMap.get(project.department.id) ?? {
            department: project.department,
            projects: [],
          };
          group.projects.push(project);
          groupMap.set(project.department.id, group);
          return groupMap;
        },
        new Map<
          string,
          {
            department: (typeof projects)[number]["department"];
            projects: typeof projects;
          }
        >(),
      ),
    ).map(([, group]) => ({
      ...group,
      projects: [...group.projects].sort((left, right) => {
        if (left.id === currentProject?.id) return -1;
        if (right.id === currentProject?.id) return 1;
        return left.name.localeCompare(right.name, language);
      }),
    }));

    return groups.sort((left, right) => {
      if (left.department.id === currentProject?.department.id) return -1;
      if (right.department.id === currentProject?.department.id) return 1;
      return left.department.name.localeCompare(
        right.department.name,
        language,
      );
    });
  }, [currentProject?.department.id, currentProject?.id, language, projects]);

  const filteredDepartmentGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(language);
    if (!normalizedQuery) return departmentGroups;

    return departmentGroups
      .map((group) => ({
        ...group,
        projects: group.projects.filter((project) =>
          `${project.name} ${project.department.name}`
            .toLocaleLowerCase(language)
            .includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.projects.length > 0);
  }, [departmentGroups, language, query]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setSwitchError("");
    }
  };

  const handleSelect = async (projectId: string, projectName: string) => {
    if (projectId === currentProject?.id || isSwitching) return;
    setSwitchError("");
    try {
      await selectProject(projectId);
      setOpen(false);
      setQuery("");
      onProjectSwitchSuccess(projectName);
    } catch (reason) {
      setSwitchError(
        reason instanceof Error
          ? reason.message
          : t("projectSwitcher.switchError"),
      );
    }
  };

  if (loading && !currentProject) {
    return (
      <div
        aria-label={t("projectSwitcher.loading")}
        className={cn(
          "h-12 animate-pulse rounded-md bg-[var(--sidebar-hover)]",
          collapsed ? "w-12" : "w-full",
        )}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            currentProject
              ? t("projectSwitcher.currentProject", {
                  projectName: `${currentProject.department.name}/${currentProject.name}`,
                })
              : t("projectSwitcher.noProject")
          }
          className={cn(
            "group flex min-h-12 items-center rounded-md border border-sidebar-border bg-[var(--sidebar-control)] text-left outline-none transition-[background-color,border-color]",
            "hover:border-sidebar-foreground/15 hover:bg-[var(--sidebar-control-hover)] focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar data-[state=open]:border-sidebar-foreground/15 data-[state=open]:bg-[var(--sidebar-control-hover)] disabled:opacity-45",
            collapsed
              ? "mx-auto size-12 justify-center px-0"
              : "w-full gap-2.5 px-2.5",
          )}
          disabled={isSwitching}
        >
          {currentProject ? (
            <ProjectAvatar
              className="size-7 ring-1 ring-sidebar-border"
              project={currentProject}
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--sidebar-active)] text-xs font-semibold text-sidebar-foreground"
            >
              P
            </span>
          )}
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-5 text-sidebar-foreground">
                  {currentProject
                    ? currentProject.name
                    : t("projectSwitcher.noProject")}
                </span>
                {currentProject ? (
                  <span className="block truncate text-[11px] leading-4 text-sidebar-foreground/55">
                    {currentProject.department.name}
                  </span>
                ) : null}
              </span>
              {isSwitching ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin text-sidebar-foreground/55" />
              ) : (
                <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/55 transition-colors group-hover:text-sidebar-foreground" />
              )}
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side={collapsed ? "right" : "bottom"}
        className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0 shadow-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        <div className="border-b p-3">
          <label className="sr-only" htmlFor="project-switcher-search">
            {t("projectSwitcher.searchPlaceholder")}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              id="project-switcher-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("projectSwitcher.searchPlaceholder")}
              className="h-10 bg-background pl-9 pr-3 shadow-none"
            />
          </div>
        </div>

        <div
          aria-label={t("projectSwitcher.projects")}
          className="max-h-80 overflow-y-auto overscroll-contain p-2"
        >
          {filteredDepartmentGroups.length ? (
            filteredDepartmentGroups.map((group, groupIndex) => (
              <section
                key={group.department.id}
                aria-labelledby={`project-group-${group.department.id}`}
                className={cn(groupIndex > 0 && "mt-2 border-t pt-2")}
              >
                <div className="flex min-h-8 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
                  <Building2 className="size-3.5" aria-hidden="true" />
                  <h3
                    id={`project-group-${group.department.id}`}
                    className="min-w-0 flex-1 truncate font-medium"
                  >
                    {group.department.name}
                  </h3>
                  <span className="font-mono text-[10px] tabular-nums">
                    {t("projectSwitcher.projectCount", {
                      count: group.projects.length,
                    })}
                  </span>
                </div>

                <ul className="space-y-0.5">
                  {group.projects.map((project) => {
                    const current = project.id === currentProject?.id;
                    const switching = project.id === switchingProjectId;
                    return (
                      <li key={project.id}>
                        <div
                          className={cn(
                            "group/project flex min-h-12 items-stretch rounded-md transition-colors",
                            current
                              ? "bg-primary/[0.07] text-primary"
                              : "hover:bg-muted/65",
                          )}
                        >
                          <button
                            type="button"
                            aria-pressed={current}
                            aria-disabled={current || isSwitching}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35",
                              current &&
                                permissions.canManageProject &&
                                "rounded-r-none",
                              isSwitching && "cursor-wait",
                            )}
                            onClick={() => {
                              void handleSelect(project.id, project.name);
                            }}
                          >
                            <ProjectAvatar
                              className="size-7"
                              project={project}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {project.name}
                              </span>
                              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                                {t("projectSwitcher.members", {
                                  count: project.memberCount,
                                })}
                              </span>
                            </span>
                            {switching ? (
                              <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                            ) : current ? (
                              <Check
                                aria-label={t("projectSwitcher.current")}
                                className="size-4 shrink-0 text-primary"
                              />
                            ) : null}
                          </button>

                          {current && permissions.canManageProject ? (
                            <Link
                              to="/$projectId/setting"
                              params={{ projectId: project.id }}
                              aria-label={t("projectSwitcher.projectSettings", {
                                projectName: project.name,
                              })}
                              title={t("projectSwitcher.projectSettings", {
                                projectName: project.name,
                              })}
                              className="grid w-11 shrink-0 place-items-center rounded-r-md border-l border-primary/15 text-primary outline-none transition-colors hover:bg-primary/[0.08] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35"
                              onClick={() => {
                                setOpen(false);
                                onProjectSettingsOpen();
                              }}
                            >
                              <Settings aria-hidden="true" className="size-4" />
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <div className="px-4 py-8 text-center">
              <Search
                aria-hidden="true"
                className="mx-auto size-5 text-muted-foreground/60"
              />
              <p className="mt-2 text-sm font-medium text-foreground">
                {t("projectSwitcher.noMatches", { query: query.trim() })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("projectSwitcher.tryAnotherSearch")}
              </p>
            </div>
          )}
        </div>

        {switchError ? (
          <p
            className="mx-3 mb-2 border-l-2 border-destructive bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
            role="alert"
          >
            {switchError}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
