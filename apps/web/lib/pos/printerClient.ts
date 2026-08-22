// =============================================================
// ต่อเครื่องพิมพ์ใบเสร็จจากเบราว์เซอร์ (WebUSB)
// -------------------------------------------------------------
// เครื่องพิมพ์ความร้อนส่วนใหญ่เป็น USB class 7 (Printer) → คุยผ่าน WebUSB ได้
// โดยไม่ต้องลง driver ไม่ต้องมีโปรแกรมกลาง
//
// ข้อจำกัดที่ต้องรู้ก่อนใช้:
//   • Chrome/Edge เท่านั้น — Safari กับ Firefox ไม่มี WebUSB
//   • ต้องเป็น HTTPS (หรือ localhost)
//   • ผู้ใช้ต้องกดเลือกเครื่องเองครั้งแรก (เบราว์เซอร์บังคับ ข้ามไม่ได้)
//     แต่หลังจากนั้นจำได้ ไม่ต้องเลือกซ้ำทุกบิล
//   • macOS/Linux อาจต้องถอน driver ของระบบก่อน เบราว์เซอร์ถึงจะจับได้
//
// เบราว์เซอร์ที่ไม่รองรับ → ใช้ print dialog แบบเดิม (ยังพิมพ์ได้ แค่ไม่ตัด
// กระดาษและไม่เปิดลิ้นชัก)
//
// ⚠️ ยังไม่เคยทดสอบกับเครื่องพิมพ์จริง
// =============================================================

const STORAGE_KEY = "bms.pos.printer";

type UsbDeviceLike = {
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: ArrayBufferView | ArrayBuffer): Promise<{ status: string }>;
  configuration: any;
  configurations: any[];
  opened: boolean;
  productName?: string;
  vendorId: number;
  productId: number;
};

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/** จำรุ่นที่เลือกไว้ เพื่อไม่ต้องให้พนักงานเลือกใหม่ทุกเช้า */
function remember(device: UsbDeviceLike) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ vendorId: device.vendorId, productId: device.productId })
    );
  } catch {
    /* localStorage เต็ม/ปิด — ไม่ใช่เรื่องที่ควรทำให้พิมพ์ไม่ได้ */
  }
}

/** หาเครื่องที่เคยอนุญาตไว้แล้ว — เรียกได้เงียบ ๆ ไม่เด้ง popup */
export async function findRememberedPrinter(): Promise<UsbDeviceLike | null> {
  if (!isWebUsbSupported()) return null;
  try {
    const devices: UsbDeviceLike[] = await (navigator as any).usb.getDevices();
    if (devices.length === 0) return null;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { vendorId, productId } = JSON.parse(saved);
      const match = devices.find((d) => d.vendorId === vendorId && d.productId === productId);
      if (match) return match;
    }
    return devices[0];
  } catch {
    return null;
  }
}

/**
 * ให้ผู้ใช้เลือกเครื่องพิมพ์ — ต้องเรียกจากการกดปุ่มเท่านั้น
 * (เบราว์เซอร์ปฏิเสธถ้าไม่ได้มาจาก user gesture)
 * filter class 7 = Printer เพื่อไม่ให้รายชื่อเต็มไปด้วยเมาส์กับคีย์บอร์ด
 */
export async function requestPrinter(): Promise<UsbDeviceLike | null> {
  if (!isWebUsbSupported()) throw new Error("เบราว์เซอร์นี้ไม่รองรับ WebUSB — ใช้ Chrome หรือ Edge");
  const device: UsbDeviceLike = await (navigator as any).usb.requestDevice({
    filters: [{ classCode: 7 }],
  });
  if (device) remember(device);
  return device ?? null;
}

/** หา endpoint ขาออกตัวแรกของ interface ที่เป็นเครื่องพิมพ์ */
function findOutEndpoint(device: UsbDeviceLike): { interfaceNumber: number; endpoint: number } | null {
  for (const cfg of device.configurations ?? []) {
    for (const iface of cfg.interfaces ?? []) {
      for (const alt of iface.alternates ?? []) {
        if (alt.interfaceClass !== 7) continue;
        const out = (alt.endpoints ?? []).find((e: any) => e.direction === "out");
        if (out) return { interfaceNumber: iface.interfaceNumber, endpoint: out.endpointNumber };
      }
    }
  }
  return null;
}

/**
 * ส่งไบต์ ESC/POS ไปที่เครื่อง
 * ปิด device ทุกครั้งหลังส่ง — เปิดค้างแล้วแท็บอื่น/โปรแกรมอื่นจะแย่งไม่ได้
 */
export async function sendToPrinter(bytes: Uint8Array, device?: UsbDeviceLike | null): Promise<void> {
  const target = device ?? (await findRememberedPrinter());
  if (!target) throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์ — กด “ตั้งค่าเครื่องพิมพ์” ก่อน");

  const opened = target.opened;
  if (!opened) await target.open();
  try {
    if (!target.configuration) await target.selectConfiguration(1);
    const ep = findOutEndpoint(target);
    if (!ep) throw new Error("เครื่องนี้ไม่มีช่องรับข้อมูลแบบเครื่องพิมพ์ (USB class 7)");
    await target.claimInterface(ep.interfaceNumber);
    // คัดลอกลง ArrayBuffer ใหม่ — Uint8Array อาจอิง SharedArrayBuffer ซึ่ง
    // WebUSB ไม่รับ และ TS ก็แยกสองชนิดนี้ออกจากกัน
    const buf = new Uint8Array(bytes.length);
    buf.set(bytes);
    const res = await target.transferOut(ep.endpoint, buf);
    if (res.status !== "ok") throw new Error(`ส่งข้อมูลไม่สำเร็จ (${res.status})`);
  } finally {
    if (!opened) await target.close().catch(() => {});
  }
}
