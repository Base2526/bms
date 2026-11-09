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
const output = path.resolve(here, "../dist-smoke/managed-displays");
const waitFor = (win, expression, ms = 10000) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const until = Date.now() + ${ms};
  const tick = () => { if (${expression}) resolve(); else if (Date.now() > until) reject(new Error('Timeout')); else setTimeout(tick, 40); }; tick();
})`);

async function run() {
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(here, "managed-display-fixture.tsx")], bundle: true,
    outfile: path.join(output, "fixture.js"), platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), nodePaths: [path.join(web, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' } });
  const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>:root{--posx-surface:#fff;--posx-line:#d9e2ef;--posx-muted:#667085;--posx-ink2:#475467;--posx-soft:#f2f4f7}body{margin:0;background:#f6f8fb;font-family:system-ui,sans-serif;color:#172033}</style>
    <body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
  const js = await readFile(path.join(output, "fixture.js"));
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
    res.setHeader("Content-Type", "text/html"); res.end(html);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const shot = async (name) => writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadURL(origin);
    await waitFor(win, "document.body.innerText.includes('จอภายนอก') && document.body.innerText.includes('เชื่อมต่อแล้ว · HDMI')");
    const initialBody = await win.webContents.executeJavaScript("document.body.innerText");
    assert.ok(initialBody.includes("จอลูกค้า"));
    assert.ok(initialBody.includes("ออกเลขคิวหลังขายของเครื่องนี้"), "queue issuance remains a distinct setting");
    assert.ok(initialBody.includes("เปิดจอจริงหรือหน้าต่างทดสอบได้จากหัวข้อ"), "managed Desktop points to the single display control");
    assert.equal(initialBody.includes("เปิดจอคิวแบบหน้าต่าง"), false, "managed Desktop hides the duplicate legacy queue-board button");
    assert.ok(initialBody.includes("เปิดทดสอบจอลูกค้าบนจอนี้"), "customer preview names its surface");
    assert.ok(initialBody.includes("เปิดทดสอบจอเรียกคิวบนจอนี้"), "queue preview names its surface");
    await shot("customer-1200x900");
    await win.webContents.executeJavaScript("window.scrollTo(0, document.documentElement.scrollHeight)");
    await new Promise((done) => setTimeout(done, 100));
    await shot("queue-issuance-1200x900");
    await win.webContents.executeJavaScript("window.scrollTo(0, 0)");

    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"เปิดจอเรียกคิวเมื่อเปิด POS\"]').click()");
    await waitFor(win, "[...document.querySelectorAll('strong')].find(e => e.textContent === 'จอเรียกคิว')?.parentElement?.parentElement?.innerText.includes('เชื่อมต่อแล้ว · HDMI')");
    const body = await win.webContents.executeJavaScript("document.body.innerText");
    assert.ok(body.includes("ปิดอยู่"), "the customer role was released before queue took the only external screen");
    assert.ok(body.includes("รูปแบบหน้าจอเรียกคิว"), "owner can choose the queue-board presentation");
    assert.ok(await win.webContents.executeJavaScript(
      "!!document.querySelector('[aria-label=\"เลือกรูปแบบหน้าจอเรียกคิว\"]')",
    ), "queue-board layout selector is accessible");
    assert.ok(await win.webContents.executeJavaScript(
      "!!document.querySelector('[aria-label=\"เลือกเสียงเรียกที่จอคิว\"]')",
    ), "queue-board audio selector is accessible");
    assert.ok(body.includes("AI Studio · ผู้หญิงสุภาพ (แนะนำ)") && body.includes("ทดลองเสียงคิว 001"),
      "queue-board audio defaults to the polite female AI Studio profile and offers a preview action");
    await shot("queue-1200x900");

    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"เปิดจอเรียกคิวเมื่อเปิด POS\"]').click()");
    await waitFor(win, "document.querySelector('[data-display-role=\"queue\"]')?.innerText.includes('ปิดอยู่') && !document.querySelector('[data-display-role=\"queue\"] button')?.disabled");
    await win.webContents.executeJavaScript(
      "[...document.querySelector('[data-display-role=\"customer\"]').querySelectorAll('button')].find((button) => button.textContent?.includes('เปิดทดสอบจอลูกค้าบนจอนี้')).click()",
    );
    await waitFor(win, "document.querySelector('[data-display-role=\"customer\"]')?.innerText.includes('กำลังทดสอบบนจอนี้')");
    await win.webContents.executeJavaScript(
      "[...document.querySelector('[data-display-role=\"queue\"]').querySelectorAll('button')].find((button) => button.textContent?.includes('เปิดทดสอบจอเรียกคิวบนจอนี้')).click()",
    );
    await waitFor(win, "document.querySelector('[data-display-role=\"customer\"]')?.innerText.includes('กำลังทดสอบบนจอนี้') && document.querySelector('[data-display-role=\"queue\"]')?.innerText.includes('กำลังทดสอบบนจอนี้')");
    const closePreviewCount = await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('button')].filter((button) => button.textContent?.includes('ปิดทดสอบจอ')).length",
    );
    assert.equal(closePreviewCount, 2, "customer and queue previews stay open independently");
    await new Promise((done) => setTimeout(done, 100));
    await shot("dual-preview-1200x900");

    win.setContentSize(700, 900);
    await new Promise((done) => setTimeout(done, 100));
    const overflow = await win.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth");
    assert.equal(overflow, false, "external-display settings must not overflow a narrow POS panel");
    await shot("queue-700x900");
    console.log(`Managed displays: role hand-off, simultaneous previews and responsive layout passed. Screenshots: ${output}`);
  } finally {
    win.destroy();
    await new Promise((done) => server.close(done));
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
