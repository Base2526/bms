import { shopExperienceForArchetype } from "./shopExperience";

/**
 * Navigation policy for the Admin shell, kept free of React and database imports so the whole
 * menu can be asserted without rendering the app or opening a connection.
 *
 * This module decides what a user is *shown*, never what they are *allowed* to do. Every route
 * still enforces its own permissions server-side; hiding an entry is a presentation choice and
 * revealing one grants nothing. Because of that, the guard here must stay equal to or wider than
 * the page's own read gate — a narrower menu hides work people can do, a wider one hands them a
 * link to an access-denied screen.
 */

/**
 * Menu areas, not tenants. A platform admin drilling into a shop keeps that shop's data; this
 * only selects which set of tools the sidebar lists.
 */
export type AdminWorkspace = "SHOP" | "PLATFORM";

export type AdminNavSectionId =
  | "sales"
  | "inventory"
  | "customers"
  | "finance"
  | "shopfloor"
  | "settings"
  | "platform_shops"
  | "platform_content"
  | "platform_ops";

/** Counters the shell already polls. A badge must come from one of these or not exist at all. */
export type AdminNavBadge =
  | "inbox"
  | "mentions"
  | "restockReady"
  | "channelHealth"
  | "pharmacyQueue"
  | "aiProviderHealth";

export type AdminNavContext = {
  can: (permission: string) => boolean;
  isPlatformAdmin: boolean;
  isAdministrator: boolean;
  archetype: string | null;
  /** Real capability signals, resolved by the shell's bounded bootstrap query. */
  kitchenBoardEnabled: boolean;
  wastageEnabled: boolean;
  packToolsConfigured: boolean;
};

export type AdminNavItem = {
  /** Stable across renames and reorganizations; tests and docs refer to this, not to the label. */
  id: string;
  route: string;
  labelKey: string;
  section: AdminNavSectionId;
  workspace: AdminWorkspace;
  visible: (ctx: AdminNavContext) => boolean;
  /**
   * Extra route subtrees this entry owns. Detail pages are matched by route boundary already
   * (`/admin/users/new` selects `/admin/users`); declare a prefix only when a page lives outside
   * its parent's path.
   */
  ownsRoutePrefixes?: readonly string[];
  badge?: AdminNavBadge;
  /**
   * Render above the groups instead of inside `section`. Two reasons qualify, and nothing else:
   *
   * - `"home"` — the page people return to all day. Exactly one entry may claim it.
   * - `"queue"` — someone is waiting and nobody else will clear it. A group header does not
   *   aggregate its children's badges and a collapsed group renders as a hover popup, so a count
   *   inside a group is invisible from every screen except the one you are already on. A queue
   *   must therefore carry a `badge`, or pinning it buys nothing.
   *
   * `section` still records where the entry belongs, which is what the Manual documents.
   */
  topLevel?: "home" | "queue";
};

export type AdminNavSection = {
  id: AdminNavSectionId;
  labelKey: string;
  items: AdminNavItem[];
};

export type AdminNavigation = {
  /** Rendered flat, above every group: the home page, then the waiting queues. */
  topLevel: AdminNavItem[];
  sections: AdminNavSection[];
};

const always = () => true;

/**
 * `followup-queue` renders for followup.view OR retention.view — the retention board is a separate
 * card on the same page. Gating the menu on followup.view alone left a retention-only role with no
 * route to the only page that shows their queue.
 */
const canSeeFollowupQueue = (ctx: AdminNavContext) => ctx.can("followup.view") || ctx.can("retention.view");

/**
 * POS Readiness reads with all four permissions (see the page's own `canRead`). Listing it for any
 * one of them sent people to an access-denied screen.
 */
const canSeePosReadiness = (ctx: AdminNavContext) =>
  ctx.can("pos.device.manage") && ctx.can("pharmacy.policy.read")
  && ctx.can("product.view") && ctx.can("stock.adjust");

/** Permissions/Audit/Revisions resolvers use requireSuper, so the menu matches that boundary. */
const canManageAccess = (ctx: AdminNavContext) => ctx.isAdministrator || ctx.isPlatformAdmin;

/**
 * Pack and label tools are product work, not POS work: they are reachable whenever the shop's
 * archetype recommends packs or the shop already has pack/barcode data. Previously they sat inside
 * a POS-conditional group, so a catalog manager without POS permissions had no way in.
 */
const packToolsRelevant = (ctx: AdminNavContext) =>
  ctx.packToolsConfigured
  || shopExperienceForArchetype(ctx.archetype).recommendedCapabilities
    .some((capability) => capability === "PACK" || capability === "MULTI_BARCODE");

const isPharmacyShop = (ctx: AdminNavContext) => ctx.archetype === "pharmacy";

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    // The page people come back to all day, and where /admin lands. It used to sit inside an
    // "Overview" group whose own name repeated it ("ภาพรวม" › "ภาพรวมวันนี้") and which held two
    // rarely-opened pages besides — a group that cost a click and bought nothing.
    id: "overview.dashboard", route: "/admin/dashboard", labelKey: "admin_nav.dashboard",
    section: "finance", workspace: "SHOP", visible: (ctx) => ctx.can("report.view"),
    topLevel: "home",
  },

  // ---- การขาย ----
  {
    id: "sales.orders", route: "/admin/orders", labelKey: "admin_nav.orders",
    section: "sales", workspace: "SHOP", visible: (ctx) => ctx.can("order.view"),
  },
  {
    id: "sales.shipment", route: "/admin/shipment", labelKey: "admin_nav.shipment",
    section: "sales", workspace: "SHOP", visible: (ctx) => ctx.can("shipping.view"),
  },
  {
    id: "sales.pos-shifts", route: "/admin/pos-shifts", labelKey: "admin_nav.pos_shifts",
    section: "sales", workspace: "SHOP", visible: (ctx) => ctx.can("pos.shift.report.all"),
  },
  {
    id: "sales.kitchen", route: "/admin/kitchen", labelKey: "admin_nav.kitchen",
    section: "sales", workspace: "SHOP",
    // Same condition enqueueKitchenTicketsInTx() uses to create tickets, so the board and the
    // tickets always arrive together.
    visible: (ctx) => ctx.kitchenBoardEnabled && ctx.can("order.view"),
  },
  {
    id: "sales.pos-manual", route: "/admin/pos-manual", labelKey: "admin_nav.pos_manual",
    section: "sales", workspace: "SHOP", visible: (ctx) => ctx.can("pos.sell"),
  },

  // ---- สินค้าและสต็อก ----
  {
    id: "inventory.products", route: "/admin/products", labelKey: "admin_nav.products",
    section: "inventory", workspace: "SHOP", visible: (ctx) => ctx.can("product.view"),
  },
  {
    id: "inventory.stock-models", route: "/admin/stock-models", labelKey: "admin_nav.stock_models",
    section: "inventory", workspace: "SHOP", visible: (ctx) => ctx.can("product.view"),
  },
  {
    id: "inventory.product-packs", route: "/admin/product-packs", labelKey: "admin_nav.product_packs",
    section: "inventory", workspace: "SHOP",
    visible: (ctx) => ctx.can("product.view") && packToolsRelevant(ctx),
  },
  {
    id: "inventory.product-labels", route: "/admin/product-labels", labelKey: "admin_nav.product_labels",
    section: "inventory", workspace: "SHOP",
    visible: (ctx) => ctx.can("product.view") && packToolsRelevant(ctx),
  },
  {
    id: "inventory.purchase", route: "/admin/purchase", labelKey: "admin_nav.purchase",
    section: "inventory", workspace: "SHOP", visible: (ctx) => ctx.can("purchase.view"),
  },
  {
    id: "inventory.stock-transfers", route: "/admin/stock-transfers", labelKey: "admin_nav.stock_transfers",
    section: "inventory", workspace: "SHOP", visible: (ctx) => ctx.can("inventory.transfer"),
  },
  {
    id: "inventory.stock-counts", route: "/admin/stock-counts", labelKey: "admin_nav.stock_counts",
    section: "inventory", workspace: "SHOP", visible: (ctx) => ctx.can("inventory.count"),
  },
  {
    id: "inventory.wastage", route: "/admin/wastage", labelKey: "admin_nav.wastage",
    section: "inventory", workspace: "SHOP",
    visible: (ctx) => ctx.can("product.view")
      && (ctx.wastageEnabled || shopExperienceForArchetype(ctx.archetype).showWastageInNavigation),
  },

  // ---- ลูกค้าและการตลาด ----
  {
    id: "customers.inbox", route: "/admin/inbox", labelKey: "admin_nav.inbox",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("inbox.view"),
    // The customer is typing right now. This is the shop's only live queue.
    badge: "inbox", topLevel: "queue",
  },
  {
    id: "customers.mentions", route: "/admin/inbox/mentions", labelKey: "admin_nav.mentions",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("inbox.view"),
    // A teammate addressed this person by name. `read_at` is per user, so nobody else can clear
    // it, and the Admin shell has no notification bell — this badge is the only in-app signal.
    badge: "mentions", topLevel: "queue",
  },
  {
    id: "customers.customers", route: "/admin/customers", labelKey: "admin_nav.customers",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("customer.view"),
  },
  {
    id: "customers.restock", route: "/admin/restock-subscriptions", labelKey: "admin_nav.restock_subscriptions",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("inbox.view"),
    // Deliberately not pinned: customers here have already waited days, so it is batch work.
    // Pinning a queue that is always non-zero is how a red pill stops meaning anything.
    badge: "restockReady",
  },
  {
    id: "customers.loyalty", route: "/admin/loyalty", labelKey: "admin_nav.loyalty",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("member.view"),
  },
  {
    id: "customers.coupons", route: "/admin/coupons", labelKey: "admin_nav.coupons",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("coupon.view"),
  },
  {
    id: "customers.followup-rules", route: "/admin/followup-rules", labelKey: "admin_nav.followup_rules",
    section: "customers", workspace: "SHOP", visible: (ctx) => ctx.can("followup.view"),
  },
  {
    id: "customers.followup-queue", route: "/admin/followup-queue", labelKey: "admin_nav.followup_queue",
    section: "customers", workspace: "SHOP", visible: canSeeFollowupQueue,
  },

  // ---- การเงินและรายงาน ----
  {
    id: "finance.payment", route: "/admin/payment", labelKey: "admin_nav.payment",
    section: "finance", workspace: "SHOP", visible: (ctx) => ctx.can("payment.view"),
  },
  {
    id: "finance.receivables", route: "/admin/receivables", labelKey: "admin_nav.receivables",
    section: "finance", workspace: "SHOP", visible: (ctx) => ctx.can("ar.view"),
  },
  {
    id: "finance.commission", route: "/admin/commission", labelKey: "admin_nav.commission",
    section: "finance", workspace: "SHOP", visible: (ctx) => ctx.can("commission.view"),
  },
  {
    id: "finance.reports", route: "/admin/reports", labelKey: "admin_nav.reports",
    section: "finance", workspace: "SHOP", visible: (ctx) => ctx.can("report.view"),
  },

  // ---- งานเฉพาะร้าน ----
  {
    id: "shopfloor.pharmacy-queue", route: "/admin/pharmacy-queue", labelKey: "admin_nav.pharmacy_queue",
    section: "shopfloor", workspace: "SHOP",
    visible: (ctx) => isPharmacyShop(ctx) && ctx.can("pharmacy.assessment.read"),
    // A patient is standing at the counter and the queue carries an EMERGENCY pill.
    badge: "pharmacyQueue", topLevel: "queue",
  },
  {
    id: "shopfloor.pharmacy-intake-lab", route: "/admin/pharmacy-intake-lab", labelKey: "admin_nav.pharmacy_intake_lab",
    section: "shopfloor", workspace: "SHOP",
    visible: (ctx) => isPharmacyShop(ctx) && ctx.can("pharmacy.assessment.read"),
  },
  {
    id: "shopfloor.pharmacy-protocols", route: "/admin/pharmacy-protocols", labelKey: "admin_nav.pharmacy_protocols",
    section: "shopfloor", workspace: "SHOP",
    visible: (ctx) => isPharmacyShop(ctx) && ctx.can("pharmacy.protocol.manage"),
  },
  {
    id: "shopfloor.pharmacist-licenses", route: "/admin/pharmacy-protocols/licenses", labelKey: "admin_nav.pharmacist_licenses",
    section: "shopfloor", workspace: "SHOP",
    visible: (ctx) => isPharmacyShop(ctx) && ctx.isAdministrator,
  },
  {
    id: "shopfloor.pharmacist-manual", route: "/admin/pharmacy-manual", labelKey: "admin_nav.pharmacist_manual",
    section: "shopfloor", workspace: "SHOP",
    visible: (ctx) => isPharmacyShop(ctx) && ctx.can("pharmacy.assessment.read"),
  },

  // ---- ตั้งค่าและดูแลร้าน ----
  {
    // First in the group on purpose: it is the fallback landing page for an account that cannot
    // read the dashboard, and a brand-new shop should meet its setup checklist before anything.
    id: "overview.getting-started", route: "/admin/getting-started", labelKey: "admin_nav.getting_started",
    section: "settings", workspace: "SHOP", visible: always,
  },
  {
    id: "settings.store", route: "/admin/settings", labelKey: "admin_nav.store_settings",
    section: "settings", workspace: "SHOP", visible: always, badge: "channelHealth",
  },
  {
    id: "settings.locations", route: "/admin/locations", labelKey: "admin_nav.locations",
    section: "settings", workspace: "SHOP", visible: (ctx) => ctx.can("location.manage"),
  },
  {
    id: "settings.pos-devices", route: "/admin/pos-devices", labelKey: "admin_nav.pos_devices",
    section: "settings", workspace: "SHOP",
    visible: (ctx) => ctx.can("pos.device.manage") || ctx.can("pos.pin.manage") || ctx.can("pos.staff.manage"),
  },
  {
    id: "settings.pos-readiness", route: "/admin/pos-readiness", labelKey: "admin_nav.pos_readiness",
    section: "settings", workspace: "SHOP", visible: canSeePosReadiness,
  },
  {
    id: "settings.users", route: "/admin/users", labelKey: "admin_nav.users",
    section: "settings", workspace: "SHOP",
    visible: (ctx) => canManageAccess(ctx) || ctx.can("user.view"),
  },
  {
    id: "settings.permissions", route: "/admin/permissions", labelKey: "admin_nav.permissions",
    section: "settings", workspace: "SHOP", visible: canManageAccess,
  },
  {
    id: "settings.revisions", route: "/admin/revisions", labelKey: "admin_nav.revisions",
    section: "settings", workspace: "SHOP", visible: canManageAccess,
  },
  {
    id: "settings.audit", route: "/admin/audit", labelKey: "admin_nav.audit",
    section: "settings", workspace: "SHOP", visible: canManageAccess,
  },
  {
    id: "settings.billing", route: "/admin/billing", labelKey: "admin_nav.billing",
    section: "settings", workspace: "SHOP", visible: always,
  },
  {
    id: "settings.ai-quality", route: "/admin/ai-quality", labelKey: "admin_nav.ai_quality",
    section: "settings", workspace: "SHOP", visible: (ctx) => ctx.can("ai_quality.view"),
  },
  {
    id: "settings.playground", route: "/admin/playground", labelKey: "admin_nav.playground",
    section: "settings", workspace: "SHOP", visible: (ctx) => ctx.can("ai_quality.view"),
  },
  {
    id: "settings.support-diagnostics", route: "/admin/support-diagnostics", labelKey: "admin_nav.support_diagnostics",
    section: "settings", workspace: "SHOP", visible: (ctx) => ctx.can("support.logs.view"),
  },
  {
    id: "settings.realtime-diagnostics", route: "/admin/inbox/realtime-diagnostics", labelKey: "admin_nav.realtime_diagnostics",
    section: "settings", workspace: "SHOP", visible: canManageAccess,
  },

  // ---- พื้นที่แพลตฟอร์ม ----
  {
    id: "platform.tenants", route: "/admin/tenants", labelKey: "admin_nav.tenants",
    section: "platform_shops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.report-schedule", route: "/admin/report-schedule", labelKey: "admin_nav.report_schedule",
    section: "platform_shops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    // Roles are the platform-wide definition every tenant's permission grid is built from, so the
    // page has always been platform-admin only. Per-shop work happens on Users and Permissions.
    id: "platform.roles", route: "/admin/roles", labelKey: "admin_nav.roles",
    section: "platform_shops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.support-tickets", route: "/admin/support-tickets", labelKey: "admin_nav.support_tickets",
    section: "platform_shops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.posts", route: "/admin/posts", labelKey: "admin_nav.posts",
    section: "platform_content", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
    // `/admin/post` has [id]/new children and no index page, so it is reached from Posts.
    ownsRoutePrefixes: ["/admin/post"],
  },
  {
    id: "platform.files", route: "/admin/files", labelKey: "admin_nav.files",
    section: "platform_content", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.architecture", route: "/admin/architecture", labelKey: "admin_nav.architecture",
    section: "platform_content", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.logs", route: "/admin/logs", labelKey: "admin_nav.logs",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.mail-log", route: "/admin/mail-log", labelKey: "admin_nav.mail_log",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.operations-schedule", route: "/admin/operations-schedule", labelKey: "admin_nav.operations_schedule",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.system-health", route: "/admin/system-health", labelKey: "admin_nav.system_health",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.env", route: "/admin/env", labelKey: "admin_nav.env",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
    badge: "aiProviderHealth",
  },
  {
    id: "platform.sql-console", route: "/admin/dev/sql-console", labelKey: "admin_nav.sql_console",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
  {
    id: "platform.fake-data", route: "/admin/dev/fake", labelKey: "admin_nav.fake_data",
    section: "platform_ops", workspace: "PLATFORM", visible: (ctx) => ctx.isPlatformAdmin,
  },
];

/**
 * The help pair lives in the sidebar footer rather than a group: they are what people reach for
 * when they are lost, and a lost user should not have to open a group to find them. The assistant
 * is already mounted as a Drawer on every Admin page (AdminLayoutClient), so its full page is a
 * second entrance, not the primary one — a prime menu row for it while the dashboard sat inside a
 * group had the priorities backwards. Declared here so route-coverage checks see them without
 * parsing JSX.
 */
export const ADMIN_NAV_FOOTER_ROUTES: readonly string[] = ["/admin/assistant", "/admin/manual"];

export const ADMIN_NAV_SECTION_LABELS: Record<AdminNavSectionId, string> = {
  sales: "admin_nav.section_sales",
  inventory: "admin_nav.section_inventory",
  customers: "admin_nav.section_customers",
  finance: "admin_nav.section_finance",
  shopfloor: "admin_nav.section_shopfloor",
  settings: "admin_nav.section_settings",
  platform_shops: "admin_nav.section_platform_shops",
  platform_content: "admin_nav.section_platform_content",
  platform_ops: "admin_nav.section_platform_ops",
};

const SHOP_SECTION_ORDER: readonly AdminNavSectionId[] = [
  "sales", "inventory", "customers", "finance", "shopfloor", "settings",
];

const PLATFORM_SECTION_ORDER: readonly AdminNavSectionId[] = [
  "platform_shops", "platform_content", "platform_ops",
];

/**
 * Fixed per-archetype emphasis: these entries float to the top of the section they already belong
 * to. Nothing is hidden, nothing is added, and the order never changes with usage — a menu that
 * rearranges itself as people work costs more than it saves.
 */
// ⚠️ อ้างถึงรายการที่ pinned ไม่ได้ — แถบด่วนเรียงคงที่ ใส่ไปก็ไม่มีผล (มีเทสคุม)
const ARCHETYPE_EMPHASIS: Record<string, readonly string[]> = {
  restaurant: ["sales.kitchen", "sales.pos-shifts", "inventory.stock-models", "inventory.products", "inventory.wastage"],
  mini_mart: ["sales.pos-shifts", "inventory.products", "inventory.product-packs", "inventory.purchase", "inventory.stock-counts"],
  fashion: ["sales.orders", "inventory.products", "sales.shipment", "customers.customers"],
  pharmacy: ["inventory.products", "sales.pos-shifts", "settings.pos-readiness"],
  b2b_wholesale: ["sales.orders", "inventory.product-packs", "finance.receivables", "inventory.purchase", "sales.shipment"],
  building_materials: ["sales.orders", "inventory.product-packs", "finance.receivables", "inventory.purchase", "sales.shipment"],
  food_beverage: ["sales.pos-shifts", "inventory.products", "inventory.stock-models", "inventory.wastage"],
  beauty_personal_care: ["sales.orders", "inventory.products", "customers.customers"],
  gadgets_accessories: ["sales.orders", "inventory.products", "sales.shipment"],
  home_kitchen: ["sales.orders", "inventory.products", "sales.shipment"],
  pet_supply: ["sales.pos-shifts", "inventory.products", "inventory.purchase", "inventory.stock-counts"],
  gifts_seasonal: ["sales.orders", "inventory.products", "customers.coupons"],
};

export function emphasisItemIdsForArchetype(archetype: string | null | undefined): readonly string[] {
  return ARCHETYPE_EMPHASIS[String(archetype ?? "")] ?? [];
}

/**
 * Build the visible sections for one workspace. Items are filtered first and empty sections are
 * dropped, so a group header never opens onto nothing.
 */
export function buildAdminNavigation(
  ctx: AdminNavContext,
  workspace: AdminWorkspace
): AdminNavigation {
  const order = workspace === "PLATFORM" ? PLATFORM_SECTION_ORDER : SHOP_SECTION_ORDER;
  const emphasis = emphasisItemIdsForArchetype(ctx.archetype);
  const rank = (item: AdminNavItem) => {
    const index = emphasis.indexOf(item.id);
    return index === -1 ? emphasis.length : index;
  };
  const visible = ADMIN_NAV_ITEMS.filter((item) => item.workspace === workspace && item.visible(ctx));

  // Home first, then the queues in declared order — the strip must not shuffle by shop type.
  const topLevel = [
    ...visible.filter((item) => item.topLevel === "home"),
    ...visible.filter((item) => item.topLevel === "queue"),
  ];

  const sections = order.flatMap((sectionId) => {
    const items = visible.filter((item) => item.section === sectionId && !item.topLevel);
    if (items.length === 0) return [];
    // Stable sort: emphasised entries rise, everything else keeps its declared order.
    const sorted = items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (rank(a.item) - rank(b.item)) || (a.index - b.index))
      .map((entry) => entry.item);
    return [{ id: sectionId, labelKey: ADMIN_NAV_SECTION_LABELS[sectionId], items: sorted }];
  });

  return { topLevel, sections };
}

/**
 * Where /admin should land. `report.view` gates the dashboard, so a warehouse or catalog role used
 * to be redirected straight into a permission warning right after signing in. The first entry of
 * the first section is the dashboard when they can read it and the getting-started page otherwise,
 * and getting-started is open to any admin session — so this never returns nothing.
 */
export function firstAdminDestination(ctx: AdminNavContext): string {
  // The most central thing this account can open, in that order: the dashboard if they can read
  // it, otherwise their live queue, otherwise the first section they have — and for a brand-new
  // account with no permission rows at all, the setup checklist that leads the settings group.
  //
  // The dashboard reads `report.view`, so a warehouse or catalog role used to sign in and land on
  // a permission warning; and a cashier whose whole job is the inbox should not have to go find it.
  const { topLevel, sections } = buildAdminNavigation(ctx, "SHOP");
  const home = topLevel.find((item) => item.topLevel === "home");
  const queue = topLevel.find((item) => item.topLevel === "queue");
  return home?.route ?? queue?.route ?? sections[0]?.items[0]?.route ?? "/admin/getting-started";
}

/** True when this user has any platform tool at all — the workspace switch appears only then. */
export function hasPlatformWorkspace(ctx: AdminNavContext): boolean {
  return ADMIN_NAV_ITEMS.some((item) => item.workspace === "PLATFORM" && item.visible(ctx));
}

const matchesRoute = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

/**
 * Route-boundary match, most specific first. `/admin/inbox/mentions` selects Mentions rather than
 * Inbox, `/admin/users/new` selects Users, and `/admin/loyalty-something` selects nothing — a
 * plain `startsWith` would have matched all three to the wrong entry.
 */
export function selectAdminNavItem(
  pathname: string | null | undefined,
  items: readonly AdminNavItem[] = ADMIN_NAV_ITEMS
): AdminNavItem | null {
  const current = pathname ?? "";
  let best: AdminNavItem | null = null;
  let bestLength = -1;
  for (const item of items) {
    for (const candidate of [item.route, ...(item.ownsRoutePrefixes ?? [])]) {
      if (matchesRoute(current, candidate) && candidate.length > bestLength) {
        best = item;
        bestLength = candidate.length;
      }
    }
  }
  return best;
}

/** Which workspace a route belongs to, so a deep link or Back never leaves the menu inconsistent. */
export function workspaceForRoute(pathname: string | null | undefined): AdminWorkspace | null {
  const item = selectAdminNavItem(pathname);
  return item ? item.workspace : null;
}

/**
 * Every destination this account can reach, across both workspaces, flattened for search.
 *
 * The workspace switch is a menu grouping, not a permission boundary — a platform admin typing
 * "env" while standing in the shop area should land on it directly rather than switching areas
 * first to even see it exists. `visible()` on each item still does the only check that matters.
 */
export function searchableAdminNavItems(ctx: AdminNavContext): AdminNavItem[] {
  const flatten = (nav: AdminNavigation) => [...nav.topLevel, ...nav.sections.flatMap((section) => section.items)];
  const shop = flatten(buildAdminNavigation(ctx, "SHOP"));
  const platform = hasPlatformWorkspace(ctx) ? flatten(buildAdminNavigation(ctx, "PLATFORM")) : [];
  return [...shop, ...platform];
}
