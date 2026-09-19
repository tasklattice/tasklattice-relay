import { agentGardenEntrySchema } from "@tali/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgentDiscoveryClient } from "./agent-discovery";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpAgentDiscoveryClient", () => {
  it("keeps a managed container on its internal Service endpoint", async () => {
    const endpoint = "http://tali-a2a-test.tp-abcdefghijklm.svc.cluster.local:8080";
    const agent = agentGardenEntrySchema.parse({
      id: "managed-agent",
      name: "Managed Agent",
      description: "A managed container used for delegated research tasks.",
      source: "PROJECT_REGISTERED",
      integrationType: "a2a",
      platformLabel: "A2A Container",
      category: "Research",
      owner: "Research Platform",
      tags: [],
      status: "UNCHECKED",
      usageMode: "CALLABLE",
      usageCapabilities: {
        interactive: false,
        canDelegate: false,
        acceptsDelegation: true,
      },
      endpoint,
      agentCardUrl: `${endpoint}/.well-known/agent-card.json`,
      a2a: null,
      authType: "none",
      authReference: "",
      internalNetworkOnly: true,
      configuration: { onboardingSource: "CONTAINER_IMAGE" },
      skills: [],
      specializationId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      name: "Managed Agent",
      description: "A managed Agent that handles delegated research tasks.",
      version: "1.0.0",
      supportedInterfaces: [{
        url: "https://advertised.example.com/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      }],
      capabilities: {
        streaming: false,
        pushNotifications: false,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{
        id: "research",
        name: "Research",
        description: "Researches a delegated topic.",
        tags: ["Research"],
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const result = await new HttpAgentDiscoveryClient().discover(agent);

    expect(result.endpoint).toBe(endpoint);
    expect(result.skills).toEqual([{
      id: "research",
      name: "Research",
      description: "Researches a delegated topic.",
      tags: ["Research"],
    }]);
    expect(result.a2a).toMatchObject({
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
  });

  it("rejects an endpoint that does not publish an A2A 1.0 Agent Card", async () => {
    const endpoint = "https://agents.example.com/support";
    const agent = agentGardenEntrySchema.parse({
      id: "remote-agent",
      name: "Remote Agent",
      description: "A remote Agent used for delegated support tasks.",
      source: "PROJECT_REGISTERED",
      integrationType: "a2a",
      platformLabel: "A2A Standard",
      category: "Support",
      owner: "Support Platform",
      tags: [],
      status: "UNCHECKED",
      usageMode: "CALLABLE",
      usageCapabilities: {
        interactive: false,
        canDelegate: false,
        acceptsDelegation: true,
      },
      endpoint: null,
      agentCardUrl: `${endpoint}/.well-known/agent-card.json`,
      a2a: null,
      authType: "none",
      authReference: "",
      internalNetworkOnly: false,
      configuration: { onboardingSource: "EXISTING_AGENT" },
      skills: [],
      specializationId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      name: "Remote Agent",
      status: "ok",
    }), { status: 200 })));

    await expect(
      new HttpAgentDiscoveryClient().discover(agent),
    ).rejects.toThrow("does not conform to A2A 1.0");
  });
});
