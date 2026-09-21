/**
 * โต๊ะ/เวลาเล่นบอร์ดเกมที่ "เครื่องขาย" — เบราว์เซอร์กับแอป RN ต้องตัดสินเหมือนกัน
 * ===========================================================================
 * งานเดียวกันนี้เข้าถึงได้สองทาง: GraphQL (`bmsPosBoardGame*` ของแอป RN) กับ REST
 * (`/api/pos/board-game` ของจอ `/pos` ซึ่งไม่มี Apollo provider โดยตั้งใจ) · สองทางนั้น
 * ต่างกันได้แค่ "ยืนยันตัวตนยังไง" กับ "คืน error หน้าตาไหน" ที่เหลือต้องเป็นของชุดเดียว
 *
 * ไฟล์นี้ตรึงสามอย่างที่ถ้า drift แล้วไม่มีใครเห็น:
 *   1. **สิทธิ์** — ตารางเดียว ไม่ใช่ลิสต์ที่แต่ละ adapter เขียนเอง
 *   2. **การปฏิเสธตามกติกาเป็นคำตอบ ไม่ใช่ 500** — และบั๊ก/ฐานข้อมูลล้มต้องยังเป็น 500
 *   3. **เบราว์เซอร์เอื้อมถึงทุกคำสั่งที่เขียนข้อมูลได้** — คำสั่งที่มีแต่ใน RN คือฟีเจอร์ที่
 *      ร้านซึ่งใช้เบราว์เซอร์อย่างเดียวไม่มีทางใช้ได้เลย โดยไม่มีอะไรฟ้อง
 *   4. **และแอปก็เอื้อมถึงทุกคำสั่งเหมือนกัน** — ด่านข้อ 3 ตรวจทางเดียวมาตลอด `tab.add`/
 *      `tab.remove` จึงอยู่ในตารางตั้งแต่ `9.90` โดยไม่มี mutation ให้แอปเรียกเลยจนถึง `9.94`
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureBmsGraphqlErrorCode } from "../apps/web/graphql/mobileErrorContract";
import {
  BOARD_GAME_POS_ACTIONS,
  BoardGamePosError,
  boardGameRejectionFrom,
  isBoardGamePosAction,
  isBoardGamePosError,
  type BoardGamePosAction,
} from "../apps/web/lib/bms/boardGamePosOperations";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IdempotencyConflictError,
} from "../apps/web/lib/bms/idempotencyErrors";
import { resolveScanContext } from "../apps/web/lib/pos/scanManager";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * ไฟล์ `.ts`/`.tsx` ทั้งหมดใต้โฟลเดอร์หนึ่ง — ข้าม `node_modules`/`.next` ซึ่งไม่ใช่ซอร์สของเรา
 *
 * ใช้เดินหาผู้เรียกที่ยังไม่มีอยู่: กฎที่ตรวจเฉพาะไฟล์ที่เทสพิมพ์ชื่อไว้เองจะไม่มีวันรู้ว่ามี
 * adapter ตัวที่สามเพิ่มเข้ามา ซึ่งเป็นรูปของความล้มเหลวที่เงียบที่สุดในรีโปนี้
 */
function typescriptFilesUnder(relative: string): string[] {
  const root = fileURLToPath(new URL(relative, import.meta.url));
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  assert.ok(found.length > 0, `${relative} must contain TypeScript sources to scan`);
  return found;
}

const operations = read("../apps/web/lib/bms/boardGamePosOperations.ts");
const restRoute = read("../apps/web/app/api/pos/board-game/route.ts");
const posResolvers = read("../apps/web/graphql/bmsPosDevice.ts");
const panel = read("../apps/web/components/pos/BoardGamePanel.tsx");
const registerPage = read("../apps/web/app/(pos)/pos/page.tsx");
const saleRestRoute = read("../apps/web/app/api/pos/sale/route.ts");
const posRouteHelpers = read("../apps/web/lib/bms/posRouteHelpers.ts");

/**
 * คอมเมนต์ในไฟล์เหล่านี้อธิบายกฎที่เทสตรึงอยู่ การสแกนซอร์สดิบจึงทำให้คอมเมนต์ "ทำให้ผ่าน"
 * หรือ "ทำให้แดง" ได้เอง — กับดักเดิมของเทสสแกนซอร์สในรีโปนี้ · ไฟล์มีทั้ง CRLF และ LF
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const actions = Object.keys(BOARD_GAME_POS_ACTIONS) as BoardGamePosAction[];

/**
 * "คำสั่งที่เขียนข้อมูล" อ่านจากตัว dispatcher จริง ไม่ใช่ลิสต์ที่เทสพิมพ์เอง — ลิสต์ที่เทส
 * ถือเองจะไม่มีวันรู้ว่ามีคำสั่งใหม่เพิ่มเข้ามา ซึ่งเป็นรูปของความล้มเหลวที่เงียบที่สุด
 */
function writeActions(): BoardGamePosAction[] {
  const clean = withoutComments(operations);
  const at = clean.indexOf("export async function runBoardGamePosMutation");
  assert.ok(at >= 0, "runBoardGamePosMutation must exist");
  // `case "a":` ที่ fall-through ลงไปยัง body ของ `case "b": {` ก็คือคำสั่งที่ dispatcher รับไว้
  // เหมือนกัน · การบังคับให้มี `{` ต่อท้ายทำให้คำสั่งที่ใช้ body ร่วมกันหายไปจากงบทั้งหมดเงียบ ๆ
  const found = [...clean.slice(at).matchAll(/case "([a-z.]+)":/g)].map(
    (match) => match[1],
  );
  assert.ok(found.length > 0, "the dispatcher must handle at least one action");
  for (const action of found) {
    assert.ok(
      isBoardGamePosAction(action),
      `the dispatcher handles "${action}" which is not a declared action`,
    );
  }
  return found as BoardGamePosAction[];
}

/**
 * ชื่อคำสั่งที่ปุ่มบนจอส่งเข้า `run(ชื่องาน, คำสั่ง, payload)` — อ่าน **อาร์กิวเมนต์ที่สอง**
 * ทั้งก้อน ไม่ใช่จับ literal ที่อยู่ติดกับคอมมา · ปุ่มเดียวเลือกคำสั่งด้วยเงื่อนไขได้
 * (ย้ายโต๊ะ/รวมโต๊ะใช้ปุ่มเดียวกัน) และ regex ที่อ่านไม่ออกจะรายงานว่าเบราว์เซอร์เอื้อมไม่ถึง
 * ทั้งที่ปุ่มอยู่ตรงนั้น — หรือแย่กว่านั้น เงียบไปเมื่อคำสั่งจริงหายไป
 */
function runActionArguments(clean: string): string[] {
  const args: string[] = [];
  for (const match of clean.matchAll(/\brun\(/g)) {
    let depth = 0;
    let comma = 0;
    let start = -1;
    for (let i = match.index! + match[0].length; i < clean.length; i += 1) {
      const ch = clean[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === "," && depth === 0) {
        comma += 1;
        if (comma === 1) start = i + 1;
        else if (comma === 2) {
          args.push(clean.slice(start, i));
          start = -1;
          break;
        }
      }
    }
    assert.ok(start === -1, "run(...) must pass a name, an action and a payload");
  }
  assert.ok(args.length > 0, "the register panel must call run(...) somewhere");
  return args;
}

test("every board-game command decides its permissions in one table, not per surface", () => {
  const rest = withoutComments(restRoute);
  const graphql = withoutComments(posResolvers);

  for (const [label, source] of [
    ["the REST adapter", rest],
    ["the GraphQL adapter", graphql],
  ] as const) {
    assert.match(
      source,
      /BOARD_GAME_POS_ACTIONS/,
      `${label} must read the shared permission table`,
    );
    // สิทธิ์ที่เขียนไว้ในตัว adapter = ตัวตัดสินชุดที่สอง วันที่กติกาเปลี่ยน อีกฝั่งจะยัง
    // อนุญาตของเดิมโดยไม่มีอะไรฟ้อง
    assert.doesNotMatch(
      source,
      /"board_game\.[a-z_.]+"/,
      `${label} must not name a board-game permission of its own`,
    );
  }

  // ทางลัดเข้า service ตรง ๆ คือทางที่ข้ามทั้งตารางสิทธิ์และด่านสาขา
  assert.doesNotMatch(
    graphql,
    /from "@\/lib\/bms\/boardGameCafe"/,
    "the GraphQL adapter must reach the service only through the shared operations",
  );
  assert.doesNotMatch(
    rest,
    /from "@\/lib\/bms\/boardGameCafe"/,
    "the REST adapter must reach the service only through the shared operations",
  );
});

test("an open shift is required exactly where the money lands in that shift", () => {
  const requiring = actions
    .filter((action) => BOARD_GAME_POS_ACTIONS[action].requiresOpenShift)
    .sort();
  // เปิดโต๊ะประทับเครื่อง/กะลง session · ปิดเวลาคือการออกยอดให้กะนั้นเก็บเงิน
  // สั่ง/เอาของออกจากบิล (`9.90`) จองและปล่อยสต็อกจริงในกะนั้น จึงต้องมีกะเปิดเหมือนกัน
  // ที่เหลือเป็นการแก้รายการของโต๊ะที่เปิดไปแล้ว การบังคับกะจะทำให้แก้ข้ามกะไม่ได้
  assert.deepEqual(requiring, [
    "close", "group.close", "group.merge", "open", "tab.add", "tab.remove", "waitlist.seat",
  ]);
});

test("reading the floor needs the library, and an odd return needs the library owner", () => {
  const plain = { copyStatus: "AVAILABLE" } as Record<string, unknown>;
  assert.deepEqual(BOARD_GAME_POS_ACTIONS.workspace.extraPermissions({}), [
    "board_game.library.view",
  ]);
  assert.deepEqual(
    BOARD_GAME_POS_ACTIONS["copy.checkout"].extraPermissions({}),
    ["board_game.library.view"],
  );

  const ret = BOARD_GAME_POS_ACTIONS["copy.return"];
  // รับคืนตามปกติ/ส่งไปตรวจ = งานประจำของคนหน้าเคาน์เตอร์
  assert.deepEqual(ret.extraPermissions(plain), []);
  assert.deepEqual(ret.extraPermissions({ copyStatus: "needs_check" }), []);
  assert.deepEqual(ret.extraPermissions({}), []);
  // ตั้งกล่องเป็นหาย/เสียหาย = ตัดสินใจเรื่องทรัพย์สินของร้าน
  assert.deepEqual(ret.extraPermissions({ copyStatus: "LOST" }), [
    "board_game.library.manage",
  ]);
  assert.deepEqual(ret.extraPermissions({ copyStatus: "RETIRED" }), [
    "board_game.library.manage",
  ]);
});

test("a rule rejection is a decision; a bug or a database failure is still a 500", () => {
  const rule = boardGameRejectionFrom(new Error("โต๊ะนี้มีคนนั่งอยู่แล้ว"));
  assert.ok(rule && isBoardGamePosError(rule));
  assert.equal(rule.reason, "REJECTED");
  assert.equal(rule.message, "โต๊ะนี้มีคนนั่งอยู่แล้ว");

  const declared = new BoardGamePosError("ไม่พบโต๊ะในสาขานี้", "NOT_FOUND");
  assert.equal(boardGameRejectionFrom(declared), declared);

  // ทั้งสามตัวนี้ต้องหลุดไปตามเดิม — รายงานว่า "คนหน้าเครื่องทำผิด" คือการกลบต้นเหตุ
  assert.equal(boardGameRejectionFrom(new TypeError("x is not a function")), null);
  assert.equal(
    boardGameRejectionFrom(Object.assign(new Error("relation missing"), { code: "42P01" })),
    null,
  );
  assert.equal(boardGameRejectionFrom(new Error("   ")), null);
  // คีย์ซ้ำมีคลาสและรหัสของตัวเองอยู่แล้ว
  assert.equal(
    boardGameRejectionFrom(new IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE, "open")),
    null,
  );
});

test("the GraphQL formatter answers a board-game rejection with a client code", () => {
  const formatted = (error: unknown) =>
    ensureBmsGraphqlErrorCode(
      { message: String((error as Error)?.message ?? error) },
      { originalError: error },
    );

  assert.equal(
    formatted(new BoardGamePosError("เวลาไม่ถูกต้อง", "BAD_INPUT")).extensions?.code,
    "BAD_USER_INPUT",
  );
  assert.equal(
    formatted(new BoardGamePosError("ไม่พบโต๊ะ", "NOT_FOUND")).extensions?.code,
    "NOT_FOUND",
  );
  // กติกาไม่ให้ทำ = ต้องไปดูของจริงก่อน ไม่ใช่ยิงซ้ำด้วยคีย์เดิมตามที่ INTERNAL_SERVER_ERROR สั่ง
  const rejected = formatted(new BoardGamePosError("โต๊ะถูกปิดไปแล้ว"));
  assert.equal(rejected.extensions?.code, "CONFLICT");
  assert.equal(rejected.extensions?.reason, "BOARD_GAME_REJECTED");

  // ของที่พังจริงต้องยังเป็น 500 ที่มี stack ใน system_logs
  assert.equal(
    formatted(new TypeError("boom")).extensions?.code,
    "INTERNAL_SERVER_ERROR",
  );
});

test("the REST adapter answers a rejection with its reason instead of a masked 500", () => {
  const clean = withoutComments(restRoute);
  assert.match(clean, /isBoardGamePosError\(error\)/);
  assert.match(clean, /error\.reason === "BAD_INPUT" \? 400/);
  assert.match(clean, /error\.reason === "NOT_FOUND" \? 404 : 409/);
  assert.match(clean, /isIdempotencyConflictError\(error\)/);
  // ที่เหลือต้องหลุดไปให้ตัวจัดการกลาง ซึ่งบันทึก stack ไว้ใน system_logs
  assert.match(clean, /\n\s*throw error;\n/);

  // PIN ห้ามไปโผล่ใน access log — ทั้งไฟล์ต้องไม่มีทาง GET และต้องอ่าน PIN จาก body
  assert.doesNotMatch(clean, /export const GET/);
  assert.match(clean, /export const POST = withRouteErrorLog\(/);
  assert.match(clean, /body\.pin/);
  assert.match(clean, /verifyCashierPin\(/);
  assert.match(clean, /cashierHasPermission\(/);
  assert.match(clean, /getOpenPosShift\(/);
  assert.match(clean, /authenticatePosDevice\(/);
  // tenant/สาขามาจากเครื่องที่ยืนยันตัวตนแล้วเท่านั้น ห้ามรับจาก body
  assert.doesNotMatch(clean, /body\.(tenantId|locationId|deviceId)/);
});

test("the browser register reaches every board-game command that writes", () => {
  const clean = withoutComments(panel);
  const used = new Set<string>([
    ...[...clean.matchAll(/call\(\s*'([a-z.]+)'/g)].map((match) => match[1]),
    ...runActionArguments(clean).flatMap(
      (argument) => [...argument.matchAll(/'([a-z.]+)'/g)].map((match) => match[1]),
    ),
  ]);

  // คำสั่งที่พิมพ์ผิดจะถูก route ปฏิเสธเป็น 400 ตอนมีคนกดจริงเท่านั้น
  for (const action of used) {
    assert.ok(
      isBoardGamePosAction(action),
      `the register panel calls "${action}" which the shared table does not declare`,
    );
  }

  const missing = writeActions().filter((action) => !used.has(action));
  assert.deepEqual(
    missing,
    [],
    "every writing command must be reachable from the browser register, not only from the app",
  );

  // อ่านผังโต๊ะ/โต๊ะที่เปิดอยู่ผ่านเส้นเดียวกับ RN
  assert.ok(used.has("workspace") && used.has("session"));
});

test("the board-game tab belongs to the cafe archetype and never steals the scanner", () => {
  const clean = withoutComments(registerPage);
  assert.match(clean, /\{ key: "boardgame", label: "[^"]+" \}/);
  assert.match(
    clean,
    /item\.key === "boardgame"\) return archetype === "board_game_cafe"/,
    "the tab must be gated by the shop archetype",
  );
  assert.match(clean, /<BoardGamePanel/);
  // ปิดเวลาแล้วต้องส่งบิลไปเก็บเงินที่แท็บขาย ไม่ใช่คิดเงินซ้ำในแท็บนี้ · สิ่งที่ส่งต่อคือ
  // **กลุ่มบิล** (`9.89`) ไม่ใช่โต๊ะ — โต๊ะที่แยกบิลมีหลายใบ การส่ง id ของโต๊ะไปจึงกำกวม
  assert.match(clean, /setBoardGameCheckoutId\(billingGroupId\);/);
  assert.doesNotMatch(clean, /boardGameSessionId/);

  const base = {
    lookupMode: false,
    blindReturnOpen: false,
    hasPendingSale: false,
    busy: false,
    blockingOverlayOpen: false,
  } as const;
  // แท็บนี้ไม่มีอะไรให้ยิงบาร์โค้ด — ปล่อยให้สแกนเนอร์ติดอาวุธไว้คือการยิงของเข้าตะกร้า
  // ของแท็บอื่นโดยที่คนหน้าเครื่องไม่เห็นว่ามันไปไหน
  assert.equal(resolveScanContext({ ...base, tab: "boardgame" }), "DISABLED");
});

test("the native register reaches every board-game command that writes", () => {
  const clean = withoutComments(posResolvers);
  // ชื่อคำสั่งอ่านจาก **ด่านสิทธิ์** ของ resolver จริง ไม่ใช่ลิสต์ที่เทสพิมพ์เอง · ตัว
  // `mobile-graphql-contract` บังคับอยู่แล้วว่า resolver ต้อง execute คำสั่งเดียวกับที่ขออนุญาต
  // และ SDL กับ resolver ต้องตรงกันสองทิศ ดังนั้นการนับจากตรงนี้ = การนับจาก mutation ที่มีจริง
  const used = new Set(
    [...clean.matchAll(/boardGamePosAccess\(\s*ctx\s*,\s*args\.input\s*,\s*"([a-z.]+)"/g)]
      .map((match) => match[1]),
  );
  for (const action of used) {
    assert.ok(
      isBoardGamePosAction(action),
      `the native adapter authorizes "${action}" which the shared table does not declare`,
    );
  }

  // ⚠️ ด้านกลับของเทสตัวบน · `tab.add`/`tab.remove` มีตั้งแต่ `9.90` แต่เพิ่งมี mutation
  // ตอน `9.94` — ตลอดช่วงนั้นแอปแสดงของบนบิลไม่ได้และสั่งของเข้าบิลไม่ได้เลย โดยไม่มีอะไรฟ้อง
  // เพราะด่านที่มีอยู่ตรวจแต่ฝั่งเบราว์เซอร์
  const missing = writeActions().filter((action) => !used.has(action));
  assert.deepEqual(
    missing,
    [],
    "every writing command must be reachable from the native register, not only from the browser",
  );
});

test("a board-game bill with nothing left to pay can be settled from both registers", () => {
  // `9.92`: แพ็กเกจสมาชิกครอบคลุมค่าเล่นได้เต็มจำนวน บิลจึงเป็น ฿0 จริงและไม่มีอะไรให้รับ ·
  // `recordPosSale()` ยกเว้นด่าน "ต้องระบุการชำระเงิน" ให้ตั้งแต่ `9.92` แต่ตัวแยก payload
  // ของแต่ละ adapter ปฏิเสธก่อนถึง service — ข้อยกเว้นจึงต้องอยู่ที่ **ทุกขอบ** ไม่ใช่ที่ service
  // อย่างเดียว ไม่งั้นเบราว์เซอร์ (ซึ่งส่ง `payments: []` เมื่อยอดเป็นศูนย์) เก็บบิลไม่ได้เลยสักใบ
  for (const [label, source] of [
    ["the browser register route", withoutComments(saleRestRoute)],
    ["the native register adapter", withoutComments(posResolvers)],
  ] as const) {
    // เล็งจาก "จุดที่รู้แล้วว่ากำลังเก็บบิลบอร์ดเกมใบไหน" ไม่ใช่ `parsePosPayments` ตัวแรกของไฟล์ —
    // ไฟล์ของ adapter มีผู้เรียกตัวแยกนี้หลายจุด (มัดจำ/บิลโต๊ะ) ที่ต้องเข้มเหมือนเดิม
    const scopeAt = source.indexOf("boardGameBillingGroupId = ");
    assert.ok(scopeAt > 0, `${label} must derive the board-game bill it is settling`);
    const at = source.indexOf("parsePosPayments(", scopeAt);
    assert.ok(at > scopeAt, `${label} must parse its payment rows on the sale path`);
    assert.ok(
      /allowEmpty:\s*Boolean\(boardGameBillingGroupId\)/.test(source.slice(at, at + 200)),
      `${label} must let a zero-total board-game bill settle with no payment rows`,
    );
  }

  // ⚠️ ด่านนี้กว้างกว่าสอง adapter โดยตั้งใจ — ทางลัดที่จะทำให้บิลค้าปลีกที่ไม่มีใครจ่ายผ่านได้
  // คือผู้เรียกรายที่สามที่เปิด `allowEmpty` แบบไม่มีเงื่อนไข ซึ่งจะไม่มีใครเห็นถ้าตรวจแค่สองไฟล์
  const optIns: string[] = [];
  for (const file of typescriptFilesUnder("../apps/web")) {
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/allowEmpty:\s*([^,\n}]+)/g)) {
      const where = file.replace(/\\/g, "/").split("/apps/web/")[1] ?? file;
      optIns.push(`${where}: ${match[1].trim()}`);
    }
  }
  assert.deepEqual(
    optIns.filter((entry) => !entry.endsWith("Boolean(boardGameBillingGroupId)")),
    [],
    "the empty-payment path may only open for the board-game bill the caller named",
  );
  assert.equal(optIns.length, 2, "both registers, and only those two, may opt in");

  // ค่าปริยายของตัวแยกเองต้องยังปฏิเสธ — `scripts/pos-contract.test.mts` เรียกของจริงมาตรึงไว้
  assert.ok(
    /payments\.length > 0 \|\| options\.allowEmpty === true/.test(
      withoutComments(posRouteHelpers),
    ),
    "an empty payment list must stay a rejection unless the caller opted in",
  );
  // id ที่ไม่ใช่ uuid เคยตกด่าน "ต้องระบุการชำระเงิน" ไปก่อน · พอบิล ฿0 ผ่านด่านนั้นได้ มันจะ
  // เดินต่อไปถึง `WHERE id = $2` แล้วได้ 22P02 เป็น 500 ที่ข้อความจริงถูกลบทิ้งบน production
  assert.ok(
    /isPosUuid\(boardGameBillingGroupId\)/.test(withoutComments(saleRestRoute)),
    "the browser route must reject a malformed board-game id instead of handing it to Postgres",
  );
});
