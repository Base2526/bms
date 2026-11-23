import type { Readable } from "node:stream";
import sharp from "sharp";

export const WORK_ASSISTANT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const ACCEPTED_IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export type WorkAssistantImage = {
  mediaType: "image/png";
  data: string;
};

export type WorkAssistantUpload = {
  mimeType?: string;
  mimetype?: string;
  createReadStream: () => Readable;
};

const IMAGE_ERRORS = {
  unconfirmed: ["วิเคราะห์ได้เฉพาะภาพหน้าจอ BMS กรุณายืนยันว่าภาพนี้มาจาก BMS ก่อนส่ง", "Only BMS screenshots can be analyzed. Confirm that this image is from BMS before sending."],
  unsupported: ["รองรับเฉพาะภาพ PNG, JPEG หรือ WebP", "Only PNG, JPEG, and WebP images are supported."],
  read: ["อ่านภาพที่แนบไม่ได้ กรุณาเลือกใหม่", "Could not read the attached image. Please choose it again."],
  large: ["ภาพใหญ่เกิน 10 MB", "The image exceeds 10 MB."],
  empty: ["ภาพว่างเปล่า กรุณาเลือกใหม่", "The image is empty. Please choose another."],
  invalid: ["ไฟล์นี้ไม่ใช่ภาพ PNG, JPEG หรือ WebP ที่รองรับ", "The file is not a supported PNG, JPEG, or WebP image."],
  detailed: ["ภาพมีรายละเอียดมากเกินไป กรุณาครอปภาพแล้วลองใหม่", "The image is too detailed. Crop it and try again."],
  decode: ["เปิดภาพนี้ไม่ได้ กรุณาใช้ภาพ PNG, JPEG หรือ WebP", "Could not open this image. Please use PNG, JPEG, or WebP."],
} as const;

export class WorkAssistantImageError extends Error {
  constructor(readonly code: keyof typeof IMAGE_ERRORS) { super(IMAGE_ERRORS[code][0]); }
  localized(locale: "th" | "en") { return IMAGE_ERRORS[this.code][locale === "en" ? 1 : 0]; }
}

/** A file has no trustworthy source metadata; require an explicit staff declaration before AI usage. */
export function requireBmsScreenshotConfirmation(confirmed: unknown): void {
  if (confirmed !== true) throw new WorkAssistantImageError("unconfirmed");
}

/** Read one transient GraphQL Upload; never register it in files or an audit payload. */
export async function readWorkAssistantImage(
  pendingUpload: Promise<WorkAssistantUpload> | WorkAssistantUpload,
): Promise<WorkAssistantImage> {
  let upload: WorkAssistantUpload;
  try { upload = await pendingUpload; }
  catch { throw new WorkAssistantImageError("read"); }
  const expectedFormat = ACCEPTED_IMAGE_TYPES[upload?.mimeType ?? upload?.mimetype ?? ""];
  if (!expectedFormat || typeof upload?.createReadStream !== "function") {
    throw new WorkAssistantImageError("unsupported");
  }

  let stream: Readable;
  try {
    stream = upload.createReadStream();
  } catch {
    throw new WorkAssistantImageError("read");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > WORK_ASSISTANT_IMAGE_MAX_BYTES) {
        stream.destroy();
        throw new WorkAssistantImageError("large");
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof WorkAssistantImageError) throw error;
    throw new WorkAssistantImageError("read");
  }
  if (size === 0) throw new WorkAssistantImageError("empty");

  try {
    const bytes = Buffer.concat(chunks, size);
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat || (metadata.pages ?? 1) !== 1) {
      throw new WorkAssistantImageError("invalid");
    }
    // Re-encoding strips metadata and bounds both provider payload size and image dimensions.
    const normalized = await image.rotate().resize({
      width: 2560,
      height: 2560,
      fit: "inside",
      withoutEnlargement: true,
    }).png({ compressionLevel: 9 }).toBuffer();
    if (normalized.length > MAX_PROVIDER_IMAGE_BYTES) {
      throw new WorkAssistantImageError("detailed");
    }
    return { mediaType: "image/png", data: normalized.toString("base64") };
  } catch (error) {
    if (error instanceof WorkAssistantImageError) throw error;
    throw new WorkAssistantImageError("decode");
  }
}
