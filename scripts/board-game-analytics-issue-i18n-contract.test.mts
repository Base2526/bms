// =============================================================
// Every board-game analytics issue code has Thai and English text.
// -------------------------------------------------------------
// BoardGameAnalyticsPanel renders t(`admin_board_game.analytics_issue_${code.toLowerCase()}`).
// i18n-keys-contract only sees literal keys, so codes added in lib/bms/boardGameAnalytics.ts
// (CURRENT_CAPACITY_BASIS, raised whenever a shop has tables, and WAIT_TIME_INCOMPLETE) showed the
// raw key in the analytics warning and "—" tooltips. Found 2026-11-24 (frontend sweep).
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import en from "../apps/web/i18n/en.ts";
import th from "../apps/web/i18n/th.ts";

test("analytics issue codes raised by the service all have both translations", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/boardGameAnalytics.ts", import.meta.url), "utf8");
  const codes = [...new Set([...source.matchAll(/\bissue\.add\(\s*"([A-Z_]+)"/g)].map((m) => m[1]))];
  assert.ok(codes.length >= 10, `expected the service's issue codes, found ${codes.length}`);
  const missing: string[] = [];
  for (const [lang, dict] of [["en", en], ["th", th]] as const) {
    const section = (dict as any).admin_board_game ?? {};
    for (const code of codes) {
      const key = `analytics_issue_${code.toLowerCase()}`;
      if (typeof section[key] !== "string" || !section[key].trim()) missing.push(`${lang}: admin_board_game.${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
