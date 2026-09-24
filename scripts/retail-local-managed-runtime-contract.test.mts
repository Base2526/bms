import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyReleaseEnvelope } from "../deploy/retail-local/managed-runtime/verify-release.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

test("Managed Runtime support policy is explicit and does not silently bless every platform", () => {
  const policy = json("deploy/retail-local/managed-runtime/support-matrix.json");
  assert.equal(policy.formatVersion, 1);
  assert.deepEqual(policy.architectures, ["x86_64"]);
  assert.ok(policy.minimumMemoryGiB >= 8);
  assert.ok(policy.recommendedFreeDiskGiB >= 15);

  const byId = new Map(policy.targets.map((target: { id: string }) => [target.id, target]));
  assert.equal(byId.get("windows-10-iot-enterprise-ltsc-2021-x64")?.supportUntil, "2032-01-13");
  assert.equal(byId.get("windows-10-22h2-esu-x64")?.requiresEsuEvidence, true);
  assert.equal(byId.get("ubuntu-24.04-lts-x64")?.supportLevel, "primary");
  assert.equal(byId.get("ubuntu-22.04-lts-x64")?.supportLevel, "transition");
  assert.equal(policy.targets.some((target: { architecture: string }) => target.architecture === "arm64"), false);
});

test("Managed Runtime release contract requires publisher identity and immutable components", () => {
  const envelopeSchema = json("deploy/retail-local/managed-runtime/release-manifest.schema.json");
  const payloadSchema = json("deploy/retail-local/managed-runtime/release-payload.schema.json");
  assert.match(envelopeSchema.description, /protected \+ '\.' \+ payload/);
  assert.ok(envelopeSchema.required.includes("signature"));
  assert.match(envelopeSchema.properties.signature.pattern, /86/);
  assert.match(payloadSchema.$defs.component.properties.url.pattern, /^\^https/);
  assert.match(payloadSchema.$defs.component.properties.sha256.pattern, /\{64\}/);
  assert.match(payloadSchema.$defs.component.properties.ociDigest.pattern, /sha256/);
  assert.deepEqual(payloadSchema.$defs.component.allOf[0].then.required, ["ociDigest"]);
  assert.ok(payloadSchema.required.includes("rollbackSafe"));
  assert.ok(payloadSchema.required.includes("minimumAgentVersion"));
  assert.ok(payloadSchema.required.includes("sourceCommit"));
  assert.equal(payloadSchema.properties.components.allOf.length, 4);
});

test("reference release verifier accepts authentic bytes and refuses tampering", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const header = { alg: "EdDSA", kid: "test-release-key", typ: "application/vnd.bms.retail-local.release+json" };
  const digest = "a".repeat(64);
  const payload = {
    product: "BMS Retail Local",
    releaseVersion: "1.0.0-test.1",
    channel: "pilot",
    platformTarget: "ubuntu-24.04-lts-x64",
    minimumAgentVersion: "0.1.0",
    schemaVersion: "10.15",
    rollbackSafe: false,
    createdAt: "2026-09-24T12:00:00.000Z",
    sourceCommit: "b".repeat(40),
    components: ["web", "ws", "postgres", "redis"].map((name) => ({
      name,
      kind: "oci-image",
      url: `https://releases.example.invalid/${name}.tar.zst`,
      sha256: digest,
      ociDigest: `sha256:${digest}`,
      sizeBytes: 1024,
    })),
  };
  const protectedValue = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadValue = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(null, Buffer.from(`${protectedValue}.${payloadValue}`), privateKey).toString("base64url");
  const envelope = Buffer.from(JSON.stringify({ formatVersion: 1, protected: protectedValue, payload: payloadValue, signature }));
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const verified = verifyReleaseEnvelope(envelope, publicKeyPem, {
    expectedKeyId: "test-release-key",
    expectedTarget: "ubuntu-24.04-lts-x64",
  });
  assert.equal(verified.payload.releaseVersion, "1.0.0-test.1");

  const tampered = JSON.parse(envelope.toString("utf8"));
  tampered.payload = Buffer.from(JSON.stringify({ ...payload, releaseVersion: "9.9.9" })).toString("base64url");
  assert.throws(() => verifyReleaseEnvelope(Buffer.from(JSON.stringify(tampered)), publicKeyPem), /signature ไม่ถูกต้อง/);
});

test("platform preflights are read-only and preserve the Windows 10 support boundary", () => {
  const windows = read("deploy/retail-local/managed-runtime/preflight-windows.ps1");
  const linux = read("deploy/retail-local/managed-runtime/preflight-linux.sh");

  assert.match(windows, /19044[\s\S]*Windows 10 IoT Enterprise LTSC 2021/);
  assert.match(windows, /19045[\s\S]*requiresEsuEvidence = \$true/);
  assert.match(windows, /build -ge 22000/);
  assert.doesNotMatch(windows, /Enable-WindowsOptionalFeature|wsl(?:\.exe)?\s+--install|Start-Process/);

  assert.match(linux, /ubuntu/);
  assert.match(linux, /24\.04/);
  assert.match(linux, /22\.04/);
  assert.match(linux, /PID 1 ไม่ใช่ systemd/);
  assert.doesNotMatch(linux, /apt(?:-get)?\s+install|dnf\s+install|systemctl\s+(?:enable|start)/);
});

test("Managed Runtime keeps authority out of Electron and does not replace the pilot early", () => {
  const runtimeReadme = read("deploy/retail-local/managed-runtime/README.md");
  const design = read("docs/business/retail-local-managed-runtime.md");
  const existingInstaller = read("deploy/retail-local/install.ps1");

  assert.match(runtimeReadme, /Electron remains a client window/);
  assert.match(runtimeReadme, /does\s+not replace the existing Docker Desktop technical-pilot installer yet/);
  assert.match(design, /safeStorage/);
  assert.match(design, /Uninstall keeps shop data by default/);
  assert.match(existingInstaller, /Import-RetailLocalReleaseImages/);
});
