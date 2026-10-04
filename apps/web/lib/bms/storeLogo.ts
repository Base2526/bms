import sharp from "sharp";

/** Decode before publishing: a claimed image MIME is not evidence of a usable logo. */
export async function prepareStoreLogo(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("ไฟล์โลโก้ไม่ถูกต้อง");
  const image = sharp(bytes, { limitInputPixels: 20_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)
    || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
    throw new Error("โลโก้ต้องเป็นรูป PNG, JPG หรือ WebP แบบภาพนิ่ง");
  }
  return image.rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
}
