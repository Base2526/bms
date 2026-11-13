// Local-only synthetic UI smoke. Every API call is intercepted; no business writes.
// BMS_PLAYWRIGHT_PACKAGE=/path/to/playwright BMS_ADMIN_SMOKE_ORIGIN=http://localhost:3000 node scripts/admin-language-browser-smoke.mjs
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const { parse, buildSchema, isNonNullType, isListType } = require("graphql");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "Use a local test server");
const schema = buildSchema(readFileSync(path.join(root, "schema.graphql"), "utf8"));
const permissions = [...readFileSync(path.join(root, "apps/web/lib/bms/permissions.ts"), "utf8").matchAll(/"([a-z_]+\.[a-z_.]+)"/g)].map(match => match[1]);
const out = path.join(root, ".test-output/admin-language");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-localization-fixture", url: origin }, { name: "lang", value: "en", url: origin }]);
  await context.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let json = { items: [], total: 0 };
    if (pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE ร้านไทย" } };
    else if (pathname === "/api/graphql") {
      const data = {};
      for (const definition of parse(route.request().postDataJSON().query).definitions) {
        if (definition.kind !== "OperationDefinition") continue;
        assert.notEqual(definition.operation, "mutation", "Language controls must not mutate business data");
        for (const field of definition.selectionSet.selections) {
          if (field.kind !== "Field") continue;
          const name = field.name.value, alias = field.alias?.value || name;
          let type = schema.getQueryType().getFields()[name]?.type;
          while (isNonNullType(type)) type = type.ofType;
          data[alias] = isListType(type) ? [] : null;
          if (/Paged$/.test(name)) data[alias] = { items: [], total: 0 };
          if (name === "myBmsPermissions") data[alias] = permissions;
          if (name === "post") data[alias] = {
            id: "FAKE-post", title: "FAKE post ร้านไทย", detail: "FAKE details", first_last_name: "FAKE name", status: "pending",
            transfer_amount: 0, transfer_date: "2026-11-12", updated_at: "2026-11-12T09:00:00Z", created_at: "2026-11-12T09:00:00Z",
            website: null, tel_numbers: [], seller_accounts: [], province_name: null, province_id: null, images: [], id_card: null,
            is_bookmarked: false, fb_permalink_url: null, fb_published_at: null, fb_status: null, fb_social_post_id: null,
            author: { id: "FAKE-author", name: "FAKE author", role: "member", email: "fake@example.invalid", phone: null, avatar: null, created_at: "2026-11-12T09:00:00Z" },
          };
          if (name === "comments") data[alias] = [{
            id: "FAKE-comment", post_id: "FAKE-post", user_id: "FAKE-author", parent_id: null, content: "FAKE comment ต้นฉบับ",
            created_at: new Date(Date.now() - 120000).toISOString(), user: { id: "FAKE-author", name: "FAKE author", avatar: null }, replies: [],
          }];
          if (name === "bmsPharmacyAssessments") data[alias] = [{
            id: "FAKE-case", status: "WAITING_FOR_PHARMACIST", riskLevel: "LOW", patientRelationship: "SELF", needsManualIntake: false,
            assignedPharmacistId: null, channelId: "test", currentQuestionKey: null,
            createdAt: "2026-11-12T09:00:00Z", updatedAt: "2026-11-12T09:00:00Z",
            completenessStatus: "INCOMPLETE", customerConfirmationStatus: "PENDING", customerConfirmedAt: null,
            missingFields: [], conflictingFields: [], customerConfirmationSummary: null,
          }];
          if (name === "bmsLoyaltyActivity") data[alias] = [{ month: "2026-11-01", earned: 10, redeemed: 0, expired: 0, reversedNet: 0, adjustedNet: 0 }];
          if (name === "bmsFeatureAccess") data[alias] = [{ feature: "REPORT_SCHEDULE", minimumPlan: "PRO", allowed: true, source: "FAKE" }];
          if (name === "bmsReportSubscription") data[alias] = {
            frequency: "DAILY", sendHour: 9, sendWeekday: 1, sendDayOfMonth: 1,
            emailEnabled: false, recipientEmail: "", slackEnabled: false, hasSlackWebhook: false,
            lineEnabled: false, lineUserId: "", enabled: false, lastSentAt: "2026-11-12T09:00:00Z", lastStatus: "PARTIAL", lastPeriodKey: "2026-11-12",
          };
          if (name === "bmsReportDeliveries") data[alias] = [{ id: "FAKE-delivery", frequency: "DAILY", channel: "EMAIL", status: "PARTIAL", error: null, payloadSnapshot: null, createdAt: "2026-11-12T09:00:00Z" }];
          if (name === "bmsProducts") data[alias] = { total: 2, items: [{ sku: "FAKE-สินค้า-123", name: "FAKE product ร้านไทย", variants: [{ size: "FAKE-size", available: 3, reserved_stock: 1 }] }] };
          if (name === "bmsPharmacyAssessment") data[alias] = {
            id: "FAKE-case", status: "WAITING_FOR_PHARMACIST", riskLevel: "LOW", version: 1,
            patientRelationship: null, consentStatus: null, conversationId: null, biologicalSex: null,
            pregnancyStatus: null, breastfeedingStatus: null, patientAgeYears: null,
            missingFields: [], conflictingFields: [], anomalies: [], completenessStatus: "INCOMPLETE", detectedRedFlags: [],
            customerConfirmationStatus: "PENDING", customerConfirmationSummary: null, customerConfirmedAt: null,
            structuredAnswers: {}, rawMessages: [], aiSummary: null, aiSummaryVersion: 0,
            pharmacistDecisionNotes: null, needsManualIntake: false, protocolId: null, medicationSuggestions: [], checkoutOrderDraft: null,
            channelId: "test", createdAt: "2026-11-12T09:00:00Z", updatedAt: "2026-11-12T09:00:00Z", expiresAt: null,
          };
          if (name === "roles") data[alias] = [{ id: "FAKE-role", name: "FAKE role", description: "FAKE description", is_active: true, user_count: 0, created_at: "2026-11-12T09:00:00Z", updated_at: "2026-11-12T09:00:00Z" }];
        }
      }
      json = { data };
    } else if (pathname.endsWith("/inventory/transfers")) json = { transfers: [], commandScope: "FAKE-scope", locations: [{ id: "FAKE-a", code: "A", name: "FAKE สาขา", active: true }, { id: "FAKE-b", code: "B", name: "FAKE branch", active: true }] };
    else if (pathname.endsWith("/inventory/counts")) json = { counts: [], locations: [] };
    else if (pathname.endsWith("/realtime/ticket")) return route.fulfill({ status: 503, json: { error: "FAKE realtime disabled" } });
    await route.fulfill({ json });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => { errors.push(error.message); });
  const switchLanguage = async language => {
    await page.getByRole("button", { name: /^(Account menu|เมนูบัญชีของฉัน)$/ }).click();
    await page.getByRole("menuitem", { name: /Language|ภาษา/ }).hover();
    await page.locator(`[data-admin-language="${language}"]`).click();
    await page.waitForFunction(value => document.documentElement.lang === value, language);
  };

  await page.goto(`${origin}/admin/product-packs`);
  const sku = page.getByPlaceholder("Enter a SKU and press Enter");
  await sku.fill("FAKE-สินค้า-123");
  await switchLanguage("th");
  assert.equal(await page.getByPlaceholder("ใส่ SKU แล้วกด Enter").inputValue(), "FAKE-สินค้า-123");
  await switchLanguage("en");
  assert.equal(await sku.inputValue(), "FAKE-สินค้า-123");
  await page.reload();
  await sku.waitFor();
  assert.ok((await context.cookies()).some(cookie => cookie.name === "lang" && cookie.value === "en"));

  for (const language of ["en", "th"]) {
    if (language === "th") await switchLanguage("th");
    await page.goto(`${origin}/admin/commission`);
    await page.locator(".ant-picker input").first().click();
    const month = page.locator(".ant-picker-dropdown:visible .ant-picker-month-btn").first();
    await month.waitFor();
    assert.equal(/[ก-๙]/.test(await month.innerText()), language === "th", "Calendar month follows operator language");
    await page.keyboard.press("Escape");
    await page.goto(`${origin}/admin/roles`);
    await page.getByText(language === "en" ? "Create Role" : "สร้างบทบาท", { exact: true }).first().click();
    await page.getByRole("dialog").getByText(language === "en" ? "Role Name" : "ชื่อบทบาท", { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ animations: "disabled", path: path.join(out, `roles-${language}-${width}.png`) });
      assert.doesNotMatch(await page.locator("body").innerText(), /admin_ui\.[a-z_0-9]+/);
      const dialogBounds = await page.getByRole("dialog").boundingBox();
      assert.ok(dialogBounds && dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width + 1, "Role dialog fits the viewport");
    }
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`${origin}/admin/stock-transfers`);
    await page.getByText(language === "en" ? "Stock transfers between branches" : "โอนย้ายสต็อกระหว่างสาขา", { exact: true }).waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(out, `transfers-${language}-390.png`) });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${origin}/admin/playground`);
    await page.getByText("FAKE product ร้านไทย", { exact: true }).waitFor();
    await page.getByText(language === "en" ? "Showing 1 of 2 products. Open Products to view the full catalog." : "แสดงสินค้า 1 จาก 2 รายการ ดูสินค้าทั้งหมดได้ที่หน้าสินค้า", { exact: true }).waitFor();
    await page.goto(`${origin}/admin/pharmacy-queue/FAKE-case`);
    await page.locator("h2").filter({ hasText: "FAKE-cas" }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ animations: "disabled", path: path.join(out, `pharmacy-case-${language}-${width}.png`) });
      assert.doesNotMatch(await page.locator("body").innerText(), /admin_ui\.[a-z_0-9]+|This page encountered an error|หน้านี้ทำงานผิดพลาด/);
    }
    await page.setViewportSize({ width: 1440, height: 950 });
  }
  for (const language of ["th", "en"]) {
    if (language === "en") await switchLanguage("en");
    for (const route of ["pharmacy-queue", "loyalty", "settings", "orders", "restock-subscriptions", "post/FAKE-post"]) {
      // The same PostView/CommentsSection is shared by admin and public post routes.
      // Admin posts require a DB-verified platform admin, outside this synthetic smoke.
      await page.goto(`${origin}/${route.startsWith("post/") ? route : `admin/${route}`}`);
      if (route === "pharmacy-queue") await page.getByText(language === "en" ? "Awaiting pharmacist" : "รอเภสัชกร", { exact: true }).first().waitFor();
      if (route === "orders") await page.getByRole("heading", { name: language === "en" ? "BMS Orders (OMS)" : "จัดการออเดอร์ BMS (OMS)", exact: true }).waitFor();
      if (route === "restock-subscriptions") await page.locator("h3").first().waitFor();
      if (route === "post/FAKE-post") await page.getByText(language === "en" ? "2 minutes ago" : "2 นาทีที่ผ่านมา", { exact: true }).waitFor();
      if (route === "loyalty") await page.getByText(language === "en" ? "Nov 2026" : "พ.ย. 2569", { exact: true }).waitFor();
      if (route === "settings") {
        await page.getByRole("tab", { name: language === "en" ? /Sales digest reports/ : /รายงานสรุปยอดขาย/ }).click();
        await page.getByText(language === "en" ? "Partially successful" : "สำเร็จบางส่วน", { exact: true }).first().waitFor();
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 950 });
        await page.screenshot({ animations: "disabled", path: path.join(out, `${route.replaceAll("/", "_")}-${language}-${width}.png`) });
        assert.doesNotMatch(await page.locator("body").innerText(), /admin_ui\.[a-z_0-9]+|This page encountered an error|หน้านี้ทำงานผิดพลาด/);
      }
      await page.setViewportSize({ width: 1440, height: 950 });
    }
    await page.goto(`${origin}/admin/stock-transfers`);
  }
  await switchLanguage("th");
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole("button", { name: /เปิดเมนู|Open menu/ }).click();
  await switchLanguage("en");
  await page.keyboard.press("Escape");
  await page.goto(`${origin}/admin/stock-transfers`);
  await page.getByText("Stock transfers between branches", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS admin Thai/English: retained SKU, persisted language, calendar months, role dialogs, transfers, bounded stock preview, pharmacy status, loyalty months, report delivery status and shared comment times at desktop/mobile widths");
} catch (error) {
  if (page) {
    await page.screenshot({ animations: "disabled", path: path.join(out, "failure.png") });
    console.error("Synthetic fixture page:", await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser.close();
}
