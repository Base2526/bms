#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const REQUIRED_COMMON_GATES = [
  "production-release-key",
  "transactional-update-rollback",
  "replacement-machine-restore",
  "power-loss-recovery",
  "disk-full-recovery",
  "suspend-resume",
  "printer-scanner-display",
  "encrypted-off-host-backup",
  "remote-diagnostics-privacy",
  "license-control-plane",
];
const SUPPORT_MATRIX = JSON.parse(readFileSync(new URL("./support-matrix.json", import.meta.url), "utf8"));
const SUPPORTED_TARGETS = new Map(SUPPORT_MATRIX.targets.map((target) => [target.id, target]));

function assert(condition, message) {
  if (!condition) throw new Error(`promotion evidence: ${message}`);
}

function exactKeys(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  assert(extras.length === 0, `${name} has unsupported fields: ${extras.join(", ")}`);
}

function validEvidenceUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash &&
      host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && !host.endsWith(".invalid");
  } catch {
    return false;
  }
}

function platformGates(target) {
  const policy = SUPPORTED_TARGETS.get(target);
  assert(policy, `platformTarget is not in the support matrix: ${target}`);
  const result = [`clean-install-${target}`];
  if (policy.platform === "windows") result.push("windows-authenticode");
  if (policy.platform === "linux") result.push("linux-package-signing");
  if (policy.requiresEsuEvidence) result.push("windows-10-esu");
  return result;
}

export function verifyPromotionEvidence(evidence, descriptor, now = new Date()) {
  exactKeys(evidence, new Set([
    "formatVersion", "product", "releaseVersion", "platformTarget", "sourceCommit", "gates",
  ]), "promotion evidence");
  assert(evidence.formatVersion === 1, "formatVersion is unsupported");
  assert(evidence.product === "BMS Retail Local", "product is invalid");
  assert(typeof evidence.releaseVersion === "string" && VERSION.test(evidence.releaseVersion), "releaseVersion is invalid");
  assert(typeof evidence.platformTarget === "string" && ID.test(evidence.platformTarget), "platformTarget is invalid");
  assert(typeof evidence.sourceCommit === "string" && COMMIT.test(evidence.sourceCommit), "sourceCommit is invalid");
  assert(evidence.releaseVersion === descriptor.releaseVersion, "releaseVersion does not match the descriptor");
  assert(evidence.platformTarget === descriptor.platformTarget, "platformTarget does not match the descriptor");
  assert(evidence.sourceCommit === descriptor.sourceCommit, "sourceCommit does not match the descriptor");
  assert(Array.isArray(evidence.gates), "gates must be an array");

  const currentTime = now.getTime();
  assert(Number.isFinite(currentTime), "Evidence verification time is invalid");
  const gates = new Map();
  for (const [index, gate] of evidence.gates.entries()) {
    exactKeys(gate, new Set(["id", "status", "verifiedAt", "validUntil", "evidence"]), `gates[${index}]`);
    assert(typeof gate.id === "string" && ID.test(gate.id), `gates[${index}].id is invalid`);
    assert(!gates.has(gate.id), `Duplicate gate: ${gate.id}`);
    assert(gate.status === "passed", `gate ${gate.id} has not passed`);
    const verifiedAt = Date.parse(gate.verifiedAt);
    const validUntil = Date.parse(gate.validUntil);
    assert(Number.isFinite(verifiedAt) && verifiedAt <= currentTime + 5 * 60_000, `gate ${gate.id} verifiedAt is invalid`);
    assert(Number.isFinite(validUntil) && validUntil > currentTime && validUntil > verifiedAt, `gate ${gate.id} has expired`);
    assert(Array.isArray(gate.evidence) && gate.evidence.length > 0, `gate ${gate.id} has no evidence`);
    for (const url of gate.evidence) assert(typeof url === "string" && validEvidenceUrl(url), `gate ${gate.id} evidence URL is unsafe`);
    gates.set(gate.id, gate);
  }
  for (const gate of [...REQUIRED_COMMON_GATES, ...platformGates(evidence.platformTarget)]) {
    assert(gates.has(gate), `Missing required gate: ${gate}`);
  }
  return { ok: true, releaseVersion: evidence.releaseVersion, platformTarget: evidence.platformTarget, gates: [...gates.keys()] };
}

async function main(argv) {
  const [evidencePath, descriptorPath] = argv;
  if (!evidencePath || !descriptorPath) {
    throw new Error("usage: node verify-promotion-evidence.mjs promotion-evidence.json release-descriptor.json");
  }
  const [evidence, descriptor] = await Promise.all([
    readFile(evidencePath, "utf8").then(JSON.parse),
    readFile(descriptorPath, "utf8").then(JSON.parse),
  ]);
  process.stdout.write(JSON.stringify(verifyPromotionEvidence(evidence, descriptor)) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
