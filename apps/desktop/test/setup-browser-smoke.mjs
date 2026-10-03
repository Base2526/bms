// Renderer interaction/viewport check with a stub IPC bridge; no real server is opened.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
// CI/release QA can point at an extracted app.asar rather than the working tree.
const appRoot = process.env.BMS_DESKTOP_SMOKE_APP_ROOT
  ? pathToFileURL(path.resolve(process.env.BMS_DESKTOP_SMOKE_APP_ROOT) + path.sep)
  : new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", appRoot), "utf8"));
const output = new URL("../dist-smoke/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  for (const platform of ["win32", "linux", "darwin"]) {
    const page = await browser.newPage({ viewport: { width: 1035, height: 702 } });
    await page.addInitScript(({ platform, version }) => {
      window.bmsDesktop = {
        getAppInfo: async () => ({ platform, version, clientLabel: `${platform} Client`, secureStorageReady: true }),
        getSetupAdminTarget: async () => ({ kind: "local" }),
        openSetupAdmin: async () => { await new Promise(resolve => setTimeout(resolve, 100)); return { ok: true, kind: "local", serverUrl: "http://127.0.0.1:3100" }; },
        pair: async () => ({ ok: false, error: "test" }),
      };
    }, { platform, version });
    await page.goto(new URL("renderer/setup.html", appRoot).href);
    await page.evaluate(() => document.fonts.ready);
    const button = page.locator("#admin-link");
    await page.getByText("สร้างจากระบบหลังบ้านบนเครื่องนี้", { exact: true }).waitFor();
    assert.ok(await button.isVisible());
    await button.click();
    await page.waitForFunction(() => document.querySelector("#server-url").value === "http://127.0.0.1:3100");
    assert.equal(await button.isEnabled(), true);
    await page.locator("#server-url").fill("https://shop.example.com");
    await button.click();
    await page.waitForFunction(() => !document.querySelector("#admin-link").disabled);
    assert.equal(await page.locator("#server-url").inputValue(), "https://shop.example.com");
    await page.screenshot({ path: fileURLToPath(new URL(`setup-${platform}.png`, output)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { window.bmsDesktop.openSetupAdmin = async () => ({ ok: false, kind: "local", error: "Local server unavailable" }); });
    await button.click();
    await page.getByText("Local server unavailable", { exact: true }).waitFor();
    assert.equal(await button.isEnabled(), true);
    await page.locator("#status-close").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: fileURLToPath(new URL(`setup-${platform}-compact.png`, output)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
  }
  // A POS-only machine (no Retail Local server) is pointed at the cloud back office and keeps its URL field untouched.
  const cloud = await browser.newPage({ viewport: { width: 1035, height: 702 } });
  await cloud.addInitScript(({ version }) => {
    window.__opened = 0;
    window.bmsDesktop = {
      getAppInfo: async () => ({ platform: "darwin", version, secureStorageReady: true }),
      getSetupAdminTarget: async () => ({ kind: "cloud" }),
      openSetupAdmin: async () => { window.__opened += 1; return { ok: true, kind: "cloud" }; },
      pair: async () => ({ ok: false, error: "test" }),
    };
  }, { version });
  await cloud.goto(new URL("renderer/setup.html", appRoot).href);
  await cloud.getByText("สร้างจากระบบหลังบ้าน BMS", { exact: true }).waitFor();
  await cloud.locator("#admin-link").click();
  await cloud.waitForFunction(() => window.__opened === 1);
  assert.equal(await cloud.locator("#server-url").inputValue(), "");
  await cloud.screenshot({ path: fileURLToPath(new URL("setup-cloud.png", output)), fullPage: true });
  await cloud.close()
  console.log("Setup admin link: win32/linux/darwin local + cloud target, visibility, success, offline recovery, URL preservation and responsive screenshots passed.");
} finally { await browser.close(); }
