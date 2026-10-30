// =============================================================
// Retail Local price list — one source, back office and public page only
// -------------------------------------------------------------
// Prices for the self-installed Server + POS live in
// apps/web/lib/bms/retailLocalPricing.ts. Three surfaces show them: the public
// /retail-local page, the shop's licence card and the add-device notice.
//
// Retail Local licensing is evidence-only and fail-open: what a shop pays for
// is support, never permission to keep selling. So:
//   - every surface reads the one config (a second copy of a price drifts);
//   - nothing on a POS, receipt, payment or kitchen path may import it;
//   - the copy must keep saying the shop keeps working without paying;
//   - the add-device notice is Local-only and never blocks saving.
//
//   node scripts/run-contract-tests.mjs pure retail-local-pricing
// =============================================================
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RETAIL_LOCAL_PRICING as P, formatRetailLocalBaht } from "../apps/web/lib/bms/retailLocalPricing.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const read = (rel: string) => readFile(path.join(web, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SURFACES = [
  "app/(main)/retail-local/RetailLocalPricing.tsx",
  "components/retail-local/LocalLicense.tsx",
  "app/(admin)/admin/pos-devices/page.tsx",
];

test("the price list is internally consistent and excludes VAT", () => {
  assert.equal(P.vatIncluded, false);
  assert.equal(P.free.amount, 0);
  assert.equal(P.free.posDevices, 1);
  assert.ok(P.pilot.amount > 0 && P.pilot.amount < P.plus.amount, "pilot price must undercut Local Plus");
  assert.ok(P.supportRenewal.amount < P.plus.amount, "renewal must cost less than the licence");
  for (const amount of [P.plus.amount, P.pilot.amount, P.supportRenewal.amount, P.extraDevice.amount, P.backupSetup.amount, P.onSiteInstall.fromAmount]) {
    assert.ok(Number.isInteger(amount) && amount > 0, `amount ${amount} must be a positive whole baht`);
  }
  assert.equal(formatRetailLocalBaht(2990, "th"), "2,990 บาท");
  assert.equal(formatRetailLocalBaht(2990, "en"), "฿2,990");
});

test("every price surface reads the shared config and hardcodes no amount", async () => {
  const amounts = [P.plus.amount, P.pilot.amount, P.supportRenewal.amount, P.extraDevice.amount, P.backupSetup.amount, P.onSiteInstall.fromAmount]
    .flatMap((n) => [String(n), n.toLocaleString("en-US")]);
  for (const rel of SURFACES) {
    const src = stripComments(await read(rel));
    assert.ok(src.includes("RETAIL_LOCAL_PRICING"), `${rel} must read prices from retailLocalPricing.ts`);
    for (const amount of new Set(amounts)) {
      const literal = new RegExp(`(?<![\\w.])${amount.replace(",", "\\,")}(?![\\w])`);
      assert.ok(!literal.test(src), `${rel} hardcodes the amount ${amount}; read it from RETAIL_LOCAL_PRICING`);
    }
  }
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no POS, receipt, payment or kitchen code imports the price list", async () => {
  const dirs = ["app/(pos)", "app/api/pos", "lib/pos", "components/pos", "components/pos-desktop"].map((d) => path.join(web, d));
  const files = [
    ...(await Promise.all(dirs.map(walk))).flat(),
    ...(await readdir(path.join(web, "lib/bms")))
      .filter((name) => /^(pos|receipt|payment|kitchen|restaurantPos|taxDocuments)/i.test(name) && /\.ts$/.test(name))
      .map((name) => path.join(web, "lib/bms", name)),
  ];
  assert.ok(files.length > 50, `scanner found only ${files.length} files; the paths above moved`);
  for (const file of files) {
    const src = await readFile(file, "utf8");
    assert.ok(!/retailLocalPricing/.test(src), `${path.relative(root, file)} imports the Retail Local price list; prices belong in the back office only`);
  }
});

test("the copy keeps saying the shop works without paying", async () => {
  const pricing = await read("app/(main)/retail-local/RetailLocalPricing.tsx");
  assert.match(pricing, /ไม่ล็อกเครื่องเมื่อไม่ต่ออายุ/);
  assert.match(pricing, /ไม่ต่อก็ขายได้ตามปกติ/);
  assert.match(pricing, /ราคายังไม่รวม VAT 7%/);
  assert.match(pricing, /รุ่นนำร่อง/);
  const card = await read("components/retail-local/LocalLicense.tsx");
  assert.match(card, /ร้านขายได้ตามปกติ/);
  assert.match(card, /ไม่ซื้อก็ใช้งานต่อได้/);
});

test("the add-device notice is Retail Local only and never blocks saving", async () => {
  const src = stripComments(await read("app/(admin)/admin/pos-devices/page.tsx"));
  const start = src.indexOf("RETAIL_LOCAL_PRICING.free.posDevices && (");
  assert.ok(start > 0, "the add-device notice moved; update this test");
  const guard = src.slice(src.lastIndexOf("{", start), start);
  assert.match(guard, /retailLocal\s*&&\s*!editing/, "the notice must render only on Retail Local and only when adding");
  assert.ok(!/(okButtonProps|disabled)=\{[^}]*(retailLocal|RETAIL_LOCAL_PRICING)/.test(src), "licensing must not disable saving a device");
  const layout = await read("components/AdminLayoutClient.tsx");
  assert.match(layout, /<RetailLocalModeProvider value=\{retailLocal\}>/);
});
