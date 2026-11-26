# ตรวจรับคลินิก: ถอนสิทธิ์ฉุกเฉินและสลับผู้ป่วย — 26 พฤศจิกายน 2026

ขอบเขต: branch `codex/clinic-outpatient-phase1`, technical pilot หนึ่งสาขา, ข้อมูลสังเคราะห์เท่านั้น. Feature flag `BMS_CLINIC_PILOT_TENANTS` ยังปิดเป็นค่าเริ่มต้น. เอกสารนี้บันทึกหลักฐานรอบนี้แยกจาก [ผลตรวจรับระยะ 1](clinic-phase1-acceptance-2026-11-26-th.md). ไม่มีการ deploy หรือเปิดสิทธิ์ให้ผู้ป่วยจริง.

## ข้อบกพร่องที่ทำซ้ำและแก้

| เงื่อนไข / ผลที่คาด | ผลเดิม | การแก้และผลหลังแก้ |
| --- | --- | --- |
| Clinician เปิด emergency access แล้วหมดความจำเป็นก่อนครบ 15 นาที; ต้องถอนสิทธิ์ของตนเองและเก็บประวัติ | ไม่มี service/API/UI ถอน grant ก่อนหมดอายุ; DB test แดงด้วย `revokeClinicEmergencyAccess is not a function` | `10.143` เพิ่มเวลาถอน/ผู้ถอนและ constraint; service ตรวจ role, patient, confirmation, tenant และ audit ใน transaction; ย่น `expires_at` เพื่อให้ app รุ่นเก่าก็ไม่เปิด grant อีก; API และ UI ให้เจ้าของ grant ถอนเอง. DB test ผ่านหลังแก้ |
| สลับผู้ป่วย A → B ขณะคำขอประวัติ/encounter ของ A ยังไม่ตอบ; ต้องไม่แสดงข้อมูล A ใต้ชื่อ B | `showPatient()` และ `loadEncounter()` รับผลลัพธ์โดยไม่ตรวจว่าหน้าปัจจุบันยังเลือก A | หน้า clinic ล้างข้อมูลเวชระเบียน/ไฟล์/ผู้ติดต่อเมื่อสลับผู้ป่วย และรับผล asynchronous เฉพาะ selection/request ล่าสุด; เมื่อถอน grant จะยกเลิกการรับผลเก่าที่ค้าง. ตรวจด้วย typecheck และ production build; ยังไม่ได้พิสูจน์ interaction นี้ใน browser หลัง login |

การถอน grant ตัดเฉพาะ **เหตุฉุกเฉิน**. ถ้า clinician มีสิทธิ์จาก encounter ที่ตนดูแลอยู่แล้ว การเข้าถึงตาม care relationship ยังคงเป็นไปตามกฎเดิม. Emergency grant ไม่ให้สิทธิ์ดาวน์โหลดไฟล์แนบอยู่ก่อนแล้ว. การถอนเก็บ audit และประวัติ grant ไว้.

## หลักฐานที่รันจริงในรอบนี้

| พื้นผิว | ผล |
| --- | --- |
| Disposable PostgreSQL 16, `clinic_pilot_test` บน local `127.0.0.1:5544` | ใช้ `scripts/infra/clinic-pilot-fixture-base.sql` และข้อมูลสังเคราะห์; apply/reapply `10.141`, `10.142`, `10.143` ผ่าน. `node scripts/run-contract-tests.mjs db clinic-pilot` ผ่าน 4/4. DB contract ตรวจผู้ถอนเป็นเจ้าของ grant, confirmation, clinician/cashier, tenant, retry, audit rollback, expiry ของ app รุ่นเก่า, constraint และ column grant |
| Pure/route/i18n | `node scripts/run-contract-tests.mjs pure clinic-pilot` ผ่าน 9/9; `pure clinic-pilot-route` ผ่าน 1/1; `pure i18n-keys-contract` ผ่าน 4/4. Route contract ตรวจ 401 และไม่เชื่อ tenant/actor จาก client |
| Web | `apps/web npx tsc --noEmit` ผ่าน; หลังแก้ race รัน `apps/web npm run gate` ผ่าน: 4,018 tests, ผ่าน 4,012, ข้าม 6, ล้มเหลว 0; production build ผ่าน |
| Desktop / mobile | `apps/desktop npm run lint` ผ่าน; `npm test -- --runInBand` ผ่าน 178/178. `apps/mobile npm run typecheck` ผ่าน; `npm test -- --runInBand --watch=false` ผ่าน 66 suites, 520/520 tests. ไม่ได้ทดสอบบนอุปกรณ์จริง |
| Browser local build | `/admin/clinic` และ `/admin/manual/clinic` นำผู้ไม่ login ไป `/admin/login?next=...` ถูกต้องที่ desktop default viewport และ mobile 390×844. ไม่ได้ตรวจหน้า clinic, คู่มือ, cashier flow หรือ race หลัง login เพราะไม่มีบัญชีทดสอบที่ authenticated |

Fixture DB ขนาดเล็กไม่มี BMS order/payment/stock schema ครบ จึงยังไม่พิสูจน์ transaction end-to-end, rollback/retry ของ payment, restored schema, backup/restore หรือ concurrency ระหว่างการถอนกับคำขอ clinical read ที่กำลังทำงาน. ผล typecheck/build ไม่เท่ากับการตรวจ UI หลัง login.

## Release gates ที่ยังต้องตรวจรับ

1. ใช้ restored throwaway BMS schema ที่ไม่มีข้อมูลจริง apply/reapply `10.141`–`10.143`; ตรวจ RLS/grants/FK, order/payment/void/refund/reconciliation, migration rollback strategy, backup/restore และ concurrent clinical read/revoke.
2. ใช้บัญชีทดสอบ Registrar, Nurse, Clinician, Cashier, Administrator, revoked และต่าง tenant ใน browser desktop/mobile; ตรวจการสลับผู้ป่วยอย่างรวดเร็ว, revoke, error state, worklist และคู่มือหลัง login. ตรวจ desktop shell/mobile POS ด้วยอุปกรณ์ทดสอบเมื่อ integration environment พร้อม.
3. ให้เจ้าของคลินิกยืนยันว่าใช้ EMR เดิมหรือไม่, ผู้ประกอบวิชาชีพตรวจแบบฟอร์ม/สิทธิ์/ใบอนุญาต, เจ้าของข้อมูลอนุมัติ retention/incident/backup และฝ่ายบัญชีตรวจ catalog, VAT, ใบเสร็จ และการคืนเงิน.

ยังไม่ผ่าน clinical, privacy หรือ accounting/tax sign-off; ไม่สรุปว่าพร้อมใช้งานจริง. ห้ามเปิด production flag หรือใช้ข้อมูลผู้ป่วยจริงจากผลทดสอบนี้.
