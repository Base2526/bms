import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Real POS route, browser-only fixtures. Mutations below are intercepted, never sent to a server.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const baseUrl = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
const output = "apps/desktop/dist-smoke/desktop-theme";
await mkdir(output, { recursive: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true };
const startedAt = new Date(Date.now() - 3_600_000).toISOString();
const session = {
  id: "FAKE-session", status: "OPEN", billingMode: "HOURLY", guestCount: 2, startedAt,
  tableId: "FAKE-table", originTableId: "FAKE-table", originTableCode: "T01", originTableName: "FAKE Table",
  seatingId: "FAKE-seating", expectedEndAt: null, nextAlertAt: null, alertStatus: "NONE", amountDue: 100,
  participants: [], games: [{ id: 'FAKE-loan', copyId: 'FAKE-unavailable', copyCode: 'FAKE-AZ-02', title: 'FAKE Azul', status: 'CHECKED_OUT', returnedAt: null }], identityHolds: [],
  billingGroups: [
    { id: "FAKE-open", groupNo: 1, status: "OPEN", amountDue: 0, tabAmount: 0, chargeSnapshot: [], tabItems: [] },
    { id: "FAKE-closing", groupNo: 2, status: "CLOSING", amountDue: 100, tabAmount: 0, chargeSnapshot: [], tabItems: [] },
  ],
};
const workspace = {
  floor: { areas: [{ id: "FAKE-area", name: "FAKE Area", sortOrder: 0 }], tables: [{
    id: "FAKE-table", areaId: "FAKE-area", code: "T01", name: "FAKE Table", seats: 4, sortOrder: 0,
    blocked: false, openSession: { ...session, sessionIds: [session.id], sessionCount: 1, billingGroupCount: 2, awaitingPaymentCount: 1 },
  }] },
  rates: [], serviceCalls: [],
  library: [{ id: "FAKE-title", title: "FAKE Azul", imageUrl: "/api/files/FAKE-image", copies: [
    { id: "FAKE-copy", copyCode: "FAKE-AZ-01", status: "AVAILABLE" },
    { id: "FAKE-unavailable", copyCode: "FAKE-AZ-02", status: "IN_USE" },
  ] }],
  waitlist: { entries: [], tables: [], waitingCount: 0, calledCount: 0, waitingGuests: 0 },
};
const member = { customerId: "FAKE-member", name: "FAKE Member", phone: "0000000000", memberNo: "FAKE-001", pointsBalance: 10, pointsUsable: 10 };
const product = { sku: "FAKE-product", name: "FAKE Product", price: 100, availability: "AVAILABLE", availableTotal: 10,
  imageUrl: "/api/files/FAKE-image", availableSizes: [{ size: "M", price: 100, available: 10 }] };
const bootstrap = {
  device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
  location: { id: "FAKE-location", name: "FAKE Board Game Cafe", branchCode: "MAIN" },
  shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: startedAt },
  cashiers: [cashier], approvers: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
  surface: "retail", businessArchetype: "board_game_cafe",
  vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" },
};

async function assertLight(locator, label) {
  const paint = await locator.evaluate((el) => {
    const css = getComputedStyle(el);
    return { bg: css.backgroundColor, fg: css.color };
  });
  const channels = paint.bg.match(/[\d.]+/g)?.map(Number);
  assert.ok(channels && channels.slice(0, 3).every((n) => n > 220) && (channels[3] ?? 1) > 0.9,
    `${label}: expected an opaque light surface, got ${JSON.stringify(paint)}`);
}

async function screenshot(page, name) {
  await page.waitForFunction(() => {
    const popup = [...document.querySelectorAll(".ant-select-dropdown")].find((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== "none");
    return popup && getComputedStyle(popup).opacity === "1"
      && !/ant-slide-(?:up|down)-(?:appear|enter|leave)/.test(popup.className);
  });
  await page.screenshot({ path: `${output}/${name}.png` });
}

async function centerInput(input) {
  await input.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await input.locator("xpath=ancestor::*[contains(@class,'ant-select-selector')]").click();
}

try {
  for (const mode of ["dark", "system", "light"]) {
    const sessionState = structuredClone(session);
    const workspaceState = structuredClone(workspace);
    const copyCommands = [];
    let expectedCopyAction = null;
    let heldScan = null;
    const scanRequests = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    await context.addCookies([{ name: "theme", value: mode, url: baseUrl }, { name: "lang", value: "th", url: baseUrl }]);
    await context.addInitScript(() => {
      window.bmsDesktop = {
        isDesktop: true, getDeviceToken: async () => "FAKE-token",
        getStorageNamespace: async () => "FAKE-theme-smoke",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }),
      };
    });
    const unexpected = [];
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/files/FAKE-image") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
      const body = route.request().postDataJSON();
      if (path === "/api/graphql") {
        const query = body?.query || "";
        let data = {};
        if (query.includes("query PosBootstrap")) data = { bmsPosSession: bootstrap };
        else if (query.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (query.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [product] } };
        else if (query.includes("query MobilePosScan")) {
          scanRequests.push(body.variables.code);
          if (heldScan && body.variables.code === "FAKE-SLOW") await heldScan;
          data = { bmsPosScan: body.variables.code === "FAKE-MISSING" ? null : {
          sku: product.sku, productName: product.name, size: "M", unitName: "ชิ้น", barcode: "8850000000011", packPrice: 100,
          baseQty: 1, packCode: "BASE", basePrice: 100, available: 10, stockTracked: true, serialTracked: false,
          imageUrl: product.imageUrl, priceTiers: [], promotion: null, modifiers: [], packs: [],
          } };
        }
        else if (query.includes("query DesktopPosBoardGameCheckout")) data = { bmsPosBoardGameCheckout: {
          id: "FAKE-closing", sessionId: session.id, groupNo: 2, sessionGroupCount: 2,
          tableCode: "T01", tableName: "FAKE Table", billingMode: "HOURLY", startedAt,
          endedAt: new Date().toISOString(), amountDue: 100, totalDue: 100, tabAmount: 0,
          tabPricingDiscountAmount: 0, tabItemCount: 0, chargeLineCount: 0, passCoveredAmount: 0,
          offerDiscountAmount: 0, chargeLines: [], tabItems: [],
        } };
        else if (query.includes("query DesktopMemberSearch")) data = { bmsPosMemberSearch: { members: body.variables.q.includes("zzz") ? [] : [member] } };
        else if (query.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: {
          status: "READY", netTotal: 100, amountDue: 100, totalDiscount: 0, tierDiscount: 0,
          couponDiscount: 0, pointsDiscount: 0, pointsUsed: 0, loyaltyEnabled: body.variables.input.couponCode !== "PROGRAM_DISABLED",
          pointsWillEarn: body.variables.input.customerId ? 0 : null,
          pointsEarnBlock: body.variables.input.customerId ? body.variables.input.couponCode || "BELOW_MIN_SPEND" : null,
          member: body.variables.input.customerId ? member : null,
        } };
        else if (query.includes("mutation")) unexpected.push(query);
        return route.fulfill({ json: { data } });
      }
      if (path === "/api/pos/board-game") {
        if (body.action === "workspace") return route.fulfill({ json: workspaceState });
        if (body.action === "session") return route.fulfill({ json: { session: sessionState } });
        if (body.action === "service.calls") return route.fulfill({ json: { serviceCalls: [] } });
        if (body.action === expectedCopyAction) {
          copyCommands.push(body);
          expectedCopyAction = null;
          const copyId = body.action === "copy.return" ? sessionState.games.find((loan) => loan.id === body.loanId)?.copyId : body.copyId;
          const copy = workspaceState.library.flatMap((title) => title.copies).find((item) => item.id === copyId);
          if (copy) copy.status = body.action === "copy.return" ? body.copyStatus : "IN_USE";
          if (body.action === "copy.return") sessionState.games = [];
          else sessionState.games = [{ id: "FAKE-new-loan", copyId: body.copyId, copyCode: "FAKE-AZ-01", title: "FAKE Azul", status: "CHECKED_OUT", returnedAt: null }];
          return route.fulfill({ json: {} });
        }
        unexpected.push(body.action);
      }
      if (path === "/api/retail-local/desktop-update") return route.fulfill({ json: { status: "unavailable", releases: [] } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
    await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await page.getByRole("button", { name: "ขาย", exact: true }).click();
    const productInfo = page.getByRole("button", { name: "รายละเอียดสินค้า", exact: true }).last();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await productInfo.evaluate((el) => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { width: rect.width, height: rect.height, padding: css.padding };
      });
      assert.deepEqual(geometry, { width: 44, height: 44, padding: "0px" }, `${mode}/${width}: square product detail touch target`);
      const visual = await productInfo.locator(":scope > span").boundingBox();
      assert.equal(visual.width, 20);
      assert.equal(visual.height, 20);
      for (const hovered of [false, true]) {
        if (hovered) await productInfo.hover();
        const paint = await productInfo.evaluate((el) => [el, el.firstElementChild].map((node) => {
          const css = getComputedStyle(node);
          return { background: css.backgroundColor, border: css.borderWidth, shadow: css.boxShadow };
        }));
        assert.deepEqual(paint, Array(2).fill({ background: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" }),
          `${mode}/${width}/${hovered}: information icon has no button frame`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${output}/${mode}-catalog.png` });
    await page.getByRole("button", { name: "รายละเอียดสินค้า", exact: true }).last().click();
    const details = page.getByRole("dialog");
    await details.getByText("8850000000011", { exact: true }).waitFor();
    assert.equal(await details.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0), true);
    await assertLight(details.locator(".ant-modal-content"), `${mode}: product details`);
    await page.waitForFunction(() => {
      const modal = document.querySelector('.ant-modal');
      return modal && !/ant-zoom-(appear|enter|leave)/.test(modal.className);
    });
    await page.screenshot({ path: `${output}/${mode}-product-details.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const detailsBounds = await details.boundingBox();
    assert.ok(detailsBounds.x >= 0 && detailsBounds.x + detailsBounds.width <= 391);
    await page.screenshot({ path: `${output}/${mode}-product-details-mobile.png` });
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByText("ยังไม่มีสินค้าในบิล", { exact: true }).waitFor();
    const scan = page.getByPlaceholder("ยิงบาร์โค้ด หรือพิมพ์รหัสสินค้า แล้วกด Enter", { exact: true });
    await scan.click();
    await page.keyboard.type("FAKE-TYPED");
    assert.equal(await scan.inputValue(), "FAKE-TYPED", "physical keyboard input reaches the scanner field");
    await page.getByPlaceholder("ค้นหาชื่อหรือ SKU", { exact: true }).click();
    assert.equal(await scan.evaluate((el) => getComputedStyle(el.closest('form')).boxShadow), "none", "unfocused scanner has no misleading focus halo");
    await page.keyboard.press("F12");
    assert.equal(await scan.evaluate((el) => el === document.activeElement), true, "F12 returns focus to the visible scan field");
    const scanForm = scan.locator("xpath=ancestor::form");
    assert.equal(await scanForm.getByRole("button").count(), 0, "scan bar has no duplicate info or Add buttons");
    await productInfo.click();
    await details.waitFor();
    await page.keyboard.press("F12");
    assert.equal(await scan.evaluate((el) => el === document.activeElement), false, "F12 never steals modal focus");
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await scan.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("FAKE-SLOW");
    let releaseScan;
    heldScan = new Promise((resolve) => { releaseScan = resolve; });
    const slowRequest = page.waitForRequest((request) => request.postData()?.includes('"code":"FAKE-SLOW"'));
    await page.keyboard.press("Enter");
    await slowRequest;
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("FAKE-NEXT");
    releaseScan();
    heldScan = null;
    const waitScanIdle = () => page.waitForFunction(() => {
      return document.querySelector('button[data-adding="false"]');
    });
    await waitScanIdle();
    assert.equal(await scan.inputValue(), "FAKE-NEXT", "a delayed lookup never erases subsequent typing");
    assert.equal(scanRequests.filter((code) => code === "FAKE-SLOW").length, 1, "duplicate Enter while pending never duplicates a lookup");
    await page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
    await waitScanIdle();
    assert.equal(await scan.inputValue(), "FAKE-NEXT", "catalogue card clicks preserve scan drafts");
    await scan.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("FAKE-MISSING");
    await page.keyboard.press("Enter");
    await page.getByRole("alert").filter({ hasText: "ไม่พบสินค้านี้" }).waitFor();
    assert.equal(await scan.inputValue(), "FAKE-MISSING", "failed lookup retains editable input");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("FAKE-RECOVERED");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('input[aria-label="สแกนบาร์โค้ดหรือรหัสสินค้า"]')?.value === "");
    assert.equal(await scan.evaluate((el) => el === document.activeElement), true, "Enter keeps focus ready for the next scan");
    await page.getByRole("button", { name: "บอร์ดเกม", exact: true }).click();
    await page.getByRole("button", { name: /FAKE Table/ }).click();
    await page.getByRole("tab", { name: /เกมและบัตร/ }).click();
    const returnScan = page.getByRole("combobox", { name: "ค้นหาหรือสแกนรหัสกล่องที่ต้องการคืน" });
    await returnScan.fill("FAKE-AZ-02");
    await returnScan.press("Enter");
    await returnScan.press("Enter");
    assert.equal(await page.getByRole("button", { name: "รับคืน", exact: true }).count(), 1);
    assert.deepEqual(unexpected, [], "scanning and duplicate Enter never return a copy automatically");
    await returnScan.press("Escape");
    await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
    const game = page.getByRole("combobox", { name: "ค้นหาชื่อเกม / รหัสกล่อง / สแกนบาร์โค้ด" });
    const loanForm = page.locator(".pos-bg-loan-form");
    assert.equal(await loanForm.getByLabel("โน้ตตอนคืน").count(), 0, "return notes never take space in the loan form");
    await page.getByLabel("โน้ตตอนคืน").fill("FAKE return note");
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await centerInput(game);
      const geometry = await loanForm.evaluate((el) => {
        const picker = el.querySelector('.ant-select').getBoundingClientRect();
        const input = el.querySelector('input').getBoundingClientRect();
        const button = el.querySelector('button').getBoundingClientRect();
        return { pickerHeight: picker.height, inputHeight: input.height, buttonHeight: button.height,
          fits: picker.x >= 0 && button.right <= innerWidth && picker.right <= button.x };
      });
      assert.equal(geometry.pickerHeight, 44, JSON.stringify(geometry));
      assert.ok(geometry.inputHeight <= 44 && geometry.buttonHeight >= 44 && geometry.fits, JSON.stringify(geometry));
      await page.screenshot({ path: `${output}/${mode}-loan-form-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await game.fill("FAKE");
    const popup = page.locator(".ant-select-dropdown:visible");
    await popup.waitFor();
    await popup.locator(".ant-select-item-option-disabled").waitFor();
    await assertLight(popup, `${mode}: game dropdown`);
    await assertLight(game.locator("xpath=ancestor::*[contains(@class,'ant-select-selector')]"), `${mode}: game input`);
    await screenshot(page, `${mode}-games`);
    await game.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await centerInput(game);
    await game.fill("FAKE-AZ");
    await popup.waitFor();
    await assertLight(popup, `${mode}: mobile game dropdown`);
    await screenshot(page, `${mode}-games-mobile`);
    const gameBounds = await popup.boundingBox();
    assert.ok(gameBounds && gameBounds.x >= 0 && gameBounds.x + gameBounds.width <= 391 && gameBounds.y >= 0 && gameBounds.y + gameBounds.height <= 845, JSON.stringify(gameBounds));
    await game.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await game.fill("FAKE-AZ-01");
    await game.press("Enter");
    await game.press("Enter");
    assert.equal(await page.getByRole("button", { name: "ให้ยืม", exact: true }).isEnabled(), true);
    assert.deepEqual(copyCommands, [], "scanning alone never checks out a copy");
    await game.press("Escape");
    expectedCopyAction = "copy.return";
    await page.getByRole("button", { name: "รับคืน", exact: true }).click();
    await page.getByLabel("โน้ตตอนคืน").waitFor({ state: "hidden" });
    assert.equal(copyCommands[0].loanId, "FAKE-loan");
    assert.equal(copyCommands[0].returnNote, "FAKE return note");
    assert.equal(copyCommands[0].status, "RETURNED");
    await centerInput(game);
    await game.press("Escape");
    await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
    await page.screenshot({ path: `${output}/${mode}-loan-empty.png` });
    expectedCopyAction = "copy.checkout";
    await page.getByRole("button", { name: "ให้ยืม", exact: true }).click();
    await page.getByLabel("โน้ตตอนคืน").waitFor();
    assert.equal(copyCommands[1].sessionId, session.id);
    assert.equal(copyCommands[1].copyId, "FAKE-copy");
    assert.equal(copyCommands[1].returnNote, undefined);
    assert.equal(await page.getByLabel("โน้ตตอนคืน").inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "ให้ยืม", exact: true }).isDisabled(), true);
    await page.getByLabel("โน้ตตอนคืน").fill("FAKE damaged box");
    expectedCopyAction = "copy.return";
    await page.getByRole("button", { name: "คืนแบบมีปัญหา", exact: true }).click();
    await page.getByLabel("โน้ตตอนคืน").waitFor({ state: "hidden" });
    assert.equal(copyCommands[2].loanId, "FAKE-new-loan");
    assert.equal(copyCommands[2].returnNote, "FAKE damaged box");
    assert.equal(copyCommands[2].copyStatus, "NEEDS_CHECK");
    assert.equal(copyCommands.length, 3);
    await page.getByRole("button", { name: /ไปเก็บเงินกลุ่ม 2/ }).click();
    const search = page.getByRole("combobox", { name: "ค้นหาสมาชิก" });
    await search.fill("FAKE");
    await popup.getByText("FAKE Member", { exact: false }).first().waitFor();
    await assertLight(popup, `${mode}: member dropdown`);
    await assertLight(search.locator("xpath=ancestor::*[contains(@class,'ant-select-selector')]"), `${mode}: member input`);
    for (const input of [search]) {
      const geometry = await input.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        containerHeight: el.closest(".ant-select-selector").getBoundingClientRect().height,
        shadow: getComputedStyle(el).boxShadow,
      }));
      assert.ok(geometry.height <= geometry.containerHeight, JSON.stringify(geometry));
      assert.equal(geometry.shadow, "none", "Select must not get a second native-input focus ring");
    }
    await screenshot(page, `${mode}-member`);
    await popup.getByText("FAKE Member", { exact: false }).first().click();
    await page.getByText("แต้มคงเหลือ", { exact: false }).waitFor();
    for (const [block, text] of [
      ["BELOW_MIN_SPEND", "ยอดบิลยังไม่ถึงขั้นต่ำสำหรับสะสมแต้ม"],
      ["RATE_TOO_LOW", "ยอดบิลนี้คำนวณตามอัตราของร้านแล้วได้ไม่ถึง 1 แต้ม"],
      ["NO_VISIT_POINTS", "ร้านตั้งแต้มต่อการซื้อไว้ 0 แต้ม"],
      ["PROGRAM_DISABLED", "ร้านยังไม่เปิดใช้แต้มสะสม"],
    ]) {
      await page.getByRole("textbox", { name: "รหัสคูปอง", exact: true }).fill(block);
      await page.getByText(text, { exact: true }).waitFor();
    }
    await page.screenshot({ path: `${output}/${mode}-zero-points.png` });
    const memberSelect = page.locator(".ant-select").filter({ has: search });
    await memberSelect.hover();
    await memberSelect.locator(".ant-select-clear").click();
    await search.fill("zzz");
    await popup.getByText("ไม่พบสมาชิก", { exact: true }).waitFor();
    await assertLight(popup, `${mode}: empty member dropdown`);
    await search.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await centerInput(search);
    await search.fill("FAKE");
    await popup.getByText("FAKE Member", { exact: false }).first().waitFor();
    await assertLight(popup, `${mode}: mobile member dropdown`);
    const bounds = await popup.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, JSON.stringify(bounds));
    await screenshot(page, `${mode}-member-mobile`);
    assert.equal(await page.locator("html").getAttribute("data-theme"), mode === "light" ? "light" : "dark", "POS must not change the global theme");
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    await context.close();
    console.log(`PASS ${mode}: square info buttons, responsive loan form, scan/borrow/return notes, member controls, portals, desktop/mobile, no global theme change`);
  }
} finally {
  await browser.close();
}
