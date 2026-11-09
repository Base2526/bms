import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pickup call screen (`/pos/queue-board`, `10.111`) inside the desktop shell.
 *
 * Renders the shipping page in a sandboxed Electron window with the REAL desktop preload, so the
 * device token arrives through `bmsDesktop.getDeviceToken()` exactly as in the paired app. A fake
 * board API stands in for the server and is changed between polls to drive the screen.
 */
const { app, BrowserWindow, ipcMain } = electronMain;
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const output = path.resolve(here, "../dist-smoke/queue-board");
const TOKEN = "FAKE-device-token";
const waitFor = (win, expression, ms = 15000) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const until = Date.now() + ${ms};
  const tick = () => { if (${expression}) resolve(); else if (Date.now() > until) reject(new Error('Timeout: ' + ${JSON.stringify(expression)})); else setTimeout(tick, 40); }; tick();
})`);

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const entry = (label, status, calledAgoMs = null) => ({
  label, status,
  readyAt: status === "READY" ? iso(-(calledAgoMs ?? 0)) : null,
  calledAt: status === "READY" && calledAgoMs != null ? iso(-calledAgoMs) : null,
});

async function run() {
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(here, "queue-board-fixture.tsx")], bundle: true,
    outfile: path.join(output, "board.js"), platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), nodePaths: [path.join(web, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' } });
  const html = '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><body><div id="root"></div><script src="/board.js"></script></body></html>';
  const js = await readFile(path.join(output, "board.js"));

  let token = TOKEN;
  ipcMain.handle("bms-pos:get-device-token", () => token);
  ipcMain.handle("bms-pos:get-storage-namespace", () => "queue-board-smoke");
  const state = { entries: [], status: 200 };
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (url.pathname === "/board.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
    if (url.pathname === "/api/pos/pickup-queue") {
      seen.push({ view: url.searchParams.get("view"), token: req.headers["x-pos-device-token"] ?? null });
      res.setHeader("Content-Type", "application/json");
      if (req.headers["x-pos-device-token"] !== TOKEN) { res.writeHead(401); res.end(JSON.stringify({ error: "device token ไม่ถูกต้อง" })); return; }
      if (state.status !== 200) { res.writeHead(state.status); res.end(JSON.stringify({ error: "เซิร์ฟเวอร์ขัดข้อง" })); return; }
      res.end(JSON.stringify({ entries: state.entries, serverTime: iso() }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: {
    preload: path.resolve(here, "../src/preload.cjs"), sandbox: true, contextIsolation: true,
    nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  // Hidden windows paint lazily: wait for two frames so the capture shows the state just asserted.
  const painted = () => win.webContents.executeJavaScript(
    "new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 50))))");
  const shot = async name => {
    await painted();
    await writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const fits = () => win.webContents.executeJavaScript(
    "({ wide: document.documentElement.scrollWidth > innerWidth, tall: document.documentElement.scrollHeight > innerHeight + 2 })");
  const text = () => win.webContents.executeJavaScript("document.body.innerText");

  try {
    // 1. Not paired: the desktop bridge returns no token, so the page must say so and never poll.
    token = null;
    await win.loadURL(origin);
    await waitFor(win, "document.body.innerText.includes('เปิดจอเรียกคิวจากแอป BMS POS')");
    assert.equal(seen.length, 0, "an unpaired screen must not call the queue API");
    await shot("unpaired-1440");

    // 2. Paired: numbers already called before the screen opened must not be re-announced.
    token = TOKEN;
    state.entries = [entry("041", "PREPARING"), entry("043", "PREPARING"), entry("044", "PREPARING"),
      entry("039", "READY", 60_000), entry("040", "READY", 30_000)];
    await win.loadURL(origin);
    await waitFor(win, "document.body.innerText.includes('041') && document.body.innerText.includes('039')");
    assert.ok(seen.length > 0 && seen.every(call => call.view === "board" && call.token === TOKEN),
      "the screen must use the board view and send the paired device token");
    let body = await text();
    assert.ok(body.includes("กำลังเตรียม") && body.includes("พร้อมรับ"), "both columns render");
    assert.ok(!body.includes("เชิญรับที่เคาน์เตอร์"), "opening the screen must not replay old calls");
    await waitFor(win, "document.body.innerText.includes('AI Studio voice พร้อม') || document.body.innerText.includes('ใช้เสียงพูดภาษาไทยของเครื่อง')");
    body = await text();
    assert.ok(!body.includes("แตะเพื่อเปิดเสียง"), "desktop arms queue-board sound by default");
    const font = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('main')).fontFamily");
    assert.ok(/system-ui|IBM Plex Sans Thai/.test(font), `call screen must not fall back to a serif font (got ${font})`);
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [800, 600], [768, 1024]]) {
      win.setContentSize(width, height);
      await new Promise(done => setTimeout(done, 150));
      const size = await fits();
      assert.equal(size.wide, false, `${width}x${height}: horizontal overflow`);
      if (width >= 1024) assert.equal(size.tall, false, `${width}x${height}: vertical overflow`);
      await shot(`board-${width}x${height}`);
    }

    // 3. A number is called: it is spotlighted on the next poll, newest first in the ready column.
    win.setContentSize(1440, 900);
    state.entries = [entry("043", "PREPARING"), entry("044", "PREPARING"),
      entry("041", "READY", 0), entry("039", "READY", 60_000), entry("040", "READY", 30_000)];
    await waitFor(win, "document.body.innerText.includes('เชิญรับที่เคาน์เตอร์')", 8000);
    const spotlight = await win.webContents.executeJavaScript(
      "document.querySelector('[role=status]')?.innerText ?? ''");
    assert.ok(spotlight.includes("041"), "the called number is the one spotlighted");
    assert.equal((await fits()).tall, false, "spotlight must still fit 1440x900");
    await shot("called-1440x900");
    const readyOrder = await win.webContents.executeJavaScript(
      "document.querySelector('.pq-ready .pq-numbers').innerText.split(/\\s+/).filter(t => /^\\d{3}$/.test(t))");
    assert.deepEqual(readyOrder, ["041", "040", "039"], "ready column lists the latest call first");

    // 4. Busy lunch after a reconnect: numbers called minutes ago appear in the ready column but
    //    are not re-announced, and a fresh call plus a full board still fits the screen.
    await waitFor(win, "!document.querySelector('[role=status]')", 16000);
    const busyEntries = [
      ...Array.from({ length: 28 }, (_, i) => entry(String(50 + i).padStart(3, "0"), "PREPARING")),
      ...Array.from({ length: 12 }, (_, i) => entry(String(20 + i).padStart(3, "0"), "READY", 120_000 + i * 1000)),
    ];
    state.entries = busyEntries;
    await waitFor(win, "document.body.innerText.includes('28 คิว') && document.body.innerText.includes('12 คิว')", 8000);
    await new Promise(done => setTimeout(done, 3500));
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[role=status]')"), false,
      "calls older than the announce window must not be spotlighted after a reconnect");
    await shot("busy-1440x900");
    assert.deepEqual(await fits(), { wide: false, tall: false }, "busy board must fit 1440x900");

    // Every owner-selectable presentation must render the same queue authority and fit a 1440p
    // cashier test window. The preference is workstation-local and survives reloads.
    for (const layout of ["SPOTLIGHT", "THREE_ZONE", "TICKER", "MINIMAL", "AIRPORT", "SPLIT"]) {
      await win.webContents.executeJavaScript(
        `localStorage.setItem('bms.pos.queueBoardLayout.queue-board-smoke', ${JSON.stringify(layout)})`,
      );
      await win.reload();
      await waitFor(win, `document.querySelector('[data-queue-layout="${layout.toLowerCase()}"]') && document.body.innerText.includes('พร้อมรับ')`);
      assert.deepEqual(await fits(), { wide: false, tall: false }, `${layout}: busy board must fit 1440x900`);
      await shot(`layout-${layout.toLowerCase()}-1440x900`);
    }

    // A quiet shop must not leave a padded empty card across the bottom of the ticker layout.
    // Keep the status visible, but collapse it to a single aligned summary rail.
    state.entries = [entry("090", "READY", 60_000)];
    await win.webContents.executeJavaScript(
      "localStorage.setItem('bms.pos.queueBoardLayout.queue-board-smoke', 'TICKER')",
    );
    await win.reload();
    await waitFor(win, "document.querySelector('[data-queue-layout=\"ticker\"] .pq-preparing.is-empty') && document.body.innerText.includes('0 คิว')");
    const quietTicker = await win.webContents.executeJavaScript(`(() => {
      const upper = document.querySelector('.pq-ticker-upper').getBoundingClientRect();
      const rail = document.querySelector('.pq-ticker-preparing .pq-preparing').getBoundingClientRect();
      return { left: Math.abs(upper.left - rail.left), right: Math.abs(upper.right - rail.right), height: rail.height };
    })()`);
    assert.ok(quietTicker.left < 1 && quietTicker.right < 1, "empty preparing rail aligns with the upper queue cards");
    assert.ok(quietTicker.height <= 90, `empty preparing rail stays compact (got ${quietTicker.height}px)`);
    assert.deepEqual(await fits(), { wide: false, tall: false }, "quiet ticker board must fit 1440x900");
    await shot("ticker-empty-preparing-1440x900");

    state.entries = busyEntries;
    await win.webContents.executeJavaScript(
      "localStorage.setItem('bms.pos.queueBoardLayout.queue-board-smoke', 'SPOTLIGHT')",
    );
    await win.webContents.executeJavaScript(
      "localStorage.setItem('bms.pos.queueBoardAudio.queue-board-smoke', 'COUNTER_BELL')",
    );
    await win.reload();
    await waitFor(win, "document.querySelector('[data-queue-layout=\"spotlight\"][data-queue-audio=\"counter_bell\"]') && document.body.innerText.includes('กระดิ่งเคาน์เตอร์พร้อม')");
    state.entries = [...state.entries, entry("078", "READY", 0)];
    await waitFor(win, "document.querySelector('[role=status]')?.innerText.includes('078')", 8000);
    await shot("busy-called-1440x900");
    assert.deepEqual(await fits(), { wide: false, tall: false }, "busy board plus spotlight must fit 1440x900");
    win.setContentSize(1920, 1080);
    await shot("busy-called-1920x1080");
    assert.deepEqual(await fits(), { wide: false, tall: false }, "busy board plus spotlight must fit a 1080p screen");
    win.setContentSize(1440, 900);

    // 5. A transient server error is shown, and the screen recovers by itself.
    state.status = 500;
    await waitFor(win, "document.body.innerText.includes('เซิร์ฟเวอร์ขัดข้อง')", 8000);
    await shot("server-error-1440x900");
    state.status = 200;
    state.entries = [entry("101", "PREPARING")];
    await waitFor(win, "!document.body.innerText.includes('เซิร์ฟเวอร์ขัดข้อง') && document.body.innerText.includes('101')", 8000);

    // 6. The spotlight clears after its time and the number stays in the ready column.
    state.entries = [entry("101", "READY", 0)];
    await waitFor(win, "document.querySelector('[role=status]')?.innerText.includes('101')", 8000);
    await waitFor(win, "!document.querySelector('[role=status]')", 16000);
    body = await text();
    assert.ok(body.includes("101"), "a ready number stays listed after the spotlight ends");

    // 7. No customer identity ever reaches this page: the API shape is numbers and status only.
    assert.ok(state.entries.every(row => Object.keys(row).every(key => ["label", "status", "readyAt", "calledAt"].includes(key))));
    assert.equal(await win.webContents.executeJavaScript("typeof window.bmsDesktop?.getDeviceToken"), "function",
      "the page ran with the real desktop bridge");

    // 8. The explicit per-device mute wins over the default and survives a board reload.
    await win.webContents.executeJavaScript(
      "localStorage.setItem('bms.pos.queueBoardSound.queue-board-smoke', '0')",
    );
    await win.reload();
    await waitFor(win, "document.body.innerText.includes('ปิดเสียงจากการตั้งค่าเครื่อง')");
    assert.ok(!(await text()).includes("แตะเพื่อเปิดเสียง"), "muted boards do not offer a conflicting autoplay recovery action");
    await win.webContents.executeJavaScript(
      "localStorage.removeItem('bms.pos.queueBoardSound.queue-board-smoke')",
    );
    await win.webContents.executeJavaScript(
      "localStorage.removeItem('bms.pos.queueBoardAudio.queue-board-smoke')",
    );

    // 9. A stale/revoked credential never leaks the API error. It stops polling and points the
    //    operator back to the managed display control, which will reopen with the current token.
    token = "STALE-device-token";
    await win.loadURL(origin);
    await waitFor(win, "document.body.innerText.includes('POS → ตั้งค่า → จอภายนอก → จอเรียกคิว')");
    body = await text();
    assert.ok(body.includes("ไม่ต้องคัดลอก URL นี้ไปเปิดใน Chrome"));
    assert.ok(!body.includes("device token ไม่ถูกต้อง"), "raw credential errors are not operator guidance");
    await shot("token-rejected-1440x900");
    assert.deepEqual(errors, []);
    console.log(`Queue board: 6 saved layouts, selectable sound, default-on mute policy, unpaired, 6 viewports, call spotlight + ordering, busy paging, recovery, expiry and rejected-token guidance passed. Screenshots: ${output}`);
  } finally {
    win.destroy();
    await new Promise(done => server.close(done));
  }
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
