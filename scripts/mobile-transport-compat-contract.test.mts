import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const REPO = new URL("../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, REPO), "utf8");

const graphqlRoute = read("apps/web/app/api/graphql/route.ts");
const ticketRoute = read("apps/web/app/api/bms/realtime/ticket/route.ts");
const realtimeAuth = read("apps/web/lib/bms/realtimeAuth.ts");
const authServer = read("apps/web/lib/auth/server.ts");
const wsTicket = read("packages/realtime/src/wsTicket.ts");

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Phase 10 — Android Bearer
 * -------------------------------------------------------------
 * RN ไม่มีคุกกี้ ทั้ง HTTP GraphQL และการขอ ticket ของ WS จึงต้องรับ Bearer ได้
 * และ scope `android` ต้องเป็น "ผู้ใช้" เท่านั้น — ห้ามได้สิทธิ์ของแอดมินหรือของเครื่องขาย
 */
test("android reaches HTTP GraphQL with a Bearer token, not a cookie", () => {
  const body = withoutComments(graphqlRoute);
  assert.match(body, /scope === "android"/);
  assert.match(body, /verifyUserFromRequest\(request\)/);
  // scope นี้ต้องไม่ได้ตัวตนแอดมินติดมาด้วย
  const branch = body.slice(body.indexOf('scope === "android"'), body.indexOf('} else if', body.indexOf('scope === "android"')) + 1);
  assert.ok(branch.length > 0, "android branch must be found");
  assert.match(branch, /admin\s*=\s*null/, "an android session must never become an admin session");
  assert.match(withoutComments(authServer), /readBearerToken\(req\)/);
});

test("android can mint a WS ticket with the same Bearer credential", () => {
  const body = withoutComments(ticketRoute);
  assert.match(body, /"android"/);
  assert.match(body, /requestedScope === "android" \? verifyUserFromRequest\(req\)/);
  assert.match(withoutComments(wsTicket), /"android"/);
});

/**
 * ticket ของ android เป็นของ "ผู้ใช้" — subjectId คือผู้ใช้ ไม่ใช่เครื่อง และต้องไม่แจกสิทธิ์
 * ชุดของ POS ที่ `mintPosRealtimeTicket` แจกให้เครื่องขาย
 */
test("an android ticket carries user scope only, never the POS permission set", () => {
  const body = withoutComments(realtimeAuth);
  const userMint = body.slice(
    body.indexOf("export async function mintUserRealtimeTicket"),
    body.indexOf("export async function mintPosRealtimeTicket"),
  );
  assert.ok(userMint.length > 0, "mintUserRealtimeTicket must be found");
  assert.match(userMint, /subjectId: String\(session\.id\)/);
  assert.doesNotMatch(userMint, /permissions:/, "a user ticket must not hand out permissions");
  assert.doesNotMatch(userMint, /allLocations:\s*true/);
  // อายุ ticket ต้องไม่ยาวกว่า session ที่ออกมันมา
  assert.match(userMint, /Math\.min\(claims\.expiresAt, session\.exp\)/);
});

/**
 * Phase 9/10 — REST compatibility
 * -------------------------------------------------------------
 * การเพิ่ม GraphQL ห้ามทำให้เส้น REST ที่เบราว์เซอร์ POS กับหลังบ้านยังใช้อยู่หายไป
 * ลบเมื่อไรต้องเป็นการตัดสินใจที่มี migration plan ไม่ใช่ผลข้างเคียงของการเพิ่มสคีมา
 */
test("the REST routes the browser still depends on are all present and exported", () => {
  const routes = [
    // เครื่องขาย — เส้นที่ `/pos` และ `/pos/restaurant` เรียกอยู่จริงวันนี้
    "apps/web/app/api/pos/session/route.ts",
    "apps/web/app/api/pos/sale/route.ts",
    "apps/web/app/api/pos/shift/route.ts",
    "apps/web/app/api/pos/scan/route.ts",
    "apps/web/app/api/pos/search/route.ts",
    "apps/web/app/api/pos/return/route.ts",
    "apps/web/app/api/pos/send-receipt/route.ts",
    "apps/web/app/api/pos/kitchen/tickets/route.ts",
    "apps/web/app/api/pos/restaurant/checks/route.ts",
    "apps/web/app/api/pos/restaurant/floor/route.ts",
    "apps/web/app/api/pos/restaurant/menu/route.ts",
    // หลังบ้าน — เส้นที่มี GraphQL equivalent แล้วแต่ยังต้องอยู่จนกว่าจะย้าย caller
    "apps/web/app/api/bms/inventory/transfers/route.ts",
    "apps/web/app/api/bms/inventory/counts/route.ts",
    "apps/web/app/api/bms/restaurant-requests/route.ts",
    "apps/web/app/api/bms/store-credit/route.ts",
    "apps/web/app/api/bms/commission/route.ts",
  ];
  for (const route of routes) {
    assert.ok(existsSync(new URL(route, REPO)), `${route} must still exist`);
    const source = read(route);
    assert.match(
      source,
      /export\s+(const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)/,
      `${route} must still export a handler`,
    );
  }
});

/** เส้น REST ที่ยังอยู่ต้องมีด่านของตัวเอง — `middleware.ts` กันแค่ `/admin/**` */
test("the surviving REST routes still authenticate themselves", () => {
  for (const route of [
    "apps/web/app/api/bms/inventory/transfers/route.ts",
    "apps/web/app/api/bms/inventory/counts/route.ts",
    "apps/web/app/api/bms/restaurant-requests/route.ts",
    "apps/web/app/api/pos/sale/route.ts",
    "apps/web/app/api/pos/shift/route.ts",
  ]) {
    const source = withoutComments(read(route));
    assert.match(
      source,
      /authorizeAdminRoute|authenticatePosDevice|authenticateRestaurantMutation|requirePosDevice/,
      `${route} must keep its own guard`,
    );
  }
});
