# Retail Local commercial rollout — ขอบเขตและงานเปิดขาย

ร่างรอเจ้าของลงนาม ณ 30 ตุลาคม 2026 ทุกส่วนยังเป็น technical pilot

| เฟส | สิ่งที่เตรียมใน repository | สิ่งที่ต้องทำโดยเจ้าของ/ทีมปฏิบัติการ |
| --- | --- | --- |
| 0 | decisions, EULA และราคาข้อเสนอใน config | ลงนาม 8 ข้อ; นักกฎหมาย/บัญชีตรวจ EULA และ VAT |
| 1 | ราคา/ฟอร์ม consent/Lead admin/แพ็กเกจ/เครื่องเพิ่ม/FAQ | apply migration, ยืนยัน offer และทดสอบ staging |
| 2 | sales runbook และซ้อม Code/Paid/transfer บนระบบทดสอบผ่านแล้ว | ซ้อมคนปฏิบัติงานรับเงิน/ใบกำกับภายนอก/ส่งมอบภายในเวลาที่เสนอ |
| 3 | host backup snapshot, alert หลังบ้าน, คู่มือ restore | ทดสอบ USB/NAS และ restore เครื่องใหม่พร้อม reconcile จริง |
| 4 | support policy, แบบเวลาเคส, ทะเบียน MA แบบทำมือ | ตั้ง LINE tag, ผู้รับผิดชอบ และสิทธิทะเบียน; MA expiry ยังไม่มีใน schema license |
| 5 | pilot plan และวิธีวัด 6 ตัวชี้วัด | คัด 20 ร้าน Windows retail; ดำเนิน 12 สัปดาห์ในช่วงสัปดาห์รวม 5–16 |
| 6 | GA checklist | ซื้อ/เซ็น certificate, key custody, hardware และ failure drills; ตรวจ evidence จริง |
| 7 | เกณฑ์ด้านล่าง | ลงทุนเมื่อยอดขายและความต้องการรองรับ โดยอนุมัติ scope ใหม่ |

## หลังนำร่อง (ยังไม่พัฒนาในรอบนี้)

- Checkout อัตโนมัติ: พิจารณาเมื่อเกินประมาณ 30 code ต่อเดือน
- BMS-hosted backup: พิจารณาเมื่ออย่างน้อย 30% ร้องขอและฝ่ายกฎหมายอนุมัติ data location/PDPA
- จำนวนเครื่องแบบไม่ระบุตัวตน: ต้องมีหลักฐานคำขอเครื่องเพิ่มและทบทวน privacy contract ก่อน
- Local → Cloud: พิจารณาเมื่อมีร้านนำร่องอย่างน้อย 3 ร้านขยายสาขา
- ถ้า conversion ต่ำแต่ retention สูง ให้ทดลองสิทธิ Plus ก่อนลดราคา

## ความต่างของแผนกับของจริงที่ต้องรักษา

- ตาราง Lead ไม่มี tenant แต่เก็บ PII จึงใช้ RLS สำหรับ platform admin และ narrow insert function
  สำหรับฟอร์มสาธารณะ ไม่ปิด RLS ตามข้อความในแผนฉบับใหม่
- Free ไม่รวมบริการ managed online ของ BMS; ไม่เพิ่มการบล็อก channel/tool ที่ระบบทำได้อยู่แล้ว
- MA และราคายังเป็นข้อเสนอ การเปลี่ยน config approved ไม่ใช่การอนุมัติสัญญาหรือทำให้ GA
- อ่าน backup ไม่ได้ต้องเป็น unknown; missing host bridge ในรุ่นเก่าไม่ใช่ผลผ่าน
- แบบ checklist หรือ verifier ผ่านไม่ทดแทนผลทดสอบเครื่องจริงและการตรวจความแท้ของ evidence

## Deploy / rollback

apply `10.105__bms_retail_local_leads.sql` ก่อน Web รุ่นนี้ ต้องใช้ migration owner ที่อ่าน users ได้
และสร้าง SECURITY DEFINER functions ได้ ทดสอบสองรอบกับฐานทิ้งได้ก่อน production
Web/host agent ต้องออก release ที่เข้าคู่กันเพื่อให้ backup snapshot แสดงได้ ไม่เพิ่ม env หรือ mount ลับใหม่
ถอย Web/agent ได้โดยเก็บตาราง Lead ไว้ หยุดรับฟอร์มก่อนถอย schema; SQL ROLLBACK ในหัว migration
ลบ Lead/revision/audit ถาวร จึงต้อง export ที่ปลอดภัยและได้รับอนุมัติก่อนใช้

## ผลตรวจใน branch `codex/retail-local-commercial-rollout` — 30 ตุลาคม 2026

| การตรวจ | ผล |
| --- | --- |
| `npm run gate` รอบหลัก; production build + pure หลังแก้ GraphQL | exit 0: typecheck + pure 299 ไฟล์ (ผ่าน 3,285, ข้าม 2, ล้มเหลว 0) + production build |
| `node scripts/run-contract-tests.mjs pure retail-local` | ผ่าน 94/94 เทส ใน 16 ไฟล์ |
| `node scripts/run-contract-tests.mjs pure work-assistant` | ผ่าน 46/46 เทส ใน 3 ไฟล์ |
| `go test ./...` ใน host agent | exit 0 |
| Browser ไทย/อังกฤษ × 1280/390px | ผ่าน 4 กรณี: consent เริ่มปิด, ส่งสำเร็จ/reset, ส่งล้มเหลว, ไม่มี horizontal overflow |
| DB integration บน PostgreSQL 16 แยก | ผ่าน 4/4: migration รันซ้ำ, RLS/grants, actor checks, revision/audit และ rollback เมื่อ audit ล้มเหลว |
| Browser integration จริง | ผ่าน 6 กลุ่ม: login/denial, ส่ง Lead และแก้จากหลังบ้าน 4 ภาษา/ขนาดจอ, consent/rate limit; ไม่มี API mock |
| Licensing DB + browser rehearsal | DB 3/3, browser/API 6/6 กลุ่ม: Code, Trial → Paid, transfer, actor audit, retry/rollback และอนุมัติพร้อมกัน |
| Mutation เปลี่ยนไฟล์จริง | consent, rate limit, contact CHECK, backup false-pass, pricing approval, pricing import ใน POS ทำให้เทสแดง; คืนไฟล์แล้ว |
| Migration number / `git diff --check` | ไม่มีเลขซ้ำและไม่มี whitespace error |

ตรวจรอบ integration ใช้ `/th/retail-local`, `/en/retail-local` และ `/admin/retail-local-licenses`
กับ PostgreSQL/Redis จริงและ session ที่ได้จาก login จริง ตรวจวันโทรตามเขตเวลาไทย การ reload
และ revision/audit ใน DB แล้ว ล้าง Lead จำลอง 9 รายการพร้อมประวัติหลังรันเสร็จ
ไม่มีการแก้ข้อมูลใน volume ต้นฉบับ: ใช้ snapshot จาก volume ที่หยุดอยู่และ mount แบบ read-only

แก้ปัญหา environment ที่ทำให้ตรวจในเครื่องไม่ได้แล้ว: เปิด Docker engine, แยก test cluster,
ตั้ง env เฉพาะ process, ใช้ localhost ตรงกันเพื่อไม่ให้ Next rewrite วน และเพิ่ม fallback GraphQL
ไป `/api/graphql` เมื่อ build ไม่ได้ตั้ง URL หลังบ้านจึงอ่านเมนูและสถานะได้ตามปกติ
วิธีรันซ้ำอยู่ใน [local test runbook](../../architecture/retail-local-commercial-test.md)

production build รอบแก้ไขผ่านโดยเชื่อมฐานทดสอบได้แล้ว ยังมี warning จาก dependency Edge runtime
**ยังไม่ได้พิสูจน์** host backup/restore, การย้ายเครื่องจริง, อุปกรณ์ต่อพ่วง และ WebSocket gateway
ผลนี้ไม่ยืนยัน GA ไม่มีการ commit, push หรือ deploy ในรอบนี้

เพิ่มเติม: [ผลซ้อม Code/Paid/transfer วันที่ 30 ตุลาคม](rehearsal-2026-10-30.md)
ผ่านกับ Go agent สอง identity บนเครื่องทดสอบเดียว เพิ่มหน้าจอยืนยันย้ายและตรวจ actor แล้ว
ไม่ถือว่าได้ restore ข้อมูลบนฮาร์ดแวร์ใหม่ เรื่องที่ต้องตัดสินใจอยู่ใน [decisions](decisions.md)
