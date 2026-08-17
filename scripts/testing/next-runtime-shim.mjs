// =============================================================
// Node resolve hook สำหรับรัน contract test ที่ import โค้ดฝั่ง server ของ Next
// -------------------------------------------------------------
// `import "server-only"` เป็น guard ตอน build ของ Next (พังทันทีถ้าไฟล์นั้นถูก
// รวมเข้า client bundle) แต่ตอนรันไม่ทำอะไรเลย และแพ็กเกจนี้ไม่ได้ติดตั้งใน
// node_modules ของโปรเจกต์ — เทสที่ import ผ่าน lib/mailer.ts จึงพังที่ resolve
//
// เลือกทำเป็น loader เฉพาะตอนเทส ไม่ใส่ใน tsconfig paths เพราะถ้าใส่ Next จะ
// resolve stub นี้แทนของจริงแล้ว guard ฝั่ง client หายไปเงียบ ๆ
//
// ใช้:
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs --test ...
// =============================================================

import { register } from "node:module";
import { pathToFileURL } from "node:url";

const STUBBED = new Set(["server-only", "client-only"]);

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const STUBBED = new Set(${JSON.stringify([...STUBBED])});
      export async function resolve(specifier, context, next) {
        if (STUBBED.has(specifier)) {
          return { url: "data:text/javascript,export {};", shortCircuit: true, format: "module" };
        }
        return next(specifier, context);
      }
    `),
  pathToFileURL("./")
);
