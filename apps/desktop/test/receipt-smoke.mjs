import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECEIPT_SNAPSHOT_SCRIPT, RECEIPT_READY_SCRIPT, receiptPrintDocument } from "../src/receipt-printer.mjs";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const output = path.resolve(here, "../dist-smoke");
const waitFor = (window, expression) => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const limit = Date.now() + 10000;
  const tick = () => { if (${expression}) resolve(); else if (Date.now() > limit) reject(new Error('UI timeout')); else setTimeout(tick, 30); }; tick();
})`);
const clickText = (window, text) => window.webContents.executeJavaScript(`(() => {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(text)}));
  if (!button || button.disabled) throw new Error('Button unavailable'); button.click();
})()`);

async function run() {
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(here, "receipt-smoke-fixture.tsx")], bundle: true,
    outfile: path.join(output, "receipt-smoke.js"), platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), nodePaths: [path.join(web, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' } });
  const css = await readFile(path.join(web, "app/(pos)/pos/pos.css"), "utf8");
  const logo = `data:image/png;base64,${(await readFile(path.join(web, "public/icons/playstore-512.png"))).toString("base64")}`;
  await writeFile(path.join(output, "receipt-smoke.html"), `<!doctype html><html><meta charset="utf-8"><style>${css}</style>
    <body style="margin:0;background:white"><div id="root"></div><script>window.testLogo=${JSON.stringify(logo)}</script>
    <script src="receipt-smoke.js"></script></body></html>`);
  const source = new BrowserWindow({ show: false, width: 1100, height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const print = new BrowserWindow({ show: false, width: 380, height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await source.loadFile(path.join(output, "receipt-smoke.html"));
    await waitFor(source, "document.querySelector('#pos-receipt') && document.querySelector('[role=switch]')");
    await source.webContents.executeJavaScript(RECEIPT_READY_SCRIPT);
    await waitFor(source, "!document.querySelector('#receipt-action').disabled");
    await source.webContents.executeJavaScript("[...document.querySelectorAll('.ant-segmented-item')].find(item => item.textContent.includes('58')).click()");
    await waitFor(source, "![...document.querySelectorAll('button')].find(b => b.textContent.includes('บันทึก')).disabled");
    await clickText(source, "บันทึก");
    await waitFor(source, "window.testSaveCount === 1");
    await waitFor(source, "![...document.querySelectorAll('button')].find(b => b.textContent.includes('พิมพ์ทดสอบ')).disabled");
    await clickText(source, "พิมพ์ทดสอบ");
    await waitFor(source, "window.testPrintCount === 1");
    await waitFor(source, "document.querySelector('#receipt-action').disabled");
    await clickText(source, "ไม่ออก / ไม่ถูกต้อง");
    await waitFor(source, "![...document.querySelectorAll('button')].find(b => b.textContent.includes('พิมพ์ทดสอบ')).disabled");
    assert.equal(await source.webContents.executeJavaScript("document.querySelector('#receipt-action').disabled"), true);
    await clickText(source, "พิมพ์ทดสอบ");
    await waitFor(source, "window.testPrintCount === 2");
    await clickText(source, "ออกถูกต้อง");
    await waitFor(source, "!document.querySelector('#receipt-action').disabled");
    await source.webContents.executeJavaScript("window.simulatePrinter({canPrint:false,canTest:false,message:'เครื่องพิมพ์ออฟไลน์ ตรวจสายและเปิดเครื่องพิมพ์'})");
    await waitFor(source, "document.querySelector('#receipt-action').disabled");
    await waitFor(source, "document.body.textContent.includes('เครื่องพิมพ์ออฟไลน์')");
    await source.webContents.executeJavaScript("new Promise(done => setTimeout(done, 300))");
    await writeFile(path.join(output, "printer-offline.png"), (await source.webContents.capturePage()).toPNG());
    assert.equal(await source.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent.includes('พิมพ์ทดสอบ')).disabled"), true);
    await source.webContents.executeJavaScript("window.simulatePrinter({canPrint:true,canTest:true,message:'ระบบไม่พบปัญหาเครื่องพิมพ์'})");
    await source.webContents.executeJavaScript("window.simulatePrinter({canPrint:false,canTest:true,health:'unknown',message:'ระบบไม่รายงานสถานะเครื่องพิมพ์ กรุณาพิมพ์ทดสอบ'})");
    await waitFor(source, "document.querySelector('#receipt-action').disabled");
    assert.equal(await source.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent.includes('พิมพ์ทดสอบ')).disabled"), false);
    await source.webContents.executeJavaScript("window.simulatePrinter({canPrint:false,canTest:false,deviceName:'',available:false,message:'ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ'})");
    await waitFor(source, "document.body.textContent.includes('ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ')");
    assert.equal(await source.webContents.executeJavaScript("document.querySelector('#receipt-action').disabled"), true);
    await source.webContents.executeJavaScript("window.simulatePrinter({canPrint:true,canTest:true,deviceName:'thermal-test',available:true,message:'ระบบไม่พบปัญหาเครื่องพิมพ์'})");
    await source.webContents.executeJavaScript("document.querySelector('[role=switch]').click()");
    await waitFor(source, "document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false'");
    await source.webContents.executeJavaScript("document.querySelector('[role=switch]').click()");
    await waitFor(source, "document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'");
    await waitFor(source, "!document.querySelector('.ant-message-notice')");
    for (const width of [1100, 390]) {
      source.setContentSize(width, 1400);
      await source.webContents.executeJavaScript("new Promise(done => setTimeout(done, 250))");
      assert.equal(await source.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
      for (const checked of [false, true]) {
        await source.webContents.executeJavaScript("document.querySelector('[role=switch]').closest('label').querySelector('span:last-child').click()");
        await waitFor(source, `document.querySelector('[role=switch]').getAttribute('aria-checked') === '${checked}' && !document.querySelector('[role=switch]').disabled`);
        await source.webContents.executeJavaScript("new Promise(done => setTimeout(done, 250))");
        const geometry = await source.webContents.executeJavaScript(`(() => {
          const control = document.querySelector('[role=switch]');
          const track = control.getBoundingClientRect();
          const thumb = control.querySelector('.ant-switch-handle').getBoundingClientRect();
          const style = getComputedStyle(control);
          return { width: track.width, height: track.height, radius: parseFloat(style.borderRadius),
            padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
            targetHeight: control.closest('label').getBoundingClientRect().height,
            thumbWidth: thumb.width, thumbHeight: thumb.height,
            centered: Math.abs(thumb.top + thumb.height / 2 - track.top - track.height / 2) < 1,
            sideGap: control.getAttribute('aria-checked') === 'true' ? track.right - thumb.right : thumb.left - track.left };
        })()`);
        assert.equal(geometry.width, 44);
        assert.equal(geometry.height, 22);
        assert.ok(geometry.radius >= geometry.height / 2);
        assert.equal(geometry.padding, 0);
        assert.ok(geometry.targetHeight >= 44);
        assert.equal(geometry.thumbWidth, 18);
        assert.equal(geometry.thumbHeight, 18);
        assert.equal(geometry.centered, true);
        assert.ok(Math.abs(geometry.sideGap - 2) < 1);
        await source.webContents.executeJavaScript("document.querySelector('[role=switch]').blur()");
        const bounds = await source.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('[role=switch]').closest('section').getBoundingClientRect();
          return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
        })()`);
        await writeFile(path.join(output, `customer-display-toggle-${width}-${checked ? 'on' : 'off'}.png`),
          (await source.webContents.capturePage(bounds)).toPNG());
      }
      await writeFile(path.join(output, `hardware-settings-${width}.png`), (await source.webContents.capturePage()).toPNG());
    }
    const snapshot = await source.webContents.executeJavaScript(RECEIPT_SNAPSHOT_SCRIPT);
    assert.ok(!snapshot.includes("<button"));
    assert.ok(snapshot.includes("FAKE-001"));
    for (const width of [58, 80]) {
      await print.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptPrintDocument(snapshot, width))}`);
      const height = await print.webContents.executeJavaScript(RECEIPT_READY_SCRIPT);
      assert.ok(height > 300 && height < 1200);
      const state = await print.webContents.executeJavaScript(`(() => {
        const receipt = document.querySelector('#pos-receipt');
        const logo = document.querySelector('.pos-receipt-logo');
        const bounds = receipt.getBoundingClientRect();
        const img = logo.getBoundingClientRect();
        return { bridge: !!window.bmsDesktop, image: logo.naturalWidth > 0,
          centered: Math.abs(img.left + img.width / 2 - bounds.left - bounds.width / 2) < 1,
          overflow: receipt.scrollWidth > receipt.clientWidth,
          rowsOverflow: [...document.querySelectorAll('.pos-receipt-row')].some(row => row.scrollWidth > row.clientWidth),
          svgCount: receipt.querySelectorAll('svg').length, text: receipt.textContent };
      })()`);
      assert.equal(state.bridge, false);
      assert.equal(state.image, true);
      assert.equal(state.centered, true);
      assert.equal(state.overflow, false);
      assert.equal(state.rowsOverflow, false);
      assert.equal(state.svgCount, 2);
      assert.ok(state.text.includes("89.00") && state.text.includes("11.00"));
      await writeFile(path.join(output, `receipt-${width}mm.png`), (await print.webContents.capturePage()).toPNG());
      console.log(`Receipt ${width}mm: logo, Thai, totals, QR/barcode and bounds verified`);
    }
    console.log(`Hardware settings desktop/mobile, save, test and display toggle verified. Screenshots: ${output}`);
  } finally { source.destroy(); print.destroy(); }
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
