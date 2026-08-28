import type { AssistantLocale, LocalizedText } from "./types";

/**
 * Verified limits and traps — the rules that stop a confident wrong answer.
 *
 * These moved out of `/admin/manual`, where they were unreachable from chat: the assistant could
 * describe how to run a report but not that its profit figure applies today's cost to last
 * month's revenue, and could explain returns without knowing that cancel, return and refund are
 * three different things. A guide says what to do; these say what will bite.
 *
 * Same contract as the FAQ (faq.ts):
 * - `guideIds` must be real guides. A rule attached to nothing is a rule nobody reaches.
 * - `items` are payload and are NOT scored. Titles and aliases are the retrieval keys, so a
 *   long list of caveats cannot become a weak match for every question.
 * - The Manual renders this array, so a rule has one home rather than two that drift apart.
 */
export type SystemLimitGroup = Readonly<{
  id: string;
  guideIds: readonly string[];
  title: LocalizedText;
  items: Readonly<Record<AssistantLocale, readonly string[]>>;
  aliases: Readonly<Record<AssistantLocale, readonly string[]>>;
}>;

const both = (th: string, en: string): LocalizedText => ({ th, en });
const lists = (th: readonly string[], en: readonly string[]) => ({ th, en }) as const;

export const SYSTEM_LIMITS: readonly SystemLimitGroup[] = [
  {
    id: "limits.stock-invariant",
    guideIds: ["inventory.stock-sale-blockers", "inventory.reservation-owners"],
    title: both("สมการสต็อกและกฎการเคลื่อนไหว (Stock Invariant)", "The stock invariant and its movement types"),
    items: lists(
      [
        "สต็อกปัจจุบัน = สต็อกที่ขายได้ + สต็อกที่จองไว้ — สต็อกที่ขายได้ = สต็อกปัจจุบัน − สต็อกที่จองไว้",
        "กฎเหล็ก: การเปลี่ยนแปลงสต็อกทุกครั้งต้องมีรายการเคลื่อนไหว (Stock Movement) กำกับ ห้ามแก้ตัวเลขสต็อกตรง ๆ ไม่ว่าเหตุผลใด",
        "STOCK_IN / STOCK_OUT: เพิ่ม-ลดด้วยมือ หรือรับของจากใบสั่งซื้อ",
        "RESERVE / RELEASE: จองตอนสร้างออเดอร์ / ปล่อยตอนยกเลิกหรือปล่อยอัตโนมัติ",
        "SHIP: ตัดถาวร ลดทั้งสต็อกปัจจุบันและสต็อกที่จองไว้ · RETURN: คืนสินค้า เพิ่มสต็อกปัจจุบัน",
        "TRANSFER_OUT / TRANSFER_IN: โอนระหว่างสาขา ไม่กระทบมูลค่าสต็อกเหมือนของหาย",
        "COUNT_ADJUST: ปรับตามผลต่างจากการนับสต็อก · DAMAGED สงวนไว้สำหรับรายงานในอนาคต ยังใช้จริงไม่ได้",
        "SKU ต้องไม่ซ้ำ · บาร์โค้ดไม่ควรซ้ำในร้านเดียวกัน · ราคา/สต็อกติดลบไม่ได้ (ยกเว้นเปิด AllowNegativeStock) · POS ค้นสินค้ากรองตามสาขาของเครื่องเท่านั้น",
      ],
      [
        "Current stock = sellable stock + reserved stock — sellable stock = current stock − reserved stock",
        "Iron rule: every stock change must carry a Stock Movement record. Never edit the stock number directly, for any reason.",
        "STOCK_IN / STOCK_OUT: manual adjustment, or receiving a purchase order",
        "RESERVE / RELEASE: reserved when an order is created, released on cancel or an automatic release",
        "SHIP: a permanent cut — reduces both current and reserved stock · RETURN: a return, adds back to current stock",
        "TRANSFER_OUT / TRANSFER_IN: branch-to-branch transfer, kept separate so it never hits stock-value reports like shrinkage",
        "COUNT_ADJUST: applies the difference from a stock count · DAMAGED is reserved for a future report — not usable yet",
        "SKU must be unique · barcode should be unique within a shop · price/stock can never go negative (unless AllowNegativeStock is on) · POS search is scoped to the device's own branch",
      ]
    ),
    aliases: lists(["สมการสต็อก", "ประเภทการเคลื่อนไหวสต็อก", "ทำไมสต็อกไม่ตรง"], ["stock invariant", "stock movement types", "why stock does not add up"]),
  },
  {
    id: "limits.barcode-rules",
    guideIds: ["products.create", "catalog.print-labels"],
    title: both("กฎเรื่องบาร์โค้ด — ข้อที่ผิดกันบ่อยที่สุด", "Barcode rules — the most common mistake"),
    items: lists(
      [
        "สินค้ามีบาร์โค้ดโรงงานอยู่แล้ว: สแกนเข้ามาเท่านั้น ห้ามพิมพ์เองหรือกดสร้างรหัสใหม่ — ไม่งั้นสแกนขวดจริงแล้วระบบหาไม่เจอ",
        "สินค้าไม่มีบาร์โค้ด (แบ่งแพ็ก/ทำเอง/นำเข้า): ใช้ปุ่มสร้างรหัสได้",
        "รหัสที่สร้างเป็น EAN-13 ช่วง 20–29 ที่ GS1 สงวนไว้ พร้อมเลขตรวจสอบถูกต้อง เรียงลำดับ ไม่สุ่ม และข้ามเลขที่มีอยู่แล้ว",
        "ปุ่มสร้างไม่เขียนฐานข้อมูล — แค่เติมฟอร์ม ต้องกดบันทึกเอง",
        "รหัสรูปแบบอื่น (Code 128 ฯลฯ) ไม่ถูกบล็อก ระบบเตือนแต่ไม่ห้าม เพราะ POS ค้นแบบตรงตัวอักษร",
        "ความไม่ซ้ำเป็นระดับร้าน — ซ้ำข้ามร้านได้ แต่ซ้ำในร้านเดียวกันถูกปฏิเสธ",
      ],
      [
        "A product with a factory barcode: scan it in only. Never type one in or press generate — otherwise staff scan the real bottle and the system can't find it.",
        "A product with no barcode (split packs, house-made, imported): the generate button is fine here.",
        "Generated codes are EAN-13 in the 20–29 range GS1 reserves for in-store use, with a correct check digit, sequential (not random), skipping codes already printed.",
        "The generate button does not write to the database — it only fills the form. You still have to save.",
        "Other formats (Code 128, a factory-internal code) are not blocked — the system warns but doesn't stop you, because POS matches barcodes literally.",
        "Uniqueness is per shop — the same code can exist in two different shops, but not twice within one shop.",
      ]
    ),
    aliases: lists(["กฎบาร์โค้ด", "สแกนแล้วหาไม่เจอ", "สร้างบาร์โค้ดเองได้ไหม", "บาร์โค้ดซ้ำ"], ["barcode rules", "scanner cannot find the product", "generated barcode"]),
  },
  {
    id: "limits.action-center",
    guideIds: ["dashboard.daily-review"],
    title: both("บล็อกกระแสเงินสดจากสต็อก (Action Center)", "The stock cash-flow block (Action Center)"),
    items: lists(
      [
        "รวม 5 สัญญาณ: สินค้าใกล้หมด · หมดแล้ว · คาดว่าจะหมดใน 7 วัน · รายการที่ควรสั่งซื้อ · จำนวนที่แนะนำรวม",
        "คำนวณจาก: แนวโน้มความต้องการ · วันสต็อกสำรองที่ตั้งไว้ · ระยะเวลาสั่งของจากผู้ขาย · จำนวนที่ค้างในใบสั่งซื้อ · ยอดขายที่เสียไปที่บันทึกมือ · ลูกค้าที่รอของเข้า",
        "คำแนะนำไม่เคยสั่งซื้อเอง — ไม่มีการสร้าง/แก้ใบสั่งซื้ออัตโนมัติ พนักงานต้องตัดสินใจสั่งของทุกครั้ง",
      ],
      [
        "Rolls up 5 signals: low stock · out of stock · projected to run out in 7 days · suggested reorders · total suggested units",
        "Computed from: demand trend · the reserve-days setting · supplier lead time · quantity still on open purchase orders · manually logged lost sales · customers waiting on restock",
        "The suggestion never places an order by itself — no purchase order is created or edited automatically. A person decides every reorder.",
      ]
    ),
    aliases: lists(["Action Center คิดจากอะไร", "ของที่ควรสั่งซื้อ", "จำนวนที่แนะนำ"], ["action center signals", "suggested reorder quantity"]),
  },
  {
    id: "limits.estimated-numbers",
    guideIds: ["dashboard.data-freshness", "reports.create-export"],
    title: both("ตัวเลขที่อ่านผิดได้ — ต้องติดป้ายว่าเป็นค่าประมาณเสมอ", "Numbers that are easy to misread — always label these as estimates"),
    items: lists(
      [
        "ยอดออเดอร์ไม่รวมค่าส่ง — อ่านเป็นยอดที่ลูกค้าจ่ายจะต่ำกว่าจริงทุกครั้งที่มีค่าส่ง",
        "มูลค่าสต็อกคิดที่ราคาขาย ไม่ใช่ต้นทุน — ใช้เป็นมูลค่าทรัพย์สินหรือต้นทุนคงเหลือไม่ได้",
        "เวลาบนไทม์ไลน์คือเวลาที่สร้าง ไม่ใช่เวลาที่ถึงสถานะนั้น — ดูลำดับจริงจาก Audit Log",
        "ไทม์ไลน์แสดงได้ 200 แถวต่อแหล่ง — ลูกค้าที่มีกิจกรรมมากจะเห็นประวัติไม่ครบโดยไม่มีคำเตือน",
        "ปุ่มสลับ “แชทนี้เท่านั้น” กรองเฉพาะข้อมูลที่โหลดมาแล้ว ไม่ได้ดึงใหม่จากเซิร์ฟเวอร์",
        "เวลาตอบเฉลี่ยสูงเกินจริง — ไม่หักช่วงที่แชทค้างข้ามคืนก่อนลูกค้ากลับมา",
        "รายงานกำไรใช้ต้นทุนปัจจุบันกับรายได้ในอดีต — เป็นค่าประมาณ ไม่ใช่งบกำไรขาดทุนย้อนหลังที่แม่นยำ",
        "ต้องติดป้าย “ค่าประมาณ” เสมอ: คำแนะนำสั่งซื้อ · วันที่คาดว่าของจะหมด · ป้าย SLOW/DEAD · รายงานกำไร · มูลค่าสต็อก · คะแนนรักษาลูกค้า HOT/WARM/COOL · ข้อมูลเชิงลึกจาก AI · ใบแจ้งหนี้ที่ออกจากหน้าจอ",
      ],
      [
        "Order totals exclude shipping — reading them as \\\"what the customer paid\\\" undercounts every order that had a delivery fee.",
        "Stock value is priced at sale price, not cost — don't use it as an asset value or a cost of remaining inventory.",
        "A timeline entry's time is when the record was created, not when that status was reached — check the real order from the Audit Log.",
        "A timeline shows up to 200 rows per source — a very active customer can have missing history with no visible warning.",
        "The \\\"this chat only\\\" toggle filters what's already loaded — it does not fetch fresh data from the server.",
        "Average response time reads high because it doesn't subtract time a chat sat idle overnight.",
        "The profit report applies today's cost to past revenue — it's an estimate, not an accurate historical P&L.",
        "Always label as an estimate: reorder suggestions · projected stockout date · SLOW/DEAD tags · profit reports · stock value · retention HOT/WARM/COOL scores · AI-generated insights · invoices issued from the screen.",
      ]
    ),
    aliases: lists(["ตัวเลขไหนเป็นค่าประมาณ", "ยอดออเดอร์รวมค่าส่งไหม", "มูลค่าสต็อกคิดจากอะไร", "รายงานกำไรเชื่อได้แค่ไหน"], ["which numbers are estimates", "does the order total include shipping", "stock value basis"]),
  },
  {
    id: "limits.customer-data-care",
    guideIds: ["customers.customer-360", "customers.manage-address"],
    title: both("ข้อมูลลูกค้า — สิ่งที่ต้องระวังก่อนกด", "Customer data — think before you click"),
    items: lists(
      [
        "ไม่มีการรวมลูกค้าข้ามช่องทางอัตโนมัติ — ลูกค้าคนเดียวจากสองช่องทางเห็นเป็นสองรายการ ยอดซื้อสะสมผิดจนกว่าจะผสานด้วยมือ",
        "การผสานลูกค้าย้อนกลับไม่ได้ — รายการที่ถูกผสานถูกลบแบบซ่อนถาวร ตรวจให้แน่ใจก่อนกด",
        "แท็บ “ลูกค้า” ว่างเปล่าอาจแปลว่าไม่มีสิทธิ์ ไม่ใช่ลูกค้าใหม่ที่ยังไม่มีข้อมูล",
        "ข้อมูลทดสอบ (fake data) ไม่มีตัวตนช่องทางให้ผสาน",
        "ออเดอร์ Lazada/Shopee ยังไม่โผล่ใน Customer 360 — การอ่าน webhook ยังเป็นโครงร่างที่ยังไม่ได้ตรวจสอบ",
      ],
      [
        "Customers are never auto-merged across channels — the same person on two channels shows as two records, with lifetime spend wrong on both until merged by hand.",
        "Merging customers cannot be undone — the merged-away record is soft-deleted permanently. Double-check before confirming.",
        "An empty \\\"Customers\\\" tab can mean you lack the permission, not that there's genuinely no data yet.",
        "Fake seed data has no channel identity to merge — there's nothing for the merge tool to find.",
        "Lazada/Shopee orders don't show in Customer 360 yet — that webhook ingestion is still an unverified skeleton.",
      ]
    ),
    aliases: lists(["ผสานลูกค้าย้อนกลับได้ไหม", "ลูกค้าซ้ำสองรายการ", "ข้อมูลลูกค้าต้องระวังอะไร"], ["is a customer merge reversible", "duplicate customer records"]),
  },
  {
    id: "limits.stock-permission-traps",
    guideIds: ["inventory.stock-sale-blockers", "inventory.count"],
    title: both("สต็อกและสิทธิ์ — กับดักที่เจอบ่อย", "Stock and permissions — traps that keep coming up"),
    items: lists(
      [
        "หน้า 403 ไม่ขึ้นข้อความและไม่เตะออกจากระบบ — อาการคือหน้าว่างหรือดูเหมือนพัง มักเกิดเมื่อยังไม่ apply migration ที่ตั้งสิทธิ์นั้น",
        "สาขาที่สองที่ไม่ตั้งรหัสสาขาจะชนกับสำนักงานใหญ่ทันที — ต้องตั้งรหัสเองทุกสาขา",
        "กดยืนยันการนับสต็อกแล้วย้อนกลับจากหน้าจอไม่ได้ — เป็นการตัดสต็อกออกจริง ตัดสินใจเรื่องผู้ถือสิทธิ์ก่อนส่งหน้าจอให้พนักงาน",
        "ของเข้าคนละสาขาระหว่างรับผ่าน POS กับผ่าน Admin — POS ใช้สาขาของเครื่อง, Admin ใช้สาขาหลักของร้าน",
        "แถวสต็อกของชุดสินค้า (Bundle) เป็น 0 ตลอด — ถูกต้องแล้ว ไม่ใช่บั๊ก จำนวนที่ขายได้มาจากส่วนประกอบ",
        "ยอดล็อตกับยอดสต็อกอาจไม่ตรงกัน — กระทบยอดก่อนใช้ตัวเลขวันหมดอายุตัดสินใจ",
        "คำแนะนำสั่งซื้อพุ่งเกินจริงถ้าบันทึกความต้องการแบบเดา — บันทึกเฉพาะที่เห็นจากลูกค้าจริง (ลบไม่ได้)",
        "สร้างบาร์โค้ดให้สินค้าที่มีบาร์โค้ดโรงงานอยู่แล้ว — พนักงานจะสแกนของจริงแล้วหาไม่เจอ",
      ],
      [
        "A 403 shows no message and doesn't log you out — it just looks like a blank or broken page, usually because a migration that grants that permission hasn't been applied yet.",
        "A second branch with no branch code collides with head office immediately — set a code for every branch yourself.",
        "Confirming a stock count can't be undone from the screen — it's a real stock cut. Decide who holds that permission before handing the screen to staff.",
        "Receiving goods lands in a different branch depending on the path — POS uses the device's own branch, Admin uses the shop's main branch.",
        "A bundle's own stock row stays at 0 forever — that's correct, not a bug. Sellable quantity comes from its components.",
        "Lot totals and stock totals can drift apart — reconcile before using expiry-date numbers to decide anything.",
        "Reorder suggestions spike unrealistically if guessed demand gets logged — only log demand actually seen from a real customer (these rows can't be deleted).",
        "Generating a barcode for a product that already has a factory one means staff scan the real item and get nothing back.",
      ]
    ),
    aliases: lists(["กับดักสต็อกกับสิทธิ์", "สต็อกของชุดสินค้าเป็นศูนย์", "รับของเข้าคนละสาขา"], ["stock and permission traps", "bundle stock shows zero"]),
  },
  {
    id: "limits.not-supported-yet",
    guideIds: ["manual.find-instructions", "onboarding.getting-started"],
    title: both("ขอบเขตที่ยังไม่รองรับ — อย่าสัญญากับลูกค้าหรือทีมงาน", "Not supported yet — don't promise this to a customer or teammate"),
    items: lists(
      [
        "ตารางเวลาส่งสรุปยอดขายอัตโนมัติ ต้องตั้งก่อนไม่งั้นไม่มีอะไรถูกส่ง",
        "Webhook/ซิงก์อัตโนมัติจากขนส่ง — ต้องกดซิงก์เองจากหน้าจัดส่ง · ยกเลิกพัสดุกับขนส่งต้องติดต่อขนส่งโดยตรง",
        "ส่งข้อความออกจริงบน Web/TikTok/Shopee/Lazada — ตอบผ่านแพลตฟอร์มนั้นโดยตรง; LINE ใช้ OA Manager, ขายผ่าน Seller Center",
        "แจ้งเตือนแต้มใกล้หมดอายุ/เลื่อนระดับอัตโนมัติ — ใช้รายชื่อในหน้าแต้มสะสมแล้วติดต่อเอง",
        "ระบบตั๋วสนับสนุนลูกค้า/สร้างลิงก์ชำระเงิน — ใช้ Inbox และหน้าชำระเงินที่มีลายเซ็นแทน",
        "PDF ภาษาไทย — ใช้ XLSX/CSV แทน; รายงานแต้มสะสมดูบนหน้าจอเท่านั้น",
        "แม่แบบอีเมลรายร้าน ปรับได้เฉพาะสีธีมและข้อความท้ายอีเมล · กราฟยอดขายรายชั่วโมงบนจอสดมีแค่ข้อมูลรายวัน",
        "ผู้ชมสด/Conversion/คอมเมนต์บนจอสดยังไม่มีแหล่งข้อมูล ต้องคงป้าย “ตัวอย่าง” ไว้",
        "อัตราค่าส่งแยกรายขนส่ง · น้ำหนักตามปริมาตร · เขต/แขวงในที่อยู่ · API อัตราค่าส่งสด — ยังไม่รองรับ",
        "DAMAGED movement · บาร์โค้ดเครื่องชั่งเข้าเส้นทางขาย · โปรข้ามสินค้า (ซื้อ A แถม B) · AI ย้ายสต็อกข้ามสาขา · ชุดทดสอบอัตโนมัติที่ทำงานอยู่ — ทั้งหมดยังไม่พร้อมใช้งานจริง",
      ],
      [
        "The automatic sales-summary digest needs a schedule set first, or nothing gets sent.",
        "Webhook/auto-sync from carriers — sync manually from the Shipping page · cancelling a shipment with a carrier means contacting them directly.",
        "Sending messages out live on Web/TikTok/Shopee/Lazada — reply on that platform directly; LINE uses OA Manager, marketplaces use their Seller Center.",
        "Automatic loyalty-expiry or tier-upgrade notifications — use the customer list on the Loyalty page and reach out yourself.",
        "A customer support ticket system, or generating payment links outside the app — use Inbox and the signed checkout page instead.",
        "Thai-language PDF export — use XLSX/CSV instead; the loyalty report is view-only on screen.",
        "Per-shop email template editing is limited to theme color and the footer note · the live dashboard's sales chart is daily-only, not hourly.",
        "Live viewer count / conversion / comments on the live dashboard have no real data source yet — keep the \\\"sample\\\" label on them.",
        "Carrier-specific rate tables, volumetric weight, Thai sub-district address fields, live carrier-rate APIs — none of these are supported yet.",
        "DAMAGED movement type, scale-barcode decoding wired into the sale path, cross-product promotions (buy A get B), AI-driven cross-branch stock moves, a running automated test suite — none of these are production-ready yet.",
      ]
    ),
    aliases: lists(["อะไรที่ระบบยังทำไม่ได้", "ยังไม่รองรับอะไรบ้าง", "สัญญากับลูกค้าได้ไหม"], ["what is not supported yet", "do not promise this to a customer"]),
  },
  {
    id: "limits.order-shipment-states",
    guideIds: ["orders.follow-lifecycle", "shipping.create"],
    title: both("วงจรสถานะออเดอร์และใบจัดส่ง", "The order and shipment state machines"),
    items: lists(
      [
        "PENDING (จองสต็อกแล้ว) → PAID → PACKING → SHIPPED (ตัดสต็อกถาวร — จุดเดียวที่ตัดสต็อก) → COMPLETED (ไม่เปลี่ยนสต็อกอีก) · CANCELLED ปล่อยสต็อกที่จอง · RETURNED (จาก SHIPPED/COMPLETED) คืนสต็อกกลับ",
        "ไม่มีสถานะร่าง (Draft) — ออเดอร์ถูกสร้างที่ PENDING ทันทีพร้อมจองสต็อกไปแล้ว ทุกการเปลี่ยนสถานะเป็นทรานแซกชันเดียว กันขายเกินและตัดสต็อกซ้ำ",
        "ใบจัดส่ง: PENDING → SHIPPED → IN_TRANSIT → DELIVERED / RETURNED / CANCELLED — ขนส่งที่รองรับคือ FLASH · KERRY · DHL · AUSPOST · NZPOST · OTHER",
        "การซิงค์สถานะจากขนส่งไม่เคยถอยหลัง และไม่แตะสถานะสุดท้าย (DELIVERED / RETURNED / CANCELLED)",
        "ต้องมีที่อยู่ประเภท shipping ในลูกค้าก่อนเปลี่ยนจาก PACKING เป็น SHIPPED ได้ — บังคับระดับระบบไม่ใช่แค่ซ่อนปุ่ม ยกเว้น Lazada/Shopee เพราะที่อยู่อยู่ใน Seller Center",
        "ทุกการเปลี่ยนสถานะส่งอีเมลแจ้งลูกค้าแบบส่งแล้วปล่อย — อีเมลล่มไม่ย้อนหรือบล็อกการเปลี่ยนสถานะ ลูกค้าไม่มีอีเมลเป็นเรื่องปกติ ไม่ใช่ความล้มเหลว",
      ],
      [
        "PENDING (stock reserved) → PAID → PACKING → SHIPPED (a permanent stock cut — the only point stock is cut) → COMPLETED (stock never changes again) · CANCELLED releases the reservation · RETURNED (from SHIPPED/COMPLETED) adds stock back",
        "There is no Draft status — an order is created at PENDING immediately, already holding its reservation. Every status change is one transaction, which is what prevents overselling and double-cutting stock.",
        "Shipment: PENDING → SHIPPED → IN_TRANSIT → DELIVERED / RETURNED / CANCELLED — supported carriers are FLASH · KERRY · DHL · AUSPOST · NZPOST · OTHER",
        "A carrier status sync never moves a shipment backward, and never touches a final status (DELIVERED / RETURNED / CANCELLED)",
        "A customer needs a shipping-type address before an order can move from PACKING to SHIPPED — enforced at the system level, not just a hidden button, except Lazada/Shopee whose addresses live in their own Seller Center",
        "Every status change fires a fire-and-forget email — a mail outage never rolls back or blocks the status change. A customer with no email on file is normal, not a failure.",
      ]
    ),
    aliases: lists(["สถานะออเดอร์มีอะไรบ้าง", "ออเดอร์เปลี่ยนสถานะยังไง", "สถานะพัสดุ"], ["order status flow", "shipment states"]),
  },
  {
    id: "limits.cancel-return-refund",
    guideIds: ["orders.follow-lifecycle", "payments.review-payment"],
    title: both("ยกเลิก / คืนของ / คืนเงิน — สามอย่างที่ต่างกัน", "Cancel / return / refund — three different things"),
    items: lists(
      [
        "ยกเลิก (การขายที่ไม่เคยเกิดจริง): ออเดอร์ → CANCELLED, ปล่อยสต็อกที่จอง, คืนโควตาคูปองในทรานแซกชันเดียวกัน",
        "คืนสินค้า (จาก SHIPPED/COMPLETED): ออเดอร์ → RETURNED, คืนสต็อกกลับพร้อมล็อตต้นทางที่แน่นอน — ไม่คืนโควตาคูปอง เพราะธุรกรรมนั้นเกิดขึ้นจริงแล้ว",
        "คืนเงิน: ไม่แตะสถานะออเดอร์เลย — จัดการที่รายการชำระเงินให้เป็น REFUNDED เท่านั้น",
        "ปฏิเสธสลิปโอนเงิน: ออเดอร์ยังเปิดอยู่ที่ PENDING ไม่มีอะไรเปลี่ยน ลูกค้าส่งสลิปที่ถูกต้องมาใหม่ได้",
      ],
      [
        "Cancel (a sale that never really happened): order → CANCELLED, releases the reservation, restores the coupon quota, all in one transaction",
        "Return (from SHIPPED/COMPLETED): order → RETURNED, adds stock back to its exact source lot — the coupon quota is NOT restored, because that redemption already happened for real",
        "Refund: never touches the order status — it only moves the payment record to REFUNDED",
        "Rejecting a bank-transfer slip: the order stays open at PENDING, nothing else changes — the customer can send a correct slip again",
      ]
    ),
    aliases: lists(["ยกเลิกกับคืนของต่างกันยังไง", "คืนเงินไม่ใช่คืนของ", "จะยกเลิกหรือคืนดี"], ["cancel versus return versus refund"]),
  },
  {
    id: "limits.shipping-fee",
    guideIds: ["shipping.create", "shipping.booking-troubleshoot"],
    title: both("ค่าจัดส่งและขนส่งที่ลูกค้าขอ", "Shipping fee and the carrier the customer asked for"),
    items: lists(
      [
        "ยอดที่ต้องเก็บ = (ยอดสินค้า − ส่วนลด) + ค่าจัดส่ง — ค่าส่งไม่รวมในยอดออเดอร์ คำนวณเฉพาะตอนเก็บเงินจริงเท่านั้น",
        "ลำดับหาค่าส่ง: ตามขนส่งที่เลือก → ตามโซน → เหมาจ่าย → ไม่คิดค่าส่ง — ค่าส่งเป็น null (คำนวณไม่ได้) ต้องไม่ถูกอ่านเป็น 0",
        "โซนมี 3 ระดับ: กรุงเทพฯ · 5 จังหวัดปริมณฑล · ต่างจังหวัดที่เหลือทั้งหมด",
        "“ขนส่งที่ลูกค้าขอ” จากแชทเป็นความต้องการ ไม่ใช่คำมั่น — ขนส่งจริงคือที่พนักงานเลือกตอนสร้างใบจัดส่ง ถ้าเลือกต่างกันระบบเตือนแต่ไม่บล็อก",
        "AI ห้ามเปรียบเทียบราคา/เวลาส่งระหว่างขนส่ง เพราะไม่มีข้อมูลจริงให้เทียบ — ถ้าร้านยังไม่ได้ตั้งขนส่งที่ใช้เลย AI ต้องไม่ยกเรื่องนี้ขึ้นมาเอง",
      ],
      [
        "What the customer owes = (item total − discount) + shipping fee — shipping is never folded into the order total, and is only computed when money is actually collected",
        "Fee lookup order: chosen carrier → zone → flat rate → no shipping fee — a null fee (couldn't be computed) must never be read as zero",
        "Only 3 zones exist: Bangkok · the 5 surrounding provinces · everywhere else upcountry",
        "The \\\"carrier the customer asked for\\\" (from chat) is a preference, not a promise — the carrier actually used is whatever staff pick when creating the shipment; picking a different one warns but doesn't block",
        "The AI must never compare carrier price or speed — there's no real data to compare against. If the shop hasn't configured a carrier at all, the AI must not raise the topic on its own.",
      ]
    ),
    aliases: lists(["ค่าส่งคิดยังไง", "ลูกค้าขอขนส่งเจ้าอื่น", "ค่าส่งไม่ตรง"], ["how the shipping fee is calculated", "customer asked for another carrier"]),
  },
  {
    id: "limits.coupon-rules",
    guideIds: ["coupons.check-availability", "coupons.create-and-send"],
    title: both("คูปอง: ประเภท เงื่อนไข และลำดับใช้จริง", "Coupons: type, conditions, and how redemption actually happens"),
    items: lists(
      [
        "ประเภท PERCENT (ไม่เกิน 100) หรือ FIXED · เงื่อนไขเป็นตัวเลือกทั้งหมด: ยอดขั้นต่ำ, จำนวนครั้งรวม, จำนวนครั้งต่อลูกค้า, ช่วงวันที่, สวิตช์เปิด/ปิดแยกอิสระ",
        "ใช้งานจริง: สร้างคูปองแม่ → แจกเข้ากระเป๋าลูกค้า (ลิงก์มีลายเซ็น ลูกค้าไม่ต้องกดรับ) → ตรวจสถานะได้จาก Customer 360",
        "ส่วนลดเกิดตอนสร้างออเดอร์เท่านั้น — ตรวจเงื่อนไขและตัดโควตาในทรานแซกชันเดียวกับการจองสต็อก โดยล็อกแถวคูปองก่อนนับ กันใช้เกินโควตาตอนแข่งกันสั่งพร้อมกัน",
      ],
      [
        "Type is PERCENT (capped at 100) or FIXED · every condition is optional: minimum order value, total redemption cap, per-customer cap, a date window, and an independent on/off switch",
        "Real flow: create the coupon → hand it to a customer's wallet (a signed link, no \\\"claim\\\" step needed) → check its status from Customer 360",
        "The discount is only ever applied when an order is created — the condition check and quota deduction happen in the same transaction as the stock reservation, locking the coupon row first so two simultaneous orders can't both redeem the last use",
      ]
    ),
    aliases: lists(["คูปองมีกี่แบบ", "ลำดับการใช้ส่วนลด", "ใช้คูปองหลายใบได้ไหม"], ["coupon types", "discount order", "stacking coupons"]),
  },
  {
    id: "limits.fefo-and-counts",
    guideIds: ["inventory.count", "purchase.receive"],
    title: both("ล็อต FEFO และการนับสต็อกแบบ Snapshot", "FEFO lots and snapshot-based stock counts"),
    items: lists(
      [
        "ล็อตถูกสร้างตอนรับของจากใบสั่งซื้อเท่านั้น — สต็อก, ล็อต, movement, ความคืบหน้า PO และ audit อยู่ในทรานแซกชันเดียว",
        "POS จ่ายของแบบ FEFO (หมดอายุก่อนออกก่อน) และข้ามล็อตที่หมดอายุแล้วเสมอ — ล็อตหมดอายุเท่ากับขายไม่ได้",
        "นับสต็อก (Stock Count): แต่ละบรรทัดเก็บ snapshot จำนวนตามระบบ ณ ตอนกรอกครั้งแรก — ยืนยันแล้วระบบบวก (จำนวนที่นับได้ − snapshot) เข้าสต็อกปัจจุบัน ไม่ได้เขียนทับตรง ๆ ยอดขายระหว่างนับจึงไม่หายไป",
        "โอนสต็อกระหว่างสาขา: ส่งของตัดออกจากต้นทางทันที (TRANSFER_OUT) — ระหว่างทางของไม่เป็นของสาขาไหนเลย รับของจึงเข้าปลายทาง (TRANSFER_IN) — ส่งได้ไม่เกินจำนวนที่ยังไม่ถูกจอง",
      ],
      [
        "A lot is only ever created when receiving a purchase order — the stock row, the lot, the movement, the PO progress, and the audit entry all land in one transaction",
        "POS always issues lots FEFO (first-expiring, first-out) and always skips expired lots — an expired lot is functionally unsellable",
        "Stock Count: each line captures a snapshot of the system's quantity the moment it was first entered — confirming applies (counted quantity − snapshot) as a delta to current stock, it never overwrites directly, so sales that happened mid-count are never lost",
        "Branch transfer: sending cuts the source branch immediately (TRANSFER_OUT) — while in transit, the stock belongs to no branch at all — receiving adds it to the destination (TRANSFER_IN); you can never send more than what isn't already reserved",
      ]
    ),
    aliases: lists(["FEFO คืออะไร", "ตัดล็อตไหนก่อน", "ยอดล็อตไม่ตรงกับสต็อก"], ["FEFO lot picking", "lot totals do not match stock"]),
  },
  {
    id: "limits.supplier-receiving",
    guideIds: ["purchase.receive", "pos.receive-purchase"],
    title: both("ผู้ขายและการรับของ (Supplier Catalog + รับที่ POS)", "Suppliers and receiving (Supplier Catalog + POS receiving)"),
    items: lists(
      [
        "Supplier Catalog จับคู่ SKU/ชื่อ/บาร์โค้ดของผู้ขายเข้ากับ SKU+ไซซ์ของร้าน — ค้นด้วยรหัสฝั่งไหนก็ได้ และดึงราคาต่อหน่วยล่าสุดมาใช้ซ้ำอัตโนมัติ",
        "SKU ผู้ขายหนึ่งรหัสชี้ไปสินค้าร้านสองตัวไม่ได้ (ภายในผู้ขายรายเดียวกัน) — แก้ Supplier Catalog ภายหลังไม่เขียนทับใบสั่งซื้อเก่า เพราะแต่ละบรรทัด PO เก็บสำเนา SKU/ชื่อผู้ขายไว้เอง",
        "รับของที่ POS: สแกนสร้างได้แค่ร่าง (ยังไม่มีอะไรเคลื่อนไหว) — กดยืนยันครั้งเดียวคือจุดที่สต็อกเปลี่ยนจริง พร้อมตรวจ PIN และสิทธิ์ purchase.receive ซ้ำ",
        "ของเข้าคนละสาขาแล้วแต่เส้นทาง: รับผ่าน POS เข้าสาขาของเครื่องนั้น · รับผ่าน Admin เข้าสาขาหลักของร้าน",
      ],
      [
        "The Supplier Catalog matches a supplier's SKU / product name / barcode to the shop's own SKU+size — search by either side's code, and the last unit cost is reused automatically",
        "One supplier SKU can't point at two different shop products (within the same supplier) — editing the Supplier Catalog later never rewrites an old purchase order, because each PO line keeps its own copy of the supplier's SKU and name",
        "Receiving at POS: scanning only builds a draft — nothing moves yet. The single confirm press is the moment stock actually changes, and it re-checks the cashier PIN and the purchase.receive permission",
        "Received stock lands in a different branch depending on the path: receiving through POS lands in that device's own branch; receiving through Admin lands in the shop's main branch",
      ]
    ),
    aliases: lists(["ผู้ขายและราคาซื้อ", "รับของที่เคาน์เตอร์", "รับของบางส่วน"], ["supplier catalog", "receiving at the counter"]),
  },
  {
    id: "limits.crm-behaviour",
    guideIds: ["customers.customer-360", "customers.manage-address"],
    title: both("CRM: ข้อมูลลูกค้า ที่อยู่ และการเลือกออเดอร์อัตโนมัติ", "CRM: customer data, addresses, and automatic order matching"),
    items: lists(
      [
        "ข้อมูลโปรไฟล์จากช่องทาง (ชื่อ/รูป/สถานะ) เป็นแค่แคชสำรอง — ข้อมูลที่พนักงานกรอกใน CRM เป็นข้อมูลหลักเสมอ การซิงค์เบื้องหลังต้องไม่เขียนทับ",
        "ลูกค้าหนึ่งคนมีที่อยู่จัดส่งได้หลายรายการ — ต้องมีที่อยู่ประเภท shipping อย่างน้อยหนึ่งรายการก่อนออเดอร์จากแชท/เว็บจะส่งของได้ ลบที่อยู่ไม่กระทบตัวลูกค้าหรือออเดอร์เดิม",
        "ตรวจว่าข้อมูลลูกค้าครบหรือยัง คืนแค่ค่าจริง/เท็จ + ชื่อช่องที่ขาด — ไม่ส่งข้อมูลส่วนตัวดิบเข้าไปเพียงเพื่อตัดสินใจว่าต้องถามฟอร์มไหม",
        "จับคู่ออเดอร์ให้อัตโนมัติตอนลูกค้าถามสถานะ/ส่งสลิป ใช้แค่ออเดอร์ PENDING ล่าสุดที่ตรงช่องทาง+รหัสอ้างอิง ณ ขณะนั้นเท่านั้น — ไม่มีทางหยิบออเดอร์จากช่องทางอื่นที่ผสานกันไว้มาโดยไม่ตั้งใจ",
      ],
      [
        "Profile data synced from a channel (name, photo, status text) is only a display cache — what staff enter in the CRM is always the source of truth, and the background sync must never overwrite it",
        "A customer can hold multiple shipping addresses — at least one shipping-type address is required before a chat/web order can ship. Deleting an address never touches the customer record or their past orders.",
        "The completeness check for customer info returns only true/false plus which fields are missing — it never sends raw personal data through just to decide whether to ask a form question",
        "Automatically matching an order when a customer asks about status or sends a payment slip only ever considers the most recent PENDING order matching that exact channel and reference at that moment — it can never silently pull in an order from a different, now-merged channel",
      ]
    ),
    aliases: lists(["ระบบเลือกออเดอร์ให้เองยังไง", "ที่อยู่ลูกค้าใช้ตัวไหน", "ข้อมูลจากช่องทางทับข้อมูลที่กรอกไหม"], ["automatic order matching", "which address is used"]),
  },
  {
    id: "limits.inbox-behaviour",
    guideIds: ["inbox.handle-conversation", "inbox.review-mentions"],
    title: both("Inbox: เมนชัน ปุ่มลัด และการแสดงผลตามอุปกรณ์", "Inbox: mentions, shortcuts, and the responsive layout"),
    items: lists(
      [
        "เมนชันเพื่อนร่วมงานเลือกจากรายชื่อ Sales/Manager/Administrator เท่านั้น ไม่ได้แยกคำจากข้อความอิสระ — ชื่อสะกดผิดหรือซ้ำกันจึงยิงผิดคนไม่ได้ ดูทั้งหมดที่ “เมนชันของฉัน”",
        "“ส่งแล้ว (SENT)” ไม่เท่ากับ “ลูกค้าได้รับแล้ว” — LINE/Facebook/Instagram ส่งจริงและล้มเหลวจริงได้ (มีปุ่มส่งใหม่) ส่วนเว็บ/TikTok/Shopee/Lazada ขึ้น SENT ทันทีที่บันทึกเสร็จเท่านั้น ไม่มีสถานะอ่านแล้วเลยบน LINE/TikTok",
        "ปุ่มลัดใน Customer 360 (“สร้างออเดอร์”, “ออกใบแจ้งหนี้”) ใช้สิทธิ์และกฎเดียวกับหน้าเต็ม — ใบแจ้งหนี้เป็นแค่เอกสารดูตัวอย่าง ไม่บันทึกในระบบ ไม่ใช่หลักฐานการชำระเงิน",
        "มือถือ/แท็บเล็ตยุบ Customer 360 เป็นแท็บ “ลูกค้า” ในแชท — ข้อมูลชุดเดียวกัน ไม่ใช่เวอร์ชันย่อ",
      ],
      [
        "Mentioning a teammate is picked from a list of Sales/Manager/Administrator only — it never parses free text, so a misspelled or duplicate name can never ping the wrong person. See them all under \\\"My mentions.\\\"",
        "\\\"SENT\\\" does not mean \\\"the customer received it\\\" — LINE/Facebook/Instagram can genuinely send and genuinely fail (with a retry button); Web/TikTok/Shopee/Lazada show SENT the moment the message is saved, nothing more. Neither LINE nor TikTok has a read receipt at all.",
        "Customer 360's shortcuts (\\\"Create order\\\", \\\"Issue invoice\\\") use the exact same permission and rules as the full page — the invoice is a preview-only document, never saved, never proof of payment",
        "Mobile/tablet collapse Customer 360 into a \\\"Customer\\\" tab inside the chat — same data, not a stripped-down version",
      ]
    ),
    aliases: lists(["ส่งแล้วลูกค้าได้รับหรือยัง", "ปุ่มลัดใน Customer 360", "Inbox บนมือถือ"], ["sent does not mean delivered", "inbox on mobile"]),
  },
  {
    id: "limits.followup-retention",
    guideIds: ["followup.review-queue", "followup.configure-rules"],
    title: both("ระบบติดตามและรักษาลูกค้า (Follow-up / Retention)", "Follow-up and the Retention Engine"),
    items: lists(
      [
        "Follow-up ไม่ใช่ตัวจับเวลาตายตัว เป็นเครื่องมือกฎที่ตัดสินว่าควรทักลูกค้าที่เงียบไปหรือไม่ — 6 เงื่อนไขหยุดที่กฎใดก็ปิดไม่ได้: ลูกค้าตอบแล้ว, พนักงานตอบแล้ว, ปิดบทสนทนาแล้ว, ครบจำนวนครั้งที่ลอง, ลูกค้าปิดรับการติดตาม, กฎถูกปิดใช้งาน",
        "Retention Engine สร้างเคสรายเดือน หนึ่งเคสต่อลูกค้าที่ระบุตัวตนได้และมีออเดอร์ชำระแล้ว (ทั้ง POS และออนไลน์) — คำนวณจาก RFM และวันที่คาดว่าจะกลับมาซื้อจากช่วงห่างการซื้อของลูกค้ารายนั้นเอง",
        "สินค้าที่แนะนำในเคสต้องมีหลักฐานรองรับเสมอ (มีออเดอร์จริงรองรับ) ไม่ใช่โมเดลเดา",
      ],
      [
        "Follow-up is not a fixed timer — it's a rules engine deciding whether a gone-quiet customer should be re-contacted. Six stop conditions override any rule: the customer replied, staff replied, the conversation closed, the retry count is used up, the customer opted out of follow-ups, or the rule itself is disabled.",
        "The Retention Engine builds one monthly case per identifiable customer with a paid order (POS or online) — scored from RFM plus a projected repurchase date drawn from that customer's own historical purchase gap",
        "A recommended product in a case must always be backed by real evidence (an actual order supports it) — never a model's guess",
      ]
    ),
    aliases: lists(["Follow-up ทำงานยังไง", "Holdout คืออะไร", "ระบบทักลูกค้าเองไหม"], ["how follow-up decides", "what the holdout is"]),
  },
  {
    id: "limits.reports-digest",
    guideIds: ["reports.create-export", "platform.report-schedule"],
    title: both("รายงานและสรุปยอดส่งอัตโนมัติ (Digest)", "Reports and the automatic sales digest"),
    items: lists(
      [
        "ช่วงเวลาเริ่มต้นของรายงานคือ 30 วันปฏิทินล่าสุดตามเวลาไทย — ช่วงที่ระบุเองก็ถูกแปลงเป็นขอบเขตวันไทยเสมอ",
        "รายได้ = ออเดอร์ PAID ขึ้นไปตาม paid_at · รายได้สุทธิ = รายได้ − ยอดคืนเงิน · การแยกตามช่องทางแสดงเฉพาะช่องทางที่มีออเดอร์จริง (ช่องทางหายไป = ยังไม่มีออเดอร์ ไม่ใช่ระบบพัง)",
        "Export INVENTORY เป็นภาพสต็อก ณ ขณะนี้เสมอ ไม่สนใจช่วงวันที่ที่เลือก · Export PROFIT ใช้ต้นทุนปัจจุบันกับรายได้ในอดีต ต้องนำเสนอเป็นค่าประมาณเสมอ",
        "Digest ตั้งความถี่ DAILY/WEEKLY/MONTHLY ตามเวลาไทย ส่งได้ทางอีเมล, Slack (webhook URL เข้ารหัสเก็บ), LINE (ผ่าน OA ของร้านเอง) — เนื้อหาคือเฉพาะงวดที่เพิ่งจบไปแล้วเท่านั้น",
        "ตั้งค่าสรุปยอดขายไว้แล้วแต่ไม่ได้รับอะไรเลย มักแปลว่ายังไม่ได้ตั้งตารางเวลาส่งจริง ไม่ใช่ระบบพัง — บันทึกได้โดยไม่มี error แต่ไม่มีอีเมลออก",
      ],
      [
        "A report's default window is the last 30 calendar days in Thai time — even a custom range is converted to Thai day boundaries",
        "Revenue = orders PAID or later, by paid_at · net revenue = revenue − refunds · the channel breakdown only shows channels with real orders (a missing channel means no orders yet, not a bug)",
        "The INVENTORY export is always a snapshot of right now — it ignores whatever date range is selected · the PROFIT export applies today's cost to past revenue and must always be presented as an estimate",
        "The digest runs DAILY/WEEKLY/MONTHLY on Thai time, delivered by email, Slack (a webhook URL, stored encrypted), or LINE (through the shop's own OA account) — its content only ever covers the period that just closed",
        "A configured digest that never arrives usually means its schedule was never actually set, not that anything broke — saving the setting succeeds with no error, but nothing gets sent",
      ]
    ),
    aliases: lists(["Digest ส่งเมื่อไร", "ตั้งสรุปยอดแล้วไม่ได้รับ", "รายได้นับจากอะไร"], ["digest schedule", "configured a digest but received nothing"]),
  },
  {
    id: "limits.permissions-by-module",
    guideIds: ["permissions.explain", "users.add-and-authorize"],
    title: both("สิทธิ์ตามโมดูล (ใครควรได้อะไร)", "Permissions by module — who should get what"),
    items: lists(
      [
        "สินค้า/สต็อก: product.view/edit ให้ทั่วไป · inventory.transfer และ inventory.count ให้ Manager/Warehouse · inventory.count.apply และ purchase.cancel เฉพาะ Manager เท่านั้น",
        "ออเดอร์/การขาย: order.view ให้ทั่วไป · order.create/order.return ให้ Manager/Sales (return เพิ่ม Cashier) · coupon.manage กระทบกำไรโดยตรง จำกัดเฉพาะ Manager/Administrator",
        "ลูกค้า/Inbox: customer.view ไม่มีสิทธิ์ = เห็นหน้าว่าง ไม่ใช่ error · customer.edit ใช้ผสานลูกค้า (ย้อนกลับไม่ได้) · inbox.manage (โน้ต/เมนชัน) แยกจาก inbox.reply (ตอบลูกค้า)",
        "รายงาน/ระบบ/ติดตาม: report.view ครอบคลุมทุกรายงานและจอสด · followup.manage (Manager) ต่างจาก followup.view (Sales อ่านอย่างเดียว) · retention.manage (Manager)",
        "การตั้งค่าบางอย่าง (สรุปยอดขาย, ช่องทาง) ใช้การตรวจว่าเป็น “ผู้ดูแลของร้าน” ไม่ใช่ระบบ permission ปกติ",
      ],
      [
        "Products/stock: product.view/edit for everyone · inventory.transfer and inventory.count for Manager/Warehouse · inventory.count.apply and purchase.cancel for Manager only",
        "Orders/sales: order.view for everyone · order.create/order.return for Manager/Sales (return also covers Cashier) · coupon.manage directly affects margin, so it's Manager/Administrator only",
        "Customers/Inbox: customer.view with no permission shows a blank page, not an error · customer.edit is what merges customers (irreversible) · inbox.manage (notes/mentions) is separate from inbox.reply (replying to customers)",
        "Reports/system/retention: report.view covers every report and the live dashboard · followup.manage (Manager) differs from followup.view (Sales gets read-only) · retention.manage (Manager)",
        "Some settings (the sales digest, channel config) are gated by \\\"is this shop's admin\\\", not the normal permission system",
      ]
    ),
    aliases: lists(["ใครควรได้สิทธิ์อะไร", "สิทธิ์ของแต่ละ role", "ให้สิทธิ์แค่ไหนดี"], ["who should get which permission", "permissions by role"]),
  },
  {
    id: "limits.business-archetype",
    guideIds: ["onboarding.getting-started", "settings.configure-shop"],
    title: both("ประเภทธุรกิจ (Archetype) ตอนสมัครร้าน", "Business archetype at signup"),
    items: lists(
      [
        "เป็นตัวเลือก ไม่บังคับ เว้นว่างได้ (เลือก “เริ่มจากร้านเปล่า”) — ใช้เตรียมหมวดสินค้า ตัวอย่างข้อมูล และคำแนะนำเริ่มต้นให้เหมาะกับร้าน แก้ภายหลังได้จากหน้าตั้งค่า",
        "ประเภทที่มี: Mini Mart/ร้านชำ (สินค้าหมุนเร็ว) · แฟชั่นและเสื้อผ้า (ไซซ์/สีหลากหลาย) · ของใช้ในบ้านและครัว (ขายเป็นชุด) · ความงามและของใช้ส่วนตัว (ต้องให้คำแนะนำ) · อาหารและเครื่องดื่ม (สั่งผ่านแชทเร็ว)",
      ],
      [
        "Optional, never required, can be left blank (\\\"start from an empty shop\\\") — it seeds product categories, sample data, and starting suggestions to fit the shop, and can be changed later from settings",
        "Available archetypes: Mini Mart / convenience store (fast-turning stock) · Fashion & apparel (many sizes/colors) · Home & kitchen goods (sold as sets) · Beauty & personal care (needs advisory selling) · Food & beverage (fast chat ordering)",
      ]
    ),
    aliases: lists(["ประเภทธุรกิจตอนสมัคร", "archetype คืออะไร", "เลือกประเภทร้านผิด"], ["business archetype", "chose the wrong shop type"]),
  },
];

const LIMITS_BY_GUIDE = new Map<string, SystemLimitGroup[]>();
for (const group of SYSTEM_LIMITS) {
  for (const guideId of group.guideIds) {
    const bucket = LIMITS_BY_GUIDE.get(guideId);
    if (bucket) bucket.push(group);
    else LIMITS_BY_GUIDE.set(guideId, [group]);
  }
}

/** Limit groups attached to a guide, in catalog order. */
export function limitsForGuide(guideId: string): readonly SystemLimitGroup[] {
  return LIMITS_BY_GUIDE.get(guideId) ?? [];
}

/** Retrieval keys a guide inherits from its limits: titles and phrasings only, never the rules. */
export function limitRetrievalAliases(guideId: string, locale: AssistantLocale): readonly string[] {
  const owned = LIMITS_BY_GUIDE.get(guideId);
  if (!owned) return [];
  return owned.flatMap((group) => [group.title[locale], ...group.aliases[locale]]);
}
