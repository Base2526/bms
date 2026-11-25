// =============================================================
// "Today" on a shop screen is the Bangkok calendar day, not the UTC one.
// -------------------------------------------------------------
// /admin/pos-readiness compared lot expiry dates with new Date().toISOString().slice(0, 10). From
// 00:00 to 06:59 Asia/Bangkok that is still yesterday, so a lot that expired yesterday was shown as
// not expired on the "before opening" checklist. Found 2026-11-24 (frontend sweep).
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bangkokDateKey } from "../apps/web/lib/date.ts";

test("bangkokDateKey uses the Asia/Bangkok calendar day", () => {
  // 2026-11-24 17:30 UTC = 2026-11-25 00:30 in Bangkok: the shop has already opened a new day.
  assert.equal(bangkokDateKey(new Date("2026-11-24T17:30:00.000Z")), "2026-11-25");
  assert.equal(bangkokDateKey(new Date("2026-11-24T16:59:59.000Z")), "2026-11-24");
  assert.equal(bangkokDateKey(new Date("2026-12-31T17:00:00.000Z")), "2027-01-01");
  assert.match(bangkokDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test("the POS readiness expiry check uses the Bangkok day", () => {
  const page = readFileSync(new URL("../apps/web/app/(admin)/admin/pos-readiness/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const today = bangkokDateKey\(\);/);
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
