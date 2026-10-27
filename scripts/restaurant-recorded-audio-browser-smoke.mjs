import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3100";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local fixtures only");
await mkdir(".test-output/restaurant-recorded-audio", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() }));
      Object.defineProperty(window, "speechSynthesis", { value: undefined });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { value: undefined });
    });
    let failFiles = false, audioRequests = 0;
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.startsWith("/audio/") && url.pathname.endsWith(".mp3")) {
        audioRequests++;
        if (failFiles) return route.fulfill({ status: 404, body: "missing fixture" });
      }
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: false, user: null, admin: null } });
      if (url.pathname.endsWith("/graphql")) return route.fulfill({ json: { data: { myBmsPermissions: [] } } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/restaurant#flow-1`);
    const guide = page.locator("[data-restaurant-guide]"), player = guide.locator("[data-restaurant-player]");
    const audio = player.locator("audio"), sound = player.getByRole("checkbox", { name: "เปิดเสียง" });
    const play = () => player.getByRole("button", { name: "▶ เล่น", exact: true }).click();
    const pause = () => player.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
    await guide.locator("#flow-1").waitFor();
    const download = player.locator("[data-download-narration]");
    assert.equal(await download.getAttribute("download"), "bms-restaurant-flow-01-th.mp3");
    assert.ok((await download.getAttribute("href")).endsWith(".mp3"));
    assert.equal(await sound.isDisabled(), false);
    assert.equal(audioRequests, 0, "Do not preload all recordings before Play");
    await play();
    await page.waitForFunction(() => document.querySelector("audio").currentTime > 0.1);
    assert.ok((await audio.getAttribute("src")).endsWith(".mp3"));
    // Real MP3 decoding and native ended event advance the diagram without Speech Synthesis.
    await page.waitForFunction(() => document.querySelector("[data-player-step]").dataset.playerStep === "1", null, { timeout: 45000 });
    await page.waitForFunction(() => document.querySelector("audio").currentTime > 0.1);
    await pause();
    assert.equal(await audio.evaluate(el => el.paused), true);
    assert.equal(await audio.getAttribute("src"), null);
    await player.getByRole("button", { name: "ถัดไป", exact: true }).click();
    await play();
    await page.waitForFunction(() => document.querySelector("audio").currentTime > 0.1);
    await player.locator("select").last().selectOption("1.25");
    await page.waitForFunction(() => document.querySelector("audio").playbackRate === 1.25 && !document.querySelector("audio").paused);
    await sound.uncheck();
    assert.equal(await audio.evaluate(el => el.paused), true);
    await sound.check();
    await page.waitForFunction(() => document.querySelector("audio").currentTime > 0.1);
    await player.screenshot({ path: `.test-output/restaurant-recorded-audio/${width}-thai.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => { window.previousAudio = document.querySelector("audio"); });
    await guide.locator('[data-flow-id="8"]').click();
    assert.equal(await page.evaluate(() => previousAudio.paused && !previousAudio.getAttribute("src")), true);
    assert.equal(await player.locator("[data-player-step]").getAttribute("data-player-step"), "0");
    // Network failure provides recovery, and retry plays the actual file after connectivity returns.
    failFiles = true;
    await play();
    await player.getByRole("status").filter({ hasText: "เล่นไฟล์เสียงไม่ได้" }).waitFor();
    await pause();
    failFiles = false;
    await sound.check();
    await play();
    await page.waitForFunction(() => document.querySelector("audio").currentTime > 0.1);
    await pause();
    // Media permission rejection must be caught instead of leaving an unhandled promise.
    await page.evaluate(() => {
      const audio = document.querySelector("audio");
      audio.play = () => Promise.reject(new DOMException("blocked fixture", "NotAllowedError"));
    });
    await play();
    await player.getByRole("status").filter({ hasText: "เบราว์เซอร์ไม่อนุญาตให้เล่นเสียง" }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS recorded Thai audio, native decode/end, controls, cleanup and retry (${width}px)`);
    await context.close();
  }
} finally { await browser.close(); }
