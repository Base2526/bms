import type { TrackId } from "./catalog";

export type BusinessTrackId = Exclude<TrackId, "inventory">;
export type GuideLang = "th" | "en";
export type GuideCopy = Record<GuideLang, string>;
export type GuideTone = "green" | "orange" | "red" | "purple";

export type BusinessFlowNode = {
  target: string;
  icon: string;
  title: GuideCopy;
  description: GuideCopy;
  narration: GuideCopy;
  tone?: GuideTone;
  ai?: "customer" | "owner";
};

export type BusinessGuideConfig = {
  eyebrow: string;
  heading: GuideCopy;
  description: GuideCopy;
  flowTitle: GuideCopy;
  flowNote: GuideCopy;
  lanes: BusinessFlowNode[][];
  customer: {
    title: GuideCopy;
    question: GuideCopy;
    answer: GuideCopy;
    capabilities: Record<GuideLang, string[]>;
    limit: GuideCopy;
    focusTarget: string;
  };
  owner: {
    title: GuideCopy;
    question: GuideCopy;
    metrics: Record<GuideLang, { label: string; value: string }[]>;
    analyses: Record<GuideLang, string[]>;
    limit: GuideCopy;
    focusTarget: string;
    formats: string[];
  };
  authority: Record<GuideLang, string[]>;
  architecture: Record<GuideLang, string[]>;
  guideSlug: string;
};

const bi = (th: string, en: string): GuideCopy => ({ th, en });
const node = (
  target: string, icon: string, title: GuideCopy, description: GuideCopy, narration: GuideCopy,
  options: Pick<BusinessFlowNode, "tone" | "ai"> = {},
): BusinessFlowNode => ({ target, icon, title, description, narration, ...options });

export const businessGuideFlows: Record<BusinessTrackId, BusinessGuideConfig> = {
  retail: {
    eyebrow: "AI · RETAIL",
    heading: bi("ตั้งแต่สแกนสินค้าไปจนถึงรายงานเจ้าของร้าน", "From product scan to the owner's report"),
    description: bi("ดูงานขายหน้าร้าน ออนไลน์ คืนสินค้า และจุดที่ AI ใช้ข้อมูลที่ตรวจสอบแล้ว", "Follow counter sales, online orders, returns and where AI uses verified data."),
    flowTitle: bi("Flow ร้านค้าปลีกและค้าส่ง", "Retail & wholesale flow"),
    flowNote: bi("บิล การชำระเงิน สต็อก และการคืนสินค้ายึดข้อมูลจากระบบจริง ไม่ใช่ข้อความที่ AI คาดเดา", "Bills, payments, stock and returns use authoritative system records, never AI guesses."),
    lanes: [
      [
        node("catalog", "◆", bi("สินค้า / บาร์โค้ด", "Product / barcode"), bi("ชิ้น แพ็ก รุ่น สี ไซซ์", "Unit, pack and variant"), bi("เริ่มจากสินค้า เอสเคยู หน่วยขาย แพ็ก ตัวเลือก และบาร์โค้ดที่ใช้ร่วมกันทุกช่องทาง" , "Start with shared products, SKUs, selling units, packs, variants and barcodes.")),
        node("shift", "▣", bi("เปิดกะ", "Open shift"), bi("พนักงานและเครื่อง POS", "Cashier and register"), bi("พนักงานเปิดกะที่เครื่องที่ได้รับอนุญาต เพื่อให้เงินสด บิล และผู้รับผิดชอบตรวจสอบย้อนกลับได้", "The cashier opens an authorized register shift so cash, bills and responsibility remain traceable.")),
        node("scan", "▥", bi("สแกนและขาย", "Scan & sell"), bi("ราคาจริงและหน่วยที่เลือก", "Resolved price and unit"), bi("เมื่อสแกน ระบบเลือกสินค้า หน่วย ราคา ภาษี และสาขาจากข้อมูลจริงก่อนเพิ่มลงบิล", "A scan resolves the product, unit, price, tax and branch from system data before adding it to the bill.")),
        node("promotion", "◇", bi("โปรโมชัน / สมาชิก", "Promotion / member"), bi("กติกาที่ผ่านการตรวจ", "Validated rules"), bi("ส่วนลด โปรโมชัน สมาชิกและแต้มถูกคำนวณตามกติกาหลังบ้าน การลดราคาเองยังต้องใช้สิทธิ์ที่กำหนด", "Discounts, promotions, memberships and points follow backend rules; manual discounts still require permission."), { tone: "purple" }),
        node("payment", "▰", bi("ชำระเงิน", "Payment"), bi("ตรวจยอดและวิธีรับเงิน", "Amount and tender"), bi("การชำระเงินตรวจยอด วิธีรับเงิน และกะที่รับผิดชอบก่อนยืนยันการขาย", "Payment verifies the amount, tender and responsible shift before the sale is confirmed.")),
        node("receipt", "✓", bi("ใบเสร็จ / ตัดสต็อก", "Receipt / stock"), bi("ธุรกรรมเดียวกัน", "One transaction"), bi("เมื่อขายสำเร็จ ระบบออกหลักฐานและตัดสต็อกพร้อมบันทึกรายการเคลื่อนไหวในธุรกรรมเดียวกัน", "A completed sale records its evidence, stock deduction and movement in one transaction."), { tone: "green" }),
      ],
      [
        node("customer", "●", bi("ออร์เดอร์ออนไลน์", "Online order"), bi("LINE OA / Social / Web", "LINE OA / Social / Web"), bi("ช่องทางที่เชื่อมต่อและเปิดอยู่ให้ลูกค้าถามสินค้า ราคา และสถานะออร์เดอร์ได้ โดย AI เห็นเฉพาะข้อมูลที่อนุญาต", "Connected, enabled channels let customers ask about products, prices and order status; AI sees only approved data."), { ai: "customer" }),
        node("reserve", "⬢", bi("จองสินค้า", "Reserve stock"), bi("ถือของให้บิลที่สั่ง", "Held by the order"), bi("ออร์เดอร์ที่ผ่านขั้นตอนจะจองสินค้าให้บิลนั้น เพื่อลดความเสี่ยงการขายชิ้นเดียวกันซ้ำ", "An eligible order reserves stock for its bill to reduce duplicate selling.")),
        node("fulfillment", "▰", bi("จัดส่ง / รับสินค้า", "Ship / pickup"), bi("ติดตามสถานะจริง", "Verified status"), bi("สถานะจัดเตรียม จัดส่ง หรือรับสินค้ามาจากงานของพนักงานและระบบขนส่งที่รองรับ", "Preparation, shipment and pickup statuses come from staff actions and supported delivery records."), { tone: "orange" }),
      ],
      [
        node("return", "↶", bi("คืนสินค้า", "Return"), bi("อ้างอิงบิลเดิม", "Original bill"), bi("การคืนเริ่มจากบิลเดิมและรายการที่ขายจริง ไม่สร้างยอดคืนจากความจำหรือข้อความแชต", "A return starts from the original bill and sold lines, never memory or chat text."), { tone: "red" }),
        node("evidence", "▤", bi("ตรวจหลักฐาน", "Review evidence"), bi("สินค้า เหตุผล และผู้อนุมัติ", "Item, reason and approver"), bi("ระบบตรวจสินค้า จำนวน เหตุผล หลักฐาน และผู้มีสิทธิ์ก่อนรับคืนหรือคืนเงิน", "The system checks the item, quantity, reason, evidence and authorized approver before a return or refund."), { tone: "red" }),
        node("owner", "▥", bi("คืนเงิน / รายงาน", "Refund / report"), bi("ตรวจสอบย้อนหลังได้", "Auditable result"), bi("แอดมินที่มีสิทธิ์สามารถให้เอไอเปรียบเทียบยอดขายตามวัน สัปดาห์ เดือน สาขา ช่องทาง และช่วงเวลา วิเคราะห์สินค้าขายดี ขายช้า กำไรขั้นต้นเมื่อข้อมูลต้นทุนครบ สินค้าที่คืนบ่อย สต็อกเสี่ยงหมด ลูกค้าซื้อซ้ำ และผลของโปรโมชัน เอไอช่วยชี้ความผิดปกติ เช่น ส่วนลด คืนสินค้า หรือยอดเงินสดคลาดเคลื่อน พร้อมอธิบายหลักฐาน เสนอแผนเติมสินค้าหรือสิ่งที่ควรตรวจ และส่งออกรายงาน เอ็กเซล ซีเอสวี หรือพีดีเอฟได้ แต่การคืนเงิน เปลี่ยนราคา สั่งซื้อ โอน หรือปรับสต็อก ต้องให้ผู้มีสิทธิ์ตรวจและยืนยัน", "Authorized admins can ask AI to compare sales by day, week, month, branch, channel and time; analyze top and slow products, gross profit when cost data is complete, frequent returns, stockout risk, repeat customers and promotion results; flag unusual discounts, returns or cash variance; explain evidence, recommend what to review, and export XLSX, CSV or PDF. Refunds, price changes, purchasing, transfers and stock adjustments still require authorized human confirmation."), { ai: "owner" }),
      ],
    ],
    customer: {
      title: bi("ลูกค้าทักผ่านช่องทางที่ร้านเปิด", "Customers message an enabled shop channel"),
      question: bi("Runner X ไซซ์ 42 ที่สาขาใกล้ฉันมีไหม?", "Is Runner X size 42 available at a nearby branch?"),
      answer: bi("AI ตรวจสินค้า ตัวเลือก ราคา สาขา และยอดที่อนุญาตก่อนตอบ หากข้อมูลไม่ครบจะถามเพิ่มหรือส่งต่อพนักงาน", "AI verifies the product, variant, price, branch and customer-safe availability before answering; missing facts lead to clarification or staff handoff."),
      capabilities: { th: ["ตรวจสินค้าและราคาที่เผยแพร่", "ค้นหาตัวเลือกและสินค้าทดแทน", "ติดตามสถานะออร์เดอร์", "สร้างออร์เดอร์หลังลูกค้ายืนยัน"], en: ["Check published products and prices", "Find variants and verified alternatives", "Track order status", "Create an order after confirmation"] },
      limit: bi("ลูกค้าไม่เห็นยอดขาย รายงาน ต้นทุน หรือข้อมูลหลังบ้าน", "Customers never see sales totals, reports, costs or back-office data."),
      focusTarget: "customer",
    },
    owner: {
      title: bi("เจ้าของถามผู้ช่วย AI หลังบ้าน", "Owners ask the back-office AI assistant"),
      question: bi("เดือนนี้สินค้าตัวไหนขายดีที่สุด ยอดเท่าไร และตัวไหนเสี่ยงหมด?", "Which product sold best this month, what were sales, and what is at risk of stocking out?"),
      metrics: { th: [{ label: "ยอดขาย", value: "ตามช่วงที่เลือก" }, { label: "ขายดีที่สุด", value: "ตามสาขา" }, { label: "เสี่ยงของหมด", value: "จากยอดจริง" }], en: [{ label: "Sales", value: "Selected period" }, { label: "Top seller", value: "By branch" }, { label: "Stockout risk", value: "Verified balance" }] },
      analyses: { th: ["เปรียบเทียบยอดตามสาขา ช่องทาง และช่วงเวลา", "หาสินค้าขายดี ขายช้า กำไร และสินค้าคืนบ่อย", "วิเคราะห์สต็อกเสี่ยงหมด ลูกค้าซื้อซ้ำ และผลโปรโมชัน", "ตรวจส่วนลด คืนสินค้า และเงินสดที่ผิดปกติ"], en: ["Compare sales by branch, channel and time", "Find top, slow, profitable and frequently returned products", "Analyze stockout risk, repeat customers and promotion results", "Review unusual discounts, returns and cash variance"] },
      limit: bi("AI สรุปและสร้างไฟล์ได้ แต่การคืนเงิน เปลี่ยนราคา หรือปรับสต็อกต้องให้คนที่มีสิทธิ์ยืนยัน", "AI can summarize and create files; refunds, price changes and stock adjustments require authorized human confirmation."),
      focusTarget: "owner", formats: ["XLSX", "CSV", "PDF"],
    },
    authority: { th: ["ยอดขายและสต็อกมาจากข้อมูลที่ระบบตรวจสอบแล้ว", "ส่วนลด คืนเงิน และปรับสต็อกต้องตรวจสิทธิ์และยืนยัน", "AI ไม่ยืนยันการชำระเงินแทนพนักงาน"], en: ["Sales and stock come from verified system data", "Discounts, refunds and stock adjustments require permission and confirmation", "AI never confirms payment for staff"] },
    architecture: { th: ["ช่องทางที่เปิด", "AI ของ BMS", "เครื่องมือที่อนุญาต", "ข้อมูลที่ตรวจสอบแล้ว"], en: ["Enabled channel", "BMS AI", "Approved tool", "Verified data"] },
    guideSlug: "reports-ai",
  },
  "board-game": {
    eyebrow: "AI · BOARD GAME",
    heading: bi("ตั้งแต่จองโต๊ะไปจนถึงปิดกลุ่มบิล", "From booking to billing-group settlement"),
    description: bi("ดูการจอง เซสชัน กลุ่มบิล คลังเกม แพ็กเกจ และรายงานโดยไม่ปนกัน", "Follow bookings, sessions, billing groups, game library, passes and reports without mixing their authority."),
    flowTitle: bi("Flow ร้านบอร์ดเกม", "Board-game cafe flow"),
    flowNote: bi("กลุ่มบิลเป็นเจ้าของเงิน เซสชันเป็นเจ้าของโต๊ะ และกล่องเกมให้ยืมไม่ใช่สต็อกสินค้าขาย", "The billing group owns money, the session owns seating, and library copies are not sellable stock."),
    lanes: [
      [
        node("customer", "▣", bi("Walk-in / จองโต๊ะ", "Walk-in / booking"), bi("ลูกค้า เวลา และจำนวนคน", "Guest, time and party"), bi("ลูกค้า Walk-in หรือส่งคำขอจองผ่านช่องทางที่ร้านเปิด โดยระบบตรวจสาขา เวลา จำนวนคน และนโยบายก่อน", "Guests walk in or request a booking through an enabled channel; branch, time, party and policy are checked first."), { ai: "customer" }),
        node("availability", "○", bi("ตรวจโต๊ะว่าง", "Check availability"), bi("ตามพื้นที่และความจุ", "Area and capacity"), bi("ระบบตรวจความจุและสถานะที่เผยแพร่ โดยไม่เปิดเผยหมายเลขโต๊ะ ผู้ใช้งาน หรือข้อมูลลูกค้าคนอื่น", "The system checks published capacity and state without exposing table numbers, occupants or other customer data.")),
        node("session", "◷", bi("เริ่มเซสชัน", "Start session"), bi("นั่งโต๊ะและเริ่มเวลา", "Seat and start time"), bi("พนักงานที่มีสิทธิ์เช็กอิน เปิดเซสชัน และเริ่มจับเวลาตามกติกาที่บันทึกไว้", "Authorized staff check in the party, open the session and start time under the recorded rules."), { tone: "purple" }),
        node("tab", "▰", bi("สั่งอาหาร / ยืมเกม", "Order / borrow game"), bi("แยกสินค้าและกล่องให้ยืม", "Goods and copies stay separate"), bi("อาหารและสินค้าถูกเพิ่มในแท็บของกลุ่มบิล ส่วนกล่องเกมถูกยืมในคลังเกมและไม่ลดสต็อกสินค้าขาย", "Food and goods go to the billing group's tab; borrowed library copies do not reduce sellable stock.")),
        node("close", "✓", bi("ปิดกลุ่มบิล", "Close billing group"), bi("คิดเวลา แท็บ และชำระเงิน", "Time, tab and payment"), bi("เมื่อปิดกลุ่ม ระบบตรึงค่าเวลาและรวมแท็บของกลุ่มนั้น กลุ่มอื่นอาจเล่นต่อได้จนกว่าจะปิดของตน", "Closing a group freezes its time charge and tab; other groups may continue until they close."), { tone: "green" }),
      ],
      [
        node("library", "◆", bi("คลังเกม / กล่อง QR", "Library / copy QR"), bi("สำเนาและสภาพกล่อง", "Copy and condition"), bi("แต่ละกล่องมีตัวตนและสถานะของตัวเอง ใช้คิวอาร์เพื่อตรวจยืม คืน และสภาพล่าสุด", "Each copy has its own identity and state; QR supports checkout, return and condition tracking.")),
        node("borrow", "◇", bi("ยืมเกม", "Borrow game"), bi("ผูกกับเซสชัน", "Linked to the session"), bi("การยืมผูกกล่องจริงกับเซสชัน เพื่อให้รู้ว่าอยู่โต๊ะใดโดยไม่ถือว่าเป็นการขาย", "A loan links the physical copy to the session so staff know where it is without treating it as a sale."), { tone: "purple" }),
        node("return", "▣", bi("คืนเกม / ตรวจชิ้นส่วน", "Return / inspect"), bi("ภาพและหมายเหตุ", "Photos and notes"), bi("ก่อนปิดกลุ่มสุดท้าย พนักงานคืนเกม ตรวจสภาพและชิ้นส่วน แล้วบันทึกหลักฐานเมื่อมีความเสียหาย", "Before the last group closes, staff return copies, inspect condition and pieces, and record evidence for damage.")),
        node("damage", "!", bi("ชิ้นส่วนหาย / เสียหาย", "Missing / damaged"), bi("บันทึกตามหลักฐาน", "Evidence-based record"), bi("ของหายหรือเสียหายเป็นเหตุการณ์ของกล่องเกมและต้องมีหลักฐาน ไม่ปรับยอดสินค้าโดยอัตโนมัติ", "Missing or damaged pieces are copy events requiring evidence; they do not automatically adjust merchandise stock."), { tone: "red" }),
      ],
      [
        node("pass", "♛", bi("แพ็กเกจเวลา", "Time pass"), bi("สิทธิ์ของสมาชิก", "Customer entitlement"), bi("แพ็กเกจเวลาเป็นสิทธิ์ของลูกค้า ไม่ใช่เอสเคยูสินค้า และการใช้สิทธิ์ผูกกับกลุ่มบิลที่ตรวจสอบได้", "A time pass is a customer entitlement, not a product SKU, and redemption is tied to an auditable billing group."), { tone: "purple" }),
        node("owner", "▥", bi("วิเคราะห์ / รายงาน", "Analytics / report"), bi("สาขา พื้นที่ และช่วงเวลา", "Branch, area and period"), bi("แอดมินที่มีสิทธิ์สามารถให้เอไอวิเคราะห์ยอดขาย จำนวนบิล รายได้ต่อโต๊ะ อัตราการใช้โต๊ะตามช่วงเวลา ระยะเวลาเล่นเฉลี่ย คิว การจอง และโนโชว์ รวมถึงเกมที่ถูกยืมบ่อย ความเสียหาย แพ็กเกจเวลา และยอดอาหารเครื่องดื่ม โดยเปรียบเทียบตามสาขา พื้นที่ และช่วงเวลา เอไอช่วยชี้ช่วงที่โต๊ะไม่พอหรือว่างมาก ความผิดปกติของส่วนลดและการปิดกลุ่มบิล เสนอสิ่งที่ควรตรวจ และส่งออกรายงานได้ แต่การเปลี่ยนเวลา ส่วนลด การชำระเงิน หรือสถานะการจอง ต้องให้พนักงานที่มีสิทธิ์ยืนยัน", "Authorized admins can ask AI to analyze sales, bill count, revenue per table, utilization by time, average play duration, queues, bookings and no-shows, plus popular game loans, damage, time passes and food-and-drink sales by branch, area and period. AI can flag capacity gaps, unusual discounts or billing-group closures, recommend checks and export reports, while time, discounts, payments and booking status require authorized staff confirmation."), { ai: "owner" }),
      ],
    ],
    customer: {
      title: bi("ลูกค้าจองผ่าน LINE OA และช่องทางที่ร้านเปิด", "Customers request bookings through enabled channels"),
      question: bi("คืนนี้ 4 คน มีโต๊ะช่วงสองทุ่มไหม?", "Is there a table for four tonight at 8 PM?"),
      answer: bi("AI ตรวจสาขา เวลา จำนวนคน และนโยบาย แล้วสรุปให้ลูกค้ายืนยัน คำขออาจเป็น REQUESTED ไม่ใช่โต๊ะยืนยัน เว้นแต่นโยบาย Auto-confirm เข้าเงื่อนไข", "AI verifies branch, time, party and policy, then asks for confirmation. A request is not a confirmed table unless the configured auto-confirm policy qualifies."),
      capabilities: { th: ["ค้นหาสาขาและเวลาที่เผยแพร่", "สรุปคำขอให้ลูกค้ายืนยัน", "ตรวจสถานะการจองของลูกค้า", "ส่งคำขอช่วยเหลือให้พนักงาน"], en: ["Find published branches and times", "Summarize a request for confirmation", "Check the customer's booking status", "Send a staff-help request"] },
      limit: bi("AI ไม่เดาโต๊ะ ไม่เปิดเผยผู้เล่นคนอื่น และไม่เรียกคำขอว่าเป็นการจองยืนยัน", "AI never guesses a table, exposes other guests or calls a request a confirmed booking."), focusTarget: "customer",
    },
    owner: {
      title: bi("เจ้าของถามการใช้โต๊ะ เกม และรายได้", "Owners ask about tables, games and revenue"),
      question: bi("สัปดาห์นี้โต๊ะถูกใช้กี่เปอร์เซ็นต์ เกมใดถูกยืมมากที่สุด และคิวขาดนัดเท่าไร?", "What was table utilization this week, which game was borrowed most, and how many no-shows occurred?"),
      metrics: { th: [{ label: "การใช้โต๊ะ", value: "ตามช่วงเวลา" }, { label: "เกมยอดนิยม", value: "จากการยืม" }, { label: "คิว / No-show", value: "ตามสาขา" }], en: [{ label: "Utilization", value: "By period" }, { label: "Top game", value: "From loans" }, { label: "Queue / no-show", value: "By branch" }] },
      analyses: { th: ["ยอดขาย จำนวนบิล และรายได้ต่อโต๊ะ", "การใช้โต๊ะ ระยะเวลาเล่น คิว การจอง และ No-show", "เกมยอดนิยม ความเสียหาย และแพ็กเกจเวลา", "เปรียบเทียบสาขา พื้นที่ และช่วงเวลาที่โต๊ะไม่พอ"], en: ["Sales, bill count and revenue per table", "Utilization, play duration, queues, bookings and no-shows", "Popular games, damage and time passes", "Compare branches, areas and capacity gaps"] },
      limit: bi("AI อ่านข้อมูลตามสิทธิ์และช่วงที่ระบุ การเปลี่ยนเวลา ส่วนลด หรือการชำระเงินยังเป็นงานที่คนยืนยัน", "AI reads authorized, scoped data; time changes, discounts and payments still require human confirmation."), focusTarget: "owner", formats: ["XLSX"],
    },
    authority: { th: ["กลุ่มบิลเป็นเจ้าของเงิน ไม่ใช่โต๊ะ", "กล่องเกมให้ยืมไม่ใช่สต็อกสินค้า", "คำขอจองไม่เท่ากับการยืนยันโต๊ะ"], en: ["The billing group owns money, not the table", "Library copies are not sellable stock", "A booking request is not a confirmed table"] },
    architecture: { th: ["ช่องทางลูกค้า", "AI ตรวจนโยบาย", "การจอง / POS / คลังเกม", "ข้อมูลที่ตรวจสอบแล้ว"], en: ["Customer channel", "AI checks policy", "Booking / POS / library", "Verified data"] },
    guideSlug: "board-game-ai-owner",
  },
  restaurant: {
    eyebrow: "AI · RESTAURANT",
    heading: bi("ตั้งแต่รับออร์เดอร์ไปจนถึงครัวและปิดบิล", "From order intake to kitchen and settlement"),
    description: bi("แยกบิลโต๊ะ รอบส่งครัว ออร์เดอร์ออนไลน์ วัตถุดิบ และรายงานให้เห็นอำนาจแต่ละขั้น", "Separate table checks, kitchen rounds, online orders, ingredients and reporting authority."),
    flowTitle: bi("Flow ร้านอาหารและคาเฟ่", "Restaurant & cafe flow"),
    flowNote: bi("การชำระเงินไม่สร้างงานครัว ราคา Modifier มาจากระบบ และออร์เดอร์ออนไลน์ต้องระบุสาขากับวิธีรับสินค้า", "Payment does not create kitchen work, modifier prices are server-owned, and online orders require branch and fulfillment."),
    lanes: [
      [
        node("customer", "●", bi("ลูกค้า / โต๊ะ", "Guest / table"), bi("Walk-in หรือ QR", "Walk-in or QR"), bi("ลูกค้าเริ่มที่หน้าร้าน โต๊ะ หรือคิวอาร์ โดยคำขอจากลูกค้าต้องผ่านขั้นตอนที่ร้านกำหนด", "Guests start at the counter, table or QR; customer requests follow the shop's review workflow."), { ai: "customer" }),
        node("check", "▤", bi("เปิดบิล", "Open check"), bi("DINE_IN / TAKEAWAY", "DINE_IN / TAKEAWAY"), bi("พนักงานเปิดบิลตามรูปแบบบริการ สาขา โต๊ะและกลุ่มผู้ชำระที่ถูกต้อง", "Staff open the check with the correct service type, branch, table and billing group.")),
        node("modifier", "▥", bi("เลือกเมนู / Modifier", "Menu / modifier"), bi("ราคาและตัวเลือกจากระบบ", "Server-priced choices"), bi("เมนู ตัวเลือก และราคา Modifier ถูกตรวจโดยระบบ สูตรและข้อจำกัดไม่มาจากข้อความของ AI", "Menus, modifiers and prices are validated by the system; recipes and constraints do not come from AI text.")),
        node("kitchen", "▰", bi("ส่งรอบครัว", "Send kitchen round"), bi("ตรึงรายการที่ส่ง", "Freeze submitted lines"), bi("เมื่อพนักงานส่งรอบครัว ระบบตรึงรายการในรอบและสร้างงานครัว การจ่ายเงินอย่างเดียวไม่สร้างงานครัว", "Sending a kitchen round freezes its lines and creates kitchen work; payment alone does not create kitchen work."), { tone: "orange" }),
        node("ready", "✓", bi("พร้อมเสิร์ฟ", "Ready to serve"), bi("สถานีครัวอัปเดต", "Kitchen station update"), bi("ครัวอัปเดตสถานะตามสถานีเพื่อให้หน้าร้านรู้ว่ารายการใดกำลังทำหรือพร้อมเสิร์ฟ", "Kitchen stations update status so front of house knows what is preparing or ready."), { tone: "green" }),
        node("close", "▰", bi("ชำระ / ปิดบิล", "Pay / close"), bi("ยอดจริงและหลักฐาน", "Authoritative amount"), bi("การชำระและปิดบิลใช้ยอดที่ระบบคำนวณ พร้อมบันทึกเงิน สต็อก ภาษีและหลักฐานตามขั้นตอน", "Payment and settlement use the server-calculated amount and record money, stock, tax and evidence through the approved workflow."), { tone: "green" }),
      ],
      [
        node("online", "◆", bi("ออร์เดอร์ออนไลน์", "Online order"), bi("LINE OA / ช่องทางที่เชื่อมต่อ", "LINE OA / connected channel"), bi("AI รับคำสั่งจากช่องทางที่เปิด โดยใช้เมนูและข้อมูลสาขาที่ร้านเผยแพร่เท่านั้น", "AI handles requests on enabled channels using only the menu and branch facts the shop publishes.")),
        node("fulfillment", "▣", bi("ตรวจสาขา / วิธีรับ", "Branch / fulfillment"), bi("Delivery หรือ Pickup", "Delivery or pickup"), bi("ออร์เดอร์ร้านอาหารออนไลน์ต้องมีสาขาและเลือกเดลิเวอรีหรือรับเองอย่างชัดเจน ระบบไม่เดาแทนลูกค้า", "Online restaurant orders require an explicit branch and delivery or pickup choice; the system never guesses.")),
        node("incoming", "▤", bi("รับออร์เดอร์เข้า", "Accept incoming order"), bi("คนตรวจและรับงาน", "Human acceptance"), bi("พนักงานตรวจและรับออร์เดอร์ก่อนเข้าสู่การเตรียม การยืนยันการชำระไม่ใช่การรับงานครัว", "Staff review and accept the incoming order before preparation; payment confirmation is not kitchen acceptance.")),
        node("board", "▥", bi("Kitchen Board", "Kitchen Board"), bi("แยกสถานีและสถานะ", "Station and status"), bi("งานที่รับแล้วถูกแสดงบน Kitchen Board ตามสถานี โดยใช้สถานะจากการทำงานจริง", "Accepted work appears on Kitchen Board by station using actual operational status."), { tone: "orange" }),
      ],
      [
        node("ingredients", "◆", bi("วัตถุดิบ / สูตร", "Ingredients / recipe"), bi("สูตรและหน่วยจริง", "Reviewed recipe units"), bi("สูตรและวัตถุดิบที่ผ่านการตั้งค่าเป็นหลักฐานสำหรับการใช้สต็อกและต้นทุน", "Configured recipes and ingredients provide the evidence for stock usage and cost."), { tone: "purple" }),
        node("waste", "⬢", bi("ผลิต / ของเสีย", "Production / wastage"), bi("บันทึกเหตุผล", "Reasoned record"), bi("การผลิตและของเสียบันทึกจำนวนจริง หน่วย เหตุผล และผู้ทำรายการ ไม่ให้ AI ปรับยอดเอง", "Production and wastage record actual quantity, unit, reason and actor; AI does not adjust stock itself."), { tone: "green" }),
        node("owner", "▥", bi("ต้นทุนจริง / คุณภาพ", "Cost / quality"), bi("รายงานตามหลักฐาน", "Evidence-based report"), bi("แอดมินที่มีสิทธิ์สามารถให้เอไอเปรียบเทียบยอดขาย จำนวนบิล และยอดเฉลี่ยต่อบิลตามสาขา ช่วงเวลา และรูปแบบนั่งทาน ซื้อกลับ หรือเดลิเวอรี วิเคราะห์เมนูขายดี ขายช้า กำไรขั้นต้นและฟู้ดคอสต์เมื่อสูตรกับต้นทุนครบ ของเสีย ของหมด การยกเลิก และคืนเงิน หากมีข้อมูลเวลา เอไอช่วยหาคอขวดและเวลารอของสถานีครัว พร้อมสรุปลูกค้าซื้อซ้ำ ผลโปรโมชัน เสนอสิ่งที่ควรตรวจ และส่งออกรายงานได้ แต่การเปลี่ยนราคา สูตร สั่งซื้อ หรือปรับสต็อก ต้องให้ผู้มีสิทธิ์ยืนยัน", "Authorized admins can ask AI to compare sales, bill count and average ticket by branch, time and dine-in, takeaway or delivery; analyze top and slow menus, gross profit and food cost when recipe and cost evidence is complete, waste, sold-out items, cancellations and refunds. When timing data exists, AI can identify kitchen bottlenecks and wait time, summarize repeat customers and promotions, recommend checks and export reports. Price, recipe, purchasing and stock changes require authorized confirmation."), { ai: "owner", tone: "red" }),
      ],
    ],
    customer: {
      title: bi("ลูกค้าทักผ่านช่องทางที่ร้านเปิด", "Customers message an enabled restaurant channel"),
      question: bi("สาขานี้มีข้าวกะเพราและรับกลับได้ไหม?", "Does this branch have basil rice for pickup?"),
      answer: bi("AI ตรวจเมนูที่เผยแพร่ สถานะขาย สาขา และวิธีรับก่อนตอบ ข้อมูลสารก่อภูมิแพ้ที่ไม่ระบุจะตอบว่าไม่ทราบและส่งต่อร้าน", "AI verifies the published menu, availability, branch and fulfillment; missing allergen facts remain unknown and are handed to staff."),
      capabilities: { th: ["ตรวจเมนูและราคาที่เผยแพร่", "ตรวจสถานะขายปัจจุบัน", "ถามสาขาและวิธีรับที่ขาด", "สร้างออร์เดอร์หลังลูกค้ายืนยัน"], en: ["Check published menu and prices", "Check current sellability", "Ask for missing branch and fulfillment", "Create an order after confirmation"] },
      limit: bi("AI ไม่รับรองว่าปลอดสารก่อภูมิแพ้ และไม่เรียกคิวรอว่าเป็นโต๊ะยืนยัน", "AI never guarantees allergen safety or calls a waitlist request a confirmed table."), focusTarget: "customer",
    },
    owner: {
      title: bi("เจ้าของถามยอดขาย เมนู ต้นทุน และของเสีย", "Owners ask about sales, menus, cost and wastage"),
      question: bi("เดือนนี้เมนูใดขายดีที่สุด Food cost เท่าไร และของเสียมาจากอะไร?", "Which menu sold best this month, what was food cost, and what caused wastage?"),
      metrics: { th: [{ label: "ยอดขาย", value: "ตามช่วงที่เลือก" }, { label: "เมนูขายดี", value: "ตามสาขา" }, { label: "ต้นทุน / ของเสีย", value: "เมื่อหลักฐานครบ" }], en: [{ label: "Sales", value: "Selected period" }, { label: "Top menu", value: "By branch" }, { label: "Cost / waste", value: "When evidence is complete" }] },
      analyses: { th: ["ยอดขาย จำนวนบิล และยอดเฉลี่ยต่อบิล", "เมนูขายดี ขายช้า กำไร และ Food cost", "ของเสีย ของหมด ยกเลิก คืนเงิน และคอขวดครัว", "เปรียบเทียบ Dine-in, Takeaway และ Delivery"], en: ["Sales, bill count and average ticket", "Top and slow menus, margin and food cost", "Waste, sold-out items, cancellations, refunds and kitchen bottlenecks", "Compare dine-in, takeaway and delivery"] },
      limit: bi("AI สรุปและเสนอแนวทางจากข้อมูลที่ตรวจแล้ว การเปลี่ยนราคา สูตร สั่งซื้อ หรือปรับสต็อกต้องให้ผู้มีสิทธิ์ยืนยัน", "AI summarizes and advises from verified data; price, recipe, purchase and stock changes require authorized confirmation."), focusTarget: "owner", formats: ["XLSX", "CSV", "PDF"],
    },
    authority: { th: ["การชำระเงินไม่สร้างงานครัว", "ราคา Modifier มาจากระบบ", "ข้อมูลสารก่อภูมิแพ้ที่ไม่ระบุต้องคงเป็นไม่ทราบ"], en: ["Payment does not create kitchen work", "Modifier prices come from the system", "Missing allergen evidence remains unknown"] },
    architecture: { th: ["ช่องทางลูกค้า", "AI ตรวจข้อมูล", "POS / Kitchen / Stock", "ข้อมูลที่ตรวจสอบแล้ว"], en: ["Customer channel", "AI verifies facts", "POS / Kitchen / Stock", "Verified data"] },
    guideSlug: "reports-ai",
  },
  pharmacy: {
    eyebrow: "AI · PHARMACY",
    heading: bi("ตั้งแต่รับคำถามไปจนถึงเภสัชกรอนุมัติอย่างปลอดภัย", "From intake to licensed-pharmacist approval"),
    description: bi("เห็นขอบเขต Non-clinical intake, Product Policy, เภสัชกร, ล็อตและหลักฐานอย่างชัดเจน", "Make non-clinical intake, product policy, pharmacist authority, lots and evidence explicit."),
    flowTitle: bi("Flow ร้านขายยา", "Pharmacy flow"),
    flowNote: bi("AI ไม่วินิจฉัย ไม่แนะนำการรักษา และไม่อนุมัติเรื่องทางคลินิก ผู้ตัดสินใจคือเภสัชกรที่มีใบอนุญาต", "AI does not diagnose, recommend treatment or approve clinical decisions; a licensed pharmacist is the decision-maker."),
    lanes: [
      [
        node("customer", "●", bi("ลูกค้า / คำถาม", "Customer / question"), bi("หน้าร้านหรือช่องทางที่เปิด", "Counter or enabled channel"), bi("ลูกค้าเริ่มจากคำถามที่หน้าร้านหรือช่องทางที่ร้านเปิด AI รับได้เฉพาะข้อมูลเบื้องต้นที่ไม่ใช่การตัดสินใจทางคลินิก", "Customers ask at the counter or an enabled channel; AI may collect only non-clinical preliminary information."), { ai: "customer" }),
        node("emergency", "!", bi("คัดกรองเหตุฉุกเฉิน", "Emergency screen"), bi("ตรวจข้อความก่อนอ่านข้อมูลอื่น", "Before any other lookup"), bi("ระบบตรวจถ้อยคำฉุกเฉินจากข้อความดิบก่อนอ่านข้อมูลอื่น และใช้ข้อความส่งต่อที่กำหนดเมื่อเข้าเงื่อนไข", "The system checks raw wording for emergencies before any other lookup and uses the fixed handoff when triggered."), { tone: "red" }),
        node("intake", "▤", bi("Non-clinical intake", "Non-clinical intake"), bi("เก็บข้อมูลที่จำเป็น", "Minimum necessary details"), bi("AI ช่วยเก็บคำถามและข้อมูลที่จำเป็นโดยไม่วินิจฉัย ไม่เลือกยา และไม่สรุปว่าผู้ใช้เหมาะกับการรักษาใด", "AI collects the question and minimum necessary details without diagnosing, choosing medicine or deciding treatment suitability."), { tone: "purple" }),
        node("policy", "◆", bi("Product Policy", "Product policy"), bi("ตรวจข้อจำกัดสินค้าและช่องทาง", "Product and channel rules"), bi("ระบบตรวจนโยบายสินค้าและช่องทาง สินค้าที่ห้ามขายออนไลน์ต้องหยุดและส่งต่อ ไม่ใช้ AI ข้ามกฎ", "The system checks product and channel policy; online-prohibited products stop and hand off, and AI cannot bypass the rule.")),
        node("review", "⚕", bi("เภสัชกรทบทวน", "Pharmacist review"), bi("ใบอนุญาตและหลักฐาน", "Licence and evidence"), bi("เภสัชกรที่มีใบอนุญาตทบทวนคำถาม หลักฐานและข้อความแนวทาง ฉบับที่แก้ไขต้องกลับไปสถานะร่าง", "A licensed pharmacist reviews the question, evidence and guidance; edited approved guidance returns to draft.")),
        node("decision", "✓", bi("อนุมัติ / ปฏิเสธ", "Approve / refuse"), bi("การตัดสินใจโดยเภสัชกร", "Pharmacist decision"), bi("การอนุมัติหรือปฏิเสธทางคลินิกเป็นการตัดสินใจของเภสัชกร ไม่มีทางลัดสำหรับผู้ดูแลระบบหรือ AI", "Clinical approval or refusal belongs to the pharmacist; neither administrators nor AI have a shortcut."), { tone: "green" }),
        node("sale", "▰", bi("ขาย / เก็บหลักฐาน", "Sale / evidence"), bi("สิทธิ์ถูกใช้ครั้งเดียว", "Approval spent once"), bi("เมื่อขายตามเงื่อนไข ระบบผูกการอนุมัติกับรายการขายและเก็บหลักฐานตามสิทธิ์ การยกเลิกบิลไม่คืนสิทธิ์ที่ใช้แล้ว", "An eligible sale binds and spends its approval once and stores authorized evidence; bill cancellation does not restore it."), { tone: "green" }),
      ],
      [
        node("online", "▣", bi("ช่องทางออนไลน์", "Online channel"), bi("LINE OA / Social / Web", "LINE OA / Social / Web"), bi("ช่องทางออนไลน์รับคำถามและข้อมูลเบื้องต้นได้เมื่อเชื่อมต่อและเปิดใช้ แต่ไม่เปลี่ยนข้อจำกัดการขายยา", "Enabled online channels may receive questions and preliminary information but do not change medicine sale restrictions.")),
        node("prohibited", "⊘", bi("ห้ามขายออนไลน์?", "Online sale prohibited?"), bi("ตรวจตามสินค้าและช่องทาง", "Product and channel check"), bi("ถ้า Product Policy ระบุห้ามขายออนไลน์ ระบบต้องปฏิเสธเส้นทางขายและส่งต่อเภสัชกรหรือหน้าร้าน", "If product policy prohibits online sale, the system refuses that sales path and hands off to a pharmacist or counter."), { tone: "red" }),
        node("handoff", "⚕", bi("ส่งต่อเภสัชกร / หน้าร้าน", "Pharmacist / counter handoff"), bi("ไม่ตอบเกินข้อมูลที่อนุมัติ", "No unapproved clinical answer"), bi("คำถามทางคลินิกได้รับเฉพาะข้อความแนวทางที่เภสัชกรอนุมัติไว้ หรือข้อความส่งต่อแบบตายตัว", "Clinical questions receive only approved shop guidance or the fixed handoff wording.")),
      ],
      [
        node("lot", "◆", bi("ล็อต / วันหมดอายุ", "Lot / expiry"), bi("ติดตามต่อหน่วยที่เกี่ยวข้อง", "Identity-aware tracking"), bi("สินค้าที่ติดตามล็อตหรือวันหมดอายุเก็บตัวตนและหลักฐานเพื่อควบคุมการขายและการเรียกคืน", "Lot- or expiry-tracked goods retain identity and evidence for sale control and recall."), { tone: "orange" }),
        node("fefo", "▦", bi("FEFO / กักกัน", "FEFO / quarantine"), bi("แยกของไม่พร้อมขาย", "Separate non-sellable stock"), bi("ร้านใช้ FEFO และแยกของกักกันหรือไม่พร้อมขายออกจากยอดพร้อมจำหน่าย", "The shop uses FEFO and separates quarantined or non-sellable goods from available stock.")),
node("owner", "▥", bi("Audit / Evidence", "Audit / evidence"), bi("สิทธิ์และประวัติตรวจสอบ", "Permission and history"), bi("แอดมิน เภสัชกร และเจ้าของที่มีสิทธิ์ สามารถให้เอไอวิเคราะห์งานร้าน เช่น ยอดขายตามกลุ่มสินค้า สาขา และช่วงเวลา สต็อกตามล็อต วันหมดอายุ การหมุนแบบหมดอายุก่อนจ่ายก่อน ของกักกัน สินค้าคืน และผลต่างจากการตรวจนับ รวมถึงจำนวนและสถานะคิวที่รอเภสัชกร เอไอช่วยชี้ล็อตที่ควรตรวจ ความเสี่ยงของหมดหรือหมดอายุ สรุปหลักฐานตามสิทธิ์ และส่งออกรายงานได้ แต่เอไอไม่วินิจฉัย ไม่เลือกยา ไม่แนะนำการรักษา และไม่อนุมัติทางคลินิก การตัดสินใจทางคลินิกเป็นของเภสัชกรที่มีใบอนุญาตเท่านั้น", "Authorized admins, pharmacists and owners can ask AI to analyze shop operations such as sales by product group, branch and period; lot stock, expiry, FEFO rotation, quarantine, returns and count variance; and the number and status of cases awaiting pharmacist review. AI can flag lots to inspect, stockout or expiry risk, summarize permission-scoped evidence and export reports. It never diagnoses, chooses medicine, recommends treatment or grants clinical approval; only a licensed pharmacist makes clinical decisions."), { ai: "owner" }),
      ],
    ],
    customer: {
      title: bi("ลูกค้าทักผ่านช่องทางที่ร้านเปิด", "Customers message an enabled pharmacy channel"),
      question: bi("ยาตัวนี้ใช้กับอาการของฉันได้ไหม?", "Can I use this medicine for my symptoms?"),
      answer: bi("คำถามนี้ต้องให้เภสัชกรประเมิน AI ช่วยเก็บข้อมูลเบื้องต้นที่จำเป็นและส่งต่อได้ โดยไม่วินิจฉัยหรือแนะนำการรักษา", "This requires pharmacist assessment. AI can collect necessary preliminary information and hand off without diagnosing or recommending treatment."),
      capabilities: { th: ["แจ้งข้อมูลสาธารณะของร้านและสินค้า", "ตรวจสถานะคำสั่งซื้อ", "เก็บข้อมูลเบื้องต้นแบบไม่วินิจฉัย", "ส่งต่อเภสัชกรตามขั้นตอน"], en: ["Share public shop and product information", "Check order status", "Collect non-clinical preliminary details", "Hand off to a pharmacist"] },
      limit: bi("AI ไม่วินิจฉัย ไม่เลือกยา ไม่แนะนำการรักษา และไม่อนุมัติทางคลินิก", "AI does not diagnose, choose medicine, recommend treatment or grant clinical approval."), focusTarget: "customer",
    },
    owner: {
      title: bi("เภสัชกรและเจ้าของมีผู้ช่วย AI หลังบ้าน", "Pharmacists and owners use a scoped back-office assistant"),
      question: bi("สินค้ากลุ่มไหนขายดี ล็อตใดใกล้หมดอายุ และมีเคสรอเภสัชกรกี่รายการ?", "Which product group sells best, which lots are nearing expiry, and how many cases await pharmacist review?"),
      metrics: { th: [{ label: "ยอดขาย", value: "ตามช่วงและสิทธิ์" }, { label: "ใกล้หมดอายุ", value: "ตามล็อตจริง" }, { label: "รอเภสัชกร", value: "ตามคิวจริง" }], en: [{ label: "Sales", value: "Scoped period" }, { label: "Near expiry", value: "Verified lots" }, { label: "Awaiting pharmacist", value: "Verified queue" }] },
      analyses: { th: ["ยอดขายตามกลุ่มสินค้า สาขา และช่วงเวลา", "ล็อต วันหมดอายุ FEFO และของกักกัน", "สินค้าคืน ผลต่างตรวจนับ และความเสี่ยงของหมด", "จำนวนและสถานะคิวที่รอเภสัชกร"], en: ["Sales by product group, branch and period", "Lots, expiry, FEFO and quarantine", "Returns, count variance and stockout risk", "Count and status of cases awaiting pharmacist review"] },
      limit: bi("รายงานช่วยตัดสินใจด้านงานร้าน แต่ไม่ให้อำนาจทางคลินิกแก่เจ้าของหรือ AI", "Reports support shop operations but grant no clinical authority to owners or AI."), focusTarget: "owner", formats: ["XLSX", "CSV", "PDF"],
    },
    authority: { th: ["ตรวจถ้อยคำฉุกเฉินก่อนอ่านข้อมูลอื่น", "เภสัชกรที่มีใบอนุญาตเท่านั้นตัดสินใจทางคลินิก", "หลักฐานทางคลินิกอ่านได้ตามสิทธิ์เภสัชกร"], en: ["Check emergency wording before any other lookup", "Only a licensed pharmacist makes clinical decisions", "Clinical evidence is restricted to pharmacist permission"] },
    architecture: { th: ["ช่องทางลูกค้า", "AI รับข้อมูลแบบไม่วินิจฉัย", "Policy & Tools", "เภสัชกรยืนยัน", "ขาย / Evidence"], en: ["Customer channel", "Non-clinical AI intake", "Policy & tools", "Pharmacist decision", "Sale / evidence"] },
    guideSlug: "pharmacy-intake-queue",
  },
};

export type BusinessNarrationCue = { target: string; text: string };

export function businessNarrationCues(track: BusinessTrackId, lang: GuideLang): BusinessNarrationCue[] {
  const config = businessGuideFlows[track];
  return config.lanes.flatMap((lane) => lane.map((item) => ({ target: item.target, text: item.narration[lang] })));
}
