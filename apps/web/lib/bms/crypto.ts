// =============================================================
// BMS secret encryption (AES-256-GCM)
// -------------------------------------------------------------
// เข้ารหัส token/secret ของแต่ละร้านก่อนเก็บ DB
// key จาก env BMS_SECRET_KEY (hex 64 ตัว = 32 bytes); ถ้าไม่ตั้ง → dev fallback
// ค่าที่ไม่ได้ขึ้นต้นด้วย "enc:" ถือเป็น plaintext (backward compat)
// =============================================================

import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env.BMS_SECRET_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // dev fallback (ไม่ปลอดภัยสำหรับ prod — ตั้ง BMS_SECRET_KEY ด้วย)
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
  try {
    const [, ivB, tagB, dataB] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB, "base64"));
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
