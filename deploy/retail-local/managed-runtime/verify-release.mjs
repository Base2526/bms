#!/usr/bin/env node

import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_ENVELOPE_BYTES = 1024 * 1024;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9.-]+)?$/;
const TARGET = /^[a-z0-9._-]{1,80}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMPONENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REQUIRED_COMPONENTS = new Set(["web", "ws", "postgres", "redis", "runtime", "compose", "desktop"]);
const REQUIRED_KINDS = new Map([
  ["web", "oci-image"], ["ws", "oci-image"], ["postgres", "oci-image"], ["redis", "oci-image"],
  ["runtime", "runtime"], ["compose", "support-file"], ["desktop", "desktop"],
]);
const COMPONENT_KINDS = new Set(["oci-image", "runtime", "desktop", "support-file"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} ต้องเป็น object`);
  return value;
}

function exactKeys(value, allowed, name) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  assert(extra.length === 0, `${name} มี field ที่ไม่รองรับ: ${extra.join(", ")}`);
}

function decodeBase64url(value, name) {
  assert(typeof value === "string" && BASE64URL.test(value), `${name} ไม่ใช่ base64url แบบไม่มี padding`);
  const decoded = Buffer.from(value, "base64url");
  assert(decoded.toString("base64url") === value, `${name} ไม่ใช่ canonical base64url`);
  return decoded;
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${name} ไม่ใช่ UTF-8 JSON ที่อ่านได้`);
  }
}

function validateHeader(input, expectedKeyId) {
  const header = object(input, "protected header");
  exactKeys(header, new Set(["alg", "kid", "typ"]), "protected header");
  assert(header.alg === "EdDSA", "release ต้องใช้ alg=EdDSA");
  assert(header.typ === "application/vnd.bms.retail-local.release+json", "release typ ไม่ถูกต้อง");
  assert(typeof header.kid === "string" && VERSION.test(header.kid), "release key id ไม่ถูกต้อง");
  if (expectedKeyId) assert(header.kid === expectedKeyId, `release ใช้ key id ที่ไม่คาดไว้: ${header.kid}`);
  return header;
}

function validateComponent(input, index) {
  const component = object(input, `components[${index}]`);
  exactKeys(component, new Set(["name", "kind", "url", "sha256", "ociDigest", "imageRef", "sizeBytes"]), `components[${index}]`);
  assert(typeof component.name === "string" && COMPONENT_NAME.test(component.name), `components[${index}].name ไม่ถูกต้อง`);
  assert(COMPONENT_KINDS.has(component.kind), `components[${index}].kind ไม่ถูกต้อง`);
  assert(typeof component.url === "string" && component.url.startsWith("https://"), `components[${index}].url ต้องเป็น HTTPS`);
  assert(typeof component.sha256 === "string" && HEX_64.test(component.sha256), `components[${index}].sha256 ไม่ถูกต้อง`);
  assert(Number.isSafeInteger(component.sizeBytes) && component.sizeBytes > 0, `components[${index}].sizeBytes ไม่ถูกต้อง`);
  if (component.kind === "oci-image") {
    assert(typeof component.ociDigest === "string" && OCI_DIGEST.test(component.ociDigest), `components[${index}] ขาด immutable OCI digest`);
    assert(typeof component.imageRef === "string" && /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/.test(component.imageRef), `components[${index}] ขาด imageRef`);
  }
  return component;
}

function validatePayload(input, expectedTarget) {
  const payload = object(input, "release payload");
  exactKeys(payload, new Set([
    "product", "releaseVersion", "channel", "platformTarget", "minimumAgentVersion",
    "schemaVersion", "rollbackSafe", "createdAt", "sourceCommit", "components",
  ]), "release payload");
  assert(payload.product === "BMS Retail Local", "release product ไม่ถูกต้อง");
  assert(typeof payload.releaseVersion === "string" && SEMVER.test(payload.releaseVersion), "releaseVersion ไม่ถูกต้อง");
  assert(payload.channel === "pilot" || payload.channel === "stable", "release channel ไม่ถูกต้อง");
  assert(typeof payload.platformTarget === "string" && TARGET.test(payload.platformTarget), "platformTarget ไม่ถูกต้อง");
  if (expectedTarget) assert(payload.platformTarget === expectedTarget, `release target ไม่ตรงกับเครื่อง: ${payload.platformTarget}`);
  assert(typeof payload.minimumAgentVersion === "string" && VERSION.test(payload.minimumAgentVersion), "minimumAgentVersion ไม่ถูกต้อง");
  assert(typeof payload.schemaVersion === "string" && payload.schemaVersion.length > 0 && payload.schemaVersion.length <= 64, "schemaVersion ไม่ถูกต้อง");
  assert(typeof payload.rollbackSafe === "boolean", "rollbackSafe ต้องระบุชัดเจน");
  assert(typeof payload.createdAt === "string" && Number.isFinite(Date.parse(payload.createdAt)), "createdAt ไม่ถูกต้อง");
  assert(typeof payload.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(payload.sourceCommit), "sourceCommit ไม่ถูกต้อง");
  assert(Array.isArray(payload.components) && payload.components.length >= 7, "release components ไม่ครบ");
  const components = payload.components.map(validateComponent);
  const names = new Set(components.map((component) => component.name));
  assert(names.size === components.length, "release มี component name ซ้ำ");
  for (const name of REQUIRED_COMPONENTS) {
    assert(names.has(name), `release ขาด component ${name}`);
    assert(components.find((component) => component.name === name)?.kind === REQUIRED_KINDS.get(name),
      `component ${name} ใช้ kind ไม่ถูกต้อง`);
  }
  return payload;
}

export function verifyReleaseEnvelope(envelopeBytes, publicKeyPem, options = {}) {
  assert(Buffer.isBuffer(envelopeBytes), "release envelope ต้องเป็น Buffer");
  assert(envelopeBytes.length > 0 && envelopeBytes.length <= MAX_ENVELOPE_BYTES, "release envelope มีขนาดไม่ถูกต้อง");
  const envelope = object(parseJson(envelopeBytes, "release envelope"), "release envelope");
  exactKeys(envelope, new Set(["formatVersion", "protected", "payload", "signature"]), "release envelope");
  assert(envelope.formatVersion === 1, "release envelope version ไม่รองรับ");

  const protectedBytes = decodeBase64url(envelope.protected, "protected");
  const payloadBytes = decodeBase64url(envelope.payload, "payload");
  const signature = decodeBase64url(envelope.signature, "signature");
  assert(signature.length === 64, "Ed25519 signature ต้องยาว 64 bytes");
  const header = validateHeader(parseJson(protectedBytes, "protected header"), options.expectedKeyId);

  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("release public key อ่านไม่ได้");
  }
  assert(key.asymmetricKeyType === "ed25519", "release public key ต้องเป็น Ed25519");
  const signingInput = Buffer.from(`${envelope.protected}.${envelope.payload}`, "ascii");
  assert(verify(null, signingInput, key, signature), "release signature ไม่ถูกต้อง");

  // Component locations are interpreted only after publisher authentication succeeds.
  const payload = validatePayload(parseJson(payloadBytes, "release payload"), options.expectedTarget);
  return { header, payload };
}

function usage() {
  console.error("usage: node verify-release.mjs --manifest FILE --public-key FILE [--key-id ID] [--target TARGET]");
}

async function main(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      usage();
      process.exitCode = 2;
      return;
    }
    values.set(name, value);
  }
  const manifestPath = values.get("--manifest");
  const publicKeyPath = values.get("--public-key");
  if (!manifestPath || !publicKeyPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  const [manifest, publicKey] = await Promise.all([readFile(manifestPath), readFile(publicKeyPath, "utf8")]);
  const verified = verifyReleaseEnvelope(manifest, publicKey, {
    expectedKeyId: values.get("--key-id"),
    expectedTarget: values.get("--target"),
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    keyId: verified.header.kid,
    releaseVersion: verified.payload.releaseVersion,
    platformTarget: verified.payload.platformTarget,
    components: verified.payload.components.map((component) => component.name),
  }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
