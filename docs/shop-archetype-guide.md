# คู่มือประเภทร้าน (Business Archetype) — BMS

> อัปเดตตาม `shopArchetypes.ts` + migration `7.42–7.44`, `9.40`, `9.43`

---

## ประเภทร้านคืออะไร

**Business Archetype** คือประเภทร้านที่เลือกตอนสมัคร (หรือแก้ทีหลังในหน้า Settings)
ระบบใช้ค่านี้เพื่อ:

- เตรียม **onboarding checklist** ที่เหมาะกับร้าน
- กำหนด **ค่าเริ่มต้นของ AI** (commerce policy) สำหรับตอบลูกค้า
- เลือก **capability preset** ที่ร้านต้องใช้ (เช่น lot, recipe, modifier, serial)
- แนะนำฟีเจอร์ที่เหมาะสม เช่น restock subscriptions

> **หมายเหตุสำคัญ:** ประเภทร้านเป็น "จุดเริ่มต้น" — ไม่ได้เขียนทับสินค้า stock หรือ order เดิม
> แต่เมื่อร้านมีออร์เดอร์จริงรายการแรก ระบบจะล็อก archetype เพื่อไม่ให้ AI, checklist และ
> capability preset เปลี่ยนความหมายตามหลังประวัติการขาย ข้อมูล demo ที่มี marker `FAKE-*`
> ไม่นับเป็นออร์เดอร์จริงและไม่ทำให้ล็อก

---

## วิธีตั้งค่า

### 1. ตอนสมัคร (`/shop-signup`)
- ฟิลด์ **"ประเภทร้าน"** อยู่หลังชื่อร้าน ก่อนกรอก email/password
- **เลือกหรือข้ามก็ได้** (optional) — กด "เริ่มจากร้านเปล่า" ถ้ายังไม่แน่ใจ
- ค่าที่เลือกจะถูกบันทึกไว้ใน pending signup และนำไปสร้าง store profile อัตโนมัติหลัง verify email

### 2. แก้ทีหลัง (Settings → Store Profile)
- ไปที่ **Admin → Settings → ข้อมูลร้าน (Store Profile)**
- เปลี่ยนประเภทร้านได้ตราบใดที่ร้านยังไม่มีออร์เดอร์จริง แม้จะเพิ่มสินค้าและ stock แล้วก็ตาม
- หลังมีออร์เดอร์จริง ช่องนี้จะถูกปิด และ backend/ฐานข้อมูลจะปฏิเสธการเปลี่ยนด้วย
- การเปลี่ยนก่อนล็อกจะปรับ AI policy, checklist และ capability preset แต่ไม่แตะ catalog หรือ stock
- ถ้าเลือกผิดหลังล็อก ต้องแก้ผ่านกระบวนการ migration ที่ตรวจผลกระทบโดยผู้ดูแลระบบ ไม่ควรแก้ SQL ข้าม guard

---

## ประเภทร้านทั้งหมด (13 ประเภท)

---

### 1. `mini_mart` — Mini Mart / Grocery

**เหมาะกับ:** ร้านสะดวกซื้อ, ร้านขายของชำ, ร้านของใช้ทั่วไป

#### Onboarding Checklist
1. เพิ่มหมวดสินค้าหมุนเร็ว เช่น เครื่องดื่ม ของใช้ และของแห้ง
2. ทดสอบคำถามซื้อซ้ำและการใช้คูปองจากแชตลูกค้า
3. ตั้งค่าบัญชีรับเงินและค่าส่งให้ครบก่อนเปิด AI ขายจริง
4. เปิดใช้ **restock subscriptions** เพื่อเก็บลูกค้าที่ถามของแล้วของหมด

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `quick_replenishment` — ปิดเร็ว ไม่ถามเยิ่นเย้อ |
| Discovery | ค้นด้วยชื่อเรียกทั่วไป/ขนาด |
| Basket | เสนอของใช้คู่กันเพียง 1 รายการ |
| Repeat purchase | ให้ความสำคัญกับ reorder / restock opt-in |
| Fulfillment | สรุปจำนวนและความพร้อมส่งให้เร็ว |

✅ **ควรเปิด restock subscriptions** สำหรับร้านนี้

---

### 2. `fashion` — Fashion & Apparel

**เหมาะกับ:** ร้านเสื้อผ้า, รองเท้า, กระเป๋า, accessories แฟชั่น

#### Onboarding Checklist
1. กำหนด variant ให้ครบ เช่น size / color แล้วเช็กสต๊อกแต่ละตัวเลือก
2. อัปโหลดรูปหน้าปกและรูปเสริมเพื่อช่วย AI แนะนำสินค้าได้แม่นขึ้น
3. ทดสอบ flow ของหมด → เสนอไซซ์หรือรุ่นใกล้เคียง
4. เปิดใช้ **restock subscriptions** สำหรับไซซ์ยอดนิยมที่หมดบ่อย

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `variant_fit` — ยืนยันรุ่น สี ไซซ์จากตัวเลือกจริง |
| Discovery | ยืนยัน variant จาก catalog เสมอ |
| Basket | เสนอสินค้าเข้าชุดหรือ variant ทดแทน |
| Repeat purchase | เน้น restock ของไซซ์/สีที่ลูกค้ายืนยัน |
| Fulfillment | ย้ำ variant ในสรุปออเดอร์ |

✅ **ควรเปิด restock subscriptions**

---

### 3. `home_kitchen` — Home & Kitchen

**เหมาะกับ:** ร้านของใช้ในบ้าน, เครื่องครัว, เฟอร์นิเจอร์ขนาดเล็ก

#### Onboarding Checklist
1. จัดหมวดสินค้าและคำอธิบายให้ลูกค้าเทียบขนาด/วัสดุได้ง่าย
2. ทดสอบคำถามแนวเปรียบเทียบสินค้าและการขายแบบเซ็ต
3. ตั้งค่านโยบายจัดส่ง/กันแตกให้ชัด เพื่อให้ AI ตอบเหมือนร้านจริง
4. ใช้ restock subscriptions กับสินค้าที่ลูกค้ารอของเข้าได้

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `use_case_comparison` — ถาม use case แล้วเทียบ |
| Discovery | ถาม 1 ข้อ แล้วเทียบวัสดุ/ขนาดจากข้อมูลจริง |
| Basket | เสนอเป็นชุดเมื่อ catalog รองรับ |
| Repeat purchase | ใช้ restock กับรุ่นที่ลูกค้ารอได้ |
| Fulfillment | อ้างนโยบายจัดส่งสำหรับของแตกง่าย/ชิ้นใหญ่เท่านั้น |

✅ **ควรเปิด restock subscriptions**

---

### 4. `beauty_personal_care` — Beauty & Personal Care

**เหมาะกับ:** ร้านเครื่องสำอาง, สกินแคร์, ผลิตภัณฑ์ดูแลตัวเอง

#### Onboarding Checklist
1. จัดหมวดตาม routine หรือปัญหาผิวเพื่อช่วยการแนะนำสินค้า
2. ทดสอบคำถามแนว consultative เช่น ขอคำแนะนำตามปัญหา
3. ตั้งค่าโปรโมชั่น/คูปองสำหรับลูกค้าซื้อซ้ำ
4. ใช้ restock subscriptions กับสินค้าที่ลูกค้าตามหาเป็นประจำ

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `consultative_routine` — เริ่มจากเป้าหมายการใช้งาน |
| Discovery | ไม่วินิจฉัยทางการแพทย์ |
| Basket | เสนอ routine สั้นจากสินค้าจริง ไม่อ้างผลเกินข้อมูล |
| Repeat purchase | เน้น reorder / restock สำหรับสินค้าใช้ต่อเนื่อง |
| Fulfillment | สรุปลำดับรายการและจำนวนให้ชัด |

✅ **ควรเปิด restock subscriptions**

---

### 5. `food_beverage` — Food & Beverage

**เหมาะกับ:** ร้านอาหาร (ไม่มี kitchen queue), ร้านเครื่องดื่ม, ร้านขนม, delivery food

#### Onboarding Checklist
1. จัดเมนู/สินค้าให้ AI อ่านชื่อและตัวเลือกได้ง่ายจากแคตตาล็อก
2. ทดสอบการสั่งหลายรายการในข้อความเดียวและการแก้จำนวนกลางทาง
3. ตั้งค่าช่องทางชำระเงินและเวลาจัดส่งให้ชัดเพื่อปิดออเดอร์เร็ว
4. ใช้ archetype นี้เพื่อ demo บริบทการสั่งแชต ไม่ได้เพิ่ม POS เฉพาะทาง

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `menu_fast_checkout` — รับหลายรายการ ปิดเร็ว |
| Discovery | รับหลายรายการในข้อความเดียว ยืนยัน option ที่มีจริง |
| Basket | เสนอ add-on เดียวเมื่อ catalog มีสินค้าเกี่ยวข้อง |
| Repeat purchase | ใช้ reorder สำหรับเมนูเดิม |
| Fulfillment | ให้ความสำคัญกับเวลาร้านและระยะจัดส่งที่ตั้งค่าไว้ |

> **หมายเหตุ:** ถ้าต้องการ **kitchen queue + recipe** ให้ใช้ `restaurant` แทน

---

### 6. `gadgets_accessories` — Gadgets & Accessories

**เหมาะกับ:** ร้านมือถือ, อุปกรณ์ IT, เคส, อุปกรณ์ต่อพ่วง

#### Onboarding Checklist
1. ใส่ชื่อรุ่นที่รองรับและ keywords ให้ครบเพื่อช่วยตอบเรื่อง compatibility
2. ทดสอบ flow ของหมด → เสนอรุ่นทดแทนหรือ bundle ที่ใกล้เคียง
3. เพิ่มชุด upsell เช่น เคส + ฟิล์ม + หัวชาร์จ
4. เปิดใช้ **restock subscriptions** กับรุ่นยอดนิยมที่ของหมดเร็ว

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `compatibility_bundle` — ตรวจ compatibility ก่อน |
| Discovery | ตรวจรุ่น/compatibility จากข้อมูลสินค้า ห้ามตอบจากความจำ |
| Basket | เสนอ accessory bundle ที่เข้ากันจาก catalog |
| Repeat purchase | เน้น alternative และ restock รุ่นยอดนิยม |
| Fulfillment | ย้ำรุ่นและ variant ก่อนสร้างออเดอร์ |

✅ **ควรเปิด restock subscriptions**

---

### 7. `b2b_wholesale` — B2B / Wholesale

**เหมาะกับ:** ร้านขายส่ง, supplier, ร้านที่ขายให้ลูกค้าองค์กร

#### Onboarding Checklist
1. ทดสอบออเดอร์จำนวนมากและการซื้อซ้ำจากลูกค้าเดิม
2. เช็กใบเสนอราคา/ใบแจ้งหนี้จากข้อมูลร้านให้ครบก่อน demo จริง
3. เพิ่มพนักงานและสิทธิ์เพื่อจำลอง flow ระหว่างฝ่ายขายกับคลัง
4. ใช้ dashboard/reports ดูสินค้าที่ควรวางแผนเติมเพิ่ม

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `bulk_quote_reorder` — เน้นปริมาณและการซื้อซ้ำ |
| Discovery | ถามจำนวนและสเปกหลักเพื่อรองรับ bulk order |
| Basket | เสนอใบเสนอราคาหรือซื้อซ้ำเมื่อบริบทเหมาะสม |
| Repeat purchase | ให้ความสำคัญกับ reorder อย่าสัญญาราคาส่งที่ backend ไม่ยืนยัน |
| Fulfillment | สรุปจำนวนรวมและขั้นตอนส่งต่อฝ่ายขาย |

---

### 8. `gifts_seasonal` — Gifts & Seasonal

**เหมาะกับ:** ร้านของขวัญ, ร้านสินค้าตามเทศกาล, สินค้าวาเลนไทน์/ปีใหม่

#### Onboarding Checklist
1. เตรียมสินค้าเป็นเซ็ต/occasion เพื่อให้ AI แนะนำตามงบหรือเทศกาล
2. ทดสอบคูปองและแคมเปญที่ใช้ช่วงพีค
3. เพิ่มภาพสินค้าและคำอธิบายที่เน้นการเลือกของขวัญ
4. ดูยอดสินค้าขายดีรายช่วงเพื่อวางแผน stock ก่อนเทศกาล

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `occasion_budget` — ค้นตามโอกาส ผู้รับ งบ |
| Discovery | ถามทีละ 1 ประเด็น |
| Basket | เสนอชุดหรือทางเลือก 3-5 รายการภายในงบจาก catalog |
| Repeat purchase | ใช้แคมเปญ/คูปองที่ตรวจสอบแล้ว |
| Fulfillment | ถามกำหนดใช้เฉพาะเมื่อจำเป็น |

---

### 9. `pharmacy` — Pharmacy

**เหมาะกับ:** ร้านขายยา, ร้านเภสัช, คลินิก (ส่วนขายยา)

#### Onboarding Checklist
1. ตั้งนโยบายการขายให้ยาทุกตัวก่อนเปิดกะ — ยาที่ยังไม่ถูกรีวิวจ่ายออกไม่ได้
2. บันทึกว่าพนักงานคนไหนเป็นเภสัชกรผู้มีใบอนุญาต การอนุมัติหน้าเคาน์เตอร์ดูใบอนุญาต ไม่ใช่ดูสิทธิ์
3. ลองเดินเคสผ่านคิวเภสัชกรให้ครบหนึ่งรอบ รวมถึงการแนบรูปใบสั่งยา
4. บันทึก lot และวันหมดอายุของยาทุกตัว — เครื่องขายจะปฏิเสธแผงที่หมดอายุ

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `named_product_or_pharmacist` |
| Discovery | รับหลายรายการในข้อความเดียวได้ **แต่ห้ามเดา SKU/ความแรง/ขนาดบรรจุ** — ถ้าไม่ตรงให้บอกตรงๆ |
| Basket | ยืนยันทุกรายการที่ขอ ห้ามตัดออกเงียบ ห้ามเติมจำนวนเอง |
| Repeat purchase | ใช้ reorder เฉพาะสินค้าที่ไม่ต้องให้เภสัชกรประเมิน |
| Fulfillment | รายการที่เภสัชกรต้องตรวจ → แจ้งให้รอ ห้ามยืนยันหรือแนะนำการใช้ยาเอง |

> ⚠️ **ร้านนี้มี policy เข้มงวดที่สุด** — AI จะไม่แนะนำยาทดแทน และจะไม่ยืนยันการขายยาที่ต้องผ่านเภสัชกร

---

### 10. `pet_supply` — Pet Supply

**เหมาะกับ:** ร้านอาหารสัตว์, อุปกรณ์สัตว์เลี้ยง, ยาสัตว์

#### Onboarding Checklist
1. ตั้งขนาดบรรจุของอาหารและทรายทุกตัว (ถุง/กระสอบ/แบ่งขาย) เพื่อไม่ให้ AI เดาขนาดเอง
2. บันทึก lot และวันหมดอายุของอาหารและยา — เครื่องขายจะปฏิเสธถุงที่หมดอายุ
3. เปิด reorder ให้ของที่ลูกค้าซื้อประจำ แล้วดูรายการเติมสต็อกทุกสัปดาห์
4. ถ้าขายแบบชั่งน้ำหนัก → ตั้งค่าที่หน้ารูปแบบสต็อกก่อนเครื่องชั่งพิมพ์ป้ายใบแรก

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `pet_need_replenishment` |
| Discovery | ยืนยันชนิดสัตว์ ช่วงวัย ขนาดบรรจุ และสินค้าจริงจาก catalog |
| Basket | เสนออุปกรณ์/ขนาดบรรจุที่เกี่ยวข้องจาก catalog เพียงรายการเดียว |
| Repeat purchase | ให้ความสำคัญกับ reorder อาหารและ restock สินค้าที่ใช้ประจำ |
| Fulfillment | ย้ำหน่วยขายและจำนวน โดยเฉพาะสินค้าถุงกับสินค้าแบ่งขาย |

✅ **ควรเปิด restock subscriptions**

---

### 11. `building_materials` — Building Materials

**เหมาะกับ:** ร้านวัสดุก่อสร้าง, ร้านฮาร์ดแวร์, ร้านสีและกาว

#### Onboarding Checklist
1. ตั้งหน่วยขายและการแปลงหน่วยให้ครบ (ชิ้น/มัด/พาเลท) — เสนอราคาผิดหน่วยคือราคาผิด
2. ใส่สเปกสินค้าให้ครบ คำถามเรื่องปริมาณจะได้ตอบจาก catalog ไม่ใช่จากความจำ
3. เปิดการบันทึกเลขเครื่องสำหรับเครื่องมือและอุปกรณ์ที่มีเลขกำกับ
4. เขียนเงื่อนไขจัดส่งของชิ้นใหญ่ไว้ใน shipping policy — จะได้ไม่มีใครรับปากเอง

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `spec_quantity_quote` — ยืนยันสเปกและหน่วยก่อนสรุปราคา |
| Discovery | ยืนยันสเปก หน่วยขาย และจำนวนที่ต้องใช้ |
| Basket | เสนอสินค้าที่ใช้ร่วมกันจาก compatibility ที่ตรวจสอบแล้ว |
| Repeat purchase | เน้นใบเสนอราคาและ reorder ตามหน่วยเดิม |
| Fulfillment | สรุปทั้งหน่วยขายและปริมาณหน่วยฐาน รวมเงื่อนไขจัดส่งของชิ้นใหญ่ |

✅ **ควรเปิด restock subscriptions**

---

### 12. `restaurant` — Restaurant

**เหมาะกับ:** ร้านอาหาร, ร้านกาแฟ, โรงแรม (ส่วนอาหาร), ที่มีครัวและ modifier

#### Onboarding Checklist
1. ใส่ **recipe** ให้ทุกเมนู — ขายหนึ่งจานจะได้ตัดวัตถุดิบตามจริง
2. เพิ่มตัวเลือกที่ลูกค้าสั่งจริงเป็น **modifier** — เครื่องขายเสนอได้เฉพาะที่ตั้งไว้
3. ตั้ง **station** ในครัวให้แต่ละเมนู แล้วลองใช้ kitchen board ให้ครบหนึ่งรอบบริการ
4. ตัดวัตถุดิบที่เสียออกทุกวัน — ตัวเลขสต็อกจะได้ยังมีค่าให้อ่าน

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `menu_kitchen_checkout` |
| Discovery | รับหลายเมนูและยืนยันเฉพาะ modifier ที่ร้านตั้งไว้ |
| Basket | เสนอ add-on เดียวจากเมนูจริง |
| Repeat purchase | ใช้ reorder สำหรับเมนูเดิม |
| Fulfillment | ยืนยันรายการ ตัวเลือก และเวลารับหรือจัดส่งก่อนส่งเข้าครัว |

> **Capabilities ที่เปิดให้:** recipe, modifier, kitchen queue, wastage ledger

---

### 13. `other` — Other

**เหมาะกับ:** ธุรกิจที่ไม่เข้ากับประเภทไหนข้างต้น หรือมีหลายโมเดลผสมกัน

#### Onboarding Checklist (Default)
1. กรอกข้อมูลร้าน บัญชีรับเงิน และค่าส่งให้ครบก่อนเปิด AI ขายจริง
2. เพิ่มสินค้าและสต็อกอย่างน้อยบางส่วนเพื่อให้ AI เช็กของได้จากข้อมูลจริง
3. ทดสอบ create order, payment, shipping และ reorder อย่างน้อยหนึ่งรอบ

#### AI Commerce Policy
| ด้าน | แนวทาง |
|------|--------|
| Sales motion | `catalog_guided` |
| Discovery | ค้น catalog ก่อนและถามข้อมูลที่ขาดทีละ 1 ข้อ |
| Basket | เสนอทางเลือกหรือสินค้าที่เกี่ยวข้องจาก catalog เท่านั้น |
| Repeat purchase | ใช้ reorder/restock ตามเจตนาที่ลูกค้ายืนยัน |
| Fulfillment | ใช้เฉพาะ payment/shipping policy ที่ร้านตั้งค่าไว้ |

---

## ตารางสรุปทุกประเภท

ชื่อที่เห็นใน UI มาจาก shared i18n `shop_archetypes.*` ดังนั้นชื่อภาษาอังกฤษ/ไทยอาจเปลี่ยนได้ในอนาคต แต่ `ID` ด้านล่างต้องคงเดิมเสมอ

| ประเภทร้าน | ชื่อภาษาไทยใน UI | ID | business_type | Restock Emphasis | Sales Motion |
|---|---|---|---|---|---|
| Mini Mart / Grocery | มินิมาร์ท / ร้านขายของชำ | `mini_mart` | general | ✅ | quick_replenishment |
| Fashion & Apparel | แฟชั่นและเครื่องแต่งกาย | `fashion` | fashion | ✅ | variant_fit |
| Home & Kitchen | ของใช้ในบ้านและเครื่องครัว | `home_kitchen` | home | ✅ | use_case_comparison |
| Beauty & Personal Care | ความงามและของใช้ส่วนตัว | `beauty_personal_care` | beauty | ✅ | consultative_routine |
| Food & Beverage | อาหารและเครื่องดื่ม | `food_beverage` | food | — | menu_fast_checkout |
| Gadgets & Accessories | แก็ดเจ็ตและอุปกรณ์เสริม | `gadgets_accessories` | electronics | ✅ | compatibility_bundle |
| B2B / Wholesale | ธุรกิจ B2B / ขายส่ง | `b2b_wholesale` | general | — | bulk_quote_reorder |
| Gifts & Seasonal | ของขวัญและสินค้าตามเทศกาล | `gifts_seasonal` | general | — | occasion_budget |
| Pharmacy | ร้านขายยา | `pharmacy` | general | — | named_product_or_pharmacist |
| Pet Supply | สินค้าและอุปกรณ์สัตว์เลี้ยง | `pet_supply` | general | ✅ | pet_need_replenishment |
| Building Materials | วัสดุก่อสร้าง | `building_materials` | home | ✅ | spec_quantity_quote |
| Restaurant | ร้านอาหาร | `restaurant` | food | — | menu_kitchen_checkout |
| Other | อื่น ๆ | `other` | general | — | catalog_guided |

---

## สิ่งที่ประเภทร้าน "ไม่ทำ"

- ❌ ไม่เปลี่ยนสิทธิ์การใช้งาน (permissions) ของ user
- ❌ ไม่ซ่อนหรือล็อกฟีเจอร์ใดๆ
- ❌ ไม่สร้างสินค้าอัตโนมัติสำหรับร้านจริงโดยไม่ขออนุญาต
- ❌ ไม่กระทบ order, stock, lot, recipe หรือ history ที่มีอยู่เดิม
- ❌ ไม่รองรับหลายโมเดลธุรกิจพร้อมกันในร้านเดียว (ใช้ `other` ถ้ามีหลายโมเดล)

---

## อ้างอิงไฟล์ในโปรเจกต์

| ไฟล์ | เนื้อหา |
|------|--------|
| `apps/web/lib/bms/shopArchetypes.ts` | ค่า archetype ทั้งหมด + commerce policy + checklist keys |
| `docs/ui/shop-signup-archetype-spec.md` | spec ครบถ้วนของ feature นี้ |
| `apps/web/lib/bms/storeCapabilities.ts` | capability preset ตามแต่ละ archetype |
| `apps/web/i18n/{th,en}.ts` | ข้อความ checklist และ labels ภาษาไทย/อังกฤษ |
| `db/migrations/7.42–7.44, 9.40` | migration ที่เกี่ยวข้อง |
| `apps/web/app/(auth)/shop-signup/page.tsx` | UI หน้าสมัครร้าน |
| `apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx` | UI แก้ store profile |
