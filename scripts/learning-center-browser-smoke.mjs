import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Read-only browser checks. Auth fixtures affect this browser only, never a shop account.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const baseURL = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
const output = await mkdtemp(join(tmpdir(), "bms-learning-smoke-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];
try {
  for (const lang of ["th", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: lang === "th" ? "light" : "dark" });
    await context.addCookies([{ name: "lang", value: lang, url: baseURL }, { name: "theme", value: lang === "th" ? "light" : "dark", url: baseURL }]);
    await context.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => failures.push(error.message));
    const requests = [];
    page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname); });
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      for (const path of ["/learn", "/learn/retail", "/learn/board-game", "/learn/restaurant", "/learn/pharmacy", "/learn/inventory", "/learn/guides/retail-pos-sale", "/learn/guides/board-game-move-split", "/learn/guides/desktop-hardware", "/learn/guides/restaurant-service", "/learn/guides/restaurant-rehearsal", "/learn/guides/pharmacy-counter-sale", "/learn/guides/pharmacy-rehearsal", "/learn/guides/inventory-transfer-control", "/learn/guides/inventory-rehearsal", "/learn/guides/board-game-deposits", "/learn/guides/board-game-rehearsal"]) {
        const response = await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, path);
        await page.locator("h1").waitFor();
        assert.equal(await page.locator("h1").count(), 1);
        if (width < 851) {
          assert.ok((await page.locator("header").boundingBox()).height <= 64, "Mobile header must stay on one row");
          assert.equal(await page.locator("header details").getAttribute("open"), null);
        }
        const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
        assert.ok(sizes.scroll <= sizes.width + 1, `${path} at ${width}: overflow ${sizes.scroll}`);
        if (width !== 320) await page.screenshot({ path: join(output, `${lang}-${width}-${path.replaceAll("/", "-")}.png`), fullPage: false });
      }
    }
    // Follow the actual contents page: every board-game article must render in both languages,
    // including all numbered steps, without clipping at the narrowest supported width.
    await page.goto(`${baseURL}/learn/board-game`);
    const articlePaths = await page.locator('main ol a[href^="/learn/guides/"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]);
    assert.ok(articlePaths.length >= 40, "Board-game path is missing reviewed lessons");
    for (const articlePath of articlePaths) {
      const response = await page.goto(`${baseURL}${articlePath}`);
      assert.equal(response.status(), 200, articlePath);
      assert.ok(await page.locator("article ol li").count() >= 4, `${articlePath}: missing steps`);
      assert.ok((await page.locator("article").innerText()).length > 600, `${articlePath}: missing content`);
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.scroll <= size.width + 1, `${articlePath}: mobile overflow`);
    }
    console.log(`Verified ${articlePaths.length} board-game articles in ${lang}`);
    await page.goto(`${baseURL}/learn/pharmacy`);
    const pharmacyPaths = await page.locator('main ol a[href^="/learn/guides/pharmacy-"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]);
    assert.ok(pharmacyPaths.length >= 8, "Pharmacy path is missing reviewed lessons");
    for (const articlePath of pharmacyPaths) {
      const response = await page.goto(`${baseURL}${articlePath}`);
      assert.equal(response.status(), 200, articlePath);
      assert.ok(await page.locator("article ol li").count() >= 4, `${articlePath}: missing steps`);
      assert.ok((await page.locator("article").innerText()).length > 600, `${articlePath}: missing content`);
    }
    console.log(`Verified ${pharmacyPaths.length} pharmacy articles in ${lang}`);
    await page.goto(`${baseURL}/learn/inventory`);
    const inventoryPaths = await page.locator('main ol a[href*="track=inventory"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]);
    assert.ok(inventoryPaths.length >= 14, "Inventory path is missing reviewed lessons");
    for (const articlePath of inventoryPaths) {
      const response = await page.goto(`${baseURL}${articlePath}`);
      assert.equal(response.status(), 200, articlePath);
      assert.ok(await page.locator("article ol li").count() >= 4, `${articlePath}: missing steps`);
      assert.ok((await page.locator("article").innerText()).length > 600, `${articlePath}: missing content`);
    }
    console.log(`Verified ${inventoryPaths.length} inventory articles in ${lang}`);
    assert.ok(requests.every((path) => path === "/api/auth/me"), `Unexpected public API calls: ${requests.join(",")}`);
    await page.goto(`${baseURL}/learn`);
    await page.getByRole("searchbox").fill("แยกกลุ่ม");
    await page.getByRole("button", { name: lang === "th" ? "ค้นหาคู่มือ" : "Search guides" }).click();
    await page.waitForURL(/q=/);
    assert.ok(await page.locator('main a[href*="board-game-move-split"]').count());
    await page.getByRole("link", { name: lang === "th" ? "ล้างตัวกรอง" : "Clear filters" }).click();
    await page.waitForURL(`${baseURL}/learn`);
    assert.equal(await page.getByRole("searchbox").inputValue(), "");
    await page.goto(`${baseURL}/learn?q=unmatched-example-987654321`);
    await page.getByText(lang === "th" ? "ยังไม่พบบทเรียนที่ตรงกัน" : "No matching lesson").waitFor();
    await page.goto(`${baseURL}/learn/guides/start-here?track=restaurant`);
    await page.getByRole("button", { name: lang === "th" ? "ทำเครื่องหมายว่าอ่านแล้ว" : "Mark as read" }).click();
    await page.reload();
    await page.getByRole("button", { name: lang === "th" ? "✓ อ่านแล้ว" : "✓ Read", exact: true }).waitFor();
    await page.goto(`${baseURL}/learn/restaurant`);
    await page.waitForFunction(() => document.querySelector('input[type="checkbox"]')?.checked === true);
    await page.getByRole("link", { name: lang === "th" ? /เคาน์เตอร์ที่ใช้ครัว/ : /Counter with kitchen/ }).click();
    await page.waitForURL(/\/learn\/restaurant\?format=counter-kitchen$/);
    assert.equal(await page.locator('main a[href*="restaurant-floor"]').count(), 0);
    assert.ok(await page.locator('main a[href*="restaurant-service"]').count());
    assert.equal(await page.locator('main a[href*="restaurant-online"]').count(), 0);
    await page.getByRole("link", { name: lang === "th" ? /รับกลับและเดลิเวอรี/ : /Pickup & delivery/ }).click();
    await page.waitForURL(/\/learn\/restaurant\?format=pickup-delivery$/);
    assert.ok(await page.locator('main a[href*="restaurant-online"]').count());
    assert.equal(await page.locator('main a[href*="restaurant-floor"]').count(), 0);
    await page.goto(`${baseURL}/learn/retail`);
    await page.getByRole("link", { name: lang === "th" ? /อาหารและเครื่องดื่มหน้าเคาน์เตอร์/ : /Food & drink counter/ }).click();
    await page.waitForURL(/\/learn\/retail\?format=food-counter$/);
    assert.ok(await page.locator('main a[href*="retail-food-counter"]').count());
    assert.equal(await page.locator('main a[href*="retail-variants-serials"]').count(), 0);
    assert.equal(await page.locator('main a[href*="retail-credit-receivables"]').count(), 0);
    await page.goto(`${baseURL}/learn/guides/restaurant-service?track=restaurant`);
    assert.match(await page.locator('nav[aria-label="Breadcrumb"]').innerText(), lang === "th" ? /ร้านอาหาร/ : /Restaurant/);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("header").isVisible(), false);
    assert.equal(await page.locator("article").isVisible(), true);
    await page.emulateMedia({ media: "screen" });
    await context.route("**/api/auth/me", (route) => route.fulfill({ json: { admin: { id: "FAKE-owner" }, user: null, isAuthenticated: true } }));
    await page.reload();
    await page.locator("header summary").click();
    await page.locator('header a[href="/admin/dashboard"]:visible').waitFor();
    assert.equal(await page.locator('a[href="/shop-signup"]').count(), 0);
    await page.getByRole("button", { name: lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย" }).click();
    await page.getByRole("heading", { level: 1, name: lang === "th" ? "Restaurant: open checks, kitchen & checkout" : "ร้านอาหาร: เปิดบิล ส่งครัว และคิดเงิน" }).waitFor();
    await context.close();
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(`${baseURL}/learn/guides/board-game-checkout`);
  assert.equal(response.status(), 200);
  assert.ok((await page.locator("article").innerText()).length > 600, "Lesson is missing from server-rendered HTML");
  assert.ok(await page.locator('link[rel="canonical"][href$="/learn/guides/board-game-checkout"]').count());
  const sitemap = await context.request.get(`${baseURL}/learn/sitemap.xml`);
  assert.equal(sitemap.status(), 200);
  assert.match(await sitemap.text(), /\/learn\/guides\/board-game-checkout/);
  await context.close();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`${baseURL}/learn/guides/start-here`);
  const menu = mobile.locator("header details");
  const toggle = menu.locator("summary");
  await toggle.focus();
  await mobile.keyboard.press("Enter");
  assert.equal(await menu.getAttribute("open"), "");
  await mobile.keyboard.press("Escape");
  assert.equal(await menu.getAttribute("open"), null);
  assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
  await toggle.click();
  // Click the page margin: the open overlay intentionally covers part of the title.
  await mobile.locator("main").click({ position: { x: 2, y: 2 } });
  assert.equal(await menu.getAttribute("open"), null);
  await toggle.click();
  await menu.locator('a[href="/learn/restaurant"]').click();
  await mobile.waitForURL(`${baseURL}/learn/restaurant`);
  assert.equal(await menu.getAttribute("open"), null);
  await toggle.click();
  await mobile.setViewportSize({ width: 1440, height: 950 });
  await mobile.waitForFunction(() => !document.querySelector("header details").open);
  await mobile.setViewportSize({ width: 390, height: 844 });
  assert.equal(await menu.getAttribute("open"), null);
  await mobileContext.close();
  const noJsMobileContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  const noJsMobile = await noJsMobileContext.newPage();
  await noJsMobile.goto(`${baseURL}/learn`);
  await noJsMobile.locator("header summary").click();
  await noJsMobile.locator('header details a[href="/learn/board-game"]').click();
  await noJsMobile.waitForURL(`${baseURL}/learn/board-game`);
  await noJsMobileContext.close();
  const navigationContext = await browser.newContext();
  await navigationContext.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
  await navigationContext.addInitScript(() => localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() })));
  const navigation = await navigationContext.newPage();
  const missing = await navigation.goto(`${baseURL}/learn/guides/does-not-exist`);
  assert.equal(missing.status(), 404);
  await navigation.getByRole("heading", { name: /ไม่พบบทเรียนนี้|Lesson not found/ }).waitFor();
  for (const width of [1440, 1024, 390]) {
    await navigation.setViewportSize({ width, height: 950 });
    await navigation.goto(`${baseURL}/`);
    await navigation.locator('footer a[href="/learn"]').waitFor();
    await navigation.locator('footer a[href="/learn/retail"]').waitFor();
    await navigation.locator('footer a[href="/learn/restaurant"]').waitFor();
    await navigation.locator('footer a[href="/learn/board-game"]').waitFor();
    await navigation.locator('footer a[href="/learn/pharmacy"]').waitFor();
    await navigation.locator('footer a[href="/learn/inventory"]').waitFor();
    if (width >= 940) await navigation.locator('header nav a[href="/learn"]').waitFor();
    else {
      await navigation.locator('header button:has(.anticon-more)').click();
      await navigation.getByRole("menuitem", { name: /ศูนย์เรียนรู้|Learning center/ }).waitFor();
      await navigation.keyboard.press("Escape");
    }
    const size = await navigation.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(size.scroll <= size.width + 1, `Public header overflow at ${width}`);
  }
  await navigationContext.close();
  assert.deepEqual(failures, []);
  console.log(`Learning center browser smoke passed. Screenshots: ${output}`);
} finally { await browser.close(); }
