import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dependencyLicensePolicyV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

type LockPackage = {
  version?: string;
  license?: string;
  link?: boolean;
};

type PackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
};

const [policyRaw, lockBytes] = await Promise.all([
  readFile(new URL("../docs/delivery/phase-14/dependency-license-policy.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url)),
]);
const policy = dependencyLicensePolicyV1Schema.parse(JSON.parse(policyRaw));
const lockDigest = createHash("sha256").update(lockBytes).digest("hex");
if (lockDigest !== policy.packageLockSha256) throw new Error("package-lock checksum changed; review licenses");

const lock = JSON.parse(lockBytes.toString("utf8")) as PackageLock;
if (lock.lockfileVersion !== policy.lockfileVersion || lock.packages === undefined) {
  throw new Error(`expected package-lock v${policy.lockfileVersion}`);
}

const allowedLicenses = new Set(policy.allowedLicenses);
const licenseCounts = new Map<string, number>();
let externalPackageCount = 0;
let workspacePackageCount = 0;

for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (packagePath === "" || entry.link === true) continue;
  const isWorkspace = policy.workspacePathPrefixes.some((prefix) => packagePath.startsWith(prefix));
  if (isWorkspace) {
    workspacePackageCount += 1;
    if (!policy.allowMissingLicenseForWorkspacePackages && entry.license === undefined) {
      throw new Error(`workspace package lacks license metadata: ${packagePath}`);
    }
    continue;
  }

  externalPackageCount += 1;
  const packageName = packagePath.split("node_modules/").at(-1) ?? packagePath;
  if (entry.license === undefined) throw new Error(`dependency lacks license metadata: ${packageName}`);
  const normalizedLicense = entry.license.trim();
  const upperLicense = normalizedLicense.toUpperCase();
  const deniedToken = policy.deniedLicenseTokens.find((token) => upperLicense.includes(token.toUpperCase()));
  if (deniedToken !== undefined) {
    throw new Error(`dependency uses denied license token ${deniedToken}: ${packageName}@${entry.version}`);
  }
  if (!allowedLicenses.has(normalizedLicense)) {
    throw new Error(`dependency license is not allowlisted: ${packageName}@${entry.version} (${normalizedLicense})`);
  }
  licenseCounts.set(normalizedLicense, (licenseCounts.get(normalizedLicense) ?? 0) + 1);
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  packageLockSha256: lockDigest,
  externalPackageCount,
  workspacePackageCount,
  licenseCounts: Object.fromEntries([...licenseCounts].sort(([left], [right]) => left.localeCompare(right))),
  verified: true,
}, null, 2)}\n`);
