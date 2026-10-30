import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { retailLocalPricing, retailLocalPricingSummary } from "../apps/web/lib/bms/retailLocalPricing.ts";
test("pricing facts are marked as a pilot proposal in both languages", () => {
  assert.equal(retailLocalPricing.approved, false);
  assert.match(retailLocalPricingSummary("th"), /รอเจ้าของอนุมัติ/);
  assert.match(retailLocalPricingSummary("en"), /pending owner approval/);
});
test("POS and business document code never imports commercial UI/config", () => {
  const roots = ["apps/web/app/(pos)", "apps/web/components/pos", "apps/web/app/api/pos"];
  function inspect(path: string) {
    for (const f of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, f.name);
      if (f.isDirectory()) inspect(p);
      else if (/\.(tsx?|css)$/.test(p)) assert.doesNotMatch(readFileSync(p, "utf8"), /(?:from|import)[^\n]*(?:retailLocalPricing|LocalCommercial|LocalBackupAlert)/, p);
    }
  }
  for (const root of roots) inspect(new URL(`../${root}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
});
