# BMS Retail Local {{VERSION}} — Linux x64

แพ็กเกจชุดนี้เป็น **internal pilot build แบบ unsigned** สำหรับ Ubuntu x86_64 ร้านเดียว ใช้ฐานข้อมูล
PostgreSQL ในเครื่องเดียว ไม่มี cloud replica, ไม่มี offline tender แยก และไม่มี auto-update

## เลือกไฟล์ติดตั้ง

| ไฟล์ | ใช้กับเครื่อง | สิ่งที่ติดตั้ง |
| --- | --- | --- |
| `BMS-Retail-Local-Server-POS-{{VERSION}}-linux-x64.deb` | เครื่องหลักที่เป็นทั้ง Server และจอขาย | Server payload แบบ offline และตัวติดตั้ง BMS POS |
| `BMS-Retail-Local-Server-{{VERSION}}-linux-x64.deb` | เครื่อง Server อย่างเดียว | Web, WS, PostgreSQL และ Redis ผ่าน Docker |
| `BMS-Retail-Local-POS-{{VERSION}}-linux-x64.deb` | เครื่องแคชเชียร์ Ubuntu Desktop | BMS POS แบบติดตั้งในระบบ |
| `BMS-Retail-Local-POS-{{VERSION}}-linux-x64.AppImage` | เครื่องแคชเชียร์ที่ไม่ต้องการติดตั้ง package | BMS POS แบบ portable |

Linux x86/32-bit ไม่มีในรุ่นนี้ เพราะ Electron ที่ใช้อยู่รองรับ Linux x64 เท่านั้น เครื่อง Linux
32-bit ต้องเปลี่ยน OS/เครื่อง หรือใช้ browser POS จากอุปกรณ์ที่รองรับแทน

## Hardware และ Software ที่ต้องมี

### Server หรือ Server + POS

- CPU x86_64 อย่างน้อย 2 cores; แนะนำ 4 cores เมื่อใช้ Server + POS
- RAM ขั้นต่ำ 4 GB; แนะนำ 8 GB (ห้ามใช้เครื่อง 1–2 GB สำหรับ production)
- พื้นที่ว่างขั้นต่ำ 15 GB; แนะนำ SSD 40 GB ขึ้นไป และต้องมีสื่อ backup แยกอีกชุด
- Ubuntu 22.04 LTS หรือ 24.04 LTS แบบ 64-bit
- Docker Engine และ Docker Compose v2 ต้องพร้อมก่อนรัน setup
- ต้องมี `bash`, `curl`, `jq`, `openssl`, `tar`, `ca-certificates`
- พอร์ต loopback `3100` และ `3101` ต้องว่าง; PostgreSQL/Redis ไม่เปิด host port
- สำหรับ Server + POS ต้องเป็น Ubuntu Desktop ที่มี graphical session
- เครื่องพิมพ์ใบเสร็จ, barcode scanner และ cash drawer เป็นอุปกรณ์เสริม ต้องทดสอบ driver
  กับรุ่นจริงก่อนเปิดร้าน
- UPS แนะนำอย่างยิ่งสำหรับเครื่อง Server และอุปกรณ์ network

Docker images ของแอปอยู่ใน Server `.deb` แล้ว จึงไม่ต้องดาวน์โหลด image ระหว่าง setup แต่การติดตั้ง
dependency ของ Ubuntu/Docker ครั้งแรกอาจต้องใช้ repository หรือสื่อ package ภายในร้าน

### POS x64

- CPU x86_64 2 cores ขึ้นไป
- RAM ขั้นต่ำ 4 GB; แนะนำ 8 GB
- พื้นที่ว่างอย่างน้อย 1 GB
- Ubuntu Desktop 22.04/24.04 x64 พร้อม GTK 3 และ system keyring ที่ใช้งานได้
- POS ปฏิเสธการ pairing เมื่อ Electron ใช้ `basic_text` เพราะ token จะไม่ถูกเข้ารหัส
- ต้องเข้าถึง Server ที่จับคู่ไว้ได้; ถ้าอยู่คนละเครื่อง ต้องออกแบบ private LAN/reverse proxy/TLS
  เพิ่มเติม เพราะค่าเริ่มต้นของ Server bind เฉพาะ `127.0.0.1`

## ติดตั้ง

ตรวจ checksum ก่อนทุกครั้ง:

```bash
sha256sum -c BMS-Retail-Local-Server-{{VERSION}}-linux-x64.deb.sha256
```

ติดตั้ง Server อย่างเดียว:

```bash
sudo apt install ./BMS-Retail-Local-Server-{{VERSION}}-linux-x64.deb
sudo bms-retail-local-setup
```

ติดตั้ง Server + POS:

```bash
sudo apt install ./BMS-Retail-Local-Server-POS-{{VERSION}}-linux-x64.deb
sudo bms-retail-local-setup
```

ติดตั้ง POS แยก:

```bash
sudo apt install ./BMS-Retail-Local-POS-{{VERSION}}-linux-x64.deb
```

ใช้ AppImage:

```bash
chmod +x BMS-Retail-Local-POS-{{VERSION}}-linux-x64.AppImage
./BMS-Retail-Local-POS-{{VERSION}}-linux-x64.AppImage
```

ระหว่าง `bms-retail-local-setup` ระบบจะสร้าง secrets แบบสุ่ม, โหลด image ที่ตรวจ checksum แล้ว,
ถามข้อมูลร้าน/Admin/PIN, provision ร้าน และตรวจ health ของ Web/WS จากนั้นจะแสดง POS pairing token
ครั้งเดียว

## คำสั่งดูแลระบบ

```bash
sudo bms-retail-local-start
sudo bms-retail-local-stop
sudo bms-retail-local-status
sudo bms-retail-local-doctor
sudo bms-retail-local-backup /mnt/encrypted-backup
```

เปิด Admin ที่ `http://127.0.0.1:3100/admin/login`

Backup ต้องเก็บทั้ง database, uploaded files และ secrets ระบบจะรวมสิ่งเหล่านี้ไว้ให้ แต่ปลายทางต้องเป็น
สื่อเข้ารหัส/NAS ที่แยกจาก disk ของ Server ทดสอบ restore บนเครื่องทดสอบก่อนใช้จริงเสมอ การถอน package
จะไม่ลบข้อมูลใน `/var/lib/bms-retail-local`

## SHA-256

| ไฟล์ | SHA-256 |
| --- | --- |
| Server + POS x64 DEB | `{{SERVER_POS_SHA256}}` |
| Server x64 DEB | `{{SERVER_SHA256}}` |
| POS x64 DEB | `{{POS_DEB_SHA256}}` |
| POS x64 AppImage | `{{POS_APPIMAGE_SHA256}}` |

## ข้อจำกัดของ pilot build

- ทุกไฟล์ unsigned; Ubuntu อาจแสดงคำเตือน และไม่มี auto-update
- Build นี้สร้างใน Linux container บนเครื่อง Windows/WSL2 ยังไม่ใช่ผลรับรองจาก clean native Ubuntu
- ก่อนเปิดร้านต้องทดสอบ clean install, restart หลังไฟดับ, ขาย/คืน/ปิดกะ, peripheral, backup และ restore
- อย่าเปิดพอร์ตฐานข้อมูลหรือ Redis และอย่า copy `.env` ไปช่องทางที่ไม่เข้ารหัส
