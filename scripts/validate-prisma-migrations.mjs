#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const migrationsRoot = resolve(
  repositoryRoot,
  "apps/control/prisma/migrations",
);
const migrationDirectories = readdirSync(migrationsRoot, {
  withFileTypes: true,
}).filter((entry) => entry.isDirectory());
const invalidMigrations = migrationDirectories.flatMap(({ name }) => {
  const migrationFile = resolve(migrationsRoot, name, "migration.sql");
  try {
    if (statSync(migrationFile).size === 0) return [`${name}/migration.sql is empty`];
    const sql = readFileSync(migrationFile, "utf8");
    const errors = [];
    // The baseline contains a development Project and its related seed rows.
    // These IDs must follow the same rule as Projects created through the API.
    for (const match of sql.matchAll(/INSERT INTO tasklattice\.(\w+)\s*\(([^)]+)\)\s*VALUES\s*\('([^']+)'/g)) {
      const [, table, columns, id] = match;
      const firstColumn = columns.split(",")[0].trim();
      if ((table === "projects" && firstColumn === "id") || firstColumn === "project_id") {
        if (!/^tp-[a-z2-7]{13}$/.test(id)) {
          errors.push(`${name}/migration.sql seeds ${table} with noncanonical Project ID: ${id}`);
        }
      }
    }
    return errors;
  } catch {
    return [`${name}/migration.sql is missing`];
  }
});

if (invalidMigrations.length) {
  throw new Error(
    `Invalid Prisma migration directories:\n${invalidMigrations
      .map((message) => `- ${message}`)
      .join("\n")}`,
  );
}
if (!migrationDirectories.length) {
  throw new Error("No Prisma migrations were found.");
}

console.log(
  `Validated ${migrationDirectories.length} Prisma migration directories.`,
);
