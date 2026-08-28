import { describe, expect, it } from "vitest";
import type { SandboxPolicyCatalog } from "@tali/contracts";
import { createTestStore } from "../test/store";
import {
  BuiltInRuntimePolicyCatalogSource,
  normalizeOpenShellPolicy,
  RuntimePolicyService,
  type RuntimePolicyCatalogSource,
} from "./runtime-policy-service";

const source: RuntimePolicyCatalogSource = {
  load: (): SandboxPolicyCatalog => ({
    defaultPolicyId: "managed-runtime",
    templatePolicyYaml:
      "version: 1\nfilesystem_policy:\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nnetwork_policies: {}\n",
    policies: [
      {
        id: "managed-runtime",
        name: "Managed Runtime",
        description:
          "Allows arbitrary operations in Sandbox-owned writable paths.",
        networkAccess: "Managed inference and declared destinations",
        policyYaml: normalizeOpenShellPolicy(
          "version: 1\nnetwork_policies: {}\n",
          "version: 1\nfilesystem_policy:\n  read_write:\n    - /dev/null\n",
        ),
        enforcement: "ENFORCE",
        source: "BUILT_IN",
        immutable: true,
      },
    ],
  }),
};

describe("RuntimePolicyService", () => {
  it("loads the deployment catalog with the managed runtime as the default", () => {
    const catalog = new BuiltInRuntimePolicyCatalogSource().load();
    const policy = catalog.policies.find(
      (item) => item.id === catalog.defaultPolicyId,
    );

    expect(catalog.defaultPolicyId).toBe("managed-runtime");
    expect(policy).toMatchObject({ source: "BUILT_IN", immutable: true });
    expect(policy?.policyYaml).toContain("/dev/null");
    expect(policy?.policyYaml).toContain("/sandbox");
    expect(policy?.policyYaml).toContain("/opt");
  });

  it("creates, updates, and deletes custom policies", async () => {
    const service = new RuntimePolicyService(createTestStore(), source);
    const created = await service.create({
      name: "Internal tools",
      description: "Allows the internal tools required by this environment.",
      networkAccess: "tools.example.com",
      policyYaml: "version: 1\nnetwork_policies: {}\n",
    });

    expect(created).toMatchObject({ source: "CUSTOM", immutable: false });
    expect(created.policyYaml).toContain("/dev/null");
    expect(
      (
        await service.update(created.id, {
          ...created,
          name: "Internal tooling",
        })
      ).name,
    ).toBe("Internal tooling");
    expect(await service.delete(created.id)).toBe(true);
    expect(await service.get(created.id)).toBeUndefined();
  });

  it("protects built-in policies and rejects unsafe process identity", async () => {
    const service = new RuntimePolicyService(createTestStore(), source);
    const input = {
      name: "Unrestricted",
      description:
        "Allows arbitrary operations in Sandbox-owned writable paths.",
      networkAccess: "Managed inference and declared destinations",
      policyYaml: "version: 1\nnetwork_policies: {}\n",
    };

    await expect(service.update("managed-runtime", input)).rejects.toThrow(
      "Built-in",
    );
    await expect(service.delete("managed-runtime")).rejects.toThrow("Built-in");
    expect(() =>
      normalizeOpenShellPolicy("version: 1\nprocess:\n  run_as_user: root\n"),
    ).toThrow("root");
    expect(() => normalizeOpenShellPolicy("version: 2\n")).toThrow(
      "version: 1",
    );
  });

  it("does not delete a custom Policy assigned to an Instance", async () => {
    const store = createTestStore();
    const service = new RuntimePolicyService(store, source);
    const policy = await service.create({
      name: "Assigned policy",
      description: "A custom Policy currently assigned to an Instance.",
      networkAccess: "Managed inference only",
      policyYaml: "version: 1\nnetwork_policies: {}\n",
    });
    const now = new Date().toISOString();
    await store.save({
      schemaVersion: 2,
      id: "agent-a",
      name: "Policy user",
      description: "",
      runtime: "openshell",
      agentPlatform: "openclaw",
      modelDeploymentId: "model-a",
      policyId: policy.id,
      systemPrompt: "Use the assigned policy for this test.",
      providerAccountId: "provider-a",
      providerName: "Provider",
      model: "model-a",
      modelType: "llm",
      inferenceMode: "PLATFORM_MANAGED",
      accessPolicyIds: ["11111111-1111-4111-8111-111111111111"],
      modelRoutingId: "routing-a",
      modelRoutingBindingId: "binding-a",
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
      modelRoutingKeyFingerprint: "sha256:123456789abc",
      costKeyAlias: "agent-a:model-a",
      sandboxName: "tali-policy-agent-a",
      status: "READY",
      createdAt: now,
      updatedAt: now,
      logs: [],
    }, "local-admin");

    await expect(service.delete(policy.id)).rejects.toThrow(
      "assigned to an Instance",
    );
  });
});
