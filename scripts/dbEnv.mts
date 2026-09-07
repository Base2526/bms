// =============================================================
// หาว่า "ฐานเป้าหมาย" คือฐานไหน — ที่เดียวของทั้ง repo
// -------------------------------------------------------------
// เดิมตรรกะนี้อยู่ใน check-schema-readiness.mts ตัวเดียว ส่วน check-bms-secret-key.mts
// พึ่ง env ที่แอปเห็น (ออกแบบให้รันในคอนเทนเนอร์) ผลคือถ้ามีคนรันสองตัวนี้จากเครื่องเดียวกัน
// **มันอาจตรวจฐานคนละฐานกัน** โดยไม่มีอะไรบอก — ตัวหนึ่งอ่าน .env อีกตัวตกไปที่ค่าปริยาย appdb
//
// preflight ต้องตอบให้ได้ว่า "ฐานนี้พร้อม deploy ไหม" คำตอบจะเชื่อถือได้ต่อเมื่อ
// ทุกด่านย่อยมองฐานเดียวกัน จึง resolve ที่นี่ครั้งเดียวแล้วส่งต่อให้ลูกทุกตัวแบบระบุชัด
// =============================================================

import fs from "node:fs";
import path from "node:path";

export const DB_VARS = ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"] as const;

/**
 * อ่าน .env เฉพาะคีย์ที่ยังไม่ได้ตั้ง — ค่าที่คนส่งมาทางบรรทัดคำสั่งต้องชนะไฟล์เสมอ
 *
 * ถ้ามี DB_VARS ตัวใดตัวหนึ่งใน env อยู่แล้ว จะไม่อ่านไฟล์เลย (ไม่ผสมสองแหล่ง) เพราะการผสม
 * host จากบรรทัดคำสั่งกับรหัสผ่านจากไฟล์ของอีกฐาน คือวิธีที่จะตรวจผิดฐานแบบเงียบที่สุด
 */
export function loadDbEnvFromFiles(root: string): string | null {
  if (DB_VARS.some((name) => process.env[name])) return null;
  for (const candidate of [".env", ".env.prod", ".env.dev"]) {
    const file = path.join(root, candidate);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      if ((DB_VARS as readonly string[]).includes(key) && !process.env[key]) {
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    }
    return candidate;
  }
  return null;
}

export type DbTarget = { host: string; port: string; db: string; user: string };

/** ค่าปริยายตรงกับ lib/db.ts — appdb มักไม่ใช่ชื่อจริง จึงต้องพิมพ์ให้เห็นทุกครั้ง */
export function dbTarget(): DbTarget {
  return {
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || "5432",
    db: process.env.POSTGRES_DB || "appdb",
    user: process.env.POSTGRES_USER || "app",
  };
}

/**
 * บรรทัดที่ต้องพิมพ์ก่อนตรวจอะไรทั้งนั้น
 *
 * ตรวจผิดฐานแล้วรายงานว่า "ครบ" อันตรายกว่าไม่ตรวจเลย — คนอ่านจะ deploy ต่อด้วยความมั่นใจ
 */
export function describeDbTarget(envFileUsed: string | null): string {
  const t = dbTarget();
  return `ฐานที่กำลังตรวจ: ${t.user}@${t.host}:${t.port}/${t.db}`
    + (envFileUsed ? ` (อ่านค่าจาก ${envFileUsed})` : " (จาก env ที่ส่งมา)");
}

/** env ชุด DB ที่ resolve แล้ว สำหรับส่งต่อให้ด่านย่อยทุกตัวมองฐานเดียวกัน */
export function resolvedDbEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DB_VARS) {
    const value = process.env[name];
    if (value) out[name] = value;
  }
  return out;
}
