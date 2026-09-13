import { spawn } from "node:child_process";
import { projectRuntimeNamespaceSchema } from "@tali/contracts";
import { stringify } from "yaml";
import { readProjectNamespaceOwner, reconcileGatewayOwnership } from "./project-resource-ownership";
import type { ProjectNamespaceInput } from "./project-namespace-client";

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

const defaultCommandRunner: CommandRunner = ({
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
  const finish = (output: CommandOutput) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
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
    reject(error);
  });
  child.on("close", (code) =>
    finish({ exitCode: code ?? 1, stderr, stdout }),
  );
  if (stdin !== undefined) child.stdin!.end(stdin);
  timeout = setTimeout(() => {
    child.kill("SIGTERM");
    finish({
      exitCode: 124,
      stderr: `${stderr}\nHelm command timed out after ${timeoutMs}ms.`,
      stdout,
    });
  }, timeoutMs);
  timeout.unref();
});

export interface ProjectOpenShellGatewayConfiguration {
  chart: string;
  enabled: boolean;
  gatewayResources: Record<string, unknown>;
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
  workspaceDefaultStorageSize: string;
  workspaceStorageClass?: string;
}

function jsonObject(name: string): Record<string, unknown> {
  const raw = process.env[name]?.trim() ?? "{}";
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function imagePullSecrets(name: string): Array<{ name: string }> {
  const raw = process.env[name]?.trim() ?? "[]";
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed)
    || parsed.some((item) =>
      !item
      || typeof item !== "object"
      || typeof (item as { name?: unknown }).name !== "string"
      || !(item as { name: string }).name.trim()
    )
  ) {
    throw new Error(`${name} must be a JSON array of non-empty Secret names.`);
  }
  return parsed as Array<{ name: string }>;
}

function imageParts(reference: string, label: string): {
  repository: string;
  tag: string;
} {
  const separator = reference.lastIndexOf(":");
  const slash = reference.lastIndexOf("/");
  if (reference.includes("@") || separator <= slash || separator === reference.length - 1) {
    throw new Error(`${label} must be a tag-qualified container image.`);
  }
  return {
    repository: reference.slice(0, separator),
    tag: reference.slice(separator + 1),
  };
}

function configurationFromEnvironment(): ProjectOpenShellGatewayConfiguration {
  const required = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required for Project OpenShell Gateways.`);
    return value;
  };
  const gateway = imageParts(
    required("PROJECT_OPENSHELL_GATEWAY_IMAGE"),
    "PROJECT_OPENSHELL_GATEWAY_IMAGE",
  );
  const supervisor = imageParts(
    required("PROJECT_OPENSHELL_SUPERVISOR_IMAGE"),
    "PROJECT_OPENSHELL_SUPERVISOR_IMAGE",
  );
  return {
    chart: process.env.PROJECT_OPENSHELL_HELM_CHART
      ?? "/opt/tali/helm/openshell.tgz",
    enabled: process.env.PROJECT_OPENSHELL_GATEWAYS_ENABLED === "true",
    gatewayResources: jsonObject("PROJECT_OPENSHELL_GATEWAY_RESOURCES_JSON"),
    gatewayImageRepository: gateway.repository,
    gatewayImageTag: gateway.tag,
    imagePullSecrets: imagePullSecrets(
      "PROJECT_OPENSHELL_IMAGE_PULL_SECRETS_JSON",
    ),
    imagePullPolicy: process.env.PROJECT_OPENSHELL_IMAGE_PULL_POLICY
      ?? "IfNotPresent",
    releaseName: process.env.PROJECT_OPENSHELL_RELEASE_NAME ?? "openshell",
    sandboxImage: required("PROJECT_OPENSHELL_DEFAULT_SANDBOX_IMAGE"),
    sandboxImagePullSecrets: imagePullSecrets(
      "PROJECT_OPENSHELL_SANDBOX_IMAGE_PULL_SECRETS_JSON",
    ),
    sandboxImagePullPolicy:
      process.env.PROJECT_OPENSHELL_SANDBOX_IMAGE_PULL_POLICY ?? "IfNotPresent",
    serviceNamePrefix:
      process.env.PROJECT_OPENSHELL_SERVICE_NAME_PREFIX ?? "openshell-",
    supervisorImageRepository: supervisor.repository,
    supervisorImageTag: supervisor.tag,
    workspaceDefaultStorageSize:
      process.env.PROJECT_OPENSHELL_WORKSPACE_STORAGE_SIZE ?? "1Gi",
    ...(process.env.PROJECT_OPENSHELL_WORKSPACE_STORAGE_CLASS
      ? {
          workspaceStorageClass:
            process.env.PROJECT_OPENSHELL_WORKSPACE_STORAGE_CLASS,
        }
      : {}),
  };
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
    private readonly configuration = configurationFromEnvironment(),
    private readonly run: CommandRunner = defaultCommandRunner,
    private readonly readOwner = readProjectNamespaceOwner,
    private readonly reconcileOwnership = reconcileGatewayOwnership,
  ) {}

  async reconcile(input: ProjectNamespaceInput): Promise<void> {
    if (!this.configuration.enabled) return;
    projectRuntimeNamespaceSchema.parse(input.namespace);
    const owner = await this.readOwner(input.namespace, input.projectId);
    await this.recoverInterruptedRelease(input.namespace);
    const serviceName = dnsLabel(
      `${this.configuration.serviceNamePrefix}${input.namespace}`,
      "Project OpenShell Gateway service name",
    );
    const values = stringify({
      fullnameOverride: serviceName,
      image: {
        pullPolicy: this.configuration.imagePullPolicy,
        repository: this.configuration.gatewayImageRepository,
        tag: this.configuration.gatewayImageTag,
      },
      imagePullSecrets: this.configuration.imagePullSecrets,
      networkPolicy: { enabled: true },
      podAnnotations: {
        "tali.io/project-id": input.projectId,
        "tali.io/project-name": input.projectName,
      },
      server: {
        auth: { allowUnauthenticatedUsers: true },
        disableTls: true,
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
          pullPolicy: this.configuration.imagePullPolicy,
          repository: this.configuration.supervisorImageRepository,
          tag: this.configuration.supervisorImageTag,
        },
        sideloadMethod: "init-container",
      },
    });
    const result = await this.run({
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
        "5m",
        "--history-max",
        "3",
        "--values",
        "-",
        ...(owner ? ["--post-renderer", process.env.PROJECT_OPENSHELL_OWNER_RENDERER
          ?? "/app/scripts/project-openshell-owner.mjs", "--post-renderer-args", JSON.stringify(owner),
          "--post-renderer-args", serviceName] : []),
      ],
      command: process.env.HELM_BIN ?? "helm",
      stdin: values,
      timeoutMs: 330_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Project OpenShell Gateway reconciliation failed: ${(result.stderr || result.stdout).trim().slice(-4_000)}`,
      );
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
      command: process.env.HELM_BIN ?? "helm",
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
      command: process.env.HELM_BIN ?? "helm",
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
            "5m",
          ],
          command: process.env.HELM_BIN ?? "helm",
          timeoutMs: 330_000,
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
          command: process.env.HELM_BIN ?? "helm",
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
      command: process.env.HELM_BIN ?? "helm",
      timeoutMs: 150_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Project OpenShell Gateway deletion failed: ${(result.stderr || result.stdout).trim().slice(-4_000)}`,
      );
    }
  }
}

class DisabledProjectOpenShellGatewayClient
  implements ProjectOpenShellGatewayClient
{
  async reconcile(): Promise<void> {}
  async delete(): Promise<void> {}
}

export function createProjectOpenShellGatewayClient(): ProjectOpenShellGatewayClient {
  return process.env.PROJECT_OPENSHELL_GATEWAYS_ENABLED === "true"
    ? new HelmProjectOpenShellGatewayClient()
    : new DisabledProjectOpenShellGatewayClient();
}
