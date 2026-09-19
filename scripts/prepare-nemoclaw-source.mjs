import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const repositoryUrl = 'https://github.com/NVIDIA/NemoClaw.git';

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 300_000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`NemoClaw source Git command failed (${signal ?? code}).`));
    });
  });
}

// Cache only pristine upstream sources. Patches belong to the disposable build
// context, so all three Agent platforms can safely share the same release.
export async function prepareNemoClawSource({
  destination,
  version,
  cacheRoot = process.env.NEMOCLAW_SOURCE_CACHE_DIR || join(tmpdir(), 'tali-nemoclaw-cache'),
  repository = repositoryUrl,
  attempts = 3,
  log = console.error,
}) {
  if (!version || version.startsWith('-')) throw new Error('A NemoClaw release tag or commit is required.');
  const key = createHash('sha256').update(JSON.stringify([repository, version])).digest('hex');
  cacheRoot = resolve(cacheRoot);
  const entry = join(cacheRoot, key);
  const manifest = JSON.stringify({ repository, version, format: 1 });
  const isComplete = async () => {
    try {
      return await readFile(join(entry, 'manifest.json'), 'utf8') === manifest;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };

  await mkdir(cacheRoot, { recursive: true });
  if (await isComplete()) {
    log(`NemoClaw source cache hit (${version}): ${entry}`);
  } else {
    log(`Preparing NemoClaw source cache (${version}): ${entry}`);
    // Publish only complete downloads by atomic rename. Concurrent builds may
    // fetch independently, but never read each other's incomplete checkout.
    const staging = await mkdtemp(join(cacheRoot, '.download-'));
    try {
      const source = join(staging, 'source');
      for (let attempt = 1; ; attempt++) {
        try {
          await rm(source, { recursive: true, force: true });
          await git(['init', '--quiet', source]);
          // The exact identity rewrite wins over a user's broad GitHub-to-SSH
          // rewrite, without modifying their Git configuration.
          await git(['-C', source, '-c', `url.${repository}.insteadOf=${repository}`,
            'fetch', '--quiet', '--depth=1', '--no-tags', '--', repository, version]);
          await git(['-C', source, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
          break;
        } catch (error) {
          if (attempt >= attempts) throw error;
          log(`NemoClaw source download failed; retrying (${attempt + 1}/${attempts}).`);
          await setTimeout(attempt * 1000);
        }
      }
      await writeFile(join(staging, 'manifest.json'), manifest);
      try {
        await rename(staging, entry);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !await isComplete()) throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  await cp(join(entry, 'source'), destination, { recursive: true, verbatimSymlinks: true });
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [destination, version = process.env.NEMOCLAW_VERSION || 'v0.0.123'] = process.argv.slice(2);
  if (!destination) {
    console.error('Usage: node scripts/prepare-nemoclaw-source.mjs <empty-destination> [release-tag-or-commit]');
    process.exitCode = 2;
  } else {
    try {
      await prepareNemoClawSource({ destination, version });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
