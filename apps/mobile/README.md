# BMS POS — Mobile (React Native, bare — ไม่ใช้ Expo)

โครง "กลุ่ม A" ของแผน RN POS: navigation + design system + หน้าจอ mock data เท่านั้น
**ยังไม่ต่อ backend จริง** — ดูเหตุผลของการแบ่งงานเป็นกลุ่ม A/B และลำดับที่ตกลงกันไว้ก่อนเริ่มงานนี้

## สถานะวันนี้

- ✅ bare React Native (ไม่มี Expo) — `react-native@0.87.1`, React 19, TypeScript
- ✅ Navigation: `@react-navigation` (native-stack + bottom-tabs) — Login → แท็บตามโหมดร้าน
  (ร้านทั่วไป/ร้านขายยา: ขาย + กะ · ร้านอาหาร: เมนูอาหาร + ผังโต๊ะ + ครัว + กะ)
- ✅ Settings มี **โหมดร้านสำหรับทดสอบ** 3 แบบ: ร้านทั่วไป, ร้านขายยา, ร้านอาหาร · ค่าอยู่ใน
  memory เฉพาะรอบที่เปิดแอป ไม่แตะ Keychain/device token และเปลี่ยนเฉพาะ mock UI เท่านั้น
  ไม่เขียนทับ `businessArchetype` จาก server และไม่ใช้เป็นสิทธิ์ขายหรืออนุมัติยา
- ✅ Design system: `src/theme/` — สี/spacing/typography ยกมาจาก `apps/web/app/globals.css` ตรง ๆ
  เพื่อให้ RN กับเว็บ POS เดิมมีภาษาสีเดียวกัน (ดูคอมเมนต์ใน `src/theme/colors.ts`)
- ✅ หน้าจอหลัก + workflow mock ถัดไป (Login, ตั้งค่า/จับคู่เครื่อง, เมนู/ตะกร้า, ชำระเงิน, ใบเสร็จ,
  ประวัติขาย/รายละเอียดใบเสร็จ, return/void, ผังโต๊ะ, บิลโต๊ะ, สั่งอาหารเข้าโต๊ะ, จอครัว, กะ/ลิ้นชัก)
  ทำงานได้ด้วย mock data ในหน่วยความจำ ส่วนเส้นขาย/ครัว/ผังโต๊ะยังไม่เรียก network
- ✅ Device pairing ชั้นฐาน: รับลิงก์ `bmspos://pair`/ลิงก์ POS/token, เก็บ token ใน iOS Keychain หรือ Android
  Keystore ผ่าน `react-native-keychain`, และตรวจตัวตนเครื่องกับ `GET /api/pos/session` โดย tenant/สาขามาจาก
  server เท่านั้น ไม่รับจากค่าที่ client กรอก
- ✅ ไอคอนแท็บล่าง — วาดเองด้วย `react-native-svg` (`src/components/icons/TabIcons.tsx`) ไม่ใช้ icon
  font เพราะต้องลิงก์ฟอนต์เพิ่มทั้ง iOS/Android ซึ่งเป็นจุดพังบ่อยของ RN
- ✅ จอเมนูอาหาร (แท็บแรก) ทำตามกริดเมนูของ `/pos/restaurant` บนเว็บ: การ์ด **รูป + ชื่อ + ราคา**,
  ช่องค้นหา (ค้นชื่อและ SKU · มีคำค้น = ค้นทุกหมวด), ป้ายจำนวนที่อยู่ในตะกร้า, การ์ดที่ขายไม่ได้
  จางลง + ป้าย "หมดวันนี้" + เหตุผลใต้ชื่อ
  - รูปอาหารเป็น **SVG วาดในโค้ด** (`src/components/DishArt.tsx`) พอร์ตชุดเดียวกับเว็บ (ข้าว/เส้น/
    ต้ม/ยำ/เครื่องดื่ม) — ไม่โหลดจาก CDN เพราะจอขายต้องทำงานตอนเน็ตร้านหลุด · ถ้าสินค้ามีรูปจริง
    (`imageUrl`) รูปจริงชนะเสมอ
- ✅ ร้านทั่วไปและร้านขายยามี mock catalog/หมวด/คำค้น/ภาพ fallback ของตัวเอง ไม่แสดงอาหาร
  ผังโต๊ะ หรือครัว; สินค้าควบคุมในโหมดร้านยาเป็นเพียงตัวอย่างสถานะรอตรวจสอบ ไม่ใช่การตัดสิน
  Product Policy ฝั่ง client
- ✅ แก้จำนวนได้ทุกที่ที่เห็นจำนวน (`QtyStepper`) — บนการ์ดเมนู, ในแผงตะกร้า และในหน้าชำระเงิน
  · กด − จนเหลือ 0 = บรรทัดหลุดออกจากตะกร้าเอง จึงไม่มีปุ่มลบซ้อนอีกปุ่มให้ต้องเลือก
- ✅ Checkout mock รองรับเงินสด/QR/บัตรเครดิตและ split payment: เงินสดกรอกยอดรับจริง มีปุ่มจำนวนด่วน
  และ "รับพอดี", QR/Card ต้องใส่เลขอ้างอิง mock, ยอดรวมทุกช่องทางต้องเท่ากับยอดสุทธิจึงยืนยันได้,
  แสดงยอดคงเหลือ/validation และ popup ยืนยันแสดงทุกช่องทางพร้อมเงินทอน/เลขอ้างอิง
- ✅ พักบิล retail ใน memory พร้อมชื่อ/หมายเหตุ เรียกกลับมาได้ และลบผ่าน confirmation popup;
  snapshot เก็บสินค้า สมาชิก คูปอง คะแนน mock และส่วนลดพิเศษ แต่ **ไม่เก็บ PIN/ผู้อนุมัติ** —
  resume แล้วต้องอนุมัติส่วนลดพิเศษใหม่
- ✅ ประวัติขายล่าสุดใน memory ค้นหาได้ด้วยเลขใบเสร็จ ชื่อลูกค้า เลขสมาชิก SKU/ชื่อสินค้า เปิดดูรายละเอียด
  ใบเสร็จ และกดพิมพ์ซ้ำ mock โดยขึ้นชัดเจนว่ายังไม่ต่อเครื่องพิมพ์จริง
- ✅ Return/Void mock จากรายละเอียดใบเสร็จ: คืนทั้งบิลหรือเลือกบางรายการได้ จำนวนคืนไม่เกินที่ขาย,
  แสดงยอดคืนก่อนยืนยัน, refund allocation อ้างอิงช่องทางชำระเดิม เงินสดสำเร็จทันที ส่วน QR/Card
  เป็น "รอยืนยันการคืนเงิน"; Void แยกจาก Return ต้องมีเหตุผลและ PIN ผู้อนุมัติคนที่สอง (`9999`)
  และไม่เก็บ PIN ใน state ถาวร
- ✅ ก่อนบันทึกการขายมี popup สรุปยอดสุทธิ วิธีชำระเงินทุกช่องทาง และจำนวนสินค้า พร้อมคำเตือนว่าหลังยืนยัน
  ต้องแก้ผ่านรายการคืน; บนแท็บเล็ตเป็น dialog กลางจอ และบนมือถือเป็น bottom sheet
- ✅ หน้า checkout ทดสอบสมาชิก คูปอง และส่วนลดพิเศษได้ครบถึงใบเสร็จ: tier discount ใช้อัตโนมัติ,
  คูปองตรวจสมาชิก/ยอดขั้นต่ำ, ส่วนลดพิเศษต้องมีเหตุผลกับ PIN ผู้อนุมัติแยก (`9999` ใน mock)
  และสรุปแต่ละชั้นก่อนยืนยัน โดยคณิตศาสตร์ทั้งหมดระบุชัดว่าเป็น preview ฝั่ง clientที่จะถูกแทนด้วย
  `composeDiscounts()` จาก server
- ✅ หน้าเมนูมีปุ่มสแกนบาร์โค้ดพร้อมกรอบสแกนจำลอง, ป้อน barcode/SKU เองได้ และเพิ่มสินค้าที่
  resolve จาก mock catalog ลงตะกร้า; ยังไม่เรียกกล้องหรือเชื่อม Bluetooth HID จริง
- ✅ **สั่งอาหารเข้าโต๊ะได้ครบวง** (ผังโต๊ะ → เลือกโต๊ะ → สั่ง → ส่งครัว → ผังโต๊ะขยับตาม):
  - `state/ChecksContext.tsx` ถือบิลรายโต๊ะ (seed จาก `mocks/floor`) และเป็นแหล่งเดียวที่ผังโต๊ะ
    หน้าบิล และจอสั่งอาหารของโต๊ะอ่าน — ไม่งั้นการ์ดโต๊ะกับบิลจะบอกคนละยอด
  - **แท็บเล็ต**: หน้าบิลมีกริดเมนูฝั่งกว้าง + แผงบิลขวา 320pt สั่งได้จากหน้าเดียวจบ
    (รูปเดียวกับจอสั่งอาหารของ `/pos/restaurant` บนเว็บ) · **มือถือ**: ปุ่ม "สั่งอาหาร" ไปหน้า
    `TableMenu` ที่หัวจอบอกตลอดว่ากำลังสั่งให้โต๊ะไหน
  - กริดเมนูเป็นคอมโพเนนต์เดียวกันทั้งแท็บขายกลับบ้านและบิลโต๊ะ (`components/MenuGrid.tsx`)
  - บรรทัดที่ยัง `NEW` แก้จำนวนได้ · ที่ `SENT`/`SERVED` แก้ไม่ได้ ขึ้นว่า "แก้ที่จอครัว" เพราะครัว
    อาจทำเสร็จแล้ว การลบเงียบ ๆ จากบิลคือของหายโดยไม่มีใครรู้
  - "ส่งครัว" พลิก `NEW → SENT` ทั้งรอบ · **คิดเงินกดไม่ได้ตราบใดที่ยังมีบรรทัด `NEW`** และผังโต๊ะ
    ขึ้นป้าย "ยังไม่ส่งครัว" ให้เห็นตั้งแต่หน้าแรก (กติกาเดียวกับฝั่งเว็บ)
  - "คิดเงิน" จากบิลโต๊ะไป checkout workflow ชุดเดียวกับ retail โดยใช้บิลโต๊ะเดิมใน `ChecksContext`
    ไม่ seed cart ใหม่; จ่ายสำเร็จแบบ mock แล้วปิดบิลและโต๊ะกลับเป็นว่าง
- ✅ Responsive/tablet — **ทุกหน้าใช้พื้นที่จริงของจอไอแพด ไม่มีหน้าไหนเป็นคอลัมน์ขนาดมือถือกลางจอ**
  (`src/theme/useResponsive.ts` + `useWindowDimensions`):
  1. กริด (เมนู/ผังโต๊ะ/ตั๋วครัว) ปรับคอลัมน์ตามความกว้าง **ของพื้นที่กริดจริง** (`columnsForWidth`)
     พร้อม `padGrid()` เติมช่องว่างแถวสุดท้าย ไม่งั้นการ์ด 2 ใบสุดท้ายยืดเป็นใบละครึ่งจอ
  2. หน้าที่มี "รายการ + การกระทำ" เป็น **สองแผง** บนแท็บเล็ต · มือถือเรียงลงมาเหมือนเดิม:
     - **เมนูอาหาร**: กริดฝั่งกว้าง + **แผงตะกร้า** ขวา 320pt (แก้จำนวนได้ในแผง)
     - **บิลโต๊ะ / ชำระเงิน / ใบเสร็จ / กะ**: รายการฝั่งกว้าง · สรุป+ปุ่มอยู่แผงข้าง
     - **Login**: เลือกสาขา/ผู้ปฏิบัติงานฝั่งซ้าย · แป้น PIN ขวา · ทั้งสองแผงจัดกลางแนวตั้ง
  - ยืนยันแล้วทั้ง iPhone 17 (402pt) และ iPad Air 13" (1024pt)
- ✅ ปุ่มย้อนกลับบนหน้าที่ถูก push (`ScreenHeader`) — บิลโต๊ะและหน้าชำระเงิน · navigator ตั้ง
  `headerShown: false` ทั้งแอป หน้าพวกนี้จึงต้องมีทางออกของตัวเอง (ก่อนหน้านี้เข้าไปแล้วออกไม่ได้
  นอกจากปัดขอบจอ ซึ่งบนแท็บเล็ตในกล่องกันกระแทกทำได้ยาก)
- ✅ build ผ่านจริงบน iOS Simulator (pod install + xcodebuild) — ยืนยันแล้วทั้งมือถือและแท็บเล็ต
- ✅ Android debug APK build ผ่านจริงด้วย `./gradlew assembleDebug` (RN New Architecture + Keychain + deep link)
- ❌ ยังไม่มี GraphQL/Apollo Client, ยังไม่มี cashier auth/session จริง, ยังไม่มี WebSocket subscription
- ❌ ยังไม่แตะฮาร์ดแวร์ (เครื่องพิมพ์ ESC/POS, สแกนเนอร์, จอลูกค้า) — ตกลงกันไว้แล้วว่าเป็นงานฝั่ง client
  แยกทีหลัง หลัง backend/schema นิ่ง

## ทำไมถึงหยุดแค่นี้ก่อน (สำคัญ — อย่าข้ามไปต่อ Group B เอง)

Backend วันนี้ (`apps/web/app/api/pos/*`) เป็น REST + device-token + PIN-ต่อบิล ไม่ใช่ GraphQL/session
กำลังวางแผนเปลี่ยนเป็น GraphQL ทั้งหมด + auth แบบ cashier login (session ต่อคน) + WS subscription
สำหรับจอครัว/ออร์เดอร์เข้า — **schema/auth ยังไม่นิ่ง** การผูกหน้าจอเข้ากับ backend ตอนนี้จะต้องแก้ซ้ำแน่นอน
โดยเฉพาะ `LoginScreen` ซึ่งเป็นหน้าที่ auth model ใหม่กระทบโดยตรง (idle-timeout, สลับผู้ใช้, PIN vs password)

ลำดับที่ตกลงกันไว้: ปิด schema (SDL) → backend implement + auth ใหม่ → **สลับหน้าเว็บ POS เดิมมาใช้ก่อน**
(เป็นตัวพิสูจน์ contract เพราะ business logic ผ่าน recheck มาแล้วนับสิบรอบ) → ค่อยผูก RN เข้ากับ contract
ที่นิ่งแล้ว — ดู [docs/business/pos.md § Native POS client](../../docs/business/pos.md#native-pos-client-scaffold)
สำหรับขอบเขตที่เป็นเอกสารถาวร

## โครงสร้าง

```
apps/mobile/
  App.tsx                      — root: SafeAreaProvider + ThemeProvider + RootNavigator
  src/
    theme/                     — สี/spacing/typography + ThemeProvider (context) + useResponsive
                                  (breakpoint แท็บเล็ต + จำนวนคอลัมน์กริดตามความกว้างพื้นที่จริง)
    components/                — Button, Card, StatusPill, NumericKeypad, ScreenContainer,
                                  ScreenHeader (ปุ่มย้อนกลับ), SearchField, QtyStepper,
                                  MenuGrid (กริดเมนู+ค้นหา ใช้ร่วมกันทั้งขายกลับบ้านและบิลโต๊ะ),
                                  DishArt (รูปอาหาร SVG), icons/TabIcons (SVG)
    navigation/                — RootNavigator (Login/Main) + MainTabs (4 แท็บ, แต่ละแท็บมี stack ของตัวเอง)
    state/CartContext.tsx       — ตะกร้าขายกลับบ้าน (scope แค่ stack ขาย)
                                  + parked bills ใน memory (ไม่เก็บ PIN/approver)
    state/StoreModeContext.tsx  — โหมด preview 3 แบบ; ไม่ใช่ authority จาก backend
    state/ChecksContext.tsx     — บิลรายโต๊ะ (scope ทั้งแท็บ — ผังโต๊ะ/บิล/จอสั่งอาหารอ่านชุดเดียวกัน)
    state/SalesContext.tsx      — sale/return/void ledger จำลองใน memory; ใบเสร็จเดิม immutable
    lib/paymentMath.ts          — pure split-payment validation/change/quick cash
    lib/returnMath.ts           — pure return total + refund allocation ไปช่องทางเดิม
    screens/
      LoginScreen.tsx           — เลือกสาขา/ผู้ปฏิบัติงาน + PIN keypad (ยังไม่ยืนยันตัวตนจริง)
      settings/                 — จับคู่/เลิกจับคู่เครื่อง + ตรวจ device token กับ server
      sell/                     — Menu → Checkout → Receipt → SalesHistory/SaleDetail (ค้าปลีก + restaurant checkout)
      floor/                    — Floor (ผังโต๊ะ) → CheckDetail (บิลโต๊ะ) → TableMenu (สั่งอาหาร, มือถือ)
      kitchen/                  — KitchenBoard (จอครัว, ตัวกรองสถานี)
      shift/                    — Shift (กะ/ลิ้นชัก/เงินเข้า-ออก)
    mocks/                      — ข้อมูลจำลองทั้งหมด รูปทรงใกล้เคียงกับที่ GraphQL น่าจะคืนจริง
```

## รัน

```bash
npm install
cd ios && export LANG=en_US.UTF-8 && pod install && cd ..
npm run ios      # หรือ: npx react-native run-ios --simulator "iPhone 17"
npm run android  # ต้องมี Android SDK/emulator ตั้งไว้แล้ว
npm test         # Jest smoke test + unit tests ของ pairing
npm run typecheck
npm run lint
```

`export LANG=en_US.UTF-8` ก่อน `pod install` จำเป็นบนเครื่องที่ locale ไม่ใช่ UTF-8 (CocoaPods 1.16
throw `Encoding::CompatibilityError` ไม่งั้น — เจอบนเครื่อง dev เครื่องนี้)

## ของที่ตั้งใจไม่ทำในรอบนี้ (กันไล่ซ้ำ)

- ไม่มี Apollo Client / GraphQL codegen — รอ schema นิ่ง
- ไม่มี auth flow จริง (`LoginScreen` กด "เข้าใช้งาน" แล้วเข้าได้เลยถ้า PIN ≥ 4 หลัก ไม่ตรวจอะไร)
- ไม่มี WebSocket/subscription — จอครัว/ผังโต๊ะ/ตะกร้าเป็น state ในหน่วยความจำจาก `src/mocks/*` ล้วน
  (รีสตาร์ทแอป = บิลทุกโต๊ะกลับไปเป็นค่าเริ่มต้นของ mock)
- "ส่งครัว" ยังไม่สร้างตั๋วครัวจริง — มันแค่พลิกสถานะบรรทัดเป็น `SENT` · จอครัวยังอ่านจาก
  `mocks/kitchenTickets` ชุดเดิม ไม่ได้รับรอบที่เพิ่งส่งไป (กฎจริงฝั่งเว็บ — จองสต็อก + ออกตั๋ว
  ในทรานแซกชันเดียวกัน — พอร์ตตอนต่อ backend)
- การคิดเงินจริงยังไม่เกิด: checkout/return/void ทั้งหมดเป็น state ใน memory และป้าย TEST เท่านั้น
  รอบต่อ backend ต้องเปลี่ยนเป็น server preview, cashier session, RBAC/second-person approval และ
  idempotency key ต่อ mutation จริง
- ไม่มี push notification, ไม่มี background fetch
- ไม่มี native module สำหรับเครื่องพิมพ์/สแกนเนอร์/จอลูกค้า
- หน้าสแกนบาร์โค้ดที่มีอยู่เป็น test harness เท่านั้น — native camera และเครื่องสแกนจริงยังเป็นงาน
  hardware integration; ห้ามใช้ timing ของ keyboard เป็นหลักฐานว่าเป็น HID scanner
- โหมดร้านขายยาใน Settings เปลี่ยนเฉพาะหน้าตาและ mock catalog — ยังไม่ต่อ Product Policy,
  pharmacist PIN, Pharmacy Queue หรือ clinical evidence จริง; การตัดสินทั้งหมดต้องมาจาก backend
- ESLint ปิด `react-native/no-inline-styles` เพราะสี/spacing มาจาก runtime theme และตั้ง
  `react/no-unstable-nested-components` ให้ยอม function ที่ส่งผ่าน render-prop (`renderItem`/`tabBarIcon`)
  โดยตรง — `npm run lint` ผ่านโดยไม่มี warning
