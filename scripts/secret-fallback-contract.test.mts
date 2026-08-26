// =============================================================
// ความลับต้องไม่ fallback ไปค่าที่อยู่ในซอร์สเมื่อรัน production
// -------------------------------------------------------------
// `process.env.X || "some-literal"` อ่านดูเหมือนความสะดวกสำหรับ dev แต่กับคีย์ที่
// ใช้เซ็น session มันหมายถึง: instance ที่ลืมตั้ง env จะเซ็น token ด้วยค่าคงที่ที่
// ใครอ่าน repo ก็รู้ → ปั้น session แอดมินของร้านไหนก็ได้เอง
//
// ยืนยันแล้วว่าเกิดจริง: container `bms-web-1` (dev) รันโดยไม่มี JWT_SECRET
// จึงใช้ "changeme_secret" — ใช้ช่องนี้ทดสอบ cross-tenant ของ 9.27 ได้จริง
//
// เทสนี้อ่านซอร์ส ไม่ต้องมี DB/เซิร์ฟเวอร์:
//   1. ทุกที่ที่ resolve ความลับต้องมีทางล้มเมื่อ NODE_ENV=production
//   2. ห้ามมีการประกาศ `const X = process.env.SECRET || "literal"` ที่ระดับโมดูล
//      (ค่านั้นถูกใช้ได้ทันทีโดยไม่ผ่านการตรวจ)
//
// Run from apps/web:
//   npx tsx --test ../../scripts/secret-fallback-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** ทุกไฟล์ที่ resolve ความลับ พร้อม env ที่มันดูแล */
const SECRET_RESOLVERS: Array<{ file: string; env: string }> = [
  { file: "apps/web/lib/auth/token.ts", env: "JWT_SECRET" },
  { file: "apps/web/lib/bms/crypto.ts", env: "BMS_SECRET_KEY" },
  { file: "apps/web/lib/bms/checkoutToken.ts", env: "BMS_CHECKOUT_SECRET" },
  { file: "apps/ws/src/ws.ts", env: "JWT_SECRET" },
];

for (const { file, env } of SECRET_RESOLVERS) {
  test(`${file} ล้มเมื่อไม่มี ${env} บน production`, () => {
    const src = read(file);
    assert.match(
      src,
      /process\.env\.NODE_ENV === "production"/,
      "ต้องแยกพฤติกรรม production ออกจาก dev"
    );
    assert.match(src, /throw new Error\(/, "production ที่ไม่มีความลับต้อง throw");
  });
}

test("ห้ามประกาศความลับเป็น const ระดับโมดูลพร้อม fallback เป็นสตริง", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git", "dist"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        src.split("\n").forEach((line, i) => {
          // จับเฉพาะการผูกค่าไว้กับตัวแปร ไม่ใช่การอ่าน env มาเทียบเฉย ๆ
          if (/^\s*(export\s+)?const\s+\w*(SECRET|KEY|TOKEN|PASSWORD)\w*\s*=\s*process\.env\.\w+\s*\|\|\s*["'`]/i.test(line)) {
            offenders.push(`${path.relative(ROOT, full)}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }
  };
  walk(path.join(ROOT, "apps"));
  assert.deepEqual(
    offenders,
    [],
    "ความลับที่ผูกไว้กับ const จะถูกใช้ได้เลยโดยไม่ผ่านการตรวจ production:\n" + offenders.join("\n")
  );
});

test("token.ts ไม่ export ค่าความลับตรง ๆ ให้ใครหยิบไปใช้", () => {
  const src = read("apps/web/lib/auth/token.ts");
  assert.doesNotMatch(
    src,
    /export const JWT_SECRET/,
    "export เป็น const = ผู้เรียกได้ค่า fallback โดยไม่ผ่าน jwtSecret()"
  );
  assert.match(src, /export function jwtSecret\(\)/, "ต้องเป็นฟังก์ชันเพื่อให้ตรวจตอนใช้");
});

test("การตรวจต้องเกิดตอนใช้ ไม่ใช่ตอน import (ไม่งั้น next build ล้ม)", () => {
  const src = read("apps/web/lib/auth/token.ts");
  const fnStart = src.indexOf("export function jwtSecret()");
  assert.ok(fnStart > 0, "ต้องมี jwtSecret()");
  const beforeFn = src.slice(0, fnStart);
  assert.doesNotMatch(
    beforeFn,
    /^\s*throw new Error/m,
    "ห้าม throw ที่ระดับโมดูล — โมดูลนี้ถูก import ตอน build ด้วย"
  );
});
