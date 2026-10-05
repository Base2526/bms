import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3002";
const output = ".test-output/library-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: "th", url: base }]);
const title = { id: "FAKE-title", title: "FAKE Azul", minPlayers: 2, maxPlayers: 4, typicalMinutes: 45, imageUrl: null,
  copies: [{ id: "FAKE-copy-1", copyCode: "FAKE-AZ-01", status: "AVAILABLE" }, { id: "FAKE-copy-2", copyCode: "FAKE-AZ-02", status: "IN_USE" }] };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
let uploads = 0;
const errors = [], unexpected = [];
await context.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  let json = {};
  if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", language: "th" } };
  else if (path === "/api/graphql") {
    const body = route.request().postDataJSON();
    json = { data: body.query.includes("MyBmsPermissions") ? { myBmsPermissions: ["board_game.library.view", "board_game.library.manage", "board_game.session.manage"] } : {} };
  }
  else if (path === "/api/files/FAKE-image") return route.fulfill({ contentType: "image/png", body: png });
  else if (path.endsWith("/library/image")) {
    assert.equal(url.searchParams.get("titleId"), title.id);
    assert.equal(route.request().headers()["content-type"], "image/png");
    uploads++;
    title.imageUrl = "/api/files/FAKE-image";
    json = { imageUrl: title.imageUrl };
  }
  else if (path.endsWith("/locations")) json = { locations: [{ id: "FAKE-location", code: "MAIN", name: "FAKE Branch", active: true }] };
  else if (path.endsWith("/rates")) json = { rates: [] };
  else if (path.endsWith("/floor")) json = { floor: { areas: [], tables: [], openCounts: {} } };
  else if (path.endsWith("/library")) json = { titles: [title] };
  else if (path.endsWith("/identity")) json = { holds: [] };
  else if (path.endsWith("/passes")) json = { plans: [], passes: [], outstanding: null };
  else if (path.endsWith("/offers")) json = { offers: [] };
  else if (path.endsWith("/pass-renewals")) json = { renewals: [] };
  else if (path !== "/api/logs" && route.request().method() !== "GET") unexpected.push(path);
  return route.fulfill({ json });
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/admin/board-game`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("tab", { name: "คลังเกม", exact: true }).click();
  await page.getByRole("button", { name: "รูปเกม", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "FAKE-game.png", mimeType: "image/png", buffer: png });
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(uploads, 1);
  await page.locator('img[src="/api/files/FAKE-image"]').waitFor();
  await page.getByRole("button", { name: "ป้าย QR รหัสกล่อง", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('img[alt="QR FAKE-AZ-02"]').waitFor();
  assert.equal(await dialog.locator("img").count(), 2);
  await dialog.getByRole("checkbox", { name: "FAKE-AZ-02", exact: true }).uncheck();
  assert.equal(await dialog.locator("img").count(), 1);
  await page.waitForFunction(() => {
    const modal = document.querySelector('.ant-modal');
    return modal && !/ant-zoom-(appear|enter|leave)/.test(modal.className);
  });
  await page.screenshot({ path: `${output}/labels-desktop.png` });
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.open = (...args) => {
      const popup = open(...args);
      if (popup) popup.print = () => { popup.document.documentElement.dataset.printRequested = "true"; };
      return popup;
    };
  });
  const [printPage] = await Promise.all([
    context.waitForEvent("page"),
    dialog.getByRole("button", { name: /พิมพ์ป้าย/ }).click(),
  ]);
  await printPage.waitForFunction(() => document.documentElement.dataset.printRequested === "true");
  assert.equal(await printPage.locator(".label").count(), 1);
  assert.equal(await printPage.locator(".label img").getAttribute("alt"), "FAKE-AZ-01");
  await printPage.screenshot({ path: `${output}/print-sheet.png` });
  await printPage.close();
  // Block popups deliberately: the UI must report failure rather than silently do nothing.
  await page.evaluate(() => { window.open = () => null; });
  await dialog.getByRole("button", { name: /พิมพ์ป้าย/ }).click();
  await dialog.getByText("กรุณาอนุญาตหน้าต่างป๊อปอัปเพื่อพิมพ์ป้าย", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: `${output}/labels-mobile.png` });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: `${output}/library-mobile.png` });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log("PASS library upload, thumbnail, QR label selection, popup failure, desktop/mobile; no business mutations");
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(0, 5000));
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally { await browser.close(); }
