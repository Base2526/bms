import { createPublicKey, verify } from "crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";

import {
  MANAGED_RUNTIME_PUBLIC_METADATA_FILES,
  MANAGED_RUNTIME_REQUIRED_COMPONENTS,
  MANAGED_RUNTIME_TARGETS,
  managedRuntimeSignedTarget,
  type ManagedRuntimeTarget,
} from "./managedRuntimeReleaseContract";

export { MANAGED_RUNTIME_TARGETS, type ManagedRuntimeTarget } from "./managedRuntimeReleaseContract";

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9.-]+)?$/;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMPONENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REQUIRED_COMPONENTS = new Map(Object.entries(MANAGED_RUNTIME_REQUIRED_COMPONENTS));
const COMPONENT_KINDS = new Set(["oci-image", "runtime", "desktop", "support-file"]);
const AUXILIARY_FILES = new Set<string>(MANAGED_RUNTIME_PUBLIC_METADATA_FILES);

const TARGETS = new Set<string>(MANAGED_RUNTIME_TARGETS);
const PUBLISH_LOCK_STALE_MS = 10 * 60 * 1000;

export type UploadedRuntimeFile = {
  filename: string;
  fullPath: string;
  size: number;
  sha256: string;
};

type VerifiedComponent = {
  name: string;
  kind: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

type VerifiedRelease = {
  keyId: string;
  releaseVersion: string;
  channel: "pilot" | "stable";
  platformTarget: string;
  minimumAgentVersion: string;
  schemaVersion: string;
  rollbackSafe: boolean;
  sourceCommit: string;
  createdAt: string;
  components: VerifiedComponent[];
};

export type ManagedRuntimeReleaseSummary = {
  releaseVersion: string;
  platformTarget: string;
  manifestUrl: string;
  managed: boolean;
  channel: string | null;
  keyId: string | null;
  componentCount: number;
  totalBytes: number;
  publishedAt: string | null;
};

export class ManagedRuntimeReleaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ManagedRuntimeReleaseError";
  }
}

async function acquirePublishLock(publishLock: string): Promise<void> {
  try {
    await mkdir(publishLock, { recursive: false, mode: 0o700 });
    return;
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }

  let lockStat;
  try {
    lockStat = await stat(publishLock);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      await mkdir(publishLock, { recursive: false, mode: 0o700 });
      return;
    }
    throw error;
  }
  if (Date.now() - lockStat.mtimeMs <= PUBLISH_LOCK_STALE_MS) {
    throw new ManagedRuntimeReleaseError("release version/target นี้กำลัง publish อยู่", 409);
  }

  // The critical publish section only performs a local stat/chmod/rename. A lock
  // older than ten minutes is therefore crash residue, not a live upload.
  const recoveryLock = `${publishLock}.recovery`;
  try {
    await mkdir(recoveryLock, { recursive: false, mode: 0o700 });
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      throw new ManagedRuntimeReleaseError("release version/target นี้กำลัง recover publish lock", 409);
    }
    throw error;
  }
  try {
    const current = await stat(publishLock).catch((error: any) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (current && Date.now() - current.mtimeMs <= PUBLISH_LOCK_STALE_MS) {
      throw new ManagedRuntimeReleaseError("release version/target นี้กำลัง publish อยู่", 409);
    }
    if (current) await rm(publishLock, { recursive: true, force: true });
    try {
      await mkdir(publishLock, { recursive: false, mode: 0o700 });
    } catch (error: any) {
      if (error?.code === "EEXIST") {
        throw new ManagedRuntimeReleaseError("release version/target นี้กำลัง publish อยู่", 409);
      }
      throw error;
    }
  } finally {
    await rm(recoveryLock, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function managedRuntimeReleaseRoot(): string {
  const resolved = path.resolve(process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT || "/app/releases");
  if (resolved === path.parse(resolved).root) {
    throw new ManagedRuntimeReleaseError("BMS_RETAIL_LOCAL_RELEASE_ROOT ห้ามเป็น filesystem root", 503);
  }
  return resolved;
}

export function managedRuntimeReleaseBaseUrl(): string {
  const raw = (process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL
    || "https://releases.jachoei.com/retail-local").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ManagedRuntimeReleaseError("BMS_RETAIL_LOCAL_RELEASE_BASE_URL ไม่ถูกต้อง", 503);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ManagedRuntimeReleaseError("release base URL ต้องเป็น HTTPS URL ที่ไม่มี credential/query/fragment", 503);
  }
  return raw;
}

export function assertManagedRuntimeVersion(value: string): string {
  const version = String(value || "").trim();
  if (!SEMVER.test(version)) throw new ManagedRuntimeReleaseError("version ต้องเป็น semantic version แบบระบุเลขจริง");
  return version;
}

export function assertManagedRuntimeTarget(value: string): ManagedRuntimeTarget {
  const target = String(value || "").trim();
  if (!TARGETS.has(target)) throw new ManagedRuntimeReleaseError("platform target ไม่รองรับ Managed Runtime");
  return target as ManagedRuntimeTarget;
}

export function assertManagedRuntimeUploadFilename(value: string): string {
  const raw = String(value || "");
  const normalized = raw.replace(/\\/g, "/");
  const filename = path.posix.basename(normalized);
  if (normalized !== filename) throw new ManagedRuntimeReleaseError("ชื่อไฟล์ release ไม่ถูกต้อง");
  if (AUXILIARY_FILES.has(filename) || /^[a-z0-9][a-z0-9._-]{0,63}\.artifact$/.test(filename)) return filename;
  throw new ManagedRuntimeReleaseError(`ไฟล์ ${filename || "(ไม่มีชื่อ)"} ไม่อยู่ใน release contract`);
}

function exactObject(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManagedRuntimeReleaseError(`${name} ต้องเป็น object`);
  }
  return value as Record<string, any>;
}

function assertExactKeys(value: Record<string, any>, allowed: string[], name: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length) throw new ManagedRuntimeReleaseError(`${name} มี field ที่ไม่รองรับ: ${extra.join(", ")}`);
}

function decodePart(value: unknown, name: string): Buffer {
  if (typeof value !== "string" || !BASE64URL.test(value)) {
    throw new ManagedRuntimeReleaseError(`${name} ไม่ใช่ canonical base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new ManagedRuntimeReleaseError(`${name} ไม่ใช่ canonical base64url`);
  return decoded;
}

function parseJson(bytes: Buffer, name: string): any {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ManagedRuntimeReleaseError(`${name} ไม่ใช่ UTF-8 JSON ที่อ่านได้`);
  }
}

function configuredKeyring(): Record<string, string> {
  const raw = (process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON || "").trim();
  if (!raw) throw new ManagedRuntimeReleaseError("ยังไม่ได้ตั้ง BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON", 503);
  const keyring = exactObject(parseJson(Buffer.from(raw), "trusted release keyring"), "trusted release keyring");
  assertExactKeys(keyring, ["formatVersion", "keys"], "trusted release keyring");
  const keys = exactObject(keyring.keys, "trusted release keyring.keys");
  if (keyring.formatVersion !== 1 || !Object.keys(keys).length) {
    throw new ManagedRuntimeReleaseError("trusted release keyring ต้องเป็น formatVersion 1 และมี public key", 503);
  }
  if (Object.entries(keys).some(([keyId, key]) => !VERSION_ID.test(keyId)
    || typeof key !== "string" || !key.includes("BEGIN PUBLIC KEY") || key.includes("PRIVATE KEY"))) {
    throw new ManagedRuntimeReleaseError("trusted release keyring ต้องมีเฉพาะ PEM public key", 503);
  }
  return keys as Record<string, string>;
}

export function verifyManagedRuntimeManifest(
  envelopeBytes: Buffer,
  expectedVersion: string,
  expectedTarget: ManagedRuntimeTarget,
): VerifiedRelease {
  if (!envelopeBytes.length || envelopeBytes.length > 1024 * 1024) {
    throw new ManagedRuntimeReleaseError("release.jws.json มีขนาดไม่ถูกต้อง");
  }
  const envelope = exactObject(parseJson(envelopeBytes, "release.jws.json"), "release envelope");
  assertExactKeys(envelope, ["formatVersion", "protected", "payload", "signature"], "release envelope");
  if (envelope.formatVersion !== 1) throw new ManagedRuntimeReleaseError("release envelope version ไม่รองรับ");
  const protectedBytes = decodePart(envelope.protected, "protected");
  const payloadBytes = decodePart(envelope.payload, "payload");
  const signature = decodePart(envelope.signature, "signature");
  if (signature.length !== 64) throw new ManagedRuntimeReleaseError("Ed25519 signature มีขนาดไม่ถูกต้อง");

  const header = exactObject(parseJson(protectedBytes, "protected header"), "protected header");
  assertExactKeys(header, ["alg", "kid", "typ"], "protected header");
  if (header.alg !== "EdDSA" || header.typ !== "application/vnd.bms.retail-local.release+json"
    || typeof header.kid !== "string" || !VERSION_ID.test(header.kid)) {
    throw new ManagedRuntimeReleaseError("release protected header ไม่ถูกต้อง");
  }
  const publicKeyPem = configuredKeyring()[header.kid];
  if (!publicKeyPem) throw new ManagedRuntimeReleaseError(`release ใช้ key id ที่ไม่อยู่ใน trusted keyring: ${header.kid}`);
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new ManagedRuntimeReleaseError("trusted release public key อ่านไม่ได้", 503);
  }
  if (publicKey.asymmetricKeyType !== "ed25519"
    || !verify(null, Buffer.from(`${envelope.protected}.${envelope.payload}`, "ascii"), publicKey, signature)) {
    throw new ManagedRuntimeReleaseError("release signature ไม่ถูกต้อง");
  }

  const payload = exactObject(parseJson(payloadBytes, "release payload"), "release payload");
  assertExactKeys(payload, [
    "product", "releaseVersion", "channel", "platformTarget", "minimumAgentVersion",
    "schemaVersion", "rollbackSafe", "createdAt", "sourceCommit", "components",
  ], "release payload");
  if (payload.product !== "BMS Retail Local") throw new ManagedRuntimeReleaseError("release product ไม่ถูกต้อง");
  if (payload.releaseVersion !== expectedVersion) throw new ManagedRuntimeReleaseError("version ใน manifest ไม่ตรงกับ version ที่เลือก");
  const expectedSignedTarget = managedRuntimeSignedTarget(expectedTarget);
  if (payload.platformTarget !== expectedSignedTarget) throw new ManagedRuntimeReleaseError("target ใน manifest ไม่ตรงกับ target ที่เลือก");
  if (payload.channel !== "pilot" && payload.channel !== "stable") throw new ManagedRuntimeReleaseError("release channel ไม่ถูกต้อง");
  if (typeof payload.minimumAgentVersion !== "string" || !VERSION_ID.test(payload.minimumAgentVersion)) {
    throw new ManagedRuntimeReleaseError("minimumAgentVersion ไม่ถูกต้อง");
  }
  if (typeof payload.schemaVersion !== "string" || !payload.schemaVersion.length || payload.schemaVersion.length > 64) {
    throw new ManagedRuntimeReleaseError("schemaVersion ไม่ถูกต้อง");
  }
  if (typeof payload.rollbackSafe !== "boolean") throw new ManagedRuntimeReleaseError("rollbackSafe ต้องระบุชัดเจน");
  if (typeof payload.createdAt !== "string" || !Number.isFinite(Date.parse(payload.createdAt))) {
    throw new ManagedRuntimeReleaseError("createdAt ไม่ถูกต้อง");
  }
  if (typeof payload.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(payload.sourceCommit)) {
    throw new ManagedRuntimeReleaseError("sourceCommit ไม่ถูกต้อง");
  }
  if (!Array.isArray(payload.components)) throw new ManagedRuntimeReleaseError("release components ไม่ถูกต้อง");

  const names = new Set<string>();
  const expectedBase = `${managedRuntimeReleaseBaseUrl()}/${expectedVersion}/${expectedTarget}`;
  const components = payload.components.map((raw: unknown, index: number): VerifiedComponent => {
    const component = exactObject(raw, `components[${index}]`);
    assertExactKeys(component, ["name", "kind", "url", "sha256", "ociDigest", "imageRef", "sizeBytes"], `components[${index}]`);
    if (typeof component.name !== "string" || !COMPONENT_NAME.test(component.name) || names.has(component.name)) {
      throw new ManagedRuntimeReleaseError(`components[${index}].name ไม่ถูกต้องหรือซ้ำ`);
    }
    names.add(component.name);
    if (typeof component.kind !== "string" || !COMPONENT_KINDS.has(component.kind) || typeof component.url !== "string"
      || typeof component.sha256 !== "string" || !HEX_64.test(component.sha256)
      || !Number.isSafeInteger(component.sizeBytes) || component.sizeBytes <= 0) {
      throw new ManagedRuntimeReleaseError(`component ${component.name} metadata ไม่ถูกต้อง`);
    }
    if (component.kind === "oci-image"
      && (typeof component.ociDigest !== "string" || !OCI_DIGEST.test(component.ociDigest)
        || typeof component.imageRef !== "string"
        || !/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/.test(component.imageRef))) {
      throw new ManagedRuntimeReleaseError(`component ${component.name} ขาด immutable OCI metadata`);
    }
    if (component.url !== `${expectedBase}/${component.name}.artifact`) {
      throw new ManagedRuntimeReleaseError(`component ${component.name} URL ไม่ตรงกับ release host ที่ตั้งไว้`);
    }
    return {
      name: component.name,
      kind: component.kind,
      url: component.url,
      sha256: component.sha256,
      sizeBytes: component.sizeBytes,
    };
  });
  for (const [required, expectedKind] of REQUIRED_COMPONENTS) {
    const component = components.find((candidate) => candidate.name === required);
    if (!component) throw new ManagedRuntimeReleaseError(`release ขาด component ${required}`);
    if (component.kind !== expectedKind) throw new ManagedRuntimeReleaseError(`component ${required} ใช้ kind ไม่ถูกต้อง`);
  }

  return {
    keyId: header.kid,
    releaseVersion: payload.releaseVersion,
    channel: payload.channel,
    platformTarget: payload.platformTarget,
    minimumAgentVersion: payload.minimumAgentVersion,
    schemaVersion: payload.schemaVersion,
    rollbackSafe: payload.rollbackSafe,
    sourceCommit: payload.sourceCommit,
    createdAt: payload.createdAt,
    components,
  };
}

function parseChecksumFile(bytes: Buffer): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of bytes.toString("utf8").split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const match = rawLine.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/);
    if (!match) throw new ManagedRuntimeReleaseError("SHA256SUMS มีบรรทัดที่ไม่ถูกต้อง");
    const filename = path.posix.basename(match[2].replace(/\\/g, "/"));
    assertManagedRuntimeUploadFilename(filename);
    if (filename === "SHA256SUMS") throw new ManagedRuntimeReleaseError("SHA256SUMS ต้องไม่ checksum ตัวเอง");
    if (result.has(filename)) throw new ManagedRuntimeReleaseError(`SHA256SUMS มีชื่อซ้ำ: ${filename}`);
    result.set(filename, match[1]);
  }
  return result;
}

export async function publishManagedRuntimeRelease(input: {
  stagingDirectory: string;
  files: UploadedRuntimeFile[];
  releaseVersion: string;
  platformTarget: string;
}): Promise<ManagedRuntimeReleaseSummary> {
  const releaseVersion = assertManagedRuntimeVersion(input.releaseVersion);
  const platformTarget = assertManagedRuntimeTarget(input.platformTarget);
  const files = new Map(input.files.map((file) => [file.filename, file]));
  if (files.size !== input.files.length) throw new ManagedRuntimeReleaseError("release มีชื่อไฟล์ซ้ำ");
  const manifestFile = files.get("release.jws.json");
  const sumsFile = files.get("SHA256SUMS");
  if (!manifestFile || !sumsFile) throw new ManagedRuntimeReleaseError("release ต้องมี release.jws.json และ SHA256SUMS");

  const manifestBytes = await readFile(manifestFile.fullPath);
  const verified = verifyManagedRuntimeManifest(manifestBytes, releaseVersion, platformTarget);
  for (const component of verified.components) {
    const uploaded = files.get(`${component.name}.artifact`);
    if (!uploaded) throw new ManagedRuntimeReleaseError(`release ขาดไฟล์ ${component.name}.artifact`);
    if (uploaded.size !== component.sizeBytes || uploaded.sha256 !== component.sha256) {
      throw new ManagedRuntimeReleaseError(`${component.name}.artifact ไม่ตรงกับ size/hash ใน signed manifest`);
    }
  }
  const signedArtifactNames = new Set(verified.components.map((component) => `${component.name}.artifact`));
  for (const filename of files.keys()) {
    if (filename.endsWith(".artifact") && !signedArtifactNames.has(filename)) {
      throw new ManagedRuntimeReleaseError(`${filename} ไม่ได้อยู่ใน signed manifest`);
    }
  }

  const sums = parseChecksumFile(await readFile(sumsFile.fullPath));
  for (const [filename, checksum] of sums) {
    const uploaded = files.get(filename);
    if (!uploaded || uploaded.sha256 !== checksum) throw new ManagedRuntimeReleaseError(`${filename} ไม่ตรงกับ SHA256SUMS`);
  }
  for (const component of verified.components) {
    if (!sums.has(`${component.name}.artifact`)) throw new ManagedRuntimeReleaseError(`SHA256SUMS ขาด ${component.name}.artifact`);
  }
  if (!sums.has("release.jws.json")) throw new ManagedRuntimeReleaseError("SHA256SUMS ขาด release.jws.json");

  const marker = {
    formatVersion: 1,
    releaseVersion,
    platformTarget,
    channel: verified.channel,
    keyId: verified.keyId,
    schemaVersion: verified.schemaVersion,
    minimumAgentVersion: verified.minimumAgentVersion,
    sourceCommit: verified.sourceCommit,
    componentCount: verified.components.length,
    totalBytes: verified.components.reduce((sum, component) => sum + component.sizeBytes, 0),
    publishedAt: new Date().toISOString(),
  };
  await writeFile(path.join(input.stagingDirectory, ".bms-published.json"), `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  for (const file of input.files) await chmod(file.fullPath, 0o644);
  await chmod(path.join(input.stagingDirectory, ".bms-published.json"), 0o600);

  const root = managedRuntimeReleaseRoot();
  const parent = path.join(root, "retail-local", releaseVersion);
  const destination = path.join(parent, platformTarget);
  await mkdir(parent, { recursive: true, mode: 0o755 });
  try {
    await stat(destination);
    throw new ManagedRuntimeReleaseError("release version/target นี้มีอยู่แล้วและเป็น immutable", 409);
  } catch (error: any) {
    if (error instanceof ManagedRuntimeReleaseError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const publishLock = `${destination}.publishing`;
  await acquirePublishLock(publishLock);
  try {
    try {
      await stat(destination);
      throw new ManagedRuntimeReleaseError("release version/target นี้มีอยู่แล้วและเป็น immutable", 409);
    } catch (error: any) {
      if (error instanceof ManagedRuntimeReleaseError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    await chmod(input.stagingDirectory, 0o755);
    await rename(input.stagingDirectory, destination);
  } finally {
    await rm(publishLock, { recursive: true, force: true }).catch(() => undefined);
  }
  return {
    releaseVersion,
    platformTarget,
    manifestUrl: `${managedRuntimeReleaseBaseUrl()}/${releaseVersion}/${platformTarget}/release.jws.json`,
    managed: true,
    channel: marker.channel,
    keyId: marker.keyId,
    componentCount: marker.componentCount,
    totalBytes: marker.totalBytes,
    publishedAt: marker.publishedAt,
  };
}

export async function listManagedRuntimeReleases(): Promise<ManagedRuntimeReleaseSummary[]> {
  const root = path.join(managedRuntimeReleaseRoot(), "retail-local");
  const result: ManagedRuntimeReleaseSummary[] = [];
  let versions: string[] = [];
  try {
    versions = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SEMVER.test(entry.name))
      .map((entry) => entry.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  for (const releaseVersion of versions.slice(0, 200)) {
    const versionRoot = path.join(root, releaseVersion);
    const targets = (await readdir(versionRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && TARGETS.has(entry.name));
    for (const target of targets) {
      const releaseRoot = path.join(versionRoot, target.name);
      let marker: any = null;
      try {
        marker = JSON.parse(await readFile(path.join(releaseRoot, ".bms-published.json"), "utf8"));
      } catch {
        marker = null;
      }
      let totalBytes = 0;
      let componentCount = 0;
      for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".artifact")) continue;
        componentCount += 1;
        totalBytes += Number((await stat(path.join(releaseRoot, entry.name))).size);
      }
      result.push({
        releaseVersion,
        platformTarget: target.name,
        manifestUrl: `${managedRuntimeReleaseBaseUrl()}/${releaseVersion}/${target.name}/release.jws.json`,
        managed: marker?.formatVersion === 1,
        channel: typeof marker?.channel === "string" ? marker.channel : null,
        keyId: typeof marker?.keyId === "string" ? marker.keyId : null,
        componentCount,
        totalBytes,
        publishedAt: typeof marker?.publishedAt === "string" ? marker.publishedAt : null,
      });
    }
  }
  return result.sort((a, b) => b.releaseVersion.localeCompare(a.releaseVersion, undefined, { numeric: true })
    || a.platformTarget.localeCompare(b.platformTarget));
}

