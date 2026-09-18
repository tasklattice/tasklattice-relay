import { developmentControlConfig, getControlConfig, setControlConfigForTests } from "../config/control-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrisma } from "../test/prisma";
import {
  ensurePlatformRuntimeSettings,
  loadPlatformRuntimeConfiguration,
} from "./platform-runtime-config";

describe("Platform runtime configuration", () => {
  beforeEach(() => {
    setControlConfigForTests(developmentControlConfig());
    getControlConfig().server.internal_url = "http://control.bootstrap";
    getControlConfig().runner!.url = "http://runner.bootstrap";
    getControlConfig().runner!.token = "runner-bootstrap-token";
    getControlConfig().litellm!.url = "http://litellm.bootstrap";
    getControlConfig().litellm!.master_key = "litellm-bootstrap-key";
    getControlConfig().runtime_namespaces.enabled = true;
    getControlConfig().runtime_namespaces.cluster_id = "cluster-bootstrap";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setControlConfigForTests(undefined);
  });

  it("imports deployment bootstrap values into encrypted Platform settings", async () => {
    const db = createTestPrisma();

    await ensurePlatformRuntimeSettings(db);

    const stored = await db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
    });
    expect(stored).toMatchObject({
      controlInternalUrl: "http://control.bootstrap",
      runnerUrl: "http://runner.bootstrap",
      litellmUrl: "http://litellm.bootstrap",
      runtimeNamespacesEnabled: true,
      runtimeClusterId: "cluster-bootstrap",
      localAuthenticationEnabled: true,
      updatedBy: "system:bootstrap",
    });
    expect(stored.runnerTokenEncrypted).toMatch(/^v1:/);
    expect(stored.litellmMasterKeyEncrypted).toMatch(/^v1:/);

    await expect(loadPlatformRuntimeConfiguration(db)).resolves.toEqual({
      controlInternalUrl: "http://control.bootstrap",
      runner: {
        url: "http://runner.bootstrap",
        token: "runner-bootstrap-token",
      },
      litellm: {
        url: "http://litellm.bootstrap",
        masterKey: "litellm-bootstrap-key",
      },
      runtimeNamespaces: {
        enabled: true,
        clusterId: "cluster-bootstrap",
      },
      localAuthenticationEnabled: true,
    });
  });

  it("never overwrites values already saved by a Platform Administrator", async () => {
    const db = createTestPrisma();
    await ensurePlatformRuntimeSettings(db);
    await db.platformSettingsRecord.update({
      where: { id: "platform" },
      data: {
        controlInternalUrl: "http://control.saved",
        runnerUrl: "http://runner.saved",
        runtimeNamespacesEnabled: false,
        updatedBy: "platform-admin",
      },
    });
    getControlConfig().server.internal_url = "http://control.changed";
    getControlConfig().runner!.url = "http://runner.changed";
    getControlConfig().runtime_namespaces.enabled = true;

    await ensurePlatformRuntimeSettings(db);

    await expect(db.platformSettingsRecord.findUniqueOrThrow({
      where: { id: "platform" },
    })).resolves.toMatchObject({
      controlInternalUrl: "http://control.saved",
      runnerUrl: "http://runner.saved",
      runtimeNamespacesEnabled: false,
      updatedBy: "platform-admin",
    });
  });
});
