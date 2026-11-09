import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RECEIPT_READY_SCRIPT, receiptPrintOptions } from "./receipt-printer.mjs";

export const DEFAULT_KITCHEN_PRINTER_CONFIG = Object.freeze({ version: 1, routes: [] });

const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const routeKey = (stationId, stationName) => stationId ? `id:${stationId}` : stationName ? `name:${stationName}` : "";

export function normalizeKitchenPrinterConfig(value) {
  const routes = Array.isArray(value?.routes) ? value.routes : [];
  return {
    version: 1,
    routes: routes.slice(0, 32).map((route) => ({
      stationKey: clean(route?.stationKey, 300),
      stationName: clean(route?.stationName, 160),
      deviceName: clean(route?.deviceName, 256),
      paperWidth: route?.paperWidth === 58 ? 58 : 80,
      autoPrint: route?.autoPrint === true,
    })).filter((route) => /^(?:id|name):\S/.test(route.stationKey) && route.deviceName),
  };
}

export function normalizeKitchenPrintJob(value) {
  const jobId = clean(value?.jobId, 4_000);
  const stationId = clean(value?.stationId, 120);
  const stationName = clean(value?.stationName, 160);
  const label = clean(value?.label, 160);
  const items = Array.isArray(value?.items) ? value.items.slice(0, 80).map((item) => ({
    name: clean(item?.name, 200),
    size: clean(item?.size, 80),
    qty: Math.min(999, Math.max(0, Number(item?.qty) || 0)),
    modifiers: Array.isArray(item?.modifiers) ? item.modifiers.map((entry) => clean(entry, 80)).filter(Boolean).slice(0, 20) : [],
    note: clean(item?.note, 300),
  })).filter((item) => item.name && item.qty > 0) : [];
  if (!jobId || !routeKey(stationId, stationName) || !label || items.length === 0) {
    throw new Error("ข้อมูลใบงานครัวไม่ครบ");
  }
  return {
    jobId,
    stationId: stationId || null,
    stationName: stationName || null,
    stationKey: routeKey(stationId, stationName),
    label,
    roundNo: Number.isInteger(value?.roundNo) && value.roundNo > 0 ? value.roundNo : null,
    createdAt: clean(value?.createdAt, 80),
    items,
  };
}

export function kitchenJobKey(job) {
  return createHash("sha256").update(job.jobId).digest("hex");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

let bundledFontCss;
function fonts() {
  bundledFontCss ??= [400, 700].map((weight) => {
    const bytes = readFileSync(new URL(`../renderer/fonts/ibm-plex-sans-thai-thai-${weight}-normal.woff2`, import.meta.url));
    return `@font-face{font-family:"BMS Kitchen Thai";font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}`;
  }).join("\n");
  return bundledFontCss;
}

export function kitchenPrintDocument(job, paperWidth) {
  const width = paperWidth === 58 ? 58 : 80;
  const items = job.items.map((item) => `<section class="item"><div><b>${escapeHtml(item.qty)}×</b><strong>${escapeHtml(item.name)}</strong>${item.size ? `<span>${escapeHtml(item.size)}</span>` : ""}</div>${item.modifiers.length ? `<small>${item.modifiers.map(escapeHtml).join(" · ")}</small>` : ""}${item.note ? `<em>${escapeHtml(item.note)}</em>` : ""}</section>`).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';font-src data:;style-src 'unsafe-inline';script-src 'none'"><style>${fonts()}@page{margin:0}*{box-sizing:border-box}html,body{margin:0;width:${width}mm;background:#fff;color:#000;font-family:"BMS Kitchen Thai",sans-serif}body{padding:3mm 4mm}header{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:2mm}h1{font-size:26px;margin:0;line-height:1.1}header p{font-size:15px;margin:1mm 0 0}.station{font-size:17px}.item{padding:2.5mm 0;border-bottom:1px dashed #000;break-inside:avoid}.item div{display:grid;grid-template-columns:10mm 1fr auto;gap:2mm;font-size:18px}.item b{font-size:22px}.item strong{overflow-wrap:anywhere}.item span{font-size:13px}.item small,.item em{display:block;margin-left:12mm;font-size:14px;overflow-wrap:anywhere}.item em{font-style:normal;font-weight:700;border:1px solid #000;padding:1mm;margin-top:1mm}footer{text-align:center;margin-top:3mm;font-size:11px}</style></head><body><header><div class="station">${escapeHtml(job.stationName || "ไม่ระบุสถานี")}</div><h1>${escapeHtml(job.label)}</h1>${job.roundNo ? `<p>รอบ ${escapeHtml(job.roundNo)}</p>` : ""}</header>${items}<footer>${escapeHtml(job.createdAt || "")}</footer></body></html>`;
}

export function createKitchenPrinter({ createWindow, getPrinters, getConfig, getJournal, setJournal, timeoutMs = 30_000 }) {
  let busy = false;
  return async function printKitchenTicket(input, options = {}) {
    if (busy) return { ok: false, retrySafe: true, error: "กำลังส่งใบงานไปเครื่องพิมพ์" };
    let job;
    try { job = normalizeKitchenPrintJob(input); }
    catch (error) { return { ok: false, retrySafe: true, error: error.message }; }
    const route = getConfig().routes.find((entry) => entry.stationKey === job.stationKey);
    if (!route) return { ok: false, retrySafe: true, error: `ยังไม่ได้ตั้งค่าเครื่องพิมพ์สถานี ${job.stationName || job.stationId}` };
    if (options.auto === true && !route.autoPrint) return { ok: true, skipped: true };
    const key = kitchenJobKey(job);
    const prior = getJournal()[key];
    if (prior?.status === "PRINTED") return { ok: true, duplicate: true };
    if (["UNCERTAIN", "PRINTING"].includes(prior?.status) && options.retry !== true) {
      return { ok: false, uncertain: true, retrySafe: false, error: "ผลการพิมพ์ครั้งก่อนไม่แน่ชัด กรุณาตรวจถาดก่อนกดพิมพ์ซ้ำ" };
    }
    busy = true;
    let printWindow;
    let timer;
    try {
      const printers = await getPrinters();
      receiptPrintOptions(route, printers, 1);
      await setJournal(key, { status: "PRINTING", at: new Date().toISOString(), stationKey: job.stationKey });
      printWindow = createWindow();
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(kitchenPrintDocument(job, route.paperWidth))}`);
      const height = await printWindow.webContents.executeJavaScript(RECEIPT_READY_SCRIPT);
      const currentPrinters = await getPrinters();
      const print = new Promise((resolve, reject) => printWindow.webContents.print(
        receiptPrintOptions(route, currentPrinters, height),
        (ok) => ok ? resolve() : reject(new Error("ส่งใบงานไม่สำเร็จ")),
      ));
      await Promise.race([print, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("เครื่องพิมพ์ไม่ตอบกลับ")), timeoutMs); })]);
      await setJournal(key, { status: "PRINTED", at: new Date().toISOString(), stationKey: job.stationKey });
      return { ok: true };
    } catch (error) {
      await setJournal(key, { status: "UNCERTAIN", at: new Date().toISOString(), stationKey: job.stationKey });
      return { ok: false, uncertain: true, retrySafe: false, error: `${error?.message || "พิมพ์ใบงานไม่สำเร็จ"} · กรุณาตรวจถาดก่อนพิมพ์ซ้ำ` };
    } finally {
      clearTimeout(timer);
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
      busy = false;
    }
  };
}
