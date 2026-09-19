import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Circle,
  CircleUserRound,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { AccountAvatar } from "@/components/account/account-avatar";
import { useAccessContext } from "@/components/auth/access-context-provider";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupProjectCapabilities } from "@/features/account/permission-groups";
import {
  ProjectPermissionGroup,
  ProjectPermissionLegend,
} from "@/features/account/project-permission-group";
import { useProject } from "@/hooks/use-project";
import type { SupportedLanguage } from "@/i18n/config";
import { projectRoleToBuiltinRole } from "@/services/access-context";
import {
  applyPlatformPreferences,
  detectedTimezone,
} from "@/lib/platform-preferences";
import { cn } from "@/lib/utils";
import { projectRoleLabels, type Project } from "@/types/project";
import {
  getPersonalProfile,
  personalProfileQueryKey,
  resetLocalPassword,
  updatePersonalProfile,
  type PersonalProfile,
  type PersonalSsoIdentity,
  type ThemePreference,
} from "@/services/personal-profile";

export const Route = createFileRoute("/account")({
  validateSearch: (search): { section?: AccountSection } => {
    const section =
      search.section === "general" ||
      search.section === "access" ||
      search.section === "security"
        ? search.section
        : undefined;
    return section ? { section } : {};
  },
  component: MyAccountPage,
});

type AccountSection = "general" | "access" | "security";

const fallbackTimezones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
];

function getSupportedTimezones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;
  const values = supportedValuesOf?.("timeZone") ?? fallbackTimezones;
  return Array.from(new Set(["UTC", detectedTimezone(), ...values])).sort();
}

function MyAccountPage() {
  const navigate = Route.useNavigate();
  const { section = "general" } = Route.useSearch();
  const queryClient = useQueryClient();
  const { availableProjects, currentProject, refreshProjects } = useProject();
  const profile = useQuery({
    queryKey: personalProfileQueryKey,
    queryFn: getPersonalProfile,
  });
  const [language, setLanguage] = useState<SupportedLanguage>("en-US");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [now, setNow] = useState(() => new Date());
  const timezones = useMemo(getSupportedTimezones, []);

  useEffect(() => {
    if (!profile.data) return;
    setLanguage(profile.data.language);
    setTheme(profile.data.theme);
    setTimezone(profile.data.timezone);
  }, [profile.data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const preferences = useMutation({
    mutationFn: () =>
      updatePersonalProfile({
        language,
        theme,
        timezone,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(personalProfileQueryKey, data);
      applyPlatformPreferences(data);
    },
  });

  const chooseTheme = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    applyPlatformPreferences({ language, theme: nextTheme, timezone });
  };

  const chooseLanguage = (nextLanguage: SupportedLanguage) => {
    setLanguage(nextLanguage);
    applyPlatformPreferences({ language: nextLanguage, theme, timezone });
  };

  const chooseTimezone = (nextTimezone: string) => {
    setTimezone(nextTimezone);
    applyPlatformPreferences({ language, theme, timezone: nextTimezone });
  };

  if (profile.isPending) {
    return (
      <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">
        <Spinner />
        <span className="sr-only">Loading My Account…</span>
      </div>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <div
        role="alert"
        className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive"
      >
        {profile.error?.message ?? "My Account is unavailable."}
      </div>
    );
  }

  const current = profile.data;
  const dirty =
    language !== current.language ||
    theme !== current.theme ||
    timezone !== current.timezone;
  const localTime = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(now);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account"
        description="Manage your identity, access, security, and platform preferences."
      />

      <section className="overflow-hidden rounded-lg border bg-background">
        <Tabs
          value={section}
          onValueChange={(value) => {
            void navigate({
              replace: true,
              search: { section: value as AccountSection },
            });
          }}
        >
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto overflow-y-hidden px-2"
          >
            <TabsTrigger value="general" className="h-11">
              <CircleUserRound />
              General
            </TabsTrigger>
            <TabsTrigger value="access" className="h-11">
              <ShieldCheck />
              Access
            </TabsTrigger>
            <TabsTrigger value="security" className="h-11">
              <KeyRound />
              Security
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-0">
            <div className="divide-y">
              <section className="flex min-h-28 flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <AccountAvatar
                  identity={current}
                  motion="always"
                  className="size-16 shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-display text-xl font-medium">
                      {current.displayName}
                    </h2>
                    <Badge variant="outline">
                      {current.hasPassword ? "Password account" : "SSO account"}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {current.email || current.username}
                  </p>
                </div>
                <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1 text-sm sm:text-right">
                  <dt className="text-muted-foreground">Username</dt>
                  <dd className="font-medium">{current.username}</dd>
                  <dt className="text-muted-foreground">Projects</dt>
                  <dd className="font-medium">{availableProjects.length}</dd>
                </dl>
              </section>

              <form
                className="divide-y"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  if (dirty) preferences.mutate();
                }}
              >
                <PreferenceRow
                  title="Theme"
                  description="Choose how Relay appears on this device."
                >
                  <div className="grid max-w-xl gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["system", Monitor, "System"],
                        ["light", Sun, "Light"],
                        ["dark", Moon, "Dark"],
                      ] as const
                    ).map(([value, Icon, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={theme === value}
                        className={cn(
                          "flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/35",
                          theme === value &&
                            "border-primary/40 bg-primary/[0.07] text-link",
                        )}
                        onClick={() => chooseTheme(value)}
                      >
                        <Icon className="size-4" />
                        <span>{label}</span>
                        {theme === value ? (
                          <Check className="ml-auto size-4" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </PreferenceRow>

                <PreferenceRow
                  title="Language"
                  description="Used for locale-aware dates and account messages."
                >
                  <div className="relative max-w-xl">
                    <Languages
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <select
                      id="account-language"
                      aria-label="Language"
                      className="flex h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={language}
                      onChange={(event) =>
                        chooseLanguage(event.target.value as SupportedLanguage)
                      }
                    >
                      <option value="en-US">English (United States)</option>
                      <option value="zh-CN">简体中文</option>
                      <option value="zh-TW">繁體中文</option>
                    </select>
                  </div>
                </PreferenceRow>

                <PreferenceRow
                  title="Local time zone"
                  description="Controls timestamps shown throughout Relay."
                >
                  <div className="max-w-xl space-y-2">
                    <select
                      id="account-timezone"
                      aria-label="Local time zone"
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={timezone}
                      onChange={(event) => chooseTimezone(event.target.value)}
                    >
                      {timezones.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {localTime} · {timezone.replaceAll("_", " ")}
                    </p>
                  </div>
                </PreferenceRow>

                <div className="flex flex-wrap items-center gap-4 p-5 lg:pl-[18rem]">
                  <Button
                    variant="edit"
                    className="h-11"
                    type="submit"
                    disabled={preferences.isPending || !dirty}
                  >
                    {preferences.isPending ? <Spinner /> : null}
                    Save preferences
                  </Button>
                  {preferences.error ? (
                    <p className="text-sm text-destructive" role="alert">
                      {preferences.error.message}
                    </p>
                  ) : null}
                  {preferences.isSuccess && !dirty ? (
                    <p
                      className="text-sm text-emerald-700 dark:text-emerald-300"
                      role="status"
                    >
                      Account preferences saved.
                    </p>
                  ) : null}
                </div>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="access" className="mt-0">
            {currentProject ? (
              <AccessPanel
                project={currentProject}
                onAccessChanged={refreshProjects}
              />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                Select a Project to review account access.
              </p>
            )}
          </TabsContent>

          <TabsContent value="security" className="mt-0">
            <SecurityPanel profile={current} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

function SecurityPanel({ profile }: { profile: PersonalProfile }) {
  return (
    <div className="divide-y">
      {profile.ssoIdentity ? (
        <SsoIdentityPanel
          identity={profile.ssoIdentity}
          language={profile.language}
          timezone={profile.timezone}
        />
      ) : null}
      <PasswordPanel hasPassword={profile.hasPassword} />
    </div>
  );
}

function SsoIdentityPanel({
  identity,
  language,
  timezone,
}: {
  identity: PersonalSsoIdentity;
  language: SupportedLanguage;
  timezone: string;
}) {
  const synchronizedAt = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: timezone,
  }).format(new Date(identity.synchronizedAt));

  return (
    <section className="p-5">
      <div className="max-w-5xl">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <h2 className="font-sans text-lg font-semibold">SSO identity</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Read-only identity diagnostics from the most recently verified
              SSO ID token. Tokens and secrets are never shown here.
            </p>
          </div>
          <Badge variant="outline">{identity.providerName}</Badge>
        </div>

        <dl className="mt-5 grid overflow-hidden rounded-md border text-sm sm:grid-cols-2">
          <SsoIdentityField label="Provider ID" value={identity.providerId} />
          <SsoIdentityField label="Subject" value={identity.subject} />
          <SsoIdentityField label="Issuer" value={identity.issuer} />
          <SsoIdentityField label="Group claim" value={identity.groupClaim} />
          <SsoIdentityField
            label="Scopes"
            value={identity.scopes.length ? identity.scopes.join(" ") : "Not reported"}
          />
          <SsoIdentityField label="Identity synchronized" value={synchronizedAt} />
        </dl>

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Resolved groups</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Values read from the <code>{identity.groupClaim}</code> claim.
              </p>
            </div>
            <Badge variant="secondary">{identity.groups.length}</Badge>
          </div>

          {identity.groupClaimError ? (
            <p
              className="mt-3 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {identity.groupClaimError}
            </p>
          ) : identity.groups.length ? (
            <ul className="mt-3 divide-y overflow-hidden rounded-md border">
              {identity.groups.map((group) => (
                <li key={group} className="px-3 py-2.5">
                  <code className="break-all text-xs text-foreground">{group}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
              No groups were present in this claim.
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Sign out and sign in again after changing Identity Provider groups
            to refresh these values and their mapped roles.
          </p>
        </div>
      </div>
    </section>
  );
}

function SsoIdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b p-3 last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function PreferenceRow({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[15rem_minmax(0,36rem)] lg:gap-8">
      <div>
        <h3 className="font-sans text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div>{children}</div>
    </div>
  );
}

const projectRoleDescriptions = {
  admin:
    "Manage members, policies, models, routing, and Project configuration.",
  auditor: "Review Project behavior, risk, traces, and compliance evidence.",
  developer: "Build and operate Agent Instances and their assigned resources.",
  user: "Use assigned Agents and participate in personal sessions.",
  reviewer: "Review and decide governed change requests independently.",
} as const;

function AccessPanel({
  onAccessChanged,
  project,
}: {
  onAccessChanged: () => Promise<Project[]>;
  project: Project;
}) {
  const { options: accessOptions, select: selectAccess } = useAccessContext();
  const roleSwitch = useMutation({
    mutationFn: async (role: Project["assignedRoles"][number]) => {
      const option = accessOptions.find((candidate) =>
        candidate.level === "project"
        && candidate.resourceId === project.id
        && candidate.roleId === projectRoleToBuiltinRole[role]
      );
      if (!option) throw new Error("This Project role is not available.");
      return selectAccess(option);
    },
    onSuccess: async (selected) => {
      await onAccessChanged();
      window.location.assign(selected.target);
    },
  });
  const permissionGroups = groupProjectCapabilities(
    project.effectiveCapabilities,
  );
  const departmentRole = project.department.role === "administrator"
    ? "Department Administrator"
    : project.department.role === "member"
      ? "Department Member"
      : "No Department membership";

  return (
    <div id="access-permissions" className="divide-y">
      <section className="p-5">
        <div className="mb-5">
          <h2 className="font-sans text-lg font-semibold">Account access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizational and business access for the selected Project.
          </p>
        </div>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:max-w-3xl">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Department</dt>
            <dd className="mt-1 min-w-0">
              <span className="block truncate font-medium">
                {project.department.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {departmentRole}
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Current Project</dt>
            <dd className="mt-1 truncate font-medium">{project.name}</dd>
          </div>
        </dl>
      </section>

      <section className="p-5">
        <div className="max-w-5xl">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-sans text-lg font-semibold">Assigned Project roles</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                One role is active at a time. Switch directly to any role
                assigned to this Account.
              </p>
            </div>
            <Badge variant="secondary">{project.assignedRoles.length}</Badge>
          </div>
          <div className="mt-3 divide-y rounded-md border">
            {project.assignedRoles.map((role) => {
              const current = role === project.activeRole;
              const switching =
                roleSwitch.isPending && roleSwitch.variables === role;
              return (
                <div
                  key={role}
                  className="flex min-h-16 items-center gap-3 px-3 py-2.5"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      current ? "bg-emerald-500" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm">
                      {projectRoleLabels[role]}
                    </strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {projectRoleDescriptions[role]}
                    </span>
                  </span>
                  {current ? (
                    <Badge variant="outline">Current</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={roleSwitch.isPending}
                      onClick={() => roleSwitch.mutate(role)}
                    >
                      {switching ? <Spinner /> : null}
                      Switch
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {roleSwitch.error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {roleSwitch.error.message}
            </p>
          ) : null}
        </div>
      </section>

      <section className="p-5">
        <div className="max-w-6xl">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-sans text-lg font-semibold">Effective permissions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                All Project permissions, grouped by domain. Status reflects the
                active Project role.
              </p>
            </div>
            <Badge variant="secondary" className="whitespace-nowrap">
              {project.effectiveCapabilities.length} of{" "}
              {permissionGroups.reduce(
                (total, group) => total + group.items.length,
                0,
              )}{" "}
              enabled
            </Badge>
          </div>
          <div className="mt-3">
            <ProjectPermissionLegend />
          </div>
          <div className="mt-4 space-y-2">
            {permissionGroups.map((group, index) => (
              <ProjectPermissionGroup
                key={group.id}
                defaultOpen={index === 0}
                description={group.description}
                items={group.items}
                title={group.title}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisibility, setPasswordVisibility] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const reset = useMutation({
    mutationFn: () =>
      resetLocalPassword({
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordVisibility({ current: false, new: false, confirm: false });
      setOpen(false);
    },
  });

  const clearForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordVisibility({ current: false, new: false, confirm: false });
    reset.reset();
  };

  const setSheetOpen = (nextOpen: boolean) => {
    if (reset.isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) clearForm();
  };

  if (!hasPassword) {
    return (
      <section className="p-5">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <h2 className="font-sans text-lg font-semibold">SSO-managed sign-in</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Password, MFA, and sign-in policy are managed by your identity
            provider.
          </p>
        </div>
      </section>
    );
  }

  const matches = newPassword === confirmPassword;
  const longEnough = newPassword.length >= 12;
  const changed = currentPassword !== newPassword;
  const valid =
    currentPassword.length > 0 &&
    longEnough &&
    matches &&
    changed;

  return (
    <section className="p-5">
      <div className="max-w-4xl">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <h2 className="font-sans text-lg font-semibold">Local password</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Change the password used to sign in to this local account.
            </p>
          </div>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            onClick={() => {
              reset.reset();
              setOpen(true);
            }}
          >
            <KeyRound />
            Reset password
          </Button>
        </div>
        {reset.isSuccess ? (
          <p
            className="mt-4 text-sm text-emerald-700 dark:text-emerald-300"
            role="status"
          >
            Password reset. Use the new password the next time you sign in.
          </p>
        ) : null}
      </div>

      <Sheet open={open} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 sm:max-w-md [&>button]:size-11"
        >
          <SheetHeader className="shrink-0 gap-1.5 border-b px-5 py-5 pr-14 sm:px-6">
            <SheetTitle className="text-xl">Reset password</SheetTitle>
            <SheetDescription className="leading-5">
              Enter your current password, then choose a new password with at
              least 12 characters.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) reset.mutate();
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="current-password">
                    Current password
                  </FieldLabel>
                  <InputGroup className="h-11 rounded-md">
                    <InputGroupInput
                      id="current-password"
                      autoComplete="current-password"
                      autoFocus
                      maxLength={128}
                      required
                      type={passwordVisibility.current ? "text" : "password"}
                      value={currentPassword}
                      onChange={(event) => {
                        if (reset.isError) reset.reset();
                        setCurrentPassword(event.target.value);
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label={passwordVisibility.current
                          ? "Hide current password"
                          : "Show current password"}
                        size="icon-sm"
                        onClick={() => setPasswordVisibility((visibility) => ({
                          ...visibility,
                          current: !visibility.current,
                        }))}
                      >
                        {passwordVisibility.current ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>

                <Field
                  data-invalid={Boolean(newPassword) && (!longEnough || !changed)}
                >
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <InputGroup className="h-11 rounded-md">
                    <InputGroupInput
                      id="new-password"
                      autoComplete="new-password"
                      aria-describedby="new-password-requirements"
                      aria-invalid={Boolean(newPassword) && (!longEnough || !changed)}
                      minLength={12}
                      maxLength={128}
                      required
                      type={passwordVisibility.new ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => {
                        if (reset.isError) reset.reset();
                        setNewPassword(event.target.value);
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label={passwordVisibility.new
                          ? "Hide new password"
                          : "Show new password"}
                        size="icon-sm"
                        onClick={() => setPasswordVisibility((visibility) => ({
                          ...visibility,
                          new: !visibility.new,
                        }))}
                      >
                        {passwordVisibility.new ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription
                    id="new-password-requirements"
                    className="space-y-1.5 text-xs"
                  >
                    <span className="block">Password requirements:</span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        longEnough && "text-emerald-700 dark:text-emerald-300",
                      )}
                    >
                      {longEnough ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Circle className="size-3.5" aria-hidden="true" />
                      )}
                      At least 12 characters
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        newPassword && changed
                          ? "text-emerald-700 dark:text-emerald-300"
                          : undefined,
                      )}
                    >
                      {newPassword && changed ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Circle className="size-3.5" aria-hidden="true" />
                      )}
                      Different from current password
                    </span>
                  </FieldDescription>
                </Field>

                <Field data-invalid={Boolean(confirmPassword) && !matches}>
                  <FieldLabel htmlFor="confirm-password">
                    Confirm new password
                  </FieldLabel>
                  <InputGroup className="h-11 rounded-md">
                    <InputGroupInput
                      id="confirm-password"
                      autoComplete="new-password"
                      aria-invalid={Boolean(confirmPassword) && !matches}
                      minLength={12}
                      maxLength={128}
                      required
                      type={passwordVisibility.confirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => {
                        if (reset.isError) reset.reset();
                        setConfirmPassword(event.target.value);
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label={passwordVisibility.confirm
                          ? "Hide confirmed password"
                          : "Show confirmed password"}
                        size="icon-sm"
                        onClick={() => setPasswordVisibility((visibility) => ({
                          ...visibility,
                          confirm: !visibility.confirm,
                        }))}
                      >
                        {passwordVisibility.confirm ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {confirmPassword && !matches ? (
                    <FieldError>New passwords do not match.</FieldError>
                  ) : null}
                </Field>
              </FieldGroup>
              {reset.error ? (
                <FieldError
                  className="mt-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2"
                >
                  {reset.error.message}
                </FieldError>
              ) : null}
            </div>
            <SheetFooter className="shrink-0 flex-col-reverse items-stretch gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6 [&_[data-slot=button]]:h-11">
              <Button
                type="button"
                variant="outline"
                disabled={reset.isPending}
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="edit"
                type="submit"
                disabled={reset.isPending || !valid}
              >
                {reset.isPending ? <Spinner /> : <KeyRound />}
                Reset password
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}
