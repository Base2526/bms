// =============================================================
// ตรวจว่าฐานข้อมูลนี้ apply migration ครบพอที่โค้ดชุดปัจจุบันจะทำงานไหม (read-only)
// -------------------------------------------------------------
// ไม่เขียนอะไรลงฐานเลย · รันกับ production ได้
//
// ทำไมต้องมี: repo นี้ apply migration ด้วยมือตามเลข และ **ไม่มี schema probe ที่ไหน**
// เส้นทางร้อน (สร้างบิล/ขาย/ส่งครัว) อ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข ฐานที่ตกไปหนึ่งไฟล์
// จึงล้มด้วย 42703/42P01 แล้วโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" เฉย ๆ (routeError.ts
// redact ข้อความจริงทิ้งบน production) — ตัวนี้แปลอาการนั้นกลับเป็นชื่อไฟล์ที่ต้องรัน
//
// ---- วิธีใช้ ----
//   npx tsx scripts/check-schema-readiness.mts
//
// ไม่ต้องส่ง env เองถ้ามี `.env` (หรือ `.env.prod`/`.env.dev`) อยู่ที่รากโปรเจกต์ — สคริปต์
// อ่านให้ และ **พิมพ์เสมอว่ากำลังตรวจฐานไหน** เพราะการตรวจผิดฐานแล้วรายงานว่า "ครบ"
// อันตรายกว่าไม่ตรวจเลย · ส่ง env เองก็ได้ ค่าที่ส่งมาชนะไฟล์เสมอ:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//     npx tsx scripts/check-schema-readiness.mts
//
// exit 1 = ยังมีของขาด หรือต่อฐานไม่ได้ (ใช้ใน CI/ก่อน deploy ได้)
// =============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_VARS = ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"] as const;

// อ่าน .env เฉพาะคีย์ที่ยังไม่ได้ตั้ง — ค่าที่คนส่งมาทางบรรทัดคำสั่งต้องชนะไฟล์เสมอ
let envFileUsed: string | null = null;
if (!DB_VARS.some((name) => process.env[name])) {
  for (const candidate of [".env", ".env.prod", ".env.dev"]) {
    const file = path.join(ROOT, candidate);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      if ((DB_VARS as readonly string[]).includes(key) && !process.env[key]) {
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    }
    envFileUsed = candidate;
    break;
  }
}

const wantsSql = process.argv.includes("--sql");
const target = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: process.env.POSTGRES_PORT || "5432",
  db: process.env.POSTGRES_DB || "appdb",
  user: process.env.POSTGRES_USER || "app",
};
if (!wantsSql) {
  console.log(`ฐานที่กำลังตรวจ: ${target.user}@${target.host}:${target.port}/${target.db}`
    + (envFileUsed ? ` (อ่านค่าจาก ${envFileUsed})` : " (จาก env ที่ส่งมา)"));
  console.log("");
}

import { MIGRATIONS, renderReadinessSql, type Migration } from "./schemaReadiness.mts";

/**
 * โหมด `--sql` — พ่นสคริปต์ SQL ที่ตรวจเรื่องเดียวกัน **จากลิสต์ MIGRATIONS ตัวเดียวกันข้างบน**
 *
 * มีไว้เพราะเครื่องที่ต้องตรวจจริงคือเซิร์ฟเวอร์ production ซึ่งมักไม่มี Node/tsx พร้อมใช้ และ
 * ฐานอยู่ใน docker (`POSTGRES_HOST=postgres` = ชื่อ service ต่อจากข้างนอกไม่ได้) · เขียนลิสต์
 * ที่สองเป็นไฟล์ .sql แยก = วันหนึ่งสองไฟล์จะไม่ตรงกัน แล้วตัวตรวจจะโกหกโดยไม่มีใครรู้
 *
 * โหมดนี้ **ไม่ต่อฐานเลย** จึงรันได้โดยไม่ต้องมี env อะไรทั้งสิ้น
 */
if (wantsSql) {
  console.log(renderReadinessSql());
  process.exit(0);
}

// import หลังตั้ง env — pool ของ lib/db.ts ถูกสร้างตอน import ค่าที่ตั้งทีหลังจะไม่มีผล
const { query } = await import("../apps/web/lib/db.ts");

/** ต่อฐานไม่ได้ ≠ ฐานไม่ครบ — ต้องบอกว่าติดตรงไหนและตั้งอะไร ไม่ใช่โยน stack ของ pg ใส่หน้า */
function explainConnectionFailure(error: any): string[] {
  const code = String(error?.code ?? "");
  if (code === "3D000") return [
    `ไม่มีฐานชื่อ "${target.db}" บนเซิร์ฟเวอร์นี้`,
    `  ถ้ายังไม่ได้ตั้ง env เลย ค่าปริยายของแอปคือ "appdb" ซึ่งมักไม่ใช่ชื่อจริง — ฐานของ dev ชื่อ bms`,
  ];
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return [
    `หา host "${target.host}" ไม่เจอ`,
    `  ถ้าค่านี้มาจาก .env มันคือชื่อ service ใน docker network — รันนอก container ต้องใช้ POSTGRES_HOST=localhost`,
  ];
  if (code === "ECONNREFUSED") return [`ต่อ ${target.host}:${target.port} ไม่ได้ (Postgres ไม่ได้รันอยู่ หรือพอร์ตไม่ตรง)`];
  if (code === "28P01" || code === "28000") return [`รหัสผ่านหรือผู้ใช้ "${target.user}" ไม่ถูกต้อง`];
  return [String(error?.message ?? error)];
}

let tables: Set<string>;
let columns: Set<string>;
try {
  tables = new Set(
    (await query<{ tablename: string }>(
      `SELECT c.relname AS tablename
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')`
    )).rows.map((row) => row.tablename)
  );
  columns = new Set(
    (await query<{ key: string }>(
      `SELECT table_name || '.' || column_name AS key
         FROM information_schema.columns WHERE table_schema = 'public'`
    )).rows.map((row) => row.key)
  );
} catch (error: any) {
  console.log("❌ ต่อฐานข้อมูลไม่ได้ — ยังไม่ได้ตรวจอะไรเลย");
  for (const line of explainConnectionFailure(error)) console.log(`   ${line}`);
  console.log("");
  console.log("   ฐาน dev ในเครื่องนี้ (Postgres อยู่ใน docker แต่ map พอร์ตออกมาแล้ว):");
  console.log("   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \\");
  console.log("     POSTGRES_PASSWORD=\"$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)\" \\");
  console.log("     npx tsx scripts/check-schema-readiness.mts");
  console.log("");
  console.log("   บนเซิร์ฟเวอร์จริง: รันด้วย env ชุดเดียวกับที่แอปใช้ (ค่าจาก .env ของเครื่องนั้น)");
  process.exit(1);
}

const missingFiles: Migration[] = [];
console.log("ตรวจ schema เทียบกับสิ่งที่โค้ดชุดนี้ต้องใช้\n");

for (const migration of MIGRATIONS) {
  const missing = migration.needs.filter((need) =>
    need.kind === "table"
      ? !tables.has(need.name)
      // คอลัมน์ของตารางที่ยังไม่มี ไม่ต้องรายงานซ้ำ — ไฟล์ที่สร้างตารางนั้นจะถูกรายงานเอง
      : tables.has(need.table) && !columns.has(`${need.table}.${need.name}`)
  );
  if (!missing.length) {
    console.log(`✅ ${migration.file}`);
    continue;
  }
  missingFiles.push(migration);
  console.log(`❌ ${migration.file}`);
  console.log(`   ผลถ้าไม่รัน: ${migration.impact}`);
  for (const need of missing) {
    console.log(need.kind === "table" ? `   - ไม่มีตาราง ${need.name}` : `   - ไม่มีคอลัมน์ ${need.table}.${need.name}`);
  }
}

console.log("");
if (!missingFiles.length) {
  console.log("สรุป: ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น");
  process.exit(0);
}
console.log(`สรุป: ขาด ${missingFiles.length} ไฟล์ — รันตามลำดับเลขนี้ (psql -1 ทีละไฟล์):`);
for (const migration of missingFiles) console.log(`   psql -1 -f db/migrations/${migration.file}`);
process.exit(1);
