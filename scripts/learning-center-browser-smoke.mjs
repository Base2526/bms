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
    for (const width of [1440, 1100, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      for (const path of ["/learn", "/learn/getting-started", "/learn/retail", "/learn/board-game", "/learn/restaurant", "/learn/pharmacy", "/learn/building-materials", "/learn/inventory", "/learn/twenty-baht-shop", "/learn/factory-twine-straw", "/learn/guides/sign-in-account", "/learn/guides/retail-pos-sale", "/learn/guides/board-game-move-split", "/learn/guides/desktop-hardware", "/learn/guides/restaurant-service", "/learn/guides/restaurant-rehearsal", "/learn/guides/pharmacy-counter-sale", "/learn/guides/pharmacy-rehearsal", "/learn/guides/building-materials-quotations", "/learn/guides/building-materials-weighted", "/learn/guides/inventory-transfer-control", "/learn/guides/inventory-rehearsal", "/learn/guides/board-game-deposits", "/learn/guides/board-game-rehearsal"]) {
        const response = await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, path);
        await page.locator("h1").waitFor();
        assert.equal(await page.locator("h1").count(), 1);
        if (width <= 1100) {
          assert.ok((await page.locator("header").first().boundingBox()).height <= 64, "Mobile header must stay on one row");
          assert.equal(await page.locator('header details[data-learning-header-menu="mobile"]').getAttribute("open"), null);
        }
        const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
        assert.ok(sizes.scroll <= sizes.width + 1, `${path} at ${width}: overflow ${sizes.scroll}`);
        if (width !== 320) await page.screenshot({ path: join(output, `${lang}-${width}-${path.replaceAll("/", "-")}.png`), fullPage: false });
      }
    }
    // Every business flow and the specialist inventory flow share the same focused full-screen
    // viewer. It must preserve the current cue, support zoom/navigation and restore trigger focus.
    for (const track of ["retail", "board-game", "restaurant", "pharmacy", "building-materials", "inventory"]) {
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.goto(`${baseURL}/learn/${track}`, { waitUntil: "networkidle" });
      const fullscreenName = lang === "th" ? "ดู Flow เต็มจอ" : "View flow full screen";
      const trigger = page.getByRole("button", { name: fullscreenName });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.locator("[data-flow-active=true]").count(), 1, `${track}: active full-screen cue`);
      await dialog.getByRole("button", { name: lang === "th" ? "ซูมเข้า" : "Zoom in" }).click();
      assert.equal(await dialog.locator("output").innerText(), "125%");
      await dialog.getByRole("button", { name: lang === "th" ? /ถัดไป/ : /Next/ }).click();
      assert.equal(await dialog.locator("[data-flow-active=true]").count(), 1, `${track}: next cue focus`);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 0, `${track}: escape closes full-screen flow`);
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, `${track}: focus returns to trigger`);
      await page.setViewportSize({ width: 390, height: 844 });
      await trigger.click();
      const mobileDialog = page.getByRole("dialog");
      await mobileDialog.waitFor();
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, `${track}: full-screen mobile overflow`);
      await page.screenshot({ path: join(output, `${lang}-fullscreen-${track}.png`), fullPage: false });
      await mobileDialog.getByRole("button", { name: lang === "th" ? "ออกจากโหมดเต็มจอ" : "Exit full screen" }).click();
    }
    // Follow the actual contents page: every board-game article must render in both languages,
    // including all numbered steps, without clipping at the narrowest supported width.
    await page.goto(`${baseURL}/learn/board-game`);
    const articlePaths = await page.locator('main ol a[href*="/learn/guides/"]').evaluateAll((links) =>
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
    const pharmacyPaths = await page.locator('main ol a[href*="/learn/guides/pharmacy-"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]);
    assert.ok(pharmacyPaths.length >= 8, "Pharmacy path is missing reviewed lessons");
    for (const articlePath of pharmacyPaths) {
      const response = await page.goto(`${baseURL}${articlePath}`);
      assert.equal(response.status(), 200, articlePath);
      assert.ok(await page.locator("article ol li").count() >= 4, `${articlePath}: missing steps`);
      assert.ok((await page.locator("article").innerText()).length > 600, `${articlePath}: missing content`);
    }
    console.log(`Verified ${pharmacyPaths.length} pharmacy articles in ${lang}`);
    await page.goto(`${baseURL}/learn`);
    assert.ok(await page.locator('main a[class*="businessCard"][href$="/learn/building-materials"]').isVisible(), "Building-materials home card is missing");
    await page.goto(`${baseURL}/learn/building-materials`);
    assert.match(await page.locator("main").innerText(), lang === "th" ? /คู่มือทดลอง/ : /Pilot guide/);
    assert.ok(await page.locator('header a[href$="/learn/building-materials"]').count());
    assert.ok(await page.locator('nav[aria-label="Guide categories"] a[href$="/learn/building-materials"], nav[aria-label="หมวดคู่มือ"] a[href$="/learn/building-materials"]').count());
    const buildingPaths = await page.locator('main ol a[href*="/learn/guides/building-materials-"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]);
    assert.equal(buildingPaths.length, 9, "Building-materials path is missing pilot lessons");
    for (const articlePath of buildingPaths) {
      const response = await page.goto(`${baseURL}${articlePath}`);
      assert.equal(response.status(), 200, articlePath);
      assert.ok(await page.locator("article ol li").count() >= 4, `${articlePath}: missing steps`);
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.scroll <= size.width + 1, `${articlePath}: mobile overflow`);
    }
    console.log(`Verified ${buildingPaths.length} building-materials articles in ${lang}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/learn/building-materials`);
    await page.locator('header details[data-learning-header-menu="mobile"] summary').click();
    assert.ok(await page.locator('header details[data-learning-header-menu="mobile"] a[href$="/learn/building-materials"]').isVisible(), "Mobile guide menu is missing building materials");
    await page.locator('header details[data-learning-header-menu="mobile"] summary').click();
    if (lang === "th") {
      const audio = page.locator('audio[data-business-recorded-narration="building-materials"]');
      await page.getByRole("button", { name: /เล่นพร้อมภาพ/ }).click();
      await page.waitForFunction(() => document.querySelector('audio[data-business-recorded-narration="building-materials"]')?.currentTime > 0.2);
      assert.equal(await page.locator('[data-track="building-materials"] [data-flow-active="true"]').first().count(), 1);
      assert.equal(await audio.evaluate((element) => element.paused), false);
      await page.getByRole("button", { name: "หยุดชั่วคราว" }).first().click();
      assert.equal(await audio.evaluate((element) => element.paused), true);
      const pausedAt = await audio.evaluate((element) => element.currentTime);
      await page.getByRole("button", { name: /เล่นพร้อมภาพ/ }).click();
      await page.waitForFunction((position) => { const element = document.querySelector('audio[data-business-recorded-narration="building-materials"]'); return element && !element.paused && element.currentTime >= position; }, pausedAt);
      await page.getByRole("button", { name: "หยุดชั่วคราว" }).first().click();
      await page.locator('[data-playing] button:has-text("ถัดไป")').click();
      assert.match(await page.locator('[data-playing] span').first().innerText(), /2 \/ 12/);
      await page.locator('[data-playing] button:has-text("ก่อนหน้า")').click();
      await page.locator('[data-playing] button:has-text("เริ่มใหม่")').click();
      await page.locator('[data-playing] select').selectOption("1.25");
      await page.getByRole("button", { name: /เล่นพร้อมภาพ/ }).click();
      await page.waitForFunction(() => document.querySelector('audio[data-business-recorded-narration="building-materials"]')?.currentTime > 0.2);
      const before = await audio.evaluate((element) => element.currentTime);
      await page.getByRole("button", { name: "ดู Flow เต็มจอ" }).click();
      assert.equal(await page.getByRole("dialog").locator('[data-flow-active="true"]').count(), 1);
      assert.ok(await audio.evaluate((element, beforeTime) => !element.paused && element.currentTime >= beforeTime, before));
      await page.getByRole("dialog").getByRole("button", { name: "ออกจากโหมดเต็มจอ" }).click();
      await page.getByRole("button", { name: "หยุดชั่วคราว" }).first().click();
    } else {
      await page.getByRole("button", { name: /Play with visual/ }).click();
      await page.waitForFunction(() => window.speechSynthesis.speaking);
      assert.equal(await page.locator('[data-track="building-materials"] [data-flow-active="true"]').first().count(), 1);
      await page.getByRole("button", { name: "Pause" }).first().click();
      await page.waitForFunction(() => document.querySelector('button[aria-pressed]')?.getAttribute("aria-pressed") === "false");
      const pausedStep = await page.locator('[data-playing] span').first().innerText();
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('[data-playing] span').first().innerText(), pausedStep, "English cue advanced while paused");
      await page.getByRole("button", { name: /Play with visual/ }).click();
      await page.waitForFunction(() => document.querySelector('button[aria-pressed]')?.getAttribute("aria-pressed") === "true");
      await page.getByRole("button", { name: "Pause" }).first().click();
      await page.waitForFunction(() => document.querySelector('button[aria-pressed]')?.getAttribute("aria-pressed") === "false");
      await page.locator('[data-playing] button:has-text("Next")').click();
      assert.match(await page.locator('[data-playing] span').first().innerText(), /2 \/ 12/);
      await page.locator('[data-playing] button:has-text("Previous")').click();
      await page.locator('[data-playing] button:has-text("Restart")').click();
      await page.locator('[data-playing] select').selectOption("1.25");
      await page.getByRole("button", { name: /Play with visual/ }).click();
      await page.waitForFunction(() => window.speechSynthesis.speaking);
      await page.getByRole("button", { name: "View flow full screen" }).click();
      assert.equal(await page.getByRole("dialog").locator('[data-flow-active="true"]').count(), 1);
      assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), true);
      await page.getByRole("dialog").getByRole("button", { name: "Exit full screen" }).click();
      await page.getByRole("button", { name: "Pause" }).first().click();
    }
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
    await page.waitForURL(/\/learn$/);
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
    await page.locator('header details[data-learning-header-menu="mobile"] summary').click();
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
  assert.match(await sitemap.text(), /\/learn\/building-materials/);
  await context.close();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`${baseURL}/learn/guides/start-here`);
  const menu = mobile.locator('header details[data-learning-header-menu="mobile"]');
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
  await menu.locator('a[href$="/learn/restaurant"]').click();
  await mobile.waitForURL(/\/learn\/restaurant$/);
  assert.equal(await menu.getAttribute("open"), null);
  await toggle.click();
  await mobile.setViewportSize({ width: 1440, height: 950 });
  await mobile.waitForFunction(() => !document.querySelector('header details[data-learning-header-menu="mobile"]').open);
  await mobile.setViewportSize({ width: 390, height: 844 });
  assert.equal(await menu.getAttribute("open"), null);
  await mobileContext.close();
  const noJsMobileContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  const noJsMobile = await noJsMobileContext.newPage();
  await noJsMobile.goto(`${baseURL}/learn`);
  await noJsMobile.locator('header details[data-learning-header-menu="mobile"] summary').click();
  await noJsMobile.locator('header details[data-learning-header-menu="mobile"] a[href$="/learn/board-game"]').click();
  await noJsMobile.waitForURL(/\/learn\/board-game$/);
  await noJsMobile.setViewportSize({ width: 1440, height: 844 });
  await noJsMobile.goto(`${baseURL}/learn`);
  const noJsDesktopMenu = noJsMobile.locator('header details[data-learning-header-menu="desktop"]').first();
  await noJsDesktopMenu.locator("summary").click();
  await noJsDesktopMenu.locator('a[href$="/learn/retail"]').click();
  await noJsMobile.waitForURL(/\/learn\/retail$/);
  await noJsMobileContext.close();
  const headerDestinations = [
    "/", "/learn", "/learn/getting-started", "/learn/retail", "/learn/board-game",
    "/learn/restaurant", "/learn/pharmacy", "/learn/building-materials", "/learn/inventory",
    "/learn/twenty-baht-shop", "/learn/factory-twine-straw", "/learn/guides/pos-devices",
    "/learn/guides/line-ai-booking", "/learn/guides/outages-support", "/learn/guides/launch-checklist",
  ];
  for (const lang of ["th", "en"]) {
    const headerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await headerContext.addCookies([{ name: "lang", value: lang, url: baseURL }]);
    await headerContext.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
    const headerPage = await headerContext.newPage();
    await headerPage.goto(`${baseURL}/${lang}/learn/getting-started`, { waitUntil: "networkidle" });
    const hrefs = await headerPage.locator("header a[href]").evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
    for (const path of headerDestinations) {
      const localized = `/${lang}${path === "/" ? "" : path}`;
      assert.ok(hrefs.includes(localized), `${lang}: missing header destination ${path}`);
    }
    const desktopMenu = headerPage.locator('header details[data-learning-header-menu="desktop"]').first();
    const desktopSummary = desktopMenu.locator("summary");
    await desktopSummary.focus();
    await headerPage.keyboard.press("Enter");
    assert.equal(await desktopMenu.getAttribute("open"), "");
    await headerPage.keyboard.press("Escape");
    assert.equal(await desktopMenu.getAttribute("open"), null);
    assert.equal(await desktopSummary.evaluate((element) => element === document.activeElement), true);
    await desktopSummary.click();
    await headerPage.locator("main").click({ position: { x: 2, y: 2 } });
    assert.equal(await desktopMenu.getAttribute("open"), null);
    await desktopSummary.click();
    await headerPage.setViewportSize({ width: 1100, height: 900 });
    await headerPage.waitForFunction(() => [...document.querySelectorAll('header details[data-learning-header-menu="desktop"]')].every((menu) => !menu.open));
    await headerContext.close();
  }
  const navigationContext = await browser.newContext();
  await navigationContext.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
  await navigationContext.addInitScript(() => localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() })));
  const navigation = await navigationContext.newPage();
  const missing = await navigation.goto(`${baseURL}/learn/guides/does-not-exist`);
  assert.equal(missing.status(), 404);
  await navigation.getByRole("heading", { name: /ไม่พบบทเรียนนี้|Lesson not found/ }).waitFor();
  for (const width of [1440, 1024, 390]) {
    await navigation.setViewportSize({ width, height: 950 });
    await navigation.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await navigation.locator('footer a[href$="/learn"]').waitFor();
    await navigation.locator('footer a[href$="/learn/retail"]').waitFor();
    await navigation.locator('footer a[href$="/learn/restaurant"]').waitFor();
    await navigation.locator('footer a[href$="/learn/board-game"]').waitFor();
    await navigation.locator('footer a[href$="/learn/pharmacy"]').waitFor();
    await navigation.locator('footer a[href$="/learn/inventory"]').waitFor();
    if (width >= 940) await navigation.locator('header nav a[href$="/learn"]').waitFor();
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
