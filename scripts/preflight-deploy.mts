// =============================================================
// ฐานเป้าหมายนี้พร้อมรับโค้ดชุดนี้ไหม (read-only ทั้งหมด)
// -------------------------------------------------------------
// ไม่เขียนอะไรลงฐาน ไม่พิมพ์ค่าความลับ ไม่ apply migration ให้เอง
//
// ทำไมต้องมี: `npm run gate` ตอบได้แค่ "โค้ดคอมไพล์ได้ + สัญญา pure ยังจริง" ซึ่งเป็น
// build-time ทั้งหมด · แต่ของที่ทำให้ production ล้มจริงในรีโปนี้เป็น **สภาพของเป้าหมาย**:
// migration ที่ยังไม่ได้รัน (โค้ดอ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข และไม่มี schema probe ที่ไหน),
// ความลับที่ไม่ได้ตั้ง (production throw), GRANT ที่หาย (การคืนของตั้งแต่ ฿500 ล้มทุกครั้ง)
//
// ---- วิธีใช้ ----
//   npx tsx scripts/preflight-deploy.mts
//
// รันด้วย env ชุดเดียวกับที่แอปจะใช้ — บนเซิร์ฟเวอร์จริงคือ:
//   docker compose ... exec web npx tsx scripts/preflight-deploy.mts
// (ในคอนเทนเนอร์เท่านั้นที่ตัวตรวจจะเห็นความลับชุดเดียวกับที่แอปเห็น)
//
// ---- exit code ----
//   0 = deploy ได้ (อ่านรายการเตือนก่อน — มีของที่เครื่องตรวจแทนคนไม่ได้)
//   1 = บล็อก — มีด่านที่ไม่ผ่าน
//   2 = ตรวจไม่ได้ → **นับเป็นบล็อกด้วย** ไม่ใช่ผ่าน
//
// ข้อ 2 มาจากบทเรียนของ check-bms-secret-key เอง: เวอร์ชันแรกรายงานว่า "ไม่มีค่าที่
// เข้ารหัสไว้เลย" ตอนที่ต่อฐานไม่ได้ ซึ่งอ่านแล้วเข้าใจว่าปลอดภัย
//
// ---- ขอบเขตที่ตัวนี้ตอบไม่ได้ (จงใจ) ----
// เทส DB 35 ไฟล์รันกับ production ไม่ได้ (เขียนจริงลงฐาน) และ "เคยเปิดดูในเบราว์เซอร์ยัง"
// เครื่องตอบไม่ได้ · สองอย่างนี้จึงเป็น **รายการที่คนต้องยืนยัน** ไม่ใช่ด่านที่บล็อก —
// กฎที่ gate.yml เขียนไว้เอง: อย่าเพิ่มด่านที่รู้อยู่แล้วว่าแดง เพราะจะกลายเป็นด่านที่
// ทุกคนเรียนรู้ที่จะข้าม แล้วด่านที่มีค่าจริงจะถูกข้ามไปพร้อมกัน
// =============================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeDbTarget, loadDbEnvFromFiles, resolvedDbEnv } from "./dbEnv.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "apps", "web");
const SHIM = path.join(ROOT, "scripts", "testing", "next-runtime-shim.mjs");

const envFileUsed = loadDbEnvFromFiles(ROOT);
console.log("ตรวจความพร้อมก่อน deploy (read-only)");
console.log(describeDbTarget(envFileUsed));
const commitOf = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
const commit = (commitOf.stdout ?? "").trim();
console.log(`โค้ดที่จะ deploy: ${commit || "ไม่รู้ (ไม่ใช่ git repo)"}`);
console.log("");

const blockers: string[] = [];
/**
 * "ตรวจไม่ได้" ต้องไม่ปนกับ "ไม่ผ่าน" และต้องไม่ปนกับ "ผ่าน"
 *
 * ทั้งสองอย่างห้าม deploy เหมือนกัน แต่ทางแก้ต่างกันคนละเรื่อง (ไปรัน migration ก็อย่างหนึ่ง
 * ต่อฐานให้ได้ก่อนก็อีกอย่าง) และการนับ "ตรวจไม่ได้" เป็นผ่านคือความผิดพลาดที่
 * check-bms-secret-key เคยทำมาแล้ว
 */
const unknowns: string[] = [];
const warnings: string[] = [];
const block = (name: string, detail: string) => {
  blockers.push(name);
  console.log(`BLOCK ${name}`);
  console.log(`      ${detail}`);
};
const unknown = (name: string, detail: string) => {
  unknowns.push(name);
  console.log(`?     ${name}`);
  console.log(`      ${detail}`);
};
const pass = (name: string) => console.log(`ok    ${name}`);
const warn = (name: string, detail: string) => {
  warnings.push(name);
  console.log(`warn  ${name}`);
  console.log(`      ${detail}`);
};

/** ด่านย่อยทุกตัวต้องมองฐานเดียวกับที่พิมพ์ไว้ข้างบน ไม่ใช่ .env ของตัวเอง */
const childEnv = { ...process.env, ...resolvedDbEnv() };
const runChild = (args: string[], cwd = ROOT) =>
  spawnSync("npx", args, { cwd, encoding: "utf8", env: childEnv, shell: process.platform === "win32" });
const quote = (text: string) =>
  text.trim().split(/\r?\n/).map((line) => `      | ${line}`).join("\n");

// ---- 1. schema ของฐานเป้าหมาย ----
// ตัวบล็อกที่สำคัญที่สุดของรีโปนี้: เส้นทางร้อนอ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข ฐานที่ตกไป
// หนึ่งไฟล์จึงล้มด้วย 42703/42P01 แล้วโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" เฉย ๆ
let dbReachable = true;
const schema = runChild(["tsx", path.join(ROOT, "scripts", "check-schema-readiness.mts")]);
const schemaOut = `${schema.stdout ?? ""}${schema.stderr ?? ""}`;
if (schema.status === 0) {
  pass("schema ของฐานเป้าหมายครบตามที่โค้ดชุดนี้ต้องใช้");
} else if (/ต่อฐานข้อมูลไม่ได้/.test(schemaOut)) {
  unknown("ตรวจ schema ไม่ได้", "ต่อฐานไม่ได้ — ยังไม่ได้ตรวจอะไรเลย จึงยังตอบไม่ได้ว่า deploy ได้");
  console.log(quote(schemaOut));
  dbReachable = false;
} else {
  block("schema ยังไม่ครบ", "ขาด migration — รายการและคำสั่งที่ต้องรันอยู่ข้างล่าง");
  console.log(quote(schemaOut));
}

// ---- 2. ความลับที่ production ต้องมี (env เท่านั้น ไม่แตะฐาน) ----
// ตั้งแต่ 2026-08-27 production throw ถ้าไม่มีสองตัวแรก = แอปไม่ขึ้นเลย
const HEX64 = /^[0-9a-f]{64}$/i;
const secretProblems: string[] = [];
if (!process.env.JWT_SECRET) {
  secretProblems.push("JWT_SECRET ไม่ได้ตั้ง (เซ็น session + คุกกี้ drill-down)");
}
if (!process.env.BMS_SECRET_KEY) {
  secretProblems.push("BMS_SECRET_KEY ไม่ได้ตั้ง (เข้ารหัส token ของทุกร้าน)");
} else if (!HEX64.test(process.env.BMS_SECRET_KEY)) {
  secretProblems.push("BMS_SECRET_KEY ผิดรูป (ต้องเป็น hex 64) — อันตรายกว่าไม่ตั้ง เพราะดูเหมือนตั้งแล้ว");
}
if (secretProblems.length) block("ความลับที่แอปต้องมีตอนรัน", secretProblems.join(" · "));
else pass("ความลับที่แอปต้องมีตอนรัน ตั้งครบและรูปแบบถูก");

if (!process.env.BMS_CHECKOUT_SECRET) {
  warn(
    "BMS_CHECKOUT_SECRET ไม่ได้ตั้ง",
    "จะตกไปใช้ JWT_SECRET แทน — วันที่หมุน JWT_SECRET ลิงก์ checkout ที่ส่งลูกค้าไปแล้วใช้ไม่ได้ทั้งหมด"
  );
}

// ---- 3. คีย์เข้ารหัสใช้ได้จริงกับข้อมูลที่เก็บไว้ ----
const secretKey = runChild(["tsx", path.join(ROOT, "scripts", "check-bms-secret-key.mts")]);
if (secretKey.status === 0) {
  pass("คีย์เข้ารหัสถอดข้อมูลที่เก็บไว้จริงได้ครบ");
} else if (!dbReachable) {
  unknown("ตรวจคีย์เข้ารหัสกับข้อมูลจริงไม่ได้", "ต่อฐานไม่ได้ — ตรวจได้แค่ว่าคีย์ถูกรูป ไม่ใช่ว่าถอดของที่เก็บไว้ได้");
} else {
  block(
    "คีย์เข้ารหัสยังใช้กับข้อมูลจริงไม่ได้ครบ",
    "ค่าที่ถอดไม่ออกทำให้ช่องทางของร้านดูเหมือนไม่มี token แล้วตายเงียบ (ดู scripts/rotate-bms-secret-key.mts)"
  );
  console.log(quote(`${secretKey.stdout ?? ""}${secretKey.stderr ?? ""}`));
}

// ---- 4. GRANT ของ bms_app ----
// beginTenantTx ทำ SET LOCAL ROLE bms_app ทุกเส้นทางเขียน · GRANT ที่หายทำให้
// processPosReturn ล้มกลางการคืนของทุกครั้งที่ยอดถึงเกณฑ์ต้องมีผู้อนุมัติ (บั๊ก 8.4 ที่หลุดไป production)
//
// เรียกไฟล์เทสตัวเดิม ไม่ก็อป SELECT มาไว้ที่นี่ — คำสั่งพวกนั้น *คือ* ตัวการันตี ถ้ามีสองชุด
// วันหนึ่งมันจะไม่ตรงกัน · ไฟล์นั้นประกาศตัวเองว่า read-only ปลอดภัยกับทุกฐาน ตรวจซ้ำก่อนเรียก
const grantsFile = path.join(ROOT, "scripts", "db-role-grants-db-contract.test.mts");
const READ_ONLY_MARKER = "Read-only. Safe against any database, including production.";
if (!fs.readFileSync(grantsFile, "utf8").includes(READ_ONLY_MARKER)) {
  block(
    "ตรวจ GRANT ไม่ได้",
    "db-role-grants-db-contract ไม่ประกาศตัวเองว่า read-only แล้ว — ห้ามรันกับฐานจริงจนกว่าจะยืนยันว่ามันยังไม่เขียน"
  );
} else {
  const grants = runChild(["tsx", "--import", SHIM, "--test", "--test-force-exit", grantsFile], WEB);
  if (grants.status === 0) {
    pass("bms_app อ่านคอลัมน์ที่ด่านสิทธิ์ต้องใช้ได้ และยังอ่าน password_hash ไม่ได้");
  } else if (!dbReachable) {
    unknown("ตรวจ GRANT ของ bms_app ไม่ได้", "ต่อฐานไม่ได้");
  } else {
    block(
      "GRANT ของ bms_app ไม่ตรงที่โค้ดต้องใช้",
      "การคืนของที่ยอดถึงเกณฑ์ต้องมีผู้อนุมัติจะล้มกลางทางทุกครั้ง (db/migrations/8.4__grant_bms_app_read_users_roles.sql)"
    );
    console.log(quote(`${grants.stdout ?? ""}${grants.stderr ?? ""}`));
  }
}

// ---- 5. เครื่องมือ dev ต้องปิดบน production ----
if (process.env.NODE_ENV === "production" && process.env.BMS_ALLOW_FAKE_SEED === "1") {
  block(
    "BMS_ALLOW_FAKE_SEED เปิดอยู่บน production",
    "ตัวสร้างข้อมูลปลอมเขียนของจริงลงฐานของร้าน — ตั้งเป็น 0 หรือถอดออกก่อน deploy"
  );
} else {
  pass("ตัวสร้างข้อมูลปลอมไม่ได้เปิดไว้บน production");
}

// ---- เตือน (ไม่บล็อก) ----

// หลักฐานว่ารัน gate กับคอมมิตนี้จริง · ไม่บล็อกเพราะ preflight ถูกออกแบบให้รันบนเซิร์ฟเวอร์ด้วย
// ซึ่งไม่มีไฟล์นี้ — แต่ถ้ามีและเป็นของคอมมิตอื่น นั่นคือสิ่งที่ต้องรู้ก่อน deploy
const gateRun = path.join(ROOT, ".test-output", "pure.run.txt");
if (!fs.existsSync(gateRun)) {
  warn("ไม่มีหลักฐานว่ารัน gate กับคอมมิตนี้", "รัน `cd apps/web && npm run gate` แล้วดู .test-output/pure.run.txt");
} else {
  const summary = fs.readFileSync(gateRun, "utf8");
  const ranCommit = /^commit=(.+)$/m.exec(summary)?.[1]?.trim();
  const exitLine = /^exit=(\d+)$/m.exec(summary)?.[1];
  if (exitLine === undefined) {
    // ไม่มีบรรทัด exit= = รอบนั้นถูกฆ่ากลางทาง ไฟล์ TAP ครึ่งเดียวไม่มี not ok อยู่ในนั้นเลย
    warn("รอบ gate ล่าสุดยังไม่จบ", "ไฟล์สรุปไม่มีบรรทัด exit= — รันใหม่ให้จบก่อนเชื่อผล");
  } else if (exitLine !== "0") {
    warn("รอบ gate ล่าสุดไม่ผ่าน", `exit=${exitLine} — ดู .test-output/pure.tap`);
  } else if (commit && ranCommit && ranCommit !== commit) {
    warn("รอบ gate ล่าสุดเป็นของคอมมิตอื่น", `รันกับ ${ranCommit} แต่กำลังจะ deploy ${commit}`);
  } else {
    pass(`รอบ gate ล่าสุดผ่าน และเป็นของคอมมิตนี้ (${ranCommit ?? "ไม่ระบุ"})`);
  }
}

if (!process.env.BMS_CRON_SECRET || !process.env.BMS_APP_BASE_URL) {
  warn(
    "cron ยังยิงไม่ได้",
    "ไม่มี BMS_CRON_SECRET/BMS_APP_BASE_URL — endpoint ตอบ 503 แล้วแต้มไม่หมดอายุ เมนูที่หมดวันนี้ไม่รีเซ็ต บิลค้างไม่ถูกปล่อย"
  );
}

// ---- รายการที่เครื่องตรวจแทนคนไม่ได้ ----
console.log("");
console.log("เครื่องตอบให้ไม่ได้ — ต้องมีคนยืนยันเอง:");
for (const item of [
  "เทส DB (35 ไฟล์) ผ่านกับฐานทดสอบของคอมมิตนี้แล้ว — รันกับ production ไม่ได้เพราะเขียนจริงลงฐาน",
  "หน้าจอที่เปลี่ยนถูกเปิดดูจริงในเบราว์เซอร์แล้ว",
  "migration ที่ยังไม่ได้ apply ถูกสำรองฐานและเลือกเวลารันแล้ว (บางไฟล์ล็อกตาราง ต้องรันตอนไม่มีคนขาย)",
  "permission ใหม่ (ถ้ามี) ถูก seed ให้ role ที่ต้องใช้ครบทุกร้าน — ไม่งั้นหน้าจอโดน 403 เงียบ ๆ",
]) console.log(`  [ ] ${item}`);

console.log("");
if (blockers.length) {
  console.log(`สรุป: ยัง deploy ไม่ได้ — ติด ${blockers.length} ด่าน`);
  for (const name of blockers) console.log(`  - ${name}`);
  for (const name of unknowns) console.log(`  - (ตรวจไม่ได้) ${name}`);
  process.exit(1);
}
if (unknowns.length) {
  console.log(`สรุป: ยังตอบไม่ได้ว่า deploy ได้ — ตรวจไม่ได้ ${unknowns.length} ด่าน`);
  for (const name of unknowns) console.log(`  - ${name}`);
  console.log("   รันจากที่ที่เห็น env และฐานเดียวกับแอป: docker compose ... exec web npx tsx scripts/preflight-deploy.mts");
  process.exit(2);
}
console.log(
  warnings.length
    ? `สรุป: ด่านที่เครื่องตรวจได้ผ่านครบ แต่มี ${warnings.length} เรื่องที่ต้องอ่านก่อนกด deploy`
    : "สรุป: ด่านที่เครื่องตรวจได้ผ่านครบ"
);
for (const name of warnings) console.log(`  - ${name}`);
process.exit(0);
