# Retail Local release staging

โฟลเดอร์นี้เป็นพื้นที่พักไฟล์ Retail Local ที่อัปโหลดด้วย FTP ก่อนเผยแพร่ไปยัง static release
directory ห้ามอัปโหลด private signing key, ไฟล์ `.pem` หรือข้อมูลลับทุกชนิดเข้ามาในโฟลเดอร์นี้

สคริปต์เผยแพร่คือ `releases/retail-local/publish-retail-local-staged-release.sh`
สคริปต์จะตรวจ signed manifest,
platform target และ SHA-256 ก่อนย้ายเฉพาะไฟล์ public ไปยัง:

```text
/mnt/volume_sgp1_01/releases/retail-local/<version>
```

## 1. Upload release

ใน FileZilla เปิด remote directory:

```text
/bms/releases/retail-local
```

จากนั้นอัปโหลดโฟลเดอร์รุ่นทั้งโฟลเดอร์ ตัวอย่าง:

```text
/bms/releases/retail-local/0.2.14-pilot.3
```

โครงสร้างขั้นต่ำต้องเป็น:

```text
0.2.14-pilot.3/
  trusted-release-keys.json
  installers/
  ubuntu-24.04-lts-x64/
  windows-11-x64/
  windows-10-x86/
```

ไฟล์ installer ต้องอยู่ใน `installers/` จำนวน 7 package พร้อมไฟล์ `.json` และ `.sha256`
ของแต่ละ package รวมเป็น 21 ไฟล์ สคริปต์จะไม่เผยแพร่ `release-descriptor.json`

## 2. Validate without publishing

SSH เข้าเซิร์ฟเวอร์ ไปที่ repository `bms` แล้วรัน:

```bash
sudo bash releases/retail-local/publish-retail-local-staged-release.sh 0.2.14-pilot.3 --dry-run
```

ผลที่ถูกต้องต้องมี `OK` สำหรับ:

- `ubuntu-24.04-lts-x64`
- `windows-11-x64`
- `windows-10-x86` ซึ่ง signed target ต้องเป็น `windows-10-x86-pos`
- 7 online installers และ 14 sidecar files

โหมด `--dry-run` จะไม่ย้ายและไม่ลบไฟล์

## 3. Publish

เมื่อ dry-run ผ่านแล้วจึงรัน:

```bash
sudo bash releases/retail-local/publish-retail-local-staged-release.sh 0.2.14-pilot.3
```

สคริปต์จะ:

- ใช้ publish lock ป้องกันการรันพร้อมกัน
- ตรวจ Ed25519 signature จาก public keyring
- ตรวจ release version, platform target และ SHA-256
- ปฏิเสธการเขียนทับ runtime target หรือ installer ที่มีอยู่แล้ว
- เก็บโฟลเดอร์ macOS ที่อยู่ใน release รุ่นเดียวกันไว้
- เผยแพร่เฉพาะ `*.artifact`, `release.jws.json`, `SHA256SUMS` และ installer files
- ลบ staging folder `releases/retail-local/<version>` เมื่อทุกขั้นตอนสำเร็จเท่านั้น

ถ้าสคริปต์ล้มเหลวก่อนสำเร็จ staging folder จะยังอยู่ ห้ามลบ target ที่มีข้อมูลอยู่แล้วเพื่อฝืนรันซ้ำ
ให้ตรวจ error และไฟล์บน server ก่อนเสมอ

## 4. Verify public URLs

หลัง publish ให้ตรวจว่าแต่ละ manifest ตอบ HTTP 200:

```bash
curl -I https://releases.jachoei.com/retail-local/0.2.14-pilot.3/windows-11-x64/release.jws.json
curl -I https://releases.jachoei.com/retail-local/0.2.14-pilot.3/windows-10-x86/release.jws.json
curl -I https://releases.jachoei.com/retail-local/0.2.14-pilot.3/ubuntu-24.04-lts-x64/release.jws.json
```

ทั้งสาม URL ต้องตอบ `HTTP 200` ก่อนนำ installer ไปทดสอบกับเครื่องลูกค้า

## Requirements

Host ต้องมี `bash`, `python3`, `openssl`, `sha256sum` และ `flock` สคริปต์ต้องรันด้วย
`sudo` เฉพาะตอน publish จริง ส่วน `--dry-run` ไม่แก้ไขไฟล์
