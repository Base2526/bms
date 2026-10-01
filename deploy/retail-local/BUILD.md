# Build BMS Retail Local installers

เส้นทาง build หลักสำหรับ Windows, Ubuntu และ macOS คือ **online bootstrap** ขนาดเล็ก เครื่องร้านต้องมี
อินเทอร์เน็ตในการติดตั้งครั้งแรก ตัว installer บรรจุเฉพาะ native agent, public release keyring และ
ตัวควบคุมติดตั้ง แล้วดาวน์โหลด Web, WS, PostgreSQL, Redis, private runtime และ POS Desktop จาก
signed release manifest แบบ resume ได้ พร้อมตรวจ publisher signature, SHA-256 และ OCI digest ก่อนใช้

offline bundle ขนาดใหญ่ยังเก็บไว้เป็นทางเลือกสำหรับ recovery หรือร้านที่ได้รับอนุมัติให้ติดตั้งแบบ
ไม่มีอินเทอร์เน็ตเท่านั้น โดยต้องระบุทั้ง `-Distribution Offline` และ `-AllowOfflineRecovery`
อย่างชัดเจน ห้าม fallback จาก Online ไป Offline อัตโนมัติเมื่อ URL, keyring หรือ target ที่ต้องการ
ยังไม่พร้อม; build ต้องหยุดและแก้ prerequisite ของ Online แทน

## Architecture ที่รองรับ

| ระบบ | Retail Local Server | POS Desktop แยก | หมายเหตุ |
| --- | --- | --- | --- |
| Windows | x64 | x64, x86 legacy | Windows x86 รันได้เฉพาะ POS client ไม่ใช่ local server |
| Ubuntu 22.04/24.04 | x64 | x64 | Electron 43 และ runtime images ไม่มี Linux 32-bit target |
| macOS 15+ | Apple Silicon/Intel | Apple Silicon/Intel | online bootstrap แยกสถาปัตยกรรม; ยังเป็น unsigned technical pilot |

ห้ามสร้างหรือเผยแพร่ Retail Local Server เป็น x86/32-bit เพราะ preflight, support matrix,
PostgreSQL/Redis images และ Electron รุ่นที่ใช้อยู่ไม่รองรับปลายทางนั้น สคริปต์ build ค่าเริ่มต้นและ
ผลลัพธ์ทั้งหมดเป็น x64; การส่ง `-Architecture x86` จะหยุดพร้อม error

## สิ่งที่ต้องมีสำหรับ online bootstrap

- Windows 11 x64 และ PowerShell 7 (`pwsh`)
- Go ตาม `apps/retail-local-agent/go.mod`
- Inno Setup 6
- WSL2 + Ubuntu สำหรับประกอบแพ็กเกจ `.deb`
- public-key-only Ed25519 keyring จากระบบ release ที่เชื่อถือได้
- HTTPS URL ของ signed manifest แยก Windows, Ubuntu, macOS Apple Silicon และ macOS Intel

private release key ต้องอยู่ใน isolated signing service เท่านั้น ห้ามวางไว้ใน repository,
installer หรือเครื่องร้าน

## 1. เปลี่ยน version

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13 -UpdateVersion
git add apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "build: bump Retail Local to 0.2.13"
```

## 2. Build online bootstrap บน Windows

```powershell
pwsh .\deploy\retail-local\build-release.ps1 `
  -Version 0.2.13 `
  -Keyring C:\secure\bms\trusted-release-keys.json `
  -WindowsManifestUri https://releases.example.com/retail-local/windows-11-x64/release.jws.json `
  -WindowsX86ManifestUri https://releases.example.com/retail-local/windows-10-x86-pos/release.jws.json `
  -LinuxManifestUri https://releases.example.com/retail-local/ubuntu-24.04-lts-x64/release.jws.json `
  -ActivationUri https://control.example.com/api/bms/retail-local/activate
```

ผลลัพธ์หลักอยู่ใน `artifacts/retail-local/`:

- `BMS-Retail-Local-Server-POS-<version>-windows-x64.exe`
- `BMS-Retail-Local-Server-POS-<version>-linux-x64.deb`
- `BMS-Retail-Local-POS-<version>-windows-x64.exe`
- `BMS-Retail-Local-POS-<version>-windows-x86-legacy.exe`
- `BMS-Retail-Local-POS-<version>-linux-x64.deb`
- `.sha256` และ `.json` metadata ของแต่ละไฟล์

ชื่อ `server-pos` หมายถึง signed manifest มี POS Desktop เป็น component ที่ดาวน์โหลดหลังตรวจสอบ
ไม่ได้หมายความว่า Electron มี database หรือ business logic ของตัวเอง

POS-only ทั้งสามไฟล์เป็น bootstrap ขนาดเล็กเช่นกัน ไม่ได้ฝัง Electron ไว้ใน installer และใช้
`stage-desktop` ดาวน์โหลดเฉพาะ Desktop component แบบ resume ได้ Windows x86 ใช้ signed manifest
แยกจาก x64 เพราะตัว Electron installer คนละสถาปัตยกรรม ส่วน Linux x86 ไม่มี target ที่รองรับ

Builder ปกติปฏิเสธโดเมนตัวอย่างและ `.invalid` เพื่อไม่ให้ไฟล์ทดสอบถูกส่งให้ร้านโดยบังเอิญ
`-AllowTestEndpoints` มีไว้สำหรับ smoke test ภายในเท่านั้น และเติม `SMOKE-ONLY` ในชื่อ artifact
อัตโนมัติ

## 3. Build offline recovery bundle

ใช้เฉพาะเมื่อตั้งใจสร้าง payload เต็มขนาดใหญ่และ Docker Desktop พร้อมทำงาน:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 `
  -Version 0.2.13 -Distribution Offline -AllowOfflineRecovery
```

เส้นทางนี้สร้าง Server, Server + POS, POS-only และ image archive แบบเดิม จึงใช้พื้นที่ build มากกว่า
20 GB และ artifact รวมหลาย GB ห้ามใช้เป็นค่าเริ่มต้นสำหรับการ upload release

## 4. Build macOS online bootstrap

เตรียม signed release แยกตาม CPU ก่อน ตัวอย่าง Apple Silicon (Intel เปลี่ยนเป็น `x64` และใช้
`BMS POS.app` ที่ build สำหรับ Intel):

```bash
deploy/retail-local/managed-runtime/macos/prepare-release.sh \
  --version 0.2.13 \
  --architecture arm64 \
  --base-url https://releases.example.com/retail-local/0.2.13/macos-15-arm64 \
  --desktop-app 'apps/desktop/dist/mac-arm64/BMS POS.app' \
  --private-key /secure/bms-release/release-private.pem \
  --key-id production-2026-09
```

จากนั้น upload เฉพาะไฟล์ใน release directory ไปยัง `--base-url` เดิม แล้วสร้าง bootstrap ทั้งสอง CPU
บน Mac จริง:

```powershell
pwsh ./deploy/retail-local/build-release.ps1 `
  -Version 0.2.13 -Target MacOS -Distribution Online `
  -Keyring /secure/bms-release/trusted-release-keys.json `
  -MacArm64ManifestUri https://releases.example.com/retail-local/0.2.13/macos-15-arm64/release.jws.json `
  -MacX64ManifestUri https://releases.example.com/retail-local/0.2.13/macos-15-x64/release.jws.json
```

ผลลัพธ์รวม 4 ไฟล์: `.pkg` online bootstrap สองไฟล์ และ POS-only `.dmg` online bootstrap สองไฟล์
สำหรับ `arm64` และ Intel `x64` ตามลำดับ ทั้ง `.pkg` และ `.dmg` ไม่มี Electron, Lima, Ubuntu,
Moby หรือ service images ฝังอยู่ จึงมีขนาดเล็ก ตัว POS-only จะดาวน์โหลดเฉพาะ signed
`desktop.artifact` ที่ตรงกับ CPU ในการติดตั้งครั้งแรก ส่วน Server + POS จะดาวน์โหลดทุก component
ที่จำเป็น หลัง setup ร้านแล้ว private runtime ยังทำงานในเครื่องตามเดิม (Intel คือ x64 ไม่ใช่
macOS 32-bit)

- `BMS-Retail-Local-Server-POS-<version>-arm64.pkg`
- `BMS-Retail-Local-Server-POS-<version>-x64.pkg`
- `BMS-Retail-Local-POS-<version>-macos-arm64.dmg`
- `BMS-Retail-Local-POS-<version>-macos-x64.dmg`

เมื่อต้องสร้าง full offline recovery package ให้ระบุ Offline อย่างชัดเจน:

```powershell
pwsh ./deploy/retail-local/build-release.ps1 `
  -Version 0.2.13 -Target MacOS -Distribution Offline -AllowOfflineRecovery
```

ทุก installer ปัจจุบันยัง unsigned internal technical pilot จนกว่าจะผ่าน code signing,
clean-machine, update/rollback, backup/restore และ hardware acceptance gates ห้ามใช้ `-SkipTests`
กับไฟล์ที่จะส่งให้ร้าน

## Release gate สำหรับ Online Installer

การ build สำเร็จอย่างเดียวไม่ถือว่าพร้อมปล่อย Workflow
`.github/workflows/retail-local-managed-runtime.yml` ต้องผ่านทั้งสามระบบก่อนสร้าง release:

- Windows: build Server + POS x64 และ POS-only x64/x86 ด้วย Inno Setup จริง
- Ubuntu: build และ inspect Server + POS กับ POS-only `.deb` จริง
- macOS: build Server + POS `.pkg` และ POS-only `.dmg` สำหรับ Apple Silicon/Intel บน runner macOS จริง

ทุก online bootstrap ต้องไม่เกิน 25 MiB และต้องไม่มี service image, Electron หรือ application
payload ฝังอยู่ การติดตั้งครั้งแรกจึงต้องต่ออินเทอร์เน็ตเพื่อดาวน์โหลด signed manifest และ payload
ที่ตรงกับ OS/CPU แบบ resume ได้

The native CI jobs also execute `scripts/retail-local-bootstrap-behavior.test.mjs`: Windows POS
must return failure when its child setup fails or is cancelled, and macOS progress must handle
events without optional fields. Linux runs data-preserving uninstall in a disposable container
with a deliberately stuck service. Manifest requests have a 60-second request limit; Unix
installers additionally stop a stalled response and retry within a bounded window. Payload
downloads retain their separate idle timeout so a large download can continue while bytes arrive.

These are controlled failure tests, not evidence that a production signed release has completed
first-run provisioning on every supported machine. CI smoke artifacts use test endpoints and
must never be uploaded as customer installers. Existing published pilot files are not rebuilt
by this workflow.

CI นี้เป็น package-level gate ไม่แทน clean-machine acceptance ก่อนส่งลูกค้า รุ่นที่จะปล่อยจริงยังต้อง
ติดตั้งและอัปเดตบนเครื่องจริงตามรายการใน `docs/business/retail-local-ga-readiness.md`; macOS ยังเป็น
technical pilot จนกว่าจะลง Developer ID, notarize และผ่าน Gatekeeper บน Apple Silicon/Intel
