// =============================================================
// สแกน QR/บาร์โค้ดจากกล้องมือถือ (โหมดเทส)
// -------------------------------------------------------------
// ใช้ BarcodeDetector ของเบราว์เซอร์เอง ไม่พึ่งไลบรารีถอดรหัสภายนอก —
// รองรับเฉพาะเบราว์เซอร์ที่มี API นี้ (Chrome/Edge/Android Chrome เป็นหลัก
// ณ 2026-08; Safari/iOS ยังไม่รองรับ) เบราว์เซอร์ที่ไม่รองรับต้องกลับไปใช้
// เครื่องสแกนจริงหรือพิมพ์รหัสเอง — ไม่ทำ polyfill เพราะความแม่นยำของ
// ไลบรารีถอดรหัสเองยังไม่เคยถูกทดสอบกับบาร์โค้ดสินค้าจริง
//
// ⚠️ โหมดเทส/เดโม — ยังไม่เคยทดสอบกับกล้องมือถือจริงหรือบาร์โค้ดสินค้าจริง
// ความเร็ว/ความแม่นยำต่ำกว่าเครื่องสแกนเนอร์หน้าร้านจริงมาก ห้ามใช้แทน
// เครื่องสแกนจริงในหน้างานที่ต้องการความเร็ว
// =============================================================

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

export function isCameraScanSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    getBarcodeDetectorCtor() !== null
  );
}

export type CameraScanHandle = {
  stop: () => void;
};

type StartCameraScanOptions = {
  video: HTMLVideoElement;
  /** เจอโค้ดแรกแล้วเรียกครั้งเดียว — ผู้เรียกตัดสินใจเองว่าจะ stop() ต่อหรือไม่ */
  onDetect: (code: string) => void;
  onError: (message: string) => void;
};

/**
 * ขอกล้องหลังของเครื่อง แล้ววนถอดรหัสทุก ~250ms จนกว่าจะเจอโค้ดแรกหรือถูก stop()
 * คืน handle ที่ต้อง stop() เองเสมอ (ปิด modal / unmount) ไม่งั้นกล้องค้างเปิด
 */
export async function startCameraScan({
  video,
  onDetect,
  onError,
}: StartCameraScanOptions): Promise<CameraScanHandle> {
  const noop: CameraScanHandle = { stop: () => {} };
  const Detector = getBarcodeDetectorCtor();

  if (!navigator.mediaDevices?.getUserMedia || !Detector) {
    onError("เบราว์เซอร์นี้ไม่รองรับสแกนด้วยกล้อง — ใช้เครื่องสแกนหรือพิมพ์รหัสแทน");
    return noop;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch {
    onError("ขอสิทธิ์กล้องไม่สำเร็จ — ตรวจสอบการอนุญาตกล้องของเบราว์เซอร์/อุปกรณ์");
    return noop;
  }

  video.srcObject = stream;
  await video.play().catch(() => {
    /* บางเบราว์เซอร์ต้องมีอินเทอร์แอกชันของผู้ใช้ก่อนจึงเล่นได้ — ปล่อยผ่าน ให้ผู้ใช้กดเล่นเอง */
  });

  const detector = new Detector({ formats: ["qr_code", "ean_13", "code_128", "code_39"] });
  let stopped = false;
  let timer: number | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue?.trim();
      if (value) {
        onDetect(value);
        return; // เจอแล้วหยุดวนเอง — ผู้เรียกเป็นคนสั่ง stop() ปิดกล้องต่อ
      }
    } catch {
      /* เฟรมเสียบางครั้งเป็นปกติระหว่างโฟกัสกล้อง — ข้ามไปเฟรมถัดไปเงียบ ๆ */
    }
    if (!stopped) timer = window.setTimeout(tick, 250);
  };
  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
