import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const policy = JSON.parse(await readFile(
  path.join(repoRoot, 'docs/delivery/phase-14/mobile-dependency-license-policy.json'),
  'utf8',
));
const lockBytes = await readFile(path.join(repoRoot, policy.lockfilePath));
const lockDigest = createHash('sha256').update(lockBytes).digest('hex');
if (policy.productionAuthorized !== false || lockDigest !== policy.packageLockSha256) {
  throw new Error('mobile lockfile checksum changed; review licenses');
}

const lock = JSON.parse(lockBytes.toString('utf8'));
const allowed = new Set(policy.allowedLicenses);
const exceptions = new Map(policy.metadataExceptions.map(entry => [`${entry.package}@${entry.version}`, entry]));
const usedExceptions = new Set();
const counts = new Map();
let externalPackageCount = 0;
let workspacePackageCount = 0;

for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
  if (packagePath === '' || entry.link === true) continue;
  if (!packagePath.startsWith('node_modules/')) {
    workspacePackageCount += 1;
    continue;
  }
  externalPackageCount += 1;
  const packageName = packagePath.replace(/^node_modules\//, '');
  let license = entry.license?.trim();
  if (!license) {
    const key = `${packageName}@${entry.version ?? 'unknown'}`;
    const exception = exceptions.get(key);
    if (!exception) throw new Error(`mobile dependency lacks license metadata: ${key}`);
    const licensePath = path.resolve(appRoot, exception.licenseFile);
    if (!licensePath.startsWith(`${appRoot}${path.sep}`)) throw new Error(`invalid license path: ${key}`);
    const digest = createHash('sha256').update(await readFile(licensePath)).digest('hex');
    if (digest !== exception.licenseFileSha256) throw new Error(`license evidence changed: ${key}`);
    license = exception.license;
    usedExceptions.add(key);
  }
  const upper = license.toUpperCase();
  const denied = policy.deniedLicenseTokens.find(token => upper.includes(token.toUpperCase()));
  if (denied) throw new Error(`mobile dependency uses denied license ${denied}: ${packageName}`);
  if (!allowed.has(license)) throw new Error(`mobile dependency license is not allowlisted: ${packageName} (${license})`);
  counts.set(license, (counts.get(license) ?? 0) + 1);
}

for (const key of exceptions.keys()) {
  if (!usedExceptions.has(key)) throw new Error(`stale mobile license exception: ${key}`);
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  packageLockSha256: lockDigest,
  externalPackageCount,
  workspacePackageCount,
  licenseCounts: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
  metadataExceptions: [...usedExceptions].sort(),
  verified: true,
}, null, 2)}\n`);
