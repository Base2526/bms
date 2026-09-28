# Build BMS Retail Local แบบรวม

สคริปต์นี้ใช้บนเครื่อง Windows เพื่อ build รุ่นเดียวกันให้ครบ:

- Windows: Server + POS x64, Server x64, POS x64 และ POS x86 Legacy
- Linux: Server + POS x64 DEB, Server x64 DEB, POS x64 DEB และ POS x64 AppImage
- Server ZIP, SHA-256 sidecars, `README.md` และ `README-Linux.md`

## สิ่งที่ต้องมี

- Windows 11 x64 และ PowerShell 7 (`pwsh`)
- Node.js 22 และ npm
- Docker Desktop พร้อม Docker Compose v2
- Inno Setup 6
- พื้นที่ว่างอย่างน้อย 20 GB (แนะนำ 30 GB)

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

## 2. Build ทุกไฟล์

คำสั่งเดียว:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13
```

ไฟล์ทั้งหมดจะอยู่ใน `artifacts/retail-local/` สคริปต์จะ build Windows และ Linux ตามลำดับเพื่อไม่ให้
Inno Setup กับ `dpkg-deb` ใช้หน่วยความจำสูงพร้อมกัน และจะตรวจ version, source commit, README และ
SHA-256 ทุกไฟล์ก่อนรายงานว่าสำเร็จ

ถ้าตั้งใจ build version เดิมทับไฟล์เก่า:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 -Version 0.2.13 -Force
```

ไม่ควรใช้ `-SkipTests` สำหรับไฟล์ที่จะส่งให้ร้าน ตัวเลือกนี้มีไว้ตรวจปัญหา build ภายในเท่านั้น

> ทุก installer ปัจจุบันเป็น unsigned internal technical pilot และยังไม่มี auto-update ที่ผ่าน
> production qualification
