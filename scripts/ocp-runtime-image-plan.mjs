#!/usr/bin/env node
// Read-only: emits image references, never credentials from rendered manifests.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseAllDocuments } from 'yaml';
import { parse as parseToml } from 'smol-toml';

function inventory(yaml) {
  const docs = parseAllDocuments(yaml);
  if (docs.some(d => d.errors.length)) throw Error('Invalid rendered YAML');
  const resources = docs.map(d => d.toJSON()).filter(Boolean);
  const workers = resources.filter(r => r.stringData?.['worker.toml']);
  if (workers.length !== 1) throw Error('Expected one Chart-managed Worker configuration');
  const worker = parseToml(workers[0].stringData['worker.toml']).worker;
  const specs = resources.filter(r => r.data?.['spec.json']);
  if (specs.length !== 1) throw Error('Expected one credential bootstrap specification');
  const output = JSON.parse(specs[0].data['spec.json']).outputs.find(o => o.fields?.['runner.json']);
  if (!output) throw Error('Expected Chart-managed Runner configuration');
  const control = JSON.parse(specs[0].data['spec.json']).outputs.find(o => o.fields?.['control.toml']);
  if (!control) throw Error('Expected Chart-managed Control configuration for built-in Demo images');
  const platforms = JSON.parse(output.fields['runner.json']).openshell.sandbox.images;
  if (JSON.stringify(Object.values(platforms).sort()) !== JSON.stringify([...(worker.project_openshell.sandboxImages ?? [])].sort())) {
    throw Error('Worker and Runner platform images differ');
  }
  const g = worker.project_openshell;
  return { openshift: worker.openshift, images: {
    gateway: `${g.gatewayImageRepository}:${g.gatewayImageTag}`,
    supervisor: `${g.supervisorImageRepository}:${g.supervisorImageTag}`,
    sandbox: g.sandboxImage,
    openclaw: platforms.openclaw, hermes: platforms.hermes, deepagents: platforms.deepagents, pi: platforms.pi,
    bridge: worker.project_runtime_bridge.image, expert: worker.expert_agent_runtime.image,
    demo: parseToml(control.fields['control.toml']).demo_agents.image,
  } };
}

export function imagePlan(sourceYaml, targetYaml) {
  const source = inventory(sourceYaml), target = inventory(targetYaml);
  const namespace = target.openshift.imageSourceNamespace;
  const registry = target.openshift.imageRegistryHost || 'image-registry.openshift-image-registry.svc:5000';
  if (!target.openshift.enabled || !namespace) throw Error('Target must enable OCP with a source namespace');
  const prefix = `${registry}/${namespace}/`, entries = new Map();
  for (const [role, reference] of Object.entries(target.images)) {
    const upstream = source.images[role];
    if (!reference?.startsWith(prefix) || !upstream) throw Error(`Missing/shared-source mismatch for ${role}`);
    const leaf = reference.slice(prefix.length);
    const match = /^([a-z0-9.-]+)(?::([\w.-]+))?(?:@(sha256:[a-f0-9]{64}))?$/.exec(leaf);
    if (!match) throw Error(`Unsupported ImageStream reference for ${role}; expected a tag or SHA-256 digest`);
    // Ensure the two renders differ only by shared-source rewriting.
    if (upstream.split('/').at(-1) !== leaf) throw Error(`Source/target image version or name differs for ${role}`);
    const [, stream, configuredTag, digest] = match;
    // Digest-only references need a stable import tag; runtime still pulls by digest.
    const tag = configuredTag || (digest ? `relay-${digest.replace(':', '-')}` : 'latest');
    const key = `${stream}:${tag}`;
    const previous = entries.get(key);
    if (previous && (previous.source !== upstream || previous.digest !== (digest ?? null))) {
      throw Error(`Conflicting imports for ${key}`);
    }
    const item = previous || { source: upstream, target: reference, stream, tag, digest: digest ?? null, roles: [] };
    item.roles.push(...(role === 'gateway' ? ['gateway', 'certgen'] : [role]));
    entries.set(key, item);
  }
  return { registry, namespace, images: [...entries.values()] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: node scripts/ocp-runtime-image-plan.mjs source.yaml target.yaml');
    console.log(JSON.stringify(imagePlan(readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[3], 'utf8')), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
