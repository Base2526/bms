import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Browser-only fixtures: every API request is intercepted, including sale and queue mutations.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const baseUrl = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
const output = "apps/desktop/dist-smoke/desktop-pickup-queue";
await mkdir(output, { recursive: true });

const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true };
const createdAt = new Date().toISOString();
const product = {
  sku: "FAKE-product", name: "FAKE Product", price: 100, availability: "AVAILABLE",
  availableTotal: 10, imageUrl: null, availableSizes: [{ size: "M", price: 100, available: 10 }],
};
const preparing = {
  id: "FAKE-queue", orderId: "FAKE-order", label: "001", status: "PREPARING",
  readySource: null, createdAt, readyAt: null, calledAt: null, closedAt: null,
};

async function scenario({ name, branchEnabled = false, deviceEnabled = false, queue = [], saleQueueError = null,
  queueGetFails = false, queueActionFails = false, delayFirstReceiptMs = 0 }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "lang", value: "th", url: baseUrl }]);
  await context.addInitScript((enabled) => {
    window.bmsDesktop = {
      isDesktop: true,
      getDeviceToken: async () => "FAKE-token",
      getStorageNamespace: async () => "FAKE-queue-smoke",
      getAppInfo: async () => ({ version: "FAKE", platform: "darwin", arch: "arm64" }),
    };
    if (enabled) localStorage.setItem("bms.pos.pickupQueue.FAKE-queue-smoke", "1");
  }, deviceEnabled);

  const rows = structuredClone(queue);
  const actions = [];
  const sales = [];
  const unexpected = [];
  let rejectQueueGet = queueGetFails;
  let queueIssued = false;
  let receiptReads = 0;
  const bootstrap = {
    device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
    location: { id: "FAKE-location", name: "FAKE shop", branchCode: "MAIN",
      pickupQueue: { enabled: branchEnabled, autoHideMinutes: 30, showPreparing: true, boardMessage: null } },
    shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: createdAt },
    cashiers: [cashier], approvers: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
    surface: "retail", businessArchetype: "beauty_personal_care",
    vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" },
  };
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    if (url.pathname === "/api/graphql") {
      const query = body?.query || "";
      let data = {};
      if (query.includes("query PosBootstrap")) data = { bmsPosSession: bootstrap };
      else if (query.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
      else if (query.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [product] } };
      else if (query.includes("query MobilePosScan")) data = { bmsPosScan: {
        sku: product.sku, productName: product.name, size: "M", unitName: "ชิ้น", barcode: "8850000000011",
        packPrice: 100, baseQty: 1, packCode: "BASE", basePrice: 100, available: 10,
        stockTracked: true, serialTracked: false, imageUrl: null, priceTiers: [], promotion: null,
        modifiers: [], packs: [],
      } };
      else if (query.includes("mutation MobilePosSale")) {
        sales.push(body.variables.input);
        const shouldIssue = branchEnabled || body.variables.input.pickupQueue;
        queueIssued = Boolean(shouldIssue && !saleQueueError);
        data = { bmsPosSale: {
          status: "SOLD", reason: null, orderId: "FAKE-order", receiptNo: "FAKE-receipt", billNo: "FAKE-bill",
          subtotal: 100, discount: 0, total: 100, cashTendered: 100, cashChange: 0,
          pointsEarned: null, pointsBalance: null,
          pickupQueue: shouldIssue && !saleQueueError ? { id: "FAKE-issued", queueNo: 2, label: "002" } : null,
          pickupQueueError: shouldIssue ? saleQueueError : null,
        } };
      } else if (query.includes("query DesktopPosLastSale")) {
        receiptReads += 1;
        const savedPickupLabel = queueIssued ? "002" : null;
        data = { bmsPosLastSale: {
          orderId: "FAKE-order", receiptNo: "FAKE-receipt", billNo: "FAKE-bill", docNo: null,
          taxRequestUrl: null, taxRequestUnavailableReason: null, soldAt: createdAt, total: 100,
          cashierName: cashier.name, branchCode: "MAIN", locationName: "FAKE shop", posLabel: "POS-01",
          pickupQueueLabel: savedPickupLabel, posDeviceId: "FAKE-device", shiftId: "FAKE-shift",
          saleLocationId: "FAKE-location", roundingAmount: 0, paymentMethod: "CASH", paymentRef: null,
          cashTendered: 100, cashChange: 0, memberName: null, memberNo: null,
          lines: [{ receiptName: product.name, size: "M", packQty: 1, packPrice: 100 }],
          payments: [{ method: "CASH", amount: 100, ref: null, cashTendered: 100, cashChange: 0 }],
          discountLines: [], vat: null,
        } };
        if (receiptReads === 1 && delayFirstReceiptMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayFirstReceiptMs));
        }
      } else if (query.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: {
        status: "READY", netTotal: 100, amountDue: 100, totalDiscount: 0, tierDiscount: 0,
        couponDiscount: 0, pointsDiscount: 0, pointsUsed: 0, loyaltyEnabled: false,
        pointsWillEarn: null, pointsEarnBlock: null, member: null,
      } };
      else if (query.includes("mutation")) unexpected.push(query);
      return route.fulfill({ json: { data } });
    }
    if (url.pathname === "/api/pos/pickup-queue") {
      if (route.request().method() === "GET") {
        if (rejectQueueGet) return route.fulfill({ status: 503, json: { error: "FAKE feed unavailable" } });
        return route.fulfill({ json: { entries: rows, settings: {}, serverTime: createdAt } });
      }
      actions.push(body);
      if (queueActionFails) return route.fulfill({ status: 403, json: { error: "FAKE action denied" } });
      if (body.action === "issue") {
        queueIssued = true;
        return route.fulfill({ json: { entry: {
          ...preparing, id: "FAKE-issued", orderId: body.orderId, label: "002", queueNo: 2,
        } } });
      }
      const row = rows.find((entry) => entry.id === body.entryId);
      if (!row) return route.fulfill({ status: 404, json: { error: "not found" } });
      if (body.action === "call") {
        row.status = "READY";
        row.readySource = "STAFF";
        row.readyAt = createdAt;
        row.calledAt = createdAt;
      } else if (body.action === "collect") {
        row.status = "COLLECTED";
        row.closedAt = createdAt;
      }
      return route.fulfill({ json: { entry: row } });
    }
    if (url.pathname === "/api/pos/session") return route.fulfill({ json: {
      ...bootstrap, shiftReturnSummary: { returnCount: 0, returnTotal: 0, settledTotal: 0, pendingTotal: 0, pendingCount: 0 },
      purchaseReceivers: [],
    } });
    if (url.pathname === "/api/retail-local/desktop-update") return route.fulfill({ json: { status: "unavailable", releases: [] } });
    return route.fulfill({ json: {} });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
    await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await page.getByRole("button", { name: "ขาย", exact: true }).click();
    await page.getByText("เลือกสินค้า", { exact: true }).waitFor();
    const strip = page.locator("[data-pickup-queue-strip]");
    if (branchEnabled || deviceEnabled) {
      await strip.waitFor();
      assert.equal(await strip.getByRole("button", { name: "จัดการคิว" }).count(), 1);
      for (const width of [1440, 1280, 1024, 980, 600, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const rect = await strip.boundingBox();
        assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1, `${name}/${width}: queue strip fits viewport`);
        if (width <= 980) {
          const catalog = await page.locator('section[class*="catalogPane"]').boundingBox();
          const checkout = await page.locator('aside[class*="checkoutPane"]').boundingBox();
          assert.ok(catalog && checkout && catalog.y + catalog.height <= checkout.y + 1,
            `${name}/${width}: catalog and bill must not overlap`);
          if (width === 390) await page.screenshot({ path: `${output}/${name}-sell-mobile.png` });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `${output}/${name}-sell.png` });
      await strip.getByRole("button", { name: "จัดการคิว" }).click();
      const manager = page.getByRole("dialog", { name: "จัดการคิวรับของ" });
      await manager.waitFor();
      assert.equal(await manager.getByRole("button", { name: "เรียกคิว", exact: true }).count() >= 1, true);
      if (rows.length && !queueGetFails && !queueActionFails) {
        await manager.locator('[data-pickup-row="001"]').getByRole("button", { name: "เรียกคิว" }).click();
        await page.waitForFunction(() => document.querySelector('[data-pickup-row="001"]')?.textContent?.includes("พร้อมรับ"));
        assert.deepEqual(actions[0], {
          action: "call", entryId: "FAKE-queue", cashierUserId: cashier.id, cashierPin: "1234",
        });
        await manager.locator('[data-pickup-row="001"]').getByRole("button", { name: "รับแล้ว" }).click();
        assert.equal(actions[1]?.action, "collect");
      }
      await manager.getByRole("button", { name: "ปิด", exact: true }).click();
    } else {
      assert.equal(await strip.count(), 0, `${name}: queue strip hidden when device and branch are off`);
    }
    assert.deepEqual(pageErrors, [], `${name}: no page errors`);
    assert.deepEqual(unexpected, [], `${name}: no unexpected mutations`);
    return { page, context, sales, actions, strip, pageErrors, receiptReads: () => receiptReads,
      restoreQueueGet: () => { rejectQueueGet = false; } };
  } catch (error) {
    await context.close();
    throw error;
  }
}

try {
  const off = await scenario({ name: "off" });
  await off.page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
  await off.page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
  await off.page.getByRole("button", { name: /ยืนยันรับชำระ/ }).click();
  await off.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).waitFor();
  assert.equal(off.sales.length, 1);
  assert.equal(off.sales[0].pickupQueue, false, "queue stays off without device or branch opt-in");
  assert.equal(await off.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).getByText("เลขคิวรับของ").count(), 0);
  await off.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).getByRole("button", { name: "ขายรายการใหม่" }).click();
  await off.page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
  await off.page.locator('[data-pickup-queue-settings] [role="switch"]').click();
  await off.page.getByRole("button", { name: "ขาย", exact: true }).click();
  await off.strip.waitFor();
  await off.page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
  await off.page.locator('[data-pickup-queue-settings] [role="switch"]').click();
  await off.page.getByRole("button", { name: "ขาย", exact: true }).click();
  await off.strip.waitFor({ state: "detached" });
  await off.context.close();

  const device = await scenario({ name: "device-on", deviceEnabled: true, queue: [preparing] });
  await device.page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
  await device.page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
  await device.page.getByRole("button", { name: /ยืนยันรับชำระ/ }).click();
  await device.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).waitFor();
  assert.equal(device.sales.length, 1);
  assert.equal(device.sales[0].pickupQueue, true, "device opt-in requests a number on the sale");
  await device.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).locator("#pos-receipt").getByText("002", { exact: true }).waitFor();
  await device.context.close();

  const branch = await scenario({ name: "branch-on", branchEnabled: true });
  await branch.page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
  assert.equal(await branch.page.locator('[data-pickup-queue-settings] [role="switch"]').count(), 0,
    "branch-wide setting cannot be turned off at this till");
  await branch.page.locator("[data-pickup-queue-settings]").getByText("เปิดทั้งสาขา").waitFor();
  await branch.page.getByRole("button", { name: "ขาย", exact: true }).click();
  await branch.page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
  await branch.page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
  await branch.page.getByRole("button", { name: /ยืนยันรับชำระ/ }).click();
  await branch.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).waitFor();
  assert.equal(branch.sales[0].pickupQueue, true, "branch policy requests a number on sale");
  await branch.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" }).locator("#pos-receipt").getByText("002", { exact: true }).waitFor();
  await branch.context.close();

  const failure = await scenario({ name: "issue-error", deviceEnabled: true, saleQueueError: "FAKE queue unavailable" });
  await failure.page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
  await failure.page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
  await failure.page.getByRole("button", { name: /ยืนยันรับชำระ/ }).click();
  const receipt = failure.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" });
  await receipt.waitFor();
  await receipt.getByText(/ขายสำเร็จแล้ว แต่ออกเลขคิวไม่ได้/).waitFor();
  await receipt.locator("#pos-receipt").getByText("FAKE Product").waitFor();
  assert.equal(await receipt.locator("#pos-receipt").getByText("คิวของคุณ").count(), 0,
    "initial saved receipt has no queue number");
  await receipt.locator("[data-pickup-queue-retry]").click();
  await receipt.getByText("เลขคิวรับของ").waitFor();
  await receipt.locator("#pos-receipt").getByText("คิวของคุณ").waitFor();
  await receipt.locator("#pos-receipt").getByText("002", { exact: true }).waitFor();
  assert.equal(failure.receiptReads(), 2, "retry reloads the saved receipt after number issuance");
  assert.equal(failure.sales.length, 1, "retry does not charge again");
  assert.deepEqual(failure.actions.at(-1), {
    action: "issue", orderId: "FAKE-order", cashierUserId: cashier.id, cashierPin: "1234",
  });
  await failure.context.close();

  const lateReceipt = await scenario({ name: "late-receipt", deviceEnabled: true,
    saleQueueError: "FAKE queue unavailable", delayFirstReceiptMs: 500 });
  await lateReceipt.page.getByRole("button", { name: /FAKE Product.*FAKE-product/ }).click();
  await lateReceipt.page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
  await lateReceipt.page.getByRole("button", { name: /ยืนยันรับชำระ/ }).click();
  const lateDialog = lateReceipt.page.getByRole("dialog", { name: "ชำระเงินสำเร็จ" });
  await lateDialog.locator("[data-pickup-queue-retry]").click();
  await lateDialog.locator("#pos-receipt").getByText("คิวของคุณ").waitFor();
  await lateReceipt.page.waitForTimeout(650);
  assert.equal(await lateDialog.locator("#pos-receipt").getByText("002", { exact: true }).count(), 1,
    "late response for the old receipt must not erase the issued queue number");
  assert.equal(lateReceipt.receiptReads(), 2);
  await lateReceipt.context.close();

  const stale = await scenario({ name: "stale-feed", deviceEnabled: true, queue: [preparing], queueGetFails: true });
  await stale.strip.getByText("ข้อมูลคิวไม่อัปเดต").waitFor();
  assert.equal(await stale.strip.getByRole("button", { name: "เรียกคิว", exact: true }).count(), 0,
    "stale feed must not offer a call against unknown state");
  stale.restoreQueueGet();
  await stale.strip.getByRole("button", { name: "ลองโหลดคิวใหม่" }).click();
  await stale.strip.getByRole("button", { name: "เรียกคิว", exact: true }).waitFor();
  await stale.context.close();

  const denied = await scenario({ name: "action-denied", deviceEnabled: true, queue: [preparing], queueActionFails: true });
  await denied.strip.getByRole("button", { name: "เรียกคิว", exact: true }).click();
  await denied.strip.getByText("FAKE action denied").waitFor();
  assert.equal(denied.actions.length, 1);
  assert.equal(await denied.strip.locator('[data-pickup-queue-current][data-state="preparing"]').count(), 1,
    "denied call must leave number preparing");
  await denied.context.close();
  console.log("desktop pickup queue browser smoke: off, device switch, branch policy, call/collect, sale, issue retry, stale feed and action denial passed");
} finally {
  await browser.close();
}
