import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Exercise the server POS page used by the desktop shell with intercepted API fixtures.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3112";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/pos-purchase-status";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const poId = "00000000-0000-4000-8000-000000000001";
const cashier = { id: "00000000-0000-4000-8000-000000000002", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const order = { id: poId, status: "OPEN", note: null, supplier: { id: "FAKE", name: "FAKE supplier" },
  qtyOrdered: 3, qtyReceived: 0, createdAt: new Date().toISOString(),
  items: [{ sku: "FAKE-BEAN", size: "BASE", qtyOrdered: 3, qtyReceived: 0, unitCost: 10 }] };
const session = {
  device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
  location: { id: "FAKE-location", name: "FAKE branch", branchCode: "MAIN" },
  shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 1000, openedAt: new Date().toISOString() },
  cashiers: [cashier], purchaseReceivers: [cashier], approvers: [], kitchenOperators: [],
  store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
  surface: "retail", businessArchetype: "retail",
  vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" },
};

try {
  for (const width of [1440, 390]) {
    order.status = "OPEN";
    order.qtyReceived = 0;
    order.items[0].qtyReceived = 0;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addCookies([{ name: "lang", value: "th", url: base }, { name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }]);
    await context.addInitScript(() => { window.bmsDesktop = {
      isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-purchase-status",
      getAppInfo: async () => ({ version: "0.2.14-pilot.6", platform: "win32", arch: "x64" }),
    }; });
    const submissions = [], errors = [];
    let releaseUnknown, failRefresh = false;
    let markPending;
    const pendingStarted = new Promise(resolve => { markPending = resolve; });
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "";
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: session };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
        else if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: ["product.view", "purchase.receive"] };
        json = { data };
      } else if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", language: "th" } };
      else if (path === "/api/pos/session") json = session;
      else if (path === "/api/pos/purchase") {
        if (body?.action === "list") {
          if (failRefresh) { failRefresh = false; return route.fulfill({ status: 503, json: { error: 'FAKE read unavailable' } }); }
          json = { orders: [order] };
        }
        else if (body?.action === "detail") json = { order };
        else if (body?.action === "receive") {
          submissions.push(body);
          if (submissions.length === 1) return route.fulfill({ status: 400, json: {
            status: "INVALID_INPUT", reasonCode: "LOT_REQUIRED", sku: "FAKE-BEAN", size: "BASE",
          } });
          if (submissions.length === 3) {
            order.qtyReceived = 2; order.items[0].qtyReceived = 2;
            await new Promise(resolve => { releaseUnknown = resolve; markPending(); });
            return route.abort('failed');
          }
          if (submissions.length === 4) {
            return route.fulfill({ status: 403, json: { error: 'PIN ไม่ถูกต้อง' } });
          }
          if (submissions.length === 5) {
            failRefresh = true;
            return route.fulfill({ json: { status: 'PARTIAL', poId, replayed: true, items: order.items } });
          }
          order.status = "PARTIAL";
          order.qtyReceived = 1;
          order.items[0].qtyReceived = 1;
          json = { status: "PARTIAL", poId, items: [{ ...order.items[0], qtyReceived: 1 }] };
        }
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    try {
      await page.goto(`${base}/pos?tab=stock`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByRole("button", { name: "รับของ", exact: true }).click();
      await page.locator("select").filter({ has: page.locator(`option[value="${cashier.id}"]`) }).last().selectOption(cashier.id);
      await page.getByPlaceholder("PIN ผู้รับสินค้า").fill("1234");
      await page.getByRole("button", { name: "โหลด PO ค้างรับ" }).click();
      await page.getByLabel("ใบสั่งซื้อที่รับของ").selectOption(poId);
      await page.getByText("สถานะ รอรับของ").waitFor();
      assert.equal(await page.getByText('ยังขายไม่ได้ — เหลืออีก:').count(), 0);
      await page.getByRole("spinbutton", { name: "จำนวนรับ FAKE-BEAN BASE" }).fill("1");
      await page.getByRole("button", { name: "ยืนยันรับเข้า 1 หน่วย" }).click();
      await page.getByText("FAKE-BEAN/BASE: ต้องกรอกเลขล็อตก่อนรับสินค้า", { exact: false }).waitFor();
      assert.equal(submissions.length, 1);
      await page.getByLabel("เลขล็อตตามฉลาก (สินค้าที่ติดตามล็อตต้องกรอก)").fill("LOT-A");
      await page.getByRole("button", { name: "ยืนยันรับเข้า 1 หน่วย" }).click();
      await page.getByText("รับสินค้า 1 หน่วยแล้ว · ยังมีสินค้าค้างรับ", { exact: false }).waitFor();
      await page.getByText("สถานะ รับบางส่วน").waitFor();
      assert.equal(submissions.length, 2);
      assert.equal(submissions[1].items[0].lotNo, "LOT-A");
      await page.getByRole('spinbutton', { name: 'จำนวนรับ FAKE-BEAN BASE' }).fill('1');
      await page.getByRole('button', { name: 'ยืนยันรับเข้า 1 หน่วย' }).click();
      await page.getByRole('button', { name: 'กำลังบันทึก…' }).waitFor();
      assert.equal(await page.getByRole('spinbutton', { name: 'จำนวนรับ FAKE-BEAN BASE' }).isDisabled(), true);
      assert.equal(await page.getByLabel('ใบสั่งซื้อที่รับของ').isDisabled(), true);
      await pendingStarted;
      assert.ok(releaseUnknown); releaseUnknown();
      await page.getByRole('button', { name: 'ตรวจรายการเดิมอีกครั้ง' }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: 'ตรวจรายการเดิมอีกครั้ง' }).waitFor();
      await page.getByPlaceholder('PIN ผู้รับสินค้า').fill('1234');
      await page.getByRole('button', { name: 'ตรวจรายการเดิมอีกครั้ง' }).click();
      await page.getByText('PIN ไม่ถูกต้อง · ยังยืนยันผลรับสินค้าไม่ได้', { exact: false }).waitFor();
      assert.equal(await page.getByRole('spinbutton', { name: 'จำนวนรับ FAKE-BEAN BASE' }).isDisabled(), true);
      await page.getByRole('button', { name: 'ตรวจรายการเดิมอีกครั้ง' }).click();
      await page.getByText('รายการรับเดิมบันทึกไว้แล้ว ไม่เพิ่มสต็อกซ้ำ', { exact: false }).waitFor();
      await page.getByText('แต่โหลดข้อมูลล่าสุดไม่ได้', { exact: false }).waitFor();
      assert.deepEqual(submissions[3], submissions[2], 'reload retries the same payload and key');
      assert.deepEqual(submissions[4], submissions[2], 'PIN rejection cannot discard an unknown receipt key');
      assert.equal(await page.getByRole('spinbutton', { name: 'จำนวนรับ FAKE-BEAN BASE' }).isDisabled(), true);
      await page.getByRole('button', { name: 'โหลด PO ค้างรับ' }).click();
      await page.getByText('สั่ง 3 · รับแล้ว 2 · เหลือ 1').waitFor();
      await page.locator('.pos-note--ok').filter({ hasText: 'โหลดใบสั่งซื้อล่าสุดแล้ว' }).waitFor();
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      console.log(`PASS POS ${width}px: status, denial, frozen in-flight receipt, lost response/reload, same-key replay, refresh failure (mocked API)`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      console.error({ errors, text: (await page.locator("body").innerText()).slice(0, 5000) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
