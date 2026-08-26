// =============================================================
// ตรวจว่า BMS_SECRET_KEY ทำงานจริงหรือไม่ (read-only)
// -------------------------------------------------------------
// ไม่เขียนอะไรลงฐานข้อมูล และไม่พิมพ์ค่าความลับออกมา — รายงานแต่สถานะ
//
// ตอบ 4 คำถามเรียงจากล่างขึ้นบน:
//   1. คีย์ถูกส่งเข้ามาถึงโปรเซสนี้ไหม และรูปแบบถูกไหม (hex 64)
//   2. เป็นคีย์ dev ที่คำนวณจากซอร์สได้หรือไม่ (ตั้งค่าถูกแต่ยังไม่ปลอดภัย)
//   3. เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริงใช้งานได้ไหม (round-trip)
//   4. ข้อมูลที่เก็บไว้จริงถอดด้วยคีย์นี้ได้กี่ค่า
//
// ---- วิธีใช้ ----
// local:
//   cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
//     POSTGRES_PASSWORD=... BMS_SECRET_KEY=<คีย์> \
//     npx tsx ../../scripts/check-bms-secret-key.mts
//
// ในคอนเทนเนอร์ (ตรวจของจริงที่แอปเห็น — ไม่ต้องส่ง env เอง):
//   docker compose ... exec web npx tsx scripts/check-bms-secret-key.mts
// =============================================================

import crypto from "crypto";
import { query } from "../apps/web/lib/db.ts";

const DEV_KEY_HEX = crypto.createHash("sha256").update("bms-dev-secret-key").digest("hex");

const TARGETS: Array<{ table: string; columns: string[] }> = [
  { table: "bms_tenant_channels", columns: ["access_token", "channel_secret"] },
  { table: "bms_tenant_ai_config", columns: ["api_key_encrypted"] },
];

const decryptWith = (stored: string, key: Buffer): string | null => {
  try {
    const [, ivB, tagB, dataB] = stored.split(":");
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    d.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
};

let fatal = false;

// ---- 1. ส่งมาถึงไหม / รูปแบบถูกไหม ----
const hex = process.env.BMS_SECRET_KEY;
console.log("1) คีย์มาถึงโปรเซสนี้");
if (!hex) {
  console.log("   ❌ ไม่มี BMS_SECRET_KEY เลย");
  console.log("      ถ้าตั้งใน .env แล้วยังเห็นข้อความนี้ = compose ไม่ได้ส่งต่อ");
  console.log("      ต้องมีบรรทัด BMS_SECRET_KEY: ${BMS_SECRET_KEY} ใน environment: ของ service web");
  fatal = true;
} else if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.log(`   ❌ รูปแบบผิด (ยาว ${hex.length} ตัว ต้องเป็น hex 64 ตัว)`);
  console.log("      อันตรายกว่าไม่ตั้งเลย เพราะดูเหมือนตั้งแล้ว — production จะ throw");
  fatal = true;
} else {
  console.log("   ✅ ตั้งไว้ และเป็น hex 64 ตัว");
}

// ---- 2. เป็นคีย์ dev ที่ใครก็คำนวณได้ไหม ----
if (hex) {
  console.log("2) คุณภาพของคีย์");
  if (hex.toLowerCase() === DEV_KEY_HEX) {
    console.log("   ⚠️  เป็นคีย์ dev ที่ derive จากสตริงในซอร์สโค้ดได้");
    console.log("      ระบบ 'ทำงาน' แต่ยังไม่ปลอดภัย — ใครอ่าน repo ก็ถอด token ของทุกร้านได้");
    console.log("      หมุนคีย์ด้วย scripts/rotate-bms-secret-key.mts");
  } else {
    console.log("   ✅ ไม่ใช่คีย์ dev");
  }
}

// ---- 3. เส้นทางในโค้ดจริงใช้งานได้ไหม ----
console.log("3) เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริง");
try {
  const { encryptSecret, decryptSecret } = await import("../apps/web/lib/bms/crypto.ts");
  const probe = "probe-" + crypto.randomBytes(6).toString("hex");
  const round = decryptSecret(encryptSecret(probe));
  console.log(round === probe ? "   ✅ encrypt → decrypt กลับมาได้ค่าเดิม" : "   ❌ round-trip ไม่ตรง");
  if (round !== probe) fatal = true;
} catch (err: any) {
  console.log(`   ❌ throw: ${String(err?.message ?? err).slice(0, 100)}`);
  console.log("      (ถ้า NODE_ENV=production และคีย์ไม่ถูกต้อง อันนี้คือพฤติกรรมที่ตั้งใจ)");
  fatal = true;
}

// ---- 4. ข้อมูลจริงถอดได้กี่ค่า ----
console.log("4) ข้อมูลที่เก็บไว้จริง");
const currentKey = hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
const devKey = Buffer.from(DEV_KEY_HEX, "hex");
let total = 0, okCurrent = 0, okDev = 0, stuck = 0;
let unreadable = 0;   // ต่อฐานไม่ได้/ไม่มีตาราง = "ตรวจไม่ได้" ไม่ใช่ "ไม่มีปัญหา"

for (const t of TARGETS) {
  let rows: any[];
  try {
    rows = (await query<any>(`SELECT ${t.columns.join(", ")} FROM ${t.table}`)).rows;
  } catch (err: any) {
    unreadable++;
    console.log(`   ⚠️  อ่าน ${t.table} ไม่ได้: ${String(err?.message ?? err).slice(0, 70)}`);
    continue;
  }
  for (const row of rows) {
    for (const col of t.columns) {
      const v = row[col];
      if (typeof v !== "string" || !v.startsWith("enc:")) continue;
      total++;
      if (currentKey && decryptWith(v, currentKey) !== null) okCurrent++;
      else if (decryptWith(v, devKey) !== null) okDev++;
      else stuck++;
    }
  }
}

if (unreadable > 0 && total === 0) {
  console.log("   ❓ ตรวจข้อมูลจริงไม่ได้ (ต่อฐานข้อมูลไม่สำเร็จ) — ยังไม่รู้ว่าถอดได้หรือไม่");
} else if (total === 0) {
  console.log("   ไม่มีค่าที่เข้ารหัสไว้เลย — ยังไม่มีอะไรจะพัง");
} else {
  console.log(`   ทั้งหมด ${total} ค่า`);
  console.log(`   ✅ ถอดด้วยคีย์ปัจจุบันได้ ${okCurrent}`);
  if (okDev > 0) {
    console.log(`   ⚠️  ต้องใช้คีย์ dev เดิม ${okDev} — ค่าเหล่านี้จะอ่านไม่ออกด้วยคีย์ปัจจุบัน`);
    console.log("      ช่องทางที่ใช้ค่านี้จะตายเงียบ ๆ · รัน rotate-bms-secret-key.mts --apply");
  }
  if (stuck > 0) {
    console.log(`   ❌ ถอดไม่ได้ทั้งคีย์ปัจจุบันและคีย์ dev ${stuck} — ร้านนั้นต้องกรอก token ใหม่`);
  }
}

// แยกให้ชัด 4 แบบ — "ใช้งานได้" กับ "ปลอดภัย" ไม่ใช่เรื่องเดียวกัน
const usesDevKey = !!hex && hex.toLowerCase() === DEV_KEY_HEX;
let verdict: string;
let code = 0;
if (fatal) {
  verdict = "❌ ใช้งานไม่ได้ — แก้ตามข้อที่ขึ้น ❌ ก่อน";
  code = 1;
} else if (stuck > 0 || okDev > 0) {
  verdict = "❌ ใช้งานได้บางส่วน — มีข้อมูลที่คีย์ปัจจุบันถอดไม่ออก (ช่องทางนั้นจะตายเงียบ)";
  code = 1;
} else if (unreadable > 0) {
  verdict = "❓ คีย์เองใช้ได้ แต่ตรวจข้อมูลจริงไม่สำเร็จ — รันซ้ำโดยต่อฐานข้อมูลให้ได้ก่อน";
  code = 1;
} else if (usesDevKey) {
  verdict = "⚠️  ทำงานได้ แต่ยังไม่ปลอดภัย — คีย์นี้คำนวณจากซอร์สได้ ต้องหมุน";
} else {
  verdict = "✅ BMS_SECRET_KEY ทำงานถูกต้องและเป็นคีย์ของคุณเอง";
}
console.log("\nสรุป: " + verdict);
process.exit(code);
