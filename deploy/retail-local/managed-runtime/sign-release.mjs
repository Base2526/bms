#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(`sign-release: ${message}`);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function componentFromDescriptor(component) {
  const { name, kind, path, url, imageRef, ociDigest } = component ?? {};
  if (![name, kind, path, url].every((value) => typeof value === "string" && value.length > 0)) {
    fail("component descriptor ต้องมี name, kind, path และ url");
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    fail(`component ${name} ต้องใช้ HTTPS URL ที่ไม่มี credential/fragment`);
  }
  const bytes = await readFile(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1) fail(`component ${name} ไม่ใช่ไฟล์`);
  const result = {
    name,
    kind,
    url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: metadata.size,
  };
  if (kind === "oci-image") {
    if (typeof imageRef !== "string" || typeof ociDigest !== "string") {
      fail(`OCI component ${name} ต้องมี imageRef และ ociDigest`);
    }
    result.imageRef = imageRef;
    result.ociDigest = ociDigest;
  }
  return result;
}

export async function createSignedRelease(descriptor, privateKeyPem) {
  const allowed = new Set([
    "releaseVersion", "channel", "platformTarget", "minimumAgentVersion", "schemaVersion",
    "rollbackSafe", "createdAt", "sourceCommit", "keyId", "components",
  ]);
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) fail("descriptor ไม่ถูกต้อง");
  for (const key of Object.keys(descriptor)) if (!allowed.has(key)) fail(`descriptor field ไม่รู้จัก: ${key}`);
  if (!Array.isArray(descriptor.components)) fail("components ต้องเป็น array");
  const components = [];
  for (const component of descriptor.components) components.push(await componentFromDescriptor(component));
  const requiredKinds = new Map([
    ["web", "oci-image"], ["ws", "oci-image"], ["postgres", "oci-image"], ["redis", "oci-image"],
    ["runtime", "runtime"], ["compose", "support-file"], ["desktop", "desktop"],
  ]);
  const seen = new Set();
  for (const component of components) {
    if (seen.has(component.name)) fail(`component name ซ้ำ: ${component.name}`);
    seen.add(component.name);
  }
  for (const [name, kind] of requiredKinds) {
    if (components.find((component) => component.name === name)?.kind !== kind) {
      fail(`component ${name} ต้องมี kind ${kind}`);
    }
  }
  const payload = {
    product: "BMS Retail Local",
    releaseVersion: descriptor.releaseVersion,
    channel: descriptor.channel,
    platformTarget: descriptor.platformTarget,
    minimumAgentVersion: descriptor.minimumAgentVersion,
    schemaVersion: descriptor.schemaVersion,
    rollbackSafe: descriptor.rollbackSafe,
    createdAt: descriptor.createdAt,
    sourceCommit: descriptor.sourceCommit,
    components,
  };
  const header = {
    alg: "EdDSA",
    kid: descriptor.keyId,
    typ: "application/vnd.bms.retail-local.release+json",
  };
  const protectedValue = base64url(JSON.stringify(header));
  const payloadValue = base64url(JSON.stringify(payload));
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") fail("private key ต้องเป็น Ed25519");
  const signature = sign(null, Buffer.from(`${protectedValue}.${payloadValue}`, "ascii"), privateKey).toString("base64url");
  return Buffer.from(JSON.stringify({ formatVersion: 1, protected: protectedValue, payload: payloadValue, signature }) + "\n");
}

async function main() {
  const [descriptorPath, privateKeyPath, outputPath] = process.argv.slice(2);
  if (!descriptorPath || !privateKeyPath || !outputPath) {
    fail("usage: node sign-release.mjs descriptor.json private-key.pem release.jws.json");
  }
  if (process.env.CI !== "true" && process.env.BMS_ALLOW_LOCAL_RELEASE_SIGNING !== "1") {
    fail("local signing ถูกปิด; ใช้ isolated signing job หรือกำหนด BMS_ALLOW_LOCAL_RELEASE_SIGNING=1 โดยตั้งใจ")
  }
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  const privateKeyPem = await readFile(privateKeyPath, "utf8");
  const envelope = await createSignedRelease(descriptor, privateKeyPem);
  await writeFile(outputPath, envelope, { mode: 0o600, flag: "wx" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
