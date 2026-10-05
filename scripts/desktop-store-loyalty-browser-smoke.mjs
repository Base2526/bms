import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/desktop-store-loyalty";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const manifest = JSON.parse(await readFile(new URL("../packages/retail-local-contract/shop-archetypes.json", import.meta.url), "utf8"));
const member = { customerId: "FAKE-member", name: "FAKE Member", phone: "0800000000", memberNo: "FAKE-M1", pointsBalance: 200, pointsUsable: 200, tier: null };
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const hit = { sku: "FAKE-SKU", name: "FAKE Product", productName: "FAKE Product", receiptName: "FAKE Product", size: "BASE", baseQty: 1, packCode: "BASE", unitName: "ชิ้น", packPrice: 100, basePrice: 100,
  available: 10, barcode: "8850000000011", stockTracked: true, serialTracked: false, priceTiers: [], packs: [], modifiers: [], promotion: null, imageUrl: null };
const product = { sku: hit.sku, name: hit.productName, price: 100, availableTotal: 10, availableSizes: [{ size: "BASE", price: 100, available: 10 }], availability: "AVAILABLE", imageUrl: null };
const openedAt = new Date().toISOString();
const check = { id: "FAKE-check", serviceMode: "DINE_IN", tableId: "FAKE-table", tableCode: "T01", tableName: "FAKE Table", areaName: "FAKE Area",
  status: "OPEN", guestCount: 1, amountDue: 100, version: 1, reservedVersion: 1, hasCurrentOrder: true, reservationStatus: "PENDING", reservationLost: false,
  openedAt, splitGroupNo: 1, splitFromCheckId: null, itemCount: 1, unsentCount: 0,
  items: [{ id: "FAKE-item", sku: hit.sku, productName: hit.productName, size: "BASE", packQty: 1, packCode: "BASE", unitName: "ชิ้น", packPrice: 100,
    lineAmount: 100, modifierCodes: [], modifierNames: [], kitchenNote: null, status: "SENT", roundNo: 1, sentAt: openedAt, kitchenStatus: "SERVED" }] };
try {
  // Board-game floor/checkout has its own desktop-pos-theme-browser-smoke coverage.
  for (const archetype of manifest.archetypes.map((entry) => entry.id).filter((id) => id !== "board_game_cafe"
    && (!process.argv[2] || process.argv.slice(2).includes(id)))) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-store-smoke",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }) };
    });
    const session = { device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
      location: { id: "FAKE-location", name: `FAKE ${archetype}`, branchCode: "MAIN" }, shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt },
      cashiers: [cashier], approvers: [], kitchenOperators: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
      surface: "retail", businessArchetype: archetype, vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" } };
    let block = null, quoteDelay = 0, quotes = [];
    const mutations = [], errors = [];
    const preview = (input) => ({ status: "READY", reason: null, subtotal: input.subtotal ?? 100,
      netTotal: (input.subtotal ?? 100) - (block ? 50 : 0), amountDue: (input.subtotal ?? 100) - (block ? 50 : 0),
      totalDiscount: block ? 50 : 0, tierDiscount: 0, couponDiscount: block ? 50 : 0, couponError: null, pointsDiscount: 0, pointsUsed: input.pointsToRedeem || 0,
      manualDiscount: 0, loyaltyEnabled: block !== "PROGRAM_DISABLED", pointsWillEarn: input.customerId ? block ? 0 : 100 : null,
      pointsEarnBlock: input.customerId ? block : null, member: input.customerId ? member : null, redeemPointsPerUnit: 100, redeemBahtPerUnit: 10, redeemMinPoints: 100 });
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url()), path = url.pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "", input = body?.variables?.input || {};
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: session };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [product] } };
        else if (q.includes("query MobilePosScan")) data = { bmsPosScan: hit };
        else if (q.includes("query DesktopMemberSearch")) data = { bmsPosMemberSearch: { members: [member] } };
        else if (q.includes("query DesktopBenefitsPreview")) { quotes.push(input); data = { bmsPosMemberPreview: preview(input) }; }
        else if (q.includes("mutation")) mutations.push(q);
        json = { data };
      } else if (path === "/api/pos/session") json = session;
      else if (path === "/api/pos/member") json = { members: [member], loyalty: { enabled: true, pointsForAmount: 100, block: null } };
      else if (path === "/api/pos/member/preview") { quotes.push(body); json = preview(body); if (quoteDelay) await new Promise((resolve) => setTimeout(resolve, quoteDelay)); }
      else if (path === "/api/pos/scan") json = hit;
      else if (path === "/api/pos/search" || path === "/api/pos/catalog") json = { items: [product] };
      else if (path === "/api/pos/restaurant/floor") json = { areas: [{ id: "FAKE-area", name: "FAKE Area", sortOrder: 0 }], tables: [{ id: "FAKE-table", areaId: "FAKE-area", code: "T01", name: "FAKE Table", seats: 4, shape: "round", positionX: 50, positionY: 50, blocked: false, status: "OCCUPIED", check, checks: [check] }], takeawayChecks: [] };
      else if (path === "/api/pos/restaurant/checks/FAKE-check" && !body) json = { check };
      else if (path.endsWith("/tickets")) json = { tickets: [] };
      else if (path.endsWith("/menu")) json = { items: [] };
      else if (path.endsWith("/waitlist")) json = { entries: [], waitingCount: 0, calledCount: 0, waitingGuests: 0 };
      else if (path.endsWith("/qr-orders")) json = { submissions: [] };
      else if (path.endsWith("/service-calls")) json = { serviceCalls: [] };
      else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      else if (path === "/api/logs") json = {};
      else if (body) mutations.push(path);
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      if (archetype === "restaurant") {
        await page.waitForURL("**/pos/restaurant");
        await page.getByRole("button", { name: /FAKE Table/ }).first().click();
        await page.getByRole("button", { name: /คิดเงิน/, exact: false }).first().click();
        await page.getByPlaceholder("ชื่อ / เบอร์ / เลขสมาชิก อย่างน้อย 3 ตัว").fill("FAKE");
        await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
        await page.getByRole("button", { name: /FAKE Member/ }).click();
        await page.getByText("บิลนี้จะได้ 100 แต้ม", { exact: true }).waitFor();
        block = "BELOW_MIN_SPEND"; quoteDelay = 700;
        await page.getByLabel("รหัสคูปอง", { exact: true }).fill("FAKE");
        assert.equal(await page.getByText("บิลนี้จะได้ 100 แต้ม", { exact: true }).count(), 0, "old quote hidden while repricing");
        assert.equal(await page.getByRole("button", { name: "ยืนยันรับเงิน", exact: true }).isDisabled(), true, "pending quote cannot enable settlement");
        await page.getByText("ยอดบิลยังไม่ถึงขั้นต่ำที่ร้านตั้งไว้ · บิลนี้จะไม่ได้แต้ม", { exact: true }).waitFor();
        await page.getByLabel("แต้มที่จะแลก", { exact: true }).fill("100");
        await page.getByRole("button", { name: "ลบ", exact: true }).click();
        assert.equal(await page.getByLabel("แต้มที่จะแลก", { exact: true }).inputValue(), "");
        assert.equal(await page.getByText("บิลนี้จะได้ 100 แต้ม", { exact: true }).count(), 0, "guest bills do not promise member points");
        await page.getByRole("button", { name: /FAKE Member/ }).click();
        await page.getByText("ยอดบิลยังไม่ถึงขั้นต่ำที่ร้านตั้งไว้ · บิลนี้จะไม่ได้แต้ม", { exact: true }).waitFor();
      } else if (archetype === "pharmacy") {
        assert.equal(new URL(page.url()).pathname, "/pos/app");
        const scan = page.getByPlaceholder(/ยิงบาร์โค้ด/).first();
        await scan.fill(hit.sku); await scan.press("Enter");
        await page.getByRole("button", { name: /ขยาย/ }).click();
        await page.getByPlaceholder("เบอร์โทร / เลขสมาชิก", { exact: true }).fill("FAKE");
        await page.getByRole("button", { name: /FAKE Member/ }).click();
        await page.getByText("บิลนี้จะได้ 100 แต้ม", { exact: true }).waitFor();
        block = "BELOW_MIN_SPEND"; quoteDelay = 1500;
        const nextQuote = page.waitForRequest((request) => request.url().includes("/api/pos/member/preview") && request.postDataJSON()?.subtotal === 200);
        await scan.fill(hit.sku); await scan.press("Enter");
        await nextQuote;
        assert.equal(await page.getByText("บิลนี้จะได้ 100 แต้ม", { exact: true }).count(), 0, "pharmacy hides stale cart points");
        await page.getByText(/ยอดบิลยังไม่ถึงขั้นต่ำที่ร้านตั้งไว้/).waitFor();
      } else {
        await page.getByRole("button", { name: /FAKE Product/ }).first().click();
        await page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
        const search = page.getByRole("combobox", { name: "ค้นหาสมาชิก" });
        await search.fill("FAKE");
        await page.locator(".ant-select-dropdown:visible").getByText(/FAKE Member/).click();
        await page.getByText(/บิลนี้ได้รับ/).waitFor();
        block = "BELOW_MIN_SPEND";
        await page.getByRole("textbox", { name: "รหัสคูปอง", exact: true }).fill("FAKE");
        await page.getByText("ยอดบิลยังไม่ถึงขั้นต่ำสำหรับสะสมแต้ม", { exact: true }).waitFor();
      }
      await page.screenshot({ path: `${output}/${archetype}.png`, fullPage: true });
      assert.ok(quotes.some((input) => input.customerId === member.customerId));
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      console.log(`PASS ${archetype}: desktop route, member selection, server points/block; no sale or approval mutation`);
    } catch (error) {
      console.error(archetype, (await page.locator("body").innerText()).slice(-7000), errors, mutations);
      await page.screenshot({ path: `${output}/${archetype}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
