import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSignedRelease } from "../deploy/retail-local/managed-runtime/sign-release.mjs";
import { verifyReleaseEnvelope } from "../deploy/retail-local/managed-runtime/verify-release.mjs";
import { verifyPromotionEvidence } from "../deploy/retail-local/managed-runtime/verify-promotion-evidence.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

test("Managed Runtime support policy is explicit and does not silently bless every platform", () => {
  const policy = json("deploy/retail-local/managed-runtime/support-matrix.json");
  assert.equal(policy.formatVersion, 1);
  assert.deepEqual(policy.architectures, ["x86_64", "arm64"]);
  assert.ok(policy.minimumMemoryGiB >= 8);
  assert.ok(policy.recommendedFreeDiskGiB >= 15);

  const byId = new Map(policy.targets.map((target: { id: string }) => [target.id, target]));
  assert.equal(byId.get("windows-10-iot-enterprise-ltsc-2021-x64")?.supportUntil, "2032-01-13");
  assert.equal(byId.get("windows-10-22h2-esu-x64")?.requiresEsuEvidence, true);
  assert.equal(byId.get("ubuntu-24.04-lts-x64")?.supportLevel, "primary");
  assert.equal(byId.get("ubuntu-22.04-lts-x64")?.supportLevel, "transition");
  assert.deepEqual(byId.get("macos-15-arm64"), {
    id: "macos-15-arm64",
    platform: "macos",
    minimumVersion: "15.0",
    architecture: "arm64",
    supportLevel: "technical-pilot",
    runtime: "lima-vz-moby",
    minimumFreeDiskGiB: 12,
    recommendedFreeDiskGiB: 30,
    requiresAppleVirtualizationFramework: true,
  });
  assert.deepEqual(byId.get("macos-15-x64"), {
    id: "macos-15-x64",
    platform: "macos",
    minimumVersion: "15.0",
    architecture: "x86_64",
    supportLevel: "technical-pilot",
    runtime: "lima-vz-moby",
    minimumFreeDiskGiB: 12,
    recommendedFreeDiskGiB: 30,
    requiresAppleVirtualizationFramework: true,
  });
});

test("macOS full installer uses its private VZ runtime instead of Docker Desktop on both CPU families", () => {
  const hostControl = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const vmTemplate = read("deploy/retail-local/managed-runtime/macos/lima.yaml.template");
  const packageBuilder = read("deploy/retail-local/managed-runtime/macos/build-pkg.sh");
  const packageSmokeTest = read("deploy/retail-local/managed-runtime/macos/smoke-test-pkg.sh");
  const packagePostinstall = read("deploy/retail-local/managed-runtime/macos/postinstall");
  const guidedUninstall = read("deploy/retail-local/managed-runtime/macos/BMS Retail Local Uninstall.command");
  assert.match(vmTemplate, /vmType: vz/);
  assert.match(vmTemplate, /arch: __LIMA_ARCH__/);
  assert.match(vmTemplate, /guestIP: 127\.0\.0\.1/);
  assert.match(hostControl, /engine-load -engine macos-lima/);
  assert.match(hostControl, /bms-localctl doctor/);
  assert.match(hostControl, /ensure-running\) ensure_runtime/);
  assert.match(hostControl, /launchctl kickstart "\$LAUNCH_LABEL"/);
  assert.match(hostControl, /PACKAGE_TYPE/);
  assert.match(hostControl, /PLATFORM_TARGET/);
  assert.match(hostControl, /pairing-handoff-/);
  assert.match(hostControl, /provision-result\.json/);
  assert.match(hostControl, /BMS_RETAIL_LOCAL_LIMA_HOME:-\$HOME\/\.bmsrl/);
  assert.match(packageBuilder, /--architecture/);
  assert.match(packageBuilder, /linux\/amd64/);
  assert.match(packageBuilder, /lima_guest_arch=x86_64/);
  assert.match(packageBuilder, /ubuntu-24\.04-server-cloudimg\.img/);
  assert.match(packageBuilder, /docker-\$DOCKER_VERSION\.tgz/);
  assert.match(packageBuilder, /Applications\/BMS Retail Local\.app/);
  assert.match(packageBuilder, /Applications\/BMS POS\.app/);
  assert.match(packageBuilder, /--package-type/);
  assert.match(packageBuilder, /BundleIsRelocatable/);
  assert.match(packageBuilder, /--component-plist/);
  assert.match(packageBuilder, /BMSRetailLocal\.icns/);
  assert.match(packageBuilder, /pkgutil --expand "\$package_path"/);
  assert.match(packageBuilder, /gzip compressed data/);
  assert.match(packageBuilder, /"sourceCommit":"\$source_commit"/);
  assert.match(packageSmokeTest, /component Payload ต้องเป็น archive ไม่ใช่ directory/);
  assert.match(packageSmokeTest, /macos-15-x64/);
  assert.match(packageSmokeTest, /<relocate>/);
  assert.match(packagePostinstall, /missing \/Applications\/BMS POS\.app/);
  assert.match(packagePostinstall, /launchctl asuser "\$console_uid"/);
  assert.match(packagePostinstall, /open -a "\$app"/);
  assert.match(packageBuilder, /BMS Retail Local Uninstall\.command/);
  assert.match(guidedUninstall, /BACKUP-VERIFIED[\s\S]*--erase-data/);
  assert.doesNotMatch(hostControl, /Docker Desktop/i);
});

test("macOS normal distribution is a small signed-release bootstrap for Apple Silicon and Intel", () => {
  const hostControl = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const bootstrapBuilder = read("deploy/retail-local/managed-runtime/macos/build-bootstrap-pkg.sh");
  const releaseBuilder = read("deploy/retail-local/managed-runtime/macos/prepare-release.sh");
  const bootstrapSmoke = read("deploy/retail-local/managed-runtime/macos/smoke-test-bootstrap-pkg.sh");
  const postinstall = read("deploy/retail-local/managed-runtime/macos/postinstall-bootstrap");
  const posBootstrapBuilder = read("deploy/retail-local/managed-runtime/macos/build-pos-bootstrap-dmg.sh");
  const posBootstrapSetup = read("deploy/retail-local/managed-runtime/macos/bms-pos-online-setup.command");
  const posBootstrapSmoke = read("deploy/retail-local/managed-runtime/macos/smoke-test-pos-bootstrap-dmg.sh");

  assert.match(bootstrapBuilder, /--architecture arm64\|x64/);
  assert.match(bootstrapBuilder, /trusted-release-keys\.json/);
  assert.match(bootstrapBuilder, /manifest-url/);
  assert.match(bootstrapBuilder, /25 \* 1024 \* 1024/);
  assert.match(bootstrapBuilder, /firstInstallInternetRequired/);
  assert.match(bootstrapBuilder, /--test-ca[\s\S]*test_build == true[\s\S]*ห้ามใส่ private key ใน bootstrap/);
  assert.match(bootstrapBuilder, /chmod 0644 "\$bootstrap_root\/trusted-release-keys\.json"[\s\S]*test-release-ca\.pem/);
  assert.doesNotMatch(bootstrapBuilder, /ubuntu-24\.04-server-cloudimg\.img|docker image save|BMS POS\.app/);
  assert.match(bootstrapSmoke, /online bootstrap ฝัง payload ขนาดใหญ่/);
  assert.match(bootstrapSmoke, /Applications\/BMS POS\.app/);
  assert.match(bootstrapSmoke, /stat -f %Lp[\s\S]*== 644[\s\S]*test release CA permission/);
  assert.match(postinstall, /Internet is required for the first setup/);
  assert.match(postinstall, /chmod 0644 "\$root\/bootstrap\/trusted-release-keys\.json"[\s\S]*test-release-ca\.pem/);

  assert.match(posBootstrapBuilder, /stage-desktop|bms-runtime-agent/);
  assert.match(posBootstrapBuilder, /electronEmbedded/);
  assert.doesNotMatch(posBootstrapBuilder, /npm run pack:mac|Electron Framework|desktop\.artifact/);
  assert.match(posBootstrapSetup, /signed release manifest/);
  assert.match(posBootstrapSetup, /SHA-256[\s\S]*stage-desktop/);
  assert.match(posBootstrapSetup, /desktop\.artifact/);
  assert.match(posBootstrapSmoke, /POS bootstrap ฝัง Electron/);
  assert.match(posBootstrapSmoke, /25 \* 1024 \* 1024/);

  assert.match(releaseBuilder, /macos-15-\$architecture/);
  assert.match(releaseBuilder, /docker image save/);
  assert.match(releaseBuilder, /BMS_SOURCE_COMMIT[\s\S]*org\.opencontainers\.image\.revision[\s\S]*server-only/);
  assert.match(releaseBuilder, /desktop\.artifact/);
  assert.match(releaseBuilder, /shop-archetypes\.artifact/);
  assert.match(releaseBuilder, /sign-release\.mjs/);
  assert.match(hostControl, /stage-release[\s\S]*-progress/);
  assert.match(hostControl, /verify-release/);
  assert.match(hostControl, /extract_runtime/);
  assert.match(hostControl, /install_pos_desktop/);
  assert.match(hostControl, /การติดตั้งครั้งแรกต้องใช้อินเทอร์เน็ต/);
  assert.match(hostControl, /test-release-ca\.pem[\s\S]*ใช้ได้เฉพาะ localhost[\s\S]*SSL_CERT_FILE/);
  assert.match(hostControl, /hw\.optional\.arm64[\s\S]*ไฟล์ติดตั้งไม่ตรงกับ CPU เครื่องนี้/);
  assert.match(hostControl, /embedded_installation_available[\s\S]*activate_embedded_installation/);
  assert.match(hostControl, /พบข้อมูลร้านจาก Offline Installer เดิม[\s\S]*ไม่แตะข้อมูลร้าน/);
  assert.match(hostControl, /runtime release ไม่ครบ[\s\S]*อย่าลบข้อมูลร้าน/);
  assert.match(hostControl, /SAMPLE_MODE != STARTER_CATALOG[\s\S]*กำลังลองสร้างตามตัวเลือกของผู้ใช้/);
  assert.match(hostControl, /businessArchetype[\s\S]*sampleMode[\s\S]*sampleStatus/);
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
  const windowsAgent = read("apps/retail-local-agent/preflight_windows.go");

  assert.match(windows, /19044[\s\S]*Windows 10 IoT Enterprise LTSC 2021/);
  assert.match(windows, /19045[\s\S]*requiresEsuEvidence = \$true/);
  assert.match(windows, /build -ge 22000/);
  assert.doesNotMatch(windows, /Enable-WindowsOptionalFeature|wsl(?:\.exe)?\s+--install|Start-Process/);
  assert.match(windowsAgent, /Get-WindowsOptionalFeature[\s\S]*catch\{& wsl\.exe --status/);
  assert.match(windowsAgent, /CIM รายงาน virtualization เป็นปิด แต่ WSL พร้อมใช้งาน/);
  assert.match(windowsAgent, /command\.CombinedOutput\(\)/);

  assert.match(linux, /ubuntu/);
  assert.match(linux, /24\.04/);
  assert.match(linux, /22\.04/);
  assert.match(linux, /PID 1 ไม่ใช่ systemd/);
  assert.doesNotMatch(linux, /apt(?:-get)?\s+install|dnf\s+install|systemctl\s+(?:enable|start)/);
});

test("Managed Runtime setup UX preserves actionable preflight and resumable provisioning", () => {
  const agentMain = read("apps/retail-local-agent/main.go");
  const darwin = read("apps/retail-local-agent/preflight_darwin.go");
  const windows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const linux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const inno = read("deploy/retail-local/managed-runtime/windows/BMSRetailLocal.iss");
  const windowsRunner = read("deploy/retail-local/managed-runtime/windows/run-managed-runtime.ps1");
  const windowsUninstall = read("deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1");

  assert.match(agentMain, /errPreflightFailed/);
  assert.match(agentMain, /preflight \[--human\]/);
  assert.match(darwin, /case "amd64":[\s\S]*macos-15-x64/);
  assert.match(darwin, /พื้นที่ว่างปัจจุบัน/);
  assert.doesNotMatch(darwin, /รองรับเฉพาะ Mac ที่ใช้ Apple Silicon/);

  for (const installer of [windows, linux]) {
    assert.match(installer, /provision-result\.json/);
    assert.match(installer, /ยืนยันรหัสผ่านอีกครั้ง/);
    assert.match(installer, /ยืนยัน PIN อีกครั้ง/);
    assert.match(installer, /\[BMS/);
    assert.match(installer, /BMS_LOCAL_BUSINESS_ARCHETYPE/);
    assert.match(installer, /BMS_LOCAL_SAMPLE_MODE/);
    assert.match(installer, /สร้างข้อมูลตัวอย่างตามประเภทร้าน|Starter Catalog/);
  }
  assert.match(windows, /preflight\.warnings/);
  assert.match(windows, /กด Enter เพื่อปิดหน้าต่างนี้/);
  assert.match(linux, /\.warnings\[\]\?/);
  assert.match(inno, /ResultCode <> 0[\s\S]*RaiseException/);
  assert.match(inno, /run-managed-runtime\.ps1/);
  assert.match(inno, /setup-error\.txt/);
  assert.match(inno, /setup-transcript\.log/);
  assert.match(inno, /if '\{#ActivationUri\}' <> '' then[\s\S]*-ActivationUri/);
  assert.match(inno, /WizardForm\.Hide;/);
  assert.match(inno, /SW_SHOWMAXIMIZED/);
  assert.match(inno, /finally\s+WizardForm\.Show;/);
  assert.match(windowsRunner, /Start-Transcript/);
  assert.match(windowsRunner, /Console\]::OutputEncoding = \$utf8[\s\S]*chcp\.com" 65001/);
  assert.match(windowsRunner, /Administrators:[\s\S]*SYSTEM:[\s\S]*icacls/);
  assert.match(windowsRunner, /Get-CimInstance Win32_ComputerSystem[\s\S]*\(OI\)\(CI\)RX/);
  assert.match(windows, /Get-CimInstance Win32_ComputerSystem[\s\S]*\(OI\)\(CI\)RX/);
  assert.match(windows, /function Invoke-WslCommand[\s\S]*ExitCode = \$exitCode/);
  assert.match(windows, /runtime-install-control/);
  assert.match(inno, /runtime-rootfs\\bms-wsl-keepalive/);
  assert.equal((windows.match(/Read-RequiredText "ชื่อร้าน"/g) ?? []).length, 1);
  assert.match(windows, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(windows, /New-ScheduledTaskPrincipal[\s\S]*-LogonType S4U/);
  assert.match(windows, /ArgumentList "\/S", "\/allusers"/);
  assert.match(windows, /BMS Retail Local POS Pairing[\s\S]*-LogonType Interactive/);
  assert.match(windows, /IsNullOrWhiteSpace\(\$desktopArguments\)[\s\S]*New-ScheduledTaskAction -Execute \$desktopExecutable/);
  assert.match(windows, /ReadAllText\(\$Path, \[Text\.Encoding\]::UTF8\)/);
  assert.match(windows, /BMS_PROGRESS[\s\S]*Write-Progress[\s\S]*ยังทำงานอยู่/);
  assert.match(windows, /wslVersion[\s\S]*--version[\s\S]*finishing an upgrade/);
  assert.match(inno, /SW_SHOWMAXIMIZED/);
  assert.match(inno, /\[UninstallRun\][\s\S]*-NonInteractive -WindowStyle Hidden[\s\S]*runhidden waituntilterminated/);
  assert.match(inno, /CurUninstallStepChanged[\s\S]*ปกติไม่เกิน 15 วินาที/);
  assert.match(windowsUninstall, /Stop-ScheduledTask[\s\S]*Unregister-ScheduledTask/);
  assert.match(windowsUninstall, /BMS Retail Local POS Pairing/);
  assert.match(windowsUninstall, /INSTALLATION_DEACTIVATED" 3[\s\S]*--terminate BMSRuntime" 10/);
  assert.doesNotMatch(windowsUninstall, /bms-localctl stop/);
  assert.ok(windowsUninstall.indexOf("Stop-AndRemoveScheduledTask $taskName") <
    windowsUninstall.indexOf('Invoke-BoundedProcess $wsl "--terminate BMSRuntime"'));
});

test("local Windows smoke release trusts HTTPS for both the user and elevated installer", () => {
  const prepare = read("deploy/retail-local/managed-runtime/windows/prepare-local-test-release.ps1");
  const stop = read("deploy/retail-local/managed-runtime/windows/stop-local-test-release.ps1");
  assert.match(prepare, /StoreLocation\]::CurrentUser/);
  assert.match(prepare, /-addstore -f Root[\s\S]*certutil\.exe/);
  assert.match(prepare, /certificateStores = @\("CurrentUser\/Root", "LocalMachine\/Root"\)/);
  assert.match(stop, /certutil\.exe[\s\S]*-delstore Root/);
});

test("Windows PowerShell 5.1 scripts keep a UTF-8 BOM", () => {
  const windowsRoot = new URL("../deploy/retail-local/managed-runtime/windows/", import.meta.url);
  const scripts = readdirSync(windowsRoot).filter((name) => name.endsWith(".ps1"));
  assert.ok(scripts.length > 0);
  for (const name of scripts) {
    const bytes = readFileSync(new URL(name, windowsRoot));
    assert.deepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${name} must be UTF-8 with BOM so Windows PowerShell 5.1 does not parse Thai text as ANSI`,
    );
  }
});

test("Windows installer exposes an all-users uninstall shortcut", () => {
  const installer = read("deploy/retail-local/managed-runtime/windows/BMSRetailLocal.iss");
  assert.match(installer, /\{commonprograms\}\\BMS Retail Local\\Uninstall BMS Retail Local/);
  assert.match(installer, /Filename: "\{uninstallexe\}"/);
  assert.match(installer, /RunOnceId: "BMSManagedRuntimeCleanup"/);
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
  const archetypeArtifact = fileURLToPath(new URL("../packages/retail-local-contract/shop-archetypes.json", import.meta.url));
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
    { name: "shop-archetypes", kind: "support-file", path: archetypeArtifact, url: "https://release.example/shop-archetypes" },
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
  const daemon = read("deploy/retail-local/managed-runtime/runtime-rootfs/daemon.json");
  const runtimeDockerfile = read("deploy/retail-local/managed-runtime/runtime-rootfs/Dockerfile");
  const agentEngine = read("apps/retail-local-agent/engine.go");
  const windows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const linux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  assert.doesNotMatch(compose, /5432:5432|6379:6379/);
  assert.doesNotMatch(daemon, /"hosts"/);
  assert.match(runtimeDockerfile, /apt-get install[\s\S]*wget/);
  assert.match(runtimeDockerfile, /sed -i 's\/\\r\$\/\/'.*bms-wsl-keepalive.*bms-update-transaction.*bms-localctl/);
  assert.match(agentEngine, /bytes\.ReplaceAll\(contents, \[\]byte\("\\r\\n"\), \[\]byte\("\\n"\)\)/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WEB_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WS_PORT/);
  assert.equal((compose.match(/--conditions=react-server/g) ?? []).length, 2);
  assert.match(windows, /Invoke-AgentProgress[\s\S]*"engine-load"[\s\S]*"windows-wsl"/);
  assert.match(windows, /pairing-handoff\.json/);
  assert.match(windows, /"test", "-f", "\$runtimeData\/\.env"[\s\S]*if \(-not \$runtimeEnvExists\)/);
  assert.match(linux, /engine-load -engine linux-native/);
  assert.match(linux, /chmod 0600 "\$handoff_path"/);
  assert.match(linux, /if \[\[ ! -f \$RUNTIME_ROOT\/\.env \]\]/);
  assert.doesNotMatch(linux, /--privileged|0\.0\.0\.0:/);
});

test("managed lifecycle keeps backups encrypted and permanent erase explicit", () => {
  const localctl = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-localctl");
  const windowsUninstall = read("deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1");
  const linuxUninstall = read("deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh");
  const macosControl = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  assert.match(localctl, /age -p -o/);
  assert.match(localctl, /REPLACE-LOCAL-DATA/);
  assert.match(localctl, /pg_dump[\s\S]*storage\.tar\.gz[\s\S]*\.env/);
  assert.match(windowsUninstall, /-EraseData[\s\S]*ERASE-BMS-RETAIL-LOCAL[\s\S]*--unregister/);
  assert.match(linuxUninstall, /--erase-data[\s\S]*ERASE-BMS-RETAIL-LOCAL[\s\S]*down[\s\S]*--volumes/);
  assert.match(macosControl, /uninstall\) shift; uninstall_runtime/);
  assert.match(macosControl, /--erase-data[\s\S]*--confirm[\s\S]*ERASE-BMS-RETAIL-LOCAL/);
  assert.match(macosControl, /ข้อมูลร้าน, private VM และ secrets ยังอยู่/);
  assert.match(macosControl, /delete -f "\$INSTANCE"[\s\S]*rm -rf -- "\$STATE_ROOT" "\$LIMA_HOME"/);
  assert.match(macosControl, /sudo pkgutil --forget com\.base2526\.bms\.retail-local/);
});

test("Linux and macOS uninstall disable relaunch sources and bound slow cleanup", () => {
  const linuxUninstall = read("deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh");
  const linuxService = read("deploy/retail-local/managed-runtime/linux/bms-retail-local.service");
  const linuxDeb = read("deploy/retail-local/managed-runtime/linux/build-deb.sh");
  const macosControl = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const macosLauncher = read("deploy/retail-local/managed-runtime/macos/BMS Retail Local Uninstall.command");

  assert.doesNotMatch(linuxUninstall, /disable --now/);
  assert.ok(linuxUninstall.indexOf('systemctl disable "$unit"') <
    linuxUninstall.indexOf("INSTALLATION_DEACTIVATED"));
  assert.match(linuxUninstall, /stop_unit_bounded bms-retail-local-offhost-backup\.service 5/);
  assert.match(linuxUninstall, /timeout 3s .*license-pulse[\s\S]*stop_unit_bounded bms-retail-local\.service 10/);
  assert.match(linuxUninstall, /timeout 45s docker compose[\s\S]*down --timeout 5 --volumes/);
  assert.match(linuxService, /ExecStop=.*stop --timeout 10[\s\S]*TimeoutStopSec=20/);
  assert.doesNotMatch(linuxDeb, /disable --now bms-retail-local/);
  assert.match(linuxDeb, /timeout 5s systemctl stop bms-retail-local-offhost-backup\.service/);
  assert.match(linuxDeb, /timeout 10s systemctl stop bms-retail-local\.service/);
  assert.match(linuxDeb, /rm -f \/etc\/systemd\/system\/bms-retail-local\.service[\s\S]*systemctl daemon-reload/);

  assert.match(macosControl, /run_with_timeout\(\)/);
  assert.match(macosControl, /timeout_marker=.*mktemp[\s\S]*: >"\$timeout_marker"[\s\S]*return 124/);
  assert.ok(macosControl.indexOf('rm -f -- "$LAUNCH_AGENT"') <
    macosControl.indexOf('run_with_timeout 3 "$AGENT" license-pulse'));
  assert.match(macosControl, /run_with_timeout 5 launchctl bootout "\$LAUNCH_LABEL"/);
  assert.match(macosControl, /run_with_timeout 10 "\$LIMACTL" stop "\$INSTANCE"/);
  assert.match(macosControl, /run_with_timeout 60 "\$LIMACTL" delete -f "\$INSTANCE"[\s\S]*die "ลบ private VM ไม่สำเร็จ/);
  assert.match(macosLauncher, /trap finish EXIT/);
});

test("scheduled off-host backups are encrypted, separate, retained, and visibly monitored", () => {
  const linuxConfigure = read("deploy/retail-local/managed-runtime/linux/configure-offhost-backup.sh");
  const linuxRunner = read("deploy/retail-local/managed-runtime/linux/run-offhost-backup.sh");
  const linuxStatus = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-backup-status");
  const linuxTimer = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-offhost-backup.timer");
  const windowsConfigure = read("deploy/retail-local/managed-runtime/windows/configure-offhost-backup.ps1");
  const windowsRunner = read("deploy/retail-local/managed-runtime/windows/run-offhost-backup.ps1");
  const windowsStatus = read("deploy/retail-local/managed-runtime/windows/offhost-backup-status.ps1");

  assert.match(linuxConfigure, /mountpoint -q[\s\S]*runtime_device[\s\S]*destination_device/);
  assert.match(linuxRunner, /bms-localctl backup[\s\S]*--recipient/);
  assert.match(linuxRunner, /sha256sum[\s\S]*-mtime[\s\S]*-delete/);
  assert.match(linuxRunner, /write_status failed[\s\S]*write_status passed/);
  assert.match(linuxStatus, /172800/);
  assert.match(linuxTimer, /OnCalendar=\*-\*-\* 02:00:00[\s\S]*Persistent=true/);

  assert.match(windowsConfigure, /DriveType[\s\S]*DiskNumber/);
  assert.match(windowsConfigure, /New-ScheduledTaskTrigger -Daily -At 2am/);
  assert.match(windowsConfigure, /LogonType Interactive[\s\S]*StartWhenAvailable/);
  assert.match(windowsRunner, /bms-localctl backup[\s\S]*--recipient/);
  assert.match(windowsRunner, /runtime-read[\s\S]*Get-FileHash[\s\S]*retentionDays/);
  assert.match(windowsRunner, /Write-BackupStatus "failed"[\s\S]*finally/);
  assert.match(windowsStatus, /TotalHours -gt 48/);
  for (const source of [linuxConfigure, linuxRunner, windowsConfigure, windowsRunner]) {
    assert.doesNotMatch(source, /license-(?:record|pulse|flush)/);
  }
});

test("Linux bootstrap package stays small and never packages a release private key", () => {
  const builder = read("deploy/retail-local/managed-runtime/linux/build-deb.sh");
  const setup = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-setup");
  const activation = read("deploy/retail-local/managed-runtime/linux/activate-managed-runtime.sh");
  assert.match(builder, /CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build/);
  assert.match(builder, /Architecture: amd64/);
  assert.match(builder, /trusted-release-keys\.json/);
  assert.doesNotMatch(builder, /private[-_]key|PRIVATE KEY|sign-release/);
  assert.match(setup, /release-manifest-url/);
  assert.match(setup, /BMS_ACTIVATION_URI/);
  assert.match(read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh"), /Activation Code/);
  assert.match(setup, /exec "\$bundle_root\/install-managed-runtime\.sh"/);
  assert.match(builder, /bms-retail-local-activate/);
  assert.match(activation, /TRANSFER_REQUESTED/);
  assert.match(activation, /\.licenseCode = \$licenseCode/);
});

test("repository release build defaults to online x64 bootstraps and keeps offline explicit", () => {
  const releaseBuilder = read("deploy/retail-local/build-release.ps1");
  const onlineBuilder = read("deploy/retail-local/build-online-bootstrap.ps1");
  assert.match(releaseBuilder, /\[ValidateSet\("Online", "Offline"\)\]\[string\]\$Distribution = "Online"/);
  assert.match(releaseBuilder, /\[switch\]\$AllowOfflineRecovery/);
  assert.match(releaseBuilder, /\$Distribution -eq "Offline" -and -not \$AllowOfflineRecovery/);
  assert.match(releaseBuilder, /-Distribution Offline -AllowOfflineRecovery/);
  assert.match(releaseBuilder, /build-online-bootstrap\.ps1/);
  assert.match(releaseBuilder, /\$Distribution -eq "Online"[\s\S]*exit 0/);
  assert.match(onlineBuilder, /public keyring ต้องไม่มี private key/);
  assert.match(onlineBuilder, /build รองรับเฉพาะ x64/);
  assert.match(onlineBuilder, /AllowTestEndpoints/);
  assert.match(onlineBuilder, /SMOKE-ONLY/);
  assert.match(onlineBuilder, /windows-x64\$artifactQualifier\.exe/);
  assert.match(onlineBuilder, /linux-x64\$artifactQualifier\.deb/);
  assert.match(onlineBuilder, /runtime-rootfs\\bms-wsl-keepalive/);
  assert.match(onlineBuilder, /Length -gt 25MB/);
  assert.doesNotMatch(onlineBuilder, /docker image save|package\.ps1/);
});

test("Windows local release test uses production-format signing without serving private keys", () => {
  const onlineBuilder = read("deploy/retail-local/build-online-bootstrap.ps1");
  const prepare = read("deploy/retail-local/managed-runtime/windows/prepare-local-test-release.ps1");
  const stop = read("deploy/retail-local/managed-runtime/windows/stop-local-test-release.ps1");
  const keyGenerator = read("deploy/retail-local/managed-runtime/create-local-test-signing-key.mjs");
  const server = read("deploy/retail-local/managed-runtime/serve-local-test-release.mjs");

  assert.match(onlineBuilder, /parsed\.Host -eq "localhost"/);
  assert.match(prepare, /create-local-test-signing-key\.mjs/);
  assert.match(prepare, /sign-release\.mjs/);
  assert.match(prepare, /verify-release\.mjs/);
  assert.match(prepare, /docker image save/);
  assert.match(prepare, /docker export/);
  assert.match(prepare, /BMS_SOURCE_COMMIT[\s\S]*org\.opencontainers\.image\.revision[\s\S]*server-only/);
  assert.match(prepare, /publicRoot = Join-Path \$outputRoot "public"/);
  assert.match(prepare, /secretRoot = Join-Path \$outputRoot "secrets"/);
  assert.match(prepare, /--range 0-31/);
  assert.match(prepare, /-AllowTestEndpoints/);
  assert.match(keyGenerator, /generateKeyPairSync\("ed25519"\)/);
  assert.match(keyGenerator, /formatVersion: 1/);
  assert.match(server, /Accept-Ranges/);
  assert.match(server, /Content-Range/);
  assert.match(server, /listen\(port, "127\.0\.0\.1"/);
  assert.doesNotMatch(server, /private|secrets/i);
  assert.match(stop, /FindByThumbprint/);
  assert.match(stop, /ไม่ใช่ local test release server/);
});

test("Linux release preparation builds all signed payload components before signing", () => {
  const prepare = read("deploy/retail-local/managed-runtime/linux/prepare-release.sh");
  for (const name of ["web", "ws", "postgres", "redis", "runtime", "compose", "desktop", "shop-archetypes"]) {
    assert.match(prepare, new RegExp(`${name}\\.artifact`));
  }
  assert.match(prepare, /packages\/retail-local-contract\/shop-archetypes\.json/);
  assert.match(prepare, /docker buildx build --platform linux\/amd64 --provenance=false --load/);
  assert.match(prepare, /BMS_SOURCE_COMMIT[\s\S]*org\.opencontainers\.image\.revision[\s\S]*server-only/);
  assert.match(prepare, /docker image inspect --format '\{\{\.Id\}\}'/);
  assert.match(prepare, /release-descriptor\.json[\s\S]*sign-release\.mjs/);
  assert.match(prepare, /BMS_ALLOW_LOCAL_RELEASE_SIGNING=1/);
});

test("Retail Local licensing records evidence but can never stop store operations", () => {
  const design = read("docs/business/retail-local-managed-runtime.md");
  const invariants = read("docs/agent-invariants.md");
  const agent = read("apps/retail-local-agent/license_evidence.go");
  const linuxService = read("deploy/retail-local/managed-runtime/linux/bms-retail-local.service");
  const linuxEvidenceService = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-license-evidence.service");
  const linuxEvidenceTimer = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-license-evidence.timer");
  const linuxInstaller = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const linuxUninstall = read("deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh");
  const windowsInstaller = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const macosInstaller = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const windowsUninstall = read("deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1");
  const controlPlane = read("apps/web/lib/bms/retailLocalLicensing.ts");
  const controlPlaneMigration = read("db/migrations/10.16__bms_retail_local_license_control_plane.sql");
  const schema = json("deploy/retail-local/managed-runtime/license-evidence.schema.json");

  assert.match(design, /no remote\s+kill switch/i);
  assert.match(design, /Existing installations remain\s+operational throughout review/);
  assert.match(invariants, /licensing is evidence-only and fail-open/i);
  assert.match(invariants, /never stop an already-installed shop/);
  assert.match(agent, /ed25519\.Sign/);
  assert.match(agent, /PreviousEventHash/);
  assert.match(agent, /Authorization", "Bearer /);
  assert.match(agent, /Deliberately fail-open/);
  assert.match(linuxService, /ExecStartPost=-.*license-pulse/);
  assert.match(linuxEvidenceService, /ExecStart=-.*license-pulse/);
  assert.match(linuxEvidenceTimer, /OnCalendar=\*-\*-\* 03:00:00[\s\S]*Persistent=true/);
  assert.match(linuxInstaller, /enable --now bms-retail-local-license-evidence\.timer[\s\S]*\|\|[\s\S]*ร้านยังใช้งานได้/);
  assert.match(windowsInstaller, /New-ScheduledTaskTrigger -Daily[\s\S]*License Evidence/);
  assert.match(macosInstaller, /license-record[\s\S]*INSTALLATION_REGISTERED/);
  assert.match(macosInstaller, /license-pulse[\s\S]*\|\| true/);
  assert.match(linuxUninstall, /INSTALLATION_DEACTIVATED[\s\S]*\|\| true/);
  assert.match(windowsUninstall, /BMS Retail Local License Evidence/);
  assert.match(windowsUninstall, /INSTALLATION_DEACTIVATED/);
  assert.ok(windowsUninstall.indexOf("Stop-AndRemoveScheduledTask $taskName") <
    windowsUninstall.indexOf("INSTALLATION_DEACTIVATED"));
  assert.ok(schema.properties.event.properties.eventType.enum.includes("RUNTIME_SEEN"));
  assert.equal(JSON.stringify(schema).includes("hardwareSerial"), false);
  assert.equal(JSON.stringify(schema).includes("macAddress"), false);
  assert.equal(JSON.stringify(schema).includes("gps"), false);
  assert.match(controlPlane, /crypto\.verify/);
  assert.match(controlPlane, /EVENT_CHAIN_CONFLICT/);
  assert.match(controlPlaneMigration, /Human back-office review queue[\s\S]*never disables an installed shop/);
});

test("activation and replacement recovery preserve business continuity without copying bearer credentials", () => {
  const linuxInstaller = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const linuxActivation = read("deploy/retail-local/managed-runtime/linux/activate-managed-runtime.sh");
  const windowsInstaller = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const macosInstaller = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const windowsActivation = read("deploy/retail-local/managed-runtime/windows/activate-managed-runtime.ps1");
  const activationRoute = read("apps/web/app/api/bms/retail-local/activate/route.ts");
  const localctl = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-localctl");

  assert.match(linuxInstaller, /Activation ยังไม่สำเร็จ[\s\S]*ร้านติดตั้งและใช้งานต่อได้/);
  assert.match(windowsInstaller, /Activation ยังไม่สำเร็จ[\s\S]*การติดตั้งและการใช้งานร้านจะดำเนินต่อ/);
  assert.match(macosInstaller, /Activation ยังไม่สำเร็จ[\s\S]*ร้านจะติดตั้งและใช้งานต่อได้/);
  assert.match(linuxActivation, /--transfer[\s\S]*TRANSFER_REQUESTED/);
  assert.match(windowsActivation, /\[switch\]\$Transfer[\s\S]*TRANSFER_REQUESTED/);
  assert.match(windowsActivation, /runtime-read[\s\S]*\/var\/lib\/bms-retail-local\/installation\.json/);
  assert.match(linuxActivation, /activation_uri[\s\S]*\/api\/bms\/retail-local\/license-evidence/);
  assert.match(windowsActivation, /GetLeftPart\(\[UriPartial\]::Authority\)[\s\S]*\/api\/bms\/retail-local\/license-evidence/);
  assert.doesNotMatch(activationRoute, /evidenceEndpoint|new URL\(/);
  assert.ok(linuxActivation.indexOf("tenant_id=$(jq") < linuxActivation.indexOf("activation_result=$(curl"));
  assert.ok(windowsActivation.indexOf("runtime-read") < windowsActivation.indexOf("Invoke-RestMethod"));
  assert.match(localctl, /installation\.json/);
  assert.doesNotMatch(localctl, /license-evidence|evidenceToken|ingestionToken/);
  assert.match(linuxInstaller, /licenseCode/);
  assert.match(windowsInstaller, /licenseCode/);
  assert.match(macosInstaller, /licenseCode/);
});

test("stable promotion requires current external evidence for every GA gate", () => {
  const target = "ubuntu-24.04-lts-x64";
  const descriptor = {
    releaseVersion: "1.0.0", platformTarget: target, sourceCommit: "a".repeat(40), channel: "stable",
  };
  const ids = [
    "production-release-key", "transactional-update-rollback", "replacement-machine-restore",
    "power-loss-recovery", "disk-full-recovery", "suspend-resume", "printer-scanner-display",
    "encrypted-off-host-backup", "remote-diagnostics-privacy", "license-control-plane",
    `clean-install-${target}`, "linux-package-signing",
  ];
  const evidence = {
    formatVersion: 1, product: "BMS Retail Local", releaseVersion: "1.0.0",
    platformTarget: target, sourceCommit: "a".repeat(40),
    gates: ids.map((id) => ({
      id, status: "passed", verifiedAt: "2026-09-25T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z", evidence: [`https://evidence.example/${id}`],
    })),
  };
  const verified = verifyPromotionEvidence(evidence, descriptor, new Date("2026-09-26T00:00:00Z"));
  assert.equal(verified.gates.length, 12);
  assert.throws(() => verifyPromotionEvidence({ ...evidence, gates: evidence.gates.slice(1) }, descriptor,
    new Date("2026-09-26T00:00:00Z")), /production-release-key/);
  assert.throws(() => verifyPromotionEvidence(evidence, { ...descriptor, sourceCommit: "b".repeat(40) },
    new Date("2026-09-26T00:00:00Z")), /sourceCommit/);
  assert.throws(() => verifyPromotionEvidence(evidence, descriptor, new Date("2027-02-01T00:00:00Z")), /หมดอายุ/);
  assert.throws(() => verifyPromotionEvidence(
    { ...evidence, platformTarget: "ubuntu-99.99-lts-x64" },
    { ...descriptor, platformTarget: "ubuntu-99.99-lts-x64" },
    new Date("2026-09-26T00:00:00Z"),
  ), /support matrix/);

  const esuTarget = "windows-10-22h2-esu-x64";
  const esuDescriptor = { ...descriptor, platformTarget: esuTarget };
  const esuBaseIds = ids.filter((id) => id !== `clean-install-${target}` && id !== "linux-package-signing")
    .concat(`clean-install-${esuTarget}`, "windows-authenticode");
  const esuEvidence = {
    ...evidence,
    platformTarget: esuTarget,
    gates: esuBaseIds.map((id) => ({
      id, status: "passed", verifiedAt: "2026-09-25T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z", evidence: [`https://evidence.example/${id}`],
    })),
  };
  assert.throws(() => verifyPromotionEvidence(esuEvidence, esuDescriptor,
    new Date("2026-09-26T00:00:00Z")), /windows-10-esu/);

  const signer = read("deploy/retail-local/managed-runtime/sign-release.mjs");
  assert.match(signer, /descriptor\.channel === "stable"[\s\S]*promotionEvidencePath/);
  assert.match(signer, /BMS_ALLOW_STABLE_RELEASE_SIGNING/);
});

test("release staging isolates resumable progress by release version", () => {
  const stage = read("apps/retail-local-agent/stage.go");
  assert.match(stage, /statePath := filepath\.Join\(releaseRoot, "install-state\.json"\)/);
  assert.doesNotMatch(stage, /statePath := filepath\.Join\(root, "install-state\.json"\)/);
});

test("runtime doctor requires every authoritative service to be ready", () => {
  const localctl = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-localctl");
  assert.match(localctl, /for service in postgres redis web ws/);
  assert.match(localctl, /running\|healthy/);
  assert.doesNotMatch(localctl, /ps --status running postgres redis web ws \| grep -q/);
});

test("Web image build memory is configurable without editing release sources", () => {
  const dockerfile = read("apps/web/Dockerfile");
  const productionCompose = read("docker-compose.prod.yml");
  const releaseBuilder = read("deploy/retail-local/managed-runtime/linux/prepare-release.sh");
  assert.match(dockerfile, /ARG NEXT_BUILD_CPUS=2/);
  assert.match(dockerfile, /ARG NODE_BUILD_MAX_OLD_SPACE_SIZE=4096/);
  assert.match(dockerfile, /ENV NODE_OPTIONS=--max-old-space-size=\$NODE_BUILD_MAX_OLD_SPACE_SIZE/);
  assert.match(productionCompose, /NEXT_BUILD_CPUS: \$\{NEXT_BUILD_CPUS:-2\}/);
  assert.match(productionCompose, /NODE_BUILD_MAX_OLD_SPACE_SIZE: \$\{NODE_BUILD_MAX_OLD_SPACE_SIZE:-4096\}/);
  assert.match(releaseBuilder, /--build-arg NEXT_BUILD_CPUS=/);
  for (const secret of ["ADMIN_TOKEN", "JWT_SECRET", "FCM_PRIVATE_KEY", "NEXT_PUBLIC_SENDGRID_API_KEY"]) {
    assert.doesNotMatch(dockerfile, new RegExp(`(?:ARG|ENV) ${secret}(?:=|\\s|$)`));
  }
});

test("installed-shop updates are signed, newer-only, backup-first, and recoverable", () => {
  const agentMain = read("apps/retail-local-agent/main.go");
  const release = read("apps/retail-local-agent/release.go");
  const transaction = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-update-transaction");
  const linuxUpdateCommand = read("deploy/retail-local/managed-runtime/linux/bms-retail-local-update");
  const linuxUpdater = read("deploy/retail-local/managed-runtime/linux/update-managed-runtime.sh");
  const windowsUpdater = read("deploy/retail-local/managed-runtime/windows/update-managed-runtime.ps1");
  const windowsInstaller = read("deploy/retail-local/managed-runtime/windows/BMSRetailLocal.iss");
  const linuxService = read("deploy/retail-local/managed-runtime/linux/bms-retail-local.service");
  const wslKeepalive = read("deploy/retail-local/managed-runtime/runtime-rootfs/bms-wsl-keepalive");
  const managedRuntimeDoc = read("docs/business/retail-local-managed-runtime.md");
  const invariants = read("docs/agent-invariants.md");

  assert.match(agentMain, /case "verify-update"/);
  assert.match(agentMain, /case "check-update"[\s\S]*"updateAvailable": comparison > 0/);
  assert.match(agentMain, /ปฏิเสธ release replay\/downgrade/);
  assert.match(release, /compareSemver/);
  assert.match(transaction, /bms-localctl backup[\s\S]*write_phase "\$version" backed-up/);
  assert.match(transaction, /compose run --rm migrate[\s\S]*wait_healthy/);
  assert.match(transaction, /rollback_safe[\s\S]*bms-localctl restore/);
  assert.match(transaction, /พบ update ที่ถูกขัดจังหวะ[\s\S]*rollback "\$version"/);
  const commitBlock = transaction.slice(transaction.indexOf("  commit)"), transaction.indexOf("  rollback)"));
  assert.ok(commitBlock.indexOf("take_lock") < commitBlock.indexOf("read_phase"));
  assert.match(linuxUpdater, /verify-update[\s\S]*engine-load[\s\S]*bms-update-transaction begin/);
  assert.match(windowsUpdater, /verify-update[\s\S]*engine-load[\s\S]*Invoke-Transaction @\("begin"/);
  assert.match(windowsUpdater, /function Invoke-WslCommand[\s\S]*ExitCode = \$exitCode/);
  assert.match(windowsUpdater, /BMS_PROGRESS[\s\S]*Write-Progress/);
  assert.match(agentMain, /"channel":\s+verified\.Payload\.Channel/);
  assert.match(linuxUpdateCommand, /--check[\s\S]*--yes[\s\S]*update-managed-runtime\.sh/);
  assert.match(linuxUpdater, /preflight[\s\S]*check-update[\s\S]*updateAvailable[\s\S]*mode == check[\s\S]*พิมพ์ UPDATE[\s\S]*stage-release/);
  assert.match(windowsUpdater, /preflight[\s\S]*check-update[\s\S]*updateAvailable[\s\S]*\$CheckOnly[\s\S]*Read-Host[\s\S]*stage-release/);
  assert.match(windowsInstaller, /Check for Updates[\s\S]*-CheckOnly[\s\S]*BMS Retail Local Update/);
  assert.ok(linuxUpdater.indexOf("mode == check") < linuxUpdater.indexOf("install -m 0755 -o root -g root \"$localctl_source\""));
  assert.ok(windowsUpdater.indexOf("if ($CheckOnly)") < windowsUpdater.indexOf("runtime-install-control"));
  assert.match(linuxService, /ExecStartPre=.*bms-update-transaction recover/);
  assert.match(wslKeepalive, /bms-update-transaction recover/);
  for (const doc of [managedRuntimeDoc, invariants]) {
    assert.match(doc, /user-initiated|operator-initiated/);
    assert.match(doc, /signed release (manifest|metadata)/);
    assert.match(doc, /preflight/);
    assert.match(doc, /verified encrypted backup|verified backup/);
    assert.match(doc, /health-gated commit|health checks before committing success/);
    assert.match(doc, /rollback\/full restore|full data restore|schema-incompatible failure restores/);
    assert.match(doc, /trial expiry must never block corrective updates|license\/trial state must not block/);
  }
});
