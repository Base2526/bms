import { readFile } from "node:fs/promises";
import { supplyChainPolicyV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type LockPackage = {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
};

const [policyRaw, packageRaw, lockRaw] = await Promise.all([
  readFile(new URL("../docs/delivery/phase-12/supply-chain-policy.json", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const policy = supplyChainPolicyV1Schema.parse(JSON.parse(policyRaw));
const packageJson = JSON.parse(packageRaw) as PackageJson;
const lock = JSON.parse(lockRaw) as PackageLock;

if (lock.lockfileVersion !== policy.lockfileVersion || lock.packages === undefined) {
  throw new Error(`expected package-lock v${policy.lockfileVersion}`);
}

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const directDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const [name, version] of Object.entries(directDependencies)) {
  if (!exactVersion.test(version)) throw new Error(`direct dependency is not exact: ${name}@${version}`);
}

const rootLock = lock.packages[""];
if (rootLock === undefined) throw new Error("package-lock root package is missing");
for (const [name, version] of Object.entries(directDependencies)) {
  const lockedDeclaration = rootLock.dependencies?.[name] ?? rootLock.devDependencies?.[name];
  if (lockedDeclaration !== version) {
    throw new Error(`package-lock direct declaration mismatch: ${name}@${version}`);
  }
}

const allowedInstallScripts = new Set(
  policy.allowedInstallScripts.map((entry) => `${entry.package}@${entry.version}`),
);
const observedInstallScripts = new Set<string>();
let registryArtifactCount = 0;

for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (entry.link === true) continue;
  if (entry.resolved !== undefined) {
    if (!policy.allowedRegistryPrefixes.some((prefix) => entry.resolved!.startsWith(prefix))) {
      throw new Error(`package resolves from a disallowed source: ${packagePath} -> ${entry.resolved}`);
    }
    if (policy.requireSha512Integrity && !entry.integrity?.startsWith("sha512-")) {
      throw new Error(`package lacks sha512 integrity: ${packagePath}`);
    }
    registryArtifactCount += 1;
  }
  if (entry.hasInstallScript === true) {
    const packageName = packagePath.replace(/^node_modules\//, "");
    const key = `${packageName}@${entry.version ?? "unknown"}`;
    if (!allowedInstallScripts.has(key)) throw new Error(`unapproved install script: ${key}`);
    observedInstallScripts.add(key);
  }
}

for (const allowed of allowedInstallScripts) {
  if (!observedInstallScripts.has(allowed)) throw new Error(`stale install-script exception: ${allowed}`);
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  lockfileVersion: lock.lockfileVersion,
  directDependencyCount: Object.keys(directDependencies).length,
  lockedPackageCount: Object.keys(lock.packages).length - 1,
  registryArtifactCount,
  verifiedInstallScripts: [...observedInstallScripts].sort(),
  verified: true,
}, null, 2)}\n`);
