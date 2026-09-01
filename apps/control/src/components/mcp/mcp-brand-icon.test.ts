import { describe, expect, it } from "vitest";
import type { McpServerTemplate } from "@tali/contracts";
import { resolveMcpServerBrand } from "./mcp-brand-icon";

const templates: McpServerTemplate[] = [
  {
    id: "cloudflare-docs",
    name: "Cloudflare Documentation",
    description: "Search current Cloudflare product documentation.",
    category: "Example",
    logo: "cloudflare",
    sourceUrl: "https://github.com/cloudflare/mcp-server-cloudflare",
    transport: "http",
    endpointPlaceholder: "https://docs.mcp.cloudflare.com/mcp",
    defaultAuthType: "none",
    args: [],
  },
];

describe("resolveMcpServerBrand", () => {
  it("uses the referenced built-in template", () => {
    expect(resolveMcpServerBrand({
      templateId: "cloudflare-docs",
      name: "Project docs",
      endpoint: "https://another.example/mcp",
    }, templates)).toBe("cloudflare");
  });

  it("recognizes older instances by normalized endpoint", () => {
    expect(resolveMcpServerBrand({
      name: "Cloudflare Documentation",
      endpoint: "https://docs.mcp.cloudflare.com/mcp/",
    }, templates)).toBe("cloudflare");
  });

  it("uses TaskLattice Relay branding for the local example server", () => {
    expect(resolveMcpServerBrand({
      name: "TaskLattice Relay Example MCP",
      endpoint: "http://tali-example-mcp:3000/mcp",
    }, templates)).toBe("tali");
  });

  it("keeps the vendor brand when a local gateway exposes vendor tools", () => {
    expect(resolveMcpServerBrand({
      name: "Release 0 Read-only GitHub",
      endpoint: "http://tali-relay-example-mcp:3000/mcp",
      sourceUrl: "https://github.com/tasklattice/tasklattice-relay",
    }, templates)).toBe("github");
  });

  it("keeps unknown custom servers on the generic fallback", () => {
    expect(resolveMcpServerBrand({
      name: "Private tools",
      endpoint: "https://mcp.example.com",
    }, templates)).toBe("");
  });
});
