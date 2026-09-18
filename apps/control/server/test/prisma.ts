import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type Client as PgClient } from "pg";
import workerRuntimeMigration from "../../prisma/migrations/20260917000000_worker_runtime_report/migration.sql?raw";
import migration from "../../prisma/migrations/20260913000000_initial_control_plane/migration.sql?raw";
import { developmentResourceCatalog } from "../catalog/development-resource-catalog";
import { PrismaClient } from "../generated/prisma/client";

export function createTestPrisma(): PrismaClient {
  const require = createRequire(import.meta.url);
  const { DataType, newDb } = require("pg-mem") as typeof import("pg-mem");
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: "to_timestamp",
    args: [DataType.integer],
    returns: DataType.timestamptz,
    implementation: (seconds: number) => new Date(seconds * 1_000),
  });
  memory.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  memory.public.registerFunction({
    name: "md5",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) =>
      createHash("md5").update(value).digest("hex"),
  });
  memory.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => value.length,
  });
  memory.public.registerFunction({
    name: "btrim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });
  memory.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      return typeof value;
    },
  });
  memory.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value),
  });
  // Keep service tests on the same baseline as production. pg-mem cannot
  // execute PL/pgSQL triggers or pgvector operations; PostgreSQL integration
  // checks must cover those database-specific features.
  const testMigration = migration
    // Service fixtures historically use individual; the production seed uses proj1.
    .replaceAll("proj1", "individual")
    .replaceAll("tasklattice.model_usage_fact_observation_id_seq", "model_usage_fact_observation_id_seq")
    .replace(/CREATE EXTENSION[^;]+;\s*/g, "")
    .replace(/CREATE FUNCTION[\s\S]*?\$\$;\s*/g, "")
    .replace(/CREATE TRIGGER[\s\S]*?;\s*/g, "")
    .replace(/numeric\(\d+,\s*\d+\)/g, "numeric")
    .replace(/    CONSTRAINT knowledge_vector_chunks_embedding_dimensions_check[^\n]+\n/, "")
    .replace(/CREATE INDEX knowledge_vector_chunks_attributes_idx[^;]+;\s*/, "")
    .replaceAll("public.vector", "text")
    .replaceAll("!~~", "NOT LIKE")
    .replaceAll("~~", "LIKE")
    .replace(/<> ALL \(ARRAY\[([^\]]+)\]\)/g, "NOT IN ($1)")
    .replaceAll(" DEFAULT gen_random_uuid()", "");
  // Register foreign keys before partial indexes so pg-mem creates full
  // lookup indexes instead of incorrectly using a partial index for all rows.
  const partialIndexes = testMigration.match(/^CREATE (?:UNIQUE )?INDEX[^;]+ WHERE [^;]+;/gm) ?? [];
  memory.public.none(testMigration.replace(/^CREATE (?:UNIQUE )?INDEX[^;]+ WHERE [^;]+;/gm, ""));
  memory.public.none(partialIndexes.join("\n"));
  memory.public.none(workerRuntimeMigration);
  memory.public.none("UPDATE tasklattice.projects SET name = 'admin' WHERE id = 'individual';");
  for (const skill of developmentResourceCatalog.skills) {
    const payload = JSON.stringify(skill).replaceAll("'", "''");
    memory.public.none(
      `UPDATE tasklattice.skills
          SET payload = '${payload}'::jsonb
        WHERE project_id = 'individual' AND id = '${skill.id}';`,
    );
  }
  const pg = memory.adapters.createPg();
  const query = pg.Client.prototype.query;
  pg.Client.prototype.query = function (
    this: PgClient,
    input: string | { rowMode?: string; types?: unknown },
    ...args: unknown[]
  ) {
    if (typeof input === "object") {
      const arrayRows = input.rowMode === "array";
      const { rowMode: _rowMode, types: _types, ...compatible } = input;
      // Prisma's pg adapter serializes Uint8Array parameters into the Node
      // Buffer JSON shape before they reach pg-mem. Real PostgreSQL's driver
      // accepts the binary value directly, so restore that representation in
      // the in-memory adapter used by service tests.
      const values = (compatible as { values?: unknown[] }).values;
      if (values) {
        (compatible as { values: unknown[] }).values = values.map((value) => {
          if (typeof value !== "string" || !value.startsWith('{"type":"Buffer","data":[')) {
            return value;
          }
          try {
            const parsed = JSON.parse(value) as { type?: string; data?: number[] };
            return parsed.type === "Buffer" && Array.isArray(parsed.data)
              ? Buffer.from(parsed.data)
              : value;
          } catch {
            return value;
          }
        });
      }
      const transform = (result: { fields?: Array<{ name: string }>; rows?: Array<Record<string, unknown>> }) => {
        if (arrayRows && result.rows) {
          const fieldNames = result.fields?.map((field) => field.name) ?? [];
          const names = fieldNames.length && fieldNames.every(Boolean)
            ? fieldNames
            : Object.keys(result.rows[0] ?? {});
          const sample = result.rows[0] ?? {};
          const oid = (value: unknown) =>
            Buffer.isBuffer(value) ? 17
              : value instanceof Date ? 1184
              : typeof value === "boolean" ? 16
                : typeof value === "number" ? 701
                  : typeof value === "bigint" ? 20
                    : typeof value === "object" && value !== null ? 3802
                      : 25;
          const postgresTextArrayFields = new Set([
            "hindsight_memory_ids",
            "source_document_ids",
          ]);
          const fields = names.map((name, index) => ({
            ...(result.fields?.[index] ?? {}),
            name,
            dataTypeID: postgresTextArrayFields.has(name)
              ? 1009
              : (result.fields?.[index] as { dataTypeID?: number } | undefined)?.dataTypeID
                ?? oid(sample[name]),
          }));
          return {
            ...result,
            fields,
            rows: result.rows.map((row) => names.map((name, index) =>
              fields[index]?.dataTypeID === 3802 && typeof row[name] === "object"
                ? JSON.stringify(row[name])
                : row[name],
            )),
          };
        }
        return result;
      };
      const callbackIndex = args.findLastIndex((argument) => typeof argument === "function");
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (error: unknown, result: unknown) => void;
        args[callbackIndex] = (error: unknown, result: Parameters<typeof transform>[0]) =>
          callback(error, error ? result : transform(result));
      }
      const result = query.call(this, compatible, ...args);
      return result && typeof (result as Promise<unknown>).then === "function"
        ? (result as Promise<Parameters<typeof transform>[0]>).then(transform)
        : result;
    }
    return query.call(this, input, ...args);
  } as typeof query;
  const pool = new Pool({ Client: pg.Client } as never);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}
