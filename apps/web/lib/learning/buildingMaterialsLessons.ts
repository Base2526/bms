import type { Lesson } from "./catalog";

const bi = (th: string, en: string) => ({ th, en });
const track = ["building-materials"] as const;

// Public, authored pilot instructions. Examples are fictional; operational facts stay on the server.
const authoredLessons: Lesson[] = [
  {
    slug: "building-materials-packs", title: bi("ปูนถุงและพาเลท: ตั้งหน่วยกับ Product Packs", "Cement bags and pallets: set up Product Packs"),
    summary: bi("ตรวจหน่วยนับสต็อก หน่วยขาย หน่วยตั้งราคา และหน่วยแสดงตามช่องที่มี พร้อมตรวจตัวคูณแพ็ก", "Check stock, selling, pricing and display units where supported, then verify pack factors."),
    category: "setup", roles: ["owner", "manager"], tracks: [...track], menu: bi("Products → Product packs → Inventory", "Products → Product packs → Inventory"), action: "/admin/product-packs",
    prerequisite: bi("รายการ SKU ปูนจริง ฉลากผู้ผลิต จำนวนถุงต่อพาเลท และยอดนับที่สาขา", "Real cement SKUs, manufacturer labels, verified bags per pallet and branch counts."),
    steps: [
      bi("สร้าง SKU ปูนถุง โดยระบุหน่วยฐานที่นับสต็อกเป็นถุง และตรวจราคา ภาษี บาร์โค้ด และสาขา", "Create a bag SKU with bags as the counted base unit; review price, VAT, barcode and branch."),
      bi("สร้าง Product Pack สำหรับพาเลทด้วยตัวคูณจากหลักฐานผู้ผลิตหรือการรับสินค้าจริง ห้ามเดาจำนวนถุง", "Create a pallet Product Pack using the manufacturer or actual receipt factor; never guess the bag count."),
      bi("กำหนดหน่วยขายและชื่อที่แสดงในช่องที่ระบบรองรับให้ตรงฉลาก ตรวจราคาต่อแพ็กจากบริการ และลองขายถุงกับพาเลทในร้านทดสอบ", "Set supported selling and display labels to match packaging, verify server pack prices and rehearse bag and pallet sales in a test shop."),
      bi("เทียบหน่วยฐานที่ถูกจองหรือตัดกับ stock movement และยอดคงเหลือของสาขา", "Compare reserved or deducted base units with stock movements and branch balance."),
    ],
    check: bi("ขายหนึ่งพาเลทแล้วจำนวนถุงฐานเปลี่ยนตามตัวคูณที่บันทึก โดยยอดเงินมาจากบิลจริง", "One pallet changes the verified number of base bags, while money comes from the actual bill."),
    caution: bi("ระบบยังแยกหน่วยนับ/ขาย/ตั้งราคา/แสดงได้ไม่ครบทุกช่องทาง; สีหนึ่งลิตรกับห้าลิตรแยกนับ ห้ามใช้ Pack เพื่อสมมติว่าเปิดถังแบ่งขายได้", "Separate stock, selling, pricing and display units are not supported across every channel yet. One-liter and five-liter paint are counted separately; a Pack must not imply container splitting."),
  },
  {
    slug: "building-materials-variants", title: bi("สีต่างขนาด บาร์โค้ด และเครื่องมือมี Serial", "Paint sizes, barcodes and serialized tools"),
    summary: bi("แยกสต็อกของบรรจุภัณฑ์จริง และระบุตัวตนเครื่องมือเมื่อขายและคืน", "Count distinct physical containers separately and identify tools during sale and return."),
    category: "setup", roles: ["owner", "manager"], tracks: [...track], menu: bi("Products → Stock models → Inventory", "Products → Stock models → Inventory"), action: "/admin/stock-models",
    prerequisite: bi("ฉลาก ขนาด สี รหัสผู้ผลิต บาร์โค้ด และเลข Serial ตัวอย่างจากสินค้าจริง", "Real labels, sizes, colors, manufacturer codes, barcodes and sample serials."),
    steps: [
      bi("สร้าง SKU หรือ variant แยกสำหรับสีแต่ละขนาดที่นับแยก เช่น กระป๋องหนึ่งลิตรกับห้าลิตร", "Create distinct SKUs or variants for each separately counted paint container size, such as one liter and five liters."),
      bi("ตรวจบาร์โค้ดต่อ variant และสาขา ก่อน import หรือแก้จำนวนสินค้า", "Check each variant barcode and branch before importing or changing quantity."),
      bi("ตั้งเครื่องมือที่ต้องตามรายชิ้นเป็นแบบ Serial แล้วรับเลขตามสินค้าที่ตรวจจริง", "Configure individually tracked tools for serial tracking and receive only verified serial numbers."),
      bi("ซ้อมขายและคืนจากบิลเดิม โดยเทียบ serial, lot และ stock movement ที่บันทึก", "Rehearse sale and return from the original bill and compare serial, lot and recorded stock movement."),
    ],
    check: bi("สีต่างขนาดและเครื่องมือแต่ละเลขไม่ปนยอดกันข้ามสาขา", "Paint sizes and individual tools keep separate branch balances and identities."),
    caution: bi("Serial หรือ lot ไม่ตรงต้องหยุดให้พนักงานตรวจ ไม่เพิ่มสต็อกพร้อมขายจากการคืนโดยคาดเดา", "A mismatched serial or lot requires staff review; do not guess and add a return to sellable stock."),
  },
  {
    slug: "building-materials-specs", title: bi("เผยแพร่สเปกสินค้าที่มีแหล่งอ้างอิง", "Publish sourced technical specifications"),
    summary: bi("ขนาด ความหนา เกรด มาตรฐาน และข้อจำกัดต้องมีหลักฐานและผู้ตรวจ", "Dimensions, thickness, grade, standards and use limits need evidence and review."),
    category: "setup", roles: ["owner", "manager"], tracks: [...track], menu: bi("Products → Product specs", "Products → Product specs"), action: "/admin/product-specs",
    prerequisite: bi("เอกสารผู้ผลิตหรือมาตรฐานฉบับที่ใช้จริง และผู้มีสิทธิ์ตรวจแยกจากผู้กรอก", "Current manufacturer or standards documents and an authorized reviewer separate from the author."),
    steps: [
      bi("เลือก SKU/variant ให้ตรงฉลาก แล้วกรอกเฉพาะข้อเท็จจริงที่เอกสารระบุ เช่น ความยาว เส้นผ่านศูนย์กลาง น้ำหนัก", "Select the labeled SKU/variant and enter only documented facts such as length, diameter and weight."),
      bi("บันทึกแหล่งอ้างอิงและ revision ของเอกสารสำหรับแต่ละสเปก", "Record the source and document revision for each specification."),
      bi("ส่งให้ผู้มีสิทธิ์อีกคนตรวจและเผยแพร่ แล้วตรวจข้อความที่ลูกค้าจะเห็น", "Have a second authorized person review and publish, then check the customer-visible wording."),
      bi("เมื่อเอกสารเปลี่ยน ให้ทำ revision ใหม่และหยุดเผยแพร่ข้อมูลที่ตรวจไม่ได้", "Create a new revision when the source changes and withhold unverified facts."),
    ],
    check: bi("ช่องที่ไม่มีหลักฐานแสดงว่าไม่ทราบ และ AI ไม่เติมค่าจากชื่อหรือรูปสินค้า", "Unsupported fields remain unknown; AI does not infer them from names or photos."),
    caution: bi("สเปกที่เผยแพร่ไม่ใช่คำรับรองความปลอดภัยโครงสร้าง ไฟฟ้า หรือความเข้ากันได้ของวัสดุ", "Published specifications are not structural, electrical or compatibility certifications."),
  },
  {
    slug: "building-materials-weighted", title: bi("ทรายชั่งน้ำหนัก: ฉลาก prefix 22", "Weighed sand: prefix 22 labels"),
    summary: bi("pilot เฉพาะ retail POS: ราคาต่อกิโลกรัม สต็อกจำนวนเต็มกรัม และ server ตรวจฉลากซ้ำ", "Retail POS pilot only: per-kilogram pricing, integer gram stock and server revalidation."),
    category: "daily", roles: ["owner", "manager", "cashier"], tracks: [...track], menu: bi("Stock models → Weighted prices → POS", "Stock models → Weighted prices → POS"), action: "/admin/weighted-prices",
    prerequisite: bi("เครื่องชั่งและรหัสฉลาก prefix 22 ที่ตรวจได้ สินค้ากรัมที่สาขา และกะ POS ทดสอบ", "Verified prefix 22 scale and code, gram-counted branch stock and a test POS shift."),
    steps: [
      bi("ผู้จัดการตั้ง mapping ฉลากกับ variant และราคาเต็มรวม VAT ต่อกิโลกรัมในระบบ", "A manager sets the label-to-variant mapping and VAT-inclusive price per kilogram on the server."),
      bi("ชั่งและพิมพ์ฉลาก prefix 22 จากเครื่องจริง แล้วสแกนที่ retail POS พร้อม PIN และสิทธิ์", "Weigh and print a prefix 22 label on the real scale, then scan at retail POS with PIN and permission."),
      bi("ตรวจกรัมจำนวนเต็ม ราคาต่อกิโลกรัม ยอดบรรทัด และการปัดสตางค์จากใบเสร็จที่ระบบสร้าง", "Review integer grams, the per-kilogram rate, line amount and satang rounding on the server receipt."),
      bi("ซ้อมคืนบางส่วนจากบิลเดิม แล้วเทียบยอดคืนกับราคาที่ตรึงไว้ ไม่ใช้ราคาปัจจุบันคำนวณย้อนหลัง", "Rehearse a partial return from the original bill and compare it with the frozen price, not today's rate."),
    ],
    check: bi("ฉลากผิดหรือ prefix อื่นถูกปฏิเสธทั้งบิล; ยอดเงินและสต็อกไม่ถูกเขียนบางส่วน", "A malformed or different-prefix label rejects the whole sale with no partial money or stock write."),
    caution: bi("ราคาชั่งยังไม่รองรับเว็บ/AI ลูกค้า; งานตัดสายไฟจากม้วนพร้อมเศษดีและเศษเสียยังไม่มี workflow ครบ", "Measured pricing is not available to web/customer AI; roll cutting with kept and waste remnants has no complete workflow."),
  },
  {
    slug: "building-materials-quotations", title: bi("ใบเสนอราคาโครงการ: revision และอนุมัติ", "Project quotations: revisions and approval"),
    summary: bi("ตรึงรายการ ราคา VAT ค่าส่ง และหลักฐานยอมรับก่อนแปลงเป็นออร์เดอร์", "Freeze lines, prices, VAT, freight and acceptance evidence before conversion."),
    category: "daily", roles: ["owner", "manager"], tracks: [...track], menu: bi("Quotations → Orders", "Quotations → Orders"), action: "/admin/quotations",
    prerequisite: bi("ลูกค้า โครงการ/หน้างาน สาขา รายการ หน่วย ราคา และค่าส่งที่ตรวจแล้ว", "Customer, project/site, branch, items, units, checked prices and known freight."),
    steps: [
      bi("สร้างร่างใบเสนอราคาและตรวจข้อผิดพลาดทุกรายการ; รายการที่ไม่พบ ปิดขาย หรือราคาไม่ครบต้องแก้ก่อน", "Draft the quote and resolve every line error; unknown, inactive or unpriced items must be corrected."),
      bi("ระบุค่าส่งจริงหรือทำเครื่องหมายว่าไม่ทราบโดยไม่แสดงยอดยืนยัน แล้วให้ผู้มีสิทธิ์อีกคนอนุมัติ", "Enter verified freight or mark it unknown without showing a confirmed total, then obtain a separate authorized approval."),
      bi("บันทึกการส่งและหลักฐานยอมรับ; ถ้าแก้ใบที่ส่งแล้ว ให้สร้าง revision ใหม่แทนการเขียนทับ", "Record sending and acceptance evidence; revise a sent quote by creating a new revision, never overwriting it."),
      bi("แปลงใบที่ยอมรับเป็นออร์เดอร์ผ่านระบบเดิม ซึ่งตรวจสต็อกและอายุใบใหม่ก่อนจอง", "Convert an accepted quote through the existing order service, which rechecks stock and validity before reserving."),
    ],
    check: bi("ใบเสนอราคาไม่จองสต็อก; ถ้าหมดอายุหรือของไม่พอจะไม่สร้างออร์เดอร์บางส่วน", "A quote does not reserve stock; expiry or insufficient stock prevents partial order creation."),
    caution: bi("ราคา catalog ยังรวม VAT; รูปเอกสารและราคาก่อน VAT สำหรับ B2B ต้องให้นักบัญชีตรวจ ไม่อ้างว่าใช้ยื่นจริง", "Catalog prices include VAT; an accountant must review document format and VAT-exclusive B2B pricing before tax filing claims."),
  },
  {
    slug: "building-materials-credit", title: bi("POS มัดจำ ขายเชื่อ และลูกหนี้", "POS deposits, credit sales and receivables"),
    summary: bi("แยกเงินรับจริงจากลูกหนี้ และตรวจบิล/สิทธิ์/การรับชำระภายหลัง", "Separate collected cash from receivables and verify bills, permissions and later collections."),
    category: "daily", roles: ["owner", "manager", "cashier"], tracks: [...track], menu: bi("POS → Receivables", "POS → Receivables"), action: "/admin/receivables",
    prerequisite: bi("ลูกค้าที่ระบุตัวตน เงื่อนไขเครดิต ผู้มีสิทธิ์อนุมัติ และกะ POS ที่เปิด", "Identified customer, credit terms, authorized approver and an open POS shift."),
    steps: [
      bi("เลือกสินค้าจาก catalog และหน่วยที่ระบบรองรับ ตรวจราคา ภาษี สาขา และยอดก่อนยืนยันด้วย PIN", "Select catalog products and supported units; check price, tax, branch and total before PIN confirmation."),
      bi("ทดสอบเงินสด โอน QR บัตร แบ่งจ่าย หรือมัดจำตามวิธีที่ร้านตั้งค่าและตรวจได้จริง", "Rehearse cash, verified QR transfer, card, split payment or deposit only where the shop has configured the method."),
      bi("ขายเชื่อด้วยลูกค้าและสิทธิ์ที่ถูกต้อง แล้วตรวจว่าบิลเปิดยอดลูกหนี้ใน AR ledger โดยไม่เพิ่มเงินในลิ้นชัก", "Create an authorized credit sale and verify its AR ledger balance without adding drawer cash."),
      bi("รับชำระหนี้ภายหลังและตรวจใบแจ้งยอดภายในจาก ledger รวมวันครบกำหนดและยอดคงเหลือ", "Collect later and review the internal ledger-backed statement, due date and remaining balance."),
    ],
    check: bi("ยอดรับเงินจริง ยอดค้าง และบิลต้นทางกระทบกันได้ รวมกรณีคืนบางส่วน", "Collected money, outstanding balance and source bill reconcile, including partial returns."),
    caution: bi("Open-item ใช้ขายเงินสดอย่างเดียว ไม่ใช่ทางลัดสำหรับของที่ต้องตัดสต็อก ขายเชื่อ หรืออ้างอิงคืน", "Open-item is cash-only, never a shortcut for stock-tracked goods, credit or referenced returns."),
  },
  {
    slug: "building-materials-purchase-delivery", title: bi("PO รับบางส่วน ส่งมอบ คืนบางส่วน และ VAT", "Partial PO receiving, delivery, returns and VAT"),
    summary: bi("ตรวจ movement และเอกสารจากธุรกรรมจริง พร้อมระบุขอบเขตการส่งของที่ยังเป็นทั้งบิล", "Verify movements and transaction evidence; current delivery is still whole-order."),
    category: "daily", roles: ["owner", "manager"], tracks: [...track], menu: bi("Purchase → Orders → Returns / Tax", "Purchase → Orders → Returns / Tax"), action: "/admin/purchase",
    prerequisite: bi("PO หน่วย supplier/หน่วยฐานที่ตรวจแล้ว บิลขาย ที่อยู่หน้างาน และผู้รับผิดชอบภาษี", "PO with verified supplier/base units, original sale, site address and tax reviewer."),
    steps: [
      bi("สร้าง PO และรับของบางส่วนตามจำนวนจริง หากผู้ขายส่งเป็นแพ็ก ให้ตรึงจำนวนแพ็ก ตัวคูณหน่วยฐาน หลักฐาน และต้นทุนต่อหน่วยฐานบน PO แล้วกรอกจำนวนแพ็กที่รับจริง ตรวจ lot ต้นทุนและ stock movement", "Create a PO and receive only actual quantities. For supplier packages, freeze package count, base-unit factor, source and explicit base-unit cost on the PO, then enter actual packages received; inspect lot, cost and stock movement."),
      bi("สร้างออร์เดอร์และกำหนดส่งมอบหรือรับที่สาขาตาม workflow ที่มี พร้อมตรวจค่าส่งก่อนยืนยัน", "Create an order and use supported delivery or branch-pickup flow, reviewing freight before confirmation."),
      bi("คืนบางส่วนจากบิลเดิม ให้พนักงานตรวจ lot/serial สภาพสินค้า เงินคืน และยอดสต็อก", "Process a partial return against the original bill; staff review lot/serial, condition, refund and stock."),
      bi("ตรวจ VAT จากบิลและเอกสารที่ออกจริง รวมผลของการคืนหรือยกเลิกกับผู้รับผิดชอบภาษี", "Review VAT on issued bills and documents, including returns and cancellations, with the tax reviewer."),
    ],
    check: bi("จำนวนรับ/ขาย/คืนมี movement ที่ย้อนกลับได้และไม่ทำซ้ำเมื่อกดคำขอเดิม", "Received, sold and returned quantities have traceable movements and a retry causes no duplicate."),
    caution: bi("หน่วย supplier ต้องพิสูจน์ใน pilot; Admin ให้เลือกสาขาที่มีสิทธิ์และ server ตรวจซ้ำ ส่งบิลเดียวหลายเที่ยว คืนผู้ขาย รถ/คนขับ/หลักฐานส่งมอบครบ และ AP จับคู่ PO-ใบกำกับ-จ่ายยังไม่ครบ อย่าใช้ค่าใช้จ่ายแทนเจ้าหนี้", "Supplier-unit conversion needs pilot proof. Admin selects an allowed receiving branch and the server rechecks access. Multi-trip shipping, supplier returns, full vehicle/driver/POD and AP three-way match are incomplete; expenses are not payables."),
  },
  {
    slug: "building-materials-chat-web", title: bi("แชท/เว็บและขอบเขต AI", "Chat, web and AI boundaries"),
    summary: bi("เผยแพร่เฉพาะข้อเท็จจริงที่ตรวจแล้ว และส่งงานอนุมัติให้พนักงาน", "Publish verified facts only and route approvals to authorized staff."),
    category: "growth", roles: ["owner", "manager"], tracks: [...track], menu: bi("Channels → Products → AI assistant", "Channels → Products → AI assistant"), action: "/admin/assistant",
    prerequisite: bi("ช่องทางที่เชื่อมจริง สินค้าที่เผยแพร่ ราคา/สต็อก/หน่วย/สเปกที่ตรวจแล้ว และผู้รับช่วงงาน", "Connected channels, published products, verified prices/stock/units/specs and staff handoff."),
    steps: [
      bi("ตรวจว่าช่องทางเว็บหรือแชทเปิดจริงและแสดงเฉพาะ SKU/ราคา/หน่วยที่เผยแพร่", "Verify the web or chat channel is enabled and shows only published SKUs, prices and units."),
      bi("ลองถามราคา สต็อก และสเปกที่มีแหล่งอ้างอิง; ค่าที่ไม่ทราบต้องตอบว่าไม่ทราบ", "Ask about sourced prices, stock and specs; an unknown fact must remain unknown."),
      bi("ให้พนักงานที่มีสิทธิ์ยืนยันใบเสนอราคา เครดิต คืนเงิน การปรับสต็อก และค่าส่งก่อนตอบลูกค้า", "Require authorized staff to confirm quotations, credit, refunds, stock changes and freight before customer commitment."),
      bi("ทดสอบตะกร้าและ checkout ด้วยข้อมูลจาก server; สลิปที่อัปโหลดยังรอคนยืนยัน", "Rehearse cart and checkout with server facts; an uploaded slip still awaits human confirmation."),
    ],
    check: bi("AI ไม่เดาค่าส่ง เที่ยวรถยก สูตรเผื่อเศษ ความปลอดภัย หรือความเข้ากันได้", "AI does not guess freight, lifting trips, waste allowance, safety or compatibility."),
    caution: bi("สินค้าชั่งตามราคาต่อกิโลกรัมยังไม่ขายผ่านเว็บหรือ AI ลูกค้า และ provider/carrier ที่ไม่มีสัญญายังเป็น pilot", "Per-kilogram priced goods are not sold through web/customer AI; uncontracted providers and carriers remain pilots."),
  },
  {
    slug: "building-materials-rehearsal", title: bi("ซ้อมร้านวัสดุก่อสร้างก่อน pilot", "Rehearse a building-materials pilot"),
    summary: bi("ใช้ข้อมูลสมมติพิสูจน์ราคา สต็อก เงิน เครดิต สิทธิ์ และ retry พร้อมจดข้อจำกัด", "Use fictional data to prove prices, stock, money, credit, permissions and retries."),
    category: "recovery", roles: ["owner", "manager"], tracks: [...track], menu: bi("ร้านทดสอบ → POS / Quotations / Purchase / Reports", "Test shop → POS / Quotations / Purchase / Reports"), action: "/admin/pos-readiness",
    prerequisite: bi("ร้านทดสอบสองสาขา พนักงานหลายสิทธิ์ เครื่องชั่งทดสอบ และข้อมูลสินค้าสมมติ", "A two-branch test shop, distinct staff roles, test scale and fictional products."),
    steps: [
      bi("สร้างข้อมูลสมมติปูนถุง/พาเลท สีสองขนาด เครื่องมือ serial และทรายชั่ง พร้อมแหล่งสเปก", "Create fictional bag/pallet cement, two paint sizes, a serialized tool and weighed sand with spec sources."),
      bi("สร้างใบเสนอราคา แก้ revision อนุมัติ ยอมรับ แปลงเป็นออร์เดอร์ แล้วลองกรณีหมดอายุและสต็อกไม่พอ", "Draft, revise, approve, accept and convert a quote; also try expiry and insufficient stock."),
      bi("ลองขายเชื่อ รับชำระ PO รับบางส่วน คืนบางส่วน และตรวจ VAT/AR/stock movement กับบิลต้นทาง", "Rehearse credit, collection, partial PO receipt and partial return; reconcile VAT, AR and movements to source bills."),
      bi("ลองสิทธิ์ไม่พอ ข้ามสาขา กดซ้ำ เน็ตหลุด และฮาร์ดแวร์จริง แล้วบันทึกผลที่ยังต้องแก้", "Test denial, cross-branch access, retries, network loss and real hardware, and record remaining gaps."),
    ],
    check: bi("ผลสมมติและผลจริงกระทบยอดได้; ไม่มีบิล เงิน หรือ movement ซ้ำ และผู้ไม่มีสิทธิ์ทำไม่ได้", "Expected and actual fictional results reconcile; no duplicate bill, money or movement, and denied roles cannot act."),
    caution: bi("คู่มือนี้ยังเป็น pilot: งานตัดจากม้วน ส่งหลายเที่ยว AP และ VAT ก่อนภาษีทุกช่องทางต้องมีระบบ/การตรวจเพิ่มก่อนใช้จริง", "This guide remains a pilot: roll cutting, multi-trip delivery, AP and VAT-exclusive all-channel pricing need further implementation and review."),
  },
];

export const buildingMaterialsLessons: Lesson[] = authoredLessons.map((lesson) => ({ ...lesson, reviewedAt: "2026-11-19" }));
