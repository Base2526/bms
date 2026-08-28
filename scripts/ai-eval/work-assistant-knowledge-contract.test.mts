import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { BMS_PERMISSIONS } from "../../apps/web/lib/bms/permissions.ts";
import {
  POS_REGISTER_SUGGESTIONS,
  SYSTEM_CAPABILITIES,
  SYSTEM_GUIDES,
  normalizeAssistantQuery,
  searchAssistantKnowledge,
} from "../../apps/web/lib/bms/assistantKnowledge/index.ts";

const WEB = path.resolve(import.meta.dirname, "../../apps/web");
const validPermissions = new Set<string>(BMS_PERMISSIONS);

test("assistant knowledge ids are unique and bilingual fields are complete", () => {
  const all = [...SYSTEM_CAPABILITIES, ...SYSTEM_GUIDES];
  const ids = all.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate knowledge id");
  assert.ok(SYSTEM_CAPABILITIES.length >= 35, "full-system capability coverage unexpectedly shrank");
  assert.ok(SYSTEM_GUIDES.length >= 60, "full-system guide coverage unexpectedly shrank");
  for (const entry of all) {
    assert.ok(entry.title.th.trim(), `${entry.id} missing Thai title`);
    assert.ok(entry.title.en.trim(), `${entry.id} missing English title`);
    assert.ok(entry.aliases.th.length > 0, `${entry.id} missing Thai aliases`);
    assert.ok(entry.aliases.en.length > 0, `${entry.id} missing English aliases`);
  }
});

test("catalog permissions and admin routes resolve to real application contracts", () => {
  for (const entry of [...SYSTEM_CAPABILITIES, ...SYSTEM_GUIDES]) {
    for (const permission of entry.requiredPermissions) {
      assert.ok(validPermissions.has(permission), `${entry.id} references unknown permission ${permission}`);
    }
    for (const permission of entry.anyOfPermissions ?? []) {
      assert.ok(validPermissions.has(permission), `${entry.id} references unknown alternative permission ${permission}`);
    }
    if (!entry.route) continue;
    assert.match(entry.route, /^\/admin\/[a-z0-9-/]+$/, `${entry.id} has an unsafe route`);
    const relative = entry.route.replace(/^\/admin\/?/, "");
    const routeDir = path.join(WEB, "app", "(admin)", "admin", ...relative.split("/"));
    // A directory is not a page: `/admin/post` has `[id]`/`new` children and no index, so it
    // 404s. The assistant hands `route` to the user as a link, so it must render.
    assert.ok(existsSync(path.join(routeDir, "page.tsx")), `${entry.id} route is not a rendered page: ${entry.route}`);
  }
});

test("every Admin sidebar route and routable Admin page has verified guide coverage", () => {
  const sidebar = readFileSync(path.join(WEB, "components", "AdminSidebar.tsx"), "utf8");
  const sidebarRoutes = new Set([...sidebar.matchAll(/link\('(\/admin[^']+)'/g)].map((match) => match[1]));
  sidebarRoutes.add("/admin/pharmacy-queue");
  const guideRoutes = new Set(SYSTEM_GUIDES.map((guide) => guide.route));
  // Documented-but-not-linkable subtrees (parent has no index page) still count as covered.
  const coveredPrefixes = new Set([
    ...guideRoutes,
    ...SYSTEM_GUIDES.flatMap((guide) => guide.coversRoutePrefixes ?? []),
  ]);
  for (const route of sidebarRoutes) assert.ok(guideRoutes.has(route), `sidebar route has no guide: ${route}`);

  const adminRoot = path.join(WEB, "app", "(admin)", "admin");
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name === "page.tsx" ? [path.join(dir, entry.name)] : []
  );
  const pageRoutes = walk(adminRoot).map((file) => {
    const suffix = path.dirname(file).slice(adminRoot.length).split(path.sep).filter(Boolean).join("/");
    return suffix ? `/admin/${suffix}` : "/admin";
  });
  const excluded = new Set(["/admin", "/admin/login"]);
  for (const route of pageRoutes.filter((item) => !excluded.has(item))) {
    assert.ok([...coveredPrefixes].some((covered) => route === covered || route.startsWith(`${covered}/`)), `Admin page has no guide: ${route}`);
  }
});

test("normalization is Unicode-safe and case-insensitive", () => {
  assert.equal(normalizeAssistantQuery("  ＳＵＰＲＩＭＳ  "), "suprims");
  assert.equal(normalizeAssistantQuery("สะสม   แต้ม"), "สะสม แต้ม");
});

test("capability search finds report formats and states the verified implementation status", () => {
  const results = searchAssistantKnowledge("export PDF Excel", { locale: "th", permissions: new Set(["report.view"]) });
  const report = results.find((entry) => entry.id === "reports.export");
  assert.ok(report, "report export capability was not retrieved");
  assert.equal(report.capabilityStatus, "AVAILABLE");
  assert.equal(report.accessible, true);
});

test("loyalty and coupon questions retrieve separate capability and guide knowledge", () => {
  const loyalty = searchAssistantKnowledge("ระบบมีสะสมแต้มไหม", { locale: "th" });
  assert.ok(loyalty.some((entry) => entry.id === "loyalty.points"));
  assert.ok(loyalty.some((entry) => entry.id === "loyalty.check-program"));

  const coupons = searchAssistantKnowledge("ตอนนี้มีคูปองอะไรใช้ได้บ้าง", { locale: "th" });
  assert.ok(coupons.some((entry) => entry.id === "coupons.promotions"));
  assert.ok(coupons.some((entry) => entry.id === "coupons.check-availability"));
});

test("common staff how-to questions resolve to actionable dedicated guides", () => {
  const expected = new Map([
    ["ร้านนี้คำนวณแต้มอย่างไร", "loyalty.calculate-points"],
    ["แต้มคิดก่อนหรือหลังหักส่วนลด", "loyalty.calculate-points"],
    ["สร้างคูปองและส่งให้ลูกค้ายังไง", "coupons.create-and-send"],
    ["เพิ่มพนักงานและกำหนดสิทธิ์ยังไง", "users.add-and-authorize"],
    ["ตั้งราคาส่งหรือโปรโมชันซื้อแถมยังไง", "products.pricing-promotions"],
    ["ทำไมสินค้ามีสต็อกแต่ขายไม่ได้", "inventory.stock-sale-blockers"],
    ["สินค้าที่จองไว้เป็นของออเดอร์ไหน", "inventory.reservation-owners"],
    ["ทำไมออเดอร์ยังเป็น Pending", "orders.pending-troubleshoot"],
    ["แก้ที่อยู่จัดส่งของลูกค้ายังไง", "customers.manage-address"],
    ["ส่งสินค้าและคูปองในแชทยังไง", "inbox.sell-from-conversation"],
    ["ทำไมจองขนส่งไม่สำเร็จ", "shipping.booking-troubleshoot"],
    ["ทำไมกดปุ่มนี้ไม่ได้", "permissions.action-unavailable"],
    ["ถ้าทำรายการซ้ำ ระบบจะบันทึกซ้ำไหม", "assistant.retry-safely"],
    ["ข้อมูลใน Dashboard อัปเดตล่าสุดเมื่อไร", "dashboard.data-freshness"],
  ]);
  for (const [query, guideId] of expected) {
    const results = searchAssistantKnowledge(query, { locale: "th", kind: "guide", limit: 10 });
    const hit = results.find((entry) => entry.id === guideId);
    assert.ok(hit?.matchedQuery, `${query} did not match ${guideId}`);
  }
});

test("search reports missing access instead of hiding product capability", () => {
  const denied = searchAssistantKnowledge("ค้นพนักงาน", { locale: "th", permissions: new Set() });
  const users = denied.find((entry) => entry.id === "users.access");
  assert.ok(users);
  assert.equal(users.accessible, false);
  assert.deepEqual(users.missingPermissions, ["user.view"]);
});

test("current page context improves relevant guide ranking but grants no permission", () => {
  const results = searchAssistantKnowledge("ทำยังไง", {
    locale: "th",
    currentPath: "/admin/pos-manual",
    pageId: "pos",
    permissions: new Set(),
  });
  assert.ok(results[0]?.id.startsWith("pos."), "current POS page should rank a POS guide first");
  assert.equal(results[0]?.accessible, false);
  assert.ok((results[0]?.missingPermissions.length ?? 0) > 0, "page context must not grant POS permission");
});

test("administrator audiences and alternative permissions are evaluated without granting access", () => {
  const ordinary = searchAssistantKnowledge("system health", { locale: "en", permissions: new Set(), role: "Sales", kind: "guide" });
  const health = ordinary.find((entry) => entry.id === "system-health.read");
  assert.ok(health);
  assert.equal(health.accessible, false);
  assert.equal(health.accessRequirement, "platform_administrator");

  const platform = searchAssistantKnowledge("system health", { locale: "en", permissions: new Set(), role: "Administrator", isPlatformAdmin: true, kind: "guide" });
  assert.equal(platform.find((entry) => entry.id === "system-health.read")?.accessible, true);

  const deviceByPinPermission = searchAssistantKnowledge("ตั้ง PIN POS", { locale: "th", permissions: new Set(["pos.pin.manage"]), kind: "guide" });
  assert.equal(deviceByPinPermission.find((entry) => entry.id === "pos.configure-devices")?.accessible, true);
});

test("kind-specific retrieval cannot be crowded out by the other knowledge kind", () => {
  const capabilities = searchAssistantKnowledge("POS", { locale: "en", kind: "capability", limit: 20 });
  assert.ok(capabilities.length > 0);
  assert.ok(capabilities.every((entry) => entry.kind === "capability"));
  const guides = searchAssistantKnowledge("POS", { locale: "en", kind: "guide", limit: 20 });
  assert.ok(guides.length > 0);
  assert.ok(guides.every((entry) => entry.kind === "guide"));
});

test("high-frequency system modules have at least one verified guide", () => {
  const modules = new Set(SYSTEM_GUIDES.map((guide) => guide.module));
  for (const module of ["dashboard", "products", "inventory", "orders", "payments", "shipping", "purchase", "customers", "inbox", "reports", "users", "pos", "pharmacy", "system-health"]) {
    assert.ok(modules.has(module), `missing guide coverage for ${module}`);
  }
});

test("POS safety questions retrieve the matching verified workflow", () => {
  const discount = searchAssistantKnowledge("ทำไมส่วนลดต้องใช้ PIN คนที่สอง", { locale: "th", pageId: "pos" });
  assert.equal(discount[0]?.id, "pos.manual-discount");
  const reversal = searchAssistantKnowledge("Void ต่างจาก Return ยังไง", { locale: "th", pageId: "pos" });
  assert.equal(reversal[0]?.id, "pos.void-return");
});

test("every primary POS menu and setup question resolves to a dedicated guide", () => {
  const expected = new Map([
    ["เมนูขาย", "pos.build-sale"], ["รับชำระ", "pos.take-payment"],
    ["คืนสินค้าและ Void", "pos.void-return"], ["เมนูรับของ", "pos.receive-purchase"],
    ["เมนูมัดจำ", "pos.manage-deposit"], ["รายงานกะ", "pos.shift-reports"],
    ["ตั้งค่า scanner", "pos.device-settings"],
    // Register workflows that exist as /api/pos/* routes and must not be silently uncovered.
    ["ขายเชื่อ", "pos.credit-sale"], ["บัตรของขวัญ", "pos.use-store-credit"],
    ["คืนของไม่มีใบเสร็จ", "pos.blind-return"], ["ขายยา", "pos.pharmacist-authorization"],
    ["เปิดลิ้นชัก", "pos.cash-movement"], ["ใบกำกับภาษี", "pos.receipt-display"],
  ]);
  for (const [query, guideId] of expected) {
    const result = searchAssistantKnowledge(query, { locale: "th", pageId: "pos", currentPath: "/admin/pos-manual", kind: "guide" });
    assert.equal(result[0]?.id, guideId, `${query} did not resolve to its dedicated guide`);
  }
});

test("page context re-ranks but never fabricates a match", () => {
  // The current-page bonus (+10) is larger than the resolver's relevance floor, so without a
  // separate match signal every guide on the page answers every question — and both the POS
  // "no verified guide" branch and honest citations become impossible.
  const unrelated = searchAssistantKnowledge("xyzzy", { locale: "th", pageId: "pos", currentPath: "/admin/pos-manual" });
  assert.ok(unrelated.length > 0, "page context should still surface the page's own guides");
  assert.ok(unrelated.every((entry) => entry.matchedQuery === false), "unmatched query must not be reported as a match");

  const related = searchAssistantKnowledge("ทำไมส่วนลดต้องใช้ PIN คนที่สอง", { locale: "th", pageId: "pos" });
  assert.equal(related[0]?.matchedQuery, true);
});

test("the register surface excludes POS back-office guides a pos_only account cannot open", () => {
  // pos.configure-devices and pos.review-readiness share the "pos." id prefix but live on
  // /admin/**, which a pos_only cashier cannot reach at all.
  const registerGuides = SYSTEM_GUIDES.filter((guide) => guide.pageId === "pos");
  assert.ok(registerGuides.length >= 14, "register guide coverage shrank");
  for (const guide of registerGuides) {
    assert.equal(guide.route, "/admin/pos-manual", `${guide.id} is not a register guide`);
  }
  const backOffice = SYSTEM_GUIDES.filter((guide) => guide.id.startsWith("pos.") && guide.pageId !== "pos");
  assert.ok(backOffice.length > 0, "expected POS back-office guides to exist and be excluded");
  for (const guide of backOffice) {
    assert.notEqual(guide.route, "/admin/pos-manual");
  }
});

test("capability status tells the truth about what is not live yet", () => {
  const byId = new Map(SYSTEM_CAPABILITIES.map((entry) => [entry.id, entry]));
  // Shipping itself works; only the carrier adapters are scaffolds. One entry cannot say both.
  assert.equal(byId.get("shipping.fulfillment")?.status, "AVAILABLE");
  assert.equal(byId.get("shipping.carrier-integrations")?.status, "MOCK");
  // Built but never verified end to end — CONDITIONAL reads as "just switch it on".
  for (const id of ["tax.etax", "settings.marketplaces", "pos.hardware-printing"]) {
    assert.equal(byId.get(id)?.status, "BETA", `${id} should be reported as BETA`);
  }
});

test("every register starter question resolves to a register guide in both languages", () => {
  const registerIds = new Set(SYSTEM_GUIDES.filter((guide) => guide.pageId === "pos").map((guide) => guide.id));
  for (const locale of ["th", "en"] as const) {
    for (const question of POS_REGISTER_SUGGESTIONS[locale]) {
      const hit = searchAssistantKnowledge(question, {
        locale, currentPath: "/admin/pos-manual", pageId: "pos", kind: "guide", limit: 10,
      }).find((entry) => registerIds.has(entry.id) && entry.matchedQuery);
      // A chip that answers "no verified guide" is worse than no chip: the cashier reads it as
      // "the register cannot do this".
      assert.ok(hit, `register chip has no verified guide (${locale}): ${question}`);
    }
  }
});
