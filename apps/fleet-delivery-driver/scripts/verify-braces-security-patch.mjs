import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const policy = JSON.parse(await readFile(
  path.join(repoRoot, 'docs/delivery/phase-12/mobile-braces-security-patch.json'),
  'utf8',
));
const appPackage = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));

if (policy.productionAuthorized !== false || policy.securityApprovalRequired !== true) {
  throw new Error('mobile security patch policy must remain non-authorizing');
}
if (appPackage.overrides?.[policy.upstreamPackage] !== policy.override) {
  throw new Error('mobile braces override does not match the reviewed policy');
}
if (appPackage.dependencies?.[policy.upstreamPackage] !== policy.directDependency) {
  throw new Error('mobile braces direct dependency does not match the reviewed local fork');
}

const vendorRoot = path.resolve(repoRoot, policy.vendorPath);
const expectedFiles = Object.keys(policy.files).sort();
const observedFiles = [];
async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`vendored braces contains a symlink: ${absolute}`);
    if (entry.isDirectory()) await collectFiles(absolute);
    else if (entry.isFile()) observedFiles.push(path.relative(vendorRoot, absolute).split(path.sep).join('/'));
    else throw new Error(`vendored braces contains an unsupported entry: ${absolute}`);
  }
}
await collectFiles(vendorRoot);
assert.deepEqual(observedFiles.sort(), expectedFiles, 'vendored braces file set changed');
for (const relative of expectedFiles) {
  const digest = createHash('sha256').update(await readFile(path.join(vendorRoot, relative))).digest('hex');
  assert.equal(digest, policy.files[relative], `vendored braces file changed: ${relative}`);
}

const requireFromMicromatch = createRequire(path.join(appRoot, 'node_modules/micromatch/package.json'));
const installedPackagePath = requireFromMicromatch.resolve('braces/package.json');
const installedRoot = await realpath(path.dirname(installedPackagePath));
assert.equal(installedRoot, vendorRoot, 'installed braces is not the reviewed local fork');
const installedPackage = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
assert.equal(installedPackage.version, policy.patchedVersion, 'installed braces patch version changed');
assert.equal(installedPackage.bmsSecurityPatch?.upstreamVersion, policy.upstreamVersion);
assert.equal(installedPackage.bmsSecurityPatch?.advisory, policy.advisory);
assert.equal(installedPackage.bmsSecurityPatch?.maximumStructuralDepth, policy.maximumStructuralDepth);

const braces = requireFromMicromatch('braces');
assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
assert.equal(braces.compile('a/{1..3}/d'), 'a/([1-3])/d');

const nestedBraces = `${'{'.repeat(policy.maximumStructuralDepth + 1)}x${'}'.repeat(policy.maximumStructuralDepth + 1)}`;
const nestedParentheses = `${'('.repeat(policy.maximumStructuralDepth + 1)}x${')'.repeat(policy.maximumStructuralDepth + 1)}`;
for (const maliciousPattern of [nestedBraces, nestedParentheses]) {
  assert.throws(
    () => braces.compile(maliciousPattern),
    error => error instanceof SyntaxError && error.message.includes('exceeds max depth'),
    'deeply nested pattern must be rejected before recursive walkers execute',
  );
}
assert.throws(
  () => braces.parse('{{{{{{x}}}}}}', { maxDepth: 5 }),
  error => error instanceof SyntaxError && error.message.includes('exceeds max depth (5)'),
);

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  advisory: policy.advisory,
  upstreamVersion: policy.upstreamVersion,
  patchedVersion: policy.patchedVersion,
  maximumStructuralDepth: policy.maximumStructuralDepth,
  productionAuthorized: policy.productionAuthorized,
  securityApprovalRequired: policy.securityApprovalRequired,
  exploitMitigated: true,
  verified: true,
}, null, 2)}\n`);
