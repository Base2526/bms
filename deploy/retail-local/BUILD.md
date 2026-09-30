# Build BMS Retail Local installers

เส้นทาง build หลักสำหรับ Windows และ Ubuntu คือ **online bootstrap** ขนาดเล็ก เครื่องร้านต้องมี
อินเทอร์เน็ตในการติดตั้งครั้งแรก ตัว installer บรรจุเฉพาะ native agent, public release keyring และ
ตัวควบคุมติดตั้ง แล้วดาวน์โหลด Web, WS, PostgreSQL, Redis, private runtime และ POS Desktop จาก
signed release manifest แบบ resume ได้ พร้อมตรวจ publisher signature, SHA-256 และ OCI digest ก่อนใช้

offline bundle ขนาดใหญ่ยังเก็บไว้เป็นทางเลือกสำหรับ recovery หรือร้านที่ได้รับอนุมัติให้ติดตั้งแบบ
ไม่มีอินเทอร์เน็ตเท่านั้น โดยต้องระบุ `-Distribution Offline` อย่างชัดเจน

## Architecture ที่รองรับ

| ระบบ | Retail Local Server | POS Desktop แยก | หมายเหตุ |
| --- | --- | --- | --- |
| Windows | x64 | x64, x86 legacy | Windows x86 รันได้เฉพาะ POS client ไม่ใช่ local server |
| Ubuntu 22.04/24.04 | x64 | x64 | Electron 43 และ runtime images ไม่มี Linux 32-bit target |
| macOS 15+ | Apple Silicon/Intel | Apple Silicon/Intel | ยังเป็น full offline technical-pilot package |

ห้ามสร้างหรือเผยแพร่ Retail Local Server เป็น x86/32-bit เพราะ preflight, support matrix,
PostgreSQL/Redis images และ Electron รุ่นที่ใช้อยู่ไม่รองรับปลายทางนั้น สคริปต์ build ค่าเริ่มต้นและ
ผลลัพธ์ทั้งหมดเป็น x64; การส่ง `-Architecture x86` จะหยุดพร้อม error

## สิ่งที่ต้องมีสำหรับ online bootstrap

- Windows 11 x64 และ PowerShell 7 (`pwsh`)
- Go ตาม `apps/retail-local-agent/go.mod`
- Inno Setup 6
- WSL2 + Ubuntu สำหรับประกอบแพ็กเกจ `.deb`
- public-key-only Ed25519 keyring จากระบบ release ที่เชื่อถือได้
- HTTPS URL ของ signed manifest แยก Windows และ Ubuntu

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
  -LinuxManifestUri https://releases.example.com/retail-local/ubuntu-24.04-lts-x64/release.jws.json `
  -ActivationUri https://control.example.com/api/bms/retail-local/activate
```

ผลลัพธ์หลักอยู่ใน `artifacts/retail-local/`:

- `BMS-Retail-Local-Server-POS-<version>-windows-x64.exe`
- `BMS-Retail-Local-Server-POS-<version>-linux-x64.deb`
- `.sha256` และ `.json` metadata ของแต่ละไฟล์

ชื่อ `server-pos` หมายถึง signed manifest มี POS Desktop เป็น component ที่ดาวน์โหลดหลังตรวจสอบ
ไม่ได้หมายความว่า Electron มี database หรือ business logic ของตัวเอง

Builder ปกติปฏิเสธโดเมนตัวอย่างและ `.invalid` เพื่อไม่ให้ไฟล์ทดสอบถูกส่งให้ร้านโดยบังเอิญ
`-AllowTestEndpoints` มีไว้สำหรับ smoke test ภายในเท่านั้น และเติม `SMOKE-ONLY` ในชื่อ artifact
อัตโนมัติ

## 3. Build offline recovery bundle

ใช้เฉพาะเมื่อตั้งใจสร้าง payload เต็มขนาดใหญ่และ Docker Desktop พร้อมทำงาน:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 `
  -Version 0.2.13 -Distribution Offline
```

เส้นทางนี้สร้าง Server, Server + POS, POS-only และ image archive แบบเดิม จึงใช้พื้นที่ build มากกว่า
20 GB และ artifact รวมหลาย GB ห้ามใช้เป็นค่าเริ่มต้นสำหรับการ upload release

## 4. Build macOS technical pilot

macOS online bootstrap ยังไม่เปิดใช้ จึงต้องระบุ offline ให้ชัดเจนและ build บน Mac จริง:

```powershell
pwsh ./deploy/retail-local/build-release.ps1 `
  -Version 0.2.13 -Target MacOS -Distribution Offline
```

ทุก installer ปัจจุบันยัง unsigned internal technical pilot จนกว่าจะผ่าน code signing,
clean-machine, update/rollback, backup/restore และ hardware acceptance gates ห้ามใช้ `-SkipTests`
กับไฟล์ที่จะส่งให้ร้าน
