// =============================================================
// BMS secret encryption (AES-256-GCM)
// -------------------------------------------------------------
// เข้ารหัส token/secret ของแต่ละร้านก่อนเก็บ DB
// key จาก env BMS_SECRET_KEY (hex 64 ตัว = 32 bytes)
// ไม่ตั้ง/ตั้งผิดรูป → dev fallback ใน dev, แต่ production จะ throw (ไม่เข้ารหัสด้วยคีย์ที่อยู่ในซอร์ส)
// ค่าที่ไม่ได้ขึ้นต้นด้วย "enc:" ถือเป็น plaintext (backward compat)
// =============================================================

import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env.BMS_SECRET_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // เดิม fallback เงียบ ๆ ไปคีย์ที่ derive จากสตริงคงที่ในซอร์ส — token ของทุกร้าน
  // ที่ "enc:" ไว้จึงถอดได้ด้วยคีย์ที่ใครอ่านโค้ดก็คำนวณเอง · ค่าที่ตั้งมาผิดรูป
  // (ไม่ใช่ hex 64) ก็เข้าทางนี้ด้วย ซึ่งอันตรายกว่าไม่ตั้งเลยเพราะดูเหมือนตั้งแล้ว
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      hex
        ? "BMS_SECRET_KEY must be 64 hex characters — refusing to fall back to the built-in dev key"
        : "BMS_SECRET_KEY is not configured — refusing to encrypt shop secrets with the built-in dev key"
    );
  }
  return crypto.createHash("sha256").update("bms-dev-secret-key").digest();
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith("enc:")) return stored; // plaintext (เก่า)
  // getKey() ต้องอยู่ **นอก** try — ไม่งั้น production ที่ไม่ได้ตั้ง BMS_SECRET_KEY
  // จะได้ null เงียบ ๆ (token ของร้านดูเหมือน "ไม่มี" แล้วช่องทางตายไปเฉย ๆ)
  // แยกให้ชัด: ตั้งค่าผิด = throw ดัง ๆ · ถอดค่าที่คีย์ไม่ตรงไม่ได้ = null ตามเดิม
  const key = getKey();
  try {
    const [, ivB, tagB, dataB] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** mask สำหรับแสดงใน UI: เก็บ 4 ตัวท้าย */
export function maskSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  if (plain.length <= 4) return "••••";
  return "••••" + plain.slice(-4);
}

/** verify LINE signature: base64(HMAC-SHA256(channelSecret, rawBody)) */
export function verifyLineSignature(channelSecret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const mac = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * verify Meta (Facebook/Instagram) signature: header "sha256=<hex HMAC-SHA256(appSecret, rawBody)>"
 * ใช้กับ X-Hub-Signature-256
 */
export function verifyMetaSignature(appSecret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
