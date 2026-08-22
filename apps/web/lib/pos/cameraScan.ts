// =============================================================
// สแกน QR/บาร์โค้ดจากกล้องมือถือ (โหมดเทส)
// -------------------------------------------------------------
// ถอดรหัสสองทาง เลือกตามที่เบราว์เซอร์มี:
//   1. BarcodeDetector ของเบราว์เซอร์เอง — เร็วที่สุด ไม่ต้องโหลดอะไรเพิ่ม
//      แต่มีเฉพาะสาย Chromium (และบนเดสก์ท็อปยังไม่ครบทุก OS)
//   2. @zxing/browser — สำรองสำหรับ Firefox/Safari ที่ไม่มี API ข้อ 1
//
// ข้อ 2 โหลดแบบ dynamic import เท่านั้น เพราะไลบรารีถอดรหัสหนักเกินกว่าจะ
// ยัดเข้า bundle หลักของจอขาย ซึ่งต้องเปิดบนแท็บเล็ตหน้าร้านรุ่นเก่า —
// เครื่องที่มี BarcodeDetector อยู่แล้วจึงไม่ต้องดาวน์โหลดก้อนนี้เลย
//
// ⚠️ โหมดเทส/เดโม — ยังไม่เคยทดสอบกับกล้องมือถือจริงหรือบาร์โค้ดสินค้าจริง
// ความเร็ว/ความแม่นยำต่ำกว่าเครื่องสแกนเนอร์หน้าร้านจริงมาก ห้ามใช้แทน
// เครื่องสแกนจริงในหน้างานที่ต้องการความเร็ว
// =============================================================

const FORMATS = ["qr_code", "ean_13", "ean_8", "code_128", "code_39"] as const;

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

/**
 * รองรับแค่ต้องมีกล้องพอ — การถอดรหัสมีตัวสำรองเสมอ
 * เบราว์เซอร์ที่ไม่มี getUserMedia (หรือหน้าเว็บที่ไม่ใช่ HTTPS) เท่านั้นที่ใช้ไม่ได้
 */
export function isCameraScanSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** true = ต้องโหลดไลบรารีถอดรหัสเพิ่มตอนกดใช้ครั้งแรก (ใช้บอกผู้ใช้ว่ากำลังเตรียมตัวอยู่) */
export function needsDecoderDownload(): boolean {
  return getBarcodeDetectorCtor() === null;
}

export type CameraScanHandle = {
  stop: () => void;
};

/** ตัวถอดรหัสหนึ่งเฟรม — ทั้งสองทางถูกห่อให้หน้าตาเหมือนกัน ผู้เรียกไม่ต้องรู้ว่าใช้ทางไหน */
type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

async function buildDecoder(): Promise<FrameDecoder> {
  const Native = getBarcodeDetectorCtor();
  if (Native) {
    const detector = new Native({ formats: [...FORMATS] });
    return async (video) => {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue?.trim() || null;
    };
  }

  // สำรอง: โหลดเมื่อจำเป็นจริงเท่านั้น
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();
  // zxing อ่านจาก canvas ไม่ใช่ video โดยตรง — วาดเฟรมลง canvas ที่ใช้ซ้ำตัวเดิม
  // (สร้างใหม่ทุกเฟรมจะกิน GC จนภาพกระตุกบนเครื่องเก่า)
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      return reader.decodeFromCanvas(canvas)?.getText()?.trim() || null;
    } catch {
      return null; // ไม่เจอโค้ดในเฟรมนี้ — zxing โยน exception แทนการคืน null
    }
  };
}

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

  if (!navigator.mediaDevices?.getUserMedia) {
    onError("เบราว์เซอร์นี้เปิดกล้องไม่ได้ — ใช้เครื่องสแกนหรือพิมพ์รหัสแทน");
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

  let stopped = false;
  let timer: number | null = null;
  const cleanup = () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  video.srcObject = stream;
  await video.play().catch(() => {
    /* บางเบราว์เซอร์ต้องมีอินเทอร์แอกชันของผู้ใช้ก่อนจึงเล่นได้ — ปล่อยผ่าน ให้ผู้ใช้กดเล่นเอง */
  });

  let decode: FrameDecoder;
  try {
    decode = await buildDecoder();
  } catch {
    cleanup();
    onError("โหลดตัวถอดรหัสไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    return noop;
  }
  // ผู้ใช้ปิด modal ระหว่างรอไลบรารีโหลด — อย่าเพิ่งเริ่มวน
  if (stopped) return noop;

  const tick = async () => {
    if (stopped) return;
    try {
      const value = await decode(video);
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

  return { stop: cleanup };
}
