# Build BMS Retail Local แบบรวม

ใช้สคริปต์เดียวกันทั้ง Windows และ macOS โดยสคริปต์จะเลือกงานตามเครื่องที่กำลังรัน:

- Windows: Server + POS x64, Server x64, POS x64 และ POS x86 Legacy
- Linux: Server + POS x64 DEB, Server x64 DEB, POS x64 DEB และ POS x64 AppImage
- macOS: Server + POS และ Server สำหรับ Apple Silicon/Intel รวมทั้ง POS DMG ทั้งสอง architecture
- ทุกไฟล์มี SHA-256 sidecar และตรวจ version/source commit ก่อนรายงานว่าสำเร็จ

> Windows + Linux ต้อง build บน Windows ส่วน macOS ต้อง build บน Mac จริง
> ไม่สามารถสร้าง `.pkg`/`.dmg` ที่ใช้เผยแพร่ได้จาก Windows

## สิ่งที่ต้องมี

- Windows 11 x64 หรือ macOS 15+ บน Apple Silicon/Intel และ PowerShell 7 (`pwsh`)
- Node.js 22 และ npm
- Docker Desktop พร้อม Docker Compose v2
- Windows ต้องมี Inno Setup 6
- macOS ต้องมี Xcode Command Line Tools และ Go
- Windows ต้องมีพื้นที่ว่างอย่างน้อย 20 GB; macOS อย่างน้อย 40 GB เพราะสร้าง VM image สอง architecture

## 1. เปลี่ยน version

ตัวอย่างจะอัปเดตจากรุ่นเดิมเป็น `0.2.13` ใน `apps/desktop/package.json` และ
`apps/desktop/package-lock.json`:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13 -UpdateVersion
```

จากนั้น commit การเปลี่ยน version ก่อน build เพื่อให้ `release.json.sourceCommit` อ้าง commit ที่
ตรวจสอบย้อนหลังได้:

```powershell
git add apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "build: bump Retail Local to 0.2.13"
```

## 2. Build บน Windows

คำสั่งเดียว ได้ไฟล์ Windows + Linux ทั้งหมด:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13
```

ไฟล์ทั้งหมดจะอยู่ใน `artifacts/retail-local/` สคริปต์จะ build Windows และ Linux ตามลำดับเพื่อไม่ให้
Inno Setup กับ `dpkg-deb` ใช้หน่วยความจำสูงพร้อมกัน และจะตรวจ version, source commit, README และ
SHA-256 ทุกไฟล์ก่อนรายงานว่าสำเร็จ

## 3. Build บน macOS

checkout commit เดียวกันบน Mac แล้วใช้คำสั่งเดียวกัน:

```powershell
pwsh ./deploy/retail-local/build-release.ps1 -Version 0.2.13
```

จะได้ไฟล์ macOS 6 ไฟล์ใน `artifacts/retail-local/`: Server + POS ARM64/x64 `.pkg`, Server
ARM64/x64 `.pkg` และ POS ARM64/x64 `.dmg` แพ็กเกจ Intel ใช้ Ubuntu/Docker/service images แบบ
x86_64 จริง ไม่ได้รันผ่าน ARM emulation การ build server จะใช้ Docker เป็น build engine แต่เครื่องร้าน
ปลายทางไม่ต้องติดตั้ง Docker Desktop

ไฟล์ `.pkg`/`.dmg` ปัจจุบันยัง unsigned และไม่ได้ notarize จึงเป็น technical pilot เท่านั้น และควร
smoke test แต่ละแพ็กเกจบน Mac architecture ตรงกันก่อนส่งให้ร้าน

ถ้าต้องการระบุ target ให้ชัดเจน ใช้ `-Target WindowsLinux` บน Windows หรือ `-Target MacOS` บน Mac

ถ้าตั้งใจ build version เดิมทับไฟล์เก่า:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13 -Force
```

ไม่ควรใช้ `-SkipTests` สำหรับไฟล์ที่จะส่งให้ร้าน ตัวเลือกนี้มีไว้ตรวจปัญหา build ภายในเท่านั้น

> ทุก installer ปัจจุบันเป็น unsigned internal technical pilot และยังไม่มี auto-update ที่ผ่าน
> production qualification
