import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import { inspectCredentials, validateChartCredentials } from '../validate-chart-credentials.mjs';

const secret = 'MUST-NOT-APPEAR-IN-DIAGNOSTICS';
function rejects(value) {
  const results = inspectCredentials(stringify(value), 'fixture.yaml', { structured: true });
  assert(results.length > 0);
  assert(!results.join('\n').includes(secret));
}

test('rejects literal values including old defaults, hashes and case variants without exposing them', () => {
  for (const key of ['password', 'postgresPassword', 'POSTGRES_PASSWORD', 'initialSuperAdminPasswordHash', 'passwd', 'smtp_pwd']) {
    rejects({ secrets: { [key]: secret } });
  }
  rejects({ secrets: { password: 123456 } });
  rejects({ database: { password: { value: secret } } });
});

test('rejects env literals and Keycloak imported user passwords', () => {
  rejects({ env: [{ name: 'BASIC_AUTH_PASSWORD', value: secret }] });
  rejects({ credentials: [{ type: 'password', value: secret }] });
});

test('decodes Secret data and checks embedded JSON, TOML and YAML configuration', () => {
  rejects({ kind: 'Secret', data: { password: Buffer.from(secret).toString('base64') } });
  for (const [name, config] of [
    ['control.toml', `[auth.local]\ninitial_platform_administrator_password = "${secret}"`],
    ['config.json', JSON.stringify({ password: secret })],
    ['config.yaml', `credentials:\n  password: ${secret}`],
  ]) {
    rejects({ kind: 'Secret', data: { [name]: Buffer.from(config).toString('base64') } });
    rejects({ kind: 'ConfigMap', data: { [name]: config } });
  }
});

test('rejects a password hidden in a connection URL or Basic Auth value', () => {
  rejects({ database: { url: `postgresql://admin:${secret}@postgres/db` } });
  rejects({ 'auth-value': `user:${secret}` });
  const docker = JSON.stringify({ auths: { 'registry.example': { auth: Buffer.from(`user:${secret}`).toString('base64') } } });
  rejects({ kind: 'Secret', data: { '.dockerconfigjson': Buffer.from(docker).toString('base64') } });
});

test('allows protocol names, Secret references, empty defaults and bootstrap placeholders', () => {
  const safe = {
    postgresPassword: '', passwordSecretName: 'database-auth', resetPasswordAllowed: true,
    env: [{ name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'postgres-password' } } }],
    credentials: [{ type: 'password', value: '${TALI_KEYCLOAK_TEST_USER_PASSWORD}' }],
    fields: { 'postgres-password': '__TALI_CREDENTIAL_postgresPassword__' },
  };
  assert.deepEqual(inspectCredentials(stringify(safe), 'safe.yaml', { structured: true }), []);
});

test('invalid structured configuration fails closed without echoing parser input', () => {
  const findings = inspectCredentials(`password: [${secret}`, 'invalid.yaml', { structured: true });
  assert.match(findings.join('\n'), /invalid yaml/);
  assert(!findings.join('\n').includes(secret));
});

test('checks hardcoded script assignments even inside rendered ConfigMaps', () => {
  const script = `data.postgresPassword = "${secret}";`;
  assert(inspectCredentials(script, 'bootstrap.mjs').length);
  rejects({ data: { 'bootstrap.mjs': script } });
  assert(inspectCredentials('POSTGRES_PASSWORD=hardcoded', 'start.sh').length);
  assert(inspectCredentials('const password = 123456;', 'bootstrap.mjs').length);
});

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-chart-audit-test-'));
  try {
    const chart = join(directory, 'chart');
    mkdirSync(join(chart, 'templates'), { recursive: true });
    writeFileSync(join(chart, 'Chart.yaml'), 'apiVersion: v2\nname: fixture\nversion: 0.1.0\n');
    writeFileSync(join(chart, 'values.yaml'), '{}\n');
    run(chart, directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function packageChart(chart, directory) {
  execFileSync('helm', ['package', chart, '-d', directory], { stdio: 'pipe' });
  return join(directory, 'fixture-0.1.0.tgz');
}

test('checks the actual archive and disabled profile values, including nested dependencies', () => {
  fixture((chart, directory) => {
    writeFileSync(join(chart, 'values-unused.yaml'), `smtpPassword: ${secret}\n`);
    const archive = packageChart(chart, directory);
    assert.throws(() => validateChartCredentials(archive), /fixed credential/);
    rmSync(join(chart, 'values-unused.yaml'));
    mkdirSync(join(chart, 'charts'));
    cpSync(archive, join(chart, 'charts', 'disabled-child.tgz'));
    assert.throws(() => validateChartCredentials(chart), /disabled-child.tgz!.*fixed credential/);
  });
});

test('catches a fixed value composed by Helm, not just textual password assignments', () => {
  fixture((chart, directory) => {
    writeFileSync(join(chart, 'templates', 'bad.yaml'), `apiVersion: v1
kind: Secret
metadata: {name: bad}
data:
  password: {{ printf "%s%s" "fixed-" "credential" | b64enc }}
`);
    const result = spawnSync(process.execPath, ['scripts/validate-chart-credentials.mjs', packageChart(chart, directory)], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixed credential/);
    assert(!result.stderr.includes('fixed-credential'));
  });
});

test('the current complete Chart passes both source and packaged checks', () => {
  assert(validateChartCredentials('charts/tali-relay') > 0);
  const directory = mkdtempSync(join(tmpdir(), 'relay-chart-release-test-'));
  try {
    execFileSync('helm', ['package', 'charts/tali-relay', '-d', directory], { stdio: 'pipe' });
    const { version } = parse(readFileSync('charts/tali-relay/Chart.yaml', 'utf8'));
    assert(validateChartCredentials(join(directory, `tali-relay-${version}.tgz`)) > 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('packaging and both publication workflows gate the artifact before publishing it', () => {
  const packager = readFileSync('scripts/package-control-plane-chart.sh', 'utf8');
  assert(packager.indexOf('validate-chart-credentials.mjs') > packager.indexOf('helm package'));
  assert(packager.indexOf('validate-chart-credentials.mjs') < packager.indexOf('cp "$work_dir/packaged/'));
  for (const name of ['release', 'release-control-plane']) {
    const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
    const publish = steps.find(step => step.run?.includes('helm push'));
    assert(publish.run.indexOf('validate-chart-credentials.mjs') >= 0);
    assert(publish.run.indexOf('validate-chart-credentials.mjs') < publish.run.indexOf('helm push'));
    assert(steps.some(step => step.run?.includes('npm run test:chart-credentials')));
  }
});
