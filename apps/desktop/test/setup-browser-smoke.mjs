// Renderer interaction/viewport check with a stub IPC bridge; no real server is opened.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const output = new URL("../dist-smoke/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  for (const platform of ["win32", "linux", "darwin"]) {
    const page = await browser.newPage({ viewport: { width: 1035, height: 702 } });
    await page.addInitScript(platform => {
      window.bmsDesktop = {
        getAppInfo: async () => ({ platform, version: "test", clientLabel: `${platform} Client`, secureStorageReady: true }),
        openLocalAdmin: async () => { await new Promise(resolve => setTimeout(resolve, 100)); return { ok: true, serverUrl: "http://127.0.0.1:3100" }; },
        pair: async () => ({ ok: false, error: "test" }),
      };
    }, platform);
    await page.goto(new URL("../renderer/setup.html", import.meta.url).href);
    await page.evaluate(() => document.fonts.ready);
    const button = page.locator("#local-admin-button");
    assert.ok(await button.isVisible());
    await button.click();
    await page.waitForFunction(() => document.querySelector("#server-url").value === "http://127.0.0.1:3100");
    assert.equal(await button.isEnabled(), true);
    await page.locator("#server-url").fill("https://shop.example.com");
    await button.click();
    await page.waitForFunction(() => !document.querySelector("#local-admin-button").disabled);
    assert.equal(await page.locator("#server-url").inputValue(), "https://shop.example.com");
    await page.screenshot({ path: fileURLToPath(new URL(`setup-${platform}.png`, output)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { window.bmsDesktop.openLocalAdmin = async () => ({ ok: false, error: "Local server unavailable" }); });
    await button.click();
    await page.getByText("Local server unavailable", { exact: true }).waitFor();
    assert.equal(await button.isEnabled(), true);
    await page.locator("#status-close").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: fileURLToPath(new URL(`setup-${platform}-compact.png`, output)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
  }
  console.log("Setup admin button: win32/linux/darwin visibility, success, offline recovery, URL preservation and responsive screenshots passed.");
} finally { await browser.close(); }
