import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Staff queue manager (`10.111`) in a desktop-sized Electron window: the till strip opens the
 * manager, the keypad finds and calls a number, cancel needs a confirmation, closed numbers are
 * listed, and a failed number can be issued again. A fake device API records every request so the
 * test proves what the buttons actually send.
 */
const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const output = path.resolve(here, "../dist-smoke/queue-manager");
const waitFor = (win, expression, ms = 10000) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const until = Date.now() + ${ms};
  const tick = () => { if (${expression}) resolve(); else if (Date.now() > until) reject(new Error('Timeout: ' + ${JSON.stringify(expression)})); else setTimeout(tick, 40); }; tick();
})`);
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function run() {
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(here, "queue-manager-fixture.tsx")], bundle: true,
    outfile: path.join(output, "manager.js"), platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), nodePaths: [path.join(web, "node_modules")],
    loader: { ".css": "css" }, define: { "process.env.NODE_ENV": '"production"' } });
  const html = '<!doctype html><html lang="th"><meta charset="utf-8"><link rel="stylesheet" href="/manager.css"><style>body{margin:0;font-family:Tahoma,system-ui,sans-serif}</style><body><div id="root"></div><script src="/manager.js"></script></body></html>';
  const js = await readFile(path.join(output, "manager.js"));
  const css = await readFile(path.join(output, "manager.css"));

  const entries = [
    { id: "e41", orderId: "order-041-aaaaaaaa", label: "041", status: "PREPARING", readySource: null, createdAt: iso(6), readyAt: null, calledAt: null, closedAt: null },
    { id: "e42", orderId: "order-042-bbbbbbbb", label: "042", status: "PREPARING", readySource: null, createdAt: iso(4), readyAt: null, calledAt: null, closedAt: null },
    { id: "e39", orderId: "order-039-cccccccc", label: "039", status: "READY", readySource: "KITCHEN", createdAt: iso(12), readyAt: iso(2), calledAt: iso(2), closedAt: null },
    { id: "e35", orderId: "order-035-dddddddd", label: "035", status: "COLLECTED", readySource: "STAFF", createdAt: iso(30), readyAt: iso(20), calledAt: iso(20), closedAt: iso(18) },
    { id: "e36", orderId: "order-036-eeeeeeee", label: "036", status: "CANCELLED", readySource: null, createdAt: iso(28), readyAt: null, calledAt: null, closedAt: iso(25) },
  ];
  const posts = [];
  let getStatus = 200;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (url.pathname === "/manager.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
    if (url.pathname === "/manager.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
    if (url.pathname !== "/api/pos/pickup-queue") { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-pos-device-token"] !== "FAKE-device-token") { res.writeHead(401); res.end("{}"); return; }
    if (req.method === "GET") {
      if (getStatus !== 200) {
        res.writeHead(getStatus);
        res.end(JSON.stringify({ error: "เซิร์ฟเวอร์คิวไม่ตอบ" }));
        return;
      }
      const day = url.searchParams.get("view") === "day";
      const rows = day ? entries : entries.filter(e => e.status === "PREPARING" || e.status === "READY");
      res.end(JSON.stringify({
        entries: rows,
        settings: { voiceMode: "AI_STUDIO", voiceLanguage: "th", voiceRepeat: 1, voiceVolume: 80 },
        serverTime: new Date().toISOString(),
      }));
      return;
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    posts.push(body);
    if (body.action === "issue") { res.end(JSON.stringify({ entry: { id: "e50", label: "050", status: "PREPARING" } })); return; }
    const entry = entries.find(e => e.id === body.entryId);
    if (!entry) { res.writeHead(404); res.end(JSON.stringify({ error: "ไม่พบคิวนี้ในสาขานี้" })); return; }
    if (body.action === "call") Object.assign(entry, { status: "READY", readySource: entry.readySource ?? "STAFF", readyAt: entry.readyAt ?? iso(0), calledAt: iso(0) });
    if (body.action === "collect") Object.assign(entry, { status: "COLLECTED", closedAt: iso(0) });
    if (body.action === "cancel") Object.assign(entry, { status: "CANCELLED", closedAt: iso(0) });
    if (body.action === "unready") Object.assign(entry, { status: "PREPARING", readySource: null, readyAt: null, calledAt: null });
    res.end(JSON.stringify({ entry }));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const win = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const js_ = expression => win.webContents.executeJavaScript(expression);
  const painted = () => js_("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 60))))");
  const shot = async name => { await painted(); await writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const click = text => js_(`(() => {
    const scope = document.querySelector('[data-pickup-queue-manager]') ?? document;
    const button = [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled);
    if (!button) throw new Error('button not found: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const clickInRow = (label, text) => js_(`(() => {
    const row = document.querySelector('[data-pickup-row="${label}"]');
    const button = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw new Error('row button not found: ${label} ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const fits = () => js_(`(() => { const panel = document.querySelector('[data-pickup-queue-manager] > div');
    const r = panel.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, wide: document.documentElement.scrollWidth > innerWidth }; })()`);

  try {
    const origin = `http://127.0.0.1:${server.address().port}`;

    // 1. Restaurant floor: the selected compact mockup keeps the current queue and common
    // actions above the table plan without reproducing the queue-board launch button.
    await win.loadURL(`${origin}/?variant=compact`);
    await waitFor(win, "document.querySelector('[data-pickup-queue-strip][data-variant=\"compact\"]')?.innerText.includes('039')");
    const compact = await js_(`(() => {
      const dashboard = document.querySelector('[data-compact-fixture]');
      const main = document.querySelector('[data-pickup-queue-main]');
      const actions = [...document.querySelectorAll('[data-pickup-queue-actions] button')];
      const rect = dashboard.getBoundingClientRect();
      return {
        text: main.innerText,
        actions: actions.map(button => button.textContent.trim()),
        inside: rect.left >= 0 && rect.right <= innerWidth,
        wide: document.documentElement.scrollWidth > innerWidth,
        height: Math.round(rect.height),
        primary: getComputedStyle(actions.find(button => button.dataset.action === 'collect')).backgroundColor,
        manage: getComputedStyle(actions.find(button => button.dataset.action === 'manage')).backgroundColor,
      };
    })()`);
    assert.match(compact.text, /กำลังเตรียม 2 · พร้อมรับ 1/);
    assert.match(compact.text, /พร้อมรับ\s*039/);
    assert.deepEqual(compact.actions, ["รับแล้ว", "เรียกซ้ำ", "จัดการคิว"]);
    assert.equal(compact.inside, true);
    assert.equal(compact.wide, false);
    assert.ok(compact.height < 120, `compact dashboard must leave height for tables; got ${compact.height}px`);
    assert.notEqual(compact.primary, compact.manage, "manage stays secondary when a queue action is available");
    assert.equal((await js_(`document.body.innerText.includes('เปิดจอเรียกคิว')`)), false,
      "the floor toolbar must not duplicate the board launch button");
    await shot("restaurant-compact-1366");

    win.setContentSize(640, 900);
    await painted();
    const narrow = await js_(`(() => {
      const rect = document.querySelector('[data-compact-fixture]').getBoundingClientRect();
      return { inside: rect.left >= 0 && rect.right <= innerWidth, wide: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert.deepEqual(narrow, { inside: true, wide: false });
    await shot("restaurant-compact-640x900");

    // Reload the retail/default strip so the original manager workflow remains covered too.
    win.setContentSize(1366, 768);
    await win.loadURL(`${origin}/`);
    await js_(`(() => {
      window.__queueChimes = 0;
      window.__queueSpeeches = [];
      const original = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function(...args) {
        window.__queueChimes += 1;
        return original.apply(this, args);
      };
      window.speechSynthesis.speak = utterance => {
        window.__queueSpeeches.push({ text: utterance.text, lang: utterance.lang });
      };
    })()`);
    // 2. The strip is the way in: it shows the counts and a manage button.
    await waitFor(win, "document.querySelector('[data-pickup-queue-strip]')?.innerText.includes('จัดการคิว')");
    await shot("strip-1366");
    await click("จัดการคิว");
    await waitFor(win, "document.querySelector('[data-pickup-row=\"041\"]')");
    assert.deepEqual(await fits(), { inside: true, wide: false });
    const openRows = await js_("[...document.querySelectorAll('[data-pickup-row]')].map(r => r.dataset.pickupRow)");
    assert.deepEqual(openRows, ["039", "041", "042"], "open tab lists preparing and ready numbers in order");
    await shot("manager-open-1366");

    // 2. Keypad: "42" finds 042 and calls it.
    for (const key of ["4", "2"]) await click(key);
    await waitFor(win, "document.querySelector('[data-pickup-queue-manager]').innerText.includes('คิว 042 · กำลังเตรียม')");
    await shot("manager-keypad-1366");
    await click("เรียกคิว");
    try {
      await waitFor(win, "document.querySelector('[data-pickup-queue-manager]').innerText.includes('เรียกคิว 042 แล้ว')");
    } catch (error) {
      console.error("Queue call diagnostic", {
        posts,
        errors,
        text: await js_("document.querySelector('[data-pickup-queue-manager]')?.innerText"),
      });
      throw error;
    }
    assert.deepEqual(posts.at(-1), { action: "call", entryId: "e42", cashierUserId: "FAKE-cashier", cashierPin: "0000" });
    await waitFor(win, "window.__queueSpeeches.length === 1");
    assert.deepEqual(await js_("window.__queueSpeeches[0]"), {
      text: "ขอเชิญคิวหมายเลข ศูนย์ สี่ สอง กรุณารับที่เคาน์เตอร์ค่ะ",
      lang: "th-TH",
    });
    assert.equal(await js_("window.__queueChimes"), 0, "spoken fallback must not also play the failure chime");

    // 3. An unknown number is refused without a request.
    const before = posts.length;
    for (const key of ["9", "9"]) await click(key);
    await click("เรียกคิว");
    await waitFor(win, "document.querySelector('[data-pickup-queue-manager]').innerText.includes('ไม่พบคิว 099')");
    assert.equal(posts.length, before, "an unknown number must not reach the server");
    await click("ล้าง");

    // 4. Cancel needs a second tap; the first tap sends nothing.
    await waitFor(win, "document.querySelector('[data-pickup-row=\"041\"]')");
    await clickInRow("041", "ยกเลิก");
    await waitFor(win, "document.querySelector('[data-pickup-row=\"041\"]').innerText.includes('ยืนยันยกเลิก')");
    assert.equal(posts.length, before, "arming cancel must not send anything");
    await shot("manager-cancel-confirm-1366");
    await clickInRow("041", "ไม่ยกเลิก");
    await waitFor(win, "!document.querySelector('[data-pickup-row=\"041\"]').innerText.includes('ยืนยันยกเลิก')");
    assert.equal(posts.length, before);
    await clickInRow("041", "ยกเลิก");
    await clickInRow("041", "ยืนยันยกเลิก");
    await waitFor(win, "document.querySelector('[data-pickup-queue-manager]').innerText.includes('ยกเลิกคิว 041 แล้ว')");
    assert.deepEqual(posts.at(-1), { action: "cancel", entryId: "e41", cashierUserId: "FAKE-cashier", cashierPin: "0000" });

    // 5. Ready numbers offer recall/undo; closed tab shows what happened.
    await waitFor(win, "document.querySelector('[data-pickup-row=\"039\"]')");
    const readyButtons = await js_("[...document.querySelector('[data-pickup-row=\"039\"]').querySelectorAll('button')].map(b => b.textContent.trim())");
    assert.deepEqual(readyButtons, ["เรียกซ้ำ", "รับแล้ว", "ย้อน", "ยกเลิก"]);
    await click(`ปิดแล้ววันนี้ 3`);
    await waitFor(win, "document.querySelector('[data-pickup-row=\"036\"]') && document.querySelector('[data-pickup-row=\"035\"]')");
    const closedText = await js_("document.querySelector('[data-pickup-row=\"041\"]').innerText");
    assert.ok(closedText.includes("ยกเลิก") && !closedText.includes("เรียกคิว"), "closed numbers show status and no actions");
    await shot("manager-closed-1366");

    // 6. Tablet portrait still fits without sideways scrolling.
    win.setContentSize(768, 1024);
    await click(`ยังไม่ปิด 2`);
    await painted();
    assert.equal((await fits()).wide, false, "manager must not scroll sideways on a tablet");
    await shot("manager-768x1024");
    win.setContentSize(1366, 768);
    await click("ปิด");
    await waitFor(win, "!document.querySelector('[data-pickup-queue-manager]')");

    // 7. Retry: a sale whose number failed asks again for the same bill.
    await js_("document.querySelector('[data-pickup-queue-retry]').click()");
    await waitFor(win, "document.querySelector('[data-issued]')?.innerText.includes('050')");
    assert.deepEqual(posts.at(-1), { action: "issue", orderId: "FAKE-order-retry", cashierUserId: "FAKE-cashier", cashierPin: "0000" });
    await shot("retry-issued-1366");

    // 8. A failed read is not an empty queue. Existing rows become read-only until a verified
    // refresh succeeds, both in the compact strip and in the full manager.
    getStatus = 502;
    await waitFor(win, "document.querySelector('[data-pickup-queue-strip]')?.innerText.includes('ตรวจสถานะล่าสุดไม่ได้')", 8000);
    const staleStrip = await js_(`(() => {
      const strip = document.querySelector('[data-pickup-queue-strip]');
      return {
        text: strip.innerText,
        actionDisabled: [...strip.querySelectorAll('button')]
          .filter(button => ['เรียกคิว', 'เรียกซ้ำ', 'รับแล้ว', 'ย้อน'].includes(button.textContent.trim()))
          .every(button => button.disabled),
      };
    })()`);
    assert.ok(!staleStrip.text.includes("ยังไม่มีคิวที่รออยู่"), "a 502 must not masquerade as an empty queue");
    assert.equal(staleStrip.actionDisabled, true, "stale queue actions must fail closed");
    await click("จัดการคิว");
    await waitFor(win, "document.querySelector('[data-pickup-queue-manager]')?.innerText.includes('รายการว่างนี้ยังยืนยันไม่ได้')");
    assert.equal(await js_(`(() => {
      const manager = document.querySelector('[data-pickup-queue-manager]');
      return [...manager.querySelectorAll('button')]
        .filter(button => ['เรียกคิว', 'รับแล้ว'].includes(button.textContent.trim()))
        .every(button => button.disabled);
    })()`), true, "manager actions must stay disabled while its feed is stale");
    getStatus = 200;
    await click("ลองโหลดคิวใหม่");
    await waitFor(win, "document.querySelector('[data-pickup-row=\"039\"]')");
    await click("ปิด");

    assert.deepEqual(errors, []);
    console.log(`Queue manager: strip entry, keypad lookup/call, unknown-number guard, confirmed cancel, ready actions, closed history, tablet fit, retry and stale-feed guard passed. Screenshots: ${output}`);
  } finally {
    win.destroy();
    await new Promise(done => server.close(done));
  }
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
