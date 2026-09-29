# BMS Retail Local {{VERSION}} — Windows installers

เอกสารนี้ใช้กับไฟล์ติดตั้งรุ่น `{{VERSION}}` เท่านั้น แพ็กเกจทั้งหมดเป็น **unsigned internal
technical pilot** สำหรับทดสอบภายใน ยังไม่ใช่รุ่นจำหน่ายทั่วไปและยังไม่มี auto-update อย่าใช้ข้อมูล
ลูกค้าจริงจนกว่าจะผ่านการทดสอบเครื่องจริง การสำรอง/กู้คืน ไฟดับ พื้นที่เต็ม และอุปกรณ์หน้าร้านแล้ว

## เลือกไฟล์ให้ถูก

| ไฟล์ | ใช้เมื่อ | มี Server | มี POS | ระบบปฏิบัติการ |
| --- | --- | ---: | ---: | --- |
| `BMS-Retail-Local-Server-POS-{{VERSION}}-windows-x64.exe` | ร้านมีคอมพิวเตอร์หลักเครื่องเดียวและต้องการทั้งระบบหลังบ้านกับจุดขาย | ✓ | ✓ x64 | Windows 11 x64 |
| `BMS-Retail-Local-Server-{{VERSION}}-windows-x64.exe` | เครื่องนี้ทำหน้าที่ Server/หลังบ้านเท่านั้น | ✓ | — | Windows 11 x64 |
| `BMS-Retail-Local-POS-{{VERSION}}-windows-x64.exe` | เครื่องขาย Windows 64-bit ที่เชื่อมต่อ Server อยู่แล้ว | — | ✓ x64 | Windows 10/11 x64 |
| `BMS-Retail-Local-POS-{{VERSION}}-windows-x86-legacy.exe` | เครื่องขายเก่า Windows 32-bit; ใช้เมื่อเปลี่ยนเครื่องยังไม่ได้ | — | ✓ x86 | Windows 10 x86 หรือ Windows 10/11 x64 ผ่าน WOW64 |

`POS x86 Legacy` ไม่ได้ติดตั้งฐานข้อมูลหรือ Server และไม่ทำให้เครื่อง 32-bit ขายแบบ offline ได้เอง
เครื่องนั้นต้องเชื่อมต่อ BMS Server ตลอดเวลา ใช้ x64 แทนเสมอเมื่อฮาร์ดแวร์รองรับ

## 1. Server + POS x64

ไฟล์: `BMS-Retail-Local-Server-POS-{{VERSION}}-windows-x64.exe`

- Windows 11 64-bit ที่ยังได้รับอัปเดต
- CPU x86-64 ที่เปิด Intel VT-x/AMD-V หรือ hardware virtualization ใน BIOS/UEFI
- RAM อย่างน้อย 8 GB; แนะนำ 16 GB สำหรับใช้งานพร้อม POS และสำรองข้อมูล
- พื้นที่ว่างขั้นต่ำที่ preflight ยอมรับ 8 GB; ควรมีอย่างน้อย 15 GB และมีพื้นที่แยกสำหรับ backup
- PowerShell 7 (`pwsh`)
- Docker Desktop รุ่นปัจจุบัน ใช้ WSL 2 backend และมี Docker Compose v2
- พอร์ต `127.0.0.1:3100` และ `127.0.0.1:3101` ต้องว่าง
- ควรมี UPS และสื่อสำรองข้อมูลเข้ารหัสที่ไม่ได้อยู่บน disk ลูกเดียวกับ Windows

EXE ฝัง Web, WS, PostgreSQL และ Redis images ไว้แล้ว จึงไม่ต้องดาวน์โหลด images ระหว่างติดตั้ง
แต่ยังต้องติดตั้งและเปิด Docker Desktop ให้ engine พร้อมก่อนเริ่ม หลัง Server สร้าง
`installation.json` สำเร็จ installer จึงเปิดตัวติดตั้ง POS x64 ต่อ

## 2. Server x64

ไฟล์: `BMS-Retail-Local-Server-{{VERSION}}-windows-x64.exe`

ใช้ข้อกำหนดเดียวกับ Server + POS ด้านบน แต่ไม่มีโปรแกรม POS Desktop เหมาะกับเครื่องหลังบ้านที่เปิด
Web Admin ผ่าน `http://127.0.0.1:3100/admin/login`

แพ็กเกจ Pilot นี้ bind Web/WS เฉพาะ loopback เพื่อความปลอดภัย จึง **ไม่เปิดให้เครื่องอื่นใน LAN
เชื่อมต่อโดยอัตโนมัติ** การเปิด Server ให้ LAN/Internet ต้องมี HTTPS, firewall, certificate และ
security design แยกต่างหาก ห้ามแก้เป็น `0.0.0.0` แล้วใช้งานจริงโดยไม่มีการออกแบบดังกล่าว

## 3. POS x64

ไฟล์: `BMS-Retail-Local-POS-{{VERSION}}-windows-x64.exe`

- Windows 10/11 64-bit; ถ้าเป็น Windows 10 ต้องมี ESU/LTSC ที่ยังได้รับ security update
- ไม่รองรับ Windows 7, 8 หรือ 8.1
- RAM 4 GB ขึ้นไปสำหรับการทดสอบ; แนะนำ 8 GB เมื่อเปิดโปรแกรมอื่นร่วมด้วย
- ควรมีพื้นที่ว่างอย่างน้อย 1 GB สำหรับตัวโปรแกรม ไฟล์ชั่วคราว และ log
- ต้องมีการเชื่อมต่อที่เสถียรไปยัง BMS Server
- ไม่ต้องติดตั้ง Docker Desktop, PostgreSQL, Node.js หรือ PowerShell 7 หากใช้เป็น POS อย่างเดียว
- Token จับคู่จากหน้า Admin > POS Devices; token แสดงครั้งเดียวและเก็บด้วย Windows DPAPI

ถ้าใช้กับ Server + POS ในเครื่องเดียว ให้จับคู่กับ `http://127.0.0.1:3100` ถ้าใช้ Server ภายนอก
ต้องใช้ HTTPS; โปรแกรมปฏิเสธ HTTP ที่ไม่ใช่ localhost เพราะ device token เป็น bearer credential

## 4. POS x86 Legacy

ไฟล์: `BMS-Retail-Local-POS-{{VERSION}}-windows-x86-legacy.exe`

- สำหรับ CPU/Windows x86 32-bit หรือ Windows x64 ที่ยังต้องใช้แอป 32-bit
- รองรับ Windows 10 ที่ยังมี ESU/LTSC security update หรือรันผ่าน WOW64 บน Windows x64 ที่รองรับ
- **ไม่รองรับ Windows 7, 8 หรือ 8.1** และไม่มี Windows 11 รุ่น 32-bit
- RAM 4 GB แนะนำ; ควรมีพื้นที่ว่างอย่างน้อย 700 MB
- ต้องเชื่อมต่อ BMS Server ตลอดเวลา และไม่มีฐานข้อมูล/offline tender ในตัว
- ไม่ต้องใช้ Docker Desktop หรือ PowerShell 7
- เป็นทางประคองเครื่องเก่า ไม่ใช่เป้าหมายระยะยาว: Electron 43 เป็นสายสุดท้ายที่มี Windows ia32
  และ upstream ยุติการรองรับสายนี้ในเดือนมกราคม 2027

อย่านำไฟล์ x86 ไปลงช่อง release `windows-x64`; release catalog ต้องมี platform
`windows-x86-legacy` แยกก่อนจึงจะเผยแพร่ผ่านหน้า download ได้อย่างถูกต้อง

## Internet และระบบเครือข่าย

| กรณี | ต้องใช้อินเทอร์เน็ตหรือไม่ |
| --- | --- |
| ติดตั้ง Server จาก EXE เมื่อ Docker Desktop/PowerShell 7 มีแล้ว | ไม่ต้องดาวน์โหลด application images |
| ขายเงินสดธรรมดาบน Server ในเครื่องเดียวกัน | ทำงานได้เมื่ออินเทอร์เน็ตขาดหลังระบบเริ่มสำเร็จ |
| POS ต่อ Cloud/Server ภายนอก | ต้องมี LAN/Internet ที่เข้าถึง Server ได้ตลอด |
| AI, email, LINE/social, payment provider, carrier, delivery platform, e-Tax | ต้องใช้อินเทอร์เน็ตและบัญชี provider จริง |
| Backup ไป NAS/cloud | ต้องเข้าถึงปลายทางนั้น; backup บน disk เดียวกับ Server ไม่ถือเป็น off-host backup |

Desktop POS ไม่มี Emergency Offline Mode หากติดต่อ Server ไม่ได้จะไม่สามารถทำรายการขายใหม่ได้

## อุปกรณ์หน้าร้าน

| อุปกรณ์ | สถานะ/ข้อกำหนด |
| --- | --- |
| Barcode scanner USB/Bluetooth HID | ใช้แบบ keyboard-wedge ได้ แนะนำตั้ง Prefix Mode เช่น `F9 + barcode + Enter/Tab`; ต้องทดสอบรุ่นจริง |
| เครื่องชั่ง | รองรับการอ่าน barcode ฉลากน้ำหนัก prefix `22`; ไม่ใช่การต่อเครื่องชั่ง USB/Serial โดยตรง และ prefix `21` ที่ฝังราคาจะถูกปฏิเสธ |
| เครื่องพิมพ์ใบเสร็จ | มี browser/system print fallback; ESC/POS USB/LAN ยังไม่ผ่านการรับรองทุกรุ่น ต้องทดสอบ printer, driver, paper size และภาษาไทยจริงก่อนใช้ |
| ลิ้นชักเก็บเงิน | การบันทึก cash in/out มีในระบบ แต่การสั่งเปิดลิ้นชักผ่านฮาร์ดแวร์ยังไม่ใช่ความสามารถที่รับรอง ห้ามถือว่าปุ่มในระบบจะเปิดลิ้นชักได้ทุกชุด |
| Customer display | รองรับจอเสริมแบบ Extend หนึ่งจอต่อหนึ่งเครื่องขาย; ห้ามตั้งเป็น Mirror และต้องทดสอบ hot-plug/resolution จริง |
| จอสัมผัส | ใช้ได้ในฐานะ pointer ของ Windows แต่ยังต้องทดสอบขนาดจอ, scaling และคีย์บอร์ดบนจอของเครื่องจริง |
| เครื่อง EDC/เครื่องรูดบัตร | ไม่มี driver เชื่อมต่อ EDC โดยตรง การเลือก Card/QR/Wallet เป็นการบันทึก tender ที่ Server ตรวจสอบตาม configuration |
| กล้องสแกน barcode | เป็นโหมดทดสอบ ไม่ใช่เส้นทาง production ที่รับรอง |
| เครื่องพิมพ์ครัว/จอครัว | เป็นคนละ surface/device กับ customer display ต้องจัดเครื่องและทดสอบ workflow แยก |

ก่อนซื้ออุปกรณ์จำนวนมาก ให้ทดสอบอย่างน้อยหนึ่งชุดจริงครบ: สแกนสินค้า, พิมพ์ไทย, เปิด/ปิดกะ,
เงินสดและเงินทอน, QR/บัตร, split payment, คืนบางรายการ, refund, customer display, suspend/reconnect
และไฟดับ

## ขั้นตอนติดตั้งย่อ

1. ตรวจ SHA-256 ของไฟล์ที่ดาวน์โหลดกับค่าด้านล่าง
2. ติดตั้ง prerequisites และเปิด Docker Desktop ก่อนติดตั้ง Server
3. เนื่องจากไฟล์ยังไม่ signed Windows SmartScreen อาจเตือน; ใช้เฉพาะไฟล์ที่ hash ตรงจากช่องทางภายใน
4. รัน EXE ด้วย Windows user ที่จะใช้ระบบประจำ ไม่ควรรันจาก OneDrive หรือ removable drive
5. ตั้งชื่อร้าน เลือกประเภทร้าน และเลือกว่าจะสร้าง Starter Catalog หรือไม่
6. ตั้งผู้ดูแล รหัสผ่าน และ PIN 4–8 หลัก
7. Starter Catalog (ถ้าเลือก) มีสินค้า Draft 4 รายการ สต็อก 0 และไม่แสดงออนไลน์; ตรวจหรือลบทั้งชุดได้ที่ Admin > เริ่มต้นใช้งาน
8. เก็บ pairing token ที่แสดงครั้งเดียว แล้วจับคู่ POS
9. เปิด Admin และรัน `doctor.ps1`; ทุกหัวข้อต้องผ่านก่อนทดลองขาย
10. ทดสอบ backup และ restore บนเครื่องทดสอบก่อนใช้ข้อมูลที่สำคัญ

## SHA-256

```text
{{SERVER_POS_SHA256}}  BMS-Retail-Local-Server-POS-{{VERSION}}-windows-x64.exe
{{SERVER_SHA256}}  BMS-Retail-Local-Server-{{VERSION}}-windows-x64.exe
{{POS_X64_SHA256}}  BMS-Retail-Local-POS-{{VERSION}}-windows-x64.exe
{{POS_X86_SHA256}}  BMS-Retail-Local-POS-{{VERSION}}-windows-x86-legacy.exe
```

ตรวจบน PowerShell:

```powershell
Get-FileHash .\BMS-Retail-Local-Server-POS-{{VERSION}}-windows-x64.exe -Algorithm SHA256
```

## การแจ้งปัญหา

ระบุ version, ชื่อไฟล์, Windows build, CPU/RAM/disk, Docker Desktop version, รุ่น printer/scanner,
เวลาที่เกิดเหตุ และขั้นตอนล่าสุด สำหรับ Server ให้รัน `doctor.ps1 -Json` แล้วส่งเฉพาะผลที่ตรวจแล้ว
ห้ามส่ง `.env.local`, pairing token, database dump, secret, ข้อมูลลูกค้า หรือ log ที่ยังไม่ได้ตรวจ PII
