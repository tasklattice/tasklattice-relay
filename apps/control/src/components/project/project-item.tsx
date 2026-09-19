import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";

const avatarTones = [
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
];

function projectInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "W";
}

function toneForProject(projectId: string): string {
  const value = Array.from(projectId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return avatarTones[value % avatarTones.length] ?? avatarTones[0]!;
}

export function ProjectAvatar({
  className,
  project,
}: {
  className?: string;
  project: Project;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {project.avatar ? (
        <AvatarImage alt="" src={project.avatar} />
      ) : null}
      <AvatarFallback
        className={cn(
          "text-xs font-semibold",
          toneForProject(project.id),
        )}
      >
        {projectInitial(project.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function ProjectItem({
  current = false,
  isSwitching = false,
  onSelect,
  tabIndex,
  project,
}: {
  current?: boolean;
  isSwitching?: boolean;
  onSelect: (project: Project) => void | Promise<void>;
  tabIndex?: number;
  project: Project;
}) {
  const detail = `${project.memberCount} ${project.memberCount === 1 ? "member" : "members"}`;

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/35",
        current && "bg-primary/[0.07] hover:bg-primary/[0.1]",
        isSwitching && "cursor-wait",
      )}
      onClick={() => {
        if (!current && !isSwitching) void onSelect(project);
      }}
      aria-checked={current}
      aria-current={current ? "true" : undefined}
      aria-disabled={current || isSwitching}
      data-project-menu-item
      role="menuitemradio"
      tabIndex={tabIndex}
    >
      <ProjectAvatar project={project} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {project.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {detail}
        </span>
      </span>
      {isSwitching ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : current ? (
        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-link">
          Current
        </span>
      ) : null}
    </button>
  );
}
