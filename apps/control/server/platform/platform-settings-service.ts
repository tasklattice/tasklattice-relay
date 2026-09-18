import {
  mapAgentPlatforms,
  providerKinds,
  type AgentPlatformId,
  type ExternalRoleBindingView,
  type PlatformEmailValidationView,
  type PlatformEmailSettingsView,
  type PlatformInfrastructureSettingsView,
  type PlatformInfrastructureValidationView,
  type PlatformSecuritySettingsView,
  type PlatformSettingsView,
  type PlatformSsoValidationView,
  type ProviderKind,
  type RunnerHealth,
  type UpdatePlatformInfrastructureSettingsInput,
  type UpdatePlatformSecuritySettingsInput,
  type UpdatePlatformEmailSettingsInput,
  type UpdatePlatformSettingsInput,
  type ValidatePlatformEmailSettingsInput,
  type ValidatePlatformInfrastructureSettingsInput,
  type ValidatePlatformSsoSettingsInput,
} from "@tali/contracts";
import { getControlConfig } from "../config/control-config";
import { prisma } from "../db/prisma";
import {
  verifySmtpConnection,
  type SmtpConnectionSettings,
} from "../email/smtp-transport";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  decryptPlatformSecret,
  encryptPlatformSecret,
} from "./platform-secret-crypto";
import { ExternalRoleBindingService } from "../auth/external-role-bindings";
import { NemoClawRunnerClient } from "../runtime/nemoclaw-runner-client";
import { LiteLLMClient } from "../providers/litellm-client";
import {
  assertPlatformSettingsValidation,
  issuePlatformSettingsValidation,
} from "./platform-settings-validation";
import { deploymentBootstrapRuntimeConfiguration } from "./platform-runtime-config";
import { requireWorkerRuntime, readWorkerRuntime } from "./worker-runtime-report";
import { controlNetworkTarget } from "../kubernetes/project-runtime-bridge-client";

const fallbackRuntimeImages = mapAgentPlatforms(
  (platform) => platform.sandboxImage,
);

const fallbackSandboxDefaults = {
  cpu: "1",
  memory: "2Gi",
} as const;

function providerKindList(value: Prisma.JsonValue | null | undefined): ProviderKind[] {
  if (value === null || value === undefined) return [...providerKinds];
  if (!Array.isArray(value)) return [...providerKinds];
  const allowed = new Set<string>(providerKinds);
  return value.filter(
    (item): item is ProviderKind => typeof item === "string" && allowed.has(item),
  );
}

function runtimeImageOverrides(
  value: Prisma.JsonValue | null | undefined,
): Record<AgentPlatformId, string | null> {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return mapAgentPlatforms((platform) => {
    const image = stored[platform.id];
    return typeof image === "string" && image.trim() ? image : null;
  });
}

function normalizedHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface PlatformAuthRuntimeSettings {
  localAuthenticationEnabled: boolean;
  revision: number;
  sso: {
    clientId: string;
    clientSecret: string;
    displayName: string;
    enabled: boolean;
    groupClaim: string;
    issuer: string;
  };
}

export interface PlatformEmailRuntimeSettings extends PlatformEmailSettingsView {
  password: string;
}

interface OidcDiscoveryDocument {
  authorizationEndpoint: string;
  discoveryUrl: string;
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
}

export class PlatformSettingsService {
  constructor(
    private readonly db: PrismaClient = prisma(),
    private readonly oidcFetch: typeof fetch = fetch,
    private readonly smtpVerify: (
      settings: SmtpConnectionSettings,
    ) => Promise<void> = verifySmtpConnection,
    private readonly runtimeNamespaceAccessVerify: () => Promise<void> =
      async () => { requireWorkerRuntime((await this.stored())?.workerRuntime); },
  ) {}

  private stored() {
    return this.db.platformSettingsRecord.findUnique({
      where: { id: "platform" },
    });
  }

  async runtimeImageOverride(
    agentPlatform: AgentPlatformId,
  ): Promise<string | null> {
    const settings = await this.stored();
    return runtimeImageOverrides(settings?.runtimeImages)[agentPlatform];
  }

  async sandboxProvisioningOverrides(): Promise<{
    cpu?: string;
    memory?: string;
  } | null> {
    const settings = await this.stored();
    if (!settings?.sandboxCpu && !settings?.sandboxMemory) return null;
    return {
      ...(settings.sandboxCpu ? { cpu: settings.sandboxCpu } : {}),
      ...(settings.sandboxMemory ? { memory: settings.sandboxMemory } : {}),
    };
  }

  async assertProviderEnabled(provider: ProviderKind): Promise<void> {
    const settings = await this.stored();
    if (!providerKindList(settings?.enabledProviderKinds).includes(provider)) {
      throw new Error(
        `${provider} is disabled by the Platform Administrator Provider policy.`,
      );
    }
  }

  async get(health?: RunnerHealth): Promise<PlatformSettingsView> {
    const settings = await this.stored();
    const roleBindings = await new ExternalRoleBindingService(this.db).list();
    const runtimeImages = runtimeImageOverrides(settings?.runtimeImages);
    return {
      runtimeImages,
      effectiveRuntimeImages: mapAgentPlatforms(
        (platform) =>
          runtimeImages[platform.id]
          ?? health?.runtimeImages?.[platform.id]
          ?? fallbackRuntimeImages[platform.id],
      ),
      sandbox: {
        cpu: settings?.sandboxCpu ?? null,
        memory: settings?.sandboxMemory ?? null,
      },
      effectiveSandbox: {
        cpu:
          settings?.sandboxCpu
          ?? health?.sandbox?.cpu
          ?? fallbackSandboxDefaults.cpu,
        memory:
          settings?.sandboxMemory
          ?? health?.sandbox?.memory
          ?? fallbackSandboxDefaults.memory,
      },
      sandboxRuntime: {
        available: health?.ok === true && health?.sandbox?.provider === "openshell",
        provider: "openshell",
        ...(health?.mode ? { mode: health.mode } : {}),
        ...(health?.sandbox?.gatewayEndpoint
          ? { gatewayEndpoint: health.sandbox.gatewayEndpoint }
          : {}),
        ...(health?.sandbox?.workspace
          ? { workspace: health.sandbox.workspace }
          : {}),
        ...(health?.sandbox?.serviceBaseUrl
          ? { serviceBaseUrl: health.sandbox.serviceBaseUrl }
          : {}),
        ...(health?.sandbox?.kubernetesServiceCidrs
          ? { kubernetesServiceCidrs: health.sandbox.kubernetesServiceCidrs }
          : {}),
        ...(readWorkerRuntime(settings?.workerRuntime)?.sandbox ?? {}),
      },
      runtimeStatus: {
        available: health?.ok === true,
        ...(health?.mode ? { mode: health.mode } : {}),
      },
      runtimePolicy: {
        namespaceDeletionTimeoutSeconds:
          settings?.runtimeNamespaceDeletionTimeoutSeconds ?? 120,
      },
      infrastructure: this.infrastructureView(settings),
      security: this.securityView(settings, roleBindings),
      email: this.emailView(settings),
      enabledProviderKinds: providerKindList(settings?.enabledProviderKinds),
      revision: settings?.revision ?? 0,
      updatedAt: settings?.updatedAt.toISOString() ?? null,
      updatedBy: settings?.updatedBy ?? null,
    };
  }

  async update(
    input: UpdatePlatformSettingsInput,
    actor: string,
    health?: RunnerHealth,
  ): Promise<PlatformSettingsView> {
    await this.db.platformSettingsRecord.upsert({
      where: { id: "platform" },
      create: {
        id: "platform",
        runtimeImages: input.runtimeImages,
        sandboxCpu: input.sandbox.cpu,
        sandboxMemory: input.sandbox.memory,
        enabledProviderKinds: input.enabledProviderKinds,
        runtimeNamespaceDeletionTimeoutSeconds:
          input.runtimePolicy.namespaceDeletionTimeoutSeconds,
        updatedBy: actor,
      },
      update: {
        runtimeImages: input.runtimeImages,
        sandboxCpu: input.sandbox.cpu,
        sandboxMemory: input.sandbox.memory,
        enabledProviderKinds: input.enabledProviderKinds,
        runtimeNamespaceDeletionTimeoutSeconds:
          input.runtimePolicy.namespaceDeletionTimeoutSeconds,
        updatedBy: actor,
        revision: { increment: 1 },
      },
    });
    return this.get(health);
  }

  async getInfrastructure(): Promise<PlatformInfrastructureSettingsView> {
    return this.infrastructureView(await this.stored());
  }

  async validateInfrastructure(
    input: ValidatePlatformInfrastructureSettingsInput,
  ): Promise<PlatformInfrastructureValidationView> {
    if (!input.runtimeNamespaces.enabled && readWorkerRuntime((await this.stored())?.workerRuntime)?.projectTargetRouting) {
      throw new Error("Runtime Namespaces cannot be disabled while Project target routing is enabled by the Worker.");
    }
    const current = await this.stored();
    const runnerToken = input.runner.token.action === "replace"
      ? input.runner.token.value
      : this.currentRunnerToken(current);
    const litellmMasterKey = input.litellm.masterKey.action === "replace"
      ? input.litellm.masterKey.value
      : this.currentLiteLlmMasterKey(current);
    if (!runnerToken) throw new Error("A Runner token is required before validation.");
    if (!litellmMasterKey) throw new Error("A LiteLLM master key is required before validation.");

    const controlUrl = input.controlInternalUrl.replace(/\/+$/, "");
    if (
      input.runtimeNamespaces.enabled

    ) {
      controlNetworkTarget(controlUrl);
    }
    const controlProbe = this.oidcFetch(`${controlUrl}/api/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Control internal URL returned HTTP ${response.status}.`);
      const payload = await response.json() as { ok?: unknown };
      if (payload.ok !== true) throw new Error("Control internal URL did not report a healthy service.");
      return { ok: true as const };
    }).catch((error) => {
      throw new Error(
        `Control internal URL validation failed: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    });
    const runnerProbe = new NemoClawRunnerClient(
      input.runner.url,
      runnerToken,
    ).getHealth().then((health) => ({ ok: true as const, mode: health.mode }));
    const litellmProbe = new LiteLLMClient(
      input.litellm.url,
      litellmMasterKey,
    ).testConnection().then((result) => ({
      ok: true as const,
      ...(result.version ? { version: result.version } : {}),
    }));

    const [control, runner, litellm, existingTargetCount, mismatchedTarget] =
      await Promise.all([
        controlProbe,
        runnerProbe,
        litellmProbe,
        this.db.projectRuntimeTarget.count(),
        this.db.projectRuntimeTarget.findFirst({
          where: { clusterId: { not: input.runtimeNamespaces.clusterId } },
          select: { clusterId: true },
        }),
      ]);
    if (input.runtimeNamespaces.enabled) {
      await this.runtimeNamespaceAccessVerify();
    }
    if (mismatchedTarget) {
      throw new Error(
        `Existing Runtime Targets belong to cluster ${mismatchedTarget.clusterId}. Migrate them before changing the Platform cluster identity.`,
      );
    }
    const validation = issuePlatformSettingsValidation(
      "infrastructure",
      this.infrastructureValidationPayload(input, runnerToken, litellmMasterKey),
    );
    return {
      control,
      runner,
      litellm,
      runtimeNamespaces: { ok: true, existingTargetCount },
      ...validation,
    };
  }

  async updateInfrastructure(
    input: UpdatePlatformInfrastructureSettingsInput,
    actor: string,
  ): Promise<PlatformInfrastructureSettingsView> {
    if (!input.runtimeNamespaces.enabled && readWorkerRuntime((await this.stored())?.workerRuntime)?.projectTargetRouting) {
      throw new Error("Runtime Namespaces cannot be disabled while Project target routing is enabled by the Worker.");
    }
    const current = await this.stored();
    const runnerToken = input.runner.token.action === "replace"
      ? input.runner.token.value
      : this.currentRunnerToken(current);
    const litellmMasterKey = input.litellm.masterKey.action === "replace"
      ? input.litellm.masterKey.value
      : this.currentLiteLlmMasterKey(current);
    if (!runnerToken || !litellmMasterKey) {
      throw new Error("Runner and LiteLLM credentials must be configured.");
    }
    assertPlatformSettingsValidation(
      "infrastructure",
      this.infrastructureValidationPayload(input, runnerToken, litellmMasterKey),
      input.validationToken,
    );
    const config = getControlConfig();
    await this.db.platformSettingsRecord.upsert({
      where: { id: "platform" },
      create: {
        id: "platform",
        controlInternalUrl: input.controlInternalUrl.replace(/\/+$/, ""),
        runnerUrl: input.runner.url.replace(/\/+$/, ""),
        runnerTokenEncrypted: encryptPlatformSecret(runnerToken, config.auth.secret),
        litellmUrl: input.litellm.url.replace(/\/+$/, ""),
        litellmMasterKeyEncrypted: encryptPlatformSecret(litellmMasterKey, config.auth.secret),
        runtimeNamespacesEnabled: input.runtimeNamespaces.enabled,
        runtimeClusterId: input.runtimeNamespaces.clusterId,
        updatedBy: actor,
      },
      update: {
        controlInternalUrl: input.controlInternalUrl.replace(/\/+$/, ""),
        runnerUrl: input.runner.url.replace(/\/+$/, ""),
        runnerTokenEncrypted: encryptPlatformSecret(runnerToken, config.auth.secret),
        litellmUrl: input.litellm.url.replace(/\/+$/, ""),
        litellmMasterKeyEncrypted: encryptPlatformSecret(litellmMasterKey, config.auth.secret),
        runtimeNamespacesEnabled: input.runtimeNamespaces.enabled,
        runtimeClusterId: input.runtimeNamespaces.clusterId,
        updatedBy: actor,
        revision: { increment: 1 },
      },
    });
    return this.infrastructureView(await this.stored());
  }

  async authRuntimeSettings(): Promise<PlatformAuthRuntimeSettings> {
    const settings = await this.stored();
    const config = getControlConfig();
    if (!settings) {
      return {
        localAuthenticationEnabled: config.auth.local.enabled,
        revision: 0,
        sso: {
          clientId: "",
          clientSecret: "",
          displayName: "SSO",
          enabled: false,
          groupClaim: "groups",
          issuer: "",
        },
      };
    }
    try {
      return {
        localAuthenticationEnabled:
          settings.localAuthenticationEnabled ?? config.auth.local.enabled,
        revision: settings.revision,
        sso: {
          clientId: settings.oidcClientId,
          clientSecret: settings.oidcClientSecretEncrypted
            ? decryptPlatformSecret(
                settings.oidcClientSecretEncrypted,
                config.auth.secret,
              )
            : "",
          displayName: settings.oidcDisplayName,
          enabled: settings.oidcEnabled,
          groupClaim: settings.oidcGroupClaim,
          issuer: settings.oidcIssuer,
        },
      };
    } catch (error) {
      if (!(settings.localAuthenticationEnabled ?? config.auth.local.enabled)) throw error;
      console.error(
        "Platform SSO override is unreadable; continuing with Local authentication only.",
        error,
      );
      return {
        localAuthenticationEnabled: true,
        revision: settings.revision,
        sso: {
          clientId: "",
          clientSecret: "",
          displayName: settings.oidcDisplayName,
          enabled: false,
          groupClaim: settings.oidcGroupClaim,
          issuer: "",
        },
      };
    }
  }

  async authRevisionKey(): Promise<string> {
    const settings = await this.stored();
    return String(settings?.revision ?? 0);
  }

  async updateSecurity(
    input: UpdatePlatformSecuritySettingsInput,
    actor: string,
  ): Promise<PlatformSecuritySettingsView> {
    const config = getControlConfig();
    const current = await this.stored();
    const effectiveSecret = input.sso.clientSecret.action === "replace"
      ? input.sso.clientSecret.value
      : input.sso.clientSecret.action === "clear"
        ? ""
        : this.currentClientSecret(current);
    if (input.sso.enabled && !effectiveSecret) {
      throw new Error("A Client secret is required when SSO is enabled.");
    }
    if (!input.localAuthenticationEnabled && !input.sso.enabled)
      throw new Error("Keep at least one Platform authentication method enabled.");
    assertPlatformSettingsValidation(
      "security",
      this.securityValidationPayload(input, effectiveSecret),
      input.validationToken,
    );
    const encryptedSecret = effectiveSecret
      ? encryptPlatformSecret(effectiveSecret, config.auth.secret)
      : null;
    await this.db.platformSettingsRecord.upsert({
      where: { id: "platform" },
      create: {
        id: "platform",
        oidcEnabled: input.sso.enabled,
        oidcDisplayName: input.sso.displayName,
        oidcIssuer: input.sso.issuer,
        oidcClientId: input.sso.clientId,
        oidcGroupClaim: input.sso.groupClaim ?? "groups",
        oidcClientSecretEncrypted: encryptedSecret,
        localAuthenticationEnabled: input.localAuthenticationEnabled,
        updatedBy: actor,
      },
      update: {
        oidcEnabled: input.sso.enabled,
        oidcDisplayName: input.sso.displayName,
        oidcIssuer: input.sso.issuer,
        oidcClientId: input.sso.clientId,
        oidcGroupClaim: input.sso.groupClaim ?? "groups",
        oidcClientSecretEncrypted: encryptedSecret,
        localAuthenticationEnabled: input.localAuthenticationEnabled,
        updatedBy: actor,
        revision: { increment: 1 },
      },
    });
    return this.getSecurity();
  }

  async getSecurity(): Promise<PlatformSecuritySettingsView> {
    const [settings, roleBindings] = await Promise.all([
      this.stored(),
      new ExternalRoleBindingService(this.db).list(),
    ]);
    return this.securityView(settings, roleBindings);
  }

  async runtimeNamespaceDeletionTimeoutSeconds(): Promise<number> {
    return (await this.stored())?.runtimeNamespaceDeletionTimeoutSeconds ?? 120;
  }

  async emailRuntimeSettings(): Promise<PlatformEmailRuntimeSettings> {
    const settings = await this.stored();
    const view = this.emailView(settings);
    if (view.configurationError) throw new Error(view.configurationError);
    const config = getControlConfig();
    return {
      ...view,
      password: settings?.smtpPasswordEncrypted
        ? decryptPlatformSecret(settings.smtpPasswordEncrypted, config.auth.secret)
        : "",
    };
  }

  async updateEmail(
    input: UpdatePlatformEmailSettingsInput,
    actor: string,
  ): Promise<PlatformEmailSettingsView> {
    const current = await this.stored();
    const password = input.password.action === "replace"
      ? input.password.value
      : input.password.action === "clear"
        ? ""
        : this.currentEmailPassword(current);
    if (input.enabled && Boolean(input.username) !== Boolean(password)) {
      throw new Error(
        "SMTP username and password must be configured together when email delivery is enabled.",
      );
    }
    const config = getControlConfig();
    const encryptedPassword = password
      ? encryptPlatformSecret(password, config.auth.secret)
      : null;
    await this.db.platformSettingsRecord.upsert({
      where: { id: "platform" },
      create: {
        id: "platform",
        smtpEnabled: input.enabled,
        smtpHost: input.host,
        smtpPort: input.port,
        smtpSecure: input.secure,
        smtpUsername: input.username,
        smtpPasswordEncrypted: encryptedPassword,
        smtpFromAddress: input.fromAddress,
        smtpFromName: input.fromName,
        smtpReplyTo: input.replyTo,
        updatedBy: actor,
      },
      update: {
        smtpEnabled: input.enabled,
        smtpHost: input.host,
        smtpPort: input.port,
        smtpSecure: input.secure,
        smtpUsername: input.username,
        smtpPasswordEncrypted: encryptedPassword,
        smtpFromAddress: input.fromAddress,
        smtpFromName: input.fromName,
        smtpReplyTo: input.replyTo,
        updatedBy: actor,
        revision: { increment: 1 },
      },
    });
    return this.emailView(await this.stored());
  }

  async validateEmail(
    input: ValidatePlatformEmailSettingsInput,
  ): Promise<PlatformEmailValidationView> {
    const current = await this.stored();
    const password = input.password.action === "replace"
      ? input.password.value
      : input.password.action === "clear"
        ? ""
        : this.currentEmailPassword(current);
    if (Boolean(input.username) !== Boolean(password)) {
      throw new Error(
        "SMTP username and password must be configured together before testing the connection.",
      );
    }
    try {
      await this.smtpVerify({
        host: input.host,
        password,
        port: input.port,
        secure: input.secure,
        username: input.username,
      });
    } catch (error) {
      throw new Error(
        `SMTP connection validation failed: ${
          error instanceof Error ? error.message : "unknown SMTP error"
        }`,
      );
    }
    return {
      authentication: input.username ? "authenticated" : "not_required",
      host: input.host,
      port: input.port,
      secure: input.secure,
      validatedAt: new Date().toISOString(),
    };
  }

  async validateSecurity(
    input: ValidatePlatformSsoSettingsInput,
  ): Promise<PlatformSsoValidationView> {
    const current = await this.stored();
    const effectiveSecret = input.sso.clientSecret.action === "replace"
      ? input.sso.clientSecret.value
      : input.sso.clientSecret.action === "clear"
        ? ""
        : this.currentClientSecret(current);
    if (!input.localAuthenticationEnabled && !input.sso.enabled) {
      throw new Error("Keep at least one Platform authentication method enabled.");
    }
    if (input.sso.enabled && !effectiveSecret) {
      throw new Error("A Client secret is required to validate SSO.");
    }
    const localCredentialReady = Boolean(await this.db.authAccount.findFirst({
      where: { providerId: "credential", userId: "local-admin" },
      select: { id: true },
    }));
    if (input.localAuthenticationEnabled && !localCredentialReady) {
      throw new Error(
        "Local authentication cannot be enabled until the bootstrap Platform Administrator has a credential.",
      );
    }
    const validation = issuePlatformSettingsValidation(
      "security",
      this.securityValidationPayload(input, effectiveSecret),
    );
    if (!input.sso.enabled) {
      return {
        expiresAt: validation.expiresAt,
        localCredentialReady,
        signingKeyCount: 0,
        validatedAt: validation.validatedAt,
        validationToken: validation.validationToken,
      };
    }

    const discovery = await this.readOidcDiscovery(input.sso.issuer);
    let response: Response;
    try {
      response = await this.oidcFetch(discovery.jwksUri, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new Error(
        `OIDC JWKS is unavailable: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
    if (!response.ok) {
      throw new Error(`OIDC JWKS returned HTTP ${response.status}.`);
    }
    let jwks: Record<string, unknown>;
    try {
      jwks = await response.json() as Record<string, unknown>;
    } catch {
      throw new Error("OIDC JWKS did not return a valid JSON document.");
    }
    if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error("OIDC JWKS does not contain any signing keys.");
    }

    return {
      ...discovery,
      expiresAt: validation.expiresAt,
      localCredentialReady,
      signingKeyCount: jwks.keys.length,
      validatedAt: validation.validatedAt,
      validationToken: validation.validationToken,
    };
  }

  private infrastructureView(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): PlatformInfrastructureSettingsView {
    const bootstrap = deploymentBootstrapRuntimeConfiguration();
    return {
      controlInternalUrl:
        settings?.controlInternalUrl ?? bootstrap.controlInternalUrl,
      runner: {
        url: settings?.runnerUrl ?? bootstrap.runner.url,
        tokenConfigured: Boolean(
          settings?.runnerTokenEncrypted ?? bootstrap.runner.token,
        ),
      },
      litellm: {
        url: settings?.litellmUrl ?? bootstrap.litellm.url,
        masterKeyConfigured: Boolean(
          settings?.litellmMasterKeyEncrypted ?? bootstrap.litellm.masterKey,
        ),
      },
      runtimeNamespaces: {
        enabled:
          settings?.runtimeNamespacesEnabled
          ?? bootstrap.runtimeNamespaces.enabled,
        clusterId:
          settings?.runtimeClusterId ?? bootstrap.runtimeNamespaces.clusterId,
      },
    };
  }

  private infrastructureValidationPayload(
    input:
      | ValidatePlatformInfrastructureSettingsInput
      | UpdatePlatformInfrastructureSettingsInput,
    runnerToken: string,
    litellmMasterKey: string,
  ): unknown {
    return {
      controlInternalUrl: input.controlInternalUrl.replace(/\/+$/, ""),
      runner: {
        url: input.runner.url.replace(/\/+$/, ""),
        token: runnerToken,
      },
      litellm: {
        url: input.litellm.url.replace(/\/+$/, ""),
        masterKey: litellmMasterKey,
      },
      runtimeNamespaces: input.runtimeNamespaces,
    };
  }

  private securityValidationPayload(
    input:
      | ValidatePlatformSsoSettingsInput
      | UpdatePlatformSecuritySettingsInput,
    clientSecret: string,
  ): unknown {
    return {
      localAuthenticationEnabled: input.localAuthenticationEnabled,
      sso: {
        clientId: input.sso.clientId,
        clientSecret,
        displayName: input.sso.displayName,
        enabled: input.sso.enabled,
        groupClaim: input.sso.groupClaim ?? "groups",
        issuer: input.sso.issuer.replace(/\/+$/, ""),
      },
    };
  }

  private currentRunnerToken(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): string {
    const config = getControlConfig();
    return settings?.runnerTokenEncrypted
      ? decryptPlatformSecret(settings.runnerTokenEncrypted, config.auth.secret)
      : deploymentBootstrapRuntimeConfiguration().runner.token;
  }

  private currentLiteLlmMasterKey(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): string {
    const config = getControlConfig();
    return settings?.litellmMasterKeyEncrypted
      ? decryptPlatformSecret(
          settings.litellmMasterKeyEncrypted,
          config.auth.secret,
        )
      : deploymentBootstrapRuntimeConfiguration().litellm.masterKey;
  }

  private currentClientSecret(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): string {
    const config = getControlConfig();
    return settings?.oidcClientSecretEncrypted
      ? decryptPlatformSecret(settings.oidcClientSecretEncrypted, config.auth.secret)
      : "";
  }

  private currentEmailPassword(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): string {
    const config = getControlConfig();
    return settings?.smtpPasswordEncrypted
      ? decryptPlatformSecret(settings.smtpPasswordEncrypted, config.auth.secret)
      : "";
  }

  private securityView(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
    roleBindings: ExternalRoleBindingView[] = [],
  ): PlatformSecuritySettingsView {
    const config = getControlConfig();
    const publicUrl = config.server.public_url?.replace(/\/$/, "") ?? "";
    let configurationError: string | null = null;
    let clientSecretConfigured = Boolean(settings?.oidcClientSecretEncrypted);
    if (settings?.oidcClientSecretEncrypted) {
      try {
        clientSecretConfigured = Boolean(decryptPlatformSecret(
          settings.oidcClientSecretEncrypted,
          config.auth.secret,
        ));
      } catch (error) {
        clientSecretConfigured = true;
        configurationError = error instanceof Error
          ? error.message
          : "The stored Platform secret is unavailable.";
      }
    }
    return {
      canEditOnline: true,
      configurationError,
      localAuthenticationEnabled:
        settings?.localAuthenticationEnabled ?? config.auth.local.enabled,
      sso: {
        callbackUrl: `${publicUrl}/api/auth/callback/corporate-sso`,
        clientId: settings?.oidcClientId ?? "",
        clientSecretConfigured,
        displayName: settings?.oidcDisplayName ?? "SSO",
        enabled: settings?.oidcEnabled ?? false,
        groupClaim: settings?.oidcGroupClaim ?? "groups",
        issuer: settings?.oidcIssuer ?? "",
        roleBindings,
      },
    };
  }

  private emailView(
    settings: Awaited<ReturnType<PlatformSettingsService["stored"]>>,
  ): PlatformEmailSettingsView {
    const config = getControlConfig();
    let configurationError: string | null = null;
    let passwordConfigured = Boolean(settings?.smtpPasswordEncrypted);
    if (settings?.smtpPasswordEncrypted) {
      try {
        passwordConfigured = Boolean(decryptPlatformSecret(
          settings.smtpPasswordEncrypted,
          config.auth.secret,
        ));
      } catch (error) {
        passwordConfigured = true;
        configurationError = error instanceof Error
          ? error.message
          : "The stored SMTP password is unavailable.";
      }
    }
    return {
      configurationError,
      enabled: settings?.smtpEnabled ?? false,
      fromAddress: settings?.smtpFromAddress ?? "",
      fromName: settings?.smtpFromName ?? "TaskLattice Relay",
      host: settings?.smtpHost ?? "",
      passwordConfigured,
      port: settings?.smtpPort ?? 587,
      replyTo: settings?.smtpReplyTo ?? "",
      secure: settings?.smtpSecure ?? false,
      username: settings?.smtpUsername ?? "",
    };
  }

  private async validateOidcDiscovery(issuer: string): Promise<void> {
    await this.readOidcDiscovery(issuer);
  }

  private async readOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument> {
    const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await this.oidcFetch(discoveryUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new Error(
        `OIDC discovery is unavailable: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
    if (!response.ok) {
      throw new Error(`OIDC discovery returned HTTP ${response.status}.`);
    }
    let document: Record<string, unknown>;
    try {
      document = await response.json() as Record<string, unknown>;
    } catch {
      throw new Error("OIDC discovery did not return a valid JSON document.");
    }
    for (const field of [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ] as const) {
      if (!normalizedHttpUrl(document[field])) {
        throw new Error(`OIDC discovery does not provide a valid ${field}.`);
      }
    }
    if (normalizedHttpUrl(document.issuer) !== normalizedHttpUrl(issuer)) {
      throw new Error("OIDC discovery issuer does not match the configured issuer.");
    }
    return {
      authorizationEndpoint: normalizedHttpUrl(document.authorization_endpoint)!,
      discoveryUrl,
      issuer: normalizedHttpUrl(document.issuer)!,
      jwksUri: normalizedHttpUrl(document.jwks_uri)!,
      tokenEndpoint: normalizedHttpUrl(document.token_endpoint)!,
    };
  }
}
