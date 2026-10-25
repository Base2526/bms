import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));

const output = ".test-output/store-profile-payment-account";
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const QRCode = require("../apps/web/node_modules/qrcode");
function crc16(value) {
  let crc = 0xffff;
  for (const char of value) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const amountFreeMethod12WithoutCrc = "00020101021229370016A0000006770101110113006681234567853037645802TH6304";
const amountFreeMethod12 = `${amountFreeMethod12WithoutCrc}${crc16(amountFreeMethod12WithoutCrc)}`;
const amountFreeMethod12Image = `${output}/amount-free-method-12.png`;
await QRCode.toFile(amountFreeMethod12Image, amountFreeMethod12, { errorCorrectionLevel: "M", margin: 4, width: 600 });
const qrSmokeImage = process.env.BMS_QR_SMOKE_IMAGE || amountFreeMethod12Image;
const uploadedBackground = await readFile(amountFreeMethod12Image);
const browser = await chromium.launch({ channel: "chrome", headless: true });

const profile = {
  businessArchetype: "retail", businessArchetypeLocked: false, businessType: "retail",
  aiLanguage: "th", aiOrderingStyle: "catalog_variant", aiRequiredFields: ["product", "size", "qty"],
  aiInterpretShortReplies: true, aiHandoffAfterFailedTurns: 3, receiptLanguageMode: "th",
  about: null, address: null, provinceCode: null, districtCode: null, subdistrictCode: null,
  province: null, district: null, subdistrict: null, postcode: null, phone: null,
  contactEmail: null, website: null, logoUrl: null, customerDisplayBackgroundUrl: null, taxId: null, timezone: "Asia/Bangkok",
  country: "TH", currency: "THB", businessHours: null, restaurantOrderHours: [],
  restaurantOrdersPaused: false, restaurantMerchantAbsorbLimit: 2000,
  shippingPolicy: null, returnPolicy: null,
  paymentAccounts: [{
    type: "PROMPTPAY", bankCode: "SCB", bankName: "ธนาคารไทยพาณิชย์",
    accountName: "ร้านทดสอบ", accountNo: null, promptpayId: null, qrPayload: null, note: null,
  }],
  shippingFlatRate: null, shippingFreeThreshold: null, shippingEstDaysMin: null, shippingEstDaysMax: null,
  enabledCarriers: [], shippingMode: "flat", shippingOriginProvince: null, shippingOriginPostcode: null,
  shippingZoneRates: [], shippingWeightTiers: [], emailThemeColor: "#1677ff", emailFooterText: null,
  barcodeMasterContributionEnabled: false,
};

try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
      { name: "lang", value: lang, url: base },
    ]);
    const errors = [];
    await context.route(/\/(?:api\/|graphql)/, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") {
        return route.fulfill({ json: { isAuthenticated: true, admin: { id: 1, role: "Administrator", email: "fake@example.test", language: lang } } });
      }
      if (path === "/api/bms/store-profile/customer-display-background/upload") {
        return route.fulfill({ json: { url: "/api/files/999", name: "background.webp", mimeType: "image/webp" } });
      }
      if (path === "/api/files/999") {
        return route.fulfill({ body: uploadedBackground, contentType: "image/png" });
      }
      if (!["/graphql", "/api/graphql"].includes(path)) return route.fulfill({ json: {} });
      const body = route.request().postDataJSON();
      if (body?.query?.includes("mutation")) throw new Error("browser smoke must not mutate store settings");
      return route.fulfill({ json: { data: {
        myBmsPermissions: ["settings.manage"], bmsIsPlatformAdmin: false,
        bmsMyTenant: { id: "FAKE", name: "FAKE Shop", slug: "fake" },
        bmsChannels: [], bmsChannelHealth: [], bmsActingTenant: null,
        bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
        bmsMe: { id: "1", email: "fake@example.test", tenant: { id: "FAKE", slug: "fake" } },
        bmsAiConfig: { has_key: false, api_key_masked: null, model: "claude-haiku-4-5", provider: "anthropic" },
        bmsAiUsage: { billingMode: "PLAN_POINTS", count: 0, limit: 100, remaining: 100, unlimited: false, planCode: "free", planName: "Free" },
        bmsAiLimitNotifications: { unreadCount: 0, items: [] },
        bmsStoreProfile: profile,
        bmsMasterBanks: [
          { code: "BBL", nameTh: "ธนาคารกรุงเทพ", nameEn: "Bangkok Bank", active: true },
          { code: "KBANK", nameTh: "ธนาคารกสิกรไทย", nameEn: "Kasikornbank", active: true },
          { code: "KTB", nameTh: "ธนาคารกรุงไทย", nameEn: "Krung Thai Bank", active: true },
          { code: "SCB", nameTh: "ธนาคารไทยพาณิชย์", nameEn: "Siam Commercial Bank", active: true },
        ],
      } } });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${base}/admin/settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.getByRole("tab", { name: lang === "th" ? "ข้อมูลร้าน" : "Store info" }).click();
      const contactBrand = page.locator(".ant-collapse-header").filter({ hasText: lang === "th" ? "ติดต่อ / แบรนด์" : "Contact / branding" });
      await contactBrand.click();
      await page.getByText(lang === "th" ? "รูปพื้นหลังหน้าต้อนรับจอลูกค้า" : "Customer-display welcome background", { exact: false }).waitFor();
      await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').nth(1).setInputFiles(amountFreeMethod12Image);
      await page.getByText(lang === "th"
        ? "อัปโหลดรูปพื้นหลังแล้ว กรุณากดบันทึกข้อมูลร้าน"
        : "Background uploaded. Save the store profile to apply it.", { exact: true }).waitFor();
      await page.getByAltText(lang === "th"
        ? "ตัวอย่างรูปพื้นหลังหน้าต้อนรับจอลูกค้า"
        : "Customer-display welcome background preview").waitFor();
      const receiving = page.locator(".ant-collapse-header").filter({ hasText: lang === "th" ? "บัญชีรับเงิน" : "Receiving accounts" });
      await receiving.click();
      await page.getByText(lang === "th" ? "บัญชีรับเงิน 1" : "Receiving account 1", { exact: true }).waitFor();
      await page.getByText(lang === "th" ? "รูป QR ฐานสำหรับ Dynamic QR (ไม่บังคับ)" : "Base image for Dynamic QR (optional)", { exact: true }).waitFor();
      await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').nth(2).setInputFiles(qrSmokeImage);
      await page.getByText(lang === "th"
        ? "อ่านข้อมูล QR จากรูปแล้ว กรุณากดบันทึกข้อมูลร้าน"
        : "QR data read from the image. Save the store profile to apply it.", { exact: true }).waitFor();
      await page.getByText(lang === "th"
        ? "ตรวจสอบ QR ฐานสำเร็จ — POS จะสร้าง Dynamic QR พร้อมยอดใหม่ให้แต่ละบิล"
        : "Base QR verified — POS will create a new amount-bearing Dynamic QR for each bill", { exact: true }).waitFor();
      if (!process.env.BMS_QR_SMOKE_IMAGE) {
        assert.equal(await page.getByLabel(lang === "th" ? "เลขพร้อมเพย์" : "PromptPay ID").inputValue(), "0812345678");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "form must not overflow the viewport");
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });

      await page.getByLabel(lang === "th" ? "ธนาคาร / ผู้ให้บริการ" : "Bank / provider").locator("../..").click();
      const fullScbName = lang === "th" ? "ธนาคารไทยพาณิชย์ (SCB)" : "Siam Commercial Bank (SCB)";
      const option = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")
        .filter({ hasText: fullScbName });
      await option.waitFor();
      assert.equal(await option.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, "bank option must show its full name");
      await page.screenshot({ path: `${output}/${lang}-${width}-bank-menu.png` });
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
  console.log("PASS store branding and receiving-account forms: background preview, amount-free method-12 QR, readable bank names, and no desktop/mobile overflow; mocked APIs only");
} finally {
  await browser.close();
}
