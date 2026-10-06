import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";

import {
  assertManagedRuntimeUploadFilename,
  listManagedRuntimeReleases,
  MANAGED_RUNTIME_TARGETS,
  publishManagedRuntimeRelease,
  verifyManagedRuntimeManifest,
  type ManagedRuntimeTarget,
  type UploadedRuntimeFile,
} from "../apps/web/lib/bms/managedRuntimeReleases.ts";
import { parseAndPublishManagedRuntimeRelease } from "../apps/web/lib/bms/managedRuntimeReleaseUpload.ts";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("upload targets stay aligned with the Managed Runtime support matrix", async () => {
  const matrix = JSON.parse(await readFile(new URL("../deploy/retail-local/managed-runtime/support-matrix.json", import.meta.url), "utf8"));
  assert.deepEqual(MANAGED_RUNTIME_TARGETS.slice(0, -1), matrix.targets.map((target: { id: string }) => target.id));
  assert.equal(MANAGED_RUNTIME_TARGETS.at(-1), "windows-10-x86", "the x86 value is a public POS-only folder alias");
});

test("build-only metadata and signing keys can never enter the public release tree", () => {
  for (const filename of ["release-descriptor.json", "promotion-evidence.json", "private-key.pem"]) {
    assert.throws(() => assertManagedRuntimeUploadFilename(filename), /ไม่อยู่ใน release contract/);
  }
});

test("oversized manifest metadata is rejected and its staging directory is removed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-large-manifest-"));
  const previousRoot = process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
  const boundary = "bms-runtime-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="releaseVersion"\r\n\r\n0.2.14-pilot.2\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="platformTarget"\r\n\r\nmacos-15-x64\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="release.jws.json"\r\n`
    + "Content-Type: application/json\r\n\r\n",
  );
  const body = Buffer.concat([
    prefix,
    Buffer.alloc(1024 * 1024 + 1, 0x61),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = root;
    await assert.rejects(
      parseAndPublishManagedRuntimeRelease(Readable.from([body]), {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(body.length),
      }),
      /release\.jws\.json ใหญ่เกิน/,
    );
    assert.deepEqual(await readdir(path.join(root, ".incoming")), []);
  } finally {
    if (previousRoot === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("an idle multipart upload times out and removes partial staging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-idle-upload-"));
  const previousRoot = process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
  const previousTimeout = process.env.BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS;
  const source = new PassThrough();
  try {
    process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = root;
    process.env.BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS = "1000";
    await assert.rejects(
      parseAndPublishManagedRuntimeRelease(source, {
        "content-type": "multipart/form-data; boundary=bms-idle-boundary",
      }),
      /ไม่มีข้อมูลนานเกินกำหนด/,
    );
    assert.deepEqual(await readdir(path.join(root, ".incoming")), []);
  } finally {
    source.destroy();
    if (previousRoot === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previousRoot;
    if (previousTimeout === undefined) delete process.env.BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS;
    else process.env.BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS = previousTimeout;
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(
  root: string,
  target: ManagedRuntimeTarget = "macos-15-x64",
  signedTarget: string = target,
) {
  const version = "0.2.14-pilot.2";
  const baseUrl = "https://releases.jachoei.com/retail-local";
  const keyId = "test-release-key";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = root;
  process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = baseUrl;
  process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = JSON.stringify({
    formatVersion: 1,
    keys: { [keyId]: publicKey.export({ type: "spki", format: "pem" }).toString() },
  });
  const stagingDirectory = await mkdtemp(path.join(root, "staging-"));
  const names = ["web", "ws", "postgres", "redis", "runtime", "compose", "desktop", "shop-archetypes"];
  const components = names.map((name) => {
    const bytes = Buffer.from(`verified ${name} component\n`);
    const ociImage = ["web", "ws", "postgres", "redis"].includes(name);
    return {
      name,
      kind: ociImage ? "oci-image"
        : name === "runtime" ? "runtime" : name === "desktop" ? "desktop" : "support-file",
      url: `${baseUrl}/${version}/${target}/${name}.artifact`,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      ...(ociImage ? { imageRef: `example.invalid/bms/${name}:test`, ociDigest: `sha256:${"b".repeat(64)}` } : {}),
      bytes,
    };
  });
  const payload = {
    product: "BMS Retail Local",
    releaseVersion: version,
    channel: "pilot",
    platformTarget: signedTarget,
    minimumAgentVersion: "0.5.6",
    schemaVersion: "10.36",
    rollbackSafe: false,
    createdAt: "2026-10-06T01:00:00Z",
    sourceCommit: "a".repeat(40),
    components: components.map(({ bytes: _bytes, ...component }) => component),
  };
  const protectedValue = Buffer.from(JSON.stringify({
    alg: "EdDSA",
    kid: keyId,
    typ: "application/vnd.bms.retail-local.release+json",
  })).toString("base64url");
  const payloadValue = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(null, Buffer.from(`${protectedValue}.${payloadValue}`, "ascii"), privateKey).toString("base64url");
  const manifestBytes = Buffer.from(JSON.stringify({
    formatVersion: 1,
    protected: protectedValue,
    payload: payloadValue,
    signature,
  }) + "\n");

  const files: UploadedRuntimeFile[] = [];
  for (const component of components) {
    const filename = `${component.name}.artifact`;
    const fullPath = path.join(stagingDirectory, filename);
    await writeFile(fullPath, component.bytes);
    files.push({ filename, fullPath, size: component.bytes.length, sha256: component.sha256 });
  }
  const manifestPath = path.join(stagingDirectory, "release.jws.json");
  await writeFile(manifestPath, manifestBytes);
  files.push({ filename: "release.jws.json", fullPath: manifestPath, size: manifestBytes.length, sha256: sha256(manifestBytes) });
  const sumsBytes = Buffer.from([
    ...components.map((component) => `${component.sha256}  /isolated/build/${component.name}.artifact`),
    `${sha256(manifestBytes)}  /isolated/build/release.jws.json`,
    "",
  ].join("\n"));
  const sumsPath = path.join(stagingDirectory, "SHA256SUMS");
  await writeFile(sumsPath, sumsBytes);
  files.push({ filename: "SHA256SUMS", fullPath: sumsPath, size: sumsBytes.length, sha256: sha256(sumsBytes) });
  return { version, target, stagingDirectory, files, manifestBytes };
}

test("the Windows x86 public folder accepts only its POS-only signed target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-x86-alias-"));
  const previous = {
    root: process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT,
    base: process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL,
    keys: process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON,
  };
  try {
    const candidate = await fixture(root, "windows-10-x86", "windows-10-x86-pos");
    assert.equal(
      verifyManagedRuntimeManifest(candidate.manifestBytes, candidate.version, candidate.target).platformTarget,
      "windows-10-x86-pos",
    );
  } finally {
    if (previous.root === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previous.root;
    if (previous.base === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = previous.base;
    if (previous.keys === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = previous.keys;
    await rm(root, { recursive: true, force: true });
  }
});

test("the web keyring rejects extra fields so private signing material cannot be configured here", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-keyring-shape-"));
  const previous = {
    root: process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT,
    base: process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL,
    keys: process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON,
  };
  try {
    const candidate = await fixture(root);
    const configured = JSON.parse(process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON || "{}");
    process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = JSON.stringify({ ...configured, privateKey: "must-not-be-here" });
    assert.throws(
      () => verifyManagedRuntimeManifest(candidate.manifestBytes, candidate.version, candidate.target),
      /trusted release keyring มี field ที่ไม่รองรับ: privateKey/,
    );
  } finally {
    if (previous.root === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previous.root;
    if (previous.base === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = previous.base;
    if (previous.keys === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = previous.keys;
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes a complete signed component set atomically and lists it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-release-"));
  const previous = {
    root: process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT,
    base: process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL,
    keys: process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON,
  };
  try {
    await mkdir(root, { recursive: true });
    const candidate = await fixture(root);
    const published = await publishManagedRuntimeRelease({
      ...candidate,
      releaseVersion: candidate.version,
      platformTarget: candidate.target,
    });
    assert.equal(published.managed, true);
    assert.equal(published.componentCount, 8);
    assert.match(published.manifestUrl, /0\.2\.14-pilot\.2\/macos-15-x64\/release\.jws\.json$/);
    const finalManifest = path.join(root, "retail-local", candidate.version, candidate.target, "release.jws.json");
    assert.deepEqual(await readFile(finalManifest), candidate.manifestBytes);
    const listed = await listManagedRuntimeReleases();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].managed, true);
    assert.equal(listed[0].platformTarget, candidate.target);
  } finally {
    if (previous.root === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previous.root;
    if (previous.base === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = previous.base;
    if (previous.keys === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = previous.keys;
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a stale publish lock left by a crashed process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-stale-lock-"));
  const previous = {
    root: process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT,
    base: process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL,
    keys: process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON,
  };
  try {
    const candidate = await fixture(root);
    const publishLock = path.join(root, "retail-local", candidate.version, `${candidate.target}.publishing`);
    await mkdir(publishLock, { recursive: true });
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(publishLock, staleTime, staleTime);
    const published = await publishManagedRuntimeRelease({
      ...candidate,
      releaseVersion: candidate.version,
      platformTarget: candidate.target,
    });
    assert.equal(published.managed, true);
    await assert.rejects(readFile(publishLock), /ENOENT|EISDIR/);
  } finally {
    if (previous.root === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previous.root;
    if (previous.base === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = previous.base;
    if (previous.keys === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = previous.keys;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a manifest whose signature was changed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-runtime-release-tamper-"));
  const previous = {
    root: process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT,
    base: process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL,
    keys: process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON,
  };
  try {
    const candidate = await fixture(root);
    const envelope = JSON.parse(candidate.manifestBytes.toString("utf8"));
    envelope.signature = Buffer.alloc(64).toString("base64url");
    assert.throws(
      () => verifyManagedRuntimeManifest(Buffer.from(JSON.stringify(envelope)), candidate.version, candidate.target),
      /signature/,
    );
  } finally {
    if (previous.root === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_ROOT = previous.root;
    if (previous.base === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_BASE_URL = previous.base;
    if (previous.keys === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON = previous.keys;
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime upload route stays raw-streamed and excluded from middleware buffering", async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const [route, parser, middleware, compose] = await Promise.all([
    readFile(path.join(repo, "apps/web/pages/api/admin/retail-local/runtime-release-upload.ts"), "utf8"),
    readFile(path.join(repo, "apps/web/lib/bms/managedRuntimeReleaseUpload.ts"), "utf8"),
    readFile(path.join(repo, "apps/web/middleware.ts"), "utf8"),
    readFile(path.join(repo, "docker-compose.prod.yml"), "utf8"),
  ]);
  assert.match(route, /bodyParser: false/);
  assert.match(route, /hasSameOrigin\(req\)/);
  assert.match(route, /invalid_origin/);
  assert.match(parser, /Busboy\(/);
  assert.match(parser, /pipeline\(/);
  assert.match(parser, /UPLOAD_IDLE_TIMEOUT/);
  assert.doesNotMatch(parser, /arrayBuffer\(|Buffer\.concat/);
  assert.match(middleware, /runtime-release-upload/);
  assert.match(compose, /RETAIL_LOCAL_RELEASE_HOST_DIR/);
  assert.match(compose, /BMS_RETAIL_LOCAL_RELEASE_KEYRING_JSON/);
});
