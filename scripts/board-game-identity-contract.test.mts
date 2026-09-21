/**
 * บัตรที่ร้านบอร์ดเกมถือไว้ค้ำกล่องเกม (`9.93`) — กฎที่ชุด pure เป็นด่านเดียวที่ยิงทุก PR
 *
 * ชุด DB (`board-game-identity-db-contract`) พิสูจน์ *พฤติกรรม* แต่ `gate.yml` รันเฉพาะ pure
 * ไฟล์นี้จึงตรึงสิ่งที่พังแล้วเงียบ:
 *
 *  - เลขเอกสารต้องไม่มีทางออกไปทางเส้นอ่านปกติ มีทางเดียวคือ `reveal` ที่มีสิทธิ์และ audit ของตัวเอง
 *  - การอ่านเลขต้องไม่มีอยู่ที่เครื่องขาย (จอที่แชร์กันและหันออกทางลูกค้า)
 *  - ด่าน "คืนบัตรก่อนจบโต๊ะ" ต้องอยู่ครบทั้งสามทางออกของโต๊ะ — ขาดทางเดียวคือมีทางเลี่ยง
 *  - purge ต้องล้างครบทุกช่อง ไม่ใช่แค่เลข
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOARD_GAME_POS_ACTIONS,
  type BoardGamePosAction,
} from "../apps/web/lib/bms/boardGamePosOperations.ts";
import {
  BOARD_GAME_IDENTITY_KINDS,
  identityNumberTail,
  normalizeIdentityNumber,
} from "../apps/web/lib/bms/boardGameIdentity.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** คอมเมนต์ในไฟล์เหล่านี้อธิบายกฎที่กำลังตรึงอยู่ — สแกนดิบแล้วคอมเมนต์จะ "ทำให้ผ่าน" ได้เอง */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * ⚠️ `assert.match(ซอร์สทั้งไฟล์, …)` พิมพ์ทั้งไฟล์ลงรายงานตอนแดงจนอ่านอะไรไม่ออก
 * (กับดักเดิมของรีโปนี้) · ทั้งสองตัวนี้เหลือไว้แค่ประโยคที่อธิบายกฎ
 */
const has = (source: string, re: RegExp, message: string) =>
  assert.ok(re.test(source), message);
const lacks = (source: string, re: RegExp, message: string) =>
  assert.ok(!re.test(source), message);

const migration = read("db/migrations/9.93__bms_board_game_identity_holds.sql");
const service = withoutComments(read("apps/web/lib/bms/boardGameIdentity.ts"));
const cafe = withoutComments(read("apps/web/lib/bms/boardGameCafe.ts"));
const pos = withoutComments(read("apps/web/lib/bms/pos.ts"));
const operations = withoutComments(read("apps/web/lib/bms/boardGamePosOperations.ts"));
const panel = withoutComments(read("apps/web/components/pos/BoardGamePanel.tsx"));
const adminRoute = withoutComments(read("apps/web/app/api/bms/board-game/identity/route.ts"));
const platform = withoutComments(read("apps/web/lib/bms/platform.ts"));

test("`9.93` has the shape every tenant-owned table in this repo needs", () => {
  const sql = migration.replace(/^\s*--.*$/gm, "");
  has(sql, /ENABLE ROW LEVEL SECURITY/, "ตารางของร้านต้องเปิด RLS");
  has(sql, /FORCE ROW LEVEL SECURITY/, "และ FORCE ไม่งั้นเจ้าของตารางข้าม policy ได้");
  has(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_identity_holds TO bms_app/, "bms_app ต้องมีสิทธิ์ ไม่งั้นทุกการเขียนใน beginTenantTx ล้มด้วย 42501");
  has(sql, /create_revision_trigger\('bms_board_game_identity_holds'\)/, "ต้องมี revision trigger เหมือนตารางหลักฐานอื่นของโมดูลนี้");
  // ผูกกับ session ของร้านเดียวกัน ไม่ใช่ id ลอย ๆ · และตายไปกับ visit นั้น
  has(sql, /FOREIGN KEY \(tenant_id, session_id\)[\s\S]{0,120}ON DELETE CASCADE/, "บัตรผูกกับ session ของร้านเดียวกัน และตายไปกับ visit นั้น");
  // ลบลูกค้าต้องไม่ถูกบล็อกด้วยบัตรที่คืนไปแล้ว (บทเรียนของ `9.92` ที่ทำให้ลบร้านไม่ได้)
  has(sql, /FOREIGN KEY \(tenant_id, customer_id\)[\s\S]{0,120}ON DELETE SET NULL/, "ลบลูกค้าต้องไม่ถูกบล็อกด้วยบัตรที่คืนไปแล้ว");
  has(sql, /uq_bms_board_game_identity_holds_take_key/, "ต้องมีคีย์กันรับบัตรซ้ำ ไม่งั้นยิงซ้ำได้บัตรใบที่สองของคนเดียวกัน");
  has(sql, /idx_bms_board_game_identity_holds_open[\s\S]{0,160}WHERE status = 'HELD'/, "คำถามประจำวันคือ \"ตอนนี้ถือบัตรใครอยู่\" — ต้องมีดัชนีบางส่วนของมัน");
  has(sql, /board_game\.identity\.reveal/, "ต้อง seed สิทธิ์อ่านเลขให้ทุกร้าน ไม่งั้นปุ่มนั้นโดน 403 เงียบ ๆ");
});

test("purging is all-or-nothing, and only after the card went back", () => {
  const sql = migration.replace(/^\s*--.*$/gm, "");
  // ล้างเลขของบัตรที่ยังอยู่ในลิ้นชักไม่ได้ — เลขคือสิ่งเดียวที่ตอบว่าใครถือของร้านไป
  has(sql, /purged_at IS NULL OR status = 'RETURNED'/, "ล้างเลขของบัตรที่ยังอยู่ในลิ้นชักไม่ได้");
  // เหลือช่องเดียวก็คือยังเก็บอยู่ · CHECK ต้องครอบทั้งสามช่อง ไม่ใช่แค่เลข
  const purge = sql.slice(sql.indexOf("bms_board_game_identity_holds_purge_is_complete"));
  for (const column of ["holder_name", "document_number_encrypted", "document_number_tail"]) {
    assert.ok(
      purge.slice(0, 400).includes(`${column} IS NULL`),
      `purge ต้องล้าง ${column} ด้วย — ข้อมูลส่วนบุคคลที่เหลือไว้ช่องเดียวก็ยังเป็นข้อมูลที่เก็บอยู่`,
    );
  }

  // และฝั่งโค้ดต้องล้างจริงในคำสั่งเดียวกับที่ประทับ purged_at
  const release = service.slice(service.indexOf("export async function releaseBoardGameIdentityHold"));
  const update = release.slice(release.indexOf("UPDATE bms_board_game_identity_holds"), release.indexOf("auditInTx"));
  for (const column of ["holder_name = NULL", "document_number_encrypted = NULL", "document_number_tail = NULL"]) {
    assert.ok(update.includes(column), `การคืนบัตรต้องล้าง ${column} ในคำสั่งเดียวกัน`);
  }
  assert.ok(update.includes("purged_at ="), "คืนบัตรแล้วต้องประทับว่า purge ไปแล้ว");
});

test("the stored number has exactly one way out, and it is the audited one", () => {
  // ที่เดียวที่อ่านคอลัมน์เลขออกมาเป็น "ค่า" ได้คือตัว reveal · ที่อื่นอ่านได้แค่ว่า
  // "มีเลขไหม" (boolean) เขียนตอนรับบัตร หรือล้างตอนคืนบัตร
  const revealAt = service.indexOf("export async function revealBoardGameIdentityNumber");
  assert.ok(revealAt > 0);
  for (const source of [service, cafe]) {
    for (const match of source.matchAll(/document_number_encrypted/g)) {
      if (source === service && match.index! > revealAt) continue;
      const line = source.slice(
        source.lastIndexOf("\n", match.index!) + 1,
        source.indexOf("\n", match.index!),
      ).trim();
      const isBoolean = line.includes("IS NOT NULL");
      const isPurge = line.includes("= NULL");
      const isInsertColumnList = line.startsWith("document_number_encrypted, document_number_tail");
      assert.ok(
        isBoolean || isPurge || isInsertColumnList,
        `เลขเอกสารถูกอ่านออกมานอกทาง reveal: ${line}`,
      );
    }
  }

  // รูปที่ client เห็นต้องไม่มีช่องสำหรับเลขเต็มเลย
  assert.doesNotMatch(service.slice(
    service.indexOf("export type BoardGameIdentityHold"),
    service.indexOf("const MAX_NUMBER_LENGTH"),
  ), /documentNumber\s*:/, "รูปที่ส่งให้ client ต้องไม่มีเลขเต็ม มีได้แค่สี่ตัวท้าย");

  // ถอดรหัสได้ที่เดียว และที่นั่นต้องลง audit
  const decryptSites = [...service.matchAll(/decryptSecret\(/g)];
  assert.equal(decryptSites.length, 1, "ถอดรหัสได้ที่เดียวเท่านั้น");
  const reveal = service.slice(service.indexOf("export async function revealBoardGameIdentityNumber"));
  assert.ok(reveal.includes("decryptSecret("), "ที่นั่นต้องเป็น reveal");
  has(reveal, /auditInTx\([\s\S]{0,200}board_game\.identity_hold_reveal/,
    "ทุกครั้งที่อ่านเลขต้องเหลือร่องรอย — ไม่งั้นกฎ \"เป็นการกระทำที่พิเศษ\" ตรวจสอบไม่ได้");
  // เข้ารหัสก่อนแตะฐานเสมอ
  has(service, /encryptSecret\(documentNumber\)/, "เลขต้องถูกเข้ารหัสก่อนแตะฐานเสมอ");
});

test("reading the number is a permission of its own, and never at the register", () => {
  has(adminRoute, /requirePermission\(auth\.ctx, "board_game\.identity\.reveal"\)/, "route ที่อ่านเลขต้องบังคับสิทธิ์ของตัวเอง");
  // รับ/คืนบัตรใช้สิทธิ์จัดการโต๊ะ — คนหน้าเคาน์เตอร์มีอยู่แล้ว
  for (const action of ["identity.hold", "identity.release"] as BoardGamePosAction[]) {
    const spec = BOARD_GAME_POS_ACTIONS[action];
    assert.equal(spec.permission, "board_game.session.manage", `${action} ใช้สิทธิ์ผิดตัว`);
    assert.deepEqual(spec.extraPermissions({}), []);
    assert.equal(spec.requiresOpenShift, false,
      `${action} ไม่ควรบังคับกะเปิด — บัตรไม่ใช่เงินหรือของในกะ และบัตรค้างข้ามกะได้`);
  }
  // เครื่องขายต้องเอื้อมไม่ถึงการอ่านเลข ทั้งในตารางคำสั่งและบนจอ
  assert.ok(
    !Object.keys(BOARD_GAME_POS_ACTIONS).some((action) => action.includes("reveal")),
    "เครื่องขายต้องไม่มีคำสั่งอ่านเลขบัตร",
  );
  // ...และห้ามเอื้อมถึงด้วยชื่ออื่น — กฎคือ "ตัวถอดรหัสไม่มีผู้เรียกฝั่งเครื่องขาย"
  // ไม่ใช่ "ไม่มีคำสั่งที่ชื่อมีคำว่า reveal"
  lacks(operations, /revealBoardGameIdentityNumber/,
    "โมดูลคำสั่งของเครื่องขายต้องไม่เรียกตัวอ่านเลขบัตรเลย ไม่ว่าจะตั้งชื่อคำสั่งว่าอะไร");
  lacks(
    withoutComments(read("apps/web/app/api/pos/board-game/route.ts")), /reveal/i,
    "route ของเครื่องขายต้องไม่มีทางอ่านเลขบัตร",
  );
  lacks(panel, /identity\.reveal|documentNumber\b(?!:)/,
    "จอเครื่องขายหันออกทางลูกค้า — ห้ามมีทางอ่านเลขเต็มที่นั่น");
  has(panel, /'identity\.hold'/, "เบราว์เซอร์ต้องรับบัตรได้");
  has(panel, /'identity\.release'/, "และคืนบัตรได้");
});

test("a card must go back before the visit can end, through every exit a table has", () => {
  // ทางออกของโต๊ะมีสามทาง: ปิดกลุ่มสุดท้าย · ปิดทั้งโต๊ะ · ยกเลิกโต๊ะ
  // ขาดทางเดียวคือมีทางเลี่ยง — ยกเลิกโต๊ะที่ไม่ตรวจบัตรทำให้ด่านอีกสองทางไร้ความหมาย
  const gates = [...cafe.matchAll(
    /const heldDocuments = await client\.query\([\s\S]{0,260}?bms_board_game_identity_holds[\s\S]{0,160}?status = 'HELD'/g,
  )];
  assert.equal(gates.length, 3, "ด่านคืนบัตรต้องอยู่ครบทั้งสามทางออกของโต๊ะ");
  const thrown = [...cafe.matchAll(/heldDocuments\.rowCount\) throw new Error\("([^"]+)"/g)]
    .map((match) => match[1]);
  assert.equal(thrown.length, 3);
  for (const message of thrown) {
    assert.match(message, /บัตร/, "ข้อความต้องบอกว่าติดเรื่องบัตร ไม่ใช่ล้มเฉย ๆ");
  }
  // ด่านกลุ่มสุดท้ายต้องอยู่ในกิ่ง "ไม่มีกลุ่มอื่นเปิดอยู่" เดียวกับกล่องเกม — ไม่งั้นกลุ่มที่
  // จ่ายก่อนแล้วกลับบ้านจะถูกบล็อกด้วยบัตรของคนที่ยังเล่นอยู่
  const groupClose = cafe.slice(cafe.indexOf("export async function closeBoardGameBillingGroupForBilling"));
  const branch = groupClose.slice(groupClose.indexOf("if (!otherOpenGroups.length) {"));
  assert.ok(
    branch.indexOf("bms_board_game_identity_holds") < branch.indexOf("closeOpenBillingGroupInTx"),
    "ด่านบัตรของการปิดกลุ่มต้องอยู่ในกิ่งกลุ่มสุดท้าย ก่อนที่ยอดจะถูกแช่",
  );
});

test("a hold cannot arrive after billing starts, and final POS settlement has a defensive guard", () => {
  const take = service.slice(
    service.indexOf("export async function takeBoardGameIdentityHold"),
    service.indexOf("export async function releaseBoardGameIdentityHold"),
  );
  has(take, /status = 'OPEN'/, "รับบัตรได้เฉพาะ session ที่ยัง OPEN");
  lacks(take, /status IN \('OPEN','CLOSING'\)/,
    "CLOSING ผ่านด่านคืนบัตรมาแล้ว ห้ามสอดบัตรเข้ามาทีหลัง");
  has(take, /status = 'CHECKED_OUT'/,
    "ถ้าผูกใบยืม ต้องเป็นกล่องที่ยังอยู่กับโต๊ะ ไม่ใช่ประวัติที่คืนแล้ว");

  const boardGamePayment = pos.slice(pos.indexOf("async function finalizePosSale"));
  const sessionLockAt = boardGamePayment.indexOf("FROM bms_board_game_sessions");
  const groupLockAt = boardGamePayment.indexOf("FROM bms_board_game_billing_groups", sessionLockAt);
  const orderLockAt = boardGamePayment.indexOf("FROM bms_orders", groupLockAt);
  assert.ok(sessionLockAt >= 0 && sessionLockAt < groupLockAt && groupLockAt < orderLockAt,
    "POS ต้องล็อก session → group → order ให้ตรงกับ close/cancel เพื่อไม่ deadlock");
  has(boardGamePayment, /bms_board_game_identity_holds[\s\S]{0,160}status = 'HELD'/,
    "การจ่ายกลุ่มสุดท้ายต้องมีด่านป้องกันข้อมูล HELD เก่าด้วย");
});

test("the card number staff type is normalized the same way every time", () => {
  // บัตรใบเดียวที่พิมพ์คนละครั้งต้องได้สี่ตัวท้ายชุดเดียวกัน ไม่งั้นหาบัตรในลิ้นชักไม่เจอ
  assert.equal(normalizeIdentityNumber("1-2345-67890-12-3"), "1234567890123");
  assert.equal(normalizeIdentityNumber(" 1234 5678 9012 3 "), "1234567890123");
  assert.equal(normalizeIdentityNumber("ab123456"), "AB123456");
  assert.equal(normalizeIdentityNumber(""), null);
  assert.equal(normalizeIdentityNumber("   "), null);
  assert.equal(normalizeIdentityNumber(null), null);
  assert.throws(() => normalizeIdentityNumber("12/34"), /เลขเอกสาร/);
  assert.throws(() => normalizeIdentityNumber("1".repeat(41)), /ยาวเกินไป/);

  assert.equal(identityNumberTail("1234567890123"), "0123");
  assert.equal(identityNumberTail("12"), "12");
  assert.equal(identityNumberTail(null), null);
  // สี่ตัวท้ายของรูปที่ normalize แล้วเท่านั้น — ขีดจะทำให้สองครั้งได้คนละคำตอบ
  assert.equal(
    identityNumberTail(normalizeIdentityNumber("1-2345-67890-12-3")),
    identityNumberTail(normalizeIdentityNumber("1234567890123")),
  );
  assert.deepEqual([...BOARD_GAME_IDENTITY_KINDS], [
    "NATIONAL_ID", "PASSPORT", "STUDENT_ID", "DRIVER_LICENSE", "OTHER",
  ]);
});

test("a shop that sold a member pass can still be deleted", () => {
  // `9.92` ผูกสัญญาไว้กับ `bms_customers` และ `users` แบบ RESTRICT โดยไม่มีอะไร cascade ให้
  // ก่อนสองตารางนั้นถูกลบ → ลบร้านไม่ได้เลย และ error พูดถึง `bms_customers` ซึ่งไม่ได้บอกอะไร
  const order = (needle: string) => platform.indexOf(needle);
  assert.ok(order("DELETE FROM bms_board_game_member_passes") > 0,
    "ต้องปลดสัญญาแพ็กเกจก่อนลบลูกค้า ไม่งั้นร้านที่เคยขายแพ็กเกจลบไม่ได้");
  assert.ok(
    order("DELETE FROM bms_board_game_member_passes") < order("DELETE FROM bms_customers"),
    "ต้องลบก่อน bms_customers",
  );
  assert.ok(
    order("DELETE FROM bms_board_game_member_passes") < order("DELETE FROM users"),
    "และก่อน users (issued_by เป็น RESTRICT เหมือนกัน)",
  );
  // บัตรไม่ต้องมีบรรทัดของตัวเอง — cascade จาก session ที่ถูกลบก่อนหน้า
  assert.ok(
    order("DELETE FROM bms_board_game_sessions") < order("DELETE FROM bms_customers"),
    "บัตรอาศัย cascade ของ session ซึ่งต้องถูกลบก่อนลูกค้า",
  );
});
