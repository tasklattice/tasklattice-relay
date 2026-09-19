import { Client } from "pg";
import type { CoreV1Api, V1Secret } from "@kubernetes/client-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresProjectOpenShellDatabase } from "./project-openshell-database";

// scripts/testing/integration-openshell-database.mjs supplies a disposable PG.
const databaseUrl = process.env.TALI_OPENSHELL_TEST_DATABASE_URL;
const target = { namespace: "tp-abcdefghijklm", projectId: "tp-abcdefghijklm", projectName: "Project A" };
const other = { namespace: "tp-bcdefghijklmn", projectId: "tp-bcdefghijklmn", projectName: "Project B" };
const owner = { apiVersion: "v1", kind: "Namespace", name: target.namespace, uid: "namespace-uid" };
const name = "openshell_tp_abcdefghijklm";

describe.skipIf(!databaseUrl)("Project Gateway databases on PostgreSQL", () => {
  let admin: Client;
  let provisioner: PostgresProjectOpenShellDatabase;
  const saved = new Map<string, V1Secret>();
  const publish = vi.fn(async ({ namespace, body }: { namespace: string; body: V1Secret }) => {
    saved.set(namespace, structuredClone(body));
    return body;
  });
  const secrets = {
    readNamespacedSecret: async ({ namespace }: { namespace: string }) => {
      const secret = saved.get(namespace);
      if (!secret) throw { code: 404 };
      return structuredClone(secret);
    },
    createNamespacedSecret: publish,
    replaceNamespacedSecret: publish,
  } as unknown as CoreV1Api;
  const uri = (namespace = target.namespace) => Buffer.from(saved.get(namespace)!.data!.uri!, "base64").toString("utf8");
  async function gateway<T>(connectionString: string, action: (client: Client) => Promise<T>) {
    const client = new Client({ connectionString });
    try { await client.connect(); return await action(client); }
    finally { await client.end(); }
  }

  beforeAll(async () => {
    if (new URL(databaseUrl!).pathname !== "/openshell_provisioning_test") {
      throw new Error("Only the disposable openshell_provisioning_test database is supported.");
    }
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    // Exercise non-superuser provisioning too, rather than relying on the
    // bundled PostgreSQL image's superuser initialization account.
    await admin.query("CREATE ROLE provisioner LOGIN CREATEDB CREATEROLE PASSWORD 'integration-only'");
    const url = new URL(databaseUrl!);
    url.username = "provisioner";
    provisioner = new PostgresProjectOpenShellDatabase(() => url.toString(), () => secrets);
  });
  beforeEach(async () => {
    publish.mockClear();
    await provisioner.delete(target.namespace);
    await provisioner.delete(other.namespace);
    saved.clear();
  });
  afterAll(async () => { await admin?.end(); });

  it("preserves credentials and data across concurrent retries, and isolates Project logins", async () => {
    const first = await provisioner.reconcile(target, owner);
    const firstUri = uri();
    expect(new URL(firstUri).username).toBe(name);
    expect(new URL(firstUri).password).not.toBe("integration-only");
    expect(saved.get(target.namespace)?.metadata?.ownerReferences).toEqual([owner]);
    await gateway(firstUri, (client) => client.query("CREATE TABLE durable_state (value text); INSERT INTO durable_state VALUES ('survives-reconcile')"));
    const retries = await Promise.all([provisioner.reconcile(target, owner), provisioner.reconcile(target, owner)]);
    expect(retries).toEqual([first, first]);
    expect(uri()).toBe(firstUri);
    expect(await gateway(uri(), async (client) => (await client.query("SELECT value FROM durable_state")).rows))
      .toEqual([{ value: "survives-reconcile" }]);
    await provisioner.reconcile(other);
    const crossProject = new URL(firstUri);
    crossProject.pathname = new URL(uri(other.namespace)).pathname;
    await expect(gateway(crossProject.toString(), (client) => client.query("SELECT 1"))).rejects.toMatchObject({ code: "42501" });
    expect((await admin.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=$1", [name])).rows[0])
      .toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    await provisioner.delete(target.namespace);
    await provisioner.delete(target.namespace);
    expect((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])).rows).toHaveLength(0);
    expect((await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name])).rows).toHaveLength(0);
    expect(await gateway(uri(other.namespace), async (client) => (await client.query("SELECT 1 AS ok")).rows[0].ok)).toBe(1);
  });

  it("recovers after a database was created but Secret publication failed", async () => {
    publish.mockRejectedValueOnce(new Error("Kubernetes failure containing secret-payload"));
    await expect(provisioner.reconcile(target)).rejects.toThrow("Project OpenShell PostgreSQL operation failed");
    expect(saved.size).toBe(0);
    await provisioner.reconcile(target);
    await gateway(uri(), (client) => client.query("CREATE TABLE recovered (id int)"));
  });

  it("refuses to adopt or delete an unmarked role", async () => {
    await admin.query(`CREATE ROLE ${name}`);
    try {
      await expect(provisioner.reconcile(target)).rejects.toThrow("unmanaged");
      await expect(provisioner.delete(target.namespace)).rejects.toThrow("unmanaged");
    } finally { await admin.query(`DROP ROLE ${name}`); }
  });

  it("does not overwrite a Secret belonging to another Project", async () => {
    saved.set(target.namespace, { metadata: { annotations: { "tali.io/project-id": "foreign" } }, data: { uri: "opaque" } });
    await expect(provisioner.reconcile(target)).rejects.toThrow("unmanaged");
    expect(publish).not.toHaveBeenCalled();
  });
});
