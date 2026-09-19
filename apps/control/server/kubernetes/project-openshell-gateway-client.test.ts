import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import {
  HelmProjectOpenShellGatewayClient,
  type CommandInput,
  type ProjectOpenShellGatewayConfiguration,
} from "./project-openshell-gateway-client";

const configuration: ProjectOpenShellGatewayConfiguration = {
  chart: "/opt/tali/helm/openshell.tgz",
  enabled: true,
  gatewayResources: {
    limits: { cpu: "1", memory: "1Gi" },
    requests: { cpu: "100m", memory: "128Mi" },
  },
  gatewayImageRepository: "registry.example/openshell/gateway",
  gatewayImageTag: "0.0.106",
  imagePullSecrets: [{ name: "gateway-pull" }],
  imagePullPolicy: "IfNotPresent",
  releaseName: "openshell",
  sandboxImage: "registry.example/nemoclaw/sandbox-base:v0.0.114",
  sandboxImagePullSecrets: [{ name: "sandbox-pull" }],
  sandboxImagePullPolicy: "IfNotPresent",
  serviceNamePrefix: "openshell-",
  supervisorImageRepository: "registry.example/openshell/supervisor",
  supervisorImagePullPolicy: "Never",
  supervisorImageTag: "0.0.106",
  workspaceDefaultStorageSize: "2Gi",
};

const target = {
  namespace: "tp-abcdefghijklm",
  projectId: "project-a",
  projectName: "Customer Support",
};

describe("HelmProjectOpenShellGatewayClient", () => {
  it("passes a verified Namespace owner to the Helm post-renderer", async () => {
    const owner = { apiVersion: "v1", kind: "Namespace", name: target.namespace,
      uid: "namespace-uid", controller: false, blockOwnerDeletion: false };
    const run = vi.fn(async (input: CommandInput) => input.args[0] === "status"
      ? { exitCode: 1, stderr: "release: not found", stdout: "" }
      : { exitCode: 0, stderr: "", stdout: "" });
    const readOwner = vi.fn(async () => owner);
    const reconcileStorage = vi.fn(async () => {});
    await new HelmProjectOpenShellGatewayClient(configuration, run, readOwner, reconcileStorage).reconcile(target);
    expect(reconcileStorage).toHaveBeenCalledWith(owner, `openshell-${target.namespace}`);
    expect(readOwner).toHaveBeenCalledWith(target.namespace, target.projectId);
    expect(run.mock.calls.find(([input]) => input.args[0] === "upgrade")?.[0].args)
      .toEqual(expect.arrayContaining(["--post-renderer", "/app/scripts/project-openshell-owner.mjs",
        "--post-renderer-args", JSON.stringify(owner)]));
  });
  it("reuses the pinned official chart as one release in the Project Namespace", async () => {
    const commands: CommandInput[] = [];
    const run = vi.fn(async (input: CommandInput) => {
      commands.push(input);
      if (input.args[0] === "status") {
        return { exitCode: 1, stderr: "Error: release: not found", stdout: "" };
      }
      return { exitCode: 0, stderr: "", stdout: "deployed" };
    });
    const client = new HelmProjectOpenShellGatewayClient(configuration, run);

    await client.reconcile(target);

    expect(run).toHaveBeenCalledTimes(2);
    expect(commands[1]?.args).toEqual(expect.arrayContaining([
      "upgrade",
      "--install",
      "openshell",
      configuration.chart,
      "--namespace",
      target.namespace,
      "--atomic",
      "--wait",
    ]));
    const values = parse(commands[1]?.stdin ?? "") as Record<string, any>;
    expect(values).toMatchObject({
      fullnameOverride: `openshell-${target.namespace}`,
      image: {
        repository: configuration.gatewayImageRepository,
        tag: configuration.gatewayImageTag,
      },
      imagePullSecrets: configuration.imagePullSecrets,
      podAnnotations: {
        "tali.io/project-id": target.projectId,
        "tali.io/project-name": target.projectName,
      },
      server: {
        auth: { allowUnauthenticatedUsers: true },
        disableTls: true,
        grpcEndpoint:
          `http://openshell-${target.namespace}.${target.namespace}.svc.cluster.local:8080`,
        sandboxImage: configuration.sandboxImage,
        sandboxImagePullSecrets: configuration.sandboxImagePullSecrets,
        sandboxJwt: { gatewayId: target.namespace },
        sandboxNamespace: target.namespace,
      },
      supervisor: { image: { pullPolicy: "Never" } },
      resources: configuration.gatewayResources,
      service: { type: "ClusterIP" },
    });
    expect(commands[1]?.args.filter((arg) => arg === "3")).toHaveLength(1);
  });

  it("renders separate releases and sandbox scopes for two Project Namespaces", async () => {
    const commands: CommandInput[] = [];
    const run = vi.fn(async (input: CommandInput) => {
      commands.push(input);
      return input.args[0] === "status"
        ? { exitCode: 1, stderr: "release not found", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: "deployed" };
    });
    const client = new HelmProjectOpenShellGatewayClient(configuration, run);
    const targets = [
      {
        namespace: "tp-abcdefghijklm",
        projectId: "isolation-1",
        projectName: "Isolation 1",
      },
      {
        namespace: "tp-bcdefghijklmn",
        projectId: "isolation-2",
        projectName: "Isolation 2",
      },
    ];

    for (const input of targets) await client.reconcile(input);

    const upgrades = commands.filter(({ args }) => args[0] === "upgrade");
    expect(upgrades).toHaveLength(2);
    expect(upgrades.map(({ args }) => args[args.indexOf("--namespace") + 1]))
      .toEqual(targets.map(({ namespace }) => namespace));
    expect(upgrades.map(({ stdin }) => {
      const values = parse(stdin ?? "") as Record<string, any>;
      return {
        fullnameOverride: values.fullnameOverride,
        gatewayId: values.server.sandboxJwt.gatewayId,
        sandboxNamespace: values.server.sandboxNamespace,
      };
    })).toEqual(targets.map(({ namespace }) => ({
      fullnameOverride: `openshell-${namespace}`,
      gatewayId: namespace,
      sandboxNamespace: namespace,
    })));
  });

  it("recovers an interrupted Helm upgrade before reconciling desired values", async () => {
    const commands: CommandInput[] = [];
    const run = vi.fn(async (input: CommandInput) => {
      commands.push(input);
      if (input.args[0] === "status") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ info: { status: "pending-upgrade" } }),
        };
      }
      if (input.args[0] === "history") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([
            { revision: 1, status: "deployed" },
            { revision: 2, status: "pending-upgrade" },
          ]),
        };
      }
      return { exitCode: 0, stderr: "", stdout: "ok" };
    });
    const client = new HelmProjectOpenShellGatewayClient(configuration, run);

    await client.reconcile(target);

    expect(commands.map((command) => command.args[0])).toEqual([
      "status",
      "history",
      "rollback",
      "upgrade",
    ]);
    expect(commands[2]?.args).toEqual(expect.arrayContaining([
      "rollback",
      configuration.releaseName,
      "1",
      "--namespace",
      target.namespace,
    ]));
  });

  it("rejects a pre-compact legacy Namespace before invoking Helm", async () => {
    const run = vi.fn();
    const client = new HelmProjectOpenShellGatewayClient(configuration, run);

    await expect(client.reconcile({
      ...target,
      namespace: "tali-p-aed1eeb782fa64b744256ff894525c4b",
    })).rejects.toThrow("Relay-managed Namespace");
    expect(run).not.toHaveBeenCalled();
  });

  it("delegates cleanup to Helm so cluster-scoped chart resources are removed", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "uninstalled",
    }));
    const client = new HelmProjectOpenShellGatewayClient(configuration, run);

    await client.delete(target.namespace);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "uninstall",
        configuration.releaseName,
        "--namespace",
        target.namespace,
        "--ignore-not-found",
      ]),
    }));
  });

  it("surfaces Helm failures as runtime-target reconciliation errors", async () => {
    const client = new HelmProjectOpenShellGatewayClient(
      configuration,
      vi.fn(async (input: CommandInput) => input.args[0] === "status"
        ? {
            exitCode: 1,
            stderr: "Error: release: not found",
            stdout: "",
          }
        : {
            exitCode: 1,
            stderr: "release failed readiness",
            stdout: "",
          }),
    );

    await expect(client.reconcile(target)).rejects.toThrow(
      "release failed readiness",
    );
  });
});
