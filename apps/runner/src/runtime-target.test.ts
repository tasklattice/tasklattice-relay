import { getRunnerConfig, setRunnerConfigForTests } from "./runner-config.js";
import { afterEach, describe, expect, it } from "vitest";
import { projectServiceRoute } from "./project-service-proxy.js";
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
      namespace: "tp-abcdefghijklmnop",
    })).toEqual({
      gatewayEndpoint:
        "http://openshell-tp-abcdefghijklmnop.tp-abcdefghijklmnop.svc.cluster.local:8080",
      serviceBaseUrl: "https://openshell.example.test",
      workspace: "tp-abcdefghijklmnop",
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
      namespace: "tp-abcdefghijklmnop",
    })).toMatchObject({
      gatewayEndpoint:
        "http://shared-openshell.tali.svc.cluster.local:8080",
      workspace: "tp-abcdefghijklmnop",
    });
  });

  it("keys volatile Runner state by target and sandbox", () => {
    expect(sandboxStateKey("i-example", {
      namespace: "tp-abcdefghijklmnop",
    })).not.toBe(sandboxStateKey("i-example", {
      namespace: "tp-bcdefghijklmnopa",
    }));
  });

  it("routes only a complete workspace-qualified OpenShell service host", () => {
    expect(projectServiceRoute(
      "tp-abcdefghijklmnop--i-example--webui.openshell.example.test",
      "https://openshell.example.test",
    )).toEqual({
      upstreamHost:
        "openshell-tp-abcdefghijklmnop.tp-abcdefghijklmnop.svc.cluster.local",
      upstreamPort: 8080,
      upstreamProtocol: "http:",
      workspace: "tp-abcdefghijklmnop",
    });
    expect(projectServiceRoute(
      "default--i-example--webui.openshell.example.test",
      "https://openshell.example.test",
    )).toBeUndefined();
    expect(projectServiceRoute(
      "tp-abcdefghijklmnop.openshell.example.test",
      "https://openshell.example.test",
    )).toBeUndefined();
  });

  it("does not route two Project service hosts through the same Gateway", () => {
    const serviceBaseUrl = "https://openshell.example.test";
    const first = projectServiceRoute(
      "tp-abcdefghijklmnop--i-shared--webui.openshell.example.test",
      serviceBaseUrl,
    );
    const second = projectServiceRoute(
      "tp-bcdefghijklmnopa--i-shared--webui.openshell.example.test",
      serviceBaseUrl,
    );

    expect(first).toMatchObject({
      upstreamHost:
        "openshell-tp-abcdefghijklmnop.tp-abcdefghijklmnop.svc.cluster.local",
      workspace: "tp-abcdefghijklmnop",
    });
    expect(second).toMatchObject({
      upstreamHost:
        "openshell-tp-bcdefghijklmnopa.tp-bcdefghijklmnopa.svc.cluster.local",
      workspace: "tp-bcdefghijklmnopa",
    });
    expect(first?.upstreamHost).not.toBe(second?.upstreamHost);
    expect(sandboxStateKey("i-shared", {
      namespace: first!.workspace,
    })).not.toBe(sandboxStateKey("i-shared", {
      namespace: second!.workspace,
    }));
  });
});

afterEach(() => setRunnerConfigForTests());
