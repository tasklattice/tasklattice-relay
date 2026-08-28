import { randomUUID } from "node:crypto";
import {
  sandboxPolicyIdSchema,
  type CreateSandboxPolicyInput,
  type SandboxPolicy,
  type SandboxPolicyCatalog,
  type UpdateSandboxPolicyInput,
} from "@tali/contracts";
import { parse, stringify } from "yaml";
import { z } from "zod";
import policyCatalogYaml from "./runtime-policy-catalog.yaml?raw";
import { ProjectStore } from "../projects/project-store";

const recordSchema = z.record(z.string(), z.unknown());
export const DEFAULT_RUNTIME_POLICY_ID = "managed-runtime";
const catalogFileSchema = z.object({
  defaultPolicyId: sandboxPolicyIdSchema,
  basePolicy: recordSchema,
  policies: z
    .array(
      z.object({
        id: sandboxPolicyIdSchema,
        name: z.string().trim().min(3).max(80),
        description: z.string().trim().min(10).max(320),
        networkAccess: z.string().trim().min(3).max(160),
        policy: recordSchema,
      }),
    )
    .min(1),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value)
        ? mergeRecords(current, value)
        : value;
  }
  return result;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeOpenShellPolicy(
  policyYaml: string,
  baselinePolicyYaml?: string,
): string {
  const input = parse(policyYaml) as unknown;
  const baseline = baselinePolicyYaml
    ? (parse(baselinePolicyYaml) as unknown)
    : {};
  if (!isRecord(baseline))
    throw new Error("The deployment Policy baseline must be a YAML object.");
  const document = isRecord(input) ? mergeRecords(baseline, input) : input;
  if (!isRecord(document) || document.version !== 1)
    throw new Error("OpenShell Policy YAML must be an object with version: 1.");

  const filesystem = isRecord(document.filesystem_policy)
    ? document.filesystem_policy
    : {};
  const baselineFilesystem = isRecord(baseline.filesystem_policy)
    ? baseline.filesystem_policy
    : {};
  document.filesystem_policy = {
    ...filesystem,
    include_workdir: true,
    read_only: [
      ...new Set([
        ...stringList(baselineFilesystem.read_only),
        ...stringList(filesystem.read_only),
      ]),
    ],
    read_write: [
      ...new Set([
        ...stringList(baselineFilesystem.read_write),
        ...stringList(filesystem.read_write),
      ]),
    ],
  };
  document.landlock = isRecord(document.landlock)
    ? { compatibility: "best_effort", ...document.landlock }
    : { compatibility: "best_effort" };
  document.network_policies = isRecord(document.network_policies)
    ? document.network_policies
    : {};

  const process = document.process;
  if (isRecord(process)) {
    const identities = [process.run_as_user, process.run_as_group].map(String);
    if (identities.some((identity) => identity === "root" || identity === "0"))
      throw new Error(
        "OpenShell does not allow a Policy to run the Agent as root.",
      );
  }

  return stringify(document, { lineWidth: 0 }).trimEnd() + "\n";
}

export interface RuntimePolicyCatalogSource {
  load(): SandboxPolicyCatalog;
}

export class BuiltInRuntimePolicyCatalogSource implements RuntimePolicyCatalogSource {
  load(): SandboxPolicyCatalog {
    const input = parse(policyCatalogYaml) as unknown;
    const catalog = catalogFileSchema.parse(input);
    const policies = catalog.policies.map((entry): SandboxPolicy => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      networkAccess: entry.networkAccess,
      policyYaml: normalizeOpenShellPolicy(
        stringify(mergeRecords(catalog.basePolicy, entry.policy)),
      ),
      enforcement: "ENFORCE",
      source: "BUILT_IN",
      immutable: true,
    }));
    if (!policies.some((policy) => policy.id === catalog.defaultPolicyId))
      throw new Error(
        "The catalog defaultPolicyId does not match a built-in Policy.",
      );
    return {
      defaultPolicyId: catalog.defaultPolicyId,
      templatePolicyYaml: normalizeOpenShellPolicy(
        stringify(catalog.basePolicy),
      ),
      policies,
    };
  }
}

export class RuntimePolicyService {
  constructor(
    readonly store = new ProjectStore(),
    readonly source?: RuntimePolicyCatalogSource,
  ) {}

  async list(): Promise<SandboxPolicyCatalog> {
    let policies = await this.store.listSandboxPolicies();
    let sourceCatalog: SandboxPolicyCatalog | undefined;
    if (this.source) {
      const catalog = this.source.load();
      sourceCatalog = catalog;
      for (const policy of catalog.policies) await this.store.saveSandboxPolicy(policy);
      policies = await this.store.listSandboxPolicies();
    }
    if (!policies.length) {
      throw new Error("No Sandbox Policies are configured for this project.");
    }
    const defaultPolicyId = sourceCatalog?.defaultPolicyId
      ?? DEFAULT_RUNTIME_POLICY_ID;
    const defaultPolicy = policies.find((policy) => policy.id === defaultPolicyId) ?? policies[0]!;
    return {
      defaultPolicyId: defaultPolicy.id,
      templatePolicyYaml: sourceCatalog?.templatePolicyYaml
        ?? defaultPolicy.policyYaml,
      policies,
    };
  }

  async get(id: string): Promise<SandboxPolicy | undefined> {
    return (await this.list()).policies.find((policy) => policy.id === id);
  }

  async resolve(id?: string): Promise<SandboxPolicy> {
    const catalog = await this.list();
    const policyId = id || catalog.defaultPolicyId;
    const policy = catalog.policies.find((item) => item.id === policyId);
    if (!policy) throw new Error("Select an available OpenShell Policy.");
    return policy;
  }

  async create(input: CreateSandboxPolicyInput): Promise<SandboxPolicy> {
    const now = new Date().toISOString();
    const slug =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 52)
        .replace(/-$/, "") || "policy";
    return this.store.saveSandboxPolicy({
      id: `${slug}-${randomUUID().slice(0, 8)}`,
      ...input,
      policyYaml: normalizeOpenShellPolicy(
        input.policyYaml,
        (await this.list()).templatePolicyYaml,
      ),
      enforcement: "ENFORCE",
      source: "CUSTOM",
      immutable: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(id: string, input: UpdateSandboxPolicyInput): Promise<SandboxPolicy> {
    const current = await this.get(id);
    if (!current) throw new Error("Policy was not found.");
    if (current.immutable)
      throw new Error(
        "Built-in Policies are managed by the deployment ConfigMap and cannot be modified.",
      );
    return this.store.saveSandboxPolicy({
      ...current,
      ...input,
      policyYaml: normalizeOpenShellPolicy(
        input.policyYaml,
        (await this.list()).templatePolicyYaml,
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) return false;
    if (current.immutable)
      throw new Error(
        "Built-in Policies are managed by the deployment ConfigMap and cannot be deleted.",
      );
    if (await this.store.isSandboxPolicyInUse(id))
      throw new Error(
        "This Policy is assigned to an Instance and cannot be deleted.",
      );
    await this.store.deleteSandboxPolicy(id);
    return true;
  }
}
