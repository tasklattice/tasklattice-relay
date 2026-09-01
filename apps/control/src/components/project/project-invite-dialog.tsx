import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { inviteMember } from "@/services/project";
import {
  projectRoleLabels,
  type HumanProjectMember,
  type Project,
  type ProjectRole,
} from "@/types/project";

export function ProjectInviteDialog({
  canAssignRoles,
  onInvited,
  onOpenChange,
  open,
  project,
}: {
  canAssignRoles: boolean;
  onInvited: (member: HumanProjectMember) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: Project;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("developer");
  const invite = useMutation({
    mutationFn: () => inviteMember(project.id, { email: email.trim(), role }),
    onSuccess: async (member) => {
      await onInvited(member);
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole("developer");
      invite.reset();
    }
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    invite.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5 pr-16">
          <SheetTitle>Invite member</SheetTitle>
          <SheetDescription>
            Invite someone to collaborate in {project.name}. If they are
            already a member, this adds the selected role.
          </SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="project-invite-email" required>Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="project-invite-email"
                  className="h-11 pl-9"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={invite.isError}
                  autoFocus
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-invite-role" required>Role</Label>
              <Select
                disabled={!canAssignRoles}
                value={role}
                onValueChange={(value) => setRole(value as ProjectRole)}
                required
              >
                <SelectTrigger
                  id="project-invite-role"
                  className="h-11 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["developer", "user", "auditor", "admin", "reviewer"] as const)
                    .map((roleId) => (
                      <SelectItem key={roleId} value={roleId}>
                        {projectRoleLabels[roleId]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {invite.isError ? (
              <p
                className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {invite.error.message}
              </p>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end border-t px-6 py-4">
            <Button
              className="h-11"
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-11"
              type="submit"
              disabled={invite.isPending || !email.trim() || !canAssignRoles}
            >
              {invite.isPending ? <Spinner /> : <Send />}
              Send invite
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
