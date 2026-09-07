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
// อาร์กิวเมนต์ที่สามคือ "ชื่อไฟล์บางส่วน" สำหรับตอนกำลังแก้ไฟล์ใดไฟล์หนึ่ง:
//   node scripts/run-contract-tests.mjs db restaurant-request
//
// มีไว้เพราะทางเลือกเดิมคือรันมือด้วย `npx tsx --test <ไฟล์>` ซึ่ง **ข้ามด่านตรวจ host
// ด้านล่างทั้งหมด** และ 34 จาก 35 ไฟล์ของชุด DB ไม่มีด่านของตัวเอง — ชุดนี้เขียนจริงลงฐาน
// จึงต้องมีทางรันไฟล์เดียวที่ยังผ่านด่านและได้ shim ครบ ไม่ใช่ให้คนเลี่ยงไปรันมือ
//
// เรียกผ่าน npm จาก apps/web ได้เลย: npm run test:pure / npm run test:db / npm run gate
// =============================================================

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
const filter = (process.argv[3] ?? "").trim();

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
const inMode = all.filter((f) => (mode === "all" ? true : mode === "db" ? isDb(f) : !isDb(f)));
if (inMode.length === 0) {
  console.error("ไม่พบไฟล์เทสสำหรับโหมดนี้ — การเดินไดเรกทอรีคงพลาด");
  process.exit(2);
}

// ตัวกรองที่ไม่ตรงอะไรเลยต้องดัง ไม่ใช่ "ผ่าน 0 ไฟล์" ซึ่งอ่านเหมือนเทสเขียว
const files = filter ? inMode.filter((f) => f.includes(filter)) : inMode;
if (files.length === 0) {
  console.error(`ตัวกรอง "${filter}" ไม่ตรงไฟล์ไหนในโหมด ${mode} (${inMode.length} ไฟล์)`);
  console.error("ตัวอย่างชื่อที่มี: " + inMode.slice(0, 4).map((f) => f.replace(".test.mts", "")).join(", "));
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

/**
 * ผลลัพธ์ออกสองทาง: จอ + ไฟล์ — ทางเดียวไม่พอทั้งคู่
 *
 * จอเดิมพิมพ์ TAP ทั้งก้อน = **5,445 บรรทัด / 249 KB** ต่อรอบที่ผ่าน ซึ่ง 66% เป็นบล็อก YAML
 * ของเทสที่ผ่าน · ตอนแดงต้อง `grep "^not ok"` เอง และ scrollback อาจไม่พอ
 * ส่วนถ้าเขียนลงไฟล์แล้วจอเงียบ รอบที่ใช้ 30 วินาที (โหมด DB นานกว่า) จะแยกไม่ออกว่า
 * ค้างหรือกำลังทำงาน
 *
 * จอ = spec (มี `ℹ tests/pass/fail` + section `✖ failing tests:` ที่ลิสต์เฉพาะตัวแดง)
 * ไฟล์ = TAP เต็ม ไม่มี ANSI จึง grep/diff ได้ — งานที่ต้องใช้ไฟล์จริงมีสามอย่างและทำอยู่แล้ว
 * ด้วยมือ: ไล่ตัวแดง · diff ชื่อเทสที่แดงก่อน/หลังเพื่อยืนยันว่าไม่มี regression · mutation test
 *
 * ไม่ใช้ `tee` เพราะ exit code จะต้องพึ่ง PIPESTATUS แล้วหลุดง่ายบน shell ผสมของ Windows
 * — reporter destination ของ node ไม่มีปัญหานั้น (ยืนยันแล้วว่า exit code ยังถูกทั้ง 0 และ 1)
 */
const OUT_DIR = path.resolve(process.env.BMS_TEST_OUTPUT_DIR || path.join(REPO, ".test-output"));
mkdirSync(OUT_DIR, { recursive: true });
const tapFile = path.join(OUT_DIR, `${mode}.tap`);
const runFile = path.join(OUT_DIR, `${mode}.run.txt`);

/**
 * `.run.txt` เขียนโดยตัวรันเอง ไม่ใช่ node — มีสองหน้าที่ที่ไฟล์ TAP ทำแทนไม่ได้:
 *
 *   1. **บอกว่ารันกับฐานไหน** (โหมด DB) · ไฟล์ผลที่ไม่รู้ว่าเป็นของฐานไหนตอบอะไรไม่ได้
 *   2. **แยก "รันจบ" ออกจาก "ตายกลางทาง"** · process ที่ถูกฆ่าทิ้งไฟล์ครึ่งเดียวที่ไม่มี
 *      `not ok` แล้วอ่านเหมือนผ่าน — บรรทัด `exit=` ถูกเขียน *หลัง* ลูกจบเท่านั้น
 *      **ไม่มีบรรทัด `exit=` = รอบนั้นยังไม่จบ ห้ามอ่านว่าเขียว**
 */
const startedAt = new Date();
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" });
writeFileSync(runFile, [
  `mode=${mode}`,
  `filter=${filter || "-"}`,
  `files=${files.length}`,
  `commit=${(commit.stdout ?? "").trim() || "unknown"}`,
  `database=${mode === "pure" ? "-" : `${process.env.POSTGRES_HOST}/${process.env.POSTGRES_DB}`}`,
  `started=${startedAt.toISOString()}`,
  `tap=${path.relative(REPO, tapFile)}`,
  "files:",
  ...files.map((f) => `  ${f}`),
  "",
].join("\n"));

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
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=tap",
  `--test-reporter-destination=${path.relative(WEB, tapFile)}`,
  // พาธสัมพัทธ์กับ cwd ของลูก ไม่ใช่พาธเต็ม — บน Windows คำสั่งถูกส่งผ่าน cmd.exe ซึ่งมี
  // เพดานความยาว 8,191 ตัวอักษร · พาธเต็ม 80 กว่าไฟล์เคยทะลุเพดานแล้วได้แค่
  // "The syntax of the command is incorrect." ซึ่งไม่บอกอะไรเลยว่าเกิดอะไรขึ้น
  ...files.map((f) => path.relative(WEB, path.join(SCRIPTS, f))),
];

// ถ้าวันหนึ่งไฟล์เทสมากพอจะทะลุเพดานอีก ต้องฟ้องให้อ่านรู้เรื่อง ไม่ใช่ปล่อยให้ cmd.exe
// ตอบข้อความที่ไม่มีใครเดาต้นเหตุได้
const commandLength = args.reduce((sum, arg) => sum + arg.length + 3, 4);
if (process.platform === "win32" && commandLength > 7_500) {
  console.error(`คำสั่งยาว ${commandLength} ตัวอักษร ใกล้เพดาน 8,191 ของ cmd.exe แล้ว`);
  console.error("แบ่งรันด้วยตัวกรอง เช่น node scripts/run-contract-tests.mjs pure <ชื่อไฟล์บางส่วน>");
  process.exit(2);
}

console.log(
  `[gate] โหมด ${mode} — ${files.length} ไฟล์` +
    (filter ? ` (กรองด้วย "${filter}" จาก ${inMode.length})` : "")
);
const run = spawnSync("npx", args, {
  cwd: WEB,
  stdio: "inherit",
  shell: process.platform === "win32",
});
const exitCode = run.status ?? 1;
appendFileSync(runFile, [
  `finished=${new Date().toISOString()}`,
  `duration_ms=${Date.now() - startedAt.getTime()}`,
  `exit=${exitCode}`,
  "",
].join("\n"));
console.log(`[gate] ผลเต็มอยู่ที่ ${path.relative(REPO, tapFile)} · สรุปรอบนี้ ${path.relative(REPO, runFile)}`);
process.exit(exitCode);
