import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { configurationContractV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

const repositoryRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const contract = configurationContractV1Schema.parse(JSON.parse(await readFile(
  new URL("../docs/delivery/phase-16/configuration-contract.json", import.meta.url),
  "utf8",
)));
const sourceRoots = [
  "apps/fleet-delivery-api",
  "apps/fleet-delivery-worker",
  "packages/fleet-delivery-database",
  "packages/fleet-delivery-shared",
  "infrastructure/fleet-delivery",
];
const sourceExtensions = new Set([".ts", ".sh", ".yml", ".yaml", ".example"]);
const excludedDirectories = new Set(["dist", "node_modules"]);
const sourceFiles: string[] = [];

function assertInsideRepository(path: string): void {
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error("configuration scan path escapes repository");
  }
}

async function collect(path: string): Promise<void> {
  assertInsideRepository(path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`configuration scan contains symlink: ${relative(repositoryRoot, path)}`);
  if (stat.isDirectory()) {
    if (excludedDirectories.has(basename(path))) return;
    for (const entry of await readdir(path)) await collect(resolve(path, entry));
    return;
  }
  if (stat.isFile() && sourceExtensions.has(extname(path))) sourceFiles.push(path);
}

for (const rootRef of sourceRoots) await collect(resolve(repositoryRoot, rootRef));

const variablePattern = /\bFLEET_DELIVERY_[A-Z0-9_]+\b/g;
const discovered = new Set<string>();
for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(variablePattern)) discovered.add(match[0]);
}

const expected = [...contract.variables].sort();
const actual = [...discovered].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const missingFromContract = actual.filter((value) => !expected.includes(value));
  const absentFromSources = expected.filter((value) => !actual.includes(value));
  throw new Error(`configuration inventory drift: ${JSON.stringify({ missingFromContract, absentFromSources })}`);
}

const envExample = await readFile(
  resolve(repositoryRoot, "infrastructure/fleet-delivery/.env.example"),
  "utf8",
);
const exampleValues = new Map<string, string>();
for (const line of envExample.split(/\r?\n/)) {
  if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) throw new Error("invalid .env.example entry");
  const key = line.slice(0, separator);
  if (exampleValues.has(key)) throw new Error(`duplicate .env.example variable: ${key}`);
  exampleValues.set(key, line.slice(separator + 1));
}
const exampleKeys = [...exampleValues.keys()].sort();
if (JSON.stringify(exampleKeys) !== JSON.stringify(expected)) {
  throw new Error(".env.example does not exactly match the configuration contract");
}
for (const secret of contract.secretVariables) {
  const value = exampleValues.get(secret) ?? "";
  if (value !== "" && !value.toLowerCase().includes("change-me")) {
    throw new Error(`secret example must be blank or an obvious placeholder: ${secret}`);
  }
}

const compose = await readFile(
  resolve(repositoryRoot, "infrastructure/fleet-delivery/docker-compose.yml"),
  "utf8",
);
const composeVariables = new Set([...compose.matchAll(variablePattern)].map((match) => match[0]));
for (const variable of contract.composeRequiredVariables) {
  if (!composeVariables.has(variable)) throw new Error(`Compose is missing required variable: ${variable}`);
}

process.stdout.write(`${JSON.stringify({
  phase: contract.phase,
  mode: contract.mode,
  productionAuthorized: contract.productionAuthorized,
  variableCount: expected.length,
  secretVariableCount: contract.secretVariables.length,
  productionRequiredCount: contract.productionRequiredVariables.length,
  composeRequiredCount: contract.composeRequiredVariables.length,
  scannedSourceFileCount: sourceFiles.length,
  verified: true,
}, null, 2)}\n`);
