/**
 * The work assistant's pinned question corpus.
 *
 * Every question the product puts in front of staff (Drawer starter chips, register chips) and
 * every question the earlier contract tests exercised — 51 in total — plus 2 deliberate no-match
 * guards. Each one names the single entry that must *lead* the answer.
 *
 * Why this file exists: the previous assertions were `assert.ok(results.some(r => r.id === X))`.
 * That passes when the right guide is buried at rank 6 under five unrelated ones, which is exactly
 * how a retrieval catalog rots — every question "finds something", nobody notices that "ขายเชื่อ"
 * started answering with the generic sale guide. Pinning the top hit turns a silent quality
 * regression into a red test.
 *
 * The expectations are the *intended* answer, not a snapshot of today's ranking. When a case fails,
 * the question is which of the two is wrong; changing the expectation to match new output is only
 * correct when the new answer is genuinely the better one for the person who typed it.
 *
 * `expectTool` is the other half of "correct guide/tool": a how-to question is answered by a guide,
 * but "ทำไมออเดอร์ยังเป็น Pending" is only answerable by reading that order. The named tool must
 * exist, be offered on the staff surface, and be gated by the permission written here — a tool that
 * silently loses its permission would still answer the question, just for the wrong people.
 */

export type CorpusExpectation =
  /** The question must match a verified entry, and `expectTop` must be the first match. */
  | "answer"
  /**
   * The question matches nothing. Standing on a page may still rank that page's guides — as page
   * guidance, never as a match — and `expectTop` must be the first of those.
   */
  | "page-guidance"
  /** Nothing may come back as a match, with or without page context. */
  | "no-match";

export type CorpusCase = Readonly<{
  q: string;
  locale: "th" | "en";
  /** Retrieval context only. Page and register context re-rank; they never grant access. */
  context?: Readonly<{ currentPath?: string; pageId?: string; kind?: "capability" | "guide" }>;
  expect: CorpusExpectation;
  /** Knowledge id (capability or guide) that must rank first. Omitted for `no-match`. */
  expectTop?: string;
  /** Ids that must also be retrieved as matches — separate concerns the answer must not merge. */
  expectAlso?: readonly string[];
  /** Approved tool that must exist for the live half of the answer, and the permission gating it. */
  expectTool?: Readonly<{ name: string; permission: string | null }>;
  /**
   * For "does BMS actually do X yet" questions: the status the answer must carry. A capability
   * that quietly turns CONDITIONAL is a promise made to someone standing at a counter.
   */
  expectStatus?: "AVAILABLE" | "CONDITIONAL" | "BETA" | "MOCK" | "UNAVAILABLE";
  /**
   * `coverage` = written to give an entry its first pinned question, so the catalog cannot grow
   * a page nobody ever asks about. Anything without it is a question the product ships as a chip
   * or that was verified by hand — those are the original 51 and their count is asserted.
   */
  origin?: "coverage";
  why?: string;
}>;

/** Register questions are asked from `/pos`, which searches guides only. */
const REGISTER = { currentPath: "/admin/pos-manual", pageId: "pos", kind: "guide" } as const;
/** The Drawer sends the page the user is standing on. Orders is used as a representative page. */
const ON_ORDERS_PAGE = { currentPath: "/admin/orders", pageId: "orders" } as const;
/**
 * How the two knowledge tools actually search. `search_system_guides` asks for guides and
 * `search_system_capabilities` asks for capabilities, so a "how do I" question is never judged
 * against the capability that shares its subject, and vice versa.
 */
const GUIDES = { kind: "guide" } as const;
const CAPABILITIES = { kind: "capability" } as const;

export const WORK_ASSISTANT_QUESTION_CORPUS: readonly CorpusCase[] = [
  // ── What can this product do (capability, not tenant state) ───────────────────────────────
  {
    q: "export PDF Excel", locale: "th", expect: "answer",
    expectTop: "reports.export", expectAlso: ["reports.create-export"],
    expectTool: { name: "generate_report", permission: "report.view" },
    why: "Capability answers 'can BMS do this'; the guide answers 'how'. Both, capability first.",
  },
  { q: "ระบบ export PDF หรือ Excel ได้ไหม", locale: "th", expect: "answer", expectTop: "reports.export" },
  { q: "Can BMS export PDF or Excel?", locale: "en", expect: "answer", expectTop: "reports.export" },
  {
    q: "ระบบมีสะสมแต้มไหม", locale: "th", expect: "answer",
    expectTop: "loyalty.points", expectAlso: ["loyalty.check-program"],
    expectTool: { name: "get_loyalty_program_status", permission: "member.view" },
    why: "Product support and tenant enablement are different answers and must both surface.",
  },
  {
    q: "ตอนนี้มีคูปองอะไรใช้ได้บ้าง", locale: "th", expect: "answer",
    expectTop: "coupons.check-availability", expectAlso: ["coupons.promotions"],
    expectTool: { name: "list_available_coupons", permission: "coupon.view" },
    why: "Shop-wide coupons, not one customer's wallet — the guide leads because that split is the answer.",
  },
  {
    q: "system health", locale: "en", expect: "answer",
    expectTop: "system.health", expectAlso: ["system-health.read"],
  },

  // ── How do I do my job (guides) ───────────────────────────────────────────────────────────
  {
    q: "ร้านนี้คำนวณแต้มอย่างไร", locale: "th", expect: "answer", expectTop: "loyalty.calculate-points",
    expectTool: { name: "get_loyalty_program_status", permission: "member.view" },
    why: "The rates are the shop's, never the catalog's defaults.",
  },
  { q: "แต้มคิดก่อนหรือหลังหักส่วนลด", locale: "th", expect: "answer", expectTop: "loyalty.calculate-points" },
  { q: "สร้างคูปองและส่งให้ลูกค้ายังไง", locale: "th", expect: "answer", expectTop: "coupons.create-and-send" },
  { q: "เพิ่มพนักงานและกำหนดสิทธิ์ยังไง", locale: "th", expect: "answer", expectTop: "users.add-and-authorize" },
  { q: "ตั้งราคาส่งหรือโปรโมชันซื้อแถมยังไง", locale: "th", expect: "answer", expectTop: "products.pricing-promotions" },
  {
    q: "ทำไมสินค้ามีสต็อกแต่ขายไม่ได้", locale: "th", expect: "answer", expectTop: "inventory.stock-sale-blockers",
    expectTool: { name: "check_stock", permission: "product.view" },
    why: "Sellable stock is current minus reserved; only a live read separates the two.",
  },
  {
    q: "สินค้าที่จองไว้เป็นของออเดอร์ไหน", locale: "th", expect: "answer", expectTop: "inventory.reservation-owners",
    expectTool: { name: "get_variant_reservations", permission: "order.view" },
    why: "The answer names orders and customers, so it is gated by order.view, not product.view.",
  },
  {
    q: "ทำไมออเดอร์ยังเป็น Pending", locale: "th", expect: "answer", expectTop: "orders.pending-troubleshoot",
    expectTool: { name: "get_order_status", permission: "order.view" },
  },
  { q: "แก้ที่อยู่จัดส่งของลูกค้ายังไง", locale: "th", expect: "answer", expectTop: "customers.manage-address" },
  { q: "ส่งสินค้าและคูปองในแชทยังไง", locale: "th", expect: "answer", expectTop: "inbox.sell-from-conversation" },
  { q: "ทำไมจองขนส่งไม่สำเร็จ", locale: "th", expect: "answer", expectTop: "shipping.booking-troubleshoot" },
  {
    q: "ทำไมกดปุ่มนี้ไม่ได้", locale: "th", expect: "answer", expectTop: "permissions.action-unavailable",
    expectTool: { name: "get_my_access", permission: null },
    why: "Any signed-in actor may read their own access; that is why this tool has no permission.",
  },
  { q: "ถ้าทำรายการซ้ำ ระบบจะบันทึกซ้ำไหม", locale: "th", expect: "answer", expectTop: "assistant.retry-safely" },
  {
    q: "ข้อมูลใน Dashboard อัปเดตล่าสุดเมื่อไร", locale: "th", expect: "answer", expectTop: "dashboard.data-freshness",
    expectTool: { name: "get_dashboard", permission: "report.view" },
  },

  // ── Who is this person, what may this account do ──────────────────────────────────────────
  {
    q: "ค้นพนักงาน", locale: "th", expect: "answer", expectTop: "users.search-staff",
    expectTool: { name: "search_staff_users", permission: "user.view" },
    why: "Staff existence is a permissioned fact; a denied actor must learn nothing.",
  },
  { q: "ตั้ง PIN POS", locale: "th", expect: "answer", expectTop: "pos.configure-devices" },

  // ── The Drawer's own starter chips ────────────────────────────────────────────────────────
  {
    q: "หน้านี้ใช้งานอย่างไร", locale: "th", context: ON_ORDERS_PAGE,
    expect: "page-guidance", expectTop: "orders.follow-lifecycle",
    why: "'This page' names no topic. Page context may rank the page's guide, never claim a match.",
  },
  {
    q: "What can I do on this page?", locale: "en", context: ON_ORDERS_PAGE,
    expect: "page-guidance", expectTop: "orders.follow-lifecycle",
    why: "Every word is a filler word; matching on 'page' used to return whatever mentioned it.",
  },
  {
    q: "บัญชีฉันทำอะไรได้บ้าง", locale: "th", expect: "answer", expectTop: "permissions.my-access",
    expectTool: { name: "get_my_access", permission: null },
  },
  {
    q: "What can my account access?", locale: "en", expect: "answer", expectTop: "permissions.my-access",
    expectTool: { name: "get_my_access", permission: null },
  },

  // ── The register, Thai. Each chip is one /api/pos/* workflow ──────────────────────────────
  { q: "เมนูขาย", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.build-sale" },
  { q: "รับชำระ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.take-payment" },
  { q: "คืนสินค้าและ Void", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.void-return" },
  { q: "คืนของไม่มีใบเสร็จ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.blind-return" },
  { q: "เมนูรับของ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.receive-purchase" },
  { q: "เมนูมัดจำ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.manage-deposit" },
  { q: "บัตรของขวัญ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.use-store-credit" },
  { q: "ขายเชื่อ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.credit-sale" },
  { q: "เปิดโต๊ะ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-open-check" },
  { q: "open a table", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-open-check" },
  { q: "ส่งครัว", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-kitchen-round" },
  { q: "send to kitchen", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-kitchen-round" },
  { q: "ย้ายโต๊ะ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-settle" },
  { q: "move table", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.restaurant-settle" },
  // ก่อน 9.44 คำถามนี้ถูกปักไว้ที่ inventory.stock-model เพราะนั่นเป็นคำตอบจริงเพียงข้อเดียว
  // (สูตร/ตัวเลือก/คิวครัว) · ตอนนี้มีหน้าโต๊ะจริงแล้ว คนที่ถามหมายถึงบริการหน้าร้าน
  { q: "ระบบรองรับร้านอาหารไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "restaurant.dine-in" },
  { q: "does BMS support restaurant dine-in", locale: "en", context: { kind: "capability" }, expect: "answer", expectTop: "restaurant.dine-in" },
  { q: "รายงานกะ", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.shift-reports" },
  { q: "ตั้งค่า scanner", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.device-settings" },
  { q: "ขายยา", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.pharmacist-authorization" },
  { q: "เปิดลิ้นชัก", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.cash-movement" },
  { q: "ใบกำกับภาษี", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.receipt-display" },

  // ── The register, English ─────────────────────────────────────────────────────────────────
  { q: "sale tab", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.build-sale" },
  { q: "take payment", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.take-payment" },
  { q: "return and void", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.void-return" },
  { q: "no receipt return", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.blind-return" },
  { q: "receive PO", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.receive-purchase" },
  { q: "deposit tab", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.manage-deposit" },
  { q: "gift card", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.use-store-credit" },
  { q: "credit sale", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.credit-sale" },
  { q: "shift report", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.shift-reports" },
  { q: "scanner settings", locale: "en", context: REGISTER, expect: "answer", expectTop: "pos.device-settings" },

  // ── Register safety questions ─────────────────────────────────────────────────────────────
  {
    q: "ทำไมส่วนลดต้องใช้ PIN คนที่สอง", locale: "th", context: { pageId: "pos" },
    expect: "answer", expectTop: "pos.manual-discount",
  },
  {
    q: "Void ต่างจาก Return ยังไง", locale: "th", context: { pageId: "pos" },
    expect: "answer", expectTop: "pos.void-return",
  },

  // ── Guards: the honest empty answer must stay reachable ───────────────────────────────────
  {
    q: "xyzzy", locale: "th", context: REGISTER, expect: "no-match",
    why: "The current-page bonus outweighs any relevance floor; without a separate match signal every register guide answers this.",
  },
  {
    q: "ทำยังไง", locale: "th", context: REGISTER, expect: "no-match",
    why: "A verb with no object is not a question the catalog can honestly answer.",
  },

  // ── Coverage: one pinned question per guide ───────────────────────────────────────────────
  // Asked the way the two knowledge tools ask (`kind: "guide"`), so a guide question is judged
  // against guides rather than losing a tie to the capability that shares its subject.
  { q: "เปิดกะแล้วปิดกะยังไง", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.shift", origin: "coverage" },
  { q: "ใช้แต้มสมาชิกที่หน้าร้านยังไง", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.member-coupon-points", origin: "coverage" },
  { q: "พักบิลแล้วเรียกกลับมายังไง", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.park-resume", origin: "coverage" },
  { q: "บันทึกค่าใช้จ่ายเงินสดย่อยหน้าร้าน", locale: "th", context: REGISTER, expect: "answer", expectTop: "pos.expense-petty-cash", origin: "coverage" },
  { q: "เปิดร้านมาต้องดูอะไรก่อน", locale: "th", context: GUIDES, expect: "answer", expectTop: "dashboard.daily-review", origin: "coverage" },
  { q: "เพิ่มสินค้าใหม่ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "products.create", origin: "coverage" },
  { q: "โอนของไปสาขาอื่นยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "inventory.transfer", origin: "coverage" },
  { q: "นับสต็อกแล้วปรับยอดยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "inventory.count", origin: "coverage" },
  { q: "ตั้งสูตรตัดวัตถุดิบของเมนูยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "inventory.stock-models", origin: "coverage" },
  { q: "how do I set a recipe for a menu item", locale: "en", context: GUIDES, expect: "answer", expectTop: "inventory.stock-models", origin: "coverage" },
  { q: "ตัดของเสียออกจากสต็อกยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "inventory.wastage", origin: "coverage" },
  { q: "how do I write off expired stock", locale: "en", context: GUIDES, expect: "answer", expectTop: "inventory.wastage", origin: "coverage" },
  { q: "กระดานครัวใช้ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "kitchen.board", origin: "coverage" },
  { q: "how do I move kitchen tickets to served", locale: "en", context: GUIDES, expect: "answer", expectTop: "kitchen.board", origin: "coverage" },
  { q: "ระบบรองรับร้านวัสดุก่อสร้างไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inventory.stock-model", origin: "coverage" },
  { q: "ระบบมีคิวครัวไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "kitchen.workflow", origin: "coverage" },
  { q: "ระบบบันทึกของเสียได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inventory.wastage-ledger", origin: "coverage" },
  {
    q: "ตรวจสลิปแล้วยืนยันเงินยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "payments.review-payment",
    expectTool: { name: "confirm_payment", permission: "payment.confirm" },
    why: "Confirming money is propose-only; the tool exists but must stay behind payment.confirm.",
    origin: "coverage",
  },
  { q: "สร้างพัสดุและใส่เลขติดตามยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "shipping.create", origin: "coverage" },
  {
    q: "รับของเข้าใบสั่งซื้อยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "purchase.receive",
    expectTool: { name: "receive_purchase_order", permission: "purchase.receive" },
    origin: "coverage",
  },
  { q: "คิวติดตามลูกค้าใช้ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "followup.review-queue", origin: "coverage" },
  { q: "ตั้งกฎติดตามลูกค้ายังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "followup.configure-rules", origin: "coverage" },
  { q: "เคสร้านขายยาเดินยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "pharmacy.case-flow", origin: "coverage" },
  { q: "ทำงานจากคิวเภสัชกรยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "pharmacy.process-queue", origin: "coverage" },
  { q: "แก้คำถามคัดกรองของร้านยายังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "pharmacy.manage-protocols", origin: "coverage" },
  { q: "บันทึกใบอนุญาตเภสัชกรยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "pharmacy.manage-licenses", origin: "coverage" },
  { q: "ดูตัวอย่างหน้าจอรีวิวของร้านยา", locale: "th", context: GUIDES, expect: "answer", expectTop: "pharmacy.review-mockup", origin: "coverage" },
  { q: "ดูยอดลูกหนี้ค้างทั้งร้าน", locale: "th", context: GUIDES, expect: "answer", expectTop: "receivables.review", origin: "coverage" },
  { q: "AI ตอบผิดต้องดูที่ไหน", locale: "th", context: GUIDES, expect: "answer", expectTop: "ai-quality.review", origin: "coverage" },
  { q: "ทดลองคำถามกับ AI ก่อนใช้จริง", locale: "th", context: GUIDES, expect: "answer", expectTop: "ai.use-playground", origin: "coverage" },
  { q: "ตั้งสิทธิ์ให้แต่ละ role ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "permissions.explain", origin: "coverage" },
  { q: "เพิ่มสาขาใหม่ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "locations.manage-branches", origin: "coverage" },
  { q: "พิมพ์สติกเกอร์บาร์โค้ดยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "catalog.print-labels", origin: "coverage" },
  { q: "ดูภาพรวมกะ POS ทุกเครื่องยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "pos.shift-overview", origin: "coverage" },
  { q: "ดูค่าคอมพนักงานยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "commission.review", origin: "coverage" },
  { q: "ดู audit log ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "access.review-audit", origin: "coverage" },
  { q: "เพิ่งเปิดร้านใหม่ต้องตั้งค่าอะไรก่อน", locale: "th", context: GUIDES, expect: "answer", expectTop: "onboarding.getting-started", origin: "coverage" },
  { q: "คู่มือทั้งระบบอยู่ที่ไหน", locale: "th", context: GUIDES, expect: "answer", expectTop: "manual.find-instructions", origin: "coverage" },
  { q: "สร้างโพสต์ใหม่ยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.edit-post", origin: "coverage" },
  { q: "ดูรายการโพสต์ทั้งหมด", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.posts", origin: "coverage" },
  { q: "ดูสถาปัตยกรรมระบบที่ไหน", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.architecture", origin: "coverage" },
  { q: "ดูร้านทั้งหมดในระบบ", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.tenants", origin: "coverage" },
  { q: "ตั้งตารางส่งรายงานอัตโนมัติ", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.report-schedule", origin: "coverage" },
  { q: "จัดการ role กลางของระบบ", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.roles", origin: "coverage" },
  { q: "ดูไฟล์ที่ระบบเก็บไว้", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.files", origin: "coverage" },
  { q: "ดู system log ย้อนหลัง", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.logs", origin: "coverage" },
  { q: "อีเมลส่งออกไม่ถึงต้องดูที่ไหน", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.mail-log", origin: "coverage" },
  { q: "ดูคิว support ticket", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.support", origin: "coverage" },
  { q: "งาน cron รันจริงหรือยัง", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.operations", origin: "coverage" },
  { q: "เช็กว่า env ตั้งค่าไว้หรือยัง", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.env", origin: "coverage" },
  { q: "รัน query ตรวจข้อมูลที่ไหน", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.sql-console", origin: "coverage" },
  { q: "สร้างข้อมูลทดสอบยังไง", locale: "th", context: GUIDES, expect: "answer", expectTop: "platform.fake-data", origin: "coverage" },

  // ── Coverage: one pinned question per capability ──────────────────────────────────────────
  // "Does BMS do X" is a different question from "how do I do X", and the status it returns is
  // the promise the shop repeats to its own customers — so the honest ones are pinned too.
  { q: "ระบบมีหน้าสรุปภาพรวมร้านไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "dashboard.overview", origin: "coverage" },
  { q: "ระบบรวมแชททุกช่องทางไว้ที่เดียวได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inbox.omnichannel", origin: "coverage" },
  { q: "ระบบเก็บแคตตาล็อกสินค้าได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "catalog.products", origin: "coverage" },
  { q: "ระบบแยกสต็อกตามสาขาได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inventory.branch", origin: "coverage" },
  { q: "ระบบจัดการออร์เดอร์ได้ถึงขั้นไหน", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "orders.lifecycle", origin: "coverage" },
  { q: "ระบบตรวจสลิปโอนเงินได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "payments.review", origin: "coverage" },
  { q: "ระบบออกเลขพัสดุได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "shipping.fulfillment", expectStatus: "AVAILABLE", origin: "coverage" },
  {
    q: "เชื่อมกับ Flash หรือ Kerry ได้จริงหรือยัง", locale: "th", context: CAPABILITIES, expect: "answer",
    expectTop: "shipping.carrier-integrations", expectStatus: "MOCK",
    why: "Shipment creation works; carrier booking does not. One entry cannot honestly say both.",
    origin: "coverage",
  },
  { q: "ระบบทำใบสั่งซื้อได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "purchase.orders", origin: "coverage" },
  { q: "ระบบมีประวัติลูกค้าแบบ Customer 360 ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "customers.crm", origin: "coverage" },
  { q: "ระบบตามลูกค้าที่หายไปได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "followup.retention", origin: "coverage" },
  {
    q: "ระบบส่งรายงานเข้าอีเมลได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "reports.email",
    expectTool: { name: "email_report", permission: "report.email" },
    why: "Sending to a free-text recipient stays propose-only behind its own permission.",
    origin: "coverage",
  },
  { q: "ระบบแยกสิทธิ์พนักงานได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "users.access", origin: "coverage" },
  { q: "ระบบขายหน้าร้านได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pos.operations", origin: "coverage" },
  { q: "ระบบรองรับร้านขายยาไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pharmacy.workflow", origin: "coverage" },
  { q: "ระบบเก็บประวัติว่าใครแก้อะไรไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "audit.revisions", origin: "coverage" },
  { q: "ระบบขายเชื่อได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "receivables.credit-sales", origin: "coverage" },
  { q: "ระบบแจ้งลูกค้าเมื่อของเข้าได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "restock.subscriptions", origin: "coverage" },
  { q: "ระบบขายเป็นแพ็กหรือยกกล่องได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "catalog.product-packs", origin: "coverage" },
  { q: "ระบบคิดค่าคอมพนักงานได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "commission.staff", origin: "coverage" },
  { q: "ระบบเชื่อมช่องทางแชทได้กี่ช่องทาง", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "settings.channels", origin: "coverage" },
  { q: "ระบบมีที่ตรวจคุณภาพคำตอบ AI ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "ai.quality", origin: "coverage" },
  { q: "ระบบมีโควตาการใช้ AI ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "billing.plan", origin: "coverage" },
  { q: "ระบบตั้งเวลาส่งรายงานอัตโนมัติได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "reports.schedule", origin: "coverage" },
  { q: "ระบบมีตารางสิทธิ์ตาม role ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "access.matrix", origin: "coverage" },
  { q: "ระบบโอนสต็อกข้ามสาขาได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inventory.transfers", origin: "coverage" },
  { q: "ระบบรองรับการตรวจนับสต็อกไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "inventory.snapshot-counts", origin: "coverage" },
  { q: "ระบบพิมพ์บาร์โค้ดสินค้าได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "catalog.labels", origin: "coverage" },
  { q: "ระบบรับมัดจำได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pos.deposits", origin: "coverage" },
  { q: "ระบบมีเครดิตร้านหรือบัตรของขวัญไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pos.store-credit", origin: "coverage" },
  { q: "ระบบบันทึกเงินสดย่อยหน้าร้านได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pos.expenses", origin: "coverage" },
  { q: "ระบบคืนสินค้าหน้าร้านได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pos.returns", origin: "coverage" },
  { q: "ระบบออกใบกำกับภาษีได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "tax.documents", origin: "coverage" },
  {
    q: "ส่ง e-Tax ให้สรรพากรได้จริงหรือยัง", locale: "th", context: CAPABILITIES, expect: "answer",
    expectTop: "tax.etax", expectStatus: "BETA",
    why: "Written but never proven against a real signing/submission provider.",
    origin: "coverage",
  },
  {
    q: "เชื่อม Shopee หรือ Lazada ได้จริงหรือยัง", locale: "th", context: CAPABILITIES, expect: "answer",
    expectTop: "settings.marketplaces", expectStatus: "BETA", origin: "coverage",
  },
  {
    q: "ต่อเครื่องพิมพ์สลิปกับลิ้นชักได้จริงหรือยัง", locale: "th", context: CAPABILITIES, expect: "answer",
    expectTop: "pos.hardware-printing", expectStatus: "BETA",
    why: "ESC/POS code exists but has never run against real hardware.",
    origin: "coverage",
  },
  { q: "ใส่ API key ของ AI เองได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "settings.byok", origin: "coverage" },
  { q: "แนบรูปใบสั่งยาเก็บไว้ได้ไหม", locale: "th", context: CAPABILITIES, expect: "answer", expectTop: "pharmacy.evidence", origin: "coverage" },
];

/**
 * The original 51: every question the product ships as a chip plus everything verified by hand.
 * Coverage questions (one per catalog entry) are excluded so this count keeps meaning what it
 * meant when it was written.
 */
export const CORPUS_REAL_QUESTIONS = WORK_ASSISTANT_QUESTION_CORPUS.filter(
  (item) => item.expect !== "no-match" && item.origin !== "coverage"
);
