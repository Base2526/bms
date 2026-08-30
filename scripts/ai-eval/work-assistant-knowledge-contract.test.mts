import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { BMS_PERMISSIONS } from "../../apps/web/lib/bms/permissions.ts";
import {
  SYSTEM_CAPABILITIES,
  SYSTEM_GUIDES,
  guideCoversCurrentPath,
  isComprehensiveCurrentPageHelpRequest,
  isCurrentPageHelpRequest,
  normalizeAssistantQuery,
  searchAssistantKnowledge,
} from "../../apps/web/lib/bms/assistantKnowledge/index.ts";

const WEB = path.resolve(import.meta.dirname, "../../apps/web");
const validPermissions = new Set<string>(BMS_PERMISSIONS);

test("current-page help is explicit and does not swallow named workflows", () => {
  for (const message of [
    "หน้านี้ใช้งานอย่างไร",
    "หน้านี้ทำอะไร",
    "หน้านี้มีไว้ทำอะไร",
    "ช่วยอธิบายวิธีการใช้งานของหน้านี้ทั้งหมดแบบละเอียด",
    "หน้าที่กำลังเปิดอยู่ใช้ทำอะไรได้บ้างครับ",
    "อธิบายทั้งหมด วิธีใช้งานหน้านี้",
    "What can I do on this page?",
    "What does this page do?",
    "Explain the current page",
  ]) {
    assert.equal(isCurrentPageHelpRequest(message), true, message);
  }
  for (const message of [
    "ปิดกะ POS ยังไง",
    "กะนี้ปิดได้หรือยัง",
    "How do I close a POS shift?",
    "I cannot use this page",
    "หน้านี้ใช้งานไม่ได้",
    "ทำไมหน้านี้โหลดช้า",
    "What is wrong with this page?",
    "Why is this page not working?",
  ]) {
    assert.equal(isCurrentPageHelpRequest(message), false, message);
  }
  assert.equal(isComprehensiveCurrentPageHelpRequest("หน้านี้ทำอะไร"), false);
  assert.equal(isComprehensiveCurrentPageHelpRequest("อธิบายทุกเมนูในหน้านี้แบบละเอียด"), true);
  assert.equal(isComprehensiveCurrentPageHelpRequest("Explain all features on this page in detail"), true);

  const dashboardContext = {
    locale: "th" as const,
    currentPath: "/admin/dashboard",
    pageId: "dashboard",
    permissions: new Set(["report.view"]),
    kind: "guide" as const,
    limit: 5,
  };
  assert.equal(
    searchAssistantKnowledge("หน้านี้ใช้งานอย่างไร", dashboardContext)[0]?.id,
    "dashboard.daily-review",
    "Dashboard page help must not inherit an earlier POS topic"
  );
  assert.equal(
    searchAssistantKnowledge("ปิดกะ POS ยังไง", dashboardContext)[0]?.id,
    "pos.shift",
    "an explicitly named POS workflow must still outrank the open Dashboard page"
  );

  const inboxContext = {
    ...dashboardContext,
    currentPath: "/admin/inbox",
    pageId: "inbox",
    permissions: new Set(["inbox.view"]),
  };
  assert.equal(
    searchAssistantKnowledge("หน้านี้ทำอะไร", inboxContext)[0]?.id,
    "inbox.handle-conversation",
    "the short wording used in the Inbox must resolve from its current route"
  );
});

test("current-page route matching covers every catalog route and only declared detail prefixes", () => {
  for (const guide of SYSTEM_GUIDES) {
    assert.equal(guideCoversCurrentPath(guide, guide.route), true, `${guide.id} misses its own route`);
    assert.equal(
      guideCoversCurrentPath(guide, `${guide.route}/example-detail`),
      true,
      `${guide.id} misses a child route`
    );
    for (const prefix of guide.coversRoutePrefixes ?? []) {
      assert.equal(guideCoversCurrentPath(guide, prefix), true, `${guide.id} misses prefix ${prefix}`);
      assert.equal(
        guideCoversCurrentPath(guide, `${prefix}/example-detail`),
        true,
        `${guide.id} misses child of prefix ${prefix}`
      );
    }
    assert.equal(
      guideCoversCurrentPath(guide, `${guide.route}-different`),
      false,
      `${guide.id} accepts a sibling route with the same text prefix`
    );
  }
});

test("current-page retrieval returns the complete declared guide set for every route", () => {
  const permissions = new Set<string>(BMS_PERMISSIONS);
  const routes = [...new Set(SYSTEM_GUIDES.map((guide) => guide.route))];
  for (const currentPath of routes) {
    const expected = SYSTEM_GUIDES
      .filter((guide) => guideCoversCurrentPath(guide, currentPath))
      .map((guide) => guide.id)
      .sort();
    for (const message of ["หน้านี้ทำอะไร", "อธิบายทุกเมนูในหน้านี้ทั้งหมดแบบละเอียด"]) {
      const actual = searchAssistantKnowledge(message, {
        locale: "th",
        currentPath,
        permissions,
        kind: "guide",
        limit: SYSTEM_GUIDES.length,
      })
        .filter((entry) => {
          const guide = SYSTEM_GUIDES.find((candidate) => candidate.id === entry.id);
          return guide ? guideCoversCurrentPath(guide, currentPath) : false;
        })
        .map((entry) => entry.id)
        .sort();
      assert.deepEqual(actual, expected, `${currentPath} lost guides for "${message}"`);
    }
  }
});

/**
 * Question-level expectations live in `work-assistant-question-corpus.mts` and are asserted by
 * `work-assistant-question-corpus.test.mts`: every question the product asks must be *led* by the
 * entry that answers it, not merely contain it somewhere in the result list. The lists that used
 * to sit here (staff how-to questions, POS menu questions, register chips, the loyalty/coupon
 * split, the POS safety questions) moved there so there is one list to keep true, not two.
 */
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
