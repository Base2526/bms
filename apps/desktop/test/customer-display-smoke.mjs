import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const output = path.resolve(here, "../dist-smoke/customer-display");
const waitFor = (win, expression) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const until = Date.now() + 15000;
  const tick = () => { if (${expression}) resolve(); else if (Date.now() > until) reject(new Error('Timeout: ' + ${JSON.stringify(expression)})); else setTimeout(tick, 40); }; tick();
})`);

async function run() {
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(here, "customer-display-fixture.tsx")], bundle: true,
    outfile: path.join(output, "display.js"), platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), nodePaths: [path.join(web, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' } });
  const assets = {
    "/": ["text/html", Buffer.from('<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/display.css"><style>body{margin:0;font-family:Tahoma,system-ui,sans-serif}</style><body><div id="root"></div><script src="/display.js"></script></body></html>')],
    "/display.js": ["text/javascript", await readFile(path.join(output, "display.js"))],
    "/display.css": ["text/css", await readFile(path.join(output, "display.css"))],
    "/logo.png": ["image/png", await readFile(path.join(web, "public/icons/playstore-512.png"))],
  };
  const server = createServer((req, res) => { const asset = assets[req.url]; if (!asset) { res.writeHead(404); res.end(); return; } res.setHeader("Content-Type", asset[0]); res.end(asset[1]); });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await waitFor(win, "document.body.textContent.includes('FAKE Shop B')");
    for (const [width, height] of [[1440, 900], [1024, 768], [1024, 600], [390, 844]]) {
      win.setContentSize(width, height);
      for (const phase of ["idle", "cart", "payment", "finished"]) {
        await win.webContents.executeJavaScript(`window.displayFixture(${JSON.stringify(phase)})`);
        await waitFor(win, `document.querySelector('[data-phase="${phase}"]')`);
        await waitFor(win, "[...document.images].every(i => i.complete && i.naturalWidth > 0)");
        if (["payment", "finished"].includes(phase)) await waitFor(win, "document.querySelector('img[alt^=QR]')");
        const bounds = await win.webContents.executeJavaScript(`({ overflow: document.documentElement.scrollWidth > innerWidth, tall: document.documentElement.scrollHeight > innerHeight + 2, text: document.body.textContent, bridge: !!window.bmsDesktop })`);
        await writeFile(path.join(output, `${phase}-${width}-${height}.png`), (await win.webContents.capturePage()).toPNG());
        assert.equal(bounds.overflow, false, `${phase} ${width}: horizontal overflow`);
        if (width >= 1024) assert.equal(bounds.tall, false, `${phase} ${width}: vertical overflow`);
        assert.equal(bounds.bridge, false);
        assert.ok(!bounds.text.includes("PrivateSurname"));
        if (phase === "payment") assert.ok(bounds.text.includes("68.00") && bounds.text.includes("168.00"));
        if (phase === "finished") assert.ok(bounds.text.includes("32.00") && bounds.text.includes("123"));
      }
    }
    win.setContentSize(1024, 768);
    await win.webContents.executeJavaScript("window.displayFixture('long')");
    await waitFor(win, "document.body.textContent.includes('และอีก 4 รายการ')");
    await writeFile(path.join(output, "long-1024.png"), (await win.webContents.capturePage()).toPNG());
    assert.equal(await win.webContents.executeJavaScript("document.documentElement.scrollHeight > innerHeight + 2"), false, "recent rows fit POS monitor");
    await win.webContents.executeJavaScript("window.displayFixture('pending')");
    await waitFor(win, "document.body.textContent.includes('กรุณารอพนักงานยืนยันยอดชำระ')");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('img[alt=\"QR ชำระเงิน\"]')"), false);
    await win.webContents.executeJavaScript("window.displayFixture('repricing')");
    await waitFor(win, "document.body.textContent.includes('กรุณารอพนักงานยืนยันยอดชำระ')");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('img[alt=\"QR ชำระเงิน\"]') || document.body.textContent.includes('168.00')"), false);
    await win.webContents.executeJavaScript("window.displayFixture('cash')");
    await waitFor(win, "document.body.textContent.includes('ชำระเงินกับพนักงาน')");
    await win.webContents.executeJavaScript("window.displayFixture('finished')");
    await waitFor(win, "document.querySelector('[data-phase=finished]')");
    await waitFor(win, "document.querySelector('[data-phase=idle]')");
    await win.webContents.executeJavaScript("window.displayFixture('cart')");
    await waitFor(win, "document.querySelector('[data-phase=cart]')");
    await win.webContents.executeJavaScript("window.stopDisplayFixture()");
    await waitFor(win, "document.querySelector('[data-phase=idle]') && document.body.textContent.includes('กรุณารอสักครู่')");
    await win.webContents.executeJavaScript("window.displayFixture('cart')");
    await waitFor(win, "document.querySelector('[data-phase=cart]')");
    if (process.env.POS_DISPLAY_URL) {
      await win.loadURL(process.env.POS_DISPLAY_URL);
      win.setContentSize(1440, 900);
      await win.webContents.executeJavaScript(`(() => {
        const ch = new BroadcastChannel('bms-pos-display');
        const data = { brand: { name: 'FAKE Shop B', branch: 'สาขาทดสอบ', logoUrl: location.origin + '/icons/playstore-512.png' },
          lines: [{ name: 'ข้าวเหนียวมะม่วง', size: 'สูตรพิเศษ', qty: 2, unitName: 'ชุด', amount: 178 }],
          itemCount: 2, total: 178, amountDue: 178, discountTotal: 0, memberName: null, pointsEarned: null, paymentQr: null, finished: null };
        ch.onmessage = event => { if (event.data?.type === 'hello') ch.postMessage(data); };
        ch.postMessage(data);
      })()`);
      await waitFor(win, "document.querySelector('[data-phase=cart]') && [...document.images].every(i => i.complete && i.naturalWidth > 0)");
      assert.equal(await win.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 2"), false);
      await writeFile(path.join(output, "live-next-cart.png"), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log(`Customer display: 4 phases x 4 viewports, logos, QR, privacy, split tender, pricing/approval guards, expiry and reconnect passed. Screenshots: ${output}`);
  } finally { win.destroy(); await new Promise(done => server.close(done)); }
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
