import { getWorkerConfig } from "../config/worker-config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readGatewayDiagnostics, startGatewayDiagnostics, type GatewayDiagnosticReader } from "./project-openshell-diagnostics";
import { projectRuntimeNamespaceSchema } from "@tali/contracts";
import { stringify } from "yaml";
import { readProjectNamespaceOwner, reconcileGatewayOwnership } from "./project-resource-ownership";
import type { ProjectNamespaceInput } from "./project-namespace-client";
import { PostgresProjectOpenShellDatabase, type ProjectOpenShellDatabase } from "./project-openshell-database";

export interface ProjectOpenShellGatewayClient {
  reconcile(input: ProjectNamespaceInput): Promise<void>;
  delete(namespace: string): Promise<void>;
}

export interface CommandInput {
  args: string[];
  command: string;
  stdin?: string;
  timeoutMs: number;
}

export interface CommandOutput {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type CommandRunner = (input: CommandInput) => Promise<CommandOutput>;

export const defaultCommandRunner: CommandRunner = ({
  args,
  command,
  stdin,
  timeoutMs,
}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    env: process.env,
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let killTimeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  const finish = (output: CommandOutput) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (killTimeout) clearTimeout(killTimeout);
    resolve(output);
  };
  child.stdout!.on("data", (data: Buffer) => {
    stdout = (stdout + data.toString()).slice(-128_000);
  });
  child.stderr!.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-128_000);
  });
  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (killTimeout) clearTimeout(killTimeout);
    reject(error);
  });
  child.on("close", (code) =>
    finish({ exitCode: timedOut ? 124 : code ?? 1, stderr, stdout }),
  );
  child.stdin?.on("error", () => {}); // EPIPE when Helm exits before reading values.
  if (stdin !== undefined) child.stdin!.end(stdin);
  timeout = setTimeout(() => {
    timedOut = true;
    stderr += `\nHelm command timed out after ${timeoutMs}ms.`;
    child.kill("SIGTERM");
    // Resolve only on close, so retries cannot race a still-running Helm.
    killTimeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    killTimeout.unref();
  }, timeoutMs);
  timeout.unref();
});

export interface ProjectOpenShellGatewayConfiguration {
  chart: string;
  certgenActiveDeadlineSeconds?: number;
  helmTimeoutSeconds?: number;
  helmProcessTimeoutSeconds?: number;
  enabled: boolean;
  gatewayResources: Record<string, unknown>;
  gatewayPodSecurityContext?: Record<string, unknown>;
  gatewaySecurityContext?: Record<string, unknown>;
  gatewayImageRepository: string;
  gatewayImageTag: string;
  imagePullSecrets: Array<{ name: string }>;
  imagePullPolicy: string;
  releaseName: string;
  sandboxImage: string;
  sandboxImagePullSecrets: Array<{ name: string }>;
  sandboxImagePullPolicy: string;
  serviceNamePrefix: string;
  supervisorImageRepository: string;
  supervisorImageTag: string;
  supervisorImagePullPolicy: string;
  workspaceDefaultStorageSize: string;
  workspaceStorageClass?: string | undefined;
}

function dnsLabel(value: string, label: string): string {
  if (
    value.length > 63
    || !/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(value)
  ) {
    throw new Error(`${label} must be a DNS-1123 label no longer than 63 characters.`);
  }
  return value;
}

export class HelmProjectOpenShellGatewayClient
  implements ProjectOpenShellGatewayClient
{
  constructor(
    private readonly configuration: ProjectOpenShellGatewayConfiguration = getWorkerConfig().project_openshell,
    private readonly run: CommandRunner = defaultCommandRunner,
    private readonly readOwner = readProjectNamespaceOwner,
    private readonly reconcileOwnership = reconcileGatewayOwnership,
    private readonly database: ProjectOpenShellDatabase = new PostgresProjectOpenShellDatabase(),
    private readonly diagnostics: GatewayDiagnosticReader = readGatewayDiagnostics,
  ) {}

  async reconcile(input: ProjectNamespaceInput): Promise<void> {
    if (!this.configuration.enabled) return;
    projectRuntimeNamespaceSchema.parse(input.namespace);
    const owner = await this.readOwner(input.namespace, input.projectId);
    await this.recoverInterruptedRelease(input.namespace);
    const database = await this.database.reconcile(input, owner);
    const serviceName = dnsLabel(
      `${this.configuration.serviceNamePrefix}${input.namespace}`,
      "Project OpenShell Gateway service name",
    );
    const values = stringify({
      fullnameOverride: serviceName,
      pkiInitJob: { activeDeadlineSeconds: this.configuration.certgenActiveDeadlineSeconds ?? 300 },
      workload: { kind: "deployment" },
      image: {
        pullPolicy: this.configuration.imagePullPolicy,
        repository: this.configuration.gatewayImageRepository,
        tag: this.configuration.gatewayImageTag,
      },
      imagePullSecrets: this.configuration.imagePullSecrets,
      podSecurityContext: this.configuration.gatewayPodSecurityContext ?? {},
      securityContext: this.configuration.gatewaySecurityContext ?? {},
      networkPolicy: { enabled: true },
      podAnnotations: {
        "tali.io/project-id": input.projectId,
        "tali.io/project-name": input.projectName,
        "checksum/openshell-database": database.checksum,
      },
      server: {
        auth: { allowUnauthenticatedUsers: true },
        disableTls: true,
        externalDbSecret: database.secretName,
        grpcEndpoint:
          `http://${serviceName}.${input.namespace}.svc.cluster.local:8080`,
        sandboxImage: this.configuration.sandboxImage,
        sandboxImagePullPolicy: this.configuration.sandboxImagePullPolicy,
        sandboxImagePullSecrets:
          this.configuration.sandboxImagePullSecrets,
        sandboxJwt: { gatewayId: input.namespace },
        sandboxNamespace: input.namespace,
        telemetryEnabled: false,
        workspaceDefaultStorageSize:
          this.configuration.workspaceDefaultStorageSize,
        ...(this.configuration.workspaceStorageClass
          ? { workspaceStorageClass: this.configuration.workspaceStorageClass }
          : {}),
      },
      resources: this.configuration.gatewayResources,
      service: { type: "ClusterIP" },
      supervisor: {
        image: {
          pullPolicy: this.configuration.supervisorImagePullPolicy,
          repository: this.configuration.supervisorImageRepository,
          tag: this.configuration.supervisorImageTag,
        },
        sideloadMethod: "init-container",
      },
    });
    const attemptId = randomUUID();
    const stopDiagnostics = startGatewayDiagnostics(input.namespace, attemptId, this.diagnostics, `${serviceName}-certgen`);
    let result: CommandOutput;
    let diagnostics: Awaited<ReturnType<typeof stopDiagnostics>>;
    try {
      result = await this.run({
        args: [
          "upgrade",
          "--install",
          this.configuration.releaseName,
          this.configuration.chart,
          "--namespace",
          input.namespace,
          "--atomic",
          "--wait",
          "--wait-for-jobs",
          "--timeout",
          `${this.configuration.helmTimeoutSeconds ?? 600}s`,
          "--history-max",
          "3",
          "--values",
          "-",
          ...(owner ? ["--post-renderer", getWorkerConfig().project_openshell.ownerRenderer, "--post-renderer-args", JSON.stringify(owner),
            "--post-renderer-args", serviceName] : []),
        ],
        command: getWorkerConfig().project_openshell.helmBin,
        stdin: values,
        timeoutMs: (this.configuration.helmProcessTimeoutSeconds ?? 2100) * 1000,
      });
    } catch (error) {
      result = { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
    } finally {
      diagnostics = await stopDiagnostics();
    }
    if (result.exitCode !== 0) {
      const output = `${result.stderr}\n${result.stdout}`.trim().slice(-4_000);
      const failureLayer = result.exitCode === 124 ? "worker-process-timeout"
        : diagnostics.deadlineExceeded ? "certgen-job-deadline"
        : /context deadline exceeded|timed out waiting/i.test(output) ? "helm-wait-timeout"
        : "helm-failure-unknown";
      const report = { attemptId, namespace: input.namespace, failureLayer,
        certgenDeadlineSeconds: this.configuration.certgenActiveDeadlineSeconds ?? 300,
        helmTimeoutSeconds: this.configuration.helmTimeoutSeconds ?? 600,
        processTimeoutSeconds: this.configuration.helmProcessTimeoutSeconds ?? 2100,
        ...diagnostics };
      console.error(JSON.stringify({ event: "openshell.install.failed", ...report }));
      // The resource-operation task persists only the first 4,000 characters.
      // Put the layer and resource reasons first; full snapshots stay in logs.
      const resourceSummary = diagnostics.snapshots
        .filter((s) => s.kind !== "Event")
        .sort((a, b) => Number(b.kind === "Pod") - Number(a.kind === "Pod"))
        .map((s) => `${s.kind}/${s.name ?? "unknown"} uid=${s.uid ?? "unknown"} ${JSON.stringify(s.details)}`)
        .join("\n").slice(0, 2400);
      throw new Error(`Project OpenShell Gateway reconciliation failed: ${failureLayer}; attempt=${attemptId}; namespace=${input.namespace}\n${resourceSummary}\nHelm: ${output}`);
    }
    if (owner) await this.reconcileOwnership(owner, serviceName);
  }

  private async recoverInterruptedRelease(namespace: string): Promise<void> {
    const status = await this.run({
      args: [
        "status",
        this.configuration.releaseName,
        "--namespace",
        namespace,
        "--output",
        "json",
      ],
      command: getWorkerConfig().project_openshell.helmBin,
      timeoutMs: 30_000,
    });
    if (status.exitCode !== 0) {
      const output = `${status.stderr}\n${status.stdout}`;
      if (/release(?::|\s+\S+)?\s+not found/i.test(output)) return;
      throw new Error(
        `Unable to inspect Project OpenShell Gateway release: ${output.trim().slice(-4_000)}`,
      );
    }

    let releaseStatus = "";
    try {
      releaseStatus = String(
        (JSON.parse(status.stdout) as { info?: { status?: unknown } })
          .info?.status ?? "",
      );
    } catch {
      throw new Error("Helm returned invalid JSON while inspecting the Project OpenShell Gateway release.");
    }
    if (!releaseStatus.startsWith("pending-")) return;

    const history = await this.run({
      args: [
        "history",
        this.configuration.releaseName,
        "--namespace",
        namespace,
        "--output",
        "json",
      ],
      command: getWorkerConfig().project_openshell.helmBin,
      timeoutMs: 30_000,
    });
    if (history.exitCode !== 0) {
      throw new Error(
        `Unable to inspect Project OpenShell Gateway history: ${(history.stderr || history.stdout).trim().slice(-4_000)}`,
      );
    }
    let revisions: Array<{ revision?: unknown; status?: unknown }>;
    try {
      const parsed: unknown = JSON.parse(history.stdout);
      if (!Array.isArray(parsed)) throw new Error("history is not an array");
      revisions = parsed;
    } catch {
      throw new Error("Helm returned invalid JSON while inspecting the Project OpenShell Gateway history.");
    }
    const deployedRevision = revisions
      .filter((revision) => revision.status === "deployed")
      .map((revision) => Number(revision.revision))
      .filter((revision) => Number.isSafeInteger(revision) && revision > 0)
      .sort((left, right) => right - left)[0];

    const recovery = deployedRevision
      ? await this.run({
          args: [
            "rollback",
            this.configuration.releaseName,
            String(deployedRevision),
            "--namespace",
            namespace,
            "--wait",
            "--wait-for-jobs",
            "--timeout",
            `${this.configuration.helmTimeoutSeconds ?? 600}s`,
          ],
          command: getWorkerConfig().project_openshell.helmBin,
          timeoutMs: (this.configuration.helmProcessTimeoutSeconds ?? 2100) * 1000,
        })
      : await this.run({
          args: [
            "uninstall",
            this.configuration.releaseName,
            "--namespace",
            namespace,
            "--ignore-not-found",
            "--wait",
            "--timeout",
            "2m",
          ],
          command: getWorkerConfig().project_openshell.helmBin,
          timeoutMs: 150_000,
        });
    if (recovery.exitCode !== 0) {
      throw new Error(
        `Unable to recover interrupted Project OpenShell Gateway release: ${(recovery.stderr || recovery.stdout).trim().slice(-4_000)}`,
      );
    }
  }

  async delete(namespace: string): Promise<void> {
    if (!this.configuration.enabled) return;
    projectRuntimeNamespaceSchema.parse(namespace);
    const result = await this.run({
      args: [
        "uninstall",
        this.configuration.releaseName,
        "--namespace",
        namespace,
        "--ignore-not-found",
        "--wait",
        "--timeout",
        "2m",
      ],
      command: getWorkerConfig().project_openshell.helmBin,
      timeoutMs: 150_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Project OpenShell Gateway deletion failed: ${(result.stderr || result.stdout).trim().slice(-4_000)}`,
      );
    }
    await this.database.delete(namespace);
  }
}

class DisabledProjectOpenShellGatewayClient
  implements ProjectOpenShellGatewayClient
{
  async reconcile(): Promise<void> {}
  async delete(): Promise<void> {}
}

export function createProjectOpenShellGatewayClient(): ProjectOpenShellGatewayClient {
  return getWorkerConfig().project_openshell.enabled
    ? new HelmProjectOpenShellGatewayClient()
    : new DisabledProjectOpenShellGatewayClient();
}
