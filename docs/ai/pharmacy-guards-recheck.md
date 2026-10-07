# ผลตรวจด่านคำถามร้านยา

งานวันที่ 2026-10-07 บน `codex/pharmacy-deterministic-guards` จาก `develop` ที่ `91b3cc74` แก้เฉพาะ deterministic matching ตามสเปก ไม่เปลี่ยนข้อความตอบ ไม่อนุมัติแม่แบบ ไม่เปิด flag/protocol และไม่เพิ่ม migration/permission การอนุมัติข้อความยังแยกแต่ละร้าน

## ขอบเขตและข้อจำกัด

นี่คือ conservative matching ไม่ใช่ระบบวินิจฉัยหรือหลักฐานว่าครอบทุกถ้อยคำ ผู้ใช้ยืนยันให้สัตว์กัด/ข่วนเข้าข้อความ MEDICAL เดิม (1669 / โรงพยาบาล) ไม่ใช่ข้อความสัตวแพทย์ ไม่ได้ทดสอบกับ DB, provider หรือแชทจริง และยังต้องให้เภสัชกรผู้มีใบอนุญาตตรวจการจัดเส้นทางทางคลินิก

## ผลทดสอบ

- A ก่อนแก้: emergency focused 63 ผ่าน / 92 ข้อ / fail 29; หลังแก้และเพิ่ม snapshot ข้อความ: 93/93
- A gate: typecheck ผ่าน, pure 2,095 ผ่าน / 2,097 ข้อ / skip 2 / fail 0, production build ผ่าน 132 pages
- B ก่อนแก้: customer assistance 138 ผ่าน / 195 ข้อ / fail 57; หลังแก้ 195/195
- B ตรวจขนาดบรรจุเพิ่มเติม: 194 ผ่าน / 195 ข้อ / fail 1 ก่อนกัน `แผงละ/กล่องละ/ขวดละ/บรรจุ`; gate รอบสุดท้าย 2,156 ผ่าน / 2,158 ข้อ / skip 2 / fail 0 และ build ผ่าน
- C ก่อนแก้: guidance 29 ผ่าน / 47 ข้อ / fail 18; หลังแก้ 47/47; gate 2,180 ผ่าน / 2,182 ข้อ / skip 2 / fail 0 และ build ผ่าน
- D ก่อนแก้: emergency 101 ผ่าน / 110 ข้อ / fail 9; customer assistance 193 ผ่าน / 211 ข้อ / fail 18 หลังแก้ emergency 110/110 และ pharmacy ทั้งชุด 365/365 (ก่อนเพิ่มเทส import boundary หนึ่งข้อ)
- D gate สุดท้าย: typecheck ผ่าน, pure **2,214 ผ่าน / 2,216 ข้อ / skip 2 / fail 0**, production build **132/132 pages ผ่าน** ไม่มี baseline failure ที่ต้องยกเว้น มี ECONNREFUSED จากหน้าที่อ่าน local Postgres ระหว่าง build; นี่ไม่ใช่ผล DB test
- หลัง mutation และคืนไฟล์: emergency **110/110**, customer assistance **211/211**, guidance **48/48**, pharmacy ทั้งชุด **366/366**; focused ทุกชุด fail 0 / skip 0 (customer/guidance เป็นส่วนหนึ่งของ pharmacy ไม่ใช่ยอดบวกแยก)
- Mutation **23/23 ถูกจับ**: A 6 (self-harm, จำนวนยา, สารพิษ, medical, ทารก, หน่วยเวลา), B 7 (ขนาดยา, สลับยา, บด/หักเม็ด, ยังปวด, symptom disclosure, อาการสั้น, ขนาดบรรจุ), C 7 (animal, allergy, pregnancy, interaction, not-improving, ชื่อสินค้า, normalizer), D 3 (bite, handoff, human aliases) ทุก mutation ยืนยันชื่อ golden ที่แดง ไม่ใช่แค่ process exit

สำรองด้วย stash `58e85cb573f9cd496d2d5386efb873757e145ecd` แล้ว apply กลับก่อน mutate เก็บ stash นี้ไว้เป็นจุดกู้คืน (ไม่ได้ commit/push branch) ตัวขับ `scripts/testing/pharmacy-guards-mutations.mjs` ตรวจว่า stash มีโค้ดชุดปัจจุบัน ก่อนถอด pattern ทีละหมวดและคืน Buffer ใน `finally` ไม่ใช้ checkout/reset ผลละเอียดอยู่ `.test-output/guards-mutations/summary.json` และ log แยกแต่ละหมวด

SHA-256 หลังคืนตรงกับก่อน stash และก่อน mutate ทุกไฟล์:

| ไฟล์ | SHA-256 |
| --- | --- |
| emergency.ts | `7e48bc5c5a5760c6822c5c9c83222f3393841ebe0c4483468b1f88b83923b172` |
| customerAssistancePolicy.ts | `17b16a210a5660a9d4df101b74b61a17f455155f69ff2e8cb79c2038558d7353` |
| guidanceTemplates.ts | `bfeec19a257303926a2b5f75d9f0763f63b63e33be17f294e02ca212a984370b` |
| conversationRouter.ts | `e3ac72b1cbe0a473947b96530fc150f81013148cb1b06a0707bf2d375c86b6d3` |

ข้อความตอบฉุกเฉิน 3 ชนิด × 2 ภาษา, handoff 2 ชุด × 2 ภาษา, footer และร่างตั้งต้นทั้งหมดคง SHA-256 `a9a22c4a17dfa526189644a9ac5678360e30774bdc4410bebe7f90f5226a4f04` จากก่อนแก้ และเทียบ string literals ของ `composeEmergencyReply`, `pharmacyEmergencyReply`, `pharmacyClinicalHandoffReply` กับ base commit แล้วตรงกัน ไฟล์เดิมที่แก้เป็น CRLF ทั้งไฟล์ ไม่มี mixed EOL และ `git diff --check` ผ่าน ไม่ได้เพิ่มไฟล์ `*.test.mts`

ตัวเลข fail รวม parent test ที่ล้มตาม subtest ด้วย ตารางด้านล่างแสดงผลระดับประโยคจากโค้ดก่อนแก้จริง (`scripts/testing/pharmacy-guards-baseline.json`) ไม่ใช่การเดาจาก regex

## กฎที่เปลี่ยน

- A: เพิ่มถ้อยคำทำร้ายตัวเอง, การกินยาปริมาณมาก, การกินสารพิษ, อาการฉุกเฉินและไข้ในทารกต่ำกว่า 3 เดือนตามชุดที่กำหนด คงลำดับ SELF_HARM → POISONING → MEDICAL การซื้อหรือถามราคาสารเคมีไม่ถือเป็นการกิน
- B: ต้องมีบริบทยาและคำถามขนาด/ช่วงเวลา, การกินสลับ, บด/หักเม็ด/แกะแคปซูล หรืออาการหลังใช้ยา ไม่จับชื่อยาโดด ๆ อาการเดี่ยวต้องเป็นประโยคเดี่ยวหรือมีคำขอคำแนะนำ/ระยะเวลา จึงไม่จับชื่อสินค้ายาแก้ปวดฟัน/ยาหยอดตาแดงในชุดห้ามจับ
- C: คงลำดับ 11 รหัส ใช้ normalizer จาก leaf `emergency.ts` ซึ่งไม่มี imports/IO จึงไม่ต้องสร้าง normalizer ซ้ำหรือส่งภาระให้ทุก caller แยกท้องว่างจากตั้งครรภ์, environmental/food allergy จากแพ้ยา, ชื่อยาไอบู/ยาไข้หวัดจากอาการ และ `ไม่หายใจ` จากอาการไม่หาย Animal predicate เป็นตัวเดียวที่ D ใช้ด้วย
- D: human aliases ใช้ประโยคขอคุยที่ชัดเจน ไม่กินคำถาม `เภสัชกรอยู่ไหม`; สัตว์กัด/ข่วนเข้า MEDICAL หลัง self-harm/poisoning ตามลำดับเดิมและเลือก handoff ทั่วไปหากเรียก helper โดยตรง ไม่ใช้ข้อความสัตวแพทย์
- ตรวจขอบเขตเพิ่ม: English `took 20 mg` และ `took 20 minutes` ไม่ใช่การรายงานจำนวนเม็ดยา, เด็ก 12 เดือนไม่ตรง pattern ทารกต่ำกว่า 3 เดือน, ซื้อสารพิษไม่ใช่กินสารพิษ และกรณีซ้อนกันยังให้ self-harm/poisoning ชนะ medical

## ข้อค้างที่ตรวจแบบอ่านอย่างเดียว

### การสั่งซ้ำและ Product Policy

`pipeline.ts` เรียก `reorder` เมื่อ `isReorderRequest()` และร้านไม่ใช่ restaurant โดยไม่ให้ยืนยันรายการรอบใหม่ `tools/catalog.ts` หาออร์เดอร์ล่าสุดจากตัวตนฝั่ง server และตรวจ ownership ก่อน `reorderFromOrder()` ใน `orders.ts` เรียก `createOrder()` ใหม่ ซึ่งผ่าน `checkPharmacySaleInTx()` ก่อนจองสต็อก

สำหรับช่องทางแชท จะส่ง `channel = online` และไม่ส่ง approval/counter authorization จากบิลเก่า `evaluatePharmacySale()` ปฏิเสธ `PRESCRIPTION_REQUIRED` และ `ONLINE_SALE_PROHIBITED` ในช่องทางนี้; policy ที่หายไปหรือยังไม่ APPROVED ก็ปฏิเสธ ไม่พบการข้าม policy ด้วย reorder จากการอ่านโค้ด แต่ยังไม่มีการยืนยันด้วยฐานข้อมูลจริง ส่วนสินค้าที่อนุญาต DIRECT_SALE ยังสั่งซ้ำได้โดยไม่แสดงรายการให้ยืนยันใหม่ เป็นข้อค้าง ไม่ได้แก้ในงานนี้

ถ้อยคำ `ขอยาเหมือนเดิม` โดยตรง **ไม่ตรง** `isReorderRequest()` ปัจจุบัน (มี `เอาเหมือนเดิม`/`สั่งเหมือนเดิม` แต่ไม่มีวลีนี้) และไม่ตรงด่าน medication/symptom; ร้านยายังได้รับเครื่องมือ `reorder` ใน customer catalog จึงอาจถูกโมเดลเลือกได้ ไม่ได้ทดลองกับ provider จริง จึงไม่อ้างว่าเกิด reorder แน่นอนกับวลีนี้

### ชื่อยาที่มีความเสี่ยง

`ขอทรามาดอล`, `ขอยาไซโตเทค`, `ขอซื้อ amoxicillin` ไม่ใช่หลักฐานการจัดประเภท SKU หรืออนุญาตขาย ต้องให้ catalog resolution และ Product Policy ของร้านตัดสิน ไม่ได้เพิ่มชื่อยาเหล่านี้เข้า regex หรือเปลี่ยน policy ในงานนี้ และไม่ได้อ้างสถานะทางกฎหมายของชื่อยาจาก keyword

การเรียก pure guards ของทั้งสามวลีให้ medication=false, symptom=false, guidance=null เหมือนกัน จึงไม่มี deterministic clinical handoff ด้วยชื่อเหล่านี้โดยลำพัง ข้อค้างคือการตรวจนโยบาย SKU จริงกับเภสัชกรและฐานข้อมูลร้าน ไม่ใช่สรุปว่า regex ต้องจัดทุกชื่อเป็นยาประเภทเดียวกัน

### รูปใบสั่งยาทางแชท

LINE webhook แบบ tenant บันทึก non-text ผ่าน `fetchLineInboundAttachment()` → private tenant-owned storage → `logInboundMessage()` พร้อม `unsupportedForAi: true` แล้วข้าม `runPipeline()` ส่วน mock webhook บันทึก metadata เท่านั้น รูปไม่ได้ถูก OCR หรือผูกเป็น clinical evidence อัตโนมัติ

Facebook webhook ส่งเฉพาะข้อความเข้า `runPipeline()` หากมีข้อความพร้อมรูปก็แนบรูปใน Inbox; ถ้ามีแต่รูปจะ `logInboundMessage()` พร้อม `unsupportedForAi: true` ไม่ได้ส่งภาพเข้าโมเดล เส้นทาง evidence จริงแยกอยู่ที่ `/api/bms/pharmacy/evidence/upload`: ต้องมี session, `pharmacy.evidence.manage`, tenant จาก session, assessment ที่ตรงร้าน และบันทึกเป็น `PRESCRIPTION_IMAGE` ผ่าน `addClinicalEvidence()` พนักงานต้องดำเนินการในเส้นทางที่มีสิทธิ์ รูปใน Inbox ไม่เท่ากับใบสั่งที่เภสัชกรตรวจแล้ว

## ตารางก่อนและหลัง

### D เส้นทางย่อย

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| โดนสุนัขกัด | CLINICAL_OR_UNKNOWN; handoff เลือกสัตวแพทย์ | EMERGENCY MEDICAL; handoff ไม่เลือกสัตวแพทย์ |
| แมวข่วน | CLINICAL_OR_UNKNOWN; handoff เลือกสัตวแพทย์ | EMERGENCY MEDICAL; handoff ไม่เลือกสัตวแพทย์ |
| ขอคุยกับเภสัช | CLINICAL_OR_UNKNOWN | HUMAN_HANDOFF |
| ขอสายเภสัช | CLINICAL_OR_UNKNOWN | HUMAN_HANDOFF |
| ขอคุยกับคน | CLINICAL_OR_UNKNOWN | HUMAN_HANDOFF |
| talk to a human | CLINICAL_OR_UNKNOWN | HUMAN_HANDOFF |

ตารางแสดงผลเฉพาะด่านที่ทดสอบในแต่ละกลุ่ม: `null` คือด่านนั้นไม่จับ ไม่ได้แปลว่าอนุญาตขายสินค้า `MED`/`SYM` คือด่านคำถามการใช้ยา/อาการ ส่วนชุดห้ามจับแสดง emergency, MED, SYM และ read intent; Product Policy ยังตัดสินการขายตามเดิม

### A เหตุฉุกเฉิน

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| i want to die | null | SELF_HARM |
| I wanna die | null | SELF_HARM |
| อยากหลับไปไม่ตื่น | null | SELF_HARM |
| อยากหายไปจากโลกนี้ | null | SELF_HARM |
| เหนื่อยกับชีวิต อยากหายไป | null | SELF_HARM |
| ไม่อยากตื่นขึ้นมาอีก | null | SELF_HARM |
| แม่กินยานอนหลับไปทั้งแผง | null | POISONING |
| กินยาไปหมดขวด | null | POISONING |
| took 20 paracetamol | null | POISONING |
| swallowed a whole bottle of pills | null | POISONING |
| กินยาฆ่าหญ้า | null | POISONING |
| กินยาเบื่อหนู | null | POISONING |
| ดื่มน้ำยาล้างห้องน้ำ | POISONING | POISONING |
| ผื่นขึ้นตาบวมหายใจลำบาก | null | MEDICAL |
| หายใจลำบาก | null | MEDICAL |
| ตาบวม ปากบวม | MEDICAL | MEDICAL |
| ปากเขียว | null | MEDICAL |
| ตัวเขียว | null | MEDICAL |
| ซึม ปลุกไม่ตื่น | null | MEDICAL |
| เลือดออกไม่หยุด | null | MEDICAL |
| heart attack | null | MEDICAL |
| having a stroke | null | MEDICAL |
| can't stop bleeding | null | MEDICAL |
| ไม่หายใจ | null | MEDICAL |
| งูกัด | null | MEDICAL |
| ปวดหัวรุนแรงที่สุดในชีวิต | null | MEDICAL |
| ปวดท้องรุนแรงมาก ท้องแข็ง | null | MEDICAL |
| ลูก 2 เดือน ไข้สูง | null | MEDICAL |

### B คำถามการใช้ยา

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| พาราวันละกี่เม็ด | MED=false | MED=true |
| พาราได้วันละกี่ครั้ง | MED=false | MED=true |
| ยาคุมฉุกเฉินกินกี่ชั่วโมง | MED=false | MED=true |
| ibuprofen how many a day | MED=false | MED=true |
| ไอบูกับพาราสลับกันได้ไหม | MED=false | MED=true |
| กินสลับกันได้ไหม | MED=true | MED=true |
| alternate ibuprofen and paracetamol | MED=false | MED=true |
| ยาเม็ดนี้หักครึ่งได้ไหม | MED=false | MED=true |
| บดยาได้ไหม | MED=false | MED=true |
| แกะแคปซูลได้ไหม | MED=false | MED=true |
| can I crush this pill | MED=false | MED=true |
| can I split this tablet | MED=false | MED=true |
| กินยาแล้วยังปวดอยู่ | MED=false | MED=true |
| ทานยามา 3 วันยังไม่ดีขึ้น | MED=true | MED=true |

### B คำถามอาการ

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| ท้อง 3 เดือนปวดหัว | SYM=false | SYM=true |
| my son has a fever | SYM=false | SYM=true |
| my daughter has a cough | SYM=false | SYM=true |
| เป็นสิว ใช้อะไรดี | SYM=false | SYM=true |
| ขอยาแก้ปวดแรงๆ | SYM=false | SYM=true |
| ปวดฟัน | SYM=false | SYM=true |
| ตาแดง | SYM=false | SYM=true |
| ผื่นคัน | SYM=false | SYM=true |
| ปัสสาวะแสบ | SYM=false | SYM=true |
| ตกขาว | SYM=false | SYM=true |
| นอนไม่หลับ | SYM=false | SYM=true |

### C ตัวจัดชนิดแม่แบบ

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| แอสไพรินกินตอนท้องว่างได้ไหม | SPECIAL_POPULATION | null |
| ไอบูกับพาราสลับกันได้ไหม | SYMPTOM_TO_DRUG | DRUG_INTERACTION |
| แพ้อากาศ กินยาอะไรดี | ALLERGY_SUBSTITUTE | SYMPTOM_TO_DRUG |
| โดนสุนัขกัด | ANIMAL | null |
| แมวข่วน | ANIMAL | null |
| ไม่หายใจ | NOT_IMPROVING | null |
| ยาไข้หวัดใหญ่ | SYMPTOM_TO_DRUG | null |
| ไอบูโพรเฟน | SYMPTOM_TO_DRUG | null |

### ชุดห้ามจับ

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| พาราราคาเท่าไร | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| มีพาราไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| สั่งพารา 2 แผง | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ซื้อพารา 20 เม็ด | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| เจลแอลกอฮอล์มีไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ใช้คูปองได้ไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ร้านเปิดกี่โมง | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| หน้ากากอนามัยมีไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| มียาฆ่าแมลงขายไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ยาเบื่อหนูราคาเท่าไร | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ขอซื้อยานอนหลับ 1 แผง | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ยาแก้ปวดฟันมีไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ยาหยอดตาแดงราคาเท่าไร | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ไอบูโพรเฟน 400 มีไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| อาหารแมวมีไหม | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| ส่งของถึงไหน | null / MED=false / SYM=false / READ=null | null / MED=false / SYM=false / READ=null |
| เภสัชกรอยู่ไหม | null / MED=false / SYM=false / READ=service | null / MED=false / SYM=false / READ=service |
| เคส #1a2b3c4d ถึงไหน | null / MED=false / SYM=false / READ=case | null / MED=false / SYM=false / READ=case |
