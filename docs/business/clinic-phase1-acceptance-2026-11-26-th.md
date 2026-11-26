# ตรวจรับคลินิก ระยะ 1 — 26 พฤศจิกายน 2026

ขอบเขต: `codex/clinic-outpatient-phase1` จาก `develop` หลังรวม technical pilot. ใช้ข้อมูลสังเคราะห์เท่านั้น ไม่เปิด flag ไม่ deploy และไม่อ้างว่าพร้อมใช้กับผู้ป่วยจริง. เอกสารนี้บันทึกเฉพาะหลักฐานที่รันในรอบนี้; [ผลรอบก่อน](clinic-pilot-acceptance-2026-11-26-th.md) เป็นประวัติ ไม่ใช่หลักฐานแทนกัน.

## มีแล้ว / ยังขาด / ยังไม่ได้พิสูจน์

| Workflow | มีแล้วจากโค้ด | ยังขาดหรือยังไม่ได้พิสูจน์ |
| --- | --- | --- |
| ตัวตนและสิทธิ์ | Patient UUID/HN แยก CRM, clinic role + RBAC, care team, emergency access 15 นาที, ไฟล์เฉพาะ route; ดู `clinic/patients.ts`, `access.ts`, `encounters.ts`, `attachments.ts`, `10.141` | การพิสูจน์สิทธิ์ผู้ปกครอง, การตรวจใบอนุญาตกับหน่วยงานออกใบอนุญาต, browser ตามบทบาทหลังล็อกอิน, privacy/retention/backup policy ที่เจ้าของเรื่องอนุมัติ |
| นัดหมาย | `appointments.ts` + exclusion constraints กันผู้ตรวจ/ห้องซ้อน, request key ของการจองและเลื่อนนัด (`10.142`), check-in/cancel/no-show | ตารางเวลาทำงาน/วันหยุดและทรัพยากร, การทดสอบ load จริง; รายการต่อช่วงเวลาจำกัด 500 และระบุ `truncated` เมื่อเกิน แสดงคำเตือนและซ่อนจำนวนรายวัน ไม่ถือว่าปฏิทินที่ถูกตัดแสดงเวลาว่างครบ |
| เวชระเบียน | Draft/version, signed note/addendum immutable, clinician/care-team access; แผนยาไม่สร้างการจ่ายหรือตัดสต็อก | แบบฟอร์มและ field ที่ผู้ประกอบวิชาชีพตรวจรับ, export/print แยกสิทธิ์, full workflow บน restored BMS schema |
| ค่าบริการ | Cashier worklist จำกัดและไม่ส่ง clinical note, charge sheet ล็อกรายการ, `createOrderInTx()` และ payment UI เดิม; ดู `billing.ts`, REST adapter | Full clinic → order → submit/confirm payment → cancel/refund/reconcile, rollback/retry บน restored BMS schema, ตารางบริการและภาษีที่ฝ่ายบัญชียืนยัน |
| ช่องทาง | Public `/learn/clinic`, admin clinic/manual, desktop POS shell และ mobile POS ไม่มี chart tool/path ตาม code review รอบก่อน | Browser หลังล็อกอินตามบทบาท, เครื่องพิมพ์/อุปกรณ์จริง, ตรวจ report/log/AI runtime กับข้อมูลสังเคราะห์บนสภาพแวดล้อมครบ |

คลินิกเป้าหมายยัง **ไม่ยืนยันว่ามี EMR เดิมหรือไม่**. ก่อนขยายเวชระเบียนหรือออกแบบ integration ให้ผู้รับผิดชอบยืนยันระบบต้นทาง, รายการข้อมูลที่ต้องแลกเปลี่ยน และเจ้าของข้อมูล. หากมี EMR เดิม แนวทางที่ต้องพิจารณาคือให้ EMR ถือเวชระเบียนและ BMS รับเพียง visit reference กับค่าบริการที่ทบทวนแล้ว; หากไม่มี ให้ผู้ประกอบวิชาชีพตรวจแบบฟอร์ม/สิทธิ์ก่อนพัฒนา EMR ต่อ. ไม่มีการเลือกทางใดแทนคลินิกในรอบนี้.
[แผนที่การไหลของข้อมูล](clinic-data-flow-map-th.md) แยกเส้นทางที่ตรวจจากโค้ดกับเส้นทางที่ยังต้องทดสอบและให้เจ้าของเรื่องอนุมัติ.

## ข้อบกพร่องที่ทำซ้ำและแก้

1. เมื่อมีนัดมากกว่า 500 รายการ `listClinicAppointments()` เดิมคืน array 500 รายการโดยไม่แจ้งว่าถูกตัด; UI จึงแสดงจำนวนรายวันราวกับคิวครบ. `clinic-pilot-appointments-list-contract` แดงก่อนแก้. ตอนนี้ service อ่านได้สูงสุด 501 เพื่อส่ง `{ appointments: first 500, truncated }`; UI เตือนและซ่อนจำนวนรายวันเมื่อไม่ครบ. Exclusion constraint ใน DB ยังเป็นผู้ตัดสินการจองซ้อน.
2. `i18n-keys-contract` พบ false positive จาก helper สองภาษาใน public clinic guide ชื่อ `t()` ซึ่ง scanner สงวนให้ dictionary. เปลี่ยนชื่อเป็น `copy()` โดยไม่เปลี่ยนเนื้อหาหรือภาษา; contract ผ่านหลังแก้.

## หลักฐานที่รันจริง

- `node scripts/run-contract-tests.mjs pure clinic-pilot-appointments-list-contract`: แดงก่อนแก้ (`result.appointments` ไม่มี), ผ่าน 1/1 หลังแก้.
- `node scripts/run-contract-tests.mjs pure clinic-pilot`: ผ่าน 9/9. `node scripts/run-contract-tests.mjs pure i18n-keys-contract`: ครั้งแรก 3/4 เพราะ helper ชน scanner, ผ่าน 4/4 หลังแก้.
- `apps/web npx tsc --noEmit` ผ่าน. `apps/web npm run gate` ผ่าน: pure 4,018 tests, ผ่าน 4,012, ไม่ผ่าน 0, ข้าม 6; production build ผ่าน. Build แจ้ง warning ของ Edge Runtime/jsonwebtoken.
- PostgreSQL 16 disposable `clinic_pilot_test` บน `127.0.0.1:5544`: ใช้ `scripts/infra/clinic-pilot-fixture-base.sql`; apply `10.141`, `10.142` ตามลำดับ แล้วรันซ้ำทั้งคู่ผ่าน. `node scripts/run-contract-tests.mjs db clinic-pilot` ผ่าน 4/4 รวม RLS/grants, cross-tenant FK, concurrent booking, immutable note, care relationship/attachment และ 501 นัดในเดือนเดียวพร้อม `truncated=true` ภายใต้ `bms_app`. Container ถูกหยุดและลบทิ้งหลังทดสอบ.
- Browser local production build ที่ 1280×800 และ 390×844: `/learn/clinic` แสดงคู่มือภาษาไทยและไม่มี horizontal overflow; `/admin/clinic` และ `/admin/manual/clinic` redirect ไป login พร้อม `next` ถูกต้อง. ไม่มี authenticated test account จึงไม่ได้ตรวจหน้า clinic/manual หลังล็อกอินหรือ warning 500 นัดใน browser.

Fixture ขนาดเล็กไม่มี schema order/payment/stock, audit store และบริการ BMS ทั้งระบบ. ผล DB ข้างต้นพิสูจน์เฉพาะ migration/constraint/RLS และ service read/access ที่ระบุ ไม่ใช่ end-to-end บน restored BMS schema หรือการทดสอบ backup/restore.

## Release gates ที่ยังเปิดอยู่

1. Restored throwaway BMS schema: apply/reapply `10.141`–`10.142`, full workflow clinic → order → payment → cancel/refund/reconcile, retry/rollback และ backup/restore ด้วยข้อมูลสังเคราะห์.
2. บัญชีทดสอบ Registrar, Nurse, Clinician, Cashier, Administrator, revoked และต่าง tenant สำหรับ browser desktop/mobile หลังล็อกอิน; ทดสอบคิวขนาดใหญ่จริงและ error state.
3. เจ้าของคลินิกยืนยัน EMR เดิมหรือไม่, ประเภทบริการ/แบบฟอร์ม/สิทธิ์วิชาชีพ/ใบอนุญาต; ฝ่ายข้อมูลส่วนบุคคลกำหนด data flow, retention/legal hold และการกู้คืน; ฝ่ายบัญชี/ภาษียืนยัน catalog, VAT, เอกสารและการคืนเงิน.

Feature flag `BMS_CLINIC_PILOT_TENANTS` มีค่าเริ่มต้นว่าง/ปิด และรอบนี้ไม่ได้เปิด flag. ห้ามเปิดให้ tenant จริงจนกว่าทุก gate จะผ่านและผู้รับผิดชอบอนุมัติ.
