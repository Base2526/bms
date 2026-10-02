# BMS Retail Local Installation Manual

คู่มือนี้ใช้สำหรับส่งให้ลูกค้าติดตั้ง BMS Retail Local ด้วยตัวเอง โดย BMS Retail Local คือระบบหลังบ้านและ POS ที่รันบนเครื่องของร้านเอง ข้อมูลร้านอยู่บนเครื่องที่ติดตั้ง และ POS Desktop เป็นหน้าต่างสำหรับใช้งานระบบ ไม่ใช่ฐานข้อมูลอีกชุดหนึ่ง

> หมายเหตุ: ถ้าไฟล์ติดตั้งรุ่นที่ได้รับยังเป็นรุ่นทดสอบหรือยังไม่ได้ sign ระบบปฏิบัติการอาจแสดงคำเตือน SmartScreen, Gatekeeper หรือ unknown publisher ให้ติดตั้งเฉพาะไฟล์ที่ได้รับจากช่องทางทางการของ BMS เท่านั้น

## 1. เลือกไฟล์ติดตั้งให้ถูก

| ต้องการติดตั้ง | Windows | Ubuntu Linux | macOS |
| --- | --- | --- | --- |
| เครื่องหลักของร้าน รวม Server + POS | `BMS-Retail-Local-Server-POS-<version>-windows-x64.exe` | `BMS-Retail-Local-Server-POS-<version>-linux-x64.deb` | `BMS-Retail-Local-Server-POS-<version>-arm64.pkg` หรือ `...-x64.pkg` |
| เครื่อง Server อย่างเดียว | `BMS-Retail-Local-Server-<version>-windows-x64.exe` | `BMS-Retail-Local-Server-<version>-linux-x64.deb` | `BMS-Retail-Local-Server-<version>-arm64.pkg` หรือ `...-x64.pkg` |
| เครื่อง POS เพิ่มเติม | `BMS-Retail-Local-POS-<version>-windows-x64.exe` หรือ `BMS-Retail-Local-POS-<version>-windows-x86-legacy.exe` สำหรับ Windows 32-bit รุ่นเดิม | `BMS-Retail-Local-POS-<version>-linux-x64.deb` หรือ `.AppImage` | `BMS-Retail-Local-POS-<version>-macos-arm64.dmg` หรือ `...-macos-x64.dmg` |

คำแนะนำทั่วไป:

- ร้านที่มีคอมเครื่องเดียวให้ใช้ไฟล์ `Server-POS`
- `windows-x86-legacy` ใช้ได้เฉพาะ POS Desktop only และต้องเชื่อมกับ Server x64 เครื่องอื่น ห้ามใช้เป็น Server หรือ Server + POS
- ร้านที่มีเครื่อง Server แยก และมีเครื่องแคชเชียร์หลายเครื่อง ให้ติดตั้ง `Server` ที่เครื่องหลักก่อน แล้วติดตั้ง `POS` บนเครื่องแคชเชียร์เพิ่มเติม
- macOS Server+POS online bootstrap เลือกไฟล์ตาม CPU: Apple Silicon ใช้ `arm64`, Intel Mac ใช้ `x64`
- macOS POS อย่างเดียวมีทั้ง Apple Silicon (`arm64`) และ Intel (`x64`)
- ห้ามติดตั้ง Server ซ้ำหลายเครื่องสำหรับร้านเดียวกัน ถ้าต้องย้ายเครื่องให้ติดต่อ Support เพื่อทำขั้นตอน transfer/restore

วิธีดูว่า Mac เป็น Apple Silicon หรือ Intel:

1. กดเมนู Apple มุมซ้ายบน
2. เลือก **About This Mac**
3. ดูบรรทัด Chip หรือ Processor:
   - ถ้าเขียนว่า Apple M1, M2, M3 หรือ M4 ให้ใช้ไฟล์ `arm64`
   - ถ้าเขียนว่า Intel ให้ใช้ไฟล์ `x64`

ตัวอย่างชื่อไฟล์ macOS Intel รุ่น `0.2.12`:

- เครื่องหลักรวม Server + POS: `BMS-Retail-Local-Server-POS-0.2.12-x64.pkg`
- เครื่อง Server อย่างเดียวแบบ offline recovery: ติดต่อ Support
- เครื่อง POS อย่างเดียว: `BMS-Retail-Local-POS-0.2.12-macos-x64.dmg`

## 2. สิ่งที่ต้องเตรียมก่อนติดตั้ง

- อินเทอร์เน็ตระหว่างติดตั้ง เพราะ installer จะดาวน์โหลด component ที่จำเป็นและตรวจสอบ release
- RAM อย่างน้อย 8 GB
- พื้นที่ว่างอย่างน้อย 15 GB; macOS แนะนำ 30 GB
- บัญชีผู้ใช้ที่มีสิทธิ์ Administrator หรือ sudo
- Activation Code จาก BMS ถ้ามี
- UPS หรือระบบไฟที่เสถียรสำหรับเครื่องหลักของร้าน
- พื้นที่ backup แยกจากเครื่องหลัก เช่น NAS, external drive หรือ cloud drive ของร้าน

ระบบที่รองรับ:

- Windows 11 x64
- Windows 10 IoT Enterprise LTSC 2021 x64
- Windows 10 22H2 x64 เฉพาะเครื่องที่ยังอยู่ในนโยบาย support/ESU ของลูกค้า
- Ubuntu 24.04 LTS x64
- Ubuntu 22.04 LTS x64
- macOS 15 ขึ้นไปสำหรับ Retail Local Server ทั้ง Apple Silicon และ Intel Mac
- macOS 12 ขึ้นไปสำหรับ POS Desktop อย่างเดียว

## 3. ติดตั้งบน Windows

1. ดาวน์โหลดไฟล์ `.exe` ที่ตรงกับงานของเครื่องนี้
2. คลิกขวาที่ไฟล์ แล้วเลือก **Run as administrator**
3. ถ้า Windows SmartScreen แสดงคำเตือน ให้กด **More info** แล้วเลือก **Run anyway** เฉพาะกรณีที่ไฟล์มาจาก BMS เท่านั้น
4. ทำตามหน้าจอติดตั้งจนเสร็จ
5. หน้าต่าง Setup จะแสดงความคืบหน้า `[BMS 1/7]` ถึง `[BMS 7/7]`; ถ้า preflight ไม่ผ่าน ระบบจะแสดงค่าที่พบ สาเหตุ และวิธีให้เปิด installer ใหม่หลังแก้ไข
6. ถ้าเป็นเครื่อง `Server` หรือ `Server-POS` ให้รอจนระบบดาวน์โหลด component, สร้าง runtime, migrate database และ health check สำเร็จ
7. เปิดเมนู **BMS Retail Local**
8. เปิด **BMS Retail Local** หรือ **BMS POS**
9. ถ้าระบบถาม Activation Code ให้กรอกรหัสที่ได้รับจาก BMS
10. ตั้งค่าร้านครั้งแรก ได้แก่ชื่อร้าน, ประเภทร้าน, ผู้ดูแลระบบ, รหัสผ่าน และ PIN แคชเชียร์ โดยต้องยืนยันรหัสผ่านและ PIN ซ้ำ
11. เลือกว่าจะสร้างข้อมูลตัวอย่างหรือไม่ ค่าเริ่มต้นคือ **ไม่สร้าง**; ถ้าเลือกสร้าง สินค้า ลูกค้า และรายการตัวอย่างจะใช้ชุดที่เหมาะกับประเภทร้านและมีเครื่องหมายข้อมูลทดสอบ
12. เข้าหน้า POS แล้วทดสอบเปิดกะและขายสินค้าทดสอบหนึ่งรายการ

ถ้า Setup หยุดหลังสร้างร้านแล้ว ให้เปิด installer เดิมอีกครั้ง ระบบจะใช้ checkpoint ที่ป้องกันไว้และติดตั้งต่อโดยไม่สร้างร้านหรือเครื่อง POS ซ้ำ

คำสั่ง/เมนูที่ใช้บ่อยบน Windows:

- **BMS Retail Local**: เปิดระบบ
- **Activate or Transfer**: activate license หรือ transfer หลัง restore
- **Configure Off-host Backup**: ตั้งค่า backup ไปยังปลายทางนอกเครื่อง
- **Off-host Backup Status**: ตรวจสถานะ backup

การถอนผ่าน Windows Apps/Installed apps จะหยุดระบบและเก็บข้อมูลร้านไว้สำหรับ recovery พร้อมแสดงผลในหน้าต่าง PowerShell ถ้าต้องการลบถาวร ให้เปิด PowerShell แบบ Administrator หลังตรวจสอบ backup แล้วรัน:

```powershell
& "$env:ProgramData\BMS\RetailLocal\bootstrap\uninstall-managed-runtime.ps1" -EraseData
```

## 4. ติดตั้งบน Ubuntu Linux

ใช้กับ Ubuntu 24.04 LTS หรือ 22.04 LTS แบบ x64 เท่านั้น

1. เปิด Terminal ในโฟลเดอร์ที่มีไฟล์ `.deb`
2. ติดตั้ง package:

```bash
sudo apt install ./BMS-Retail-Local-Server-POS-<version>-linux-x64.deb
```

หรือถ้าเป็น Server อย่างเดียว:

```bash
sudo apt install ./BMS-Retail-Local-Server-<version>-linux-x64.deb
```

3. เริ่ม setup:

```bash
sudo bms-retail-local-setup
```

4. ทำตามคำถามบนหน้าจอ เลือกประเภทร้าน และเลือกว่าจะสร้างข้อมูลตัวอย่างตามประเภทร้านหรือไม่ ถ้าระบบถาม Activation Code ให้กรอกรหัสที่ได้รับจาก BMS
   Setup จะแสดงขั้นตอน `[BMS 1/7]` ถึง `[BMS 7/7]` และให้กรอกข้อมูลใหม่เฉพาะช่องที่ไม่ถูกต้อง
5. เมื่อติดตั้งเสร็จ ให้ตรวจสถานะ:

```bash
sudo systemctl status bms-retail-local
```

6. เปิด browser ไปที่:

```text
http://127.0.0.1:3100
```

7. ตั้งค่าร้านครั้งแรก แล้วทดสอบเปิด POS

ถ้าติดตั้ง POS Desktop อย่างเดียวบน Linux:

- ถ้าได้รับ `.deb` ให้ติดตั้งด้วย `sudo apt install ./<file>.deb`
- ถ้าได้รับ `.AppImage` ให้คลิกขวา เปิด permission ให้ execute แล้วเปิดไฟล์
- Linux ต้องมี keyring ที่ปลอดภัย เช่น GNOME Keyring, Secret Service หรือ KWallet ถ้าไม่มี ระบบจะไม่ให้ pair device token

คำสั่งที่ใช้บ่อยบน Ubuntu:

```bash
sudo systemctl status bms-retail-local
sudo systemctl restart bms-retail-local
sudo bms-retail-local-update
sudo bms-retail-local-activate
sudo bms-retail-local-backup-status
```

ถอน runtime แต่เก็บข้อมูลร้านไว้สำหรับ recovery:

```bash
sudo bms-retail-local-uninstall
```

ลบถาวรหลังตรวจสอบ backup แล้ว:

```bash
sudo bms-retail-local-uninstall --erase-data
```

ตั้งค่า off-host backup:

```bash
sudo bms-retail-local-configure-backup age1... /mnt/bms-offhost 35
sudo systemctl start bms-retail-local-offhost-backup.service
sudo bms-retail-local-backup-status
```

## 5. ติดตั้งบน macOS

macOS มี 2 แบบสำหรับลูกค้าทั่วไป:

- Retail Local Server+POS: ใช้ online bootstrap `.pkg` และเลือก `arm64` สำหรับ Apple Silicon หรือ `x64` สำหรับ Intel Mac บน macOS 15 ขึ้นไป
- POS Desktop อย่างเดียว: ใช้ `.dmg` และเลือก `arm64` สำหรับ Apple Silicon หรือ `x64` สำหรับ Intel Mac

เลือกไฟล์ macOS ให้ถูก:

| เครื่อง | Apple Silicon | Intel Mac |
| --- | --- | --- |
| Server + POS | `BMS-Retail-Local-Server-POS-<version>-arm64.pkg` | `BMS-Retail-Local-Server-POS-<version>-x64.pkg` |
| Server อย่างเดียว | ติดต่อ Support (offline recovery เท่านั้น) | ติดต่อ Support (offline recovery เท่านั้น) |
| POS อย่างเดียว | `BMS-Retail-Local-POS-<version>-macos-arm64.dmg` | `BMS-Retail-Local-POS-<version>-macos-x64.dmg` |

### macOS Server+POS online bootstrap

1. ดาวน์โหลดไฟล์ `.pkg` ที่ได้รับจาก BMS
2. ดับเบิลคลิกไฟล์ `.pkg`
3. ถ้า macOS ขึ้นข้อความ **Not Opened** หรือ **Apple could not verify ... is free of malware** ให้กด **Done** ก่อน ห้ามกด **Move to Trash**
4. เปิด **System Settings > Privacy & Security**
5. เลื่อนลงมาที่ส่วน Security แล้วกด **Open Anyway** ที่ชื่อไฟล์ `BMS-Retail-Local-...pkg`
6. ใส่รหัสผ่านเครื่องหรือ Touch ID เพื่อยืนยัน
7. ถ้ายังเปิดไม่ได้ ให้เปิด Terminal แล้วรันคำสั่งนี้ โดยแก้ชื่อไฟล์ให้ตรงกับไฟล์ที่ดาวน์โหลด:

```bash
xattr -dr com.apple.quarantine ~/Downloads/BMS-Retail-Local-Server-POS-<version>-arm64.pkg
open ~/Downloads/BMS-Retail-Local-Server-POS-<version>-arm64.pkg
```

ถ้าเป็น Intel Mac ให้ใช้ไฟล์ `x64` เช่น:

```bash
xattr -dr com.apple.quarantine ~/Downloads/BMS-Retail-Local-Server-POS-0.2.12-x64.pkg
open ~/Downloads/BMS-Retail-Local-Server-POS-0.2.12-x64.pkg
```

8. ตรวจว่าอินเทอร์เน็ตใช้งานได้ แล้วทำตามหน้าจอ Installer ตัว `.pkg` มีเฉพาะโปรแกรมติดตั้งขนาดเล็ก ไม่มี Ubuntu, Docker engine, service image หรือ POS ฝังอยู่
9. หลังติดตั้งเสร็จ ระบบจะพยายามเปิด `/Applications/BMS Retail Local.app` ให้อัตโนมัติ และเปิด Terminal สำหรับ setup
10. ถ้า Terminal ไม่เด้งขึ้นมา ให้เปิด `/Applications/BMS Retail Local.app` เอง
11. ถ้าระบบถาม Activation Code ให้กรอกรหัสจาก BMS; ถ้ายังไม่มีให้เว้นว่างและติดตั้งต่อได้ การตรวจ Licensing ไม่หยุดการทำงานของร้าน
12. อย่าปิดอินเทอร์เน็ตระหว่างครั้งแรก ระบบจะดาวน์โหลด component แบบต่อจากจุดเดิมได้และตรวจ publisher signature กับ SHA-256 ทุกไฟล์ก่อนเริ่ม runtime จากนั้นจึง migrate database และ health check
13. Setup จะแสดงขั้นตอน `[BMS 1/7]` ถึง `[BMS 7/7]` และแสดงค่า RAM/พื้นที่ว่างจริงเมื่อ preflight ไม่ผ่าน
14. ตั้งค่าร้านครั้งแรก เลือกประเภทร้าน เลือกว่าจะสร้างข้อมูลตัวอย่างตามประเภทร้านหรือไม่ และยืนยันรหัสผ่าน/PIN ซ้ำ
15. เมื่อระบบพร้อม จะติดตั้ง เปิด และ pair BMS POS ให้อัตโนมัติ หลัง setup สำเร็จ การขายหน้าร้านใน local runtime ไม่ได้บังคับให้ต่ออินเทอร์เน็ตตลอดเวลา

คำสั่งที่ใช้บ่อยบน macOS:

```bash
bms-retail-local status
bms-retail-local doctor
bms-retail-local start
bms-retail-local stop
bms-retail-local logs
```

สร้าง backup:

```bash
bms-retail-local backup ~/Desktop/bms-backup.age age1...
```

ถอนการติดตั้งบน macOS:

ดับเบิลคลิก `/Applications/BMS Retail Local Uninstall.command` แล้วเลือกว่าจะเก็บข้อมูลสำหรับ recovery หรือลบถาวร หรือใช้คำสั่งด้านล่าง

```bash
bms-retail-local uninstall
```

คำสั่งนี้จะหยุดระบบและถอด startup ออก แต่ยังเก็บข้อมูลร้าน, private VM และ secrets ไว้เพื่อ recovery หรือ reinstall

ถ้าต้องการลบข้อมูลร้านจากเครื่องนี้ถาวร ให้ backup และตรวจว่า backup กู้คืนได้ก่อน แล้วค่อยรัน:

```bash
bms-retail-local uninstall --erase-data --confirm ERASE-BMS-RETAIL-LOCAL
```

การลบแบบ `--erase-data` จะลบข้อมูลร้านในเครื่อง, private VM, runtime payload, app และ package receipt กู้คืนจากเครื่องนี้ไม่ได้ถ้าไม่มี backup

### macOS POS Desktop อย่างเดียว

ไฟล์ `.dmg` รุ่น Online เป็นตัวติดตั้งขนาดเล็กและไม่ฝัง Electron/BMS POS ตัวเต็มไว้ในไฟล์
จึงต้องต่ออินเทอร์เน็ตตอนติดตั้งครั้งแรก ตัว Setup จะตรวจ signed release manifest และ SHA-256
แล้วดาวน์โหลดเฉพาะ POS ที่ตรงกับ Apple Silicon หรือ Intel ก่อนติดตั้งลง `/Applications/BMS POS.app`
หากเน็ตหลุดให้เปิด Setup ซ้ำ ระบบจะ resume ไฟล์ที่ดาวน์โหลดไว้

1. เลือกไฟล์ให้ตรงกับเครื่อง:
   - Apple Silicon: `BMS-Retail-Local-POS-<version>-macos-arm64.dmg`
   - Intel Mac: `BMS-Retail-Local-POS-<version>-macos-x64.dmg` เช่น `BMS-Retail-Local-POS-0.2.12-macos-x64.dmg`
2. เปิดไฟล์ `.dmg`
3. ลาก `BMS POS.app` ไปที่ `Applications`
4. เปิด `BMS POS.app`
5. ถ้า macOS บล็อกครั้งแรก ให้คลิกขวาที่แอปแล้วเลือก **Open**
6. ถ้ายังเปิดไม่ได้ ให้เปิด **System Settings > Privacy & Security** แล้วกด **Open Anyway**
7. ถ้ายังติด Gatekeeper ให้เปิด Terminal แล้วรัน:

```bash
xattr -dr com.apple.quarantine "/Applications/BMS POS.app"
open "/Applications/BMS POS.app"
```

8. ใส่ Server URL และ pairing token ที่สร้างจากเครื่อง Server

## 6. Pair เครื่อง POS เพิ่มเติม

ทำขั้นตอนนี้เมื่อเครื่องนี้เป็น POS อย่างเดียว หรือเป็น POS เครื่องที่สองขึ้นไป

1. ที่เครื่อง Server ให้ login เข้าระบบหลังบ้าน
2. ไปที่หน้าอุปกรณ์ POS
3. สร้าง pairing link หรือ pairing token สำหรับเครื่อง POS ใหม่
4. ที่เครื่อง POS เปิด BMS POS
5. ใส่ Server URL:

```text
http://<server-ip>:3100
```

ถ้าเป็นเครื่องเดียวกันให้ใช้:

```text
http://127.0.0.1:3100
```

6. วาง pairing token/link
7. ระบบจะบันทึก device token ลง keystore ของ OS เครื่องนั้น

ข้อควรระวัง:

- token ใช้สำหรับเครื่องนั้นเท่านั้น
- การย้าย token ข้าม Windows, Linux, macOS ใช้ไม่ได้ ต้อง pair ใหม่
- ห้ามส่ง token ในแชทสาธารณะหรือเก็บไว้ในไฟล์ที่แชร์หลายคน

## 7. Activation และ Trial

ถ้าได้รับ Activation Code ให้กรอกระหว่างติดตั้ง หรือ activate ภายหลังจากเมนู/คำสั่งของระบบ

หลักการสำคัญ:

- ถ้า Activation Server ติดต่อไม่ได้ ร้านยังใช้งานต่อได้
- ระบบจะเก็บหลักฐานการใช้งานและส่งภายหลังเมื่อเชื่อมต่อได้
- Licensing ใช้สำหรับตรวจสอบหลังบ้านและ support ไม่ใช่กลไกหยุดร้านหน้าร้าน
- ถ้า license/trial มีปัญหา ให้ติดต่อ BMS Support เพื่อแก้สถานะหลังบ้าน
- ใบเสร็จ, บิล, ภาษี และข้อมูลลูกค้าไม่ควรถูกล็อกหรือใส่คำว่า Trial จากสถานะ license

## 8. Backup หลังติดตั้ง

หลังติดตั้งเสร็จควรตั้งค่า backup ทันที โดย backup ต้องอยู่นอกเครื่องหลัก เช่น NAS หรือ external drive

สิ่งที่ backup ต้องครอบคลุม:

- database
- ไฟล์ที่ร้าน upload
- local secrets ที่ใช้ decrypt ข้อมูล
- installation receipt

คำแนะนำ:

- อย่าเก็บ backup ไว้ใน disk เดียวกับข้อมูลร้านเพียงที่เดียว
- ทดสอบ restore อย่างน้อยหนึ่งครั้งก่อนใช้งานจริง
- เก็บ private recovery key แยกจากเครื่องร้าน ถ้าหายจะกู้ backup ที่ encrypted ไม่ได้
- ตรวจสถานะ backup เป็นประจำ โดยเฉพาะหลังปิดร้านหรือหลังอัปเดตระบบ

## 9. ตรวจสอบหลังติดตั้ง

ให้ทำ checklist นี้ก่อนเริ่มใช้งานจริง:

- เปิดระบบได้ที่ `http://127.0.0.1:3100`
- login admin ได้
- เปิด POS ได้
- เปิดกะได้
- เพิ่มสินค้า/เลือกสินค้าได้
- ขายสินค้าทดสอบได้
- พิมพ์ใบเสร็จได้ ถ้ามี printer
- ปิดกะได้
- reboot เครื่องแล้วระบบกลับมาเอง
- backup สำเร็จ
- จดช่องทางติดต่อ Support ไว้ให้หน้าร้าน

## 10. แก้ปัญหาเบื้องต้น

ถ้าเปิดระบบไม่ได้:

- ตรวจว่าเครื่องต่อไฟและ internet ปกติ
- restart เครื่องหนึ่งครั้ง
- Windows: เปิดเมนู BMS Retail Local แล้วตรวจ backup/status
- Ubuntu: รัน `sudo systemctl status bms-retail-local`
- macOS: รัน `bms-retail-local doctor`

ถ้า POS pair ไม่ได้:

- ตรวจ Server URL
- ตรวจว่า pairing token ยังไม่หมดอายุ
- สร้าง pairing token ใหม่จากเครื่อง Server
- Linux ให้ตรวจว่า keyring เปิดอยู่
- macOS ให้ยอมรับ Keychain prompt

ถ้าติด Activation:

- ตรวจ internet
- ลอง activate ภายหลัง
- ร้านยังควรใช้งานต่อได้ ให้ส่ง error message และเวลาที่เกิดเหตุให้ Support

ถ้าต้องย้ายเครื่อง:

- อย่าติดตั้ง Server ใหม่ทับร้านเดิมเอง
- ทำ backup จากเครื่องเดิม
- ติดต่อ BMS Support เพื่อ restore และ transfer license/evidence ให้ถูกต้อง

## 11. ข้อมูลที่ควรส่งให้ Support เมื่อมีปัญหา

- ชื่อร้าน
- เบอร์โทรผู้ติดต่อ
- ระบบปฏิบัติการและรุ่น เช่น Windows 11, Ubuntu 24.04, macOS 15
- ชื่อไฟล์ installer ที่ใช้
- เวลาที่เกิดปัญหา
- รูปหน้าจอ error
- ขั้นตอนที่ทำก่อนเกิดปัญหา
- ผลตรวจ status/doctor ถ้ามี

ห้ามส่งรหัสผ่าน, private key, ไฟล์ `.env`, database dump หรือ backup ที่ยังไม่ได้ตกลงกับ BMS Support ก่อน
