import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE
  || new URL("../apps/web/node_modules/playwright/index.mjs", import.meta.url).href);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3194";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local fixture server only");
const output = ".test-output/restaurant-kiosk-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const token = "A".repeat(43);
const id = (n) => `abcdef12-0000-4000-8000-${String(n).padStart(12, "0")}`;
const items = [
  { sku: "FAKE-FOOD", name: "ข้าวผัด", category: "อาหารจานเดียว", price: 70,
    imageUrl: "/sample/restaurant/friedrice-pork.jpg", sellable: true, availability: "AVAILABLE",
    availableSizes: [{ size: "S", available: false }, { size: "L", available: true }] },
  { sku: "FAKE-DRINK", name: "ชาเย็น", category: "เครื่องดื่ม", price: 45,
    imageUrl: null, sellable: true, availability: "AVAILABLE",
    availableSizes: [{ size: "M", available: true }, { size: "L", available: true }] },
  { sku: "FAKE-SOLD", name: "แกงวันนี้", category: "อาหารจานเดียว", price: 80,
    imageUrl: null, sellable: false, availability: "SOLD_OUT_TODAY", availableSizes: [] },
  { sku: "FAKE-UNCATEGORIZED", name: "น้ำเปล่า", category: null, price: 15,
    imageUrl: "/broken-kiosk-image.jpg", sellable: true, availability: "AVAILABLE", availableSizes: [] },
];

try {
  for (const [width, height] of [[1440, 900], [1920, 1080], [1080, 1920], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, serviceWorkers: "block" });
    let posted = 0;
    let submittedKey = "";
    let state = "PENDING";
    let pollFails = false;
    let closed = false;
    let menuFails = false;
    let loseSubmitResponse = false;
    let delaySubmitResponse = false;
    const errors = [];
    await context.route("**/api/bms/restaurant-kiosk/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (closed) return route.fulfill({ status: 410, json: { error: "จอสั่งอาหารนี้ไม่พร้อมใช้งาน" } });
      if (request.method() === "GET" && url.searchParams.has("submissionId")) {
        return route.fulfill(pollFails ? { status: 503, json: { error: "temporary outage" } }
          : { json: { status: state, serviceMode: "TAKEAWAY", rejectionReason: state === "REJECTED" ? "หมดวันนี้" : null } });
      }
      if (request.method() === "GET") return route.fulfill(menuFails
        ? { status: 503, json: { error: "temporary outage" } }
        : { json: { storeName: "Fixture restaurant", locationName: "Fixture branch", items } });
      const body = request.postDataJSON();
      if (body.action === "detail") {
        const drink = body.sku === "FAKE-DRINK";
        assert.equal(body.size, drink ? "M" : body.sku === "FAKE-FOOD" ? "L" : null);
        return route.fulfill({ json: {
          sku: body.sku, productName: drink ? "ชาเย็น" : body.sku === "FAKE-FOOD" ? "ข้าวผัด" : "น้ำเปล่า",
          size: body.size, packCode: "BASE", unitName: drink ? "แก้ว" : "จาน", packPrice: drink ? 45 : 70,
          modifiers: drink ? [
            { code: "SWEET", name: "หวานปกติ", priceDelta: 0, groupCode: "SUGAR",
              groupName: "ความหวาน", selectionType: "SINGLE", minSelect: 1, maxSelect: 1, defaultSelected: false },
          ] : [],
        } });
      }
      if (body.action === "submit") {
        posted += 1;
        assert.equal(body.serviceMode, "TAKEAWAY");
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].packQty, 1);
        if (submittedKey) assert.equal(body.idempotencyKey, submittedKey);
        else submittedKey = body.idempotencyKey;
        if (loseSubmitResponse) { loseSubmitResponse = false; return route.abort("failed"); }
        if (delaySubmitResponse) await new Promise((resolve) => setTimeout(resolve, 350));
        return route.fulfill({ status: posted === 1 ? 201 : 200,
          json: { submissionId: id(1), status: "PENDING", replayed: posted > 1 } });
      }
      return route.fulfill({ status: 400, json: { error: "Unexpected fixture request" } });
    });
    const page = await context.newPage();
    await page.clock.install();
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const response = await page.goto(`${base}/kiosk/${token}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
      await page.locator('img[src="/sample/restaurant/friedrice-pork.jpg"]').first().evaluate((image) => image.decode());
      await page.screenshot({ path: `${output}/home-${width}.png`, fullPage: false });
      await page.getByRole("button", { name: /รับกลับ/ }).click();
      await page.getByRole("heading", { name: "เลือกเมนูที่ชอบ" }).first().waitFor();
      await page.getByRole("button", { name: "เครื่องดื่ม", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: /ข้าวผัด/ }).count(), 0);
      await page.getByRole("button", { name: /ชาเย็น/ }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "ปิดรายละเอียดเมนู" }).evaluate(
        (el) => document.activeElement === el), true);
      await dialog.getByRole("button", { name: "หวานปกติ" }).count().catch(() => 0);
      await dialog.getByLabel("หวานปกติ").check();
      assert.equal(await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).isEnabled(), true);
      await page.screenshot({ path: `${output}/modal-${width}.png`, fullPage: false });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "ทั้งหมด" }).click();
      const sold = page.getByRole("button", { name: /แกงวันนี้/ });
      assert.equal(await sold.isDisabled(), true);
      await page.getByText("หมดวันนี้").waitFor();
      const food = page.getByRole("button", { name: /ข้าวผัด/ });
      await page.getByRole("button", { name: /น้ำเปล่า/ }).getByText("🍽️").waitFor(); // broken image fallback
      await food.click();
      assert.equal(await dialog.getByRole("button", { name: /S · หมด/ }).isDisabled(), true);
      await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
      await page.getByText("ตะกร้า 1 รายการ").waitFor();
      await page.screenshot({ path: `${output}/menu-${width}.png`, fullPage: false });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const lastCard = page.getByRole("button", { name: /น้ำเปล่า/ });
      const lastBox = await lastCard.boundingBox();
      const dockBox = await page.getByRole("button", { name: /ตรวจรายการ/ }).boundingBox();
      assert.ok(lastBox && dockBox && lastBox.y + lastBox.height <= dockBox.y + 2, "sticky cart covers last card");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.getByRole("button", { name: /ตรวจรายการ/ }).click();
      await page.getByText("ยอดนี้เป็นประมาณการก่อน VAT", { exact: false }).waitFor();
      await page.screenshot({ path: `${output}/cart-${width}.png`, fullPage: false });
      if (width === 1440) loseSubmitResponse = true;
      await page.getByRole("button", { name: "ส่งให้พนักงานตรวจ" }).click();
      if (width === 1440) {
        await page.getByRole("button", { name: "ส่งคำขอเดิมอีกครั้ง" }).waitFor();
        await page.getByRole("button", { name: "ส่งคำขอเดิมอีกครั้ง" }).click();
        assert.equal(posted, 2);
      }
      await page.getByText(id(1)).waitFor();
      await page.screenshot({ path: `${output}/pending-${width}.png`, fullPage: false });
      pollFails = true;
      await page.clock.fastForward(5_000);
      await page.getByText("ติดตามสถานะไม่ได้").waitFor();
      await page.screenshot({ path: `${output}/network-${width}.png`, fullPage: false });
      pollFails = false; state = "ACCEPTED";
      await page.clock.fastForward(5_000);
      await page.getByRole("heading", { name: "ร้านรับรายการแล้ว" }).waitFor();
      await page.screenshot({ path: `${output}/accepted-${width}.png`, fullPage: false });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
      assert.equal(await page.getByText(id(1)).count(), 0);
      await page.getByRole("button", { name: "EN" }).click();
      await page.getByRole("heading", { name: /Your meal/ }).waitFor();
      await page.getByRole("button", { name: "ไทย" }).click();
      if (width === 1440) for (const nextState of ["REJECTED", "EXPIRED"]) {
        posted = 0; submittedKey = ""; state = nextState;
        await page.getByRole("button", { name: /รับกลับ/ }).click();
        await page.getByRole("button", { name: /ข้าวผัด/ }).click();
        await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
        await page.getByRole("button", { name: /ตรวจรายการ/ }).click();
        await page.getByRole("button", { name: "ส่งให้พนักงานตรวจ" }).click();
        await page.getByText(id(1)).waitFor();
        await page.clock.fastForward(5_000);
        await page.getByRole("heading", { name: nextState === "REJECTED" ? "ร้านไม่สามารถรับรายการ" : "คำขอหมดอายุ" }).waitFor();
        await page.screenshot({ path: `${output}/${nextState.toLowerCase()}-${width}.png`, fullPage: false });
        await page.getByRole("button", { name: /เสร็จสิ้น/ }).click();
      }
      if (width === 1440) {
        posted = 0; submittedKey = ""; state = "PENDING"; delaySubmitResponse = true;
        await page.getByRole("button", { name: /รับกลับ/ }).click();
        await page.getByRole("button", { name: /ข้าวผัด/ }).click();
        await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
        await page.getByRole("button", { name: /ตรวจรายการ/ }).click();
        await page.getByRole("button", { name: "ส่งให้พนักงานตรวจ" }).click();
        await page.clock.fastForward(120_000);
        await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.equal(await page.getByText(id(1)).count(), 0, "late response exposed the prior guest's code");
        delaySubmitResponse = false;
      }
      await page.getByRole("button", { name: /รับกลับ/ }).click();
      await page.getByRole("button", { name: /ข้าวผัด/ }).click();
      await dialog.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
      await page.clock.fastForward(120_000);
      await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
      assert.equal(await page.getByText("ตะกร้า 1 รายการ").count(), 0);
      await page.getByRole("button", { name: /รับกลับ/ }).click();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
      await page.getByRole("button", { name: /รับกลับ/ }).click();
      await page.evaluate(() => history.pushState({}, "", `${location.pathname}?return=1`));
      await page.goBack();
      await page.getByRole("heading", { name: /มื้ออร่อย/ }).waitFor();
      closed = true;
      await page.clock.fastForward(60_000);
      await page.getByRole("heading", { name: "จอนี้ปิดใช้งานแล้ว" }).waitFor();
      await page.screenshot({ path: `${output}/unavailable-${width}.png`, fullPage: false });
      if (width === 1440) {
        closed = false; menuFails = true;
        await page.reload({ waitUntil: "networkidle" });
        await page.getByText("เชื่อมต่อเมนูไม่ได้").waitFor();
        await page.screenshot({ path: `${output}/menu-network-${width}.png`, fullPage: false });
        menuFails = false;
        await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
        await page.getByRole("button", { name: /รับกลับ/ }).click();
        await page.getByRole("heading", { name: "เลือกเมนูที่ชอบ" }).first().waitFor();
      }
      assert.deepEqual(errors, []);
      console.log(`PASS kiosk ${width}x${height}: category, price/size, required option, image fallback, cart, lost response, status, privacy, touch layout`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
