// Database-free contract for Admin navigation policy.
// Run from apps/web: npx tsx --test ../../scripts/admin-navigation-contract.test.mts
//
// The menu is presentation, never authorization — every assertion here is about what a user is
// *shown*. Two failure modes matter and both are silent in a browser: an entry narrower than its
// page (work becomes unreachable) and an entry wider than its page (a link to an access screen).

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { computeAdminNavSearchResults } from "../apps/web/components/work-assistant/adminNavSearch.ts";
import * as assistantCatalog from "../apps/web/lib/bms/assistantKnowledge/index.ts";
import {
  ADMIN_NAV_FOOTER_ROUTES,
  ADMIN_NAV_ITEMS,
  ADMIN_NAV_SECTION_LABELS,
  buildAdminNavigation,
  emphasisItemIdsForArchetype,
  firstAdminDestination,
  hasPlatformWorkspace,
  selectAdminNavItem,
  workspaceForRoute,
  type AdminNavContext,
} from "../apps/web/lib/bms/adminNavigation.ts";
import { SHOP_ARCHETYPE_OPTIONS } from "../apps/web/lib/bms/shopArchetypes.ts";
import en from "../apps/web/i18n/en.ts";
import th from "../apps/web/i18n/th.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps", "web");
const ADMIN_ROOT = path.join(WEB, "app", "(admin)", "admin");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const ARCHETYPES = SHOP_ARCHETYPE_OPTIONS.map((option) => option.value);

const ctx = (overrides: Partial<AdminNavContext> = {}): AdminNavContext => ({
  can: () => false,
  isPlatformAdmin: false,
  isAdministrator: false,
  archetype: null,
  kitchenBoardEnabled: false,
  wastageEnabled: false,
  packToolsConfigured: false,
  ...overrides,
});

const withPermissions = (permissions: string[], overrides: Partial<AdminNavContext> = {}) =>
  ctx({ can: (permission) => permissions.includes(permission), ...overrides });

/** Administrator holds every permission implicitly and has no bms_role_permissions rows. */
const administrator = (overrides: Partial<AdminNavContext> = {}) =>
  ctx({ can: () => true, isAdministrator: true, ...overrides });

const routesOf = (nav: ReturnType<typeof buildAdminNavigation>) =>
  [...nav.topLevel, ...nav.sections.flatMap((section) => section.items)].map((item) => item.route);

const resolve = (dictionary: unknown, key: string): unknown =>
  key.split(".").reduce<any>((node, part) => (node == null ? undefined : node[part]), dictionary);

test("every declared entry points at a page that renders, in both languages", () => {
  assert.ok(ADMIN_NAV_ITEMS.length > 0);
  const ids = ADMIN_NAV_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "navigation ids must be unique");
  const routes = ADMIN_NAV_ITEMS.map((item) => item.route);
  assert.equal(new Set(routes).size, routes.length, "a destination must appear once in the menu");

  for (const item of ADMIN_NAV_ITEMS) {
    const relative = item.route.replace(/^\/admin\/?/, "");
    const dir = path.join(ADMIN_ROOT, ...relative.split("/").filter(Boolean));
    // A directory is not a page. The sidebar hands `route` to the browser as a link, so a menu
    // entry for a directory without an index page is a 404 the user has no way to predict.
    assert.ok(existsSync(path.join(dir, "page.tsx")), `${item.id} route is not a rendered page: ${item.route}`);
    // Labels are resolved with t(item.labelKey), which the i18n literal scanner cannot see —
    // a missing key renders the raw key on a shop's screen without failing the build.
    assert.equal(typeof resolve(th, item.labelKey), "string", `${item.id} has no Thai label: ${item.labelKey}`);
    assert.equal(typeof resolve(en, item.labelKey), "string", `${item.id} has no English label: ${item.labelKey}`);
  }

  for (const [section, labelKey] of Object.entries(ADMIN_NAV_SECTION_LABELS)) {
    assert.equal(typeof resolve(th, labelKey), "string", `section ${section} has no Thai label`);
    assert.equal(typeof resolve(en, labelKey), "string", `section ${section} has no English label`);
  }
  for (const key of [
    "admin_nav.workspace_shop", "admin_nav.workspace_platform", "admin_nav.workspace_switch_label",
    "admin_nav.search_placeholder", "admin_nav.search_hint", "admin_nav.search_empty",
  ]) {
    assert.equal(typeof resolve(th, key), "string", `${key} has no Thai label`);
    assert.equal(typeof resolve(en, key), "string", `${key} has no English label`);
  }
});

test("every Admin page keeps an entry point for someone who is allowed to open it", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name === "page.tsx" ? [path.join(dir, entry.name)] : []
  );
  const pageRoutes = walk(ADMIN_ROOT).map((file) => {
    const suffix = path.dirname(file).slice(ADMIN_ROOT.length).split(path.sep).filter(Boolean).join("/");
    return suffix ? `/admin/${suffix}` : "/admin";
  }).filter((route) => !route.includes("["));

  // Reached without a menu entry by design: the shell itself, the login screen, the profile card
  // in the sidebar footer, an unreleased mockup, and detail pages under a listed parent.
  const reachedWithoutMenu = new Set([
    "/admin", "/admin/login", "/admin/profile", "/admin/pharmacy-review-mockup",
  ]);
  const owned = new Set([
    ...ADMIN_NAV_ITEMS.flatMap((item) => [item.route, ...(item.ownsRoutePrefixes ?? [])]),
    ...ADMIN_NAV_FOOTER_ROUTES,
  ]);
  for (const route of pageRoutes) {
    if (reachedWithoutMenu.has(route)) continue;
    assert.ok(
      [...owned].some((entry) => route === entry || route.startsWith(`${entry}/`)),
      `Admin page has no navigation entry: ${route}`
    );
  }
});

test("menu guards match the read gate of the page they open", () => {
  // POS Readiness reads with all four permissions; three of them must not show the entry.
  const posPermissions = ["pos.device.manage", "pharmacy.policy.read", "product.view", "stock.adjust"];
  const readinessPage = source("apps/web/app/(admin)/admin/pos-readiness/page.tsx");
  for (const permission of posPermissions) {
    assert.match(readinessPage, new RegExp(`can\\("${permission.replace(/\./g, "\\.")}"\\)`),
      `pos-readiness no longer reads ${permission}; the sidebar guard must follow the page`);
  }
  for (const missing of posPermissions) {
    const partial = posPermissions.filter((permission) => permission !== missing);
    assert.ok(
      !routesOf(buildAdminNavigation(withPermissions(partial), "SHOP")).includes("/admin/pos-readiness"),
      `POS Readiness is offered without ${missing}, which the page requires`
    );
  }
  assert.ok(routesOf(buildAdminNavigation(withPermissions(posPermissions), "SHOP")).includes("/admin/pos-readiness"));

  // The follow-up queue renders the retention board for retention.view alone.
  const queuePage = source("apps/web/app/(admin)/admin/followup-queue/page.tsx");
  assert.match(queuePage, /!canViewFollowups && !canViewRetention/,
    "the page still admits either permission; the sidebar guard must admit both");
  for (const permission of ["followup.view", "retention.view"]) {
    assert.ok(
      routesOf(buildAdminNavigation(withPermissions([permission]), "SHOP")).includes("/admin/followup-queue"),
      `a role holding only ${permission} has no route to the queue it owns`
    );
  }
  assert.ok(!routesOf(buildAdminNavigation(ctx(), "SHOP")).includes("/admin/followup-queue"));
});

test("a catalog manager with product.view alone reaches every product tool", () => {
  const sections = buildAdminNavigation(withPermissions(["product.view"], { packToolsConfigured: true }), "SHOP");
  const routes = routesOf(sections);
  // Pack and label tools used to sit inside a POS-conditional group, so this exact permission set
  // saw no way in even though both pages read with product.view.
  for (const route of ["/admin/products", "/admin/stock-models", "/admin/product-packs", "/admin/product-labels"]) {
    assert.ok(routes.includes(route), `product.view cannot reach ${route}`);
  }
  assert.ok(!routes.includes("/admin/orders"));
  assert.ok(!routes.includes("/admin/payment"));
  assert.ok(!routes.includes("/admin/users"), "product.view must not expose the team list");
  assert.ok(!routes.includes("/admin/wastage"), "wastage needs a real capability signal, not product.view alone");
});

test("empty sections never render, and a shop with no permissions still has a way to start", () => {
  const bare = buildAdminNavigation(ctx(), "SHOP");
  for (const section of bare.sections) {
    assert.ok(section.items.length > 0, `section ${section.id} rendered with no reachable item`);
  }
  const routes = routesOf(bare);
  // Getting started, the assistant, store settings and billing are open to any admin session:
  // a brand-new shop with no permission rows must still be able to configure itself.
  assert.deepEqual(bare.sections.map((section) => section.id), ["settings"]);
  assert.deepEqual(bare.topLevel, [], "no home and no queue for an account that can open neither");
  assert.ok(routes.includes("/admin/getting-started"));
  assert.ok(routes.includes("/admin/settings"));
  assert.ok(!routes.includes("/admin/dashboard"), "the dashboard reads report.view");
});

test("capability-driven entries follow real signals, not the archetype alone", () => {
  const orderViewer = (overrides: Partial<AdminNavContext>) =>
    routesOf(buildAdminNavigation(withPermissions(["order.view", "product.view"], overrides), "SHOP"));

  // A general shop that turned the kitchen queue on must reach the board; the tickets exist.
  assert.ok(orderViewer({ archetype: "mini_mart", kitchenBoardEnabled: true }).includes("/admin/kitchen"));
  assert.ok(!orderViewer({ archetype: "restaurant", kitchenBoardEnabled: false }).includes("/admin/kitchen"),
    "no capability means no tickets, so the board would always be empty");
  // A restaurant that set up packs keeps managing them even though its preset does not include PACK.
  assert.ok(orderViewer({ archetype: "restaurant", packToolsConfigured: true }).includes("/admin/product-packs"));
  assert.ok(!orderViewer({ archetype: "restaurant" }).includes("/admin/product-packs"));
  assert.ok(orderViewer({ archetype: "mini_mart" }).includes("/admin/product-packs"),
    "the archetype recommends packs, so the first-time setup route must be discoverable");
  // Wastage: recommended by the archetype or configured by the shop, either is enough.
  assert.ok(orderViewer({ archetype: "restaurant" }).includes("/admin/wastage"));
  assert.ok(orderViewer({ archetype: "fashion", wastageEnabled: true }).includes("/admin/wastage"));
  assert.ok(!orderViewer({ archetype: "fashion" }).includes("/admin/wastage"));
});

test("pharmacy work appears only for a pharmacy, and never disappears from one", () => {
  const pharmacist = ["pharmacy.assessment.read", "pharmacy.protocol.manage"];
  const inPharmacy = routesOf(buildAdminNavigation(withPermissions(pharmacist, { archetype: "pharmacy" }), "SHOP"));
  assert.ok(inPharmacy.includes("/admin/pharmacy-queue"));
  assert.ok(inPharmacy.includes("/admin/pharmacy-protocols"));
  const elsewhere = routesOf(buildAdminNavigation(withPermissions(pharmacist, { archetype: "mini_mart" }), "SHOP"));
  assert.ok(!elsewhere.some((route) => route.startsWith("/admin/pharmacy")));
  // Licenses are Administrator-only, matching the page.
  const licences = routesOf(buildAdminNavigation(administrator({ archetype: "pharmacy" }), "SHOP"));
  assert.ok(licences.includes("/admin/pharmacy-protocols/licenses"));
  assert.ok(!routesOf(buildAdminNavigation(withPermissions(pharmacist, { archetype: "pharmacy" }), "SHOP"))
    .includes("/admin/pharmacy-protocols/licenses"));
});

test("every archetype including unknown produces a usable shop menu", () => {
  for (const archetype of [...ARCHETYPES, null, "not-a-real-archetype"]) {
    const nav = buildAdminNavigation(administrator({ archetype }), "SHOP");
    const sections = nav.sections;
    assert.ok(sections.length >= 5, `${archetype} produced only ${sections.length} sections`);
    const routes = routesOf(nav);
    for (const route of ["/admin/orders", "/admin/products", "/admin/payment", "/admin/settings"]) {
      assert.ok(routes.includes(route), `${archetype} lost core route ${route}`);
    }
    assert.equal(new Set(routes).size, routes.length, `${archetype} lists a destination twice`);
    // Emphasis reorders inside a section; it must never invent or drop an entry.
    const emphasised = emphasisItemIdsForArchetype(archetype);
    const visibleIds = new Set(sections.flatMap((section) => section.items.map((item) => item.id)));
    for (const id of emphasised) {
      const entry = ADMIN_NAV_ITEMS.find((item) => item.id === id)!;
      assert.equal(entry.topLevel, undefined,
        `${archetype} emphasises ${id}, but the top strip keeps a fixed order so this does nothing`);
    }
    for (const id of emphasised) {
      assert.ok(ADMIN_NAV_ITEMS.some((item) => item.id === id), `${archetype} emphasises unknown entry ${id}`);
    }
    for (const section of sections) {
      const ordered = section.items.map((item) => item.id);
      const pinned = ordered.filter((id) => emphasised.includes(id));
      // Pinned entries come first, in the order the archetype declares them.
      assert.deepEqual(
        ordered.slice(0, pinned.length),
        emphasised.filter((id) => visibleIds.has(id) && ordered.includes(id)),
        `${archetype} did not float its emphasised ${section.id} entries to the top`
      );
    }
  }
});

test("emphasis for a restaurant and a mini mart differ without hiding anything", () => {
  const restaurant = buildAdminNavigation(administrator({ archetype: "restaurant", kitchenBoardEnabled: true }), "SHOP");
  const miniMart = buildAdminNavigation(administrator({ archetype: "mini_mart", kitchenBoardEnabled: true }), "SHOP");
  const firstSales = (nav: typeof restaurant) =>
    nav.sections.find((section) => section.id === "sales")!.items[0].id;
  assert.equal(firstSales(restaurant), "sales.kitchen");
  assert.notEqual(firstSales(miniMart), "sales.kitchen");
  // Archetype changes order, not reach. The only entries whose *visibility* differs are the ones
  // driven by a real capability signal (packs, wastage) — asserted in the capability test above.
  const capabilityDriven = new Set(["/admin/product-packs", "/admin/product-labels", "/admin/wastage"]);
  const comparable = (sections: typeof restaurant) =>
    routesOf(sections).filter((route) => !capabilityDriven.has(route)).sort();
  assert.deepEqual(comparable(restaurant), comparable(miniMart),
    "the same permissions must reach the same pages regardless of archetype");
  // Both archetypes still see the same *sections*, so nobody has to learn a different Admin.
  assert.deepEqual(restaurant.sections.map((s) => s.id), miniMart.sections.map((s) => s.id));
});

test("platform tools are separated from shop work and hidden from shop staff", () => {
  const shopAdmin = administrator({ archetype: "mini_mart" });
  assert.equal(hasPlatformWorkspace(shopAdmin), false, "a shop Administrator must not see the platform area");
  assert.deepEqual(buildAdminNavigation(shopAdmin, "PLATFORM"), { topLevel: [], sections: [] });

  const platformAdmin = administrator({ isPlatformAdmin: true, archetype: "mini_mart" });
  assert.equal(hasPlatformWorkspace(platformAdmin), true);
  const platformRoutes = routesOf(buildAdminNavigation(platformAdmin, "PLATFORM"));
  for (const route of ["/admin/env", "/admin/logs", "/admin/system-health", "/admin/dev/sql-console", "/admin/dev/fake", "/admin/tenants", "/admin/roles"]) {
    assert.ok(platformRoutes.includes(route), `platform workspace is missing ${route}`);
  }
  // The shop area stays complete for the same person: switching areas is not switching tenants.
  const shopRoutes = routesOf(buildAdminNavigation(platformAdmin, "SHOP"));
  assert.ok(shopRoutes.includes("/admin/orders"));
  assert.ok(!shopRoutes.some((route) => platformRoutes.includes(route)), "an entry belongs to one workspace");

  // AI Quality and Playground are tenant permissions, so they stay in the shop area.
  const aiReviewer = withPermissions(["ai_quality.view"]);
  const aiRoutes = routesOf(buildAdminNavigation(aiReviewer, "SHOP"));
  assert.ok(aiRoutes.includes("/admin/ai-quality"));
  assert.ok(aiRoutes.includes("/admin/playground"));
  assert.equal(hasPlatformWorkspace(aiReviewer), false);
});

test("a route selects the most specific entry that owns it", () => {
  const cases: Array<[string, string | null]> = [
    ["/admin/inbox", "customers.inbox"],
    ["/admin/inbox/mentions", "customers.mentions"],
    ["/admin/inbox/realtime-diagnostics", "settings.realtime-diagnostics"],
    ["/admin/users", "settings.users"],
    ["/admin/users/new", "settings.users"],
    ["/admin/users/42/edit", "settings.users"],
    ["/admin/pharmacy-protocols", "shopfloor.pharmacy-protocols"],
    ["/admin/pharmacy-protocols/licenses", "shopfloor.pharmacist-licenses"],
    ["/admin/pharmacy-queue/abcd1234", "shopfloor.pharmacy-queue"],
    ["/admin/logs/timeline", "platform.logs"],
    ["/admin/logs/12/view", "platform.logs"],
    ["/admin/post/12/edit", "platform.posts"],
    ["/admin/dev/fake", "platform.fake-data"],
    ["/admin/dev/sql-console", "platform.sql-console"],
    ["/admin/profile", null],
    ["/admin", null],
    ["/admin/orders-archive", null],
  ];
  for (const [pathname, expected] of cases) {
    assert.equal(selectAdminNavItem(pathname)?.id ?? null, expected, `wrong entry selected for ${pathname}`);
  }
  assert.equal(selectAdminNavItem(null), null);
});

test("the visible group follows the URL, so deep links and Back stay consistent", () => {
  assert.equal(workspaceForRoute("/admin/env"), "PLATFORM");
  assert.equal(workspaceForRoute("/admin/orders"), "SHOP");
  assert.equal(workspaceForRoute("/admin/post/9/edit"), "PLATFORM");
  // Unknown routes keep whatever the operator chose rather than forcing an area.
  assert.equal(workspaceForRoute("/admin/profile"), null);

  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  assert.match(sidebar, /const routeWorkspace = workspaceForRoute\(pathname\)/);
  assert.match(sidebar, /routeWorkspace \?\? workspace/,
    "the route must win over the remembered workspace, or Back leaves the menu on the wrong area");
  assert.match(sidebar, /activeSectionKey = selectedNavItem/);
  // Moving to another section opens that one section. An earlier version of this appended, so
  // walking through five sections left the whole menu expanded — the opposite of grouping it.
  assert.match(sidebar, /prev\.includes\(activeSectionKey\) \? prev : \[activeSectionKey\]/);
  // Picking an area while standing on a page of the other area must move the user, because the
  // route deliberately wins over the remembered choice.
  assert.match(sidebar, /if \(routeWorkspace && routeWorkspace !== next\)[\s\S]{0,220}router\.push\(target\)/);
  assert.match(sidebar, /openKeys=\{openKeys\}/,
    "openKeys must be controlled; defaultOpenKeys only applies on mount so navigation would not open the new group");
});

test("the sidebar renders one menu definition and no placeholder badges", () => {
  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  // The pharmacy queue has a custom two-pill renderer; it must still take its name from the entry's
  // labelKey. Reading its own key gave that one menu item two names, so renaming it did nothing.
  // Both the key and the label come from the entry, so the custom renderer can never drift from
  // selectedKeys or carry a second name for the same destination.
  assert.match(sidebar, /pharmacyQueueLink\(\s*item\.route,\s*t\(item\.labelKey\)/);
  assert.doesNotMatch(sidebar, /key: '\/admin\/pharmacy-queue'/);
  assert.doesNotMatch(sidebar, /admin\.menu_pharmacy_intake_queue/);
  assert.match(sidebar, /buildAdminNavigation\(navContext, effectiveWorkspace\)/);
  // Desktop, the collapsed rail and the mobile Drawer all render sidebarBody, which renders `items`.
  assert.equal((sidebar.match(/items=\{items\}/g) ?? []).length, 1);
  assert.match(sidebar, /sidebarBody\(false, true\)/, "the mobile Drawer must reuse the same menu body");

  // Posts/Files/Logs shipped hardcoded counts (2/5/1) that read as unread work. Asserting those
  // exact call sites are gone is now vacuous — the shell has one `link(item.route, ...)` call — so
  // assert the shape instead: the badge argument may only come from a polled counter.
  assert.match(sidebar, /item\.badge \? badgeCounts\[item\.badge\] : 0/);
  const linkCall = sidebar.slice(sidebar.indexOf("        : link("), sidebar.indexOf("    )),"));
  assert.doesNotMatch(linkCall, /,\s*\d+\s*,/, `a literal badge count is being passed: ${linkCall}`);
  // NAV_ICONS falls back to a generic grid icon, which silently hides a forgotten mapping.
  const iconBlock = sidebar.slice(sidebar.indexOf("const NAV_ICONS"), sidebar.indexOf("const WORKSPACE_STORAGE_KEY"));
  for (const item of ADMIN_NAV_ITEMS) {
    assert.ok(iconBlock.includes(`'${item.id}':`), `${item.id} has no icon and would render the fallback`);
  }
  const badgeSources = new Set(ADMIN_NAV_ITEMS.map((item) => item.badge).filter(Boolean));
  for (const badge of badgeSources) {
    assert.match(sidebar, new RegExp(`${badge}:`), `badge ${badge} has no counter wired in the shell`);
  }
  // The footer keeps the manual pinned; ADMIN_NAV_FOOTER_ROUTES is what coverage checks read.
  const footer = sidebar.slice(sidebar.indexOf("ผู้ช่วย AI + คู่มือ"), sidebar.indexOf("{admin && ("));
  for (const route of ADMIN_NAV_FOOTER_ROUTES) {
    assert.ok(footer.includes(route), `footer route ${route} is no longer rendered`);
  }

  // Hiding a menu entry is not authorization: the shell must not be the only check.
  assert.doesNotMatch(sidebar, /requirePermission|verifyAdminSession/);
});

test("/admin lands on a page the signed-in role can actually open", () => {
  // report.view gates the dashboard, so this exact role used to sign in and land on a warning.
  // No dashboard and no queue: land on the first thing this role actually works in.
  assert.equal(firstAdminDestination(withPermissions(["inventory.count", "product.view"])), "/admin/products");
  // Whole job is the inbox: land there rather than on some unrelated first section.
  assert.equal(firstAdminDestination(withPermissions(["inbox.view"])), "/admin/inbox");
  assert.equal(firstAdminDestination(withPermissions(["report.view"])), "/admin/dashboard");
  assert.equal(firstAdminDestination(administrator()), "/admin/dashboard");
  // Even a session with no permission rows at all gets somewhere it can use.
  assert.equal(firstAdminDestination(ctx()), "/admin/getting-started");
  assert.equal(firstAdminDestination(withPermissions(["report.view", "inbox.view"])), "/admin/dashboard",
    "the dashboard outranks a queue when the account can read it");
  for (const archetype of [...ARCHETYPES, null]) {
    const destination = firstAdminDestination(administrator({ archetype }));
    assert.ok(ADMIN_NAV_ITEMS.some((item) => item.route === destination), `${archetype} lands nowhere`);
  }

  // Every guard that bounces someone into the shop has the same problem as /admin used to: the
  // account it rejects may be exactly the one that cannot read the dashboard.
  for (const guard of [
    "apps/web/lib/auth/platform-page.ts",
    "apps/web/lib/auth/tenant-admin-page.ts",
    "apps/web/app/(admin)/admin/login/layout.tsx",
    "apps/web/app/(auth)/shop-signup/layout.tsx",
  ]) {
    assert.doesNotMatch(source(guard), /redirect\("\/admin\/dashboard"\)/,
      `${guard} still hardcodes the dashboard, which reads report.view`);
    assert.match(source(guard), /redirect\("\/admin"\)/, `${guard} no longer bounces into the shop`);
  }

  // ⚠️ Those guards now bounce to /admin, which decides the destination. A server guard on the
  // Admin shell layout would therefore redirect /admin to itself forever, so the shell must stay
  // guard-free (middleware already enforces "must be signed in" for /admin/**).
  assert.doesNotMatch(source("apps/web/app/(admin)/admin/layout.tsx"), /redirect\(/,
    "a redirect in the Admin shell layout would loop against /admin's landing logic");

  const home = source("apps/web/app/(admin)/admin/page.tsx");
  assert.match(home, /firstAdminDestination\(/);
  // Any literal destination here defeats the point: the landing page must be whatever the policy
  // says this account can open. Matching only the old `redirect("/admin/dashboard")` spelling let a
  // `router.replace("/admin/dashboard")` slip straight past this test.
  assert.doesNotMatch(home, /"\/admin\/[a-z-]/,
    "the landing route must come from the navigation policy, not a literal in this page");
});

test("the manual's sidebar map documents exactly what the sidebar shows", () => {
  // The manual keeps its own bilingual notes per destination, so it is a second copy of the menu
  // structure by necessity. This is the check that keeps the copy honest: a menu entry the manual
  // never mentions is undocumented, and a documented entry that no longer exists sends readers to
  // a page they cannot find from the sidebar.
  const manual = source("apps/web/app/(admin)/admin/manual/page.tsx");
  const routeByKey = new Map<string, string>();
  const routesStart = manual.indexOf("const ROUTES = {");
  const routesBlock = manual.slice(routesStart, manual.indexOf("} as const", routesStart));
  assert.ok(routesBlock.includes("dashboard:"), "the manual's ROUTES table could not be read");
  for (const match of routesBlock.matchAll(/(\w+): "([^"]+)"/g)) routeByKey.set(match[1], match[2]);

  const expected = new Set<string>([
    ...ADMIN_NAV_ITEMS.map((item) => item.route),
    ...ADMIN_NAV_FOOTER_ROUTES,
  ]);
  for (const marker of ["SIDEBAR_MAP_GROUPS_TH", "SIDEBAR_MAP_GROUPS_EN"]) {
    const start = manual.indexOf(`const ${marker}`);
    assert.ok(start > 0, `${marker} is gone; the manual no longer documents the menu`);
    const block = manual.slice(start, manual.indexOf("\n]", start));
    const documented = new Set(
      [...block.matchAll(/href: ROUTES\.(\w+)/g)].map((match) => routeByKey.get(match[1]) ?? match[1])
    );
    for (const route of expected) {
      assert.ok(documented.has(route), `${marker} does not document ${route}`);
    }
    for (const route of documented) {
      // Posts owns /admin/post/*, which the manual documents under the Posts entry.
      assert.ok(expected.has(route), `${marker} documents ${route}, which is not in the menu`);
    }
  }
});

test("work with someone waiting is pinned above the groups and stays visible when collapsed", () => {
  // A group header does not aggregate its children's badges and a collapsed group is a hover
  // popup, so an unread count inside a group is invisible from every page except its own. These
  // three are the destinations where that matters.
  const queueIds = ADMIN_NAV_ITEMS.filter((item) => item.topLevel === "queue").map((item) => item.id).sort();
  assert.deepEqual(queueIds, ["customers.inbox", "customers.mentions", "shopfloor.pharmacy-queue"]);
  for (const item of ADMIN_NAV_ITEMS.filter((entry) => entry.topLevel === "queue")) {
    assert.ok(item.badge, `${item.id} is pinned as a queue but carries no counter, so pinning buys nothing`);
  }
  // Exactly one page may claim the home slot, and it is the one /admin lands on.
  const homes = ADMIN_NAV_ITEMS.filter((item) => item.topLevel === "home");
  assert.deepEqual(homes.map((item) => item.route), ["/admin/dashboard"]);
  // Restock is a batch queue whose customers have already waited days. Pinning a badge that is
  // almost always non-zero is how a red pill stops meaning anything.
  assert.equal(ADMIN_NAV_ITEMS.find((item) => item.id === "customers.restock")?.topLevel, undefined);

  const staff = withPermissions(["inbox.view"]);
  const nav = buildAdminNavigation(staff, "SHOP");
  assert.deepEqual(nav.topLevel.map((item) => item.route), ["/admin/inbox", "/admin/inbox/mentions"]);
  // Pinned entries leave their section rather than appearing twice.
  const grouped = nav.sections.flatMap((section) => section.items.map((item) => item.route));
  assert.ok(!grouped.includes("/admin/inbox"));
  assert.ok(grouped.includes("/admin/restock-subscriptions"));
  assert.equal(new Set(routesOf(nav)).size, routesOf(nav).length);

  // The pharmacy queue joins the strip only where it exists, and the order never varies by shop.
  const pharmacy = buildAdminNavigation(
    withPermissions(["inbox.view", "pharmacy.assessment.read"], { archetype: "pharmacy" }), "SHOP");
  assert.deepEqual(pharmacy.topLevel.map((item) => item.id),
    ["customers.inbox", "customers.mentions", "shopfloor.pharmacy-queue"]);
  for (const archetype of ARCHETYPES) {
    const order = buildAdminNavigation(administrator({ archetype }), "SHOP").topLevel.map((item) => item.id);
    assert.deepEqual(order.filter((id) => id !== "shopfloor.pharmacy-queue"),
      ["overview.dashboard", "customers.inbox", "customers.mentions"],
      `${archetype} reordered the top strip`);
  }

  // Landing is unchanged: a badge pulls people into a queue, the shell does not dump them there.
  assert.equal(firstAdminDestination(withPermissions(["inbox.view", "report.view"])), "/admin/dashboard");
  assert.equal(firstAdminDestination(staff), "/admin/inbox",
    "an inbox-only account lands in its own queue, not on an unrelated section");

  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  assert.match(sidebar, /\.\.\.topLevel\.map\(renderItem\)/, "top entries must render above the groups");
  assert.match(sidebar, /item\.topLevel === 'queue',/,
    "the collapsed-rail badge flag must follow the queue role, or the strip goes dark when the rail shrinks");
  assert.match(sidebar, /selectedNavItem && !selectedNavItem\.topLevel/,
    "standing on a top-level page must not expand an unrelated group");
});

test("every Admin alert can be dismissed", () => {
  // An Admin screen stacks banners: readiness blockers, permission notes, load errors, one-off
  // hints. Without a close button they cover the work underneath and there is no way to get past
  // them. 237 of 265 already had `closable` — this pins the convention so the next one does too.
  const roots = [path.join(WEB, "app", "(admin)"), path.join(WEB, "components")];
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

  // The opening tag can carry JSX in its props, so brace depth decides where it ends — a plain
  // regex to `>` stops inside `description={<div>…}` and would read the wrong text.
  const openingTag = (source: string, from: number) => {
    let depth = 0;
    for (let i = from; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) return source.slice(from, i + 1);
    }
    return source.slice(from);
  };

  const offenders: string[] = [];
  let total = 0;
  for (const root of roots) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<Alert(?![\w.])/g)) {
        total += 1;
        const tag = openingTag(source, match.index! + "<Alert".length);
        if (!/\bclosable\b/.test(tag)) {
          offenders.push(`${path.relative(WEB, file)}:${source.slice(0, match.index).split("\n").length}`);
        }
      }
    }
  }
  assert.ok(total > 200, `only ${total} alerts found; the scan is not reading the Admin tree`);
  assert.deepEqual(offenders, [], `these Admin alerts cannot be dismissed:\n${offenders.join("\n")}`);
});

test("the command palette's word list is the assistant's own verified catalog, not a new one", () => {
  // Every nav route already has a guide at that exact route (enforced by
  // work-assistant-knowledge-contract.test.mts) — this pins that the palette actually benefits
  // from that coverage, using real aliases already shipped, not invented ones.
  const ctx = { labelFor: (item: any) => item.labelKey, locale: "th" as const, permissions: [], role: null, isPlatformAdmin: false };
  const items = ADMIN_NAV_ITEMS;

  // Layer 1 (label-only, no catalog) finds nothing for a real staff phrase that isn't the label.
  const withoutCatalog = computeAdminNavSearchResults("เครดิตหมด", items, ctx, null);
  assert.deepEqual(withoutCatalog, [], "label-only search should not fabricate a match");

  // Layer 2, once the catalog is loaded, resolves real staff phrasing to the right destination —
  // these are verified against the shipped alias corpus, not written for this test.
  const cases: Array<[string, string]> = [
    ["เครดิตหมด", "/admin/billing"],
    ["ของหมดอายุ", "/admin/wastage"],
    ["เปิดร้านไม่ได้", "/admin/pos-readiness"],
    ["ลืม pin", "/admin/pos-devices"],
  ];
  for (const [query, expectedRoute] of cases) {
    const results = computeAdminNavSearchResults(query, items, ctx, assistantCatalog as any);
    assert.ok(
      results.some((r) => r.item.route === expectedRoute),
      `"${query}" did not resolve to ${expectedRoute} — got ${JSON.stringify(results.map((r) => r.item.route))}`
    );
    assert.ok(results[0].matchedVia === "guide" || results.some((r) => r.matchedVia === "guide"),
      `"${query}" matched only by label; the catalog alias is what this test is protecting`);
  }
});

test("the command palette can never surface a route this account's own sidebar hides", () => {
  const ctx = { labelFor: (item: any) => item.labelKey, locale: "th" as const, permissions: [], role: null, isPlatformAdmin: false };
  // A cashier's visible set does not include Billing, even though "เครดิตหมด" matches it strongly
  // in the full catalog — restricting `items` is what must do the hiding, and it must actually work.
  const restricted = ADMIN_NAV_ITEMS.filter((item) => item.id !== "settings.billing");
  const results = computeAdminNavSearchResults("เครดิตหมด", restricted, ctx, assistantCatalog as any);
  assert.ok(!results.some((r) => r.item.route === "/admin/billing"),
    "a route excluded from `items` must not appear just because the catalog matched it");
});

test("assistantKnowledge is never statically imported by the sidebar or the search hook", () => {
  // ~360KB of source (guides + FAQ + limits). Every Admin page renders the sidebar, so a static
  // import here would ship that to every page load whether or not anyone ever searches.
  const hookSource = source("apps/web/components/work-assistant/adminNavSearch.ts");
  assert.doesNotMatch(hookSource, /^import .*from ["']@\/lib\/bms\/assistantKnowledge["']/m);
  // Targets the runtime call site specifically — `typeof import(...)` (type-only, erased at
  // compile time) would satisfy a looser regex here without proving anything about the bundle.
  assert.match(hookSource, /catalogPromise = import\("@\/lib\/bms\/assistantKnowledge"\);/,
    "the catalog must be loaded with a dynamic import, fetched only when the palette actually opens");
  assert.doesNotMatch(sidebarSourceForImportCheck(), /from ["']@\/lib\/bms\/assistantKnowledge["']/);
});

function sidebarSourceForImportCheck(): string {
  return source("apps/web/components/AdminSidebar.tsx");
}

test("the palette opens on ⌘K / Ctrl+K from anywhere, and the sidebar exposes a visible trigger", () => {
  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  assert.match(sidebar, /\(e\.metaKey \|\| e\.ctrlKey\) && \(e\.key === 'k' \|\| e\.key === 'K'\)/,
    "the shortcut must work for both ⌘ (Mac) and Ctrl (Windows/Linux)");
  assert.match(sidebar, /setPaletteOpen\(\(open\) => !open\)/);
  assert.match(sidebar, /onClick={\(\) => setPaletteOpen\(true\)}/,
    "a visible button must open it too — the collapsed rail and the mobile Drawer have no ⌘K");
  assert.match(sidebar, /searchableAdminNavItems\(navContext\)/,
    "the palette's universe must come from the same visibility-filtered items as the menu, not a separate list");
  assert.match(sidebar, /<AdminCommandPalette/);
});

test("sidebar colors come from tokens that exist, in both themes", () => {
  // `--app-text-secondary` was never defined in globals.css — every use silently fell through to
  // its hardcoded `#888` fallback, which ignores the theme entirely and reads as a flat mid-grey
  // on the dark ground. The real token is `--text-secondary`.
  const declared = new Set(
    [...source("apps/web/app/globals.css").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
  );
  const files = [
    "apps/web/components/AdminSidebar.tsx",
    "apps/web/components/work-assistant/AdminCommandPalette.tsx",
  ];
  for (const file of files) {
    for (const match of source(file).matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/g)) {
      const [, token, fallback] = match;
      assert.ok(
        declared.has(token),
        `${file} uses ${token}, which globals.css never defines${fallback ? " (masked by its fallback)" : ""}`
      );
    }
  }
});

test("the collapsed rail gives its own breathing room and every control reads as clickable", () => {
  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  // The search control keeps its box in both modes: it is an input affordance, not a destination,
  // and it should still read as "type here" when the rail is down to icons.
  assert.match(sidebar, /background: 'var\(--app-surface-2\)',\n\s*border: '1px solid var\(--app-border\)',/);
  // Controls without their own box (help pair, profile) rely on hover as the only affordance.
  assert.match(source("apps/web/app/globals.css"), /\.bms-sider-quiet:hover/);
  assert.equal((sidebar.match(/className="bms-sider-quiet"/g) ?? []).length, 3,
    "search, the help pair and the profile row all need a hover state");
  // The AI quota strip had no bottom padding at all while collapsed, so it sat flush against the
  // footer border and the whole bottom cluster read as one jammed block of icons.
  assert.match(sidebar, /padding: mini \? '0 10px 10px' : '0 10px 8px'/);
  assert.match(sidebar, /padding: mini \? '8px 0' : '4px 8px', marginBottom: mini \? 8 : 6/);
  assert.match(sidebar, /padding: mini \? '5px 0' : '4px', marginBottom: mini \? 12 : 8/);
});
