import { describe, expect, it } from "vitest";
import type { AgentMarketplaceBrief } from "@tali/contracts";
import {
  agentCatalogSeedVersion,
  databaseAgentCatalog,
} from "./database-agent-catalog";

describe("database Agent marketplace catalog", () => {
  it("publishes a complete brief for every callable catalog entry", () => {
    expect(agentCatalogSeedVersion).toBe("2026-08-31.1");

    for (const agent of databaseAgentCatalog) {
      const brief = JSON.parse(
        agent.configuration.marketplaceBrief ?? "{}",
      ) as AgentMarketplaceBrief;
      expect(brief.tagline).toBeTruthy();
      expect(brief.overview.length).toBeGreaterThan(80);
      expect(brief.useCases.length).toBeGreaterThanOrEqual(2);
      expect(brief.inputs.length).toBeGreaterThanOrEqual(2);
      expect(brief.outputs.length).toBeGreaterThanOrEqual(2);
      expect(brief.requirements.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(agent.configuration.workflow ?? "[]")).not.toHaveLength(
        0,
      );
      expect(agent.integrationType).toBe("a2a");
      expect(agent.a2a).toMatchObject({
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      });
    }
  });

  it("keeps domain-specific marketplace content for the imported blueprints", () => {
    const customerService = databaseAgentCatalog.find(
      (agent) => agent.id === "adk-customer-service",
    );
    const brief = JSON.parse(
      customerService?.configuration.marketplaceBrief ?? "{}",
    ) as AgentMarketplaceBrief;

    expect(brief.tagline).toContain("multimodal support evidence");
    expect(brief.requirements).toContain(
      "Human approval policy for credits, refunds, or account changes",
    );
  });
});
