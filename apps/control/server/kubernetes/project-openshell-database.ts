import { createHash, randomBytes } from "node:crypto";
import { CoreV1Api, KubeConfig, type V1OwnerReference, type V1Secret } from "@kubernetes/client-node";
import { projectRuntimeNamespaceSchema } from "@tali/contracts";
import { Client } from "pg";
import { getControlConfig } from "../config/control-config";
import type { ProjectNamespaceInput } from "./project-namespace-client";
import { withNamespaceOwner } from "./project-resource-ownership";

const secretName = "openshell-postgresql";

export interface ProjectOpenShellDatabase {
  reconcile(input: ProjectNamespaceInput, owner?: V1OwnerReference): Promise<{ secretName: string; checksum: string }>;
  delete(namespace: string): Promise<void>;
}

type Secrets = Pick<CoreV1Api, "readNamespacedSecret" | "createNamespacedSecret" | "replaceNamespacedSecret">;
class ProvisioningError extends Error {}

function createSecretsClient(): Secrets {
  const config = new KubeConfig();
  config.loadFromCluster();
  return config.makeApiClient(CoreV1Api);
}

function databaseName(namespace: string): string {
  projectRuntimeNamespaceSchema.parse(namespace);
  return `openshell_${namespace.replaceAll("-", "_")}`;
}

// Only validated identifiers and generated hex passwords enter DDL. PostgreSQL
// parameters cannot be used for identifiers or CREATE/ALTER ROLE passwords.
function identifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new ProvisioningError("Invalid Gateway database identifier.");
  return `"${name}"`;
}

/** Worker-only provisioner; shares the Control PG server, never its credentials. */
export class PostgresProjectOpenShellDatabase implements ProjectOpenShellDatabase {
  constructor(
    private readonly databaseUrl: () => string = () => getControlConfig().database.url,
    private readonly secrets: () => Secrets = createSecretsClient,
  ) {}

  private async withDatabase<T>(namespace: string, operation: (client: Client, name: string, adminUrl: URL) => Promise<T>): Promise<T> {
    const name = databaseName(namespace);
    let client: Client | undefined;
    try {
      const adminUrl = new URL(this.databaseUrl());
      if (!["postgres:", "postgresql:"].includes(adminUrl.protocol)) {
        throw new ProvisioningError("Project Gateway requires a PostgreSQL database URL.");
      }
      client = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000,
        statement_timeout: 60_000, application_name: "tali-openshell-provisioner" });
      await client.connect();
      // Session lock also covers CREATE/DROP DATABASE, which cannot run inside a
      // transaction, and Secret publication. A Worker retry reuses the same login.
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [name]);
      return await operation(client, name, adminUrl);
    } catch (error) {
      if (error instanceof ProvisioningError) throw error;
      // Driver/Kubernetes error bodies may include SQL or Secret content.
      const code = String((error as { code?: unknown })?.code ?? "");
      throw new Error(`Project OpenShell PostgreSQL operation failed${/^[A-Z0-9]{5}$/.test(code) ? ` (SQLSTATE ${code})` : ""}. Check database connectivity and provisioning permissions.`);
    } finally {
      // Closing the session releases the advisory lock, including on failure.
      await client?.end().catch(() => {});
    }
  }

  private async inspect(client: Client, name: string, namespace: string) {
    const role = (await client.query<{ marker: string | null }>(
      "SELECT shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname = $1", [name])).rows[0];
    const database = (await client.query<{ owner: string }>(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1", [name])).rows[0];
    if ((role && role.marker !== `tali:openshell:${namespace}`) || (database && (!role || database.owner !== name))) {
      throw new ProvisioningError("Refusing to modify an unmanaged Project Gateway database or role.");
    }
    return { role, database };
  }

  async reconcile(input: ProjectNamespaceInput, owner?: V1OwnerReference) {
    return this.withDatabase(input.namespace, async (client, name, adminUrl) => {
      const { role, database } = await this.inspect(client, name, input.namespace);
      const secrets = this.secrets();
      let existing: V1Secret | undefined;
      try {
        existing = await secrets.readNamespacedSecret({ name: secretName, namespace: input.namespace });
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      let password = randomBytes(32).toString("hex");
      if (existing) {
        if (existing.metadata?.annotations?.["tali.io/project-id"] !== input.projectId || !existing.data?.uri) {
          throw new ProvisioningError("Refusing to overwrite an unmanaged Project Gateway database Secret.");
        }
        const saved = new URL(Buffer.from(existing.data.uri, "base64").toString("utf8"));
        if (saved.username !== name || saved.pathname !== `/${name}` || !/^[a-f0-9]{64}$/.test(saved.password)) {
          throw new ProvisioningError("Invalid Project Gateway database Secret.");
        }
        password = saved.password;
      }

      // The role and its ownership marker commit atomically, even if the Worker
      // dies before creating the database or publishing its Secret.
      await client.query("BEGIN");
      if (!role) {
        await client.query(`CREATE ROLE ${identifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
        await client.query(`COMMENT ON ROLE ${identifier(name)} IS 'tali:openshell:${input.namespace}'`);
        // Enables a non-superuser provisioning account with CREATEDB/CREATEROLE
        // to assign database ownership to the dedicated login (PostgreSQL 17).
        await client.query(`GRANT ${identifier(name)} TO CURRENT_USER WITH SET TRUE`);
      } else {
        await client.query(`ALTER ROLE ${identifier(name)} PASSWORD '${password}'`);
      }
      await client.query("COMMIT");
      if (!database) await client.query(`CREATE DATABASE ${identifier(name)} OWNER ${identifier(name)}`);
      await client.query(`SET ROLE ${identifier(name)}`);
      await client.query(`REVOKE ALL ON DATABASE ${identifier(name)} FROM PUBLIC`);
      await client.query("RESET ROLE");

      const uri = new URL(`${adminUrl.protocol}//${adminUrl.host}/${name}`);
      uri.username = name;
      uri.password = password;
      // Do not copy admin identity, options/search_path or Prisma pool settings.
      for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
        const value = adminUrl.searchParams.get(key);
        if (value !== null) uri.searchParams.set(key, value);
      }
      const value = uri.toString();
      const body = withNamespaceOwner<V1Secret>({ apiVersion: "v1", kind: "Secret", type: "Opaque",
        metadata: { ...existing?.metadata, name: secretName, namespace: input.namespace,
          annotations: { ...existing?.metadata?.annotations, "tali.io/project-id": input.projectId } },
        data: { uri: Buffer.from(value).toString("base64") },
      }, owner);
      if (existing) await secrets.replaceNamespacedSecret({ name: secretName, namespace: input.namespace, body });
      else await secrets.createNamespacedSecret({ namespace: input.namespace, body });
      return { secretName, checksum: createHash("sha256").update(value).digest("hex") };
    });
  }

  async delete(namespace: string): Promise<void> {
    await this.withDatabase(namespace, async (client, name) => {
      const { role, database } = await this.inspect(client, name, namespace);
      if (database) {
        await client.query(`SET ROLE ${identifier(name)}`);
        await client.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`);
        await client.query("RESET ROLE");
      }
      if (role) await client.query(`DROP ROLE ${identifier(name)}`);
      // Project Namespace deletion removes the Secret after Gateway teardown.
    });
  }
}
