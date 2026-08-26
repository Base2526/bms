// =============================================================
// ย้ายความลับที่เข้ารหัสด้วย "คีย์ dev" ไปเป็นคีย์จริง (BMS_SECRET_KEY)
// -------------------------------------------------------------
// ใช้เมื่อ: production เคยรันโดยไม่ได้ตั้ง BMS_SECRET_KEY ทำให้ค่าที่ขึ้นต้นด้วย
// "enc:" ถูกเข้ารหัสด้วยคีย์ที่ derive จากสตริงในซอร์ส (sha256("bms-dev-secret-key"))
// พอตั้งคีย์จริงแล้ว ค่าเดิมถอดไม่ออก → decryptSecret() คืน null → ช่องทางของร้าน
// ดูเหมือน "ไม่มี token" แล้วตายเงียบ ๆ
//
// ค่าที่ไม่ได้ขึ้นต้นด้วย "enc:" เป็น plaintext เดิม ไม่ถูกแตะ (decryptSecret คืนตรง ๆ อยู่แล้ว)
//
// ---- วิธีใช้ ----
// 1) ดูก่อนว่าจะแตะอะไร (ไม่เขียนอะไรเลย):
//      BMS_SECRET_KEY=<คีย์จริง> npx tsx scripts/rotate-bms-secret-key.mts
// 2) เขียนจริง:
//      BMS_SECRET_KEY=<คีย์จริง> npx tsx scripts/rotate-bms-secret-key.mts --apply
//
// **สำรองฐานข้อมูลก่อนรันด้วย --apply**
//      pg_dump ... -t bms_tenant_channels -t bms_tenant_ai_config > backup.sql
//
// ปลอดภัยที่จะรันซ้ำ: แถวที่ถอดด้วยคีย์ dev ไม่ได้แล้ว (แปลว่าย้ายไปแล้ว) จะถูกข้าม
// =============================================================

import crypto from "crypto";
// ใช้ connection pool ตัวเดียวกับแอป (อ่าน env ชุดเดียวกัน) ไม่ตั้ง Pool ซ้ำ
import { query } from "../apps/web/lib/db.ts";

const APPLY = process.argv.includes("--apply");

const newHex = process.env.BMS_SECRET_KEY ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(newHex)) {
  console.error("ต้องตั้ง BMS_SECRET_KEY เป็น hex 64 ตัว (คีย์จริงที่จะใช้ต่อไป)");
  process.exit(1);
}
const NEW_KEY = Buffer.from(newHex, "hex");
// คีย์ dev เดิม — ตรงกับ getKey() ใน lib/bms/crypto.ts ก่อนการแก้
const DEV_KEY = crypto.createHash("sha256").update("bms-dev-secret-key").digest();

const decrypt = (stored: string, key: Buffer): string | null => {
  try {
    const [, ivB, tagB, dataB] = stored.split(":");
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    d.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
};
const encrypt = (plain: string, key: Buffer): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const e = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${e.toString("base64")}`;
};

/** ตารางและคอลัมน์ที่เก็บค่า enc: — เพิ่มที่นี่ถ้ามีที่ใหม่ */
const TARGETS: Array<{ table: string; pk: string; columns: string[] }> = [
  { table: "bms_tenant_channels", pk: "id", columns: ["access_token", "channel_secret"] },
  // ตารางนี้ใช้ tenant_id เป็น primary key ไม่มีคอลัมน์ id
  { table: "bms_tenant_ai_config", pk: "tenant_id", columns: ["api_key_encrypted"] },
];

let moved = 0, alreadyOk = 0, stuck = 0;

for (const target of TARGETS) {
  const cols = target.columns.join(", ");
  const { rows } = await query<any>(
    `SELECT ${target.pk} AS pk, ${cols} FROM ${target.table}`
  );
  for (const row of rows) {
    for (const col of target.columns) {
      const stored = row[col];
      if (typeof stored !== "string" || !stored.startsWith("enc:")) continue;

      if (decrypt(stored, NEW_KEY) !== null) { alreadyOk++; continue; }

      const plain = decrypt(stored, DEV_KEY);
      if (plain === null) {
        stuck++;
        console.warn(`  ⚠️  ${target.table}.${col} (${row.pk}) ถอดด้วยคีย์ dev ก็ไม่ได้ — ต้องให้ร้านกรอกใหม่`);
        continue;
      }
      moved++;
      console.log(`  ${APPLY ? "ย้าย" : "จะย้าย"} ${target.table}.${col} (${row.pk})`);
      if (APPLY) {
        await query(
          `UPDATE ${target.table} SET ${col} = $2 WHERE ${target.pk} = $1`,
          [row.pk, encrypt(plain, NEW_KEY)]
        );
      }
    }
  }
}

console.log(
  `\n${APPLY ? "ย้ายแล้ว" : "จะย้าย"} ${moved} ค่า · ใช้คีย์ใหม่อยู่แล้ว ${alreadyOk} · ` +
  `กู้ไม่ได้ ${stuck}` + (APPLY ? "" : "\n(ยังไม่เขียนอะไร — เติม --apply เพื่อเขียนจริง)")
);
process.exit(0);
