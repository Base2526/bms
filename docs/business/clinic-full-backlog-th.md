# Backlog คลินิกผู้ป่วยนอกตาม dependency

อัปเดต 26 พฤศจิกายน 2026. ทุกงานใช้ข้อมูลสังเคราะห์และ feature flag ปิดจนผ่าน release gates; ไม่มีงานใดในเอกสารนี้อนุมัติ deploy/ใช้ผู้ป่วยจริง. สถานะปัจจุบันดู [feature matrix](clinic-full-feature-matrix-th.md) และ [ผลตรวจรับระยะ 1](clinic-phase1-acceptance-2026-11-26-th.md). `P0` เป็น prerequisite/ความปลอดภัย, `P1` เป็น core ที่ขึ้นกับ decision, `P2` เป็นงานเฉพาะบริการ, `P3` เป็นส่วนเสริม. แต่ละแถวเป็นชิ้นงานที่ review และทดสอบแยกได้; เกณฑ์รับมอบย่อไว้ และให้แตก implementation/test/docs ใน change เดียวกัน.

## P0 — ปิด technical-pilot gates ก่อนขยายขอบเขต

| ID | งาน / ผลที่ส่ง | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| G01 | สร้าง restored throwaway BMS schema และ apply/reapply `10.141`–`10.143` | dump ที่ปลอดข้อมูลจริง/สิทธิ์ local | migration, RLS/grants/FK/trigger/rollback ผ่านบน schema จริง; engineering |
| G02 | ทดสอบ clinic → charge → order → submit/confirm payment → void/refund/reconcile | G01; catalog สังเคราะห์ | ยอด/tax/discount/line amount/stock mismatch rollback; finance/engineering |
| G03 | ทดสอบ concurrency/retry ทั้งนัด reschedule/order/payment และ failure หลังไม่ทราบผล | G01–G02 | ID เดิมไม่สร้างซ้ำ; conflict/closed order แก้ด้วยคน; engineering |
| G04 | บัญชีทดสอบทุกบทบาท, revoked, tenant อื่น; browser `/admin/clinic` และ manual 2 widths | G01; auth test environment | หน้าหลัง login, cashier-only, error/truncation และ denial ตรวจจริง; QA |
| G05 | ทดสอบ file access ทุก route, support/impersonation, revoke ระหว่าง request และ synthetic sentinel ใน CRM/AI/log/report | G01/G04 | การถอน emergency grant ก่อนหมดอายุผ่านบน fixture `10.143`; route อื่นและ runtime leakage ยังต้องพิสูจน์; security/privacy |
| G06 | Backup/restore drill รวมไฟล์/ลายเซ็น/audit และ load/search/calendar | G01 | restore checksum/permission, SLO ที่ตกลง, runbook; ops/privacy |
| G07 | ตรวจ desktop/mobile POS order/payment/print/incoming/realtime ด้วย clinic-channel synthetic order | G02/G04 | ไม่มี chart payload, receipt ถูกยอด, device/PIN ไม่เปิด chart; QA |
| G08 | บันทึก release gate และความเสี่ยง, อัปเดตคู่มือ/หลักฐานเฉพาะที่รันจริง | G01–G07 | ไม่เรียก pilot ว่า production-ready; engineering/owners |

## D — Decision ที่หยุดการขยาย clinical workflow

| ID | งาน / ผลที่ส่ง | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| D01 | ยืนยันมี EMR/HIS เดิมหรือไม่และ source of truth ราย entity | เจ้าของคลินิก | ปิด [architecture decision](clinic-emr-architecture-decision-th.md) ด้วยผู้อนุมัติ/วันที่; owner |
| D02 | ยืนยันประเภทบริการ/สาขา/ผู้ใช้/เวร/ฟอร์ม/วิชาชีพ/ใบอนุญาต | เจ้าของคลินิกและผู้ประกอบวิชาชีพ | applicability 10 กลุ่มใน matrix ถูกยืนยัน; clinical owner |
| D03 | อนุมัติ privacy data map, ผู้แทน, retention/hold/export/backup/incident และ vendor | D01–D02 | policy/version/ผู้รับผิดชอบครบ; privacy owner |
| D04 | อนุมัติ SKU/ราคา/ภาษี/payer/receipt/refund/AR รายบริการ | D02 | charge matrix และกรณีทดสอบลงนาม; accounting/tax owner |

## P1 — Core clinic ที่ทำหลัง decision

| ID | งาน / ผลที่ส่ง | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| C01 | ทะเบียนสถานพยาบาล สาขา ห้องและอุปกรณ์ | D02 | server-scoped resource และ conflict test; clinic ops |
| C02 | ผู้ประกอบวิชาชีพ/หลักฐานใบอนุญาต/สถานะ/ตารางเวร/ผู้ดูแลแทน | C01, D02 | role + active assignment + schedule denial; clinical owner |
| C03 | ช่องเวลาว่าง วันหยุดและการจองที่คำนวณ capacity จริง | C01–C02 | concurrency/Asia-Bangkok/truncated list test; registrar |
| C04 | Walk-in, คิว, handoff, visit lifecycle และงานติดตาม | C03, D02 | state/actor/time/owner/overdue ทดสอบ; clinic ops |
| C05 | duplicate patient review, ผู้แทน/ผู้จ่าย และ provenance import | D01, D03 | ไม่มี auto-merge; identity ambiguity เข้าคิวคน; registrar/privacy |
| C06 | ตารางบริการ/ราคาประกาศ/ประมาณค่าใช้จ่ายตามสาขา | D04 | ราคา effective snapshot และ approval test; accounting |
| C07 | Charge จากบริการที่ทำจริงและ payer mapping | D04, C04/C11 หรือ I03 | order มีเฉพาะข้อมูลจำเป็น; denial/rollback; accounting |
| C08 | Payment/refund/AR/reconciliation worklist เชื่อม visit | C07, G02 | retry/partial/refund/closed mismatch ถูก audit; accounting |
| C09 | รายงานทะเบียน OPD/คิว/no-show/revenue ที่แยกสิทธิ์ | C04, C08 | count ตรง source; bounded read/PHI denial; manager/privacy |
| C10 | Clinical document/export/access history ตาม policy | D03 และ B-path หรือ EMR contract | signed/print/download/export audit และ revoked denial; privacy/clinical |
| C11 | Procedure/performed-service event ที่ clinician ยืนยัน | D02, D01 | แยก order/plan จาก performed, actor/time/reversal; clinical owner |

### ทาง A — มี EMR เดิมและเลือก integration

| ID | งาน / ผลที่ส่ง | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| I01 | ทำ vendor discovery และ data contract เฉพาะ system/visit/ref/version/approved charge | D01–D04 | contract ปฏิเสธ clinical prose ใน commerce; vendor/privacy |
| I02 | tenant/branch mapping และ identity reconciliation ที่ให้คนแก้ความกำกวม | I01, C05 | external ID ซ้ำ/ข้าม tenant ไม่รวม chart; registrar |
| I03 | authenticated inbox, version/idempotency/out-of-order handling | I01–I02 | duplicate/forged/reordered event ถูกปฏิเสธหรือ reconcile; security |
| I04 | outbox สถานะ order/payment/refund และ mismatch worklist | I03, C08 | retry หลัง timeout ไม่ส่ง/คิดซ้ำ; accounting/vendor |
| I05 | read-only clinical deep link หรือ handoff ตาม contract ที่อนุมัติ | I01, D03 | BMS ไม่คัดลอก chart; revoked access denial; privacy |

### ทาง B — BMS เป็นเจ้าของ EMR

| ID | งาน / ผลที่ส่ง | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| E01 | structured longitudinal problem/allergy/medication/history พร้อม provenance | D01–D03 | versioned/reconciled, ไม่มี auto-merge; clinical owner |
| E02 | vitals/assessment/nursing note และฟอร์มเวอร์ชันตามบริการ | E01, D02 | หน่วย/เวลา/actor/role/sign-off; clinical owner |
| E03 | clinical orders แยกยา/แล็บ/ภาพ/หัตถการ/ส่งต่อ | E02 | prescribe อย่างเดียวไม่ charge/stock; cancellation history; clinical owner |
| E04 | result/critical-result read acknowledgement และ escalation | E03 | result correction immutable, owner ack; clinical owner |
| E05 | dispense event แยก prescription และ lot-linked stock transaction | E03, D02/D04 | movement atomic, lot trace/retry/return; pharmacist/stock owner |
| E06 | administration/material-use event แยก dispense | E03/E05 ตามบริการ | actor/time/lot/patient trace/rollback; clinical owner |
| E07 | signed consent/certificate/referral/aftercare document templates | E02, D03 | template/version/signature/revocation/export audit; clinical owner |
| E08 | secure clinical report/export และ retention/hold/data-request workflow | E01–E07, D03 | denial/restore/audit and approved policy test; privacy owner |

## P2 — ทำเฉพาะประเภทบริการที่เจ้าของคลินิกยืนยันว่า applicable

| ID | งานแยก | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| S01 | ทันตกรรม: ผังฟัน/หัตถการรายซี่ | D02, E02/E03 หรือ EMR contract | tooth/site/procedure trace; ทันตแพทย์ |
| S02 | ทันตกรรม: ภาพ/แผนหลายครั้ง/แล็บฟัน | S01 | image/order/session provenance; ทันตแพทย์ |
| S03 | ความงาม: consent/ภาพก่อนหลัง | D02–D03, E07 หรือ EMR contract | consent/version/role/retention; clinician/privacy |
| S04 | ความงาม: คอร์ส/ล็อตสาร/ติดตาม | S03, E06/C08 | course balance + lot trace; clinician/accounting |
| S05 | วัคซีน: ตารางเข็ม/ให้จริง/ล็อต/ใบรับรอง/adverse event | D02, E06/E07 หรือ EMR contract | dose→lot→patient trace and recall; clinical owner |
| S06 | กายภาพ: แผนหลายครั้ง/คะแนน/ก้าวหน้า/คอร์ส | D02, E02/C08 หรือ EMR contract | scores/time/session balance; therapist |
| S07 | แล็บตนเอง: specimen/barcode/status/result/critical result | D02, E03/E04 หรือ EMR contract | mix-up denial, sign/ack; lab owner |
| S08 | ภาพวินิจฉัย: study/report/interpreter/PACS | D02, E03/E04 หรือ EMR contract | study identity/report version/access; radiology owner |
| S09 | ประกัน: eligibility/preauth/claim/denial/reconcile | D02–D04, C08 | payer balance/claim retry/privacy; claims owner |
| S10 | ตรวจทางไกล: identity/secure session/record/policy | D02–D03, E02 หรือ EMR contract | clinical and current-rule sign-off before any pilot; clinical owner |
| S11 | ตรวจสุขภาพองค์กร: roster/package/limited employer report/billing | D02–D04, C07/C09 | no individual PHI in employer export by default; privacy |
| S12 | หลายสาขา: HN/care access/schedule/stock/report | D02–D03, C01–C03 | branch isolation and cross-branch transfer tests; ops |

## P3 — เสริมเมื่อ core ผ่านและนโยบายอนุมัติ

| ID | งานแยก | พึ่งพา | เกณฑ์รับมอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- |
| X01 | Reminder/online booking/secure reply | C03, D03 | verified contact, opt-out, duplicate suppression; privacy |
| X02 | Patient portal/ผู้ปกครอง | C05, D03, E08 หรือ EMR contract | identity/representative proof/revocation; privacy |
| X03 | AI ช่วยร่างภายในขอบเขตที่อนุมัติ | D03, E02 หรือ EMR contract, AI review | ไม่มี auto-diagnose/order/sign/chart tool; clinical/privacy |

## วิธีปิดแต่ละงาน

อ่าน service/API/UI/migration/permission/order/payment/stock ที่แตะ, เพิ่ม test ที่เดิน behavior และ denial, รัน targeted ก่อน broader gate และ DB/browser ตามความเสี่ยง, recheck diff/data flow, อัปเดต matrix/คู่มือ/เอกสารใน change เดียวกัน. แยกผลเป็นโค้ดที่เขียนแล้ว, test ที่รันจริง, ข้อจำกัดที่ยังพิสูจน์ไม่ได้ และ approval ที่รอเจ้าของเรื่อง. ห้ามเปิด feature flag หรือใช้ข้อมูลจริงจากการที่ pure tests ผ่าน.
