import { describe, expect, it } from "vitest";
import { createPlatformI18n } from "@/i18n/create-i18n";
import {
  itemIsActive,
  navGroups,
  navigationItemAvailable,
  routeIsGlobal,
  routeUsesFullBleedLayout,
  routeUsesStandaloneContextSidebar,
} from "./app-shell";

describe("Project control-plane navigation", () => {
  it("uses Home as a section label with Instances and Memory beneath it", () => {
    expect(navGroups.map((group) => group.labelKey)).toEqual([
      "home",
      "capabilityToolbox",
      "governance",
      "evidence",
    ]);
    expect(navGroups.map((group) => group.items.map((item) => item.labelKey))).toEqual([
      ["instances", "memory"],
      ["specialistAgents", "skills", "mcpConnections", "vectorDatabases"],
      ["accessPolicies", "runtimePolicies"],
      ["traces", "auditLogs", "cost"],
    ]);
    expect(navGroups.flatMap((group) => group.items.map((item) => item.labelKey))).not.toContain("home");
  });

  it("localizes every navigation group and item for Simplified Chinese", () => {
    const t = createPlatformI18n("zh-CN").getFixedT("zh-CN", "sidebar");
    expect(navGroups.map((group) => t(`navigation.groups.${group.labelKey}`))).toEqual([
      "主页",
      "能力工具箱",
      "治理",
      "运行记录",
    ]);
    expect(navGroups.map((group) => group.items.map((item) =>
      t(`navigation.items.${item.labelKey}`),
    ))).toEqual([
      ["实例", "记忆"],
      ["专家智能体", "技能", "MCP 连接", "向量数据库"],
      ["访问策略", "运行时策略"],
      ["追踪记录", "审计日志", "成本"],
    ]);
  });

  it("gives Instances and Memory their own active states", () => {
    const instances = navGroups[0]!.items[0]!;
    const memory = navGroups[0]!.items[1]!;
    expect(itemIsActive(instances, "/p-hr/instances", "p-hr")).toBe(true);
    expect(itemIsActive(instances, "/p-hr/instances/runtime-1", "p-hr")).toBe(true);
    expect(itemIsActive(instances, "/p-hr/memory", "p-hr")).toBe(false);
    expect(itemIsActive(memory, "/p-hr/memory", "p-hr")).toBe(true);
    expect(itemIsActive(memory, "/p-hr/instances", "p-hr")).toBe(false);
  });

  it("hides Memory when the Project rollout flag is disabled", () => {
    const memory = navGroups[0]!.items[1]!;
    const instances = navGroups[0]!.items[0]!;
    expect(navigationItemAvailable(memory, {
      canViewAuditLogs: true,
      durableMemoryEnabled: false,
    })).toBe(false);
    expect(navigationItemAvailable(memory, {
      canViewAuditLogs: true,
      durableMemoryEnabled: true,
    })).toBe(true);
    expect(navigationItemAvailable(instances, {
      canViewAuditLogs: false,
      durableMemoryEnabled: false,
    })).toBe(true);
  });

  it("keeps nested resource pages active within their visible navigation item", () => {
    const specialistAgents = navGroups[1]!.items[0]!;
    const accessPolicies = navGroups[2]!.items[0]!;
    expect(
      itemIsActive(specialistAgents, "/p-hr/agent-garden/catalog-agent", "p-hr"),
    ).toBe(true);
    expect(
      itemIsActive(accessPolicies, "/p-hr/access-policies/policy-1", "p-hr"),
    ).toBe(true);
  });

  it("gives routes with secondary navigation a full-bleed layout", () => {
    expect(routeUsesFullBleedLayout("/platform/settings")).toBe(true);
    expect(routeUsesFullBleedLayout("/platform/settings/")).toBe(true);
    expect(routeUsesFullBleedLayout("/proj1/help")).toBe(true);
    expect(routeUsesFullBleedLayout("/proj1/help/")).toBe(true);
    expect(routeUsesFullBleedLayout("/departments/dep1")).toBe(true);
    expect(routeUsesFullBleedLayout("/departments/dep1/")).toBe(true);
    expect(routeUsesFullBleedLayout("/proj1/setting")).toBe(true);
    expect(routeUsesFullBleedLayout("/proj1/setting/")).toBe(true);
    expect(routeUsesFullBleedLayout("/proj1/instances")).toBe(false);
    expect(routeUsesFullBleedLayout("/proj1/help/article")).toBe(false);
    expect(routeUsesFullBleedLayout("/proj1/setting/model-routings/routing-1")).toBe(false);
  });

  it("promotes Platform and Department settings to standalone sidebars", () => {
    expect(routeUsesStandaloneContextSidebar("/platform/settings")).toBe(true);
    expect(routeUsesStandaloneContextSidebar("/platform/settings/")).toBe(true);
    expect(routeUsesStandaloneContextSidebar("/departments/dep1")).toBe(true);
    expect(routeUsesStandaloneContextSidebar("/departments/dep1/")).toBe(true);
    expect(routeUsesStandaloneContextSidebar("/proj1/setting")).toBe(false);
    expect(routeUsesStandaloneContextSidebar("/proj1/help")).toBe(false);
    expect(routeUsesStandaloneContextSidebar("/proj1/instances")).toBe(false);
  });

  it("keeps Account available outside Project context", () => {
    expect(routeIsGlobal("/account")).toBe(true);
    expect(routeIsGlobal("/account/")).toBe(true);
    expect(routeIsGlobal("/proj1/account")).toBe(false);
  });
});
