import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const policyPath = path.join(repoRoot, 'docs/delivery/phase-12/mobile-supply-chain-policy.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(repoRoot, policy.packagePath), 'utf8'));
const lock = JSON.parse(await readFile(path.join(repoRoot, policy.lockfilePath), 'utf8'));

if (policy.productionAuthorized !== false || lock.lockfileVersion !== policy.lockfileVersion || !lock.packages) {
  throw new Error('invalid fail-closed mobile supply-chain policy or lockfile');
}

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const direct = { ...packageJson.dependencies, ...packageJson.devDependencies };
const rootLock = lock.packages[''];
if (!rootLock) throw new Error('mobile lockfile root package is missing');

for (const [name, declaration] of Object.entries(direct)) {
  const lockedDeclaration = rootLock.dependencies?.[name] ?? rootLock.devDependencies?.[name];
  if (lockedDeclaration !== declaration) throw new Error(`mobile lock declaration mismatch: ${name}`);
  if (declaration.startsWith('file:')) {
    const target = await realpath(path.resolve(appRoot, declaration.slice(5)));
    const relative = path.relative(repoRoot, target).split(path.sep).join('/');
    if (relative.startsWith('../') || !policy.allowedLocalPackages.includes(relative)) {
      throw new Error(`unapproved local mobile dependency: ${name} -> ${relative}`);
    }
  } else if (policy.requireExactDirectVersions && !exactVersion.test(declaration)) {
    throw new Error(`mobile direct dependency is not exact: ${name}@${declaration}`);
  }
}

const allowedInstallScripts = new Set(
  policy.allowedInstallScripts.map(entry => `${entry.package}@${entry.version}`),
);
const observedInstallScripts = new Set();
let registryArtifactCount = 0;

for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (entry.link === true) continue;
  if (entry.resolved !== undefined) {
    if (!policy.allowedRegistryPrefixes.some(prefix => entry.resolved.startsWith(prefix))) {
      throw new Error(`mobile package resolves from a disallowed source: ${packagePath}`);
    }
    if (policy.requireSha512Integrity && !entry.integrity?.startsWith('sha512-')) {
      throw new Error(`mobile package lacks sha512 integrity: ${packagePath}`);
    }
    registryArtifactCount += 1;
  }
  if (entry.hasInstallScript === true) {
    const packageName = packagePath.replace(/^node_modules\//, '');
    const key = `${packageName}@${entry.version ?? 'unknown'}`;
    if (!allowedInstallScripts.has(key)) throw new Error(`unapproved mobile install script: ${key}`);
    observedInstallScripts.add(key);
  }
}

for (const allowed of allowedInstallScripts) {
  if (!observedInstallScripts.has(allowed)) throw new Error(`stale mobile install-script exception: ${allowed}`);
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  directDependencyCount: Object.keys(direct).length,
  lockedPackageCount: Object.keys(lock.packages).length - 1,
  registryArtifactCount,
  verifiedInstallScripts: [...observedInstallScripts].sort(),
  verified: true,
}, null, 2)}\n`);
