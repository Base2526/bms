import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3100";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local fixtures only");
const output = ".test-output/restaurant-playback-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "lang", value: "en", url: base }]);
    await context.addInitScript(() => {
      localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() }));
      window.testSpeech = { mode: "hang", spoken: [], cancelled: 0 };
      const synth = new EventTarget();
      synth.getVoices = () => [{ lang: "en-US", name: "Test voice" }];
      synth.cancel = () => { window.testSpeech.cancelled++; };
      synth.speak = utterance => {
        if (window.testSpeech.mode === "throw") throw new Error("Test speech engine failure");
        window.testSpeech.spoken.push(utterance);
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(text) { this.text = text; } } });
    });
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: false, user: null, admin: null } });
      if (url.pathname.endsWith("/graphql")) return route.fulfill({ json: { data: { myBmsPermissions: [] } } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/restaurant?shop=restaurant#flow-3`);
    const guide = page.locator("[data-restaurant-guide]"), player = guide.locator("[data-restaurant-player]");
    await player.waitFor();
    const step = () => player.locator("[data-player-step]").getAttribute("data-player-step");
    const play = () => player.getByRole("button", { name: "▶ Play", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') && location.search.includes("shop=restaurant"));
    assert.equal(await player.getByRole("checkbox", { name: /Optional step/ }).isChecked(), false);
    await play();
    await page.waitForFunction(() => testSpeech.spoken.length === 1);
    await page.evaluate(() => { window.oldUtterance = testSpeech.spoken.at(-1); oldUtterance.onend(); });
    await page.waitForFunction(() => document.querySelector("[data-player-step]").dataset.playerStep === "1");
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    assert.equal(await step(), "1");
    assert.ok(await page.evaluate(() => testSpeech.cancelled > 0));
    await player.getByRole("button", { name: "Next", exact: true }).click();
    await page.evaluate(() => { oldUtterance.onerror(); oldUtterance.onend(); });
    assert.equal(await step(), "2", "Late callbacks cannot advance a paused/new step");
    await player.getByRole("button", { name: "Next", exact: true }).click();
    await play();
    await page.waitForFunction(() => testSpeech.spoken.length >= 3);
    assert.equal(await player.locator('[class*="cueArrow"]').evaluate(el => getComputedStyle(el).animationName.includes("cueTravel")), true);
    assert.equal(await player.locator("[data-player-step]").getAttribute("aria-live"), "off");
    await player.screenshot({ path: `${output}/${width}-playing.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // A voice engine that never starts must not leave playback stuck forever.
    await player.getByRole("status").filter({ hasText: "Narration failed" }).waitFor({ timeout: 8000 });
    assert.equal(await player.getByRole("checkbox", { name: "Sound on" }).isChecked(), false);
    const failedStep = await step();
    await page.waitForFunction(previous => document.querySelector("[data-player-step]").dataset.playerStep !== previous, failedStep, { timeout: 12000 });
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    await page.evaluate(() => { testSpeech.mode = "throw"; });
    await player.getByRole("checkbox", { name: "Sound on" }).check();
    await play();
    await player.getByRole("status").filter({ hasText: "Narration failed" }).waitFor();
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    await page.evaluate(() => { testSpeech.mode = "hang"; });
    await player.getByRole("checkbox", { name: "Sound on" }).check();
    await play();
    await page.evaluate(() => testSpeech.spoken.at(-1).onerror());
    await player.getByRole("status").filter({ hasText: "Narration failed" }).waitFor();
    await guide.getByRole("checkbox", { name: "Multiple branches" }).check();
    await player.getByRole("button", { name: "▶ Play", exact: true }).waitFor();
    assert.equal(await step(), "0", "Changing profile stops and resets playback");
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => new Promise((resolve, reject) => { window.rejectClipboard = reject; }),
    } }));
    await guide.locator("[data-copy-flow]").click();
    await page.waitForFunction(() => typeof rejectClipboard === "function");
    const shops = guide.getByRole("group", { name: "Shop type", exact: true });
    await shops.getByRole("button").nth(2).click();
    await page.evaluate(() => rejectClipboard(new Error("Test denied clipboard")));
    assert.equal(new URL(page.url()).searchParams.get("shop"), "food_beverage", "Stale sharing cannot restore an old shop");
    assert.equal(await guide.locator("[data-copy-flow] + [role=status]").textContent(), "");
    await page.goto(`${base}/restaurant?shop=restaurant#flow-7`);
    await guide.locator("#flow-7").waitFor();
    await guide.locator('a[href="#restaurant-flows"]').click();
    assert.ok(await guide.locator("#flow-7").isVisible(), "Explore anchor preserves selected flow");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await player.getByRole("button", { name: "Next", exact: true }).click();
    await play();
    assert.equal(await player.locator('[class*="cueArrow"]').evaluate(el => getComputedStyle(el).animationName), "none");
    // An unlisted Thai voice must not lock the sound control (the production regression).
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await page.reload();
    await player.getByRole("checkbox", { name: "เปิดเสียง" }).waitFor();
    const thaiSound = player.getByRole("checkbox", { name: "เปิดเสียง" });
    assert.equal(await thaiSound.isDisabled(), false);
    await thaiSound.uncheck();
    await thaiSound.check();
    await player.getByRole("button", { name: "▶ เล่น", exact: true }).click();
    await page.waitForFunction(() => testSpeech.spoken.length === 1);
    assert.deepEqual(await page.evaluate(() => ({ lang: testSpeech.spoken[0].lang, voice: testSpeech.spoken[0].voice ?? null })), { lang: "th-TH", voice: null });
    await page.evaluate(() => testSpeech.spoken[0].onerror({ error: "language-unavailable" }));
    await player.getByRole("status").filter({ hasText: "ระบบเสียงแจ้งว่าไม่มีเสียงภาษานี้" }).waitFor();
    await player.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
    // Empty enumeration still tries lang-based speech; a late voice is used on the next request.
    await page.evaluate(() => { speechSynthesis.getVoices = () => []; speechSynthesis.dispatchEvent(new Event("voiceschanged")); });
    await thaiSound.check();
    await player.getByRole("button", { name: "▶ เล่น", exact: true }).click();
    await page.waitForFunction(() => testSpeech.spoken.length === 2);
    await page.evaluate(() => { testSpeech.spoken.at(-1).onstart(); testSpeech.spoken.at(-1).onend(); });
    await page.waitForFunction(() => document.querySelector("[data-player-step]").dataset.playerStep === "1");
    await player.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
    await page.evaluate(() => {
      speechSynthesis.getVoices = () => [{ lang: "th_TH", name: "Late Thai voice" }];
      speechSynthesis.dispatchEvent(new Event("voiceschanged"));
      testSpeech.spoken = [];
    });
    await player.getByRole("button", { name: "▶ เล่น", exact: true }).click();
    await page.waitForFunction(() => testSpeech.spoken.length === 1);
    assert.equal(await page.evaluate(() => testSpeech.spoken[0].voice.name), "Late Thai voice");
    await page.evaluate(() => testSpeech.spoken[0].onerror({ error: "not-allowed" }));
    await player.getByRole("status").filter({ hasText: "เบราว์เซอร์ไม่อนุญาตให้เล่นเสียง" }).waitFor();
    // Enumeration exceptions also use the browser's default language resolution.
    await player.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
    await page.evaluate(() => { speechSynthesis.getVoices = () => { throw new Error("Enumeration unavailable"); }; speechSynthesis.dispatchEvent(new Event("voiceschanged")); });
    await thaiSound.check();
    await player.getByRole("button", { name: "▶ เล่น", exact: true }).click();
    await page.waitForFunction(() => testSpeech.spoken.length === 2);
    await player.screenshot({ path: `${output}/${width}-thai-unlisted.png` });
    // Disable only when the API itself is unavailable.
    await context.addInitScript(() => Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined }));
    await page.goto(`${base}/restaurant`);
    await thaiSound.waitFor();
    assert.equal(await thaiSound.isDisabled(), true);
    await player.getByRole("status").filter({ hasText: "เบราว์เซอร์นี้ไม่รองรับเสียงอ่าน" }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS playback errors, controls, profile navigation, sharing and reduced motion (${width}px)`);
    await context.close();
  }
} finally { await browser.close(); }
