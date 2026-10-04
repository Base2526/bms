import { readFileSync } from "node:fs";
import { printerHealth } from "./printer-health.mjs";

export const DEFAULT_PRINTER_CONFIG = Object.freeze({ version: 1, deviceName: "", paperWidth: 80, tested: false });

let bundledFontCss;
function receiptFonts() {
  // Print windows cannot use next/font's stylesheet or rely on Thai fonts being installed.
  bundledFontCss ??= [400, 700].map(weight => {
    const bytes = readFileSync(new URL(`../renderer/fonts/ibm-plex-sans-thai-thai-${weight}-normal.woff2`, import.meta.url));
    return `@font-face { font-family: "BMS Receipt Thai"; font-weight: ${weight};
      src: url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");
      unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }`;
  }).join("\n");
  return bundledFontCss;
}

export function isReceiptPrinterCaller(event, mainWindow, serverUrl) {
  if (!serverUrl || !mainWindow || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.origin === serverUrl && ["/pos", "/pos/app", "/pos/restaurant"].includes(url.pathname);
  } catch { return false; }
}

export function normalizePrinterConfig(value) {
  return {
    version: 1,
    deviceName: typeof value?.deviceName === "string" ? value.deviceName.trim().slice(0, 256) : "",
    paperWidth: value?.paperWidth === 58 ? 58 : 80,
    tested: value?.tested === true,
  };
}

export function receiptPrintOptions(config, printers, heightPx) {
  if (!config.deviceName) throw new Error("กรุณาเลือกเครื่องพิมพ์ที่ ตั้งค่า > เครื่องพิมพ์ใบเสร็จ");
  if (!printers.some((printer) => printer.name === config.deviceName)) {
    throw new Error("ไม่พบเครื่องพิมพ์ที่บันทึกไว้ กรุณาตรวจการเชื่อมต่อหรือตั้งค่าเครื่องพิมพ์ใหม่");
  }
  const health = printerHealth(printers.find(printer => printer.name === config.deviceName));
  if (health.status === "blocked") throw new Error(health.message);
  if (!Number.isFinite(heightPx) || heightPx <= 0 || heightPx > 100_000) {
    throw new Error("ไม่สามารถจัดหน้าใบเสร็จได้");
  }
  return {
    silent: true, deviceName: config.deviceName, printBackground: true,
    color: false, copies: 1, landscape: false, scaleFactor: 100,
    margins: { marginType: "none" },
    pageSize: { width: config.paperWidth * 1000, height: Math.max(50_000, Math.ceil(heightPx * 25400 / 96)) },
  };
}

// Capture only the receipt already rendered from the server-confirmed payload. IPC accepts
// neither arbitrary HTML nor URLs. The isolated print window never receives a preload/token.
export const RECEIPT_SNAPSHOT_SCRIPT = `(() => {
  const source = document.getElementById('pos-receipt');
  if (!source || !source.textContent.trim()) throw new Error('ไม่พบใบเสร็จสำหรับพิมพ์');
  const copy = source.cloneNode(true);
  const originals = [source, ...source.querySelectorAll('*')];
  const clones = [copy, ...copy.querySelectorAll('*')];
  const properties = ['display', 'font-family', 'font-size', 'font-weight', 'line-height',
    'text-align', 'white-space', 'word-break', 'overflow-wrap', 'margin-top', 'margin-bottom',
    'gap', 'align-items', 'justify-content', 'flex', 'border-top', 'object-fit'];
  originals.forEach((node, index) => {
    const clone = clones[index];
    const computed = getComputedStyle(node);
    properties.forEach(key => clone.style.setProperty(key, computed.getPropertyValue(key)));
    for (const attr of [...clone.attributes]) {
      if (attr.name.startsWith('on')) clone.removeAttribute(attr.name);
    }
    if (node instanceof HTMLImageElement) clone.setAttribute('src', node.currentSrc || node.src);
  });
  copy.querySelectorAll('script,iframe,object,embed,link,style,form,input,button,video,audio').forEach(node => node.remove());
  return copy.outerHTML;
})()`;

export function receiptPrintDocument(receiptHtml, paperWidth) {
  const width = paperWidth === 58 ? 58 : 80;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'">
    <style>
      ${receiptFonts()}
      @page { margin: 0; }
      * { box-sizing: border-box; color: #000 !important; }
      #pos-receipt, #pos-receipt * { font-family: "BMS Receipt Thai", monospace !important; }
      html, body { margin: 0; padding: 0; width: ${width}mm; background: #fff; }
      body { padding: 3mm 4mm; }
      #pos-receipt { width: 100% !important; max-width: none !important; height: auto !important;
        max-height: none !important; overflow: visible !important; padding: 0 !important;
        margin: 0 !important; border: 0 !important; background: #fff !important; }
      .pos-receipt-logo { display: block; width: 96px; height: 72px; max-width: 100%;
        object-fit: contain; margin: 0 auto 12px !important; }
      .pos-receipt-row { break-inside: avoid; }
      svg { max-width: 100%; }
    </style></head><body>${receiptHtml}</body></html>`;
}

export const RECEIPT_READY_SCRIPT = `(async () => {
  await document.fonts.ready;
  try { await Promise.all([...document.images].map(image => image.decode())); }
  catch { throw new Error('โหลดรูปบนใบเสร็จไม่สำเร็จ กรุณาตรวจโลโก้ร้านแล้วลองใหม่'); }
  return Math.ceil(document.body.getBoundingClientRect().height);
})()`;

export const TEST_RECEIPT_HTML = `<div id="pos-receipt" style="font-family:monospace;font-size:12px;text-align:center;line-height:1.6">
  <b>BMS POS</b><div>ทดสอบเครื่องพิมพ์ / Print test</div><hr>
  <div>ภาษาไทย · English · 0123456789</div><div>ยอดทดสอบ 123.45</div><hr>
  <div>เอกสารทดสอบ ไม่ใช่ใบเสร็จรับเงิน</div></div>`;

export function createReceiptPrinter({ createWindow, getPrinters, getConfig, timeoutMs = 30_000 }) {
  let busy = false;
  return async function printReceipt(source, testPage = false, authorized = () => true) {
    if (busy) return { ok: false, error: "กำลังส่งใบเสร็จไปเครื่องพิมพ์ กรุณารอสักครู่" };
    busy = true;
    let printWindow;
    let timer;
    let cancelled = false;
    const check = () => {
      if (cancelled || !authorized()) throw new Error("หน้าขายเปลี่ยนแล้ว กรุณาเปิดใบเสร็จและลองใหม่");
    };
    try {
      const job = (async () => {
        check();
        const config = getConfig();
        const html = testPage ? TEST_RECEIPT_HTML : await source.executeJavaScript(RECEIPT_SNAPSHOT_SCRIPT);
        if (typeof html !== "string" || html.length > 2_000_000) throw new Error("ใบเสร็จมีขนาดใหญ่เกินไป");
        const printers = await getPrinters();
        check();
        receiptPrintOptions(config, printers, 1);
        printWindow = createWindow();
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptPrintDocument(html, config.paperWidth))}`);
        check();
        const height = await printWindow.webContents.executeJavaScript(RECEIPT_READY_SCRIPT);
        const options = receiptPrintOptions(config, await getPrinters(), height);
        check();
        await new Promise((resolve, reject) => {
          printWindow.webContents.print(options, (ok) => ok ? resolve() : reject(new Error("ส่งใบเสร็จไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์และคิวพิมพ์")));
        });
      })();
      await Promise.race([job, new Promise((_, reject) => {
        timer = setTimeout(() => {
          cancelled = true;
          reject(new Error("เครื่องพิมพ์ไม่ตอบกลับ กรุณาตรวจคิวพิมพ์ก่อนพิมพ์ซ้ำ"));
        }, timeoutMs);
      })]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || "พิมพ์ใบเสร็จไม่สำเร็จ" };
    } finally {
      clearTimeout(timer);
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
      busy = false;
    }
  };
}
