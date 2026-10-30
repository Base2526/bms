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

apply `10.105__bms_retail_local_leads.sql` แล้วตามด้วย `10.106__bms_retail_local_lead_erasure.sql` ก่อน Web รุ่นนี้ ต้องใช้ migration owner ที่อ่าน users ได้
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

## Recheck รอบสอง — 30 ตุลาคม 2026 (branch `feat/retail-local-pricing`)

| เรื่องที่พบ | ความเสี่ยง | สิ่งที่แก้ |
| --- | --- | --- |
| ฟอร์ม Lead และ endpoint ทำงานบนเครื่อง Retail Local ของร้านด้วย | Lead ถูกเก็บในฐานข้อมูลของร้าน BMS ไม่เห็น แต่จอบอกว่าบันทึกแล้ว และเก็บข้อมูลส่วนบุคคลไว้โดยไม่มีใครดูแล | endpoint ตอบ 404 ก่อน rate limit/อ่าน body และหน้าเว็บซ่อนฟอร์มเมื่อเป็น Retail Local |
| ส่งฟอร์มเกิน rate limit ขึ้นข้อความ "ตรวจเบอร์/LINE" | ชวนให้แก้เบอร์ที่ไม่ได้ผิด | แยกข้อความ 429 ให้บอกว่าส่งบ่อยเกินไปและชวนทัก LINE |
| การ์ดแพ็กเกจแปลสถานะ License ด้วยตัวเอง | `TRIAL_EXPIRED` ขึ้น "Trial", `CANCELLED` ขึ้น "รอตรวจสอบ" ขัดกับป้าย License หน้าเดียวกัน | ใช้ `localLicenseBadge()` ตัวเดียวกับป้าย ผ่าน `localPlanLabel()`; ร้าน Licensed ไม่เห็นข้อความ "ไม่ซื้อก็ใช้งานต่อได้" |
| ป้ายเครื่องเพิ่มแสดงตลอดเมื่อมีเครื่อง ≥ 1 | ร้านที่ใช้แค่เครื่องฟรีถูกบอกให้ติดต่อ BMS ทุกครั้งที่เปิดหน้า | แสดงบนรายการเมื่อเกินโควตาฟรีเท่านั้น และในหน้าต่างเพิ่มเครื่องเมื่อเครื่องที่กำลังเพิ่มเกินโควตา (`shouldShowExtraDeviceNotice`) |
| ลบข้อมูล Lead ตามคำขอ (PDPA) ไม่ได้ | trigger ล็อกฟิลด์ติดต่อ และทุกครั้งที่แก้สถานะจะคัดลอกเบอร์/LINE ลงตาราง revision | migration `10.106` + ปุ่ม **ลบข้อมูล** ใน Leads tab: ล้างฟิลด์ติดต่อและ snapshot ทั้งหมด บันทึกผู้ลบ/เวลา/event และล็อกแถว |
| เทส re-run ของ `10.105` | รัน `10.105` ซ้ำหลัง `10.106` จะคืน trigger เก่าและทำให้การลบข้อมูลหายเงียบ ๆ | เทส re-run ใช้ `10.105` แล้วตามด้วย `10.106` และตรวจว่า trigger ยังมีเงื่อนไข erased |
| ตรวจว่า POS ไม่ import ราคา ครอบไม่ครบ | ไม่ได้สแกน `lib/pos`, `components/pos-desktop` และ service ใบเสร็จ/ภาษี/ชำระเงิน | ขยายเทสให้ครอบทั้งหมด และเพิ่มเทสห้ามพิมพ์ราคาซ้ำในทุกหน้าที่แสดงราคา |

ผลตรวจ: DB จริง (สำเนา dev ใน PostgreSQL 16 แยก, `10.105`/`10.106` รันซ้ำได้) 5/5 · pure lead 13/13 ·
pricing 6/6 · mutation 8 แบบแดงถูกเทสทุกแบบแล้วคืนไฟล์และฐานข้อมูล · `npm run gate` exit 0

**ยังต้องทำโดยเจ้าของ/ฝ่ายกฎหมาย:** นโยบายความเป็นส่วนตัวที่ลิงก์จากช่องยินยอมยังไม่พูดถึง Lead จากหน้า
ดาวน์โหลด ระยะเวลาเก็บ และวิธีขอลบ ต้องเพิ่มและให้ฝ่ายกฎหมายตรวจก่อนเปิดรับ Lead บน production ·
ระยะเวลาเก็บ Lead ที่ไม่สนใจ (`NOT_INTERESTED`) ยังไม่มีนโยบายและไม่มีตัวลบอัตโนมัติ
