'use client';

import { useEffect, useMemo, useState } from "react";
import type { AdminNavItem } from "@/lib/bms/adminNavigation";

/**
 * The command palette's word list is the assistant's own knowledge catalog — the same aliases
 * `bmsWorkAssistant` and `/pos` already search (guide aliases + the FAQ/limit phrasings folded
 * into them). That catalog is real staff phrasing verified against a question corpus
 * (`work-assistant-question-corpus.mts`); writing a second alias list here for the sidebar would
 * be exactly the "two copies of the same word list" mistake `admin.menu_*` was deleted for.
 *
 * The catalog is ~360KB of source (guides + FAQ + limits), so it is never imported eagerly —
 * every Admin page would pay for it whether or not anyone ever searches. `loadAssistantCatalog()`
 * is a module-level singleton promise: the palette and any other search entry point share one
 * fetch, and it resolves instantly on the second open.
 */
type AssistantCatalogModule = typeof import("@/lib/bms/assistantKnowledge");
let catalogPromise: Promise<AssistantCatalogModule> | null = null;
function loadAssistantCatalog(): Promise<AssistantCatalogModule> {
  if (!catalogPromise) catalogPromise = import("@/lib/bms/assistantKnowledge");
  return catalogPromise;
}

export type AdminNavSearchMatch = {
  item: AdminNavItem;
  /**
   * "label" — matched the sidebar's own name for the page. Instant, needs no catalog.
   * "guide" — matched a verified alias from the assistant's catalog: the word a cashier or
   * bookkeeper actually types ("VAT", "โอนของ", "เครดิตหมด"), not the menu's own label.
   */
  matchedVia: "label" | "guide";
  /** The guide's summary, shown under a "guide" match so a route alone isn't the only context. */
  summary?: string;
};

export type AdminNavSearchContext = {
  labelFor: (item: AdminNavItem) => string;
  locale: "th" | "en";
  permissions: readonly string[];
  role: string | null | undefined;
  isPlatformAdmin: boolean;
};

const RESULT_LIMIT = 8;

/**
 * Pure merge of the two search layers — exported separately from the hook so it can be tested
 * (`admin-navigation-contract.test.mts`) against the real catalog without rendering React.
 *
 * `catalog` is `null` before the dynamic import resolves: label matches still work immediately,
 * and alias matches join in once it loads. `items` is the caller's already permission-filtered
 * list (`searchableAdminNavItems`), so a route the catalog matches but that isn't in `items` is
 * silently dropped — this function cannot show a page the account's own sidebar wouldn't.
 */
export function computeAdminNavSearchResults(
  query: string,
  items: readonly AdminNavItem[],
  ctx: AdminNavSearchContext,
  catalog: AssistantCatalogModule | null
): AdminNavSearchMatch[] {
  const q = query.trim();
  if (!q) return items.filter((item) => item.topLevel).map((item) => ({ item, matchedVia: "label" as const }));

  const nq = q.toLocaleLowerCase();
  const seen = new Set<string>();
  const merged: AdminNavSearchMatch[] = [];

  // Layer 1 — instant, no catalog needed: does the query sit inside the label people already see.
  for (const item of items) {
    if (ctx.labelFor(item).toLocaleLowerCase().includes(nq)) {
      seen.add(item.id);
      merged.push({ item, matchedVia: "label" });
    }
  }

  // Layer 2 — once the catalog has loaded, add verified alias matches for routes the label pass
  // missed. `byRoute` is what confines the catalog's much larger corpus (it also covers POS and
  // platform guides) to exactly the destinations this account's sidebar already offers.
  if (catalog) {
    const byRoute = new Map(items.map((item) => [item.route, item] as const));
    const permissionSet = new Set(ctx.permissions);
    const guideResults = catalog.searchAssistantKnowledge(q, {
      locale: ctx.locale,
      permissions: permissionSet,
      role: ctx.role ?? null,
      isPlatformAdmin: ctx.isPlatformAdmin,
      kind: "guide",
      limit: 20,
    });
    for (const result of guideResults) {
      // matchedQuery guards against the catalog's own "standing on this page" proximity bonus —
      // irrelevant here since no currentPath is passed, but the invariant is cheap to keep.
      if (!result.matchedQuery || !result.route) continue;
      const item = byRoute.get(result.route);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push({ item, matchedVia: "guide", summary: result.summary });
    }
  }

  return merged.slice(0, RESULT_LIMIT);
}

export function useAdminNavSearch(items: readonly AdminNavItem[], ctx: AdminNavSearchContext) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<AssistantCatalogModule | null>(null);

  function ensureCatalogLoaded() {
    if (catalog) return;
    loadAssistantCatalog().then(setCatalog).catch(() => {
      // Best-effort: label matching still works with no catalog. A failed chunk load (offline,
      // ad blocker) should degrade the search, not break it.
    });
  }

  const results = useMemo<AdminNavSearchMatch[]>(
    () => computeAdminNavSearchResults(query, items, ctx, catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, items, catalog, ctx.locale, ctx.permissions, ctx.role, ctx.isPlatformAdmin]
  );

  return { query, setQuery, results, catalogLoaded: catalog !== null, ensureCatalogLoaded };
}
