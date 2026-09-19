import { describe, expect, it } from "vitest";
import { instanceIdSchema, runnerRuntimeTargetSchema } from "@tali/contracts";
import {
  generateKubernetesResourceId,
  KUBERNETES_RESOURCE_ID_LENGTH,
  kubernetesResourceName,
  resourcePrefixes,
} from "@tali/contracts/resource-identity";
import { managedAgentResourceName } from "../kubernetes/managed-agent-runtime-client";
import { expertAgentRuntimeResourceName } from "../kubernetes/expert-agent-runtime-client";
import { instanceParamsSchema } from "../api-contracts/schemas";
import { projectRuntimeNamespace } from "./project-runtime-identity";

describe("Kubernetes resource identities", () => {
  it("allocates 16-character DNS names with distinct resource type prefixes", () => {
    const names = Object.entries(resourcePrefixes).map(([type, prefix]) => {
      const name = generateKubernetesResourceId(type as keyof typeof resourcePrefixes);
      expect(name).toMatch(new RegExp(`^${prefix}-[a-z2-7]{13}$`));
      expect(name).toHaveLength(KUBERNETES_RESOURCE_ID_LENGTH);
      return name;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  it("preserves the same identity through Project and both workload renderers", () => {
    const projectId = generateKubernetesResourceId("project");
    const instanceId = generateKubernetesResourceId("instance");
    expect(projectRuntimeNamespace(projectId)).toBe(projectId);
    expect(runnerRuntimeTargetSchema.parse({ namespace: projectId })).toEqual({ namespace: projectId });
    expect(instanceIdSchema.parse(instanceId)).toBe(instanceId);
    expect(instanceParamsSchema.parse({ projectId, instanceId })).toEqual({ projectId, instanceId });
    expect(managedAgentResourceName(instanceId)).toBe(instanceId);
    expect(expertAgentRuntimeResourceName(instanceId)).toBe(instanceId);
  });

  it("derives retry-stable names without truncating the source before hashing", () => {
    const operationId = "9e6f06ad-34ec-465a-85d2-3a88ce440a18";
    const first = kubernetesResourceName("instance", operationId);
    expect(kubernetesResourceName("instance", operationId)).toBe(first);
    expect(kubernetesResourceName("instance", `${operationId}-other`)).not.toBe(first);
    expect(kubernetesResourceName("project", operationId)).not.toBe(first);
    expect(kubernetesResourceName("instance", first)).toBe(first);
    expect(() => kubernetesResourceName("instance", "")).toThrow("must not be empty");
  });

  it("keeps names scoped and opaque for long Secret identities", () => {
    const resourceId = "credential-" + "x".repeat(200);
    const first = kubernetesResourceName("secret", JSON.stringify(["project-a", resourceId]));
    const second = kubernetesResourceName("secret", JSON.stringify(["project-b", resourceId]));
    expect(first).toMatch(/^ts-[a-z2-7]{13}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("credential");
  });
});
