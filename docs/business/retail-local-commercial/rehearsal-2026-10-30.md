# ผลซ้อม Retail Local: Code, Paid และย้ายการลงทะเบียนเครื่อง

วันที่ 30 ตุลาคม 2026 · branch `codex/retail-local-commercial-rollout` · technical pilot

ซ้อมบน PostgreSQL 16/Redis แยกและ production Web build ที่ `localhost:3011`
ใช้บัญชีและรายการสมมติ ไม่ได้รับเงินจริง ไม่ส่ง Code ให้ลูกค้า และไม่ deploy
ฐานต้นฉบับไม่ได้ถูกแก้ไข; รายละเอียดการตั้งระบบอยู่ใน
[local test runbook](../../architecture/retail-local-commercial-test.md)

## ผลที่พิสูจน์แล้ว

| ขั้น | ผลตรวจ |
| --- | --- |
| ออก Trial จากหลังบ้าน | อายุ 30 วัน, Code แสดงครั้งเดียว, ผู้ไม่ login ได้ 401 และ shop Administrator ได้ 403 |
| Activate | Code + request UUID เดิม retry ได้ token เดิม; UUID ใหม่ใช้ Code ที่ถูกใช้แล้วไม่ได้ |
| หลักฐานจาก host | ใช้ Go agent จริงสร้าง Ed25519/hash chain; รับ event จริงผ่าน HTTP, กัน duplicate และปฏิเสธลายเซ็นผิด |
| Trial → รอตรวจชำระ → Paid | License/installation เดิม, มี converted timestamp, actor/reason audit ครั้งเดียวแม้ retry, ยกเลิกงานตาม Trial ที่ยังค้าง |
| เครื่องปลายทางจำลอง | ออก Code ใหม่ให้ License เดิม; installation UUID, private key และ token ใหม่ทั้งหมด; ส่ง `TRANSFER_REQUESTED` จาก Go agent แล้วเข้า review |
| ยืนยันย้ายจากหลังบ้าน | หน้ายืนยันไทย/อังกฤษที่ 1280/390px; ต้นทาง `TRANSFERRED`, ปลายทาง `ACTIVE`, review `RESOLVED` และมีผู้ยืนยัน |
| หลังย้าย | heartbeat ที่ลงลายเซ็นทั้งสองฝั่งยังรับได้ เครื่องเดิมไม่กลับเป็น Active; ทั้งคู่ยังอ่านสถานะ Paid ได้ |
| รายการผิดและการอนุมัติพร้อมกัน | ต้นทางไม่ถูกต้องย้อน transaction ทั้งหมด; อนุมัติพร้อมกันได้ Active ไม่เกินโควตา |

DB contract ผ่าน 3/3 และ browser/API rehearsal ผ่าน 6/6 กลุ่ม โดยไม่มี API mock
ล้าง License จำลองพร้อม token/evidence/review/commercial history/follow-up ของรอบซ้อมหลังเสร็จ
รายงานไม่เก็บ Activation Code, ingestion token หรือ private key

ตรวจรอบสุดท้ายผ่าน production build (รวม type checking), `typecheck:db-verification`
และ pure contracts 299 ไฟล์: ผ่าน 3,285 ข้าม 2 ล้มเหลว 0
ตรวจคู่มือในแอปและหน้ายืนยันทั้ง desktop/mobile แล้ว; `git diff --check` ผ่าน
ตรวจ DB หลัง cleanup เหลือ License ที่ขึ้นต้น `FAKE-rehearsal-` จำนวนศูนย์

## สิ่งที่แก้จากการซ้อม

- เพิ่มปุ่มย้ายเครื่องและประวัติผู้ยืนยันในหน้า License พร้อม Installation ID ที่เลือกตรวจได้
- ให้ review resolution ล็อก License ก่อนล็อก installation เพื่อไม่ให้การอนุมัติพร้อมกันเกินโควตา
- เพิ่มกุญแจแยกสำหรับ test environment ให้ activation retry ทำงานใน production build ได้
  ไม่แก้ `.env` หรือใช้กุญแจของ installation ต้นฉบับ
- เพิ่ม runner ที่ซ้อมซ้ำได้และอัปเดตคู่มือในแอป

## ขอบเขตที่ยังไม่ผ่านการรับรอง

เครื่องต้นทาง/ปลายทางในรอบนี้เป็น private state roots สองชุดของ Go agent บนเครื่องทดสอบเดียวกัน
agent สร้าง signed evidence แบบ local-only แล้ว test client ส่งเข้า Web ที่ loopback
จึงไม่ใช่การทดสอบ host HTTPS delivery, installer บนเครื่องใหม่ หรือการย้ายข้อมูลจริง
ไม่ได้ผ่อนข้อกำหนด HTTPS ของ host เพื่อให้เทสผ่าน

ยังต้องใช้เครื่อง/อุปกรณ์จริงซ้อม backup USB/NAS → restore ฐาน/ไฟล์/secret bundle → กระทบยอด
และทดสอบเครื่องพิมพ์/สแกนเนอร์/ไฟดับตาม GA checklist ไม่ถือว่าปุ่ม transfer ทดแทน restore
การรับเงินจริง การออกใบกำกับภายนอก การส่งมอบภายในเวลาที่เสนอ และ SLA ยังไม่ได้ซ้อมกับคนปฏิบัติงาน
WebSocket gateway ไม่อยู่ในรอบนี้ ผลผ่านจึงไม่ยืนยัน GA

## งานที่รอมติเจ้าของ

ดู [สรุปมติและช่องลงนาม](decisions.md#สรุปสำหรับเจ้าของหลังซ้อมระบบทดสอบ):
ราคา/VAT/MA, EULA/รุ่นใหญ่, บัญชีรับเงินและผู้มีอำนาจ, เวลาซัพพอร์ต/ผู้รับเคส,
ร้านนำร่องและชุดเครื่องทดสอบ ยังไม่มีข้อใดถูกอนุมัติแทนเจ้าของ
