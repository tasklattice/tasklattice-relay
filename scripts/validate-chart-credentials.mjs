#!/usr/bin/env node
// Check the actual release archive, including disabled profiles and nested charts.
// Diagnostics contain locations only: never print a suspected credential or parser input.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseAllDocuments } from 'yaml';
import { parse as parseToml } from 'smol-toml';

const passwordKey = /password|passwd|(^|[_.-])pwd($|[_.-])/i;
const referenceKey = /(?:secret(?:key)?ref|secretname|secretkey|existingsecret|passwordfile|passwordenv)$/i;
const marker = /^__TALI_CREDENTIAL_[A-Za-z]+__$/;
const keycloakEnv = '${TALI_KEYCLOAK_TEST_USER_PASSWORD}';
const empty = value => value === '' || value === null || value === undefined;

export function inspectCredentials(text, file, { structured = false } = {}) {
  const findings = new Set();
  const report = location => findings.add(`${file}:${location}: fixed credential`);
  const check = (value, location, allowEnvironment = false) => {
    if (empty(value) || (typeof value === 'string' && (marker.test(value) || (allowEnvironment && value === keycloakEnv)))) return;
    report(location);
  };
  const parse = (value, format, location) => {
    try {
      if (format === 'json') walk(JSON.parse(value), location);
      else if (format === 'toml') walk(parseToml(value), location);
      else for (const doc of parseAllDocuments(value)) {
        if (doc.errors.length) throw Error();
        walk(doc.toJSON(), location);
      }
    } catch { findings.add(`${file}:${location}: invalid ${format} configuration`); }
  };
  const walk = (value, location = '$') => {
    if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${location}[${i}]`)); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.name === 'string' && passwordKey.test(value.name) && Object.hasOwn(value, 'value')) {
      check(value.value, `${location}.value`);
    }
    if (value.type === 'password' && Object.hasOwn(value, 'value')) check(value.value, `${location}.value`, true);
    if ((location.includes('.auths.') || location.includes('.dockercfg.')) && typeof value.auth === 'string') {
      const decoded = Buffer.from(value.auth, 'base64').toString('utf8');
      if (decoded.includes(':')) check(decoded.slice(decoded.indexOf(':') + 1), `${location}.auth(decoded)`);
    }
    if (value.kind === 'Secret' && value.data) {
      const decoded = Object.fromEntries(Object.entries(value.data).map(([key, data]) => [key, Buffer.from(String(data), 'base64').toString('utf8')]));
      walk(decoded, `${location}.data(decoded)`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (value.kind === 'Secret' && key === 'data') continue;
      const at = `${location}.${key}`;
      if (passwordKey.test(key) && !referenceKey.test(key) && !/(?:allowed|enabled|required)$/i.test(key)) {
        if (!item || typeof item !== 'object') check(item, at);
        else if (Object.hasOwn(item, 'value')) check(item.value, `${at}.value`);
      }
      if (key === 'auth-value' && typeof item === 'string') check(item.slice(item.indexOf(':') + 1), at);
      if (typeof item === 'string') {
        if (/\.(mjs|js|py|sh)$/.test(key)) {
          findingsForScript(item, key, at);
          continue;
        }
        // Database/registry URLs can carry a password without a password-named key.
        for (const match of item.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi)) {
          try { const url = new URL(match[0]); if (url.password) check(decodeURIComponent(url.password), at); } catch { /* not a URL */ }
        }
        if (!location.endsWith('.formats') && /\.(json|toml|ya?ml|dockerconfigjson|dockercfg)$/.test(key) && !marker.test(item)
          && item !== 'REPLACE_WITH_COMPLETE_REVIEWED_CONFIGURATION') {
          parse(item, /\.(json|dockerconfigjson|dockercfg)$/.test(key) ? 'json' : key.endsWith('.toml') ? 'toml' : 'yaml', at);
        }
      }
      walk(item, at);
    }
  };
  const findingsForScript = (script, name, at) => {
    for (const finding of inspectCredentials(script, name)) findings.add(`${file}:${at}:${finding}`);
  };
  if (structured) parse(text, file.endsWith('.json') ? 'json' : file.endsWith('.toml') ? 'toml' : 'yaml', '$');
  // Cover literals in unrendered templates/scripts (including disabled branches).
  // Protocol identifiers and references remain legal; literal assignments do not.
  for (const [i, line] of (structured ? [] : text.split('\n')).entries()) {
    if (/^\s*(#|\/\/|\*)/.test(line)) continue;
    const assignment = /["']?([\w.-]*(?:password|passwd|pwd)[\w.-]*)["']?\s*[:=]\s*(?:(["'])(.*?)\2|([^\s,;}]+))/gi;
    for (const match of line.matchAll(assignment)) {
      const [, key, quote, quoted, bare] = match;
      const value = quote ? quoted : bare;
      if (referenceKey.test(key) || /(?:allowed|enabled|required)$/i.test(key) || !value || value === 'null'
        || marker.test(value) || value.includes('{{') || value.startsWith('${') || value.startsWith('$(')) continue;
      // Unquoted program expressions are checked after Helm renders the config.
      if (!quote && !/\.(ya?ml|toml|json)$/.test(file) && !/^\d+$/.test(value)
        && !(file.endsWith('.sh') && /^[\w!@%+.,:-]+$/.test(value))) continue;
      if (!quote && ['|', '>', '|-', '>-'].includes(value)) continue;
      report(`line ${i + 1}`);
    }
  }
  return [...findings];
}

function archiveFiles(bytes, prefix = '') {
  const run = args => execFileSync('tar', args, { input: bytes, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const files = [];
  for (const name of run(['-tzf', '-']).toString().split('\n').filter(name => name && !name.endsWith('/'))) {
    const data = run(['-xOzf', '-', '--', name]);
    if (name.endsWith('.tgz')) files.push(...archiveFiles(data, `${prefix}${name}!`));
    else files.push({ name: `${prefix}${name}`, data });
  }
  return files;
}

function directoryFiles(root, prefix = '') {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name), relative = prefix + name;
    if (statSync(path).isDirectory()) return directoryFiles(path, `${relative}/`);
    const data = readFileSync(path);
    return name.endsWith('.tgz') ? archiveFiles(data, `${relative}!`) : [{ name: relative, data }];
  });
}

export function validateChartCredentials(chart) {
  const files = statSync(chart).isDirectory() ? directoryFiles(chart) : archiveFiles(readFileSync(chart));
  const findings = [];
  for (const { name, data } of files) {
    if (!/\.(ya?ml|json|toml|tpl|mjs|js|py|sh)$/.test(name)) continue;
    findings.push(...inspectCredentials(data.toString(), name, {
      structured: /\.(ya?ml|json|toml)$/.test(name) && !name.includes('/templates/') && !name.startsWith('templates/'),
    }));
  }
  const directory = mkdtempSync(join(tmpdir(), 'relay-chart-credentials-'));
  try {
    const rootPrefix = files.find(f => !f.name.includes('!') && /(^|\/)Chart.yaml$/.test(f.name))?.name.replace(/Chart.yaml$/, '');
    if (rootPrefix === undefined) throw Error('Chart.yaml missing');
    const profiles = files.filter(f => !f.name.includes('!') && f.name.startsWith(rootPrefix)
      && /^values(?:-[\w-]+)?\.yaml$/.test(f.name.slice(rootPrefix.length)));
    for (const profile of profiles) {
      const path = join(directory, basename(profile.name));
      writeFileSync(path, profile.data, { mode: 0o600 });
      const rendered = execFileSync('helm', ['template', 'credential-audit', chart, '--namespace', 'credential-audit',
        '--kube-version', '1.29.0', '-f', path, '--set', 'keycloak.enabled=true', '--set', 'exampleMcp.enabled=true',
        '--set', 'keycloak.publicUrl=https://keycloak.example.test',
        '--set-string', 'control.publicUrls[0]=https://relay.example.test'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      findings.push(...inspectCredentials(rendered, `render/${basename(profile.name)}`, { structured: true }));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  if (findings.length) throw Error([...new Set(findings)].join('\n'));
  return files.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const count = validateChartCredentials(process.argv[2] ?? 'charts/tali-relay');
    console.log(`Chart credential check passed (${count} packaged/source files and all values profiles).`);
  } catch (error) {
    // Helm/tar/parser errors may contain input; never forward their stderr.
    console.error(error?.stderr || error?.code ? 'Chart credential check failed: cannot read or render chart.' : error.message);
    process.exitCode = 1;
  }
}
