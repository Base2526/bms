// =============================================================
// ตัวรันชุดเทสกลาง — "รันทุกอย่าง" ต้องเป็นคำสั่งเดียวที่จำได้
// -------------------------------------------------------------
// ก่อนหน้านี้ชุดเทส 42 ไฟล์ถูกรันด้วยคำสั่งยาว ๆ ที่จดไว้ใน CLAUDE.local.md แล้วต้อง
// ก็อปมาต่อชื่อไฟล์เอง ผลคือเทส DB หลายชุดไม่เคยถูกรันจริงในรอบที่แก้โค้ด (โน้ตของ
// 9.5 / 9.6 / 9.29 เขียนตรง ๆ ว่า "ยังไม่ได้รันในรอบนี้") — เทสที่รันยากคือเทสที่ไม่ถูกรัน
//
//   node scripts/run-contract-tests.mjs pure   # ไม่ต้องมี DB
//   node scripts/run-contract-tests.mjs db     # ต้องมี Postgres + env
//   node scripts/run-contract-tests.mjs all
//
// เรียกผ่าน npm จาก apps/web ได้เลย: npm run test:pure / npm run test:db / npm run gate
// =============================================================

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, "..");
const WEB = path.join(REPO, "apps", "web");

const mode = (process.argv[2] ?? "pure").toLowerCase();
if (!["pure", "db", "all"].includes(mode)) {
  console.error(`ไม่รู้จักโหมด "${mode}" — ใช้ pure | db | all`);
  process.exit(2);
}

/**
 * เดินทั้ง `scripts/` และ `scripts/ai-eval/`
 *
 * ชุด ai-eval (deterministic contract ไม่ต่อ provider/DB) เคยอยู่นอกประตูนี้ เพราะตัวเดินไฟล์
 * อ่านเฉพาะชั้นบนสุด — README ของมันบอกให้ "รันมือทีละไฟล์" ซึ่งแปลว่าไม่มีใครรัน (บทเรียนเดียวกับ
 * ตอนตั้ง gate ครั้งแรกที่พบว่าชุด pure แดงอยู่ 2 ตัวโดยไม่มีใครรู้) · ยืนยันแล้วว่าทั้งชุดเขียว
 * และใช้เวลา ~6 วิ จึงอยู่ในโหมด pure ได้
 * `run.mjs` (live-model eval) ไม่ใช่ `.test.mts` จึงไม่ถูกหยิบมา
 */
const collect = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "ai-eval"
        ? collect(path.join(dir, entry.name), `${entry.name}/`)
        : []
      : entry.name.endsWith(".test.mts")
        ? [`${prefix}${entry.name}`]
        : []
  );
const all = collect(SCRIPTS).sort();
/** ชื่อไฟล์คือสัญญา: `-db-contract` = ต้องมี Postgres จริง ที่เหลือรันที่ไหนก็ได้ */
const isDb = (f) => f.includes("-db-contract");
const files = all.filter((f) => (mode === "all" ? true : mode === "db" ? isDb(f) : !isDb(f)));

if (files.length === 0) {
  console.error("ไม่พบไฟล์เทสสำหรับโหมดนี้ — การเดินไดเรกทอรีคงพลาด");
  process.exit(2);
}

/**
 * เทส DB เขียนจริงลงฐาน และบางชุดแก้ค่าของร้านจริงแล้วคืนตอน teardown (เช่น
 * product-vat-category ที่แก้ประเภทภาษีของสินค้าทั้งร้าน) — รันผิดฐานคือแก้ข้อมูลลูกค้า
 * จึงกันไว้ที่นี่ ไม่ใช่พึ่งความระมัดระวังของคนพิมพ์คำสั่ง
 */
if (mode !== "pure") {
  const host = (process.env.POSTGRES_HOST ?? "").trim();
  const db = (process.env.POSTGRES_DB ?? "").trim();
  if (!host || !db) {
    console.error(
      "เทส DB ต้องมี POSTGRES_HOST + POSTGRES_DB (และ POSTGRES_USER/POSTGRES_PASSWORD)\n" +
        "ดูคำสั่งเต็มใน CLAUDE.local.md § ก่อน production"
    );
    process.exit(2);
  }
  const LOCAL = ["localhost", "127.0.0.1", "::1", "postgres", "db"];
  if (!LOCAL.includes(host) && process.env.BMS_TEST_ALLOW_REMOTE_DB !== "1") {
    console.error(
      `ปฏิเสธการรันเทส DB กับ host "${host}" ซึ่งไม่ใช่เครื่องท้องถิ่น\n` +
        "ชุดนี้เขียนจริงลงฐาน ห้ามรันกับ production\n" +
        "ถ้าเป็น staging ที่ตั้งใจจริง ตั้ง BMS_TEST_ALLOW_REMOTE_DB=1"
    );
    process.exit(2);
  }
  console.log(`[gate] เทส DB จะรันกับ ${host}/${db}`);
}

const args = [
  "tsx",
  // ต้องเป็น file:// URL — บน Windows path แบบ C:\... ถูก ESM loader อ่านเป็น protocol "c:"
  // แล้วทุกไฟล์เทสล้มพร้อมกันด้วย ERR_UNSUPPORTED_ESM_URL_SCHEME
  "--import",
  pathToFileURL(path.join(SCRIPTS, "testing", "next-runtime-shim.mjs")).href,
  "--test",
  // สองชุดขึ้นไปใช้ร้านแรกร่วมกัน รันขนานกันแล้วเหยียบกันเอง (บทเรียนจาก loyalty/pos)
  "--test-concurrency=1",
  "--test-force-exit",
  ...files.map((f) => path.join(SCRIPTS, f)),
];

console.log(`[gate] โหมด ${mode} — ${files.length} ไฟล์`);
const run = spawnSync("npx", args, {
  cwd: WEB,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(run.status ?? 1);
