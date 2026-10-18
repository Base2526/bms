import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  secretScanPolicyV1Schema,
  type SecretScanRuleId,
} from "../packages/fleet-delivery-contracts/src/index.js";

const rules: Record<SecretScanRuleId, RegExp> = {
  "pem-private-key": /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  "aws-access-key": /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  "github-token": /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,255}\b/g,
  "slack-token": /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  "stripe-live-secret": /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  "google-api-key": /\bAIza[0-9A-Za-z_-]{35}\b/g,
  "npm-token": /\bnpm_[A-Za-z0-9]{36,}\b/g,
};

const repositoryRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const policy = secretScanPolicyV1Schema.parse(JSON.parse(await readFile(
  new URL("../docs/delivery/phase-13/secret-scan-policy.json", import.meta.url),
  "utf8",
)));
const excludedDirectories = new Set(policy.excludedDirectories);
const allowedExtensions = new Set(policy.allowedExtensions);
const allowedFileNames = new Set(policy.allowedFileNames);
const files = new Set<string>();

function assertInsideRepository(path: string, label: string): void {
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`${label} escapes repository`);
  }
}

async function collect(path: string): Promise<void> {
  assertInsideRepository(path, path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`scan scope contains symlink: ${relative(repositoryRoot, path)}`);
  if (stat.isDirectory()) {
    if (excludedDirectories.has(basename(path))) return;
    for (const entry of await readdir(path)) await collect(resolve(path, entry));
    return;
  }
  if (!stat.isFile()) return;
  if (allowedExtensions.has(extname(path)) || allowedFileNames.has(basename(path))) files.add(path);
}

for (const rootRef of policy.roots) {
  const root = resolve(repositoryRoot, rootRef);
  assertInsideRepository(root, rootRef);
  const actual = await realpath(root);
  assertInsideRepository(actual, rootRef);
  await collect(actual);
}

const usedExceptions = new Set<string>();
const findings: Array<{ ruleId: SecretScanRuleId; path: string; line: number }> = [];

for (const path of [...files].sort()) {
  const bytes = await readFile(path);
  const displayPath = relative(repositoryRoot, path);
  if (bytes.length > policy.maximumFileBytes) throw new Error(`scan file exceeds size bound: ${displayPath}`);
  if (bytes.includes(0)) throw new Error(`text scan scope contains binary data: ${displayPath}`);
  const text = bytes.toString("utf8");

  for (const ruleId of policy.rules) {
    const expression = new RegExp(rules[ruleId].source, "g");
    for (const match of text.matchAll(expression)) {
      const matchSha256 = createHash("sha256").update(match[0]).digest("hex");
      const exceptionKey = `${ruleId}:${displayPath}:${matchSha256}`;
      const exception = policy.exceptions.find((candidate) =>
        candidate.ruleId === ruleId
        && candidate.path === displayPath
        && candidate.matchSha256 === matchSha256);
      if (exception !== undefined) {
        usedExceptions.add(exceptionKey);
        continue;
      }
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({ ruleId, path: displayPath, line });
    }
  }
}

for (const exception of policy.exceptions) {
  const key = `${exception.ruleId}:${exception.path}:${exception.matchSha256}`;
  if (!usedExceptions.has(key)) throw new Error(`stale secret-scan exception: ${exception.ruleId}:${exception.path}`);
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  scannedFileCount: files.size,
  ruleCount: policy.rules.length,
  exceptionCount: policy.exceptions.length,
  findingCount: findings.length,
  findings,
  verified: findings.length === 0,
}, null, 2)}\n`);

if (findings.length > 0) process.exitCode = 2;
