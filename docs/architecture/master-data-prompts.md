# Platform master data — prompts ทุกเฟส

ข้อมูลกลางของแพลตฟอร์ม (ไม่ใช่ของร้านใดร้านหนึ่ง) แบ่งเป็น 8 เฟส · ทำทีละเฟสตามลำดับ
เพราะเฟสหลังพึ่งตารางของเฟสก่อน · **แต่ละเฟสใช้ได้โดยแปะ "ส่วนกลาง" + "เฟสนั้น" ต่อกัน**

สถานะ ณ 2026-10-16 (ตรวจจากรีโป ไม่ใช่จากฐาน production):

| สิ่งที่มี | เก็บที่ไหน |
| --- | --- |
| แพ็กเกจ | `bms_plans` (ไม่มี RLS) แก้ด้วย migration เท่านั้น |
| ตั้งค่าแพลตฟอร์ม | `10.21` delivery provider · `10.22` social login · `10.57` app downloads |
| ขนส่ง | `carriers/constants.ts` |
| โซนค่าส่ง | `shippingZones.ts` (3 โซน ไม่มีตารางจังหวัด) |
| วิธีชำระ / ธนาคาร | `paymentConfiguration.ts` (`bankName` เป็นข้อความอิสระ) |
| ประเภทร้าน / capability | `shop-archetypes.json`, `storeCapabilities.ts` |
| ราคาค่า AI | `aiUsage.ts` (บางตัว override ด้วย env) |
| รหัสเอกสาร e-Tax | `etax/xml.ts` (`T02/T03/T04`) · `unitCode` = ชื่อหน่วยที่ร้านพิมพ์ ❌ |
| เบอร์ฉุกเฉิน | `pharmacy/emergency.ts` + ซ้ำใน `boardGameCustomerGuard.ts`, `pharmacy/assessments.ts` |
| ร่างคำแนะนำร้านยา | `pharmacy/guidanceTemplates.ts` (ร้านคัดลอกไปเป็นของตัวเอง) |
| ที่อยู่ลูกค้า | `bms_customer_addresses.address TEXT` ช่องเดียว (+ `province/postcode TEXT` จาก `7.47`) |
| country / currency / timezone | `bms_store_profile` TEXT · `Asia/Bangkok` hardcode ~253 จุด |
| ไม่มีเลย | ธนาคาร · หน่วยมาตรฐาน · อำเภอ/ตำบล/รหัสไปรษณีย์ · ข้อมูลยา · แคชบาร์โค้ด · วันหยุด · หมวดหมู่ตั้งต้น |

| เฟส | เนื้อหา | พึ่ง |
| --- | --- | --- |
| 1 | รากฐาน + ธนาคาร + หน่วย + ที่อยู่ไทย | — |
| 2 | ใช้ที่อยู่แบบมีโครงสร้างจริง (ใบกำกับเต็ม · ค่าส่ง · จัดส่ง) | 1 |
| 3 | ขนส่ง + โซนค่าส่งเป็นข้อมูลกลาง | 1, 2 |
| 4 | ภาษี / e-Tax reference | 1 |
| 5 | ค่าตั้งต้นของร้านใหม่: หมวดหมู่ · หน่วยตั้งต้น · วันหยุด · เบอร์ฉุกเฉิน | 1 |
| 6 | แคชบาร์โค้ดกลาง | 1 |
| 7 | ข้อมูลยากลาง (ร้านยา) | 1, 6 |
| 8 | ย้ายค่าตั้งค่าแพลตฟอร์มเข้า DB + country/currency/timezone + AU/UK | 1–5 |

---

## ส่วนกลาง (แปะไว้หน้าทุกเฟส)

```text
บริบท: BMS (repo นี้) · ทำงานบน branch ใหม่จาก develop ชื่อ feat/master-data-phase-<N>
ห้าม commit/push/deploy/apply migration เข้า production จนกว่าผมสั่ง

อ่านก่อนเริ่ม: CLAUDE.md, AGENTS.md, docs/agent-invariants.md, docs/architecture/database.md,
docs/architecture/master-data-prompts.md (ไฟล์นี้ — อ่านผลของเฟสก่อนหน้า), CLAUDE.local.md
ตรวจสภาพจริงก่อนเชื่อสิ่งที่ prompt เขียน — ถ้าไม่ตรงให้รายงาน ไม่ใช่เดาต่อ

กฎข้อมูลกลาง (ห้ามละเมิด):
1. ตารางข้อมูลกลางชื่อขึ้นต้น bms_master_* · ไม่มี tenant_id · ไม่เปิด RLS
   (RLS ของ repo นี้ซ่อนแถว tenant_id IS NULL — ดูคอมเมนต์ 7.40 — ห้ามทำค่ากลางเป็นแถว NULL)
   GRANT SELECT ให้ bms_app เท่านั้น · เขียนได้เฉพาะเส้นทาง platform admin (requirePlatformAdmin)
2. มี country_code ตั้งแต่แรก (TH/AU/GB) แม้เฟสนั้น seed แค่ TH
3. ค่าที่เปลี่ยนตามเวลา มี effective_from/effective_to · แก้ = เพิ่มแถว ไม่ทับ
4. เลิกใช้ = active=false ไม่ DELETE
5. เอกสาร/บิล/ที่อยู่ที่ใช้แล้ว snapshot ค่าลงแถวของตัวเอง — แก้ข้อมูลกลางต้องไม่เปลี่ยนเอกสารเก่า
6. แบบ "ค่ากลาง + ร้านแก้ทับ": ร้านสร้างแถวของตัวเอง (มี tenant_id + RLS ตามปกติ) ไม่แก้ค่ากลาง
7. ข้อมูลจากภายนอกมี source + source_version · ตรวจสัญญาอนุญาตก่อนนำเข้า ไม่แน่ใจให้หยุดถาม
8. นำเข้าข้อมูลจำนวนมากด้วยสคริปต์ที่รันซ้ำได้ (dry-run เป็นค่าปริยาย, --apply เพื่อเขียน)
   ไม่ฝังข้อมูลหลักพันแถวใน migration
9. การแก้ข้อมูลกลางลง audit + revision ในทรานแซกชันเดียวกับการเขียน
10. ไม่แตะ money path (createOrderInTx / recordPosSale / vat.ts / สูตรลิ้นชัก) เว้นแต่เฟสนั้นระบุ
    ถ้า createOrderInTx เริ่มเขียนคอลัมน์ใหม่ → ประกาศใน scripts/schemaReadiness.mts
    และ regenerate db/checks/schema-readiness.sql ในงานเดียวกัน
11. ตั้งเลข migration: ls db/migrations/*.sql | sort -V | tail ก่อนทุกครั้ง · เช็คเลขซ้ำด้วย
    ls db/migrations/*.sql | sed 's#.*/##' | grep -oE '^[0-9]+\.[0-9]+' | sort | uniq -d (ต้องว่าง)
    apply ด้วย psql -1 (ล้มกลางไฟล์ต้องไม่ทิ้งตารางครึ่งเดียว)
12. GraphQL ใหม่ → npm run schema:export · ถ้าแตะ type ที่ mobile ใช้ → regenerate RN codegen
13. UI ผ่าน t() ครบ th/en · Alert ใน /admin ต้อง closable · หน้า platform gate ที่ layout ด้วย
    requirePlatformAdminPage · หน้าใหม่ต้องมี guide ในแคตตาล็อกผู้ช่วย + ปักคำถามใน
    scripts/ai-eval/work-assistant-question-corpus.mts (ต้องเป็นอันดับหนึ่ง)

เทส:
- pure contract + DB contract ของเฟสนั้น · รันไฟล์เดียวด้วย node scripts/run-contract-tests.mjs <mode> <filter>
- mutation test อย่างน้อย 6 แบบ แดงถูก subtest · สำรองไฟล์/commit ก่อน mutate
  (ห้าม git checkout ไฟล์ที่ยังไม่ commit) · ตรวจ git status หลังจบว่าคืนครบ
- ตัดคอมเมนต์ก่อนสแกนซอร์ส · split ด้วย /\r?\n/ (ไฟล์เป็น CRLF) · assert ด้วย assert.ok(re.test()) ไม่ใช่ assert.match ทั้งไฟล์

ประตูก่อนรายงานว่าเสร็จ:
- cd apps/web && npm run gate
- ชุด DB ที่เกี่ยวข้องกับฐาน dev — ไม่มี Postgres ให้บอกตรง ๆ ว่ายังไม่ได้รัน ห้ามอ้างว่าผ่าน
- เปิดหน้าที่แก้ในเบราว์เซอร์จริง (เข้าไม่ได้เพราะ login ให้บอก)
- จดผลใน CLAUDE.local.md: ผ่านอะไร · ยังไม่ได้ verify อะไร · migration ที่ต้อง apply ก่อน deploy
- อัปเดตตาราง "ผลแต่ละเฟส" ท้ายไฟล์ docs/architecture/master-data-prompts.md
- รายงานความเสี่ยง production: ตารางที่ถูกล็อก · วิธี backup/rollback · SELECT ตรวจหลัง apply
```

---

## เฟส 1 — รากฐาน + ธนาคาร + หน่วย + ที่อยู่ไทย

```text
เป้าหมาย: สร้างชั้นข้อมูลกลางชุดแรก แบบอ่านอย่างเดียวสำหรับร้าน ไม่เปลี่ยนพฤติกรรมของเดิม

ขอบเขต:
A. Migration:
   - bms_master_banks (code, country_code, name_th, name_en, swift, active, sort_order)
   - bms_master_units (code UN/ECE Rec 20, name_th, name_en, aliases text[], kind: COUNT/WEIGHT/VOLUME/LENGTH,
     base_factor สำหรับแปลงหน่วยในชนิดเดียวกัน, active)
   - bms_master_th_provinces / _districts / _subdistricts (+ postcode) ลำดับชั้น FK ชัดเจน
   - revision trigger ของทุกตาราง
   - seed ธนาคารไทยหลัก + หน่วยที่ร้านใช้จริง (ชิ้น/กล่อง/แพ็ก/ขวด/กระป๋อง/ถุง/กก./กรัม/ลิตร/มล./เม็ด/แผง/จาน/แก้ว/ชุด)
B. scripts/import-th-address.mts รันซ้ำได้ · บันทึก source/source_version
C. lib/bms/masterData.ts: อ่านด้วย query() · เขียนด้วย transaction + requirePlatformAdmin + audit
D. GraphQL: query อ่าน (ต้องล็อกอิน) · mutation แก้ (platform admin)
E. หน้า /admin/master-data แท็บ ธนาคาร / หน่วย / ที่อยู่ (ดูและแก้ · ค้นได้)
F. ต่อใช้แบบไม่ทำลายของเดิม:
   - ฟอร์มบัญชีรับเงิน: เลือกธนาคารจาก master → เก็บ bank_code + snapshot bankName · ข้อมูลเก่ายังอ่านได้
   - หน่วยขาย (pack): เพิ่ม unit_code nullable map จาก master · etax/xml.ts ใช้ unit_code ถ้ามี
     ไม่มีให้ fallback แบบเดิม + /admin/pos-readiness แสดงหน่วยที่ยังไม่ map (warning ไม่ใช่ blocker)
   - ที่อยู่: เพิ่มคอลัมน์ subdistrict_code/district_code/province_code/postcode nullable + autocomplete
     ห้ามบังคับกรอก ห้ามแปลง address เดิม

นอกขอบเขต: ทุกอย่างของเฟส 2–8

เทสเฉพาะเฟส:
- ตาราง bms_master_* ไม่มี tenant_id/RLS · bms_app มี SELECT อย่างเดียว (เขียนแล้วต้อง 42501)
- mutation ข้อมูลกลางทุกตัวเรียก requirePlatformAdmin
- ปิดธนาคารแล้วบัญชีเดิมของร้านยังแสดงชื่อเดิม (snapshot)
- e-Tax ใช้ unit_code เมื่อมี · fallback เดิมเมื่อไม่มี
- import ที่อยู่รันสองรอบได้จำนวนแถวเท่าเดิม
```

---

## เฟส 2 — ใช้ที่อยู่แบบมีโครงสร้างจริง

```text
เป้าหมาย: ที่อยู่ที่ใช้ทำเงินหรือเอกสาร (ใบกำกับเต็ม · ที่อยู่จัดส่ง · ต้นทางค่าส่ง) มาจากข้อมูลกลาง
แทนข้อความที่พิมพ์เอง โดยไม่ทำให้ที่อยู่เก่าใช้ไม่ได้

ขอบเขต:
A. ฟอร์มที่อยู่ลูกค้า (หลังบ้าน · checkout ลิงก์ลูกค้า · AI customer chat · POS ฟอร์มผู้ซื้อใบกำกับเต็ม
   · QR ขอใบกำกับ normalizeTaxRequestBuyer): เลือก จังหวัด→อำเภอ→ตำบล→รหัสไปรษณีย์อัตโนมัติ
   ทุกที่บันทึกทั้ง code และ snapshot ข้อความ
B. ใบกำกับภาษีเต็ม: ที่อยู่ผู้ซื้อพิมพ์จาก snapshot (ไม่ใช่ join master ตอนพิมพ์)
   ข้อมูลเก่าที่ไม่มี code ยังพิมพ์จากข้อความเดิมได้ทุกตัวอักษร
C. ที่อยู่ร้าน (store profile + สาขา bms_locations): เพิ่ม code แบบเดียวกัน
D. ตัวช่วยจับคู่ที่อยู่เก่า: สคริปต์ dry-run ที่เสนอ code ให้ที่อยู่ TEXT เดิม
   (รายงานความมั่นใจ · ไม่เขียนเองถ้ากำกวม) · --apply เขียนเฉพาะที่ตรงเป๊ะ
E. AI: ทูลที่เก็บที่อยู่ลูกค้าต้อง resolve ผ่าน master · ตำบลชื่อซ้ำหลายจังหวัด = ถามกลับ ห้ามเดา

กฎ:
- ห้ามบังคับให้ที่อยู่เก่าต้องแก้ก่อนขายได้
- บังคับ code เฉพาะที่อยู่ "ใหม่" ของใบกำกับเต็มประเภท COMPANY (ตัดสินใจกับผมก่อนทำ — เป็นการเปลี่ยนพฤติกรรม)
- ไม่แตะสูตรค่าส่ง (เป็นเฟส 3)

เทสเฉพาะเฟส:
- ใบกำกับที่ออกไปแล้ว พิมพ์ซ้ำได้ข้อความเดิมทุกตัวอักษรหลังแก้ชื่อตำบลใน master
- ตำบลชื่อซ้ำต่างจังหวัด AI ต้องถามกลับ
- ที่อยู่เก่าที่ไม่มี code ยังสร้างออร์เดอร์/ใบกำกับได้
- สคริปต์จับคู่ไม่เขียนแถวที่กำกวม
```

---

## เฟส 3 — ขนส่งและโซนค่าส่งเป็นข้อมูลกลาง

```text
เป้าหมาย: เลิกเดาโซนค่าส่งจากชื่อจังหวัด และย้ายรายชื่อขนส่งจากโค้ดเข้า DB

ขอบเขต:
A. bms_master_carriers (code, country_code, name_th/en, tracking_url_template, tracking_no_pattern,
   integration_status: LIVE/MOCK/NONE, active) · seed จาก carriers/constants.ts ให้ได้ค่าเดิมทุกตัว
B. bms_master_th_shipping_zones: province_code → zone (BANGKOK/PERIMETER/UPCOUNTRY)
   + ร้านแก้ทับได้ที่ตารางของร้าน (กฎ "ค่ากลาง + ร้านแก้ทับ")
C. shippingZones.ts: ถ้ามี province_code ใช้ตาราง · ไม่มีใช้ alias ชื่อแบบเดิม (fallback)
D. ใบปะหน้า/ลิงก์ติดตามใช้ tracking_url_template · ตรวจรูปแบบเลขพัสดุเป็น warning
E. carriers/constants.ts เหลือเป็นชนิด TypeScript ของ code เท่านั้น หรือคงไว้เป็น fallback พร้อมเทสว่าตรงกับ seed

กฎ:
- ⚠️ ค่าส่งเข้าฐาน VAT — ต้องมีเทส golden ว่าออร์เดอร์ชุดเดิมได้ค่าส่งเท่าเดิมเป๊ะ
  ก่อน/หลังเปลี่ยนแหล่งโซน (ทุกจังหวัดที่ alias เดิมรู้จัก)
- ขนส่งที่ integration_status ≠ LIVE ต้องไม่ถูกอ้างว่า "เชื่อมต่อแล้ว" ที่ไหน (รวมแคตตาล็อกผู้ช่วย)

เทสเฉพาะเฟส:
- golden ค่าส่ง 77 จังหวัด (โซนเดิม = โซนใหม่ เว้นแต่จังหวัดที่ alias เดิมไม่รู้จัก — รายงานแยก)
- ร้านแก้ทับโซนได้โดยไม่กระทบร้านอื่น
- ปิดขนส่งแล้วพัสดุเก่ายังแสดงชื่อ/ลิงก์ติดตามจาก snapshot
```

สถานะ: implemented บน branch `feat/master-data-phase-3` ด้วย migration `10.78`, code-first zone
resolution + tenant override, shipment carrier snapshots, platform/tenant admin UI และ pure/DB
contract tests. Tracking URL/pattern ของ seed เดิมคงเป็น `NULL` จนมีเอกสาร carrier ที่ตรวจสอบแล้ว;
ระบบรองรับ template โดยไม่เดา endpoint.

---

## เฟส 4 — ภาษีและ e-Tax reference

```text
เป้าหมาย: รหัสที่กรมสรรพากรกำหนดอยู่ในข้อมูลกลางที่มีเวอร์ชัน แทนค่าคงที่ในโค้ด

ขอบเขต:
A. bms_master_tax_document_types (code T01–T07…, name_th/en, effective_from/to)
B. bms_master_vat_rates (country_code, rate, effective_from/to) — **อ่านเป็นค่าแนะนำ/ตรวจสอบเท่านั้น**
   อัตราที่ใช้คิดเงินยังเป็น bms_store_profile.vat_rate ของร้านตามเดิม
   readiness เตือนเมื่ออัตราของร้านไม่ตรงกับอัตราที่มีผลวันนี้
C. ประเภทผู้ซื้อ (COMPANY/INDIVIDUAL/FOREIGNER) + กติกาเลขผู้เสียภาษี/สาขา เป็นตาราง reference
   ที่ thaiTaxId.ts / taxBuyer.ts อ่าน (ตรรกะ checksum ยังอยู่ในโค้ด)
D. etax/xml.ts อ่านรหัสเอกสารจาก master ตามวันที่ของเอกสาร (ไม่ใช่วันนี้)
E. หน้า /admin/master-data แท็บ ภาษี

กฎ:
- ⚠️ ห้ามเปลี่ยนตัวเลขภาษีของบิลใดเลย — vat.ts ไม่ถูกแตะ
  เทส golden เดิมใน vat-contract (134.00 BASE_FIRST · 354.00 VAT_FIRST_TRUNCATE) ต้องเขียวโดยไม่แก้
- เอกสารเก่าใช้รหัส ณ วันที่ออก ไม่ใช่รหัสปัจจุบัน
- e-Tax ยังเป็น BETA — ห้ามอ้างว่าพร้อมยื่นจริง

เทสเฉพาะเฟส:
- XML ของเอกสารเดิมได้ไบต์เท่าเดิม (snapshot test)
- เพิ่มรหัสเวอร์ชันใหม่ที่ effective_from อนาคต แล้วเอกสารวันนี้ยังใช้รหัสเดิม
- readiness เตือนเมื่อ vat_rate ร้านไม่ตรง แต่ไม่บล็อกการขาย
```

สถานะ: implemented บน branch `feat/master-data-phase-4` ด้วย migration `10.79`, effective-dated
document/VAT/buyer references, issue-date XML resolution, advisory VAT readiness และแท็บภาษีใน
Master Data. Mapping XML เริ่มต้นรักษา byte contract เดิมและยังระบุชัดว่า e-Tax เป็น BETA.

---

## เฟส 5 — ค่าตั้งต้นของร้านใหม่

```text
เป้าหมาย: ร้านที่เพิ่งสมัครเริ่มจากข้อมูลที่ใช้ได้เลย แทนที่จะเริ่มจากศูนย์

ขอบเขต:
A. bms_master_category_templates (archetype, parent, name_th/en, sort_order) → ปุ่ม "ใช้หมวดหมู่ตั้งต้น"
   คัดลอกลง bms_product_categories ของร้าน (ร้านแก้ต่อได้ · คัดลอกซ้ำไม่งอกซ้ำ)
B. หน่วยตั้งต้นตาม archetype (อ้าง bms_master_units)
C. bms_master_holidays (country_code, date, name_th/en, kind: PUBLIC/BANK) + สคริปต์นำเข้ารายปี
   ใช้เป็นข้อมูลแสดงผลก่อน (วันครบกำหนดลูกหนี้ · เวลารับออร์เดอร์ · cron) — การให้มีผลกับการคำนวณ
   วันครบกำหนดต้องถามผมก่อน
D. bms_master_emergency_numbers (country_code, kind: MEDICAL/POISONING/SELF_HARM/…, number, label_th/en, priority)
   แทนค่าคงที่ 3 ไฟล์ · emergency.ts อ่านจาก master พร้อม fallback ค่าคงที่ในโค้ด
   **ด่านฉุกเฉินต้องทำงานได้แม้ DB ล่ม** (ตรวจข้อความดิบก่อน context read ตามกฎเดิม)
E. onboarding checklist / ปุ่มข้อมูลตัวอย่าง ใช้ข้อมูลชุดนี้

กฎ:
- ข้อความฉุกเฉินที่ลูกค้าเห็นต้องเหมือนเดิมทุกตัวอักษร (เทส SHA-256 ที่มีอยู่ต้องเขียวโดยไม่แก้)
- ไม่ seed อะไรลงร้านเดิมอัตโนมัติ — ร้านกดเอง

เทสเฉพาะเฟส:
- DB ล่ม/ตารางไม่มี → ข้อความฉุกเฉินยังตอบด้วย fallback
- คัดลอกหมวดหมู่สองครั้งไม่งอกซ้ำ · ร้านแก้แล้วคัดลอกใหม่ไม่ทับของร้าน
```

---

## เฟส 6 — แคชบาร์โค้ดกลาง

```text
เป้าหมาย: บาร์โค้ดที่ร้านหนึ่งยืนยันแล้ว ช่วยร้านถัดไปกรอกสินค้าได้ทันที และลดการเรียก API ภายนอก

ขอบเขต:
A. bms_master_barcodes (barcode, name, brand, size_text, unit_code, category_hint, image_file_id nullable,
   source: PROVIDER/MERCHANT_CONFIRMED/PLATFORM_CURATED, confirmations, status: CANDIDATE/APPROVED/REJECTED)
B. เส้นทาง autofill: master APPROVED → provider ภายนอก → ไม่มี
C. ร้านกด "ยืนยันข้อมูลนี้ถูกต้อง" ตอนบันทึกสินค้า = ส่ง candidate (opt-in ต่อร้าน · ค่าปริยายปิด)
D. หน้า platform admin ตรวจ candidate (approve/reject/แก้)

กฎ (ความเป็นส่วนตัว + ความถูกต้อง):
- ห้ามเก็บราคา ต้นทุน สต็อก ชื่อร้าน หรือ tenant_id ใน master (เก็บแค่จำนวนการยืนยัน)
- ห้ามเก็บบาร์โค้ด prefix 20–29 (เลขภายในร้าน) และป้ายเครื่องชั่ง
- เปลี่ยน docs/business/product-barcode-autofill.md ที่เขียนว่า "ไม่เก็บ payload" ให้ตรงความจริงใหม่
  และตรวจเงื่อนไขการใช้งานของ barcodelookup.com ว่าอนุญาตให้เก็บหรือไม่ — ไม่อนุญาต = เก็บได้เฉพาะ
  ข้อมูลที่ร้านยืนยัน/แก้เอง ห้ามเก็บ payload ของ provider · ไม่แน่ใจให้หยุดถาม
- autofill เป็นค่าเริ่มในฟอร์มเท่านั้น ไม่เขียนสินค้าให้เอง

เทสเฉพาะเฟส:
- master ไม่มีคอลัมน์ราคา/tenant
- prefix 20–29 และ 21/22 ไม่ถูกส่งเข้า master
- ร้านที่ไม่ opt-in ไม่ส่ง candidate
```

---

## เฟส 7 — ข้อมูลยากลาง (ร้านยา)

```text
เป้าหมาย: ลดงานรีวิว policy ยาทีละตัวของแต่ละร้าน (ต้นเหตุของ PHARMACY_POLICY_UNKNOWN)
โดย "เสนอ" ค่าตั้งต้น ไม่ "ตัดสิน" แทนร้าน

ขอบเขต:
A. bms_master_drugs (code, generic_name, dosage_form, strength, regulatory_class ตาม พ.ร.บ.ยา,
   suggested_sale_policy, suggested_quantity_limit, barcodes, source, reviewed_by_pharmacist,
   reviewed_at, version)
B. หน้า policy ยาของร้าน: แสดงค่าแนะนำจาก master + ปุ่ม "ใช้ค่าแนะนำ" ที่ยังต้องผ่านผู้มีสิทธิ์
   pharmacy.policy.review ของร้านกดอนุมัติ (บันทึก snapshot ของค่าแนะนำที่ใช้)
C. ผูกยาของร้านกับ master ผ่านบาร์โค้ด (เฟส 6) หรือเลือกเอง

กฎ (ห้ามละเมิด):
- master ไม่เปลี่ยน policy ของร้านเองเด็ดขาด · ไม่มี "อนุมัติครั้งเดียวใช้ข้ามร้าน"
  (สอดคล้องกับที่ผู้ใช้ยืนยันไว้สำหรับแม่แบบคำแนะนำ 10.47)
- แถวที่ reviewed_by_pharmacist = false แสดงป้าย "ยังไม่ได้ตรวจโดยเภสัชกร"
- ไม่มีข้อความคลินิกใหม่ที่ลูกค้าเห็นในเฟสนี้
- เนื้อหาต้องมีเภสัชกรผู้มีใบอนุญาตเป็นเจ้าของ — ถ้ายังไม่มีชื่อผู้รับผิดชอบ ให้ทำเฉพาะโครงสร้าง
  + ข้อมูลตัวอย่างที่ติดป้ายชัด และหยุดถามผมก่อน seed ข้อมูลจริง
- อ่าน apps/web/lib/bms/pharmacy/README.md ก่อนแตะ lib/bms/pharmacy/

เทสเฉพาะเฟส:
- แก้ master แล้ว policy ของร้านไม่เปลี่ยน
- ใช้ค่าแนะนำต้องผ่านสิทธิ์ + audit ในทรานแซกชันเดียวกัน
- ด่านขายยาเดิม (evaluatePharmacySale) ผลเท่าเดิมทุกเคสใน pharmacy-policy-decision-contract
```

---

## เฟส 8 — ย้ายค่าตั้งค่าแพลตฟอร์มเข้า DB + หลายประเทศ

```text
เป้าหมาย: ค่าที่ทีมแพลตฟอร์มต้องแก้บ่อย แก้ได้โดยไม่ deploy · และเตรียม AU/UK

ขอบเขต (แยกเป็น PR ย่อยได้ ทำทีละข้อ):
A. bms_master_countries / _currencies / _timezones · store profile เก็บ code ที่ FK ไป master
   (backfill จาก TEXT เดิม · ค่าที่ไม่รู้จักรายงาน ไม่เดา)
B. timezone ของร้าน: แทน "Asia/Bangkok" hardcode ทีละโมดูล โดยเริ่มจากรายงาน/วันบริการ/cron
   แต่ละโมดูลต้องมีเทสว่าร้านไทยได้ผลเท่าเดิมเป๊ะ
C. ที่อยู่ AU (state/suburb/postcode) และ UK (postcode) — ตรวจ data residency ก่อน (ข้อมูลร้าน AU/UK
   อยู่ region ไหน) และตรวจสัญญาอนุญาตชุดข้อมูล
D. AI rate cards: bms_master_ai_rates (provider, model, input/output USD per million, effective_from)
   aiUsage.ts อ่านตามวันที่ของ event · env override ยังชนะตามเดิม
   ⚠️ ห้ามคำนวณ cost ของ event เก่าใหม่
E. แก้แคตตาล็อกแพ็กเกจ (bms_plans) ผ่านหน้า platform admin พร้อม version/audit
   — การเปลี่ยนสิทธิ์ของแพ็กเกจกระทบทุกร้าน ต้องมีหน้า preview จำนวนร้านที่ได้รับผลก่อนบันทึก
F. archetype/capability presets ย้ายเข้า DB **เฉพาะเมื่อ** retail-local contract
   (packages/retail-local-contract/shop-archetypes.json) ยังได้ค่าเดียวกัน — ถ้าขัดกันให้หยุดถาม

กฎ:
- ทุกข้อมี fallback ค่าในโค้ดเมื่ออ่าน DB ไม่ได้ และเทสว่าร้านไทยเดิมได้ผลเท่าเดิม
- licensing ไม่ sanction ร้าน (กฎเดิมของ Retail Local) — การแก้แพ็กเกจห้ามปิด POS/การขาย

เทสเฉพาะเฟส:
- golden ของรายงาน/วันบริการร้านไทยไม่เปลี่ยนหลังเลิก hardcode
- rate card ใหม่ไม่เปลี่ยน cost ของ event เก่า
- เปลี่ยน feature ของแพ็กเกจแล้วหน้า preview นับร้านที่กระทบถูก
```

---

## ผลแต่ละเฟส

| เฟส | branch | migration | สถานะ | ยังไม่ได้ verify |
| --- | --- | --- | --- | --- |
| 1 | `feat/master-data-phase-1` | `10.76` | ทำโค้ดครบ: master tables/service/GraphQL/UI, bank+unit integration, customer autocomplete, importer, audit+revision, tests | DB contract และ browser desktop/mobile ยังไม่ได้ verify |
| 2 | `feat/master-data-phase-2` | `10.77` | ทำโค้ดครบ: structured address resolver/snapshots, customer checkout+AI, tax request/full invoice, store/branch forms, legacy matcher; focused+full gate ผ่าน และ browser guard responsive smoke ผ่าน | DB contract และฟอร์ม browser หลัง login ยังไม่ได้ verify; รอคำตอบเรื่องบังคับ code สำหรับ COMPANY ใหม่ |
| 3 | — | — | ยังไม่เริ่ม | — |
| 4 | — | — | ยังไม่เริ่ม | — |
| 5 | — | — | ยังไม่เริ่ม | — |
| 6 | — | — | ยังไม่เริ่ม | — |
| 7 | — | — | ยังไม่เริ่ม | — |
| 8 | — | — | ยังไม่เริ่ม | — |
