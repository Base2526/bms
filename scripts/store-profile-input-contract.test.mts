import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("nullable GraphQL input cannot write null into store-profile NOT NULL columns", async () => {
  const service = await read("apps/web/lib/bms/storeProfile.ts");
  const form = await read("apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx");

  for (const key of [
    "aiLanguage", "aiOrderingStyle", "aiRequiredFields", "aiInterpretShortReplies",
    "aiHandoffAfterFailedTurns", "receiptLanguageMode", "restaurantOrderHours",
    "restaurantOrdersPaused", "restaurantMerchantAbsorbLimit", "paymentAccounts",
    "enabledCarriers", "shippingMode", "shippingZoneRates", "shippingWeightTiers",
  ]) {
    assert.match(service, new RegExp(`"${key}"`), `${key} is missing from the NOT NULL guard`);
  }
  assert.match(service, /if \(input\[key\] == null\).*current\[key\]/,
    "null must preserve the current server value");
  assert.match(service, /const merged = mergeStoreProfileInput\(cur, input\)/,
    "the upsert must use the guarded merge");
  assert.match(form, /input\.restaurantOrdersPaused = v\.restaurantOrdersPaused[\s\S]*?bmsStoreProfile\?\.restaurantOrdersPaused[\s\S]*?false/,
    "the form must always submit a concrete pause state");
});
