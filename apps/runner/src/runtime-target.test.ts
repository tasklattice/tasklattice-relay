import { getRunnerConfig, setRunnerConfigForTests } from "./runner-config.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveOpenShellTarget,
  sandboxStateKey,
} from "./runtime-target.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("Project OpenShell target routing", () => {
  it("derives a trusted in-cluster Gateway without accepting a request URL", () => {
    getRunnerConfig().openshell.gatewayEndpointTemplate =
      "http://openshell-{namespace}.{namespace}.svc.cluster.local:8080";
    getRunnerConfig().openshell.serviceBaseUrl = "https://openshell.example.test";

    expect(resolveOpenShellTarget({
      namespace: "tp-abcdefghijklm",
    })).toEqual({
      gatewayEndpoint:
        "http://openshell-tp-abcdefghijklm.tp-abcdefghijklm.svc.cluster.local:8080",
      serviceBaseUrl: "https://openshell.example.test",
      workspace: "tp-abcdefghijklm",
    });
  });

  it("rejects Namespaces outside the Relay runtime-target identity format", () => {
    expect(() => resolveOpenShellTarget({ namespace: "kube-system" }))
      .toThrow("Relay-managed Namespace");
  });

  it("keeps the target contract when a newer OpenShell uses one shared Gateway", () => {
    getRunnerConfig().openshell.gatewayEndpointTemplate =
      "http://shared-openshell.tali.svc.cluster.local:8080";

    expect(resolveOpenShellTarget({
      namespace: "tp-abcdefghijklm",
    })).toMatchObject({
      gatewayEndpoint:
        "http://shared-openshell.tali.svc.cluster.local:8080",
      workspace: "tp-abcdefghijklm",
    });
  });

  it("keys volatile Runner state by target and sandbox", () => {
    expect(sandboxStateKey("i-example", {
      namespace: "tp-abcdefghijklm",
    })).not.toBe(sandboxStateKey("i-example", {
      namespace: "tp-bcdefghijklmn",
    }));
  });


});

afterEach(() => setRunnerConfigForTests());
