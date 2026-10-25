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

test("store settings can decode a shop-owned payment QR image into the bounded payload field", async () => {
  const form = await read("apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx");
  const service = await read("apps/web/lib/bms/storeProfile.ts");

  assert.match(form, /BrowserQRCodeReader/,
    "the settings form must decode the selected QR image rather than storing an unverified image URL");
  assert.match(form, /setFieldValue\(\["paymentAccounts", fieldName, "qrPayload"\], payload\)/,
    "decoded QR data must feed the existing server-bounded payment payload field");
  assert.match(form, /payload\.length > 2048/,
    "the client must reject QR data larger than the server's payload bound");
  assert.match(form, /image\/png,image\/jpeg,image\/webp/,
    "the QR picker must be restricted to the documented image formats");
  assert.match(form, /accountType === "PROMPTPAY"[\s\S]*?promptpayId[\s\S]*?: \([\s\S]*?accountNo/,
    "PromptPay rows must show the PromptPay identifier instead of the irrelevant bank-account field");
  assert.match(form, /PaymentQrPreview[\s\S]*?QRCode\.toDataURL/,
    "the decoded payload must render a preview of the QR that the customer display will show");
  assert.match(form, /name=\{\[field\.name, "qrPayload"\]\} hidden/,
    "the raw payload containing the PromptPay identifier must not be exposed in the ordinary form");
  assert.doesNotMatch(form, /name=\{\[field\.name, "qrPayload"\]\}[\s\S]{0,300}<Input\.TextArea/,
    "the ordinary settings form must not render the raw QR payload as editable text");
  assert.match(form, /qr_image_ready[\s\S]*?qr_image_missing/,
    "the form must present a clear decoded/missing status instead of raw QR data");
  assert.match(service, /validateReusablePromptPayQrPayload\(qrPayload\)/,
    "the server must validate the bank-issued base instead of trusting client-side decoding");
  assert.match(service, /PromptPay ID ไม่ตรงกับบัญชีปลายทางใน QR/,
    "the server must reject an identifier that disagrees with the QR recipient");
});

test("customer-display welcome background stays tenant-owned and idle-only", async () => {
  const form = await read("apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx");
  const service = await read("apps/web/lib/bms/storeProfile.ts");
  const restSession = await read("apps/web/app/api/pos/session/route.ts");
  const graphqlSession = await read("apps/web/graphql/bmsPosDevice.ts");
  const display = await read("apps/web/components/pos/CustomerDisplayView.tsx");
  const migration = await read("db/migrations/10.90__bms_customer_display_background.sql");

  assert.match(form, /customer-display-background\/upload/,
    "settings must upload the background through its tenant-bound route");
  assert.match(service, /customer_display_background_url/,
    "the tenant profile must persist the background URL");
  assert.ok(service.includes("!/^\\/api\\/files\\/\\d+$/.test(merged.customerDisplayBackgroundUrl)"),
    "crafted external background URLs must not be stored");
  assert.match(restSession, /customerDisplayBackgroundUrl: store\.customerDisplayBackgroundUrl/,
    "the REST POS session must expose the same background as GraphQL");
  assert.match(graphqlSession, /customerDisplayBackgroundUrl: store\.customerDisplayBackgroundUrl/);
  assert.match(display, /phase === "idle" && <WelcomeBackground/,
    "the background must render only on the idle welcome phase");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS customer_display_background_url TEXT/,
    "the additive migration must be safe to rerun");
});
