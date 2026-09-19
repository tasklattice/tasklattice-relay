import { describe, expect, it } from "vitest";
import type { A2aAgentInstance, Instance as Agent } from "@tali/contracts";
import {
  a2aInstanceConfigurationView,
  a2aInstanceRuntimeLogView,
  instanceConfigurationView,
  instanceInteractionAccess,
  instanceRuntimeLogView,
} from "./instance-http-view";

function a2aAgent(): A2aAgentInstance {
  return {
    id: "c70149f6-7dc5-40e2-b0d3-4f2f548ea728",
    agentId: "managed-triage",
    kind: "A2A",
    name: "Triage Agent",
    description: "A managed A2A specialist for repository triage workflows.",
    runtime: "kubernetes",
    status: "READY",
    runtimeNamespace: "tp-abcdefghijklm",
    deploymentName: "tali-a2a-12156ad3de4f83e7",
    serviceName: "tali-a2a-12156ad3de4f83e7",
    podName: "tali-a2a-12156ad3de4f83e7-7954479887-6ntc2",
    labelSelector: "tali.io/instance-key=managed",
    imageReference: "example/triage:v1",
    imageDigest: "example/triage@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    endpoint: "http://tali-a2a.tp.svc.cluster.local:8080",
    agentCardUrl: "http://tali-a2a.tp.svc.cluster.local:8080/.well-known/agent-card.json",
    a2a: null,
    skills: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    logs: ["request token=private-token", "ordinary diagnostic retained"],
    error: "provider authorization=secret-value",
  };
}

function agent(): Agent {
  return {
    schemaVersion: 2,
    id: "11111111-1111-4111-8111-111111111111",
    name: "Research",
    description: "",
    runtime: "openshell",
    agentPlatform: "openclaw",
    policyId: "restricted",
    systemPrompt: "Research safely.",
    accessPolicyIds: ["default"],
    providerAccountId: "gateway",
    providerName: "LiteLLM",
    modelDeploymentId: "routing",
    model: "tali-routing-default",
    modelType: "llm",
    inferenceMode: "PLATFORM_MANAGED",
    modelRoutingId: "routing",
    modelRoutingBindingId: "binding",
    modelRoutingStatus: "READY",
    modelRoutingComplianceDomain: "GLOBAL",
    modelRoutingCapabilities: {
      automaticRouting: "ENABLED",
      routerType: "COMPLEXITY_ROUTER",
      complexityTierCount: 4,
      sessionAffinity: "ENABLED",
      adaptiveRouting: "DISABLED",
      failover: "ENABLED",
      generalFallback: "ENABLED",
      contextWindowFallback: "DISABLED",
      contentPolicyFallback: "DISABLED",
      retries: "ENABLED",
      requestAudit: "ENABLED",
    },
    modelRoutingKeyFingerprint: "token:fingerprint",
    costKeyAlias: "instance-key",
    sandboxName: "tali-research",
    status: "READY",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    logs: [
      "request authorization=Bearer-super-secret",
      "calling https://agent.example/?api_key=provider-secret&mode=test",
      "provider returned sk-plaintext-secret-value",
      "ordinary diagnostic retained",
    ],
    error: "runtime failed token='private-token' with private details",
    httpEndpoint: {
      kind: "openclaw-webui",
      status: "READY",
      url: "https://agent.example/#token=gateway-secret",
    },
  };
}

describe("Agent HTTP views", () => {
  it("never exposes the interaction URL through CONFIG_VIEW", () => {
    const view = instanceConfigurationView(agent());
    expect(view.httpEndpoint).toEqual({
      kind: "openclaw-webui",
      status: "READY",
    });
    expect(JSON.stringify(view)).not.toContain("gateway-secret");
    expect(view.logs).toEqual([]);
    expect(view.error).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("private details");
  });

  it("exposes the endpoint only in the dedicated interaction view", () => {
    expect(instanceInteractionAccess(agent())).toMatchObject({
      instanceId: "11111111-1111-4111-8111-111111111111",
      status: "READY",
      httpEndpoint: {
        url: "https://agent.example/#token=gateway-secret",
      },
    });
  });

  it("exposes runtime diagnostics only through the dedicated logs view", () => {
    expect(instanceRuntimeLogView(agent())).toEqual({
      instanceId: "11111111-1111-4111-8111-111111111111",
      logs: [
        "request authorization=[REDACTED]",
        "calling https://agent.example/?api_key=[REDACTED]&mode=test",
        "provider returned [REDACTED]",
        "ordinary diagnostic retained",
      ],
      error: "runtime failed token=[REDACTED] with private details",
    });
    expect(JSON.stringify(instanceRuntimeLogView(agent()))).not.toMatch(
      /super-secret|provider-secret|plaintext-secret|private-token/,
    );
  });

  it("applies the same configuration/log boundary to managed A2A Instances", () => {
    expect(a2aInstanceConfigurationView(a2aAgent())).toMatchObject({
      logs: [],
      error: null,
    });
    expect(a2aInstanceRuntimeLogView(a2aAgent())).toEqual({
      instanceId: "c70149f6-7dc5-40e2-b0d3-4f2f548ea728",
      logs: ["request token=[REDACTED]", "ordinary diagnostic retained"],
      error: "provider authorization=[REDACTED]",
    });
  });
});
