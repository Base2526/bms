import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const policy = JSON.parse(await readFile(
  path.join(repoRoot, 'docs/delivery/phase-15/mobile-reproducible-build-policy.json'),
  'utf8',
));

if (policy.productionAuthorized !== false || policy.iterations < 2) {
  throw new Error('mobile reproducibility policy must remain fail-closed and use at least two iterations');
}
if (!Array.isArray(policy.platforms) || policy.platforms.some(platform => !['android', 'ios'].includes(platform))) {
  throw new Error('mobile reproducibility policy contains an unsupported platform');
}

function runBundle(platform, outputRoot) {
  const cli = path.join(appRoot, 'node_modules/react-native/cli.js');
  const bundleFile = path.join(outputRoot, 'main.jsbundle');
  const assets = path.join(outputRoot, 'assets');
  const args = [
    cli,
    'bundle',
    '--entry-file', policy.entryFile,
    '--platform', platform,
    '--dev', 'false',
    '--reset-cache',
    '--bundle-output', bundleFile,
    '--assets-dest', assets,
    '--minify', 'false',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: appRoot, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`mobile ${platform} bundle failed (${code}): ${stderr.slice(-2000)}`)));
  });
}

async function digestTree(root) {
  const result = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`mobile bundle output contains a symlink: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        result[relative] = createHash(policy.hashAlgorithm).update(await readFile(absolute)).digest('hex');
      } else throw new Error(`mobile bundle output contains an unsupported entry: ${absolute}`);
    }
  }
  await visit(root);
  return result;
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'bms-delivery-mobile-repro-'));
try {
  const verified = {};
  for (const platform of policy.platforms) {
    let expected = null;
    for (let iteration = 0; iteration < policy.iterations; iteration += 1) {
      const outputRoot = path.join(temporaryRoot, `${platform}-${iteration}`);
      await runBundle(platform, outputRoot);
      const digest = await digestTree(outputRoot);
      if (expected === null) expected = digest;
      else if (JSON.stringify(digest) !== JSON.stringify(expected)) {
        throw new Error(`mobile ${platform} bundle output is not reproducible`);
      }
    }
    verified[platform] = expected;
  }
  process.stdout.write(`${JSON.stringify({
    phase: policy.phase,
    mode: policy.mode,
    productionAuthorized: policy.productionAuthorized,
    iterations: policy.iterations,
    platforms: policy.platforms,
    artifacts: verified,
    verified: true,
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
