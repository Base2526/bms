import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const policy = JSON.parse(await readFile(
  path.join(repoRoot, 'docs/delivery/phase-12/mobile-audit-boundary.json'),
  'utf8',
));
const launchPlan = JSON.parse(await readFile(path.join(repoRoot, policy.productionPlanPath), 'utf8'));
const readiness = JSON.parse(await readFile(path.join(repoRoot, policy.securityGatePath), 'utf8'));
const patchPolicy = JSON.parse(await readFile(path.join(repoRoot, policy.securityPatchPolicyPath), 'utf8'));

function audit() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['audit', '--omit=dev', '--json'], {
      cwd: appRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      try {
        resolve({ code, report: JSON.parse(stdout) });
      } catch {
        reject(new Error(`npm audit did not return JSON: ${stderr.slice(-1000)}`));
      }
    });
  });
}

const { report } = await audit();
const counts = report.metadata?.vulnerabilities;
if (!counts) throw new Error('npm audit report lacks vulnerability metadata');
for (const [severity, expected] of Object.entries(policy.expectedVulnerabilities)) {
  if (counts[severity] !== expected) {
    throw new Error(`mobile audit drift for ${severity}: expected ${expected}, received ${counts[severity]}`);
  }
}

const advisoryUrls = new Set();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'object' && typeof via.url === 'string') advisoryUrls.add(via.url);
  }
}
const expectedUrls = [...policy.knownAdvisoryUrls].sort();
const observedUrls = [...advisoryUrls].sort();
if (JSON.stringify(observedUrls) !== JSON.stringify(expectedUrls)) {
  throw new Error('mobile audit advisory set changed; Security review is required');
}

const securityGate = readiness.gates?.find(gate => gate.id === policy.securityGateId);
if (!securityGate) throw new Error(`missing mobile security gate: ${policy.securityGateId}`);
const dependencyAuditBlocked = counts.total > 0;
const securityApprovalBlocked = securityGate.status !== 'APPROVED' || !Array.isArray(securityGate.approvals) || securityGate.approvals.length === 0;
const releaseBlocked = dependencyAuditBlocked || securityApprovalBlocked;
if (launchPlan.productionEnabled === true && releaseBlocked) {
  throw new Error('production cannot be enabled before the mobile audit is clean and Security approves the local patch');
}
if (policy.productionAuthorized !== false) throw new Error('mobile audit policy must remain non-authorizing');
if (patchPolicy.productionAuthorized !== false || patchPolicy.securityApprovalRequired !== true) {
  throw new Error('mobile security patch policy must remain non-authorizing');
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  vulnerabilityCounts: counts,
  knownAdvisoryUrls: observedUrls,
  locallyMitigatedAdvisoryUrls: policy.locallyMitigatedAdvisoryUrls,
  dependencyAuditBlocked,
  securityApprovalBlocked,
  releaseBlocked,
  verified: true,
}, null, 2)}\n`);
