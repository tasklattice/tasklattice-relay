import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareNemoClawSource } from '../prepare-nemoclaw-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nemoclaw-cache-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, 'upstream');
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('init', '--quiet', repository);
  await writeFile(join(repository, 'Dockerfile'), 'FROM scratch\n');
  await symlink('Dockerfile', join(repository, 'dockerfile-link'));
  git('-C', repository, 'add', '.');
  git('-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  git('-C', repository, 'tag', 'v1');
  const cacheRoot = join(root, 'cache');
  const prepare = (name, version = 'v1') => prepareNemoClawSource({
    destination: join(root, name), version, repository, cacheRoot, attempts: 1, log: () => {},
  });
  return { root, repository, cacheRoot, prepare, git };
}

test('a cached release works offline and platform patches do not contaminate it', async (t) => {
  const { root, repository, prepare } = await fixture(t);
  const entry = await prepare('openclaw');
  await writeFile(join(root, 'openclaw', 'Dockerfile'), 'patched\n');
  await rename(repository, `${repository}-offline`);
  assert.equal(await prepare('deepagents'), entry);
  assert.equal(await readFile(join(root, 'deepagents', 'Dockerfile'), 'utf8'), 'FROM scratch\n');
  assert.equal(await readlink(join(root, 'deepagents', 'dockerfile-link')), 'Dockerfile');
});

test('failed downloads are not published and a later retry succeeds', async (t) => {
  const { repository, cacheRoot, prepare, git } = await fixture(t);
  await assert.rejects(prepare('missing', 'v2'), /Git command failed/);
  assert.deepEqual(await readdir(cacheRoot), []);
  git('-C', repository, 'tag', 'v2');
  const v2 = await prepare('retry', 'v2');
  const v1 = await prepare('original');
  assert.notEqual(v1, v2);
});

test('concurrent builders publish one complete cache entry', async (t) => {
  const { root, cacheRoot, prepare } = await fixture(t);
  const entries = await Promise.all([prepare('hermes'), prepare('deepagents')]);
  assert.equal(entries[0], entries[1]);
  assert.equal((await readdir(cacheRoot)).length, 1);
  for (const platform of ['hermes', 'deepagents']) {
    assert.equal(await readFile(join(root, platform, 'Dockerfile'), 'utf8'), 'FROM scratch\n');
  }
});
