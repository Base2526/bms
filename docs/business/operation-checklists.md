# Operations checklists — Release A + B + C + D

Release E adds [preparation plans and physical production](operation-production.md) linked to canonical
runs. Checklist approval/receipt never posts stock; production needs separate explicit confirmation.

Implementation branch: `codex/restaurant-operations-release-ab` (24 October 2026).
Entry point: `/admin/operations`. Requires migrations `10.91__bms_operation_checklists.sql`
and `10.92__bms_operation_followup.sql`; Release D also requires `10.93__bms_operation_team.sql` before deploying the app.
This document describes implementation scope, not evidence of production rollout.

## Release D: ตารางกะ → งานตามหน้าที่ → ส่งมอบ → ผู้จัดการ

Entry: **กะทีมงาน / Team shifts** in `/admin/operations`, plus an **Operations notifications** bell
on every authenticated admin page. This is an operations bell backed by the same tenant-scoped
inboxes, not the unrelated generic/social notifications subsystem. No email, LINE, native push,
payroll, attendance verification, POS cash-shift close, stock movement or financial posting.

- **Roster:** per branch, duty code, label, optional person, explicit-offset start/end (max 24 h).
  DRAFT can be edited with a version; PUBLISHED content cannot be edited. Cancel with a reason
  and create a replacement, preserving evidence. Publication serializes per tenant and rejects
  overlapping published duties for one person across branches; adjacent intervals are allowed.
  Vacancies can be published. Staff accept their own published duty only during `[start,end)`;
  ending requires prior acceptance. These acknowledgments do not prove physical presence.
- **Duty assignment:** existing schedules default FIXED. Optional DUTY resolves exactly one eligible
  published person in the same branch/duty at the original scheduled occurrence, not cron recovery
  time. Immediate work resolves at creation. Invalid/missing/ambiguous matches stay unassigned,
  with immutable resolution evidence and a supervisor notice when a recipient is configured.
  Subsequent roster changes never rewrite existing tasks. Staff must still have checklist execute
  permission; being on a roster grants no new authority. The unassigned queue remains actionable.
- **Handover:** one non-cancelled document per roster, with sender, eligible recipient, receive-by
  time, note and up to 200 linked original runs/actions/escalations currently assigned to sender.
  DRAFT → SUBMITTED → RECEIVED, or cancel before receipt with reason. Draft refresh re-reads source
  items; submit locks parents and rejects changed source versions. Submission freezes items/note.
  Receiving is recipient-only and does not approve, verify, close or reassign any original work.
  The detail compares original item snapshots with live state. Later notes are append-only events.
  Manager reroute is only for SUBMITTED documents, with new eligible recipient/reason/version/audit.
  It does not silently reroute original escalations.
- **Explicit task transfer:** only from RECEIVED handover, with handover.manage AND canonical
  checklist.manage, confirmation, reason, current handover/item versions. Original owner must still
  be the sender. Calls canonical ASSIGN/ACTION_ASSIGN inside the same transaction; preserves due_at
  and all normal state/branch/recipient rules. Escalations are not transferred here: use C reroute.
  Pending-review tasks cannot bypass their existing assignment/state rules.
- **Manager summary:** summary.review + view, one branch and Bangkok day. Roster/handover cohort
  uses roster start date; checklist/action/escalation cohort uses checklist due date. Current counts
  include vacancies, unaccepted duties, unassigned/overdue/review tasks, open actions, handovers
  and escalations. No future-day projection or financial meaning. Confirmation requires a current
  fingerprint, last review version and note; stores a new immutable snapshot. Existing confirmations
  never change; the UI shows current versus last confirmed counts and a changed indicator.
  More than 5,000 source rows in any category rejects the summary instead of silently truncating.
- **Notifications:** roster publish/cancel, vacancies, unresolved duty assignment, handover waiting/
  receipt/overdue and supervisor follow-up. C notices appear in the same global operations inbox.
  Reads are tenant/current recipient/current branch scoped; marking read never changes the task.
  Historical notices remain historical when recipients/work change. Lists poll every 30 seconds;
  overdue handovers are swept by the existing 15-minute cron (100 tenants × 100 rows, oldest-first,
  SKIP LOCKED). Dedup by recipient/entity/kind/version; append-note/reroute versions can produce
  a new overdue notice, but unchanged sweeps never spam repeated delivery.
- **On-duty supervisor:** optional per existing C policy, off by default. Requires a duty code and
  an eligible review-authorized person; absent/ambiguous duty falls back to the configured static
  supervisor. Manual and automated escalation use the same resolver. Existing escalations stay
  assigned until explicit reroute. No eligible fallback means no invented recipient.

Permissions: `operations.roster.manage`, `operations.roster.accept`, `operations.handover.manage`,
`operations.handover.receive`, `operations.summary.review`, always plus checklist.view. Manager
gets all five; Warehouse gets accept/receive; Administrator uses the normal permission catalog.
Roster readers see their own duties unless roster manager/checklist reviewer/summary reviewer.
Handover readers are sender/recipient or handover manager/checklist reviewer/summary reviewer. Branch restrictions
apply even to managers. Staff option lists are bounded at 200 and server revalidates each selection.
No AI tool is added. List/date filters are server-backed (25 rows/page, max 93-day range).

All D commands reuse the namespaced tenant/actor/key ledger. Permission checks precede replay;
unknown transport outcomes keep the same payload/key. Confirmed daily reads use serializable
transactions; serialization/deadlock rejection returns RETRY_REQUIRED for a fresh preview.
State, event, audit and transactional notice commit together. No realtime trigger was added.

### Release D rollout checklist

1. Back up and apply 10.91 → 10.92 → 10.93 on the target environment; check schema readiness
   before deploying this build. These columns are read by existing checklist flows too.
2. Verify role/branch assignments, fallback supervisor, scheduler ownership and cron secret.
3. Pilot one real branch: publish two adjacent duties, execute a duty-based checklist, hand over
   unresolved work, receive as the next person, explicitly transfer, then confirm manager summary.
4. Confirm real-account bell visibility, denied branches, overnight timing and operational sign-off.
   Local automated tests are not evidence that this production pilot occurred.
5. Rollback: pause the operations cron and disable team access before reverting app; preserve
   all roster/handover/review/assignment evidence. No destructive down migration.

## Release C: งานของฉัน → แจ้งเตือน → หัวหน้า → รายงาน

ที่แท็บ **งานและติดตามผล**:

1. **งานของฉัน** รวมแบบตรวจและงานแก้ไขที่มอบหมายให้ผู้ใช้ปัจจุบัน แยกคิวงานยังไม่มอบหมาย
   และงานที่มีสิทธิ์ตรวจ (ไม่แสดงงานที่ separate-review rule ห้ามตรวจเอง). Server เป็นผู้เลือก actor
   และสาขา ไม่รับ user ID จาก browser. 25 รายการ/หน้า พร้อมยอดรวม/เลยกำหนดจากฐานจริง.
2. **แจ้งเตือน** เป็น inbox ของหน้านี้; Release D รวมในกระดิ่งงานปฏิบัติการด้วย แต่ไม่ส่ง LINE, email หรือ push.
   มอบหมาย/ส่งตรวจบันทึกพร้อม transaction ของงาน; หลังเปลี่ยนสิทธิ์หรือสาขา อ่านแจ้งเตือนเดิม
   ต้องผ่านสิทธิ์ปัจจุบัน. อ่านแล้วไม่เปลี่ยนสถานะงาน. แจ้งมอบหมาย/เลยกำหนด dedup ตาม
   task + due instant + recipient; มอบกลับคนเดิมด้วย due เดิมไม่เตือนซ้ำ. ส่งตรวจซ้ำใช้เวลา
   submit/resolve ใหม่. ประวัติเก่ายังคงอยู่พร้อมสถานะงานปัจจุบัน ไม่แปลว่าตอนนี้ยังต้องทำเสมอ.
3. **ตั้งหัวหน้าสาขา** ต้อง manage; หัวหน้าต้อง view + review, ไม่ใช่ pos_only และเข้าถึงสาขาได้.
   ตั้งนาทีเตือนก่อนกำหนดและส่งต่อหลังเลยกำหนดได้ 0–10,080 นาที. Automatic ปิดโดย default;
   การแจ้งมอบหมาย/เลยกำหนด/ส่งตรวจไม่ต้องเปิด automatic. ถ้าไม่ได้ตั้งหัวหน้าจะไม่เดาผู้รับ
   และยังค้นงานรอตรวจจากคิว REVIEW ได้. Supervisor list/policy list จำกัด 200.
4. **ส่งต่อเอง** จาก drawer งาน: execute + เป็นผู้รับงาน/ผู้รับงานแก้ไข (งานไม่มอบหมายทำได้),
   หรือ execute + manage; ต้อง reason, confirmation, run version. ส่งถึงหัวหน้าที่ตั้งไว้เท่านั้น.
   หนึ่งเรื่อง active ต่อ run รวมปัญหาของ run นั้น; ส่งซ้ำแจ้ง ALREADY_ESCALATED.
   **รับเรื่อง** ต้องผู้รับปัจจุบัน + review + reason/version/confirmation. ไม่ approve checklist
   ไม่ verify action ไม่หยุดการนับ overdue. เรื่องปิดเมื่อ run APPROVED/VOID เท่านั้น.
   เปลี่ยน policy ไม่ย้ายเรื่องเก่าเอง; manage ใช้ **ย้ายถึงหัวหน้าปัจจุบัน** พร้อมเหตุผล
   เพื่อเปลี่ยนผู้รับและ reset acknowledgment โดยมี event/audit.
5. **รายงานตรวจร้าน** ต้อง review + view; เลือกวันกำหนดส่งเวลา Asia/Bangkok รวมสองปลาย
   ไม่เกิน 93 วัน. รวมทั้งงานที่จะถึงกำหนดในอนาคตในช่วงที่เลือก. รายงานเป็น current-state
   snapshot เมื่ออ่าน ไม่ใช่รายงานปิดงวด immutable. แสดง total/void/approved/on-time/overdue/
   pending-review/historically-failed และ corrective actions ที่ยังไม่ VERIFIED.
   อัตราตรงเวลา = approved ที่ reviewed_at ≤ due_at หาร total − void (ไม่มีงานแสดง —).
   ปัญหาซ้ำใช้ tenant/branch/template family/item key และ DISTINCT run ไม่ใช่จำนวน revision;
   อย่างน้อย 2 run, แสดง 50 กลุ่มแรกพร้อม truncated warning. FAIL ที่แก้เป็น PASS แล้ว
   ยังเป็นประวัติ แต่ VOID ไม่ร่วมตัวเลข failure/ปัญหา. ไม่ใช่คะแนนรับรองอาหารปลอดภัย.

Cron เดิมตรวจ follow-up ทุก 15 นาที: สูงสุด 100 tenants × 100 open runs ต่อรอบ,
เลือกตาม followup_at เก่าสุด, claim SKIP LOCKED; backlog/downtime อาจทำให้ช้าหลายรอบ.
Canonical write ใช้ parent-run lock เดียวกันและ sync inbox/escalation ใน transaction เดียวกัน;
หากเขียน inbox/audit ไม่ได้ ธุรกรรมนั้น rollback ไม่รายงานสำเร็จหลอก. Recipients ถูกตรวจซ้ำ
ตอน dispatch; ถ้าหัวหน้าหมดสิทธิ์จะไม่ส่ง ต้องแก้ policy/ย้ายเรื่อง. ไม่มี external I/O.
ไม่มีการแจ้งเตือนซ้ำทุก 15 นาทีสำหรับ occurrence เดิม; acknowledged ไม่สร้างเรื่องใหม่.
จำนวน processed ของ cron หมายถึง run ที่ตรวจ ไม่ใช่จำนวน notification ที่ส่ง.

Release C ต้อง apply 10.92 หลัง 10.91 ก่อน deploy. Rollback: พัก cron และปิดการเข้าถึง
ก่อนคืน app; เก็บตาราง/history ไว้. ไม่ deploy/apply production อัตโนมัติจากการ implement.

## ขอบเขต A + B ที่เพิ่ม

| Release | ทำได้ | ข้อจำกัด |
| --- | --- | --- |
| A: งานตรวจประจำร้าน | แม่แบบเปิดร้าน/ปิดร้าน/ทำความสะอาดตามหมวดที่ร้านตั้ง, สาขาและ kitchen station, version, ผู้รับผิดชอบ, กำหนดเวลา, ส่งตรวจ/อนุมัติ/ส่งกลับ, ประวัติ | ผ่านบัญชี Admin บนเว็บ responsive; ไม่ใช่ POS PIN, RN หรือ offline queue |
| B: หลักฐานและติดตามปัญหา | ค่าอุณหภูมิ/ตัวเลข, min/max, รูปหลักฐาน, เปิด corrective action เมื่อ FAIL, แก้ไข/ตรวจยืนยัน, ตารางรายสัปดาห์และ timezone, ตัวเลขงานค้าง/เลยกำหนด | แจ้งเตือนในหน้าจอเท่านั้น ไม่มี LINE/email/push หรือเครื่องวัด IoT |

ขอบเขต A–C ไม่เพิ่มตารางกะพนักงาน (เพิ่มใน D ข้างต้น); ทั้งหมดยังไม่เพิ่ม payroll, การซื้อ, การตัดของเสียหรือ stock อัตโนมัติ,
AI ตัดสินอาหารปลอดภัย, HACCP certification, สูตรเกณฑ์กฎหมาย หรือการเปลี่ยนเงิน/บิล POS.
ภาพโฆษณาที่ใช้วิเคราะห์เป็นรายการหัวข้อ ไม่ใช่ SOP/มาตรฐานที่คัดลอกลงระบบ.

## ขั้นตอนใช้

1. ผู้จัดการเปิด Templates → New template เลือกสาขาและ station ถ้ามี.
2. ตั้งรายการตรวจ (สูงสุด 50) และชนิดคำตอบ: yes/no, pass/fail, number,
   temperature, text, photo หรือ choice. ตั้ง required, รูปบังคับ และ N/A ได้.
3. กำหนดช่วง min/max และหน่วยตาม SOP ของร้านที่ผู้รับผิดชอบตรวจแล้ว.
   ระบบไม่มีค่าอุณหภูมิเริ่มต้นที่อ้างว่าเป็นมาตรฐานความปลอดภัยอาหาร.
4. Save draft → ตรวจเนื้อหา → Publish. การแก้แม่แบบสร้าง version ใหม่เสมอ;
   งานที่สร้างแล้วถือ snapshot เดิม ไม่เปลี่ยนย้อนหลัง.
5. Create run พร้อมผู้รับผิดชอบ/กำหนดเวลา หรือ Schedule พร้อม timezone,
   วันในสัปดาห์, เวลา และหน้าต่างทำงานเป็นนาที. ผู้ไม่ระบุชื่อเป็นงานที่ผู้มีสิทธิ์ในสาขารับทำได้.
6. ผู้ทำบันทึกค่าจริงและหลักฐาน. ค่านอกช่วงหรือผล FAIL เปิด corrective action
   ใน transaction เดียวกัน. บันทึก PASS ภายหลังไม่ปิดปัญหาเดิมให้เอง.
7. ผู้รับผิดชอบแก้ไขพร้อมเหตุผล → ผู้ตรวจ Verify corrective action → Submit/Approve งาน.
   ถ้าเปิด separate reviewer คนที่เคยบันทึกผลของงานนั้นอนุมัติ/ส่งกลับเองไม่ได้;
   ผู้แก้ corrective action ยืนยันการแก้ของตัวเองไม่ได้.
8. Reject ต้องระบุเหตุผลแล้วกลับไปบันทึก/ส่งใหม่ได้. Void ต้องมีเหตุผลและเก็บประวัติ;
   ไม่ใช่การ Verify ปัญหา. Approved/VOID แก้ผลหรือแนบรูปเพิ่มไม่ได้.

N/A ต้องมีเหตุผลและแม่แบบต้องอนุญาต; ไม่ถือเป็น PASS และยกเว้นรูปบังคับของรายการนั้น.
ค่าตัวเลขที่ไม่มีขอบเขต, ข้อความ, choice และ photo เป็น RECORDED ไม่ใช่ PASS.
การ Approve คือรับรองว่าตรวจงาน/การแก้ปัญหาแล้ว ไม่ใช่รับรองว่าอาหารปลอดภัยตามกฎหมาย.

## Permissions และขอบเขต

- `operations.checklist.view`: อ่านงาน/แม่แบบ/รูปในสาขาที่อนุญาต.
- `operations.checklist.execute`: บันทึก/ส่งงานและแก้ปัญหาที่ไม่ได้มอบให้คนอื่น.
- `operations.checklist.review`: อนุมัติ/ส่งกลับ/void และ verify/reopen ปัญหา.
- `operations.checklist.manage`: สร้าง/เผยแพร่แม่แบบ, สร้าง/มอบหมายงาน, ตั้ง/พัก schedule.

ทุก action ต้องมี view ด้วย; ซ่อนปุ่มไม่ใช่การอนุญาต. Server ใช้ tenant จาก session
และตรวจ branch allowlist ซ้ำ. Migration เพิ่มสิทธิ์ทั้งสี่ให้ Manager และ view/execute
ให้ Warehouse ของ tenant ที่มีอยู่ โดยไม่ลบ custom permissions. Administrator ใช้กลไกเดิม.
พนักงาน `pos_only` ไม่ใช่ผู้รับมอบหมายสำหรับหน้านี้; ตรวจ role configuration หลังสร้างร้านใหม่.

รูปรับ PNG/JPEG/WebP สูงสุด 5 MiB, 20 megapixels, 5 รูปต่อรายการต่อ run;
decode จริง, ตัด metadata และบันทึก WebP ไม่เกิน 1600 pixels. รูปเป็น private,
อ่านผ่าน `/api/bms/operations/evidence/[id]` ที่ตรวจ tenant + branch + view.
generic files list/download ไม่เปิดเผยรูปหลักฐาน และ FK กันการลบไฟล์ที่อ้างอิงอยู่.

File metadata uses the storage-side connection because migration 9.28 denies `bms_app`
SELECT on `files`. Upload authorization runs before storage, then the tenant transaction
rechecks assignment/version and commits the evidence link, event and audit together. Failed
attachments soft-delete only proven orphan file rows and remove their bytes; a lost commit
response must preserve an already-attached image. Downloads authorize the evidence/run/branch
before reading same-tenant private, non-deleted file metadata outside the restricted role.
เก็บไฟล์ใน storage driver เดิม; rollback ระหว่างลงทะเบียนพยายามล้างไฟล์ใหม่.
process crash ระหว่างเขียน bytes และ commit อาจทิ้ง orphan bytes; ไม่อ้างว่ามี GC ใหม่.

## สถานะและ concurrency

Run: `OPEN → IN_PROGRESS → SUBMITTED → APPROVED`;
`SUBMITTED → REJECTED → IN_PROGRESS/SUBMITTED`; งานที่ยังไม่ Approved อาจ VOID พร้อมเหตุผล.
Corrective action: `OPEN → IN_PROGRESS → RESOLVED → VERIFIED`; การอ่าน FAIL ใหม่
หรือผู้ตรวจ Reopen ทำให้กลับ OPEN. UI แก้จาก OPEN เป็น RESOLVED ได้โดยตรง.

Content ของ template เป็น immutable revision; status อาจ DRAFT → ACTIVE → RETIRED.
หนึ่ง family มี ACTIVE เดียว. การ publish version ใหม่พัก schedule ของ family เดิม;
ต้องตั้ง schedule ใหม่ให้ version ใหม่เอง. Retire พักเฉพาะ schedule ของ version นั้น.
Schedules เป็น create/pause เท่านั้น; ปรับเวลาโดย pause แล้วสร้างใหม่.

คำสั่งมี stable idempotency key + fingerprint ต่อ tenant/actor, optimistic version,
row/family locks. การตอบกลับหายต้อง retry payload/key เดิม. หน้าจอคงคำสั่งที่ค้าง
และแสดงปุ่ม retry เหนือ drawer/modal; reload browser ไม่ใช่การยืนยันผลล้มเหลว.
หลัง reload ต้องตรวจประวัติ/สถานะก่อนสร้างงานหรือแม่แบบซ้ำ.
การตัดสินใจ, audit, results/actions และ command result commit/rollback พร้อมกัน.
ไม่มีธุรกรรมไปยัง stock/payment/POS.

## Scheduler และการอ่าน

`POST /api/bms/operations/run` ใช้ cron-secret guard และ `recordJobRun`.
Docker/GitHub registry เรียกทุก 15 นาที; เลือก owner เดียวตาม `BMS_CRON_RUNNER`.
เวลาใน schedule เป็นเวลาตาม timezone; งานอาจปรากฏช้าถึงรอบ dispatcher ถัดไป
และขึ้นกับความพร้อมของระบบ ไม่ใช่ real-time SLA.

Worker claim ด้วย `FOR UPDATE SKIP LOCKED`, unique occurrence ป้องกันสร้างซ้ำ;
หนึ่ง invocation อ่านไม่เกิน 100 tenants / 20 schedules ต่อ tenant และสร้างหนึ่ง occurrence
ต่อ schedule. หลัง downtime จะทยอยสร้าง occurrence ที่ค้างโดยเก็บ due time เดิม
(อาจแสดง overdue) ไม่ทิ้งอดีตเงียบ ๆ. PostgreSQL เป็นผู้แปลงเวลา/DST;
เวลาที่ซ้ำ/ข้ามใช้กติกา `AT TIME ZONE` ไม่ใช่งานสองรอบต่อวัน.
แม่แบบเลิกใช้หรือสาขาปิดทำให้ schedule พัก. ตรวจ assignment เมื่อจัดตาราง;
ถ้าสิทธิ์พนักงานเปลี่ยนภายหลัง ผู้จัดการต้อง reassign งาน/ตั้ง schedule ใหม่.
ข้อผิดพลาด tenant batch ถูกนับ failed และ route แจ้ง failed job โดยไม่ undo batch อื่น.

Workspace polling 30 วินาที + refresh หลัง write. Detail ใช้ refresh เอง/หลัง write;
ไม่มี realtime triggers ใหม่. Run search/status/page อยู่ server (25 ต่อหน้า).
Templates/schedules/actions จำกัด 100 รายการต่อการเลือกสาขา; staff/stations จำกัด 200.
ประวัติ detail ล่าสุด 500 results / 200 events / 250 evidence; ไม่ใช่ export ประวัติทั้งหมด.
ตัวเลขงานค้าง/เลยกำหนด/รอตรวจ/ปัญหาเป็น aggregate จริง ไม่อนุมานจากหน้าแรก.

## Rollout / rollback

1. สำรองฐานเป้าหมายและตรวจ migration/grants เดิม (users/roles/files/locations/stations/audit).
2. Apply `10.91` แล้ว `10.92` ด้วยผู้มีสิทธิ์ schema/GRANT ก่อน deploy application.
   ตรวจ schema readiness; test suite ใช้ฐานจำลอง ไม่ได้พิสูจน์ production migration.
3. Deploy application + scheduler registry คู่กัน, ตรวจ storage และ cron secret,
   เปิด `/admin/operations` ด้วย Manager และผู้ทำงานจริง.
4. Pilot 1 สาขา: template → fail → corrective action → reviewer → approve,
   photo permission ของต่างสาขา, duplicate retry, scheduled occurrence และ job history.
5. Rollback โดยพัก schedules/ถอดสิทธิ์เมนูและหยุด dispatch route นี้ก่อนคืน app version.
   เก็บตาราง รูป และประวัติไว้ ไม่ drop หลักฐานเพื่อตัด feature.

## Verification

- Pure policy suite: `node scripts/run-contract-tests.mjs pure operation-checklists`.
- Disposable PostgreSQL suite: `node scripts/run-contract-tests.mjs db operation-checklists`;
  ต้อง `POSTGRES_HOST=127.0.0.1`/`localhost`, `POSTGRES_DB=bms_operations_test` และฐานทิ้งได้.
  สร้าง synthetic dependencies และ apply migration สองรอบ; ไม่ใช้ production dump.
- UI fixture: `BMS_SMOKE_URL=http://127.0.0.1:3018 node scripts/operation-checklists-browser-smoke.mjs`
  (ต้อง Playwright + Chrome; ตั้ง `BMS_PLAYWRIGHT_MODULE` ถ้าอยู่นอก dependency path).
  จริง: Next component/CSS และ schema; จำลอง: auth/GraphQL transport.
- `cd apps/web && npm run gate`: typecheck, DB-free suites, production build.

การทดสอบข้างต้นไม่แทนการทดลองกับบัญชีร้าน/production storage/scheduler จริง.

ผล baseline A+B ก่อน Release C วันที่ 24 ต.ค. 2026: DB contract 16/16 ผ่านบน isolated PostgreSQL 16 ที่ localhost:5549;
browser fixtures ผ่านทั้งไทย/อังกฤษที่ 1280×1000 และ 390×1000 รวมหน้าคู่มือ,
ตรวจภาพหน้าจอแล้ว. HTTP จริงบน Next local server: upload/download ไม่ล็อกอินตอบ 401;
cron ที่ไม่มี secret ตอบ 503 โดยไม่รันงาน. การรัน `npm run test:pure` แยกผ่าน 3,070,
ข้าม 6, ไม่ผ่าน 0. รอบสุดท้าย `npm run gate` exit 0: typecheck, pure (3,027 ผ่าน,
6 ข้าม, 0 ไม่ผ่าน ตาม output ของรอบนั้น) และ production build ผ่าน.
จำนวนรายกรณีที่รายงานต่างกันระหว่างรอบ; ไม่ใช้จำนวนนี้ยืนยันว่าพิสูจน์ทุก workflow.
Build มี Browserslist/Node deprecation warnings; ไม่ได้อัปเกรด dependency ใน release นี้.
หยุด local Next dev และ container ทดสอบหลังตรวจเสร็จ; ไม่มี production migration/deploy.

### ผลตรวจ Release C — 24 ต.ค. 2026

- `npm run gate` exit 0: typecheck, DB-free tests (3,071 ผ่าน / 6 ข้าม / 0 ล้มเหลว)
  และ Next production build ผ่าน. มี Node/Browserslist deprecation warnings เดิม.
- Disposable PostgreSQL 16 localhost:5549: 23/23 tests ผ่าน รวม apply 10.91/10.92 ซ้ำ,
  RLS ของตาราง C, actor/branch/RBAC, notices dedup/concurrent sweeps, revoked recipient,
  manual escalation/ack/reroute, rollback เมื่อ insert notice ล้มเหลว, report timezone/
  distinct-run historical FAIL และ GraphQL adapter ที่ derive tenant จาก session.
- Browser fixture ผ่าน en/th ที่ 1280×1000 และ 390×1000: A+B เดิมและ My work/inbox,
  manual escalation, acknowledgment, supervisor policy edit, exact-key retry หลัง response หาย,
  inspection report, no raw translation keys/document overflow และคู่มือ. ตรวจ screenshot แล้ว.
  Auth/GraphQL transport เป็น fixture; ไม่ใช่ live tenant end-to-end acceptance.
- HTTP จริง: POST cron ที่ไม่มี secret ตอบ 503. ไม่รันงานโดยไม่มี authority.
- หยุด dev server และ test container แล้ว. ยังไม่ได้ commit/push, apply migration production
  หรือ deploy. ต้อง pilot กับบัญชี/สิทธิ์/สาขาและ cron owner จริงหลัง rollout.

### ผลตรวจ Release D — 24 ต.ค. 2026

- Final `npm run gate` exit 0: typecheck, DB-free suites (**3,061 passed / 6 skipped / 0 failed**
  in the final run) and Next production build passed. Earlier D gate had 3,075 passed; counts are
  reported per run, not used as a claim of complete production acceptance. Existing Node/Browserslist
  deprecation warnings remain. `git diff --check` passed.
- Disposable PostgreSQL 16 localhost:5549: **32/32 tests passed**, including A–C regressions and
  idempotent application of 10.93, concurrent cross-branch overlap, duty acceptance/occurrence
  resolution, ambiguity/revoked permission, immutable handover/explicit transfer with original due,
  recipient reroute, notification dedup, daily confirmation/change detection, audit rollback,
  fail-closed RLS/history grants and real typed GraphQL reads/commands/denials.
- Browser fixtures: **en/th × 1280×1000/390×1000 passed**. Includes A–C, DUTY creation input,
  roster form/exact-key retry/publication, handover receipt and explicit transfer, opening linked
  original work, manager confirmation, global operations bell read/deep links, roster deep link,
  permission denial, schema/variable validation, no document overflow/raw translation keys and
  manual page. Desktop/mobile screenshots inspected. Form inputs/bell have explicit accessible names.
  This uses real Next components/CSS and committed SDL, with synthetic auth/GraphQL transport;
  it is not a real-store end-to-end pilot or proof of actual staff attendance.
- Actual local HTTP cron without secret: **503**, no unauthenticated dispatch.
- Local Next and disposable DB container stopped after tests. No commit/push, production migration,
  deployment, real staff messaging or production sign-off was performed.
