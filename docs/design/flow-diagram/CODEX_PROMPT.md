# Prompt สำหรับ Codex: BMS Interactive Flow Diagram

> ไฟล์นี้อยู่ที่ `docs/design/flow-diagram/CODEX_PROMPT.md`
> ไฟล์อ้างอิงอยู่ในโฟลเดอร์เดียวกัน: `bms-flow-diagram-v8.jpg` (ภาพเป้าหมาย) และ `bms-flow-diagram-v8.html` (SVG ต้นฉบับ)
> สั่ง Codex: "อ่าน docs/design/flow-diagram/CODEX_PROMPT.md แล้วทำตามทุกข้อ เริ่มจากขั้นที่ 0"

---

## บทบาทและเป้าหมาย

คุณเป็น Senior Frontend Engineer ในโปรเจกต์ BMS (monorepo, Next.js App Router อยู่ที่ `apps/web`)
งานนี้คือสร้าง **Interactive Flow Diagram** ที่อธิบายว่า BMS ทำงานอย่างไร ตั้งแต่ลูกค้าติดต่อเข้ามาจนถึงรายงาน
ให้เจ้าของร้านที่ไม่ใช่สายเทคนิคอ่านแล้วเข้าใจภายใน 5–10 วินาที และกดดูรายละเอียดเพิ่มเองได้

ส่งงานเป็น **patch เล็ก ตรวจทานง่าย** และเป็น **frontend อย่างเดียว** ห้ามแก้ backend, ฐานข้อมูล หรือ business logic

---

## ขั้นที่ 0: อ่านก่อนเริ่ม (บังคับ)

1. อ่าน `AGENTS.md`, `CLAUDE.md` และ `CLAUDE.local.md` ที่ root แล้วทำตามกฎในไฟล์ทั้งหมด ถ้ากฎในไฟล์เหล่านี้ขัดกับ prompt นี้ ให้ถือไฟล์เป็นหลัก และบอกว่าขัดกันตรงไหน
2. อ่าน `docs/feature-inventory.md` ซึ่งเป็นแหล่งความจริงเรื่องสถานะฟีเจอร์ ห้ามใส่สถานะที่ดีกว่าในไฟล์นี้
3. สำรวจโครงสร้างต่อไปนี้แล้วสรุปสั้น ๆ ก่อนเขียนโค้ด:
   - หน้าแรกสาธารณะอยู่ที่ไหน (น่าจะเป็น `apps/web/app/(main)/page.tsx`) และแบ่ง section อย่างไร
   - ระบบ i18n (`apps/web/i18n`, `apps/web/locales`) ใช้อย่างไร เพิ่ม key อย่างไร
   - dark mode ทำงานอย่างไร (ดู `AntdThemeProvider.tsx`, `globals.css`)
   - ใช้ CSS แบบไหนอยู่ (CSS Modules / antd token / global) ให้ใช้แบบเดียวกับที่โปรเจกต์ใช้
   - test runner และ lint ของ `apps/web` (ดู `apps/web/package.json`)
4. ถ้าไม่เจอหน้าแรกตามที่คาด หรือโครงสร้างต่างไปมาก **ให้หยุดแล้วรายงาน** ห้ามเดาและสร้างโครงใหม่เอง

---

## ข้อห้าม (Constraints)

- ห้ามเพิ่ม dependency ใหม่ ใช้แค่ React, SVG, CSS และ antd ที่มีอยู่แล้ว ห้ามใช้ D3, React Flow หรือ Framer Motion
- ห้ามแก้ไฟล์ใน `apps/web/lib/bms/**`, `db/**`, `apps/web/app/api/**`, GraphQL schema, migrations และ middleware
- ห้ามเรียก API หรือ GraphQL ในเวอร์ชันนี้ เนื้อหาทั้งหมดเป็น static data ในไฟล์
- ห้ามใช้โลโก้ของ LINE, Facebook, Instagram, TikTok, GrabFood, LINE MAN, Shopee, Lazada, Flash, Kerry ใช้ชื่อเป็นข้อความกับไอคอนทั่วไป (chat, bag, globe ฯลฯ) ที่วาดเป็น SVG เอง
- ห้ามใส่ฟีเจอร์หรือผู้ให้บริการที่ไม่มีในโค้ด โดยเฉพาะ **ห้ามใส่ ShopeeFood, Robinhood, Lalamove, Grab Express, LINE MAN Messenger, ไปรษณีย์ไทย และ foodpanda** (foodpanda มีโค้ด แต่ปิดให้บริการในไทยแล้ว)
- ห้ามใส่ตัวเลขที่เปลี่ยนบ่อย (จำนวน tools, migrations, guides) และห้ามใส่ตัวเลขผลลัพธ์ทางการตลาด เช่น "ขายเพิ่ม 30%"
- ห้ามทำให้ภาพเคลื่อนไหวเองโดยผู้ใช้ไม่ได้สั่ง
- ห้ามใช้ `dangerouslySetInnerHTML`
- ต้องรองรับ SSR ห้ามอ้าง `window`/`document` ตอน render ครั้งแรก component ต้องแสดงผลได้ถูกต้องแม้ JavaScript ยังโหลดไม่เสร็จ

---

## ไฟล์ที่ต้องสร้าง (ปรับชื่อ path ให้ตรง convention ของโปรเจกต์ได้)

```
apps/web/components/marketing/flow/
├── flowData.ts              # ข้อมูล node, edge, scenario ทั้งหมด (single source of truth ของ component นี้)
├── flowTypes.ts             # TypeScript types
├── BmsFlowDiagram.tsx       # component หลัก (desktop: SVG / mobile: stepper)
├── FlowNodeDetail.tsx       # กล่องคำอธิบายเมื่อกด node
├── FlowStepper.tsx          # เวอร์ชันมือถือแนวตั้ง
├── FlowIcons.tsx            # ไอคอน SVG line-style ทั้งหมด
└── BmsFlowDiagram.module.css (หรือรูปแบบ style ที่โปรเจกต์ใช้)
```

และใช้งาน component ใน 2 ที่:

1. **หน้าแรก**: เพิ่ม section "BMS ทำงานอย่างไร" ต่อจาก section Hero / ปัญหาของร้าน (ถ้ามี) ใช้ `variant="compact"`
2. **หน้าใหม่ `/how-it-works`**: `apps/web/app/(main)/how-it-works/page.tsx` ใช้ `variant="full"` และใส่ metadata (title, description) ตาม pattern ของหน้าอื่นใน `(main)`

---

## Data model (`flowTypes.ts`)

```ts
export type FeatureStatus = "ready" | "config" | "pilot" | "planned";
// ready   = ✅ พร้อมใช้
// config  = ⚙️ ต้องตั้งค่าก่อน
// pilot   = 🧪 ทดสอบอยู่ ยังไม่เปิดขายทั่วไป
// planned = 📋 ยังไม่มี (ห้ามแสดงใน variant compact)

export type FlowGroup = "chat" | "orderIntake" | "pos" | "core" | "module" | "output" | "loop";

export type ShopScenario = "all" | "retail" | "restaurant" | "boardgame" | "pharmacy";

export interface FlowNode {
  id: string;
  group: FlowGroup;
  icon: FlowIconName;
  label: { th: string; en: string };
  short: { th: string; en: string };     // ใต้ไอคอน ไม่เกิน ~24 ตัวอักษรไทย
  detail: {
    what: { th: string; en: string };     // ทำอะไร 1–2 ประโยค ภาษาชาวบ้าน
    example?: { th: string; en: string }; // ตัวอย่างสถานการณ์จริง 1 บรรทัด
    note?: { th: string; en: string };    // ข้อจำกัด/คำเตือน (ถ้ามี)
  };
  status: FeatureStatus;
  scenarios: ShopScenario[];              // ร้านประเภทไหนเกี่ยวข้อง
  compact: boolean;                        // แสดงใน variant compact ไหม
  href?: string;                           // ลิงก์ "ดูเพิ่ม" ถ้ามีหน้าจริง (ตรวจว่ามี route จริงก่อนใส่)
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: "main" | "handoff" | "loop";      // loop = เส้นประวนกลับ
  label?: { th: string; en: string };
}

export interface FlowScenarioStep {
  nodeId: string;
  caption: { th: string; en: string };
}

export interface FlowScenario {
  id: Exclude<ShopScenario, "all">;
  label: { th: string; en: string };
  steps: FlowScenarioStep[];               // ใช้กับโหมด ▶ เล่นทีละขั้น
}
```

ถ้าโปรเจกต์ใช้ i18n แบบ key ในไฟล์ `locales` ให้เก็บข้อความใน locales แทน object `{th, en}` แล้วใน `flowData.ts` อ้างแค่ key ทำให้เข้ากับระบบเดิม

---

## เนื้อหา (ใส่ใน `flowData.ts` ตามนี้ ปรับถ้อยคำได้เล็กน้อย แต่ห้ามเปลี่ยนสถานะหรือข้อเท็จจริง)

### กลุ่ม 1A: แชทออนไลน์ (`chat`)

| id | label | short | status | detail.what | note |
|---|---|---|---|---|---|
| `ch-line` | LINE | ลูกค้าทักแชท | config | ลูกค้าทัก LINE ของร้าน ข้อความเข้า AI Inbox ทันที | ต้องผูกบัญชี LINE OA ก่อน |
| `ch-facebook` | Facebook | ลูกค้าทักแชท | config | ข้อความจาก Facebook Page รวมไว้ที่เดียวกับช่องทางอื่น | ต้องผูกเพจก่อน |
| `ch-instagram` | Instagram | ลูกค้าทักแชท | config | ข้อความจาก Instagram รวมไว้ที่เดียวกัน | ต้องผูกบัญชีก่อน |
| `ch-tiktok` | TikTok | รับข้อความเข้า | config | ข้อความจาก TikTok เข้า AI Inbox ได้ | **รับเข้าได้อย่างเดียว ยังตอบกลับจากระบบไม่ได้** |
| `ch-web` | เว็บไซต์ | แชทบนเว็บร้าน | config | ลูกค้าแชทผ่านหน้าเว็บของร้าน | — |

### กลุ่ม 1B: ออร์เดอร์รอกดรับ (`orderIntake`)

| id | label | status | detail.what | example | note |
|---|---|---|---|---|---|
| `in-qr` | QR สั่งที่โต๊ะ | ready | ลูกค้าสแกน QR ที่โต๊ะแล้วสั่งเอง ออร์เดอร์รอพนักงานกดรับก่อนเข้าครัว | สแกน QR โต๊ะ 5 → สั่งข้าวผัด → พนักงานกดรับ → เข้าจอครัว | สำหรับร้านอาหาร |
| `in-grabfood` | GrabFood | pilot | ออร์เดอร์จาก GrabFood เด้งเข้า POS ให้พนักงานกดรับ | — | ยังรอสัญญาพาร์ตเนอร์ · แสดงบน Web/Desktop POS |
| `in-lineman` | LINE MAN | pilot | ออร์เดอร์จาก LINE MAN เด้งเข้า POS ให้พนักงานกดรับ | — | ยังรอสัญญาพาร์ตเนอร์ · แสดงบน Web/Desktop POS |

Node รวม `intake-accept`: "พนักงานกดรับที่ POS" · short: "ก่อนเข้าครัวทุกครั้ง" · status ready · what: "ออร์เดอร์ที่ลูกค้าสั่งเองยังไม่เข้าครัวทันที พนักงานต้องกดรับก่อน ป้องกันออร์เดอร์หลอกหรือของหมด"

### กลุ่ม 1C: POS หน้าร้าน (`pos`)

| id | label | short | status | detail.what | note |
|---|---|---|---|---|---|
| `pos-web` | Web POS | เปิดบนเบราว์เซอร์ | ready | ขายหน้าร้านผ่านเบราว์เซอร์ ใช้ได้ทั้งคอมและแท็บเล็ต ยืนยันตัวด้วยเครื่องที่ลงทะเบียน + PIN แคชเชียร์ | — |
| `pos-desktop` | Desktop | แอปบนเครื่อง | pilot | แอปสำหรับเครื่องแคชเชียร์ ทำงานแบบเดียวกับ Web POS | ยังไม่มีโหมดออฟไลน์ |
| `pos-mobile` | Mobile | แอปมือถือ | pilot | ขายผ่านแอปมือถือ มีโหมด Emergency Offline | Offline รองรับเฉพาะบิลขายปลีกเงินสดพื้นฐาน · ยังไม่รับออร์เดอร์เดลิเวอรี |

### กลุ่ม 2: รวมศูนย์ (`core`)

| id | label | what |
|---|---|---|
| `ai-inbox` | AI Inbox | รวมแชททุกช่องทางไว้ที่เดียว AI ช่วยตอบ เช็กสินค้า และสรุปตะกร้า โดยใช้ราคาและสต็อกจริงจากระบบ ไม่เดาเอง |
| `cloud-pos` | Cloud POS | เครื่องขายทุกเครื่องใช้ข้อมูลชุดเดียวกัน รองรับค้าปลีก ร้านอาหาร บอร์ดเกม และร้านยา |
| `confirm` | ตรวจและยืนยัน | ระบบตรวจราคาและสต็อกจริงก่อน แล้วให้ลูกค้าหรือพนักงานยืนยันรายการ บิลจะถูกสร้างหลังยืนยันเท่านั้น |
| `bms-core` | BMS ข้อมูลชุดเดียว | ทุกช่องทางใช้ลูกค้า ราคา สต็อก และรายงานชุดเดียวกัน ขายจากที่ไหนตัวเลขก็ตรงกัน |

### กลุ่มโมดูล (`module`) ล้อมรอบ `bms-core`

| id | label | short | status | what |
|---|---|---|---|---|
| `m-crm` | CRM | ลูกค้า 360 | ready | เห็นประวัติซื้อ แต้ม คูปอง และแชทของลูกค้าในหน้าเดียว รวมลูกค้าซ้ำข้ามช่องทางได้เมื่อพนักงานยืนยัน (ระบบไม่เดาเองจากชื่อหรือเบอร์) |
| `m-loyalty` | สมาชิก & คูปอง | แต้ม · บัตรของขวัญ | ready | สะสมแต้ม ระดับสมาชิก คูปอง บัตรของขวัญ และโปรโมชันแยกรายสาขา |
| `m-stock` | สต็อก | หลายสาขา · FEFO | ready | สต็อกแยกสาขา โอนย้ายสองขั้น ล็อตและวันหมดอายุ ขายของใกล้หมดอายุก่อน |
| `m-payment` | ชำระเงิน | หลายวิธี · ขายเชื่อ | ready | รับเงินสด โอน QR บัตร แบ่งจ่าย มัดจำ และขายเชื่อพร้อมติดตามลูกหนี้ |
| `m-tax` | ภาษี | ใบกำกับ · ใบลดหนี้ | ready | ออกใบกำกับภาษีอย่างย่อและเต็มรูป ใบลดหนี้ และคิด VAT เอกสารที่ออกแล้วแก้ย้อนหลังไม่ได้ · note: "การยื่น e-Tax กับกรมสรรพากรยังอยู่ระหว่างเชื่อมต่อ" |
| `m-purchase` | จัดซื้อ | PO · รับของ | ready | ออกใบสั่งซื้อ รับของ และแนะนำว่าควรสั่งอะไรเพิ่ม |

### กลุ่ม 3: ผลลัพธ์ (`output`)

| id | label | short | status | what | scenarios |
|---|---|---|---|---|---|
| `o-kds` | ครัว (KDS) | แยกสถานีครัว | ready | ออร์เดอร์ขึ้นจอครัว แยกครัวร้อน ครัวเย็น บาร์ มีเสียงเตือนและจับเวลา | restaurant |
| `o-shipping` | จัดส่ง | ใบจัดส่ง · ติดตาม | ready | สร้างใบจัดส่ง คิดค่าส่งตามโซนหรือน้ำหนัก และติดตามสถานะพัสดุ · note: "การจองขนส่ง Flash/Kerry อัตโนมัติยังอยู่ระหว่างเชื่อมต่อ" | retail, pharmacy |
| `o-live` | Live Dashboard | ยอดวันนี้ · จอ TV | ready | ดูยอดขายวันนี้ ออร์เดอร์ แชทรอตอบ และสลิปรอตรวจแบบสด เปิดบนจอ TV ในร้านได้ | all |
| `o-reports` | Reports | ยอดขาย · กำไร · ภาษี | ready | รายงานยอดขาย กำไรจากต้นทุนจริง และรายงานภาษี ส่งออกเป็น Excel/CSV/PDF | all |
| `o-action` | Action Center | งานที่ต้องทำวันนี้ | ready | ระบบบอกงานที่ควรทำวันนี้พร้อมเหตุผล เช่น ของใกล้หมด หรือสลิปรอตรวจ (เป็นคำแนะนำ ระบบไม่ลงมือเอง) | all |

### เส้นวนกลับ (`loop`)

`loop-retention`: "ดึงลูกค้ากลับอัตโนมัติ" · status ready · what: "หาลูกค้าที่เสี่ยงหาย เดาสินค้าชิ้นถัดไปจากประวัติจริง แล้วเสนอเป็นคิวให้พนักงานกดส่ง ระบบไม่ส่งข้อความเอง" · edge `kind: "loop"` จาก `loop-retention` กลับไปกลุ่ม `chat`

### เฉพาะ variant `full`: ส่วนเสริมใต้ diagram

1. **การ์ด "ทางเลือกการติดตั้ง: Retail Server Standalone"** (status pilot, กรอบเส้นประ): "ระบบและฐานข้อมูลติดตั้งในร้าน ใช้ผ่านเครือข่ายภายในได้แม้อินเทอร์เน็ตล่ม **ไม่ซิงก์กับ Cloud** · AI Chat, การชำระเงินออนไลน์, e-Tax และแอปเดลิเวอรียังต้องใช้อินเทอร์เน็ต" ห้ามลากเส้นจากการ์ดนี้เข้า `bms-core` ใส่ลิงก์ไป `/retail-local` ถ้ามีหน้านี้จริง
2. **การ์ด "กำลังเชื่อมต่อ"** (ยังไม่เปิดใช้จริง) แสดงเป็น chip: GrabFood · LINE MAN / Flash · Kerry / Shopee · Lazada (เบต้า) / e-Tax ยื่นสรรพากร / แอป Desktop & Mobile / TikTok ตอบกลับ ใส่ลิงก์ไป `/roadmap` ถ้ามี
3. **แถบ Trust** (พื้นเข้ม): คนยืนยันก่อนทำรายการ · PIN คนที่สองสำหรับงานเสี่ยง · Audit Trail ตรวจย้อนหลัง · ข้อมูลแยกแต่ละร้าน · เอกสารภาษีแก้ย้อนไม่ได้
4. **เชิงอรรถ**:
   - "ร้านขายยา: เภสัชกรเป็นผู้ตัดสินใจทางคลินิกและอนุมัติทุกรายการ"
   - "Mobile Offline รองรับเฉพาะบิลขายปลีกเงินสดพื้นฐาน"
   - "สถานะอัปเดต ณ {วันที่}" (เก็บวันที่เป็นค่าคงที่ใน `flowData.ts` ชื่อ `FLOW_STATUS_UPDATED_AT = "2026-09-29"` แล้วแสดงตาม locale)

### Scenarios สำหรับโหมด ▶ เล่นทีละขั้น

- **retail**: `ch-line` "ลูกค้าทัก LINE ถามกาแฟ 2 ถุง" → `ai-inbox` "AI เช็กสต็อกและราคาจริง" → `confirm` "สรุปตะกร้าให้ลูกค้ากดยืนยัน" → `bms-core` "สร้างบิล ตัดสต็อก" → `m-payment` "ลูกค้าโอนเงิน" → `o-shipping` "สร้างใบจัดส่ง" → `o-live` "ยอดขึ้น Dashboard ทันที"
- **restaurant**: `in-qr` "ลูกค้าสแกน QR โต๊ะ 5 สั่งข้าวผัด" → `intake-accept` "พนักงานกดรับ" → `cloud-pos` "เข้าบิลของโต๊ะ" → `o-kds` "ขึ้นจอครัวร้อน" → `m-payment` "เก็บเงินที่โต๊ะ แบ่งจ่ายได้" → `m-tax` "ออกใบกำกับภาษี" → `o-reports` "เข้ารายงานประจำวัน"
- **boardgame**: `pos-web` "เปิดโต๊ะ เริ่มจับเวลาเล่น" → `cloud-pos` "บันทึกเกมที่ยืมและสมาชิก" → `bms-core` "รวมค่าเวลาและเครื่องดื่มในบิลเดียว" → `m-loyalty` "สะสมแต้มสมาชิก" → `o-live` "เห็นโต๊ะและยอดแบบสด"
- **pharmacy**: `ch-line` "ลูกค้าแจ้งมีผื่นและเคยแพ้ยา" → `ai-inbox` "AI ซักประวัติ ใช้ข้อมูลเดิมที่ลูกค้ายินยอม" → `confirm` "ลูกค้ายืนยันข้อมูล" → `cloud-pos` "เข้าคิวเภสัชกร" → `bms-core` "**เภสัชกรตรวจและกด PIN อนุมัติ**" → `m-stock` "ตัดสต็อกตามล็อต FEFO" · ทุกขั้นของ scenario นี้ต้องมีป้ายว่า "ร้านยาเป็นฟีเจอร์ Pilot ต้องเปิดใช้ก่อน" และข้อความ "เภสัชกรเป็นผู้ตัดสินใจทางคลินิก"

ถ้า node ที่ scenario อ้างถึงไม่มีใน variant ที่กำลังแสดง ให้ข้ามขั้นนั้น ห้าม error

---

## พฤติกรรม Interaction

### Desktop (กว้าง ≥ 992px)

1. **Layout**: SVG หนึ่งภาพ ใช้ `viewBox` และ responsive ตามความกว้างคอนเทนเนอร์ ลำดับบนลงล่าง:
   - แถวบน: 3 การ์ดกลุ่ม (แชท / ออร์เดอร์รอกดรับ / POS) แต่ละการ์ดมีไอคอนเรียงแถว เส้นรวมลงสู่ pill ของกลุ่ม
   - `intake-accept` มีลูกศรชี้เข้า `cloud-pos`
   - ขั้น ② `confirm` → `bms-core` วงกลมกลาง
   - 6 โมดูลรอบวงกลม ซ้าย 3 ขวา 3 ป้ายชื่ออยู่ด้านนอก
   - ขั้น ③ 5 ผลลัพธ์เรียงแถว
   - แถบ retention มีเส้นประวนกลับขึ้นไปที่การ์ดแชท
2. **Hover / Focus ที่ node**: node ขยาย ~1.06 เท่า เส้นที่เชื่อมกับ node นั้นเปลี่ยนเป็นสีหลัก ส่วน node และเส้นอื่นจางลงเหลือ opacity ~0.35 ใส่ transition 150–200ms
3. **Click / Enter / Space ที่ node**: เปิด `FlowNodeDetail` เป็นแผงด้านขวา (desktop) แสดง label, status badge, what, example (ในกรอบสไตล์บับเบิลแชท), note (ถ้ามี) และลิงก์ "ดูเพิ่ม" (ถ้ามี href) ปิดได้ด้วยปุ่ม X, กด Esc หรือคลิกพื้นที่ว่าง เมื่อปิดแล้วให้ focus กลับไปที่ node เดิม
4. **Scenario tabs**: แถบปุ่มด้านบน "ทั้งหมด · ค้าปลีก · ร้านอาหาร · บอร์ดเกม · ร้านยา" (ใช้ antd `Segmented` หรือ component ที่โปรเจกต์ใช้) เลือกแล้ว node ที่ไม่อยู่ใน `scenarios` ของประเภทนั้นจางลง เก็บค่าที่เลือกไว้ใน URL query `?shop=restaurant` เพื่อให้ทีมขายแชร์ลิงก์ได้
5. **ปุ่ม ▶ "ดูตัวอย่างการทำงาน"** (แสดงเมื่อเลือกประเภทร้านแล้ว):
   - ไฮไลต์ node ตาม `steps` ทีละขั้น ขั้นละ ~2.2 วินาที มีจุดเล็กวิ่งไปตามเส้นระหว่าง node
   - แสดง caption ของขั้นนั้นใต้ diagram พร้อมตัวนับ "ขั้น 2/7"
   - มีปุ่ม ⏸ หยุด, ◀ ย้อน, ▶ ถัดไป, ↺ เริ่มใหม่
   - จบแล้วหยุดที่ขั้นสุดท้าย ไม่วนเอง
   - ถ้าผู้ใช้เปิด `prefers-reduced-motion: reduce` ไม่ต้องมีจุดวิ่ง ให้เปลี่ยนไฮไลต์ทันที และไม่เล่นอัตโนมัติ ผู้ใช้ต้องกด "ถัดไป" เอง
6. **Status badge บน node**: แสดงเฉพาะ `pilot` (เหลือง "PILOT") และ `config` (ไอคอน ⚙️ เล็ก + tooltip "ต้องตั้งค่าก่อนใช้") ส่วน `ready` ไม่ต้องมี badge เพื่อไม่ให้ภาพรก

### Mobile / Tablet (กว้าง < 992px)

- **ห้ามย่อ SVG desktop ลงมา** ให้ใช้ `FlowStepper` แทน
- เรียงเป็นการ์ดแนวตั้ง 4 ช่วง: ① ช่องทางเข้า (3 กลุ่มย่อย) → ② ตรวจและยืนยัน → BMS + โมดูล (grid 2 คอลัมน์) → ③ ผลลัพธ์ → retention
- ระหว่างช่วงมีลูกศรลงแนวตั้ง
- แตะการ์ดแล้วกางรายละเอียดแบบ accordion เปิดได้ทีละใบ
- Scenario tabs เลื่อนแนวนอนได้ ปุ่ม ▶ ใช้ได้เหมือน desktop โดย scroll ไปการ์ดที่ไฮไลต์ด้วย `scrollIntoView({ block: "center" })` (ปิด smooth เมื่อ reduced motion)
- touch target อย่างน้อย 44×44px

### Variant

- `compact` (หน้าแรก): แสดงเฉพาะ node ที่ `compact: true` ได้แก่ 3 กลุ่มบน (แสดงไอคอนย่อยได้), `ai-inbox`, `cloud-pos`, `confirm`, `bms-core`, โมดูล 4 ตัว (`m-crm`, `m-stock`, `m-payment`, `m-tax`), ผลลัพธ์ 3 ตัว (`o-kds`, `o-live`, `o-action`) · ไม่มีการ์ด Retail Server, การ์ดกำลังเชื่อมต่อ และเชิงอรรถยาว · มีปุ่ม "ดูการทำงานแบบละเอียด →" ไป `/how-it-works` · ยังมี scenario tabs และ ▶
- `full` (`/how-it-works`): แสดงทุกอย่าง

---

## Design reference (ต้องดูก่อนเริ่มทำ UI)

ไฟล์ต้นแบบอยู่ในโฟลเดอร์ `docs/design/flow-diagram/` ของ repo:

- `bms-flow-diagram-v8.jpg` คือภาพเป้าหมายของ variant `full` บน desktop **เปิดดูภาพนี้ก่อนเขียน UI**
- `bms-flow-diagram-v8.html` คือ SVG ต้นฉบับของภาพนั้น ใช้เป็นแหล่งอ้างอิงสำหรับ:
  - **path ของไอคอน**: คัดลอก `<g id="i-...">` ใน `<defs>` ไปใส่ `FlowIcons.tsx` ได้เลย (i-chat, i-phone, i-globe, i-store, i-spark, i-users, i-box, i-card, i-doc, i-truck, i-chart, i-target, i-ucheck, i-lock, i-hist, i-shield, i-monitor, i-server, i-pulse, i-qr, i-gift, i-cart, i-chef, i-loop, i-bag)
  - **สัดส่วนและตำแหน่ง**: viewBox 1080 กว้าง, การ์ดกลุ่มบนกว้าง 340/340/280, วงกลมกลาง r=96, โมดูล r=32, ผลลัพธ์ r=38
  - **สี, ขนาดฟอนต์, gradient ของวงกลมกลาง**

ข้อควรรู้:

- ไฟล์ HTML เป็นภาพนิ่งที่วาดด้วย Python ไม่ใช่โค้ด production **ห้ามคัดลอกไฟล์ทั้งไฟล์มาใช้** ให้ใช้เป็นแบบอ้างอิงแล้วเขียนใหม่เป็น React component ที่อ่านจาก `flowData.ts`
- ถ้าเนื้อหาในภาพต่างจากตารางเนื้อหาใน prompt นี้ **ให้ถือตาม prompt** เพราะ prompt ตรวจกับโค้ดแล้ว ส่วนภาพเป็นแค่แบบ layout
- ภาพนี้มีเฉพาะ desktop ส่วน mobile stepper ให้ใช้ภาษาภาพเดียวกัน คือการ์ดขาว แถบสีกลุ่ม วงกลมเลขขั้น และไอคอนบนวงกลมสีทึบ
- ถ้าไม่พบไฟล์ในโฟลเดอร์นี้ **ให้หยุดแล้วแจ้ง** ห้ามออกแบบเอง

## Visual design (ให้ใกล้เคียงภาพต้นแบบ v8)

- ใช้ token สีของ antd/โปรเจกต์ถ้ามี ถ้าไม่มี ให้ประกาศเป็น CSS variables ใน scope ของ component:
  - primary `#1747d1`, ink `#0f1b2d`, muted `#5b6780`, line `#e3e8f0`, surface `#ffffff`, bg `#f5f7fb`
  - กลุ่มแชท `#1747d1`, กลุ่มออร์เดอร์รอกดรับ `#0e9f6e`, กลุ่ม POS `#e0620b`, retention `#0fb5a6`
  - pilot badge พื้น `#fef3c7`, ขอบ `#eab308`, ตัวอักษร `#854d0e`
  - วงกลม `bms-core` ไล่สี `#0c2a7a → #1747d1 → #0fb5a6`
- **Dark mode**: redefine ตัวแปรทุกตัว ให้ contrast ของตัวหนังสือ ≥ 4.5:1 ทั้งสองธีม
- การ์ดกลุ่ม: พื้นขาว มุมโค้ง 20px ขอบ 1.5px สี line มีแถบสั้นสีกลุ่มด้านบน วงกลมเลขขั้นสีกลุ่ม
- ไอคอน: line icon 24×24 เส้นหนาเท่ากันทุกตัว บนวงกลมสีทึบของกลุ่ม สำหรับโมดูลใช้วงแหวนสี primary กับไอคอนสี primary
- ฟอนต์: ใช้ฟอนต์ไทยที่โปรเจกต์ใช้อยู่แล้ว
- ข้อความใต้ไอคอน 12–13px ส่วนหัวข้อ 16px ห้ามเล็กกว่า 12px

---

## Accessibility และ SEO

- node ทุกตัวเป็น `<g role="button" tabIndex={0} aria-label="{label}: {short}">` หรือ `<button>` ใน `foreignObject` ต้องกดด้วยคีย์บอร์ดได้ และมี focus ring ชัด
- ลำดับ Tab ต้องตรงกับลำดับ flow (บน → ล่าง, ซ้าย → ขวา)
- แผงรายละเอียดใช้ `role="dialog"` หรือ `aria-live="polite"` ตามรูปแบบที่เลือก พร้อม `aria-labelledby`
- caption ของโหมด ▶ อยู่ใน `aria-live="polite"`
- ใต้ SVG ต้องมีเนื้อหาเป็นข้อความจริง (ซ่อนด้วย visually-hidden class ได้) สรุปขั้นตอนทั้งหมดเป็น `<ol>` เพื่อให้ search engine และ screen reader อ่านได้ ห้ามให้ข้อความมีอยู่ใน SVG อย่างเดียว
- หน้า `/how-it-works` ต้องมี `<h1>` และ metadata

---

## Performance

- component ส่วน interactive เป็น `"use client"` แต่ข้อมูลและโครง HTML ต้อง render ฝั่ง server ได้
- ห้ามโหลดรูปภายนอก ไอคอนทั้งหมดเป็น inline SVG
- animation ใช้ CSS transform/opacity หรือ `requestAnimationFrame` และต้องเคลียร์ timer/rAF ตอน unmount
- ไม่ควรทำให้ bundle ของหน้าแรกโตเกิน ~25KB gzip ถ้าเกิน ให้ใช้ `next/dynamic` โหลดส่วน ▶ ทีหลัง

---

## Tests

ใช้ test runner ที่ `apps/web` มีอยู่แล้ว ถ้าไม่มี test runner สำหรับ component ให้เขียนเฉพาะ unit test ของข้อมูล แล้วรายงาน

1. **Data integrity test** (`flowData.test.ts`):
   - node id ไม่ซ้ำกัน
   - edge ทุกเส้นอ้าง node ที่มีอยู่จริง
   - scenario step ทุกขั้นอ้าง node ที่มีอยู่จริง
   - ไม่มี node `status: "planned"` ที่ `compact: true`
   - ทุก node มีข้อความครบทั้ง th และ en (หรือ i18n key มีครบทุก locale)
   - **ไม่มีชื่อผู้ให้บริการต้องห้าม** (ShopeeFood, Robinhood, Lalamove, Grab Express, LINE MAN Messenger, ไปรษณีย์ไทย, foodpanda) ปรากฏในข้อมูล
   - node ที่มี `href` ต้องชี้ route ที่มีอยู่จริงใน `app/` (ตรวจด้วยรายการ route ที่ hardcode ไว้ใน test ก็ได้)
2. **Component test** (ถ้ามี React Testing Library): render ได้ทั้ง `compact`/`full` · กด node แล้วแผงเปิด · กด Esc แล้วแผงปิดและ focus กลับ · เปลี่ยน scenario แล้ว URL query เปลี่ยน
3. รัน lint และ typecheck ของ `apps/web` ให้ผ่าน

---

## ขั้นตอนการทำงานที่ต้องการ

1. ทำขั้นที่ 0 แล้วรายงานผลสำรวจสั้น ๆ พร้อมแผนไฟล์ที่จะสร้างหรือแก้ **ก่อนเขียนโค้ด**
2. สร้าง `flowTypes.ts` + `flowData.ts` + data test แล้วรัน test
3. สร้าง `FlowIcons.tsx` และ `BmsFlowDiagram.tsx` (desktop) พร้อม hover/click/detail
4. เพิ่ม scenario tabs และโหมด ▶
5. สร้าง `FlowStepper.tsx` (mobile)
6. สร้างหน้า `/how-it-works` แล้วเพิ่ม section ในหน้าแรก
7. เพิ่มข้อความใน locales (th + en)
8. รัน lint, typecheck และ test ทั้งหมด

แยก commit ตามขั้นตอนถ้าเป็นไปได้ commit message เป็นภาษาอังกฤษแบบ conventional เช่น `feat(web): add interactive BMS flow diagram data model`

---

## Acceptance criteria

- [ ] หน้าแรกมี section "BMS ทำงานอย่างไร" (compact) และหน้า `/how-it-works` (full) ทำงานได้
- [ ] Desktop: hover แล้วไฮไลต์เส้นเชื่อม · click/Enter แล้วเปิดแผงรายละเอียด · Esc ปิดได้
- [ ] Scenario tabs ทำงานและสะท้อนใน URL `?shop=`
- [ ] โหมด ▶ เล่น/หยุด/ย้อน/ถัดไปได้ ไม่วนเอง และเคารพ reduced motion
- [ ] Mobile (ทดสอบที่ 375px): เป็น stepper แนวตั้ง อ่านได้ ไม่มี scroll แนวนอนทั้งหน้า
- [ ] Dark mode อ่านได้ครบ
- [ ] ใช้คีย์บอร์ดได้ทั้งหมด มีข้อความสำรองสำหรับ screen reader/SEO
- [ ] สถานะทุก node ตรงกับ `docs/feature-inventory.md` ไม่มีฟีเจอร์ที่เป็น 🧪/📋 แสดงเป็นพร้อมใช้
- [ ] ไม่มีชื่อผู้ให้บริการต้องห้าม และไม่มีโลโก้แบรนด์ภายนอก
- [ ] ไม่มี dependency ใหม่ ไม่แตะ backend, DB, API
- [ ] lint + typecheck + test ผ่าน

---

## สิ่งที่ต้องรายงานเมื่อเสร็จ

1. รายการไฟล์ที่สร้างและแก้ พร้อมเหตุผลสั้น ๆ
2. จุดที่ต้องให้คนตรวจ: ข้อความภาษาไทย/อังกฤษ และสถานะที่คุณตีความจาก feature-inventory
3. node ไหนที่ยังไม่ใส่ `href` เพราะไม่มีหน้าปลายทาง
4. ขนาด bundle ที่เพิ่มขึ้นในหน้าแรก (ถ้าวัดได้)
5. วิธี rollback: เอา section ออกจากหน้าแรกโดยลบ import หนึ่งบรรทัด หรือ revert commit ของงานนี้ เพราะงานนี้เป็น frontend ล้วน ไม่มี migration
6. สิ่งที่แนะนำให้ทำต่อ เช่น ดึงสถานะจากทะเบียนฟีเจอร์อัตโนมัติแทนการ hardcode หรือเพิ่มภาพหน้าจอจริงในแผงรายละเอียด

## นอกขอบเขต (ห้ามทำในงานนี้)

- ดึงสถานะแบบ live จาก API/GraphQL
- แก้หน้า admin, POS หรือ flow การขายจริง
- สร้างหน้า `/roadmap` หรือ `/retail-local` ใหม่ (ลิงก์ไปได้เฉพาะเมื่อมีหน้าอยู่แล้ว)
- เปลี่ยน design system หรือธีมรวมของเว็บ
