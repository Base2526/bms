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
  why?: string;
}>;

/** Register questions are asked from `/pos`, which searches guides only. */
const REGISTER = { currentPath: "/admin/pos-manual", pageId: "pos", kind: "guide" } as const;
/** The Drawer sends the page the user is standing on. Orders is used as a representative page. */
const ON_ORDERS_PAGE = { currentPath: "/admin/orders", pageId: "orders" } as const;

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
];

/** Questions asked by a person (the 51); the rest are deliberate empty-answer guards. */
export const CORPUS_REAL_QUESTIONS = WORK_ASSISTANT_QUESTION_CORPUS.filter(
  (item) => item.expect !== "no-match"
);
