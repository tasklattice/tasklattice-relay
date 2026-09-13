import { Fragment } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useProject } from "@/hooks/use-project";
import { cn } from "@/lib/utils";

const routeLabelKeys = {
  "access-policies": "routes.accessPolicies",
  "agent-garden": "routes.agentGarden",
  agents: "routes.agents",
  "audit-logs": "routes.auditLogs",
  cost: "routes.cost",
  help: "routes.help",
  instances: "routes.instances",
  "vector-databases": "routes.vectorDatabases",
  memory: "routes.memory",
  "mcp-servers": "routes.mcpServers",
  notifications: "routes.notifications",
  account: "routes.account",
  requests: "routes.requests",
  "requests/new": "routes.requestsNew",
  runtime: "routes.runtime",
  "runtime-policies": "routes.runtimePolicies",
  setting: "routes.setting",
  "setting/model-routings": "routes.modelRoutings",
  skills: "routes.skills",
  traces: "routes.traces",
} as const;

const detailLabelKeys = {
  "access-policies": "details.accessPolicies",
  "agent-garden": "details.agentGarden",
  agents: "details.agents",
  instances: "details.instances",
  "vector-databases": "details.vectorDatabases",
  "setting/model-routings": "details.modelRoutings",
} as const;

export interface HeaderBreadcrumbItem {
  href: string;
  label: string;
}

function decodePathPart(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function getHeaderBreadcrumbItems(
  pathname: string,
  t: TFunction<"breadcrumbs">,
): HeaderBreadcrumbItem[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "account") return [];
  if (parts[0] === "platform") {
    return [{ href: "/platform/settings", label: t("platformSetting") }];
  }
  if (parts[0] === "departments" && parts[1]) {
    return [{ href: pathname, label: t("departmentSettings") }];
  }
  const projectId = parts[0];
  const routeParts = parts.slice(1);
  return routeParts.map((part, routeIndex) => {
    const index = routeIndex + 1;
    const routeKey = routeParts.slice(0, routeIndex + 1).join("/");
    const parentKey = routeParts.slice(0, routeIndex).join("/");
    const routeLabelKey =
      routeLabelKeys[routeKey as keyof typeof routeLabelKeys];
    const detailLabelKey =
      detailLabelKeys[parentKey as keyof typeof detailLabelKeys];
    const label = routeLabelKey
      ? t(routeLabelKey)
      : detailLabelKey
        ? t(detailLabelKey)
        : decodePathPart(part);
    return {
      href: `/${[projectId, ...parts.slice(1, index + 1)].join("/")}`,
      label,
    };
  });
}

export function HeaderBreadcrumb({ pathname }: { pathname: string }) {
  const { currentProject } = useProject();
  const { t } = useTranslation("breadcrumbs");
  const items = getHeaderBreadcrumbItems(pathname, t);
  const lastIndex = items.length - 1;
  const departmentRoute = pathname.startsWith("/departments/");
  const platformRoute = pathname.startsWith("/platform/");
  const accountRoute = pathname.replace(/\/$/, "") === "/account";
  const departmentId = pathname.split("/").filter(Boolean)[1];
  const rootTitle = accountRoute
    ? t("routes.account")
    : platformRoute
      ? t("rootPlatform")
      : departmentRoute
        ? currentProject?.department.id === departmentId
          ? currentProject?.department.name ??
            departmentId ??
            t("rootDepartment")
          : departmentId ?? t("rootDepartment")
        : currentProject?.name ?? t("rootProject");

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <span
        className="max-w-36 shrink-0 truncate font-medium text-foreground sm:max-w-48"
        title={rootTitle}
      >
        {rootTitle}
      </span>
      {items.map((item, index) => {
        const current = index === lastIndex;
        return (
          <Fragment key={item.href}>
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 text-muted-foreground/70",
                !current && "hidden md:inline",
              )}
            >
              /
            </span>
            <span
              aria-current={current ? "page" : undefined}
              className={cn(
                "shrink-0",
                current
                  ? "min-w-0 truncate font-medium text-foreground"
                  : "hidden md:inline",
              )}
              title={item.label}
            >
              {item.label}
            </span>
          </Fragment>
        );
      })}
    </nav>
  );
}
