import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { ProjectStore } from "../projects/project-store";
import { DepartmentInferenceStore } from "../departments/department-inference-store";
import type { SecretStore } from "../secrets/secret-store";
import type { LiteLLMAdminClient } from "./litellm-client";
import { ProviderService } from "./provider-service";
import { ProviderRegistrationCleanup } from "./provider-registration-cleanup";
import { auth, ensureInitialPlatformAdministrator, resetBetterAuthForTests } from "../auth/better-auth";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";

// Use a disposable pgvector PostgreSQL database, migrated with this checkout.
// pg-mem does not implement transaction rollback or advisory-lock exclusion.
const databaseUrl = process.env.TALI_PROVIDER_TEST_DATABASE_URL;
const input = {
  connection: {
    provider: "deepseek" as const, name: "Registration test",
    config: { endpoint: "https://api.deepseek.com/v1" }, credentials: { apiKey: "test-provider-key" },
  },
  complianceDomain: "GLOBAL" as const,
  models: [
    { modelId: "deepseek-chat", displayName: "Chat", modelType: "llm" as const },
    { modelId: "deepseek-reasoner", displayName: "Reasoner", modelType: "llm" as const },
  ],
};

describe.skipIf(!databaseUrl)("Provider registration on PostgreSQL", () => {
  let db: PrismaClient;
  let store: ProjectStore;
  let projectId: string;
  let departmentId: string;
  let remoteModels: Set<string>;
  let secretValues: Map<string, string>;
  let remote: LiteLLMAdminClient;
  let secrets: SecretStore;
  let service: ProviderService;

  beforeAll(() => {
    if (new URL(databaseUrl!).pathname !== "/tali_provider_registration_test") {
      throw new Error("Provider transaction tests require the disposable tali_provider_registration_test database.");
    }
    db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: databaseUrl, max: 4 }), { schema: "tasklattice" }) });
  });
  beforeEach(async () => {
    projectId = `test-${randomUUID()}`;
    departmentId = `test-${randomUUID()}`;
    await db.department.create({ data: { id: departmentId, name: departmentId, createdBy: "local-admin" } });
    await db.project.create({ data: { id: projectId, name: projectId, departmentId, createdBy: "local-admin" } });
    store = new ProjectStore(projectId, db);
    remoteModels = new Set(); secretValues = new Map();
    remote = {
      baseUrl: "http://litellm.test",
      registerModel: vi.fn(async ({ registrationId }) => { remoteModels.add(registrationId); return `tali/test/${registrationId}`; }),
      deleteModelById: vi.fn(async (id) => { remoteModels.delete(id); }),
      deleteModel: vi.fn(async () => { throw new Error("Registration must never delete by alias."); }),
      probeModel: vi.fn(async () => undefined),
      createInstanceKey: vi.fn(), blockKey: vi.fn(), revokeKey: vi.fn(), listSpendLogs: vi.fn(),
    };
    secrets = {
      referenceFor: (scope, id) => `memory://${scope}/${id}`,
      put: vi.fn(async (scope, id, value) => { const ref = secrets.referenceFor(scope, id); secretValues.set(ref, value); return ref; }),
      get: vi.fn(async (ref) => { const value = secretValues.get(ref); if (!value) throw new Error("Missing secret"); return value; }),
      delete: vi.fn(async (ref) => { secretValues.delete(ref); }),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: input.models.map((m) => ({ id: m.modelId })) }))));
    service = new ProviderService(store, remote, secrets);
  });
  afterEach(async () => {
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS registration_test_failure ON tasklattice.model_endpoint_mapping");
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS registration_test_failure ON tasklattice.department_inference_resources");
    await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS tasklattice.registration_test_failure()");
    await db.providerRegistrationCleanup.deleteMany();
    await db.providerRegistrationReceipt.deleteMany({ where: { scope: { in: [projectId, `department:${departmentId}`] } } });
    await db.project.delete({ where: { id: projectId } });
    await db.department.delete({ where: { id: departmentId } });
    resetBetterAuthForTests(); setControlConfigForTests(undefined);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function rejectWrite(table = "model_endpoint_mapping") {
    await db.$executeRawUnsafe(`CREATE FUNCTION tasklattice.registration_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${table === 'model_endpoint_mapping' ? "NEW.model_endpoint_name = 'Reasoner'" : "NEW.kind = 'MODEL' AND NEW.payload->>'modelId' = 'deepseek-reasoner'"} THEN
          RAISE EXCEPTION 'injected registration persistence failure';
        END IF;
        RETURN NEW;
      END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER registration_test_failure BEFORE INSERT OR UPDATE ON tasklattice.${table}
      FOR EACH ROW EXECUTE FUNCTION tasklattice.registration_test_failure()`);
  }
  async function savedProvider() { return service.createConnection({ ...input, models: [input.models[0]!] }); }
  async function mappingCount() { return db.modelEndpointMappingRecord.count({ where: { projectId } }); }

  it("fails without persisting FAILED models and allows a clean retry", async () => {
    const { account } = await savedProvider();
    vi.mocked(remote.probeModel).mockRejectedValueOnce(new Error("probe failed"));
    const model = { ...input.models[1]!, providerAccountId: account.id };
    await expect(service.registerModel(model)).rejects.toThrow("probe failed");
    expect(await service.listModels()).toHaveLength(1); expect(await mappingCount()).toBe(1);
    expect(remoteModels.size).toBe(1);
    await expect(service.registerModel(model)).resolves.toMatchObject({ status: "VALIDATED" });
    expect(await service.listModels()).toHaveLength(2); expect(remoteModels.size).toBe(2);
  });

  it("rolls back the model row when its cost mapping fails", async () => {
    const { account } = await savedProvider();
    await rejectWrite();
    await expect(service.registerModel({ ...input.models[1]!, providerAccountId: account.id })).rejects.toThrow("injected registration");
    expect(await service.listModels()).toHaveLength(1); expect(await mappingCount()).toBe(1);
    expect(remoteModels.size).toBe(1);
  });

  it("rolls back a new Provider, all models, mappings and secret together", async () => {
    await rejectWrite();
    await expect(service.createConnection(input)).rejects.toThrow("injected registration");
    expect(await service.listAccounts()).toEqual([]); expect(await service.listModels()).toEqual([]);
    expect(await mappingCount()).toBe(0); expect(remoteModels.size).toBe(0); expect(secretValues.size).toBe(0);
    expect(await db.providerRegistrationReceipt.count({ where: { scope: projectId } })).toBe(0);
  });

  it("applies the same atomic boundary to Department Providers", async () => {
    service = new ProviderService(new DepartmentInferenceStore(departmentId, db), remote, secrets);
    await rejectWrite("department_inference_resources");
    await expect(service.createConnection(input)).rejects.toThrow("injected registration");
    expect(await service.listAccounts()).toEqual([]); expect(await service.listModels()).toEqual([]);
    expect(remoteModels.size).toBe(0); expect(secretValues.size).toBe(0);
  });

  it("concurrent registration commits one model and cleans only the losing attempt", async () => {
    const { account, models } = await savedProvider();
    const request = { ...input.models[1]!, providerAccountId: account.id };
    const [a, b] = await Promise.all([service.registerModel(request), service.registerModel(request)]);
    expect(a.id).toBe(b.id); expect(await service.listModels()).toHaveLength(2);
    expect(remoteModels).toEqual(new Set([models[0]!.litellmModelId!, a.litellmModelId!]));
    expect(remote.deleteModel).not.toHaveBeenCalled();
  });

  it("replays concurrent Provider creation without duplicate credentials or deployments", async () => {
    const [a, b] = await Promise.all([service.createConnection(input), service.createConnection(input)]);
    expect(a.account.id).toBe(b.account.id);
    expect(await service.listAccounts()).toHaveLength(1); expect(await service.listModels()).toHaveLength(2);
    expect(secretValues.size).toBe(1); expect(remoteModels.size).toBe(2);
    vi.mocked(remote.registerModel).mockClear();
    expect((await service.createConnection(input)).account.id).toBe(a.account.id);
    expect(remote.registerModel).not.toHaveBeenCalled();
  });

  it("a retry of a healthy model never creates or probes or deletes a remote model", async () => {
    const { account, models } = await savedProvider();
    vi.mocked(remote.probeModel).mockRejectedValue(new Error("temporary outage"));
    vi.mocked(remote.registerModel).mockClear();
    expect((await service.registerModel({ ...input.models[0]!, providerAccountId: account.id })).id).toBe(models[0]!.id);
    expect(remote.registerModel).not.toHaveBeenCalled(); expect(remote.deleteModelById).not.toHaveBeenCalled();
  });

  it("rejects conflicting settings for an already registered model without remote side effects", async () => {
    const { account } = await savedProvider();
    vi.mocked(remote.registerModel).mockClear();
    await expect(service.registerModel({ ...input.models[0]!, providerAccountId: account.id, displayName: "Changed" }))
      .rejects.toThrow("different registration settings");
    expect(remote.registerModel).not.toHaveBeenCalled(); expect(remoteModels.size).toBe(1);
  });

  it("rejects conflicting duplicate selections before provisioning", async () => {
    await expect(service.createConnection({ ...input, models: [input.models[0]!, { ...input.models[0]!, displayName: "Changed" }] }))
      .rejects.toThrow("different settings");
    expect(remote.registerModel).not.toHaveBeenCalled(); expect(await service.listAccounts()).toEqual([]);
  });

  it("the database rejects duplicate active model identities even outside the service", async () => {
    const { models } = await savedProvider();
    await expect(store.saveModelDeployment({ ...models[0]!, id: randomUUID() })).rejects.toThrow();
    expect(await service.listModels()).toHaveLength(1); expect(await mappingCount()).toBe(1);
  });

  it("does not replace an unhealthy existing model or orphan its remote deployment", async () => {
    const { account, models } = await savedProvider();
    await store.saveModelDeployment({ ...models[0]!, status: "FAILED" });
    vi.mocked(remote.registerModel).mockClear();
    await expect(service.registerModel({ ...input.models[0]!, providerAccountId: account.id }))
      .rejects.toThrow("Revalidate the Provider");
    expect(remoteModels.size).toBe(1); expect(remote.registerModel).not.toHaveBeenCalled();
    await service.revalidateAccount(account.id);
    expect((await service.registerModel({ ...input.models[0]!, providerAccountId: account.id })).id).toBe(models[0]!.id);
  });

  it("rolls back all revalidation updates if a mapping write fails", async () => {
    const { account } = await service.createConnection(input);
    const original = await service.listModels(account.id);
    await rejectWrite();
    await expect(service.revalidateAccount(account.id)).rejects.toThrow("injected registration");
    expect(await service.listModels(account.id)).toEqual(original);
    expect(await store.getProviderAccount(account.id)).toEqual(account);
  });

  it("keeps failed compensation durable and retries it on maintenance", async () => {
    const { account } = await savedProvider();
    vi.mocked(remote.probeModel).mockRejectedValueOnce(new Error("probe failed"));
    vi.mocked(remote.deleteModelById).mockRejectedValueOnce(new Error("LiteLLM unavailable"));
    await expect(service.registerModel({ ...input.models[1]!, providerAccountId: account.id })).rejects.toThrow("probe failed");
    expect(await db.providerRegistrationCleanup.count()).toBe(1);
    await new ProviderRegistrationCleanup(db, remote, secrets).drain(new Date(Date.now() + 120_000));
    expect(await db.providerRegistrationCleanup.count()).toBe(0); expect(remoteModels.size).toBe(1);
  });

  it("recovers a timed-out remote create even when the response was lost", async () => {
    const { account } = await savedProvider();
    vi.mocked(remote.registerModel).mockImplementationOnce(async ({ registrationId }) => {
      remoteModels.add(registrationId); throw new Error("request timeout");
    });
    await expect(service.registerModel({ ...input.models[1]!, providerAccountId: account.id })).rejects.toThrow("request timeout");
    expect(remoteModels.size).toBe(2);
    await new ProviderRegistrationCleanup(db, remote, secrets).drain(new Date(Date.now() + 120_000));
    expect(remoteModels.size).toBe(1); expect(await service.listModels()).toHaveLength(1);
  });

  it("cleans all reserved resources after a secret write fails", async () => {
    vi.mocked(secrets.put).mockRejectedValueOnce(new Error("secret write failed"));
    await expect(service.createConnection(input)).rejects.toThrow("secret write failed");
    expect(await service.listAccounts()).toEqual([]);
    await new ProviderRegistrationCleanup(db, remote, secrets).drain(new Date(Date.now() + 120_000));
    expect(remoteModels.size).toBe(0); expect(await db.providerRegistrationCleanup.count()).toBe(0);
  });

  it("cleans abandoned reservations and refuses to commit a claimed reservation", async () => {
    const cleanup = new ProviderRegistrationCleanup(db, remote, secrets);
    const id = randomUUID(); remoteModels.add(id);
    const reservation = await cleanup.reserve("MODEL", id);
    await cleanup.drain(new Date(Date.now() + 3 * 60 * 60 * 1000));
    expect(remoteModels.has(id)).toBe(false);
    await expect(db.$transaction((tx) => cleanup.commit(tx, [reservation]))).rejects.toThrow("expired");
  });

  it("keeps committed resources when the commit response is lost and safely replays", async () => {
    const transaction = store.providerTransaction.bind(store);
    vi.spyOn(store, "providerTransaction").mockImplementationOnce(async (operation) => {
      await transaction(operation);
      throw new Error("commit response lost");
    });
    await expect(service.createConnection(input)).rejects.toThrow("commit response lost");
    expect(await service.listAccounts()).toHaveLength(1);
    expect(remoteModels.size).toBe(2); expect(secretValues.size).toBe(1);
    expect(await db.providerRegistrationCleanup.count()).toBe(0);
    vi.mocked(remote.registerModel).mockClear();
    await expect(service.createConnection(input)).resolves.toMatchObject({ models: expect.any(Array) });
    expect(remote.registerModel).not.toHaveBeenCalled();
  });

  it("does not occupy the auth connection pool while remote probes are blocked", async () => {
    vi.stubGlobal("taliPrisma", db);
    const config = developmentControlConfig(); config.server.public_url = "http://tali.local";
    config.auth.local.initial_platform_administrator_password = "correct-horse-battery";
    setControlConfigForTests(config); resetBetterAuthForTests();
    await ensureInitialPlatformAdministrator();
    const { account } = await savedProvider();
    let unblock!: () => void; let ready!: () => void; let entered = 0;
    const probes = new Promise<void>((resolve) => { unblock = resolve; });
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    vi.mocked(remote.probeModel).mockImplementation(async () => { if (++entered === 4) ready(); await probes; });
    const registrations = Promise.all(Array.from({ length: 4 }, (_, i) => service.registerModel({
      providerAccountId: account.id, modelId: `blocked-${i}`, displayName: `Blocked ${i}`, modelType: "llm",
    })));
    try {
      await waiting;
      const response = await (await auth()).handler(new Request("http://tali.local/api/auth/sign-in/username", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://tali.local" },
        body: JSON.stringify({ username: "admin", password: "correct-horse-battery" }),
      }));
      expect(response.status).toBe(200);
    } finally { unblock(); await registrations; }
  });

  it("keeps actual local sign-in available after registration rolls back", async () => {
    vi.stubGlobal("taliPrisma", db);
    const config = developmentControlConfig(); config.server.public_url = "http://tali.local";
    config.auth.local.initial_platform_administrator_password = "correct-horse-battery";
    setControlConfigForTests(config); resetBetterAuthForTests();
    await ensureInitialPlatformAdministrator();
    await rejectWrite();
    await expect(service.createConnection(input)).rejects.toThrow("injected registration");
    const response = await (await auth()).handler(new Request("http://tali.local/api/auth/sign-in/username", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://tali.local" },
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery" }),
    }));
    expect(response.status).toBe(200);
  });
});
