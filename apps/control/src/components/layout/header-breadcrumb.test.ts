import { describe, expect, it } from "vitest";
import { createPlatformI18n } from "@/i18n/create-i18n";
import { getHeaderBreadcrumbItems } from "./header-breadcrumb";

const englishT = createPlatformI18n("en-US").getFixedT(
  "en-US",
  "breadcrumbs",
);
const chineseT = createPlatformI18n("zh-CN").getFixedT(
  "zh-CN",
  "breadcrumbs",
);

describe("getHeaderBreadcrumbItems", () => {
  it.each([
    ["instances", "Runtime Instances"],
    ["agents", "Agents"],
    ["memory", "Memory"],
    ["agent-garden", "Agent Garden"],
    ["skills", "Skills"],
    ["mcp-servers", "MCP Servers"],
    ["vector-databases", "Vector Databases"],
    ["access-policies", "Access Policies"],
    ["runtime-policies", "Runtime Policies"],
    ["setting", "Project Settings"],
    ["traces", "Traces"],
    ["audit-logs", "Audit Logs"],
    ["cost", "Cost"],
    ["help", "Help & documentation"],
  ])("keeps %s directly beneath the Project", (segment, label) => {
    expect(getHeaderBreadcrumbItems(`/individual/${segment}`, englishT)).toEqual([
      { href: `/individual/${segment}`, label },
    ]);
  });

  it("localizes the Help breadcrumb in Simplified Chinese", () => {
    expect(getHeaderBreadcrumbItems("/individual/help", chineseT)).toEqual([
      { href: "/individual/help", label: "帮助与文档" },
    ]);
  });

  it("keeps only the real resource hierarchy for Instance details", () => {
    expect(getHeaderBreadcrumbItems("/web3/instances/devops", englishT)).toEqual([
      { href: "/web3/instances", label: "Runtime Instances" },
      { href: "/web3/instances/devops", label: "Instance details" },
    ]);
  });

  it("keeps Agent development routes in the Agent hierarchy", () => {
    expect(getHeaderBreadcrumbItems("/web3/agents/agent-1", englishT)).toEqual([
      { href: "/web3/agents", label: "Agents" },
      { href: "/web3/agents/agent-1", label: "Agent details" },
    ]);
  });

  it("uses canonical request language", () => {
    expect(getHeaderBreadcrumbItems("/individual/requests/new", englishT)).toEqual([
      { href: "/individual/requests", label: "Requests" },
      { href: "/individual/requests/new", label: "Raise Request" },
    ]);
  });

  it("distinguishes Account from Project settings", () => {
    expect(getHeaderBreadcrumbItems("/account", englishT)).toEqual([]);
    expect(getHeaderBreadcrumbItems("/individual/setting", englishT)).toEqual([
      { href: "/individual/setting", label: "Project Settings" },
    ]);
  });

  it("keeps Platform Setting outside the Project hierarchy", () => {
    expect(getHeaderBreadcrumbItems("/platform/settings", englishT)).toEqual([
      { href: "/platform/settings", label: "Platform Setting" },
    ]);
  });

  it("uses a stable label for Agent marketplace details", () => {
    expect(
      getHeaderBreadcrumbItems(
        "/individual/agent-garden/adk-customer-service",
        englishT,
      ),
    ).toEqual([
      {
        href: "/individual/agent-garden",
        label: "Agent Garden",
      },
      {
        href: "/individual/agent-garden/adk-customer-service",
        label: "Agent details",
      },
    ]);
  });

  it("uses route-aware labels for nested Project settings", () => {
    expect(
      getHeaderBreadcrumbItems(
        "/individual/setting/model-routings/routing%2Fprimary",
        englishT,
      ),
    ).toEqual([
      { href: "/individual/setting", label: "Project Settings" },
      {
        href: "/individual/setting/model-routings",
        label: "Routing",
      },
      {
        href: "/individual/setting/model-routings/routing%2Fprimary",
        label: "Routing details",
      },
    ]);
  });

  it("does not mistake a dynamic resource id for a route label", () => {
    expect(getHeaderBreadcrumbItems("/individual/instances/memory", englishT)).toEqual([
      { href: "/individual/instances", label: "Runtime Instances" },
      {
        href: "/individual/instances/memory",
        label: "Instance details",
      },
    ]);
  });
});
