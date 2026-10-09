# AI usage and cost audit — 2026-10-09

รายงานนี้ตรวจโค้ดและทดสอบกับข้อมูลจำลองในเครื่อง ไม่ได้อ่าน invoice หรือฐาน production
จึงยืนยันช่องโหว่และพฤติกรรมของโค้ดได้ แต่ยังสรุปยอดขาดทุนจริงย้อนหลังไม่ได้

เพดานปัจจุบันตามคำสั่งล่าสุดคือ **$100 ต่อร้านต่อเดือน รวม Business** เตือนที่ $80/$90
โดยรวมยอดที่กันไว้ด้วย การปรับเพดานไม่ล้างต้นทุนหรือวงเงินสำรองของเดือนเดิม:
ร้านที่ยอดรวมถึงหรือเกิน $100 จะถูกปฏิเสธ shared AI คำขอใหม่เมื่อใช้โค้ดนี้

ตรวจรอบปรับเพดาน $100: AI pure contracts 786/786, DB contracts 28/28, TypeScript และ
browser smoke ไทย/อังกฤษที่ 1440px/390px ผ่าน โดยใช้ฐานและ API จำลอง ไม่เรียก provider จริง

## สิ่งที่พบและแก้

| จุด | ผลกระทบ | การแก้ |
| --- | --- | --- |
| Sidebar ใช้ cache-first และอ่านใหม่ทุก 5 นาที; การใช้ AI ไม่ refetch quota | ใช้ AI แล้วตัวเลขมุมซ้ายล่างค้าง แม้ backend หักเครดิตแล้ว | Apollo refetch active usage queries หลัง BMS mutation สำเร็จหรือ error และหลัง customer insights; poll 30 วินาทีสำหรับ worker/webhook และ refetch เมื่อกลับมาที่หน้าต่าง |
| เครดิตถูกเรียกสับสนกับ token | หนึ่งคำขออาจใช้หลายพัน token แต่หักหนึ่งเครดิต; Business หักศูนย์ตามนโยบาย unlimited | แสดงหน่วยเครดิตชัดเจน แยก token/provider calls/cost และแสดงวงเงิน Business |
| ไม่เคยมีเพดาน USD ต่อร้าน | unlimited หรือคำขอราคาแพงมีต้นทุนไม่สัมพันธ์กับเครดิต | ทุกแพ็กเกจรวม Business มีเพดาน shared inference $100 ต่อร้านต่อเดือน UTC ตามคำสั่งเจ้าของระบบ |
| บันทึก attempt ล้มเหลวแล้วทำ network call ต่อได้ | มีต้นทุนแต่ไม่มีหลักฐาน durable รองรับ | admission ล้มเหลวต้องหยุดก่อน network; finalization ล้มเหลวหลัง network เก็บ reservation ไว้ |
| OCR/คำตอบว่างโยน error ก่อนส่ง usage กลับ | output ผิดรูปแบบแต่ provider คิดเงินจริง ถูกแสดงเป็น unknown โดยไม่จำเป็น | ส่งเฉพาะ usage ตัวเลขผ่าน error envelope และ finalize แม้ parse ไม่ผ่าน |
| บาง caller อ่านเฉพาะ regular input โดยไม่รวม prompt cache | tokens/cost ต่ำกว่าจริง | normalize regular/read/write แยกกัน; รวม input เพื่อรายงานและคิด rate ของ cache แยก |
| Qwen env ว่างถูก Number("") แปลงเป็น 0 | อัตราต้นทุนเป็นศูนย์ | รับเฉพาะ finite positive override; ที่ว่าง/invalid/0 ใช้ default ของ region |
| rate ของ DeepSeek เป็นราคา promotion เก่า และเดารุ่นจาก substring | ประเมินต่ำกว่าราคาใหม่ หรือให้ราคาแก่รุ่นที่ยังไม่รู้ | rate card รุ่นที่ตรวจแล้ว ใช้ peak list rate ของ DeepSeek และปฏิเสธ shared รุ่นที่ยังไม่มี rate |
| cost ที่ทราบถูกทิ้งถ้าคำขอเดียวมีอีกรอบไม่ทราบราคา | ยอด known subtotal หาย | เก็บ known cost พร้อมจำนวน unpriced calls และกันส่วนที่ยังไม่ทราบ |
| caller แจ้ง providerCalls=0 ทั้งที่ DB มี attempt แล้ว | คืนเครดิต/วงเงินให้คำขอที่อาจเสียเงินจริง | ใช้จำนวน attempt ที่ persist แล้วเป็นค่าขั้นต่ำ |
| เติมเครดิตหลังลดแพ็กเกจคำนวณจาก balance ที่ clamp แล้ว | ledger.balance_after ไม่ตรงโควตาจริง | คำนวณจาก granted + bonus + adjusted − consumed ก่อน clamp |

โค้ดก่อน branch นี้มี fix `COALESCE($3::numeric, 0)` สำหรับการ finalize cost ทศนิยมแล้ว
จึงคง fix เดิมและทดสอบถดถอย ไม่อ้างว่าเป็นบั๊กที่เพิ่งแก้ใน branch นี้

## บัญชีสามหน่วยและวงเงิน

- **เครดิต**: หนึ่ง logical request ต่อ finite plan; tool rounds/retry/fallback ไม่หักซ้ำ
  OCR fallback ใช้ `usage_group_id` เดียวกันแต่มี event แยกตาม provider; Business/BYOK หักศูนย์
- **Provider calls/tokens**: ทุก attempt ที่ผ่าน admission บันทึกก่อน network และทุก round ที่ได้
  usage เก็บจำนวนจริงจาก response; crash ระหว่าง admission กับ network แยกจากการยิงจริงไม่ได้
  จึงเป็น conservative attempt evidence ไม่ใช่ invoice
- **Attributed USD**: usage × rate card; ไม่รวมภาษี/ส่วนลดตามสัญญาและไม่อ้างว่าเป็น provider invoice
  ไม่มี usage = `NULL`; มีบางส่วนเก็บเฉพาะต้นทุนที่ทราบและจำนวน unpriced calls
- **วงเงิน shared**: `known shared cost + held reservations + next attempt ceiling <= 100`
  BYOK แสดง usage แต่ไม่กินวงเงินที่แพลตฟอร์มจ่าย; platform health probes เป็น overhead แยก
  การเติมเครดิตไม่เพิ่มเพดาน USD และไม่มีตัวเลือก client ให้ bypass

`bms_ai_usage_monthly` เป็น lock ร่วมต่อ tenant/month ก่อน lock event ทุกเส้นทาง
admission/finalization/stale reconciliation จึงไม่แย่งเงินก้อนสุดท้ายกันระหว่างหลายแท็บหรือ workers
tenant writes ใช้ `beginTenantTx()` และ RLS; resolver ไม่รับ tenant จากข้อมูลที่โมเดลส่งมา

Reservation คิดเต็ม input envelope 1,000,000 tokens ของรุ่นที่อนุญาต รวมอัตรา cache write สูงสุด
ที่โค้ดนี้เปิดใช้ (Anthropic ephemeral 5 นาที 1.25×), บวก output ตาม `max_tokens` ที่ส่งจริง
caller ที่ไม่ส่งเพดาน output ใช้ conservative 1,000,000 tokens ไม่ใช้ tokenizer/ความยาวข้อความเดา
ไม่มี server-side paid search/tools, batch/priority inference, 1-hour cache หรือ US-only inference
ในเส้นทางนี้ การเพิ่ม feature เหล่านั้นหรือรุ่นที่มี context/rate tier ใหม่ต้องทบทวน reservation ก่อน
legacy Sonnet long-context beta ไม่ถูกเปิดผ่าน headers ของ shared transport

เมื่อ finalize usage ครบ: แทน reservation ด้วยต้นทุนที่ทราบครั้งเดียว
เมื่อ timeout, crash, response ไม่มี usage หรือ finalize DB ล้มเหลว: คงวงเงินไว้เพื่อครอบคลุม
ต้นทุนที่อาจเกิด ไม่คืนเพราะรอเกิน 15 นาที ส่วนที่ไม่เคยผ่าน admission คืนเครดิตได้แบบ atomic
การ retry/fallback ต้องผ่าน admission ใหม่เสมอ แม้ไม่หักเครดิตเพิ่ม
หากปฏิเสธหลัง tool ทำงานแล้ว runtime ไม่ replay tool และคงคำตอบจากผล backend ที่ตรวจสอบแล้ว
ลูกค้าจะเห็น handoff ให้เจ้าหน้าที่ ไม่เห็นรายละเอียดวงเงิน/ข้อมูล Billing ของร้าน

วงเงินเป็น calendar month UTC (เริ่มเดือน 07:00 เวลาไทย) ผูกกับเดือนที่ admit attempt
event เดือนเก่าห้ามเริ่ม provider call ใหม่ ผลล่าช้ายังลงเดือนเดิม ไม่มีการย้ายหนี้เก่าไปเดือนใหม่
อาจหยุดก่อนยอด known cost ถึง $100 เพราะคำขอถัดไปต้องใส่ได้ทั้ง ceiling และ unknown holds

## Rate card และข้อจำกัด

ตรวจจากแหล่งทางการวันที่ 2026-10-09:

- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/): ใช้ peak list rate
  ของ Flash/Pro และ cache hit แยก ไม่สมมติ off-peak discount หรือวันหยุดจีน จึงอาจสูงกว่า invoice
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): รุ่นที่ระบุใน
  `priceForModel()` และอัตรา ephemeral cache ที่ใช้อยู่; ไม่เดารุ่นอนาคตจากชื่อ family
- [Qwen VL OCR](https://www.alibabacloud.com/help/en/model-studio/qwenvl-ocr): default แยก
  US/Frankfurt/global กับ Singapore international; override ที่ตั้งต้องตรงสัญญา deployment

Rate card เปลี่ยนตาม provider ได้ ต้องตรวจเมื่อปรับ model/region/API feature
เพดานนี้ควบคุม rate-card exposure ในแอป ไม่ใช่สัญญาว่า provider invoice รวมทุกระบบจะไม่เกิน
$100: shared key อาจมีผู้เรียกนอก BMS, probe overhead, tax หรือ rate เปลี่ยนโดยไม่แจ้งแอป
ข้อมูล cost เก่าไม่ถูกคำนวณใหม่ย้อนหลังจาก rate ปัจจุบัน เพราะจะเปลี่ยนหลักฐานทางบัญชี

## Rollout และตรวจสอบย้อนหลัง

1. ตรวจฐาน production แบบ read-only ด้วย `db/checks/ai-usage-consistency.sql` ข้อ 1–4 ก่อน
   deploy; หลัง migration ใช้ข้อ 5 ดู known/reserved/unaccounted ต่อร้าน
2. ต้องใช้ migrations `10.54__bms_ai_cost_budget.sql` และ `10.55__bms_ai_limit_notices.sql` ก่อนโค้ดใหม่ และผ่าน schema readiness
   เพิ่ม column `budget_reserved_usd NUMERIC(16,8) NOT NULL DEFAULT 0` พร้อม nonnegative check
   และ partial index shared tenant/month; ไม่มีการเติม cost ที่ไม่ทราบเป็นตัวเลขเดา
3. ถ้าเดือนปัจจุบันมี legacy shared attempt ที่ไม่มี cost/ไม่มี hold ระบบจะพัก shared AI ของร้านนั้น
   เป็นพฤติกรรมที่ตั้งใจ ไม่ควร zero-out หรือคืนวงเงินโดยไม่มีหลักฐาน provider
   ระบบยังไม่มีหน้าจอ reconcile invoice/ปลด hold: ต้องสอบเทียบหลักฐานและทำ data correction
   ผ่านงานแยกที่ตรวจสอบได้ก่อนเปิด shared ต่อ ห้ามแก้ production อัตโนมัติจากชุดทดสอบนี้
4. หยุด/ระบาย in-flight งานของเวอร์ชันเก่าก่อน rollout เพื่อไม่ให้ old admission เขียน attempt
   โดยไม่กันวงเงินร่วมกับโค้ดใหม่ migration อย่างเดียวไม่บังคับ budget ให้ old binary
5. ทดลองหน้า assistant/Drawer, report, customer insights, OCR และ worker ด้วยร้านทดสอบ
   เทียบ Sidebar/Billing กับ event ledger; ผู้ใช้ BYOK อาจยังใช้ shared OCR/pharmacy ได้
   ดังนั้นการมี BYOK ไม่ใช่เหตุผลให้ซ่อน shared quota ทั้งร้าน

ไม่ deploy, ไม่ปรับ production data และไม่เรียก AI provider จริงระหว่างการแก้ชุดนี้

## Regression coverage

- DB contract: concurrent Business admission, tenant separation, BYOK exclusion, refund/idempotency,
  retry expense, partial/unknown holds, legacy unknown, month separation, credit adjustment
- Existing AI DB contract: cost ทศนิยม, stale reservations, credit ledger equality, tokens/breakdown
- Runtime/OCR: admission denial before network, malformed output retains tokens, fallback shares credit
- Client: actual Apollo observable receives fresh server quota after success and response failure;
  aliases/fragments และ credit top-up denominator
- Gate: TypeScript, database-free contracts และ Next production build (ผลการรันแจ้งในสรุปงาน)

ผลทดสอบใน branch นี้:

- AI contracts: 782 ผ่าน; หลังแก้รอบท้ายรัน accounting/client/rate อีก 12, sidebar 11,
  และ i18n 4 กรณีผ่าน
- Accounting DB: 21/21 ผ่าน รวม concurrent admission และ fault injection ให้ PostgreSQL
  ปฏิเสธ finalization จริง แล้วตรวจว่า hold ยังอยู่และ retry finalize ไม่หักซ้ำ
- Browser: หน้า Assistant → quota เปลี่ยน 10 → 11 หลังตอบ; Billing ของ Business แสดง cap
  และสถานะพัก ใช้ API จำลอง ทดสอบไทย/อังกฤษที่ 1440px และ 390px ไม่มี page overflow
- Full pure suite: 2,535 ผ่าน, 2 skipped, 1 failed (`every Admin alert can be dismissed`)
  ตัวที่ไม่ผ่านคือ Alert เดิมใน `CustomerOrderDetail.tsx:33` และ `DashboardActions.tsx:111`
  ซึ่งตรวจว่ามีอยู่ใน HEAD ก่อน branch นี้และไม่ได้แก้ในงาน AI
- TypeScript และ production build ผ่าน; build มีคำเตือนต่อฐาน local ที่ไม่ได้เปิดระหว่าง static
  generation จึงไม่ใช่การทดสอบข้อมูลจริงครบทุก route

DB verification uses an isolated PostgreSQL 16 fixture with the real accounting migrations applied
twice; it is not a full production-dump replay or proof of production provider invoice totals.

## Limit reached and owner notification (`10.55`)

- Credit exhaustion, insufficient shared budget, and unverifiable cost are separate server statuses.
  A denied call persists its required reservation before raising an error. Thus $0.75 remaining
  correctly reports a pause for a refused $6.25 reservation. A cheaper call may still pass its own
  admission check. A released hold clears the pause when the refused requirement fits again.
- Admin banners show 80%/90% warnings and pauses across desktop and mobile, with the next UTC-month
  boundary formatted in Bangkok time. Credit warnings use the granted + bonus + adjusted capacity;
  cost warnings include both attributed spending and reserved funds. Unlimited Business credits
  still produce cost warnings. The sidebar and Billing share the same server pause flag.
- Administrator/Manager receive personal in-app notifications without needing an open browser.
  `bms_ai_limit_notices` has tenant RLS and a unique shop/month/dimension/level key. Notice and
  recipient notifications commit together, once per level per month (80, 90, paused, resumed).
  A jump straight to a higher threshold records that threshold; repeated pause/recovery cycles in
  one month do not generate additional notices. The live banner always shows current status.
  Recipients are selected when the level first emits; newly appointed owners use the live banner.
- The bell shows up to 30 items, unread first, and the total unread count, with recipient-and-tenant checked
  acknowledgement. It is history, not evidence that a previous pause still applies. Active queries
  refresh after AI actions, every 30 seconds, on tab focus, and on explicit refresh. Dismissed banners
  reappear on route/status/month changes. Alerts are in-app only; no email, LINE, or OS push is sent.
- Notification writes run under the monthly lock in a savepoint (2-second timeout per SQL statement).
  Failure rolls back only the notice; cost reservations remain committed. The next accounting
  operation or usage read retries delivery. No Redis or external notification service is required.
- A denied OCR call returns `usage_blocked`, makes no provider call, and instructs manual slip review.
  It does not claim a provider outage or auto-confirm a payment. AI pauses never authorize replay of
  already completed tools. Existing POS, stock, order and manual payment workflows remain available.

The new migration also adds `budget_denied_required_usd`, `budget_denied_model`, and
`budget_denied_provider` to monthly accounting. Refusal evidence is month-scoped; pricing errors
clear after a priced shared call is admitted (or on the next month). Unknown past costs still require
evidence-based reconciliation; adding credits never releases those holds or raises the $100 cap.

Additional verification for `10.55`: AI pure suite 785 passed; updated status/auth tests 4 passed;
realtime coverage 6, schema readiness 8 and i18n 4 passed. Database admission/notification tests: 28/28 passed;
also cover failed notification inserts, recovery, shared-budget refusal with positive balance, and
credit top-up retaining the cost cap. Browser checks passed in Thai/English at 1440px/390px,
including 80/90 warnings, both pause dimensions and personal read acknowledgement. TypeScript and
the production build passed. The full gate found the pre-existing non-dismissible Alert contract
and a new missing realtime classification; the classification was fixed and its 6 tests rerun green.
The unrelated Alert failure still prevents calling the full gate green.
