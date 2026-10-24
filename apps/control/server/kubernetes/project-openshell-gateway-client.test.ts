import { parse, parseAllDocuments } from "yaml";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HelmProjectOpenShellGatewayClient,
  type CommandInput,
  type ProjectOpenShellGatewayConfiguration,
} from "./project-openshell-gateway-client";

vi.mock("./project-openshell-diagnostics", async (importOriginal) => ({
  ...await importOriginal<typeof import("./project-openshell-diagnostics")>(),
  readGatewayDiagnostics: async () => [],
}));

const configuration: ProjectOpenShellGatewayConfiguration = {
  chart: "/opt/tali/helm/openshell.tgz",
  enabled: true,
  gatewayResources: {
    limits: { cpu: "1", memory: "1Gi" },
    requests: { cpu: "100m", memory: "128Mi" },
  },
  gatewayImageRepository: "registry.example/openshell/gateway",
  gatewayImageTag: "0.0.116",
  imagePullSecrets: [{ name: "gateway-pull" }],
  imagePullPolicy: "IfNotPresent",
  releaseName: "openshell",
  sandboxImage: "registry.example/nemoclaw/sandbox-base:v0.0.114",
  sandboxImagePullSecrets: [{ name: "sandbox-pull" }],
  sandboxImagePullPolicy: "IfNotPresent",
  serviceNamePrefix: "openshell-",
  supervisorImageRepository: "registry.example/openshell/supervisor",
  supervisorImagePullPolicy: "Never",
  supervisorImageTag: "0.0.116",
  workspaceDefaultStorageSize: "2Gi",
};

const target = {
  namespace: "tp-abcdefghijklm",
  projectId: "project-a",
  projectName: "Customer Support",
};

const database = {
  reconcile: vi.fn(async () => ({ secretName: "openshell-postgresql", checksum: "database-checksum" })),
  delete: vi.fn(async () => {}),
};
beforeEach(() => vi.clearAllMocks());

describe("HelmProjectOpenShellGatewayClient", () => {
  it("passes configured deadlines and surfaces Pod reasons ahead of Helm output", async () => {
    const run = vi.fn(async (input: CommandInput) => input.args[0] === "status"
      ? { exitCode: 1, stderr: "release: not found", stdout: "" }
      : { exitCode: 1, stderr: "context deadline exceeded", stdout: "" });
    const client = new HelmProjectOpenShellGatewayClient({ ...configuration,
      certgenActiveDeadlineSeconds: 420, helmTimeoutSeconds: 900, helmProcessTimeoutSeconds: 3000,
    }, run, async () => undefined, undefined, database, async () => [{
      kind: "Pod", name: "gateway-broken", uid: "pod-uid", details: { waitingReason: "ImagePullBackOff" },
    }]);
    await expect(client.reconcile(target)).rejects.toThrow(/helm-wait-timeout; attempt=.*gateway-broken[\s\S]*ImagePullBackOff[\s\S]*context deadline exceeded/s);
    const upgrade = run.mock.calls.find(([input]) => input.args[0] === "upgrade")![0];
    expect(upgrade.args).toContain("900s");
    expect(upgrade.timeoutMs).toBe(3000000);
    expect(parse(upgrade.stdin!).pkiInitJob.activeDeadlineSeconds).toBe(420);
  });

  it("applies Gateway security overrides to the bundled chart without losing zero or false", async () => {
    const run = vi.fn(async (input: CommandInput) => input.args[0] === "status"
      ? { exitCode: 1, stderr: "release: not found", stdout: "" }
      : { exitCode: 0, stderr: "", stdout: "" });
    await new HelmProjectOpenShellGatewayClient({
      ...configuration,
      gatewayPodSecurityContext: { fsGroup: 0, fsGroupChangePolicy: "OnRootMismatch" },
      gatewaySecurityContext: { runAsNonRoot: false, runAsUser: 0 },
    }, run, undefined, undefined, database).reconcile(target);
    const values = run.mock.calls.find(([input]) => input.args[0] === "upgrade")![0].stdin!;
    const rendered = execFileSync("helm", [
      "template", "openshell", "../../.helm-dependencies/openshell",
      "--api-versions", "agents.x-k8s.io/v1beta1/Sandbox",
      "--namespace", target.namespace, "--values", "-",
    ], { input: values, encoding: "utf8" });
    const certgen = parseAllDocuments(rendered).map((doc) => doc.toJSON())
      .find((object) => object?.kind === "Job");
    expect(certgen.spec.activeDeadlineSeconds).toBe(300);
    const deployment = parseAllDocuments(rendered).map((doc) => doc.toJSON())
      .find((object) => object?.kind === "Deployment");
    const policy = parseAllDocuments(rendered).map((doc) => doc.toJSON())
      .find((object) => object?.kind === "NetworkPolicy");
    // This is the other default tenant policy. It neither selects the Bridge
    // nor isolates egress, so it cannot block Bridge -> Control requests.
    expect(policy.spec).toMatchObject({
      podSelector: { matchLabels: { "openshell.ai/managed-by": "openshell" } },
      policyTypes: ["Ingress"],
      ingress: [{ ports: [{ port: 2222, protocol: "TCP" }] }],
    });
    expect(policy.spec.egress).toBeUndefined();
    expect(deployment.spec.template.spec.securityContext).toEqual({
      fsGroup: 0, fsGroupChangePolicy: "OnRootMismatch",
    });
    expect(deployment.spec.template.spec.containers.find((container: { name: string }) => container.name === "openshell-gateway")
      .securityContext).toEqual({
      runAsNonRoot: false, runAsUser: 0,
      allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] },
    });
  });
  it("passes a verified Namespace owner to the Helm post-renderer", async () => {
    const owner = { apiVersion: "v1", kind: "Namespace", name: target.namespace,
      uid: "namespace-uid", controller: false, blockOwnerDeletion: false };
    const run = vi.fn(async (input: CommandInput) => input.args[0] === "status"
      ? { exitCode: 1, stderr: "release: not found", stdout: "" }
      : { exitCode: 0, stderr: "", stdout: "" });
    const readOwner = vi.fn(async () => owner);
    const reconcileStorage = vi.fn(async () => {});
    await new HelmProjectOpenShellGatewayClient(configuration, run, readOwner, reconcileStorage, database).reconcile(target);
    expect(database.reconcile).toHaveBeenCalledWith(target, owner);
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
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);

    await client.reconcile(target);

    expect(run).toHaveBeenCalledTimes(2);
    expect(database.reconcile.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[1]!);
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
      workload: { kind: "deployment" },
      image: {
        repository: configuration.gatewayImageRepository,
        tag: configuration.gatewayImageTag,
      },
      imagePullSecrets: configuration.imagePullSecrets,
      podAnnotations: {
        "tali.io/project-id": target.projectId,
        "tali.io/project-name": target.projectName,
        "checksum/openshell-database": "database-checksum",
      },
      server: {
        auth: { allowUnauthenticatedUsers: true },
        disableTls: true,
        externalDbSecret: "openshell-postgresql",
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
    expect(commands[1]?.stdin).not.toContain("postgresql://");
    expect(values).not.toHaveProperty("serviceAccount");
    expect(values).not.toHaveProperty("sandboxServiceAccount");
    expect(values.pkiInitJob).not.toHaveProperty("serviceAccount");
    expect(values.pkiInitJob).not.toHaveProperty("imagePullSecrets");
    const rendered = execFileSync("helm", ["template", "openshell", "../../.helm-dependencies/openshell",
      "--api-versions", "agents.x-k8s.io/v1beta1/Sandbox",
      "--namespace", target.namespace, "--values", "-"], {input:commands[1]!.stdin!,encoding:"utf8"});
    const resources = parseAllDocuments(rendered).map(d => d.toJSON()).filter(Boolean);
    const certgenSA = resources.find(r => r.kind === "ServiceAccount" && r.metadata.name.endsWith("-certgen"));
    expect(certgenSA.metadata.annotations["helm.sh/hook"]).toBe("pre-install,pre-upgrade");
    expect(resources.find(r => r.kind === "Job").spec.template.spec.imagePullSecrets).toEqual(configuration.imagePullSecrets);
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
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);
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
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);

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
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);

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
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);

    await client.delete(target.namespace);
    expect(database.delete).toHaveBeenCalledWith(target.namespace);
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(database.delete.mock.invocationCallOrder[0]!);

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

  it("keeps the database when Gateway uninstall fails", async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stderr: "uninstall failed", stdout: "" }));
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);
    await expect(client.delete(target.namespace)).rejects.toThrow("uninstall failed");
    expect(database.delete).not.toHaveBeenCalled();
  });

  it("does not install a Gateway when database provisioning fails", async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stderr: "release: not found", stdout: "" }));
    database.reconcile.mockRejectedValueOnce(new Error("database unavailable"));
    const client = new HelmProjectOpenShellGatewayClient(configuration, run, undefined, undefined, database);
    await expect(client.reconcile(target)).rejects.toThrow("database unavailable");
    expect(run).toHaveBeenCalledTimes(1);
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
      undefined, undefined, database,
    );

    await expect(client.reconcile(target)).rejects.toThrow(
      "release failed readiness",
    );
  });
});

describe("OpenShift prepared ServiceAccount migration", () => {
  it("waits before upgrade, uses distinct credentials, and retains legacy SAs for existing Sandboxes", async () => {
    const prepare = vi.fn(async () => ({gatewaySecrets:[{name:"gateway-token"}],certgenSecrets:[{name:"certgen-token"}],sandboxSecrets:[{name:"sandbox-token"},{name:"external"}]}));
    const run=vi.fn(async (input:CommandInput)=>input.args[0]==="status"
      ? {exitCode:1,stderr:"release: not found",stdout:""}:{exitCode:0,stderr:"",stdout:""});
    await new HelmProjectOpenShellGatewayClient(configuration,run,undefined,undefined,database,undefined,prepare).reconcile(target);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[1]!);
    const values=run.mock.calls.find(([input])=>input.args[0]==="upgrade")![0].stdin!;
    const rendered=execFileSync("helm",["template","openshell","../../.helm-dependencies/openshell","--api-versions","agents.x-k8s.io/v1beta1/Sandbox","--namespace",target.namespace,"--values","-"],{input:values,encoding:"utf8"});
    const objects=parseAllDocuments(rendered).map(d=>d.toJSON()).filter(Boolean);
    const job=objects.find(r=>r.kind==="Job");
    expect(job.spec.template.spec.serviceAccountName).toBe(`openshell-${target.namespace}-certgen`);
    expect(job.spec.template.spec.imagePullSecrets).toEqual([{name:"certgen-token"}]);
    const certBinding=objects.find(r=>r.kind==="RoleBinding"&&r.metadata.name.endsWith("-certgen"));
    expect(certBinding.subjects[0].name).toBe(`openshell-${target.namespace}-certgen`);
    const pod=objects.find(r=>r.kind==="Deployment").spec.template.spec;
    expect(pod.serviceAccountName).toBe(`openshell-${target.namespace}`);
    expect(pod.imagePullSecrets).toEqual([{name:"gateway-token"}]);
    const sas=objects.filter(r=>r.kind==="ServiceAccount").map(r=>r.metadata.name);
    expect(sas).toEqual(expect.arrayContaining([`openshell-${target.namespace}`,`openshell-${target.namespace}-sandbox`]));
    expect(sas.some((name:string)=>name.endsWith("-certgen"))).toBe(false);
    const configs=objects.filter(r=>r.kind==="ConfigMap").flatMap(r=>Object.values(r.data??{})).join("\n");
    expect(configs).toContain(`"openshell-${target.namespace}-sandbox"`);
    expect(configs).toContain('"sandbox-token", "external"');
  });
  it("does not start upgrade or database provisioning when credentials are unavailable",async()=>{
    const run=vi.fn(async (_input: CommandInput) => ({exitCode:1,stderr:"release: not found",stdout:""}));
    const prepare=vi.fn(async()=>{throw new Error("pull Secret missing");});
    await expect(new HelmProjectOpenShellGatewayClient(configuration,run,undefined,undefined,database,undefined,prepare).reconcile(target)).rejects.toThrow("pull Secret missing");
    expect(run.mock.calls.map(([input]) => input.args[0])).toEqual(["status"]);
    expect(database.reconcile).not.toHaveBeenCalled();
  });
  it.each(["pending-install", "pending-upgrade"])("prepares current SA credentials after recovering %s", async (state) => {
    let generation = "old";
    const run = vi.fn(async (input: CommandInput) => {
      if (input.args[0] === "status") return {exitCode:0,stderr:"",stdout:JSON.stringify({info:{status:state}})};
      if (input.args[0] === "history") return {exitCode:0,stderr:"",stdout:JSON.stringify(
        state === "pending-install" ? [{revision:1,status:state}] : [{revision:1,status:"deployed"},{revision:2,status:state}],
      )};
      if (["uninstall", "rollback"].includes(input.args[0]!)) generation = "recovered";
      return {exitCode:0,stderr:"",stdout:""};
    });
    const prepare = vi.fn(async () => ({
      gatewaySecrets:[{name:`${generation}-gateway`}],
      certgenSecrets:[{name:`${generation}-certgen`}],
      sandboxSecrets:[{name:`${generation}-sandbox`}],
    }));
    await new HelmProjectOpenShellGatewayClient(configuration,run,undefined,undefined,database,undefined,prepare).reconcile(target);
    const upgrade = run.mock.calls.find(([input]) => input.args[0] === "upgrade")![0];
    const values = parse(upgrade.stdin!);
    expect(values.imagePullSecrets).toEqual([{name:"recovered-gateway"}]);
    expect(values.pkiInitJob.imagePullSecrets).toEqual([{name:"recovered-certgen"}]);
    expect(values.server.sandboxImagePullSecrets).toEqual([{name:"recovered-sandbox"}]);
    expect(run.mock.calls.map(([input]) => input.args[0])).toEqual([
      "status", "history", state === "pending-install" ? "uninstall" : "rollback", "upgrade",
    ]);
  });
  it("checks cancellation before attempting release recovery", async () => {
    const run = vi.fn();
    const prepare = vi.fn();
    await expect(new HelmProjectOpenShellGatewayClient(configuration,run,undefined,undefined,database,undefined,prepare)
      .reconcile({...target,assertCurrent:async()=>{throw new Error("lease lost");}})).rejects.toThrow("lease lost");
    expect(run).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});
