import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  projectNameSchema,
  scopedEntityNameLimits,
} from "@tali/contracts";
import { Building2, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { AccountAvatar } from "@/components/account/account-avatar";
import type { AuthUser } from "@/components/auth/auth-provider";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createProject } from "@/services/project";
import { getDepartments } from "@/services/department";
import { createPlatformProject } from "@/services/platform-settings";
import { useProject } from "@/hooks/use-project";
import { projectRoleLabels, type ProjectRole } from "@/types/project";

type InitialInvitation = {
  email: string;
  role: ProjectRole;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateProjectSheet({
  authority = "department",
  departmentOptions,
  onCreated,
  onOpenChange,
  open,
  user,
}: {
  authority?: "department" | "platform";
  departmentOptions?: Array<{ id: string; name: string }>;
  onCreated: (projectId: string, projectName: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: AuthUser | null;
}) {
  const { currentProject } = useProject();
  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("developer");
  const [invitations, setInvitations] = useState<InitialInvitation[]>([]);
  const [inviteError, setInviteError] = useState("");
  const creatorEmail = (
    user?.email?.trim() || (user?.username ? `${user.username}@tali.local` : "")
  ).toLowerCase();
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: getDepartments,
    enabled: open && !departmentOptions,
    staleTime: 30_000,
  });
  const availableDepartments = departmentOptions ?? departments.data;
  const validatedName = projectNameSchema.safeParse(name);

  useEffect(() => {
    if (!open || !availableDepartments) return;
    if (
      departmentId &&
      availableDepartments.some((department) => department.id === departmentId)
    ) {
      return;
    }
    const currentDepartmentId = currentProject?.department.id;
    setDepartmentId(
      availableDepartments.some(
        (department) => department.id === currentDepartmentId,
      )
        ? (currentDepartmentId ?? "")
        : (availableDepartments[0]?.id ?? ""),
    );
  }, [availableDepartments, currentProject?.department.id, departmentId, open]);

  const reset = () => {
    setDepartmentId("");
    setName("");
    setEmail("");
    setRole("developer");
    setInvitations([]);
    setInviteError("");
    create.reset();
  };

  const create = useMutation({
    mutationFn: () =>
      (authority === "platform" ? createPlatformProject : createProject)({
        departmentId,
        name: name.trim(),
        invitations,
      }),
    onSuccess: async (project) => {
      await onCreated(project.id, project.name);
      reset();
      onOpenChange(false);
    },
  });

  const addInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailPattern.test(normalizedEmail)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    if (normalizedEmail === creatorEmail) {
      setInviteError("You are already included as the Project administrator.");
      return;
    }
    if (
      invitations.some((invitation) => invitation.email === normalizedEmail)
    ) {
      setInviteError("This email address is already in the invitation list.");
      return;
    }
    setInvitations((current) => [...current, { email: normalizedEmail, role }]);
    setEmail("");
    setRole("developer");
    setInviteError("");
  };

  const close = () => {
    if (create.isPending) return;
    reset();
    onOpenChange(false);
  };

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
        } else {
          close();
        }
      }}
      eyebrow="Project"
      title="New Project"
      description="Create an isolated Project and invite its initial members."
      width="md"
      footer={
        <>
          <Button variant="outline" disabled={create.isPending} onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!departmentId || !validatedName.success || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner /> : <Plus />}
            Create Project
            {invitations.length ? (
              <span className="text-primary-foreground/70">
                · {invitations.length}{" "}
                {invitations.length === 1 ? "invite" : "invites"}
              </span>
            ) : null}
          </Button>
        </>
      }
    >
      <div className="space-y-7">
        <div className="space-y-2">
          <Label htmlFor="new-project-department" required>Department</Label>
          <Select value={departmentId} onValueChange={setDepartmentId} required>
            <SelectTrigger
              id="new-project-department"
              size="lg"
              className="w-full"
              disabled={
                (!departmentOptions && departments.isPending)
                || !availableDepartments?.length
              }
            >
              <Building2 className="size-4 text-muted-foreground" />
              <SelectValue
                placeholder={
                  !departmentOptions && departments.isPending
                    ? "Loading Departments…"
                    : "Select a Department"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {availableDepartments?.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            The Project inherits its organizational budget boundary from this
            Department.
          </p>
          {departments.error ? (
            <p
              className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {departments.error.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-project-name" required>Project name</Label>
          <Input
            id="new-project-name"
            className="h-11"
            value={name}
            maxLength={scopedEntityNameLimits.max}
            aria-invalid={Boolean(name) && !validatedName.success}
            onChange={(event) => {
              setName(event.target.value);
              create.reset();
            }}
            placeholder="AI Trading Agent"
            required
            autoFocus
          />
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
            {scopedEntityNameLimits.min}–{scopedEntityNameLimits.max} characters.
            Slashes, backslashes, and control characters are not allowed. The
            name is unique inside the selected Department and cannot be changed.
          </p>
          {name && !validatedName.success ? (
            <p className="text-xs text-destructive" role="alert">
              {validatedName.error.issues[0]?.message}
            </p>
          ) : null}
        </div>

        <section aria-labelledby="project-creator-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                id="project-creator-heading"
                className="text-sm font-semibold"
              >
                Creator
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The creator always joins as an Admin.
              </p>
            </div>
            <Badge variant="secondary">Admin</Badge>
          </div>
          <div className="mt-3 flex min-h-16 items-center gap-3 border-y py-3">
            <AccountAvatar identity={user} className="size-9" />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">
                {user?.displayName || user?.username || "Current user"}
              </strong>
              <span className="block truncate text-xs text-muted-foreground">
                {creatorEmail || "Current account"} · You
              </span>
            </span>
            <LockKeyhole
              className="size-4 shrink-0 text-muted-foreground"
              aria-label="Creator role is fixed"
            />
          </div>
        </section>

        <section aria-labelledby="project-invitations-heading">
          <div>
            <h3
              id="project-invitations-heading"
              className="text-sm font-semibold"
            >
              Invite members
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Add one member at a time.
            </p>
          </div>

          <form
            className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
            onSubmit={addInvitation}
          >
            <div className="grid gap-2">
              <Label htmlFor="project-invite-email">Email</Label>
              <Input
                id="project-invite-email"
                className="h-11"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setInviteError("");
                }}
                placeholder="name@company.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as ProjectRole)}
              >
                <SelectTrigger
                  id="project-invite-role"
                  size="lg"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      "developer",
                      "user",
                      "auditor",
                      "admin",
                      "reviewer",
                    ] as const
                  ).map((roleId) => (
                    <SelectItem key={roleId} value={roleId}>
                      {projectRoleLabels[roleId]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="outline" className="h-11">
              <Plus />
              Add
            </Button>
          </form>

          {inviteError ? (
            <p
              className="mt-2 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {inviteError}
            </p>
          ) : null}

          {invitations.length ? (
            <div className="mt-4 overflow-hidden border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/35 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="w-12 px-2 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invitations.map((invitation) => (
                    <tr key={invitation.email}>
                      <td className="max-w-0 truncate px-3 py-3">
                        {invitation.email}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline">
                          {projectRoleLabels[invitation.role]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${invitation.email}`}
                          onClick={() =>
                            setInvitations((current) =>
                              current.filter(
                                (item) => item.email !== invitation.email,
                              ),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
              No additional members yet.
            </p>
          )}
        </section>

        {create.error ? (
          <p
            className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {create.error.message}
          </p>
        ) : null}
      </div>
    </EntitySheet>
  );
}
