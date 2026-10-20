import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { reproducibleBuildPolicyV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

const repositoryRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const policy = reproducibleBuildPolicyV1Schema.parse(JSON.parse(await readFile(
  new URL("../docs/delivery/phase-15/reproducible-build-policy.json", import.meta.url),
  "utf8",
)));
const expectedArtifacts = [...policy.artifacts].sort();

async function collectArtifacts(path: string, output: string[]): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`build output contains symlink: ${relative(repositoryRoot, path)}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) await collectArtifacts(resolve(path, entry), output);
    return;
  }
  if (stat.isFile()) output.push(relative(repositoryRoot, path));
}

async function snapshot(): Promise<Record<string, string>> {
  const files: string[] = [];
  await collectArtifacts(resolve(repositoryRoot, "dist/fleet-delivery-api"), files);
  await collectArtifacts(resolve(repositoryRoot, "dist/fleet-delivery-worker"), files);
  files.sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedArtifacts)) {
    throw new Error(`build artifact set differs from policy: ${JSON.stringify(files)}`);
  }
  return Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    createHash("sha256").update(await readFile(resolve(repositoryRoot, file))).digest("hex"),
  ])));
}

const snapshots: Array<Record<string, string>> = [];
for (let iteration = 0; iteration < policy.iterations; iteration += 1) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "build"], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`build iteration ${iteration + 1} failed with status ${result.status}`);
  }
  snapshots.push(await snapshot());
}

const baseline = JSON.stringify(snapshots[0]);
if (snapshots.some((candidate) => JSON.stringify(candidate) !== baseline)) {
  throw new Error("build artifacts are not reproducible across iterations");
}

process.stdout.write(`${JSON.stringify({
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  iterations: policy.iterations,
  artifactCount: expectedArtifacts.length,
  artifacts: snapshots[0],
  verified: true,
}, null, 2)}\n`);
