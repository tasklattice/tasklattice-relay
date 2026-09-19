function workerReport() {
  return { reportedAt: new Date().toISOString(), workerId: "test-worker", ready: true,
    projectTargetRouting: true, kubernetesAccess: true, sandbox: {
      gatewayImage: "registry.example/worker-gateway:configured", supervisorImage: "registry.example/supervisor:test",
      defaultImage: "registry.example/base:test", defaultImagePullPolicy: "IfNotPresent", tlsDisabled: true } };
}
import { getWorkerConfig, setWorkerConfigForTests, developmentWorkerConfig } from "../config/worker-config";
import { developmentControlConfig, getControlConfig, setControlConfigForTests } from "../config/control-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  providerKinds,
  updatePlatformSettingsSchema,
  type ValidatePlatformSsoSettingsInput,
} from "@tali/contracts";
import { createTestPrisma } from "../test/prisma";
import { PlatformSettingsService } from "./platform-settings-service";

async function saveValidatedSecurity(
  service: PlatformSettingsService,
  input: ValidatePlatformSsoSettingsInput,
  actor = "platform-admin",
) {
  const validation = await service.validateSecurity(input);
  return service.updateSecurity(
    { ...input, validationToken: validation.validationToken },
    actor,
  );
}

describe("PlatformSettingsService", () => {
  beforeEach(() => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://tali.example"];
    setControlConfigForTests(config);
  });

  afterEach(() => {
    setControlConfigForTests(undefined);
    setWorkerConfigForTests(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects disabling Runtime Namespaces in the Project Gateway topology", async () => {
    const db = createTestPrisma();
    await db.platformSettingsRecord.upsert({ where: { id: "platform" },
      create: { id: "platform", revision: 0, workerRuntime: workerReport() }, update: { workerRuntime: workerReport() } });
    const service = new PlatformSettingsService(db);

    await expect(service.validateInfrastructure({
      controlInternalUrl: "http://control.ns.svc.cluster.local",
      runner: {
        url: "http://runner.internal",
        token: { action: "replace", value: "runner-secret" },
      },
      litellm: {
        url: "http://litellm.internal",
        masterKey: { action: "replace", value: "litellm-secret" },
      },
      runtimeNamespaces: { enabled: false, clusterId: "in-cluster" },
    })).rejects.toThrow(
      "Runtime Namespaces cannot be disabled while Project target routing is enabled",
    );
  });

  it("rejects an external Control URL when Project Runtime Bridges are enabled", async () => {
    getWorkerConfig().project_runtime_bridge.enabled = true;
    const service = new PlatformSettingsService(createTestPrisma());

    await expect(service.validateInfrastructure({
      controlInternalUrl: "https://control.example.com",
      runner: {
        url: "http://runner.internal",
        token: { action: "replace", value: "runner-secret" },
      },
      litellm: {
        url: "http://litellm.internal",
        masterKey: { action: "replace", value: "litellm-secret" },
      },
      runtimeNamespaces: { enabled: true, clusterId: "in-cluster" },
    })).rejects.toThrow("in-cluster HTTP Service FQDN");
  });

  it("validates runtime connections before saving encrypted infrastructure settings", async () => {
    const db = createTestPrisma();
    const runtimeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://control.ns.svc.cluster.local/api/health") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === "http://runner.internal/health") {
        expect(new Headers(init?.headers).get("authorization"))
          .toBe("Bearer runner-secret");
        return new Response(JSON.stringify({
          ok: true,
          mode: "openshell-kubernetes",
        }), { status: 200 });
      }
      if (url === "http://litellm.internal/health/liveliness") {
        expect(new Headers(init?.headers).get("authorization"))
          .toBe("Bearer litellm-secret");
        return new Response(JSON.stringify({
          status: "healthy",
          version: "1.2.3",
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", runtimeFetch);
    const verifyRuntimeNamespaceAccess = vi.fn(async () => {});
    const service = new PlatformSettingsService(
      db,
      runtimeFetch,
      undefined,
      verifyRuntimeNamespaceAccess,
    );
    const draft = {
      controlInternalUrl: "http://control.ns.svc.cluster.local",
      runner: {
        url: "http://runner.internal",
        token: { action: "replace" as const, value: "runner-secret" },
      },
      litellm: {
        url: "http://litellm.internal",
        masterKey: { action: "replace" as const, value: "litellm-secret" },
      },
      runtimeNamespaces: {
        enabled: true,
        clusterId: "in-cluster",
      },
    };

    const validation = await service.validateInfrastructure(draft);
    expect(validation).toMatchObject({
      control: { ok: true },
      runner: { ok: true, mode: "openshell-kubernetes" },
      litellm: { ok: true, version: "1.2.3" },
      runtimeNamespaces: { ok: true, existingTargetCount: 0 },
    });
    expect(verifyRuntimeNamespaceAccess).toHaveBeenCalledOnce();
    await expect(service.updateInfrastructure({
      ...draft,
      runner: { ...draft.runner, url: "http://changed.internal" },
      validationToken: validation.validationToken,
    }, "platform-admin")).rejects.toThrow("changed after validation");

    const updated = await service.updateInfrastructure({
      ...draft,
      validationToken: validation.validationToken,
    }, "platform-admin");
    expect(updated).toEqual({
      controlInternalUrl: "http://control.ns.svc.cluster.local",
      runner: { url: "http://runner.internal", tokenConfigured: true },
      litellm: { url: "http://litellm.internal", masterKeyConfigured: true },
      runtimeNamespaces: {
        enabled: true,
        clusterId: "in-cluster",
      },
    });
    const record = await db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
    });
    expect(record.runnerTokenEncrypted).toMatch(/^v1:/);
    expect(record.litellmMasterKeyEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(record)).not.toContain("runner-secret");
    expect(JSON.stringify(record)).not.toContain("litellm-secret");
  });

  it("rejects quota configuration at the Platform scope", () => {
    const result = updatePlatformSettingsSchema.safeParse({
      runtimeImages: { openclaw: null, hermes: null, deepagents: null },
      sandbox: { cpu: null, memory: null },
      runtimePolicy: { namespaceDeletionTimeoutSeconds: 120 },
      enabledProviderKinds: providerKinds,
      quotaDefaults: { hardBudgetUsd: 1_000 },
    });

    expect(result.success).toBe(false);
  });

  it("uses Runner deployment images until a Platform Administrator saves overrides", async () => {
    const db = createTestPrisma();
    await db.platformSettingsRecord.upsert({ where: { id: "platform" },
      create: { id: "platform", revision: 0, workerRuntime: workerReport() }, update: { workerRuntime: workerReport() } });
    const service = new PlatformSettingsService(db);
    const initial = await service.get({
      ok: true,
      mode: "openshell-kubernetes",
      runtimeImages: {
        openclaw: "registry.example/openclaw:release",
        hermes: "registry.example/hermes:release",
        deepagents: "registry.example/deepagents:release",
      },
      sandbox: {
        provider: "openshell",
        cpu: "750m",
        memory: "3Gi",
        gatewayEndpoint: "http://openshell.tali.svc.cluster.local:8080",
        workspace: "default",
        serviceBaseUrl: "https://sandboxes.example",
        kubernetesServiceCidrs: ["10.0.0.0/8"],
        gatewayImage: "ghcr.io/nvidia/openshell/gateway:0.0.111",
        supervisorImage: "ghcr.io/nvidia/openshell/supervisor:0.0.111",
        defaultImage: "ghcr.io/nvidia/openshell-community/sandboxes/base:latest",
        defaultImagePullPolicy: "Always",
        tlsDisabled: true,
      },
    });
    expect(initial).toMatchObject({
      runtimeImages: { openclaw: null, hermes: null, deepagents: null },
      effectiveRuntimeImages: {
        openclaw: "registry.example/openclaw:release",
        hermes: "registry.example/hermes:release",
        deepagents: "registry.example/deepagents:release",
      },
      runtimeStatus: { available: true, mode: "openshell-kubernetes" },
      sandbox: { cpu: null, memory: null },
      effectiveSandbox: { cpu: "750m", memory: "3Gi" },
      sandboxRuntime: {
        available: true,
        provider: "openshell",
        gatewayImage: "registry.example/worker-gateway:configured",
      },
      runtimePolicy: { namespaceDeletionTimeoutSeconds: 120 },
      security: {
        canEditOnline: true,
        configurationError: null,
        localAuthenticationEnabled: true,
        sso: {
          enabled: false,
          clientSecretConfigured: false,
        },
      },
      email: {
        enabled: false,
        host: "",
        passwordConfigured: false,
        port: 587,
      },
      enabledProviderKinds: providerKinds,
      revision: 0,
    });

    const updated = await service.update({
      runtimeImages: {
        openclaw: "registry.example/openclaw@sha256:abc123",
        hermes: null,
        deepagents: "registry.example/deepagents@sha256:def456",
      },
      sandbox: { cpu: "1.5", memory: "4Gi" },
      runtimePolicy: { namespaceDeletionTimeoutSeconds: 45 },
      enabledProviderKinds: ["openai", "anthropic"],
    }, "platform-admin", {
      ok: true,
      mode: "openshell-kubernetes",
      runtimeImages: {
        openclaw: "registry.example/openclaw:release",
        hermes: "registry.example/hermes:release",
        deepagents: "registry.example/deepagents:release",
      },
      sandbox: {
        provider: "openshell",
        cpu: "750m",
        memory: "3Gi",
        gatewayEndpoint: "http://openshell.tali.svc.cluster.local:8080",
        workspace: "default",
        serviceBaseUrl: "https://sandboxes.example",
        kubernetesServiceCidrs: ["10.0.0.0/8"],
      },
    });
    expect(updated).toMatchObject({
      effectiveRuntimeImages: {
        openclaw: "registry.example/openclaw@sha256:abc123",
        hermes: "registry.example/hermes:release",
        deepagents: "registry.example/deepagents@sha256:def456",
      },
      enabledProviderKinds: ["openai", "anthropic"],
      runtimePolicy: { namespaceDeletionTimeoutSeconds: 45 },
      sandbox: { cpu: "1.5", memory: "4Gi" },
      effectiveSandbox: { cpu: "1.5", memory: "4Gi" },
      revision: 1,
      updatedBy: "platform-admin",
    });
    await expect(service.runtimeImageOverride("openclaw"))
      .resolves.toBe("registry.example/openclaw@sha256:abc123");
    await expect(service.runtimeImageOverride("deepagents"))
      .resolves.toBe("registry.example/deepagents@sha256:def456");
    await expect(db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
      select: { runtimeImages: true },
    })).resolves.toEqual({
      runtimeImages: {
        openclaw: "registry.example/openclaw@sha256:abc123",
        hermes: null,
        deepagents: "registry.example/deepagents@sha256:def456",
      },
    });
    await expect(service.sandboxProvisioningOverrides())
      .resolves.toEqual({ cpu: "1.5", memory: "4Gi" });
    await expect(service.assertProviderEnabled("deepseek"))
      .rejects.toThrow("disabled by the Platform Administrator Provider policy");
  });

  it("validates and encrypts an online OIDC override without returning its secret", async () => {
    const db = createTestPrisma();
    const oidcFetch = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).endsWith("/jwks")
        ? { keys: [{ kid: "signing-key", kty: "RSA" }] }
        : {
            issuer: "https://identity.example",
            authorization_endpoint: "https://identity.example/authorize",
            token_endpoint: "https://identity.example/token",
            jwks_uri: "https://identity.example/jwks",
          },
    ), {
      headers: { "content-type": "application/json" },
      status: 200,
    })) as unknown as typeof fetch;
    const service = new PlatformSettingsService(db, oidcFetch);

    const updated = await saveValidatedSecurity(service, {
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    });

    expect(updated).toMatchObject({
      configurationError: null,
      sso: {
        clientId: "tali-control",
        clientSecretConfigured: true,
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    });
    expect(JSON.stringify(updated)).not.toContain("provider-secret");
    expect(oidcFetch).toHaveBeenCalledWith(
      "https://identity.example/.well-known/openid-configuration",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const record = await db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
    });
    expect(record.oidcClientSecretEncrypted).toMatch(/^v1:/);
    expect(record.oidcClientSecretEncrypted).not.toContain("provider-secret");
    await expect(service.authRuntimeSettings()).resolves.toMatchObject({
      revision: 1,
      sso: { clientSecret: "provider-secret", enabled: true },
    });

    await saveValidatedSecurity(service, {
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control-v2",
        clientSecret: { action: "preserve" },
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    });
    await expect(service.authRuntimeSettings()).resolves.toMatchObject({
      revision: 2,
      sso: { clientId: "tali-control-v2", clientSecret: "provider-secret" },
    });

  });

  it("does not activate an unreachable OIDC issuer", async () => {
    const oidcFetch = vi.fn(async () => new Response("unavailable", {
      status: 503,
    })) as unknown as typeof fetch;
    const service = new PlatformSettingsService(createTestPrisma(), oidcFetch);

    await expect(saveValidatedSecurity(service, {
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    })).rejects.toThrow(
      "OIDC discovery returned HTTP 503",
    );
  });

  it("validates OIDC discovery and signing keys without saving the draft", async () => {
    const db = createTestPrisma();
    const oidcFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({
          issuer: "https://identity.example",
          authorization_endpoint: "https://identity.example/authorize",
          token_endpoint: "https://identity.example/token",
          jwks_uri: "https://identity.example/jwks",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        keys: [
          { kid: "signing-key-1", kty: "RSA" },
          { kid: "signing-key-2", kty: "EC" },
        ],
      }), { status: 200 });
    });
    const service = new PlatformSettingsService(db, oidcFetch as unknown as typeof fetch);

    await expect(service.validateSecurity({
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    })).resolves.toMatchObject({
      discoveryUrl: "https://identity.example/.well-known/openid-configuration",
      issuer: "https://identity.example",
      jwksUri: "https://identity.example/jwks",
      signingKeyCount: 2,
    });
    expect(oidcFetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(oidcFetch.mock.calls)).not.toContain("provider-secret");
    await expect(db.platformSettingsRecord.count()).resolves.toBe(0);
  });

  it("rejects OIDC validation when the JWKS has no signing keys", async () => {
    const oidcFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith("/jwks")
        ? { keys: [] }
        : {
            issuer: "https://identity.example",
            authorization_endpoint: "https://identity.example/authorize",
            token_endpoint: "https://identity.example/token",
            jwks_uri: "https://identity.example/jwks",
          }), { status: 200 });
    });
    const service = new PlatformSettingsService(
      createTestPrisma(),
      oidcFetch as unknown as typeof fetch,
    );

    await expect(service.validateSecurity({
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Company SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    })).rejects.toThrow("OIDC JWKS does not contain any signing keys");
  });

  it("rejects a draft that disables every authentication method", async () => {
    const service = new PlatformSettingsService(createTestPrisma());

    await expect(service.validateSecurity({
      localAuthenticationEnabled: false,
      sso: {
        clientId: "tali-control",
        clientSecret: { action: "clear" },
        displayName: "Company SSO",
        enabled: false,
        issuer: "https://identity.example",
      },
    })).rejects.toThrow(
      "at least one Platform authentication method",
    );
  });

  it("stores email delivery settings and secrets only in the Platform database", async () => {
    const db = createTestPrisma();
    const service = new PlatformSettingsService(db);

    const updated = await service.updateEmail({
      enabled: true,
      fromAddress: "invites@tali.example",
      fromName: "TaskLattice Relay",
      host: "smtp.example",
      password: { action: "replace", value: "smtp-secret" },
      port: 587,
      replyTo: "support@tali.example",
      secure: false,
      username: "mailer",
    }, "platform-admin");

    expect(updated).toMatchObject({
      enabled: true,
      host: "smtp.example",
      passwordConfigured: true,
      username: "mailer",
    });
    expect(JSON.stringify(updated)).not.toContain("smtp-secret");
    await expect(service.emailRuntimeSettings()).resolves.toMatchObject({
      enabled: true,
      password: "smtp-secret",
    });
    const record = await db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
    });
    expect(record.smtpPasswordEncrypted).toMatch(/^v1:/);
    expect(record.smtpPasswordEncrypted).not.toContain("smtp-secret");
  });

  it("validates a draft SMTP connection with the preserved encrypted password", async () => {
    const db = createTestPrisma();
    const smtpVerify = vi.fn(async () => undefined);
    const service = new PlatformSettingsService(db, fetch, smtpVerify);
    await service.updateEmail({
      enabled: true,
      fromAddress: "invites@tali.example",
      fromName: "TaskLattice Relay",
      host: "smtp.saved.example",
      password: { action: "replace", value: "smtp-secret" },
      port: 587,
      replyTo: "",
      secure: false,
      username: "mailer",
    }, "platform-admin");

    const validation = await service.validateEmail({
      host: "smtp.draft.example",
      password: { action: "preserve" },
      port: 465,
      secure: true,
      username: "mailer",
    });

    expect(smtpVerify).toHaveBeenCalledWith({
      host: "smtp.draft.example",
      password: "smtp-secret",
      port: 465,
      secure: true,
      username: "mailer",
    });
    expect(validation).toMatchObject({
      authentication: "authenticated",
      host: "smtp.draft.example",
      port: 465,
      secure: true,
    });
    expect(JSON.stringify(validation)).not.toContain("smtp-secret");
    await expect(service.validateEmail({
      host: "smtp.draft.example",
      password: { action: "clear" },
      port: 587,
      secure: false,
      username: "mailer",
    })).rejects.toThrow("username and password must be configured together");
  });
});
