import { getControlConfig } from "../config/control-config";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { decryptPlatformSecret, encryptPlatformSecret } from "./platform-secret-crypto";

export interface PlatformRuntimeConfiguration {
  controlInternalUrl: string;
  runner: { url: string; token: string };
  litellm: { url: string; masterKey: string };
  runtimeNamespaces: {
    enabled: boolean;
    clusterId: string;
  };
  localAuthenticationEnabled: boolean;
}

export function deploymentBootstrapRuntimeConfiguration(): PlatformRuntimeConfiguration {
  const config = getControlConfig();
  return {
    controlInternalUrl: config.server.internal_url
      || "",
    runner: {
      url: config.runner?.url || "",
      token: config.runner?.token || "",
    },
    litellm: {
      url: config.litellm?.url || "",
      masterKey: config.litellm?.master_key || "",
    },
    runtimeNamespaces: {
      enabled: config.runtime_namespaces.enabled,
      clusterId: config.runtime_namespaces.cluster_id,
    },
    localAuthenticationEnabled: config.auth.local.enabled,
  };
}

export async function ensurePlatformRuntimeSettings(
  db: PrismaClient = prisma(),
): Promise<void> {
  const bootstrap = deploymentBootstrapRuntimeConfiguration();
  const config = getControlConfig();
  const current = await db.platformSettingsRecord.findUnique({
    where: { id: "platform" },
  });
  const runnerTokenEncrypted = bootstrap.runner.token
    ? encryptPlatformSecret(bootstrap.runner.token, config.auth.secret)
    : null;
  const litellmMasterKeyEncrypted = bootstrap.litellm.masterKey
    ? encryptPlatformSecret(bootstrap.litellm.masterKey, config.auth.secret)
    : null;
  if (!current) {
    await db.platformSettingsRecord.upsert({
      where: { id: "platform" },
      create: {
        id: "platform",
        controlInternalUrl: bootstrap.controlInternalUrl || null,
        runnerUrl: bootstrap.runner.url || null,
        runnerTokenEncrypted,
        litellmUrl: bootstrap.litellm.url || null,
        litellmMasterKeyEncrypted,
        runtimeNamespacesEnabled: bootstrap.runtimeNamespaces.enabled,
        runtimeClusterId: bootstrap.runtimeNamespaces.clusterId,
        localAuthenticationEnabled: bootstrap.localAuthenticationEnabled,
        updatedBy: "system:bootstrap",
      },
      // Multiple Control replicas can bootstrap concurrently. The first
      // insert wins and later replicas never replace its imported values.
      update: {},
    });
    return;
  }
  const data = {
    ...(current.controlInternalUrl === null && bootstrap.controlInternalUrl
      ? { controlInternalUrl: bootstrap.controlInternalUrl }
      : {}),
    ...(current.runnerUrl === null && bootstrap.runner.url
      ? { runnerUrl: bootstrap.runner.url }
      : {}),
    ...(current.runnerTokenEncrypted === null && runnerTokenEncrypted
      ? { runnerTokenEncrypted }
      : {}),
    ...(current.litellmUrl === null && bootstrap.litellm.url
      ? { litellmUrl: bootstrap.litellm.url }
      : {}),
    ...(current.litellmMasterKeyEncrypted === null && litellmMasterKeyEncrypted
      ? { litellmMasterKeyEncrypted }
      : {}),
    ...(current.runtimeNamespacesEnabled === null
      ? { runtimeNamespacesEnabled: bootstrap.runtimeNamespaces.enabled }
      : {}),
    ...(current.runtimeClusterId === null
      ? { runtimeClusterId: bootstrap.runtimeNamespaces.clusterId }
      : {}),
    ...(current.localAuthenticationEnabled === null
      ? { localAuthenticationEnabled: bootstrap.localAuthenticationEnabled }
      : {}),
  };
  if (Object.keys(data).length) {
    await db.platformSettingsRecord.update({
      where: { id: "platform" },
      data: { ...data, updatedBy: "system:bootstrap" },
    });
  }
}

export async function loadPlatformRuntimeConfiguration(
  db: PrismaClient = prisma(),
): Promise<PlatformRuntimeConfiguration> {
  const [settings, bootstrap] = await Promise.all([
    db.platformSettingsRecord.findUnique({ where: { id: "platform" } }),
    Promise.resolve(deploymentBootstrapRuntimeConfiguration()),
  ]);
  const config = getControlConfig();
  return {
    controlInternalUrl: settings?.controlInternalUrl || bootstrap.controlInternalUrl,
    runner: {
      url: settings?.runnerUrl || bootstrap.runner.url,
      token: settings?.runnerTokenEncrypted
        ? decryptPlatformSecret(settings.runnerTokenEncrypted, config.auth.secret)
        : bootstrap.runner.token,
    },
    litellm: {
      url: settings?.litellmUrl || bootstrap.litellm.url,
      masterKey: settings?.litellmMasterKeyEncrypted
        ? decryptPlatformSecret(settings.litellmMasterKeyEncrypted, config.auth.secret)
        : bootstrap.litellm.masterKey,
    },
    runtimeNamespaces: {
      enabled: settings?.runtimeNamespacesEnabled ?? bootstrap.runtimeNamespaces.enabled,
      clusterId: settings?.runtimeClusterId || bootstrap.runtimeNamespaces.clusterId,
    },
    localAuthenticationEnabled:
      settings?.localAuthenticationEnabled ?? bootstrap.localAuthenticationEnabled,
  };
}
