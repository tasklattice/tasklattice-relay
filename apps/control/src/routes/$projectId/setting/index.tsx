import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Database,
  FolderKanban,
  Gauge,
  LockKeyhole,
  Route as RouteIcon,
  ServerCog,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { ContextSidebarLayout } from "@/components/layout/context-sidebar-layout";
import {
  ContextSettingsMobileNavigation,
  ContextSettingsSidebar,
  type ContextSettingsSectionGroup,
} from "@/components/layout/context-settings-navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectModelRoutingsSettings } from "@/components/project/project-model-routing-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectMembers } from "@/components/project/project-members";
import { ProjectQuotaSettings } from "@/components/project/project-quota-settings";
import { DeleteProjectSheet } from "@/components/project/delete-project-sheet";
import { useProject } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import type { Project } from "@/types/project";

export const Route = createFileRoute("/$projectId/setting/")({
  validateSearch: (search): { section?: ProjectSettingsSection } => {
    const section =
      search.section === "members" ||
      search.section === "providers" ||
      search.section === "models" ||
      search.section === "routing" ||
      search.section === "quota" ||
      search.section === "settings"
        ? search.section
        : undefined;
    return section ? { section } : {};
  },
  component: ProjectSettingsPage,
});

type ProjectSettingsSection =
  | "settings"
  | "members"
  | "providers"
  | "models"
  | "routing"
  | "quota";

const sectionGroups = [
  {
    label: "Project",
    items: [
      { id: "settings", label: "General", icon: FolderKanban },
      { id: "members", label: "Members", icon: Users },
    ],
  },
  {
    label: "Inference",
    items: [
      { id: "providers", label: "Providers", icon: ServerCog },
      { id: "models", label: "Models", icon: Database },
      { id: "routing", label: "Routing", icon: RouteIcon },
    ],
  },
  {
    label: "Governance",
    items: [{ id: "quota", label: "Quota", icon: Gauge }],
  },
] as const satisfies readonly ContextSettingsSectionGroup<ProjectSettingsSection>[];

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const { section = "settings" } = Route.useSearch();
  const {
    currentProject: project,
    refreshProjects,
    selectProject,
  } = useProject();
  const permissions = useProjectPermissions();
  const changeSection = (next: ProjectSettingsSection) => {
    void navigate({ replace: true, search: { section: next } });
  };
  const renderLayout = (content: ReactNode) => (
    <ContextSidebarLayout
      sidebarWidth="15rem"
      sidebar={(
        <ContextSettingsSidebar
          ariaLabel="Project settings sections"
          disabled={!permissions.canManageProject}
          groups={sectionGroups}
          header={(
            <>
              <strong className="truncate font-display text-xl font-medium">
                {project?.name ?? projectId}
              </strong>
              <span className="text-xs text-muted-foreground">Project Administrator</span>
            </>
          )}
          section={section}
          onSectionChange={changeSection}
        />
      )}
      mobileNavigation={(
        <ContextSettingsMobileNavigation
          ariaLabel="Project settings section"
          disabled={!permissions.canManageProject}
          groups={sectionGroups}
          section={section}
          onSectionChange={changeSection}
        />
      )}
    >
      {content}
    </ContextSidebarLayout>
  );

  if (!project) {
    return renderLayout(
      <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">
        Loading Project settings…
      </div>,
    );
  }

  if (!permissions.canManageProject) {
    return renderLayout(
      <section
        className="mx-auto max-w-xl px-6 py-16 text-center"
        aria-labelledby="project-settings-restricted"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full border bg-muted/35 text-muted-foreground">
          <ShieldCheck className="size-5" />
        </span>
        <h1
          id="project-settings-restricted"
          className="mt-5 font-display text-2xl font-medium"
        >
          Project settings are restricted
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Only Project administrators can manage Project identity, members,
          Providers, models, routing, and quota. Your personal details remain available
          from Account in the account menu.
        </p>
      </section>,
    );
  }

  return renderLayout(
    <div className="mx-auto w-full max-w-[1600px] space-y-7 p-5 sm:p-6 lg:p-8">
      <PageHeader
        title="Project Setting"
        badge={(
          <Badge className="border-primary/20 bg-primary/7 text-primary" variant="outline">
            <ShieldCheck />
            Project Administrator
          </Badge>
        )}
        description="Manage Project identity, human membership, Providers, models, routing, and quota."
      />

      <section className="min-w-0 overflow-hidden border-b">
        {section === "settings" ? (
          <ProjectGeneralSettings
            project={project}
            onDeleted={async () => {
              const remaining = await refreshProjects();
              const fallback = remaining.find(
                (candidate) => candidate.id !== project.id,
              );
              if (fallback) await selectProject(fallback.id);
            }}
          />
        ) : null}
        {section === "members" ? <ProjectMembers project={project} /> : null}
        {section === "providers" || section === "models" || section === "routing" ? (
          <ProjectModelRoutingsSettings
            project={project}
            view={section}
            onViewChange={changeSection}
          />
        ) : null}
        {section === "quota" ? <ProjectQuotaSettings project={project} /> : null}
      </section>
    </div>,
  );
}

function ProjectGeneralSettings({
  onDeleted,
  project,
}: {
  onDeleted: () => void | Promise<void>;
  project: Project;
}) {
  const permissions = useProjectPermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="divide-y">
      <div className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold">Project profile</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review the immutable Project identity used by URLs, audit records, and resource ownership.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-5">
        <span className="text-sm font-medium">Project name</span>
        <div className="flex min-h-12 max-w-lg items-center gap-3 border bg-muted/20 px-4">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
          <strong className="min-w-0 flex-1 truncate text-sm">{project.name}</strong>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Immutable</span>
        </div>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          Project names are unique inside their Department and are permanently fixed at creation. This protects stable URLs, audit records, and resource ownership.
        </p>
      </div>

      <div className="grid gap-1 p-5 text-sm">
        <span className="font-medium">Project ID</span>
        <code className="text-xs text-muted-foreground">{project.id}</code>
      </div>

      {permissions.canDeleteProject ? (
        <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-destructive">
              Delete Project
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently remove this Project and its isolated resources.
            </p>
          </div>
          <Button
            className="h-11"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete Project
          </Button>
          <DeleteProjectSheet
            open={deleteOpen}
            project={project}
            onOpenChange={setDeleteOpen}
            onScheduled={() => onDeleted()}
          />
        </div>
      ) : null}
    </div>
  );
}
