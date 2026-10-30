import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { retailLocalPricing, retailLocalPricingSummary, shouldShowExtraDeviceNotice } from "../apps/web/lib/bms/retailLocalPricing.ts";
import { localLicenseBadge, localPlanLabel, type LocalLicenseView } from "../apps/web/lib/bms/localLicenseView.ts";
test("pricing facts are marked as a pilot proposal in both languages", () => {
  assert.equal(retailLocalPricing.approved, false);
  assert.match(retailLocalPricingSummary("th"), /รอเจ้าของอนุมัติ/);
  assert.match(retailLocalPricingSummary("en"), /pending owner approval/);
});
test("POS and business document code never imports commercial UI/config", () => {
  const roots = ["apps/web/app/(pos)", "apps/web/components/pos", "apps/web/app/api/pos", "apps/web/lib/pos", "apps/web/components/pos-desktop"];
  function inspect(path: string) {
    for (const f of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, f.name);
      if (f.isDirectory()) inspect(p);
      else if (/\.(tsx?|css)$/.test(p)) assert.doesNotMatch(readFileSync(p, "utf8"), /(?:from|import)[^\n]*(?:retailLocalPricing|LocalCommercial|LocalBackupAlert)/, p);
    }
  }
  for (const root of roots) inspect(new URL(`../${root}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
});

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("receipt, payment, tax and kitchen services never import commercial config", () => {
  const dir = new URL("../apps/web/lib/bms/", import.meta.url);
  const files = readdirSync(dir).filter((name) => /^(pos|receipt|payment|kitchen|restaurantPos|taxDocuments|orders)/i.test(name) && /\.ts$/.test(name));
  assert.ok(files.length >= 5, `scanner found only ${files.length} service files; the names above moved`);
  for (const name of files) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), "utf8"), /retailLocalPricing|LocalCommercial|LocalBackupAlert/, name);
  }
});

test("every price surface reads the shared config and hardcodes no amount", () => {
  const p = retailLocalPricing;
  const amounts = [p.plus, p.pilotPlus, p.annualSupport, p.pilotAnnualSupportAlternative, p.extraDevice, p.backupSetup, p.onsiteFrom]
    .flatMap((n) => [String(n), n.toLocaleString("en-US")]);
  const surfaces = [
    "apps/web/app/(main)/retail-local/RetailLocalPricing.tsx",
    "apps/web/app/(main)/retail-local/RetailLocalPageClient.tsx",
    "apps/web/components/retail-local/LocalCommercial.tsx",
    "apps/web/components/retail-local/LocalLicense.tsx",
    "apps/web/app/(admin)/admin/pos-devices/page.tsx",
    "apps/web/lib/bms/platformPresales.ts",
  ];
  for (const rel of surfaces) {
    const src = stripComments(read(rel));
    for (const amount of new Set(amounts)) {
      const literal = new RegExp(`(?<![\\w.,])${amount.replace(",", "\\,")}(?![\\w,])`);
      assert.ok(!literal.test(src), `${rel} hardcodes ${amount}; read it from retailLocalPricing`);
    }
  }
});

test("the device notice asks only beyond the free allowance and never blocks saving", () => {
  const free = retailLocalPricing.freeDevices;
  assert.equal(shouldShowExtraDeviceNotice(free, false), false, "a shop running exactly its free devices sees nothing on the list");
  assert.equal(shouldShowExtraDeviceNotice(free + 1, false), true);
  assert.equal(shouldShowExtraDeviceNotice(free - 1, true), false, "adding within the allowance says nothing");
  assert.equal(shouldShowExtraDeviceNotice(free, true), true, "adding the first device beyond the allowance is told");
  const page = stripComments(read("apps/web/app/(admin)/admin/pos-devices/page.tsx"));
  assert.match(page, /\{!editing && <LocalExtraDeviceNotice count=\{devices\.length\} adding \/>\}/);
  assert.doesNotMatch(page, /(okButtonProps|disabled)=\{[^}]*(retailLocal|LocalExtraDevice|freeDevices|shouldShowExtraDeviceNotice)/, "licensing must not disable saving a device");
  const notice = stripComments(read("apps/web/components/retail-local/LocalCommercial.tsx"));
  assert.match(notice, /if \(!local \|\| !shouldShowExtraDeviceNotice\(count, adding\)\) return null;/, "the notice is Retail Local only");
});

test("the plan card names the plan exactly as the licence badge does", () => {
  const base: LocalLicenseView = {
    available: true, registered: true, online: true, licenseCode: "LIC-x", licenseType: "TRIAL", commercialStatus: "TRIAL_ACTIVE",
    trialExpiresAt: null, trialDaysRemaining: 5, registrationStatus: null, reviewRequired: false, checkedAt: null,
    requestId: null, requestStatus: null, errorCode: null,
  };
  assert.equal(localPlanLabel(undefined, true), "ตรวจสถานะไม่ได้");
  assert.equal(localPlanLabel({ ...base, available: false }, true), "ตรวจสถานะไม่ได้");
  assert.equal(localPlanLabel({ ...base, registered: false }, true), "ฟรี");
  for (const commercialStatus of ["TRIAL_ACTIVE", "TRIAL_EXPIRING", "TRIAL_EXPIRED", "PAID_ACTIVE", "PAYMENT_REVIEW", "CANCELLED"]) {
    for (const th of [true, false]) {
      const view = { ...base, commercialStatus, licenseType: commercialStatus === "PAID_ACTIVE" ? "PAID" : "TRIAL" };
      assert.equal(localPlanLabel(view, th), localLicenseBadge(view, th).label, `${commercialStatus} (${th ? "th" : "en"})`);
    }
  }
  assert.equal(localPlanLabel({ ...base, commercialStatus: "TRIAL_EXPIRED" }, true), "Trial หมดอายุ");
  assert.equal(localPlanLabel({ ...base, reviewRequired: true }, true), "รอตรวจสอบ");
  const card = stripComments(read("apps/web/components/retail-local/LocalCommercial.tsx"));
  assert.match(card, /localPlanLabel\(view, th\)/, "the card must use the shared label");
  assert.doesNotMatch(card, /=== "PAID_ACTIVE" \? "Licensed"/, "no second mapping of commercial states");
});
