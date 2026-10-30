#!/usr/bin/env node
// Disposable database only. Never reuse the running Relay/Guard databases.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const name = `relay-work-test-${process.pid}-${randomBytes(4).toString('hex')}`;
const credential = randomBytes(32).toString('hex');
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});
let created = false;
try {
  run('docker', ['run', '-d', '--name', name, '--label', 'tali.io/test=work-postgres',
    '--memory', '512m', '--cpus', '1', '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=relay_work_test', 'pgvector/pgvector:0.8.6-pg17'],
  { env: { ...process.env, POSTGRES_PASSWORD: credential } });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { run('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw Error('Isolated PostgreSQL did not become ready');
  const migrations = resolve(root, 'apps/control/prisma/migrations');
  const entries = readdirSync(migrations, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const port = run('docker', ['port', name, '5432/tcp']).trim().split(':').at(-1);
  const suites = [{ database: 'relay_work_test', variable: 'WORK_TEST_DATABASE_URL', migrate: true,
    tests: ['server/works/work.postgres.test.ts', 'server/projects/personal-onboarding.postgres.test.ts'] }];
  if (process.argv.includes('--all')) suites.push(
    { database: 'relay_auth_test', variable: 'TALI_AUTH_TEST_DATABASE_URL', migrate: true,
      tests: ['server/auth/account-identity.postgres.test.ts'] },
    { database: 'relay_project_test', variable: 'ASYNC_PROJECT_DATABASE_URL', migrate: true,
      tests: ['server/projects/project-initialization.postgres.test.ts'] },
    { database: 'tali_provider_registration_test', variable: 'TALI_PROVIDER_TEST_DATABASE_URL', migrate: true,
      tests: ['server/providers/provider-registration.postgres.test.ts'] },
    { database: 'openshell_provisioning_test', variable: 'TALI_OPENSHELL_TEST_DATABASE_URL', migrate: false,
      tests: ['server/kubernetes/project-openshell-database.postgres.test.ts'] },
  );
  for (const suite of suites) {
    if (suite.database !== 'relay_work_test') run('docker', ['exec', name, 'createdb', '-U', 'postgres', suite.database]);
    if (suite.migrate) for (const entry of entries) {
      run('docker', ['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', suite.database],
        { input: readFileSync(resolve(migrations, entry.name, 'migration.sql'), 'utf8') });
    }
    const url = `postgresql://postgres:${credential}@127.0.0.1:${port}/${suite.database}`;
    console.log(`Isolated PostgreSQL: ${suite.database}; ${suite.migrate ? entries.length : 0} migrations applied.`);
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts',
      ...suite.tests], {
      cwd: resolve(root, 'apps/control'), env: { ...process.env, [suite.variable]: url }, stdio: 'inherit', timeout: 300000,
    });
    if (result.error || result.status !== 0) throw Error(`PostgreSQL integration tests failed: ${suite.database}`);
  }
} catch (error) {
  // Do not expose container environment or connection URLs through command errors.
  console.error(error?.stderr ? 'PostgreSQL setup/migration failed.' : error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try { run('docker', ['rm', '-fv', name]); console.log('Removed isolated PostgreSQL container and its volume.'); }
    catch { console.error(`Cleanup failed; remove test container ${name}.`); process.exitCode = 1; }
  }
}
