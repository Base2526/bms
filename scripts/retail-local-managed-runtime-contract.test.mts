import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSignedRelease } from "../deploy/retail-local/managed-runtime/sign-release.mjs";
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
  assert.deepEqual(payloadSchema.$defs.component.allOf[0].then.required, ["ociDigest", "imageRef"]);
  assert.ok(payloadSchema.required.includes("rollbackSafe"));
  assert.ok(payloadSchema.required.includes("minimumAgentVersion"));
  assert.ok(payloadSchema.required.includes("sourceCommit"));
  assert.equal(payloadSchema.properties.components.allOf.length, 7);
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
      imageRef: `bms/${name}:1.0.0-test.1`,
      sizeBytes: 1024,
    })).concat([
      { name: "runtime", kind: "runtime", url: "https://releases.example.invalid/runtime", sha256: digest, sizeBytes: 1024 },
      { name: "compose", kind: "support-file", url: "https://releases.example.invalid/compose", sha256: digest, sizeBytes: 1024 },
      { name: "desktop", kind: "desktop", url: "https://releases.example.invalid/desktop", sha256: digest, sizeBytes: 1024 },
    ]),
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
  assert.match(runtimeReadme, /does\s+not replace the existing Docker Desktop technical-pilot installer[\s\S]*acceptance gates/);
  assert.match(design, /safeStorage/);
  assert.match(design, /Uninstall keeps shop data by default/);
  assert.match(existingInstaller, /Import-RetailLocalReleaseImages/);
});

test("release signing derives hashes from artifact bytes and emits a verifiable envelope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bms-managed-release-"));
  const artifact = join(directory, "component.bin");
  await writeFile(artifact, "signed bytes");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const digest = "a".repeat(64);
  const descriptors = ["web", "ws", "postgres", "redis"].map((name) => ({
    name, kind: "oci-image", path: artifact, url: `https://release.example/${name}`,
    imageRef: `bms/${name}:1.0.0`, ociDigest: `sha256:${digest}`,
  })).concat([
    { name: "runtime", kind: "runtime", path: artifact, url: "https://release.example/runtime" },
    { name: "compose", kind: "support-file", path: artifact, url: "https://release.example/compose" },
    { name: "desktop", kind: "desktop", path: artifact, url: "https://release.example/desktop" },
  ] as any);
  const envelope = await createSignedRelease({
    releaseVersion: "1.0.0", channel: "pilot", platformTarget: "ubuntu-24.04-lts-x64",
    minimumAgentVersion: "0.1.0", schemaVersion: "10.15", rollbackSafe: false,
    createdAt: "2026-09-24T00:00:00Z", sourceCommit: "b".repeat(40), keyId: "test-key",
    components: descriptors,
  }, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const verified = verifyReleaseEnvelope(envelope, publicKey.export({ type: "spki", format: "pem" }).toString(), {
    expectedKeyId: "test-key", expectedTarget: "ubuntu-24.04-lts-x64",
  });
  assert.equal(verified.payload.components[0].sha256, "d6eade346b42f707c1684aa3d3c029ab0809164b8b878fcccf56fe1d83b3dc1d");
  assert.equal((await readFile(artifact, "utf8")), "signed bytes");
});

test("managed compose and installers keep private services off host ports", () => {
  const compose = read("deploy/retail-local/managed-runtime/compose.managed.yml");
  const windows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const linux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  assert.doesNotMatch(compose, /5432:5432|6379:6379/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WEB_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WS_PORT/);
  assert.match(windows, /engine-load -engine windows-wsl/);
  assert.match(windows, /pairing-handoff\.json/);
  assert.match(windows, /test -f "\$runtimeData\/\.env"[\s\S]*if \(-not \$runtimeEnvExists\)/);
  assert.match(linux, /engine-load -engine linux-native/);
  assert.match(linux, /chmod 0600 "\$handoff_path"/);
  assert.match(linux, /if \[\[ ! -f \$RUNTIME_ROOT\/\.env \]\]/);
  assert.doesNotMatch(linux, /--privileged|0\.0\.0\.0:/);
});

test("managed lifecycle keeps backups encrypted and permanent erase explicit", () => {
  const localctl = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-localctl");
  const windowsUninstall = read("deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1");
  const linuxUninstall = read("deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh");
  assert.match(localctl, /age -p -o/);
  assert.match(localctl, /REPLACE-LOCAL-DATA/);
  assert.match(localctl, /pg_dump[\s\S]*storage\.tar\.gz[\s\S]*\.env/);
  assert.match(windowsUninstall, /-EraseData[\s\S]*ERASE-BMS-RETAIL-LOCAL[\s\S]*--unregister/);
  assert.match(linuxUninstall, /--erase-data[\s\S]*ERASE-BMS-RETAIL-LOCAL[\s\S]*down --volumes/);
});

test("Linux bootstrap package stays small and never packages a release private key", () => {
  const builder = read("deploy/retail-local/managed-runtime/linux/build-deb.sh");
  const setup = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-setup");
  assert.match(builder, /CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build/);
  assert.match(builder, /Architecture: amd64/);
  assert.match(builder, /trusted-release-keys\.json/);
  assert.doesNotMatch(builder, /private[-_]key|PRIVATE KEY|sign-release/);
  assert.match(setup, /release-manifest-url/);
  assert.match(setup, /exec "\$bundle_root\/install-managed-runtime\.sh"/);
});

test("Linux release preparation builds all signed payload components before signing", () => {
  const prepare = read("deploy/retail-local/managed-runtime/linux/prepare-release.sh");
  for (const name of ["web", "ws", "postgres", "redis", "runtime", "compose", "desktop"]) {
    assert.match(prepare, new RegExp(`${name}\\.artifact`));
  }
  assert.match(prepare, /docker buildx build --platform linux\/amd64 --provenance=false --load/);
  assert.match(prepare, /docker image inspect --format '\{\{\.Id\}\}'/);
  assert.match(prepare, /release-descriptor\.json[\s\S]*sign-release\.mjs/);
  assert.match(prepare, /BMS_ALLOW_LOCAL_RELEASE_SIGNING=1/);
});

test("Retail Local licensing records evidence but can never stop store operations", () => {
  const design = read("docs/business/retail-local-managed-runtime.md");
  const invariants = read("docs/agent-invariants.md");
  const agent = read("apps/retail-local-agent/license_evidence.go");
  const linuxService = read("deploy/retail-local/managed-runtime/linux/bms-retail-local.service");
  const linuxUninstall = read("deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh");
  const windowsInstaller = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const windowsUninstall = read("deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1");
  const schema = json("deploy/retail-local/managed-runtime/license-evidence.schema.json");

  assert.match(design, /no remote\s+kill switch/i);
  assert.match(design, /Existing installations remain\s+operational throughout review/);
  assert.match(invariants, /licensing is evidence-only and fail-open/i);
  assert.match(invariants, /never stop an already-installed shop/);
  assert.match(agent, /ed25519\.Sign/);
  assert.match(agent, /PreviousEventHash/);
  assert.match(agent, /Deliberately fail-open/);
  assert.match(linuxService, /ExecStartPost=-.*license-pulse/);
  assert.match(windowsInstaller, /New-ScheduledTaskTrigger -Daily[\s\S]*License Evidence/);
  assert.match(linuxUninstall, /INSTALLATION_DEACTIVATED[\s\S]*\|\| true/);
  assert.match(windowsUninstall, /INSTALLATION_DEACTIVATED[\s\S]*Unregister-ScheduledTask -TaskName "BMS Retail Local License Evidence"/);
  assert.ok(schema.properties.event.properties.eventType.enum.includes("RUNTIME_SEEN"));
  assert.equal(JSON.stringify(schema).includes("hardwareSerial"), false);
  assert.equal(JSON.stringify(schema).includes("macAddress"), false);
  assert.equal(JSON.stringify(schema).includes("gps"), false);
});
