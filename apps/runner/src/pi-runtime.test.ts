import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInstanceSchema, getAgentPlatformDefinition } from "@tali/contracts";
import { getAgentPlatformRuntime } from "./agent-platform.js";
import { openShellNemoClawProbeArguments, openShellTerminalArguments } from "./openshell.js";

describe("Pi native runtime", () => {
  it("preserves sessions and rejects unsafe configuration and credentials", () => {
    const result = spawnSync("python3", [fileURLToPath(new URL("../../../scripts/testing/pi-runtime.test.py", import.meta.url))], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it("uses the native terminal without advertising unsupported capabilities", () => {
    const definition = getAgentPlatformDefinition("pi");
    expect(definition.interactionSurface).toBe("terminal");
    expect(definition.capabilities).toEqual({ interactive: true, memory: "none", canDelegate: false, acceptsDelegation: false, embeddedRunTelemetry: false });
    const runtime = getAgentPlatformRuntime("pi");
    expect(runtime.endpointKind).toBeUndefined();
    expect(openShellNemoClawProbeArguments("pi-test", "pi")).toContain("/bin/bash");
    expect(openShellNemoClawProbeArguments("hermes-test", "hermes")).toContain("/bin/sh");
    expect(openShellTerminalArguments("pi-test", "pi")).toContain("exec /usr/local/bin/tali-pi --continue");
    const script = runtime.bootstrapScript("", "", "http://example.com/v1", "model");
    expect(script).toContain("exec /usr/local/bin/nemoclaw-start");
  });

  it("rejects unsupported bindings before provisioning", () => {
    const input = { name: "pi-test", runtime: "openshell", agentPlatform: "pi", accessPolicyIds: ["00000000-0000-4000-8000-000000000001"], modelRoutingId: "routing", systemPrompt: "You are a coding agent." };
    expect(createInstanceSchema.safeParse(input).success).toBe(true);
    for (const binding of [{ memory: { mode: "native" } }, { durableMemoryId: "00000000-0000-4000-8000-000000000002" }, { mcpServerIds: ["mcp"] }, { skillIds: ["skill"] }, { knowledgeSourceIds: ["knowledge"] }]) {
      expect(createInstanceSchema.safeParse({ ...input, ...binding }).success).toBe(false);
    }
  });
});
