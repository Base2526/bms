# Retail Local: เครื่องพังและการย้ายไปเครื่องทดแทน

เอกสารนี้เป็นคู่มือปฏิบัติสำหรับ BMS Retail Local รุ่นนำร่อง การกู้คืนต้องใช้ backup ที่ร้านเก็บไว้
นอกเครื่องเดิม BMS ไม่ได้ host backup ให้ และสถานะ license/trial ต้องไม่ขวางการกู้ข้อมูลหรือการขาย

## ภาษาไทย

### สิ่งที่ต้องมี

- ไฟล์ encrypted logical backup ที่รวมฐานข้อมูล ไฟล์ installation metadata และ secret bundle จากรอบเดียวกัน
- recovery identity/password ที่เก็บแยกจากเครื่องร้าน
- เครื่องทดแทนที่ผ่าน preflight ของ target ที่รองรับ
- ผู้ดูแลร้านและผู้ดูแล BMS ที่มีสิทธิออก Activation Code ใหม่

อย่ากู้ด้วยการคัดลอก WSL VHDX หรือ data directory จากเครื่องที่กำลังทำงาน และอย่าผสมฐานข้อมูลเก่ากับ
ไฟล์หรือ secret จากคนละรอบ backup

### ขั้นตอน

1. เก็บเครื่องเดิมและสื่อ backup ไว้ก่อน อย่าถอนการติดตั้งหรือลบข้อมูลจนกว่าจะ reconcile สำเร็จ
2. ติดตั้ง Retail Local รุ่น/target ที่รองรับบนเครื่องทดแทน โดยยังไม่ต้องมี Activation Code
3. ใช้ workflow restore ของ target กู้ **ฐานข้อมูล + ไฟล์ + secret bundle พร้อมกัน** จาก backup เข้ารหัส
4. ตรวจ health ของ Web, WS, PostgreSQL และ Redis แล้ว reconcile อย่างน้อยยอดขาย สต็อก การชำระเงิน
   ไฟล์ และการจับคู่ POS กับหลักฐานก่อนเครื่องพัง
5. ขอให้ platform admin ออก Activation Code แบบใช้ครั้งเดียวอันใหม่สำหรับ license เดิม ห้ามส่ง Code
   ใน log, URL หรือแชตผู้ช่วย
6. ลงทะเบียนเครื่องใหม่ด้วยเส้นทาง **Activate or Transfer**:
   - Windows: เปิด shortcut **Activate or Transfer**
   - Ubuntu: รัน `sudo bms-retail-local-activate --transfer`
   - macOS: รัน `bms-retail-local activate` (target นี้ยังเป็น experimental และขั้นตอน restore orchestration
     ยังต้องดำเนินการตามคู่มือรุ่นที่ติดตั้ง)
7. ตรวจว่า timeline ได้รับ `TRANSFER_REQUESTED` แล้วให้ platform admin ตรวจ installation เดิม/ใหม่
   และยืนยัน transfer หลังหลักฐานตรงกัน
8. ทดสอบขาย คืน ปิดกะ พิมพ์ และสร้าง backup off-host รอบใหม่ก่อนเปิดใช้งานจริง

ถ้า activation หรืออินเทอร์เน็ตล้มเหลว ให้เก็บคำขอไว้ลองใหม่ ร้านที่ restore แล้วต้องยังใช้งานได้ตามปกติ
ระหว่าง review อย่าสร้าง license ใหม่เพื่อหลบขั้นตอน transfer

## English

### Required material

- One encrypted logical backup containing the database, stored files, installation metadata, and
  the matching secret bundle.
- The recovery identity/password stored away from the shop computer.
- A replacement host that passes preflight for a supported target.
- An authorized shop operator and a BMS platform administrator who can issue a fresh Activation Code.

Do not recover by copying a live WSL VHDX or data directory. Never mix a database with files or
secrets from another backup generation.

### Procedure

1. Preserve the failed host and backup media. Do not uninstall or erase anything until reconciliation passes.
2. Install a supported Retail Local release on the replacement host; installation does not require a code.
3. Use the target's restore workflow to restore the **database, files, and secret bundle together**.
4. Verify Web, WS, PostgreSQL, and Redis health, then reconcile sales, stock, payments, files, and POS pairing.
5. Ask a platform administrator for a new one-use Activation Code for the existing license. Never place the
   code in logs, URLs, or assistant chat.
6. Register the replacement through **Activate or Transfer**:
   - Windows: open **Activate or Transfer**.
   - Ubuntu: run `sudo bms-retail-local-activate --transfer`.
   - macOS: run `bms-retail-local activate` (macOS remains experimental; follow the installed release's
     manual recovery procedure because restore orchestration is not yet complete).
7. Confirm that `TRANSFER_REQUESTED` appears, then have a platform administrator review the old and new
   installations and approve the transfer when the evidence matches.
8. Test sale, return, shift close, printing, and a fresh off-host backup before returning the host to service.

Activation or network failure must remain retryable and must not stop the restored shop. Do not issue a
second license merely to avoid transfer review.
