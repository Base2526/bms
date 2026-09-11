import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bmsPosDeviceResolvers, bmsPosDeviceTypeDefs } from "../apps/web/graphql/bmsPosDevice";
import {
  bmsMobileOperationsResolvers,
  bmsMobileOperationsTypeDefs,
} from "../apps/web/graphql/bmsMobileOperations";
import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const posSchema = read("../apps/web/graphql/bmsPosDevice.ts");
const mobileSchema = read("../apps/web/graphql/bmsMobileOperations.ts");
const posAuth = read("../apps/web/graphql/posDeviceAuth.ts");
const graphqlRoute = read("../apps/web/app/api/graphql/route.ts");
const ticketRoute = read("../apps/web/app/api/bms/realtime/ticket/route.ts");
const graphqlIndex = read("../apps/web/graphql/index.ts");
const resolvers = read("../apps/web/graphql/resolvers.ts");
const scanRoute = read("../apps/web/app/api/pos/scan/route.ts");
const receiptRoute = read("../apps/web/app/api/pos/send-receipt/route.ts");

/**
 * คอมเมนต์ในไฟล์เหล่านี้อธิบายกฎที่เทสตรึงอยู่ การสแกนซอร์สดิบจึงทำให้คอมเมนต์
 * "ทำให้ผ่าน" หรือ "ทำให้แดง" ได้เอง · ไฟล์เป็น CRLF จึงต้อง split ด้วย /\r?\n/
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * ชื่อ operation อ่านจาก SDL ที่ parse แล้ว ไม่ใช่ substring — operation ที่ถูกลบ/เปลี่ยนชื่อ
 * แล้วเหลือแต่ในคอมเมนต์ต้องแดง เพราะเครื่องขายเสียงานนั้นไปทั้งเส้น
 */
function sdlBlock(sdl: string, typeName: "Query" | "Mutation"): string {
  const opener = new RegExp(`extend\\s+type\\s+${typeName}\\s*\\{`).exec(sdl);
  // anchor ที่ resolve ไม่ได้ทำให้เทสเขียวลอย ๆ — กับดักเดิมของเทสสแกนซอร์สในรีโปนี้
  assert.ok(opener, `SDL must declare extend type ${typeName}`);
  let depth = 1;
  let index = opener.index + opener[0].length;
  const start = index;
  while (index < sdl.length && depth > 0) {
    if (sdl[index] === "{") depth += 1;
    else if (sdl[index] === "}") depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `extend type ${typeName} must be balanced`);
  return sdl.slice(start, index - 1);
}

/** Drop argument lists so a multi-line argument name is never mistaken for an operation. */
function withoutArgumentLists(block: string): string {
  let depth = 0;
  let out = "";
  for (const char of block) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

function sdlOperationFields(sdl: string): { Query: Set<string>; Mutation: Set<string> } {
  const fields = { Query: new Set<string>(), Mutation: new Set<string>() };
  for (const typeName of ["Query", "Mutation"] as const) {
    const block = withoutArgumentLists(sdlBlock(sdl, typeName));
    for (const line of block.split(/\r?\n/)) {
      const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (field) fields[typeName].add(field[1]);
    }
    assert.ok(fields[typeName].size > 0, `extend type ${typeName} must declare fields`);
  }
  return fields;
}

const posFields = sdlOperationFields(bmsPosDeviceTypeDefs);
const mobileFields = sdlOperationFields(bmsMobileOperationsTypeDefs);

test("mobile and POS SDL is installed in the HTTP schema", () => {
  assert.ok(posFields.Query.size > 0 && posFields.Mutation.size > 0);
  assert.ok(mobileFields.Query.size > 0 && mobileFields.Mutation.size > 0);
  assert.match(graphqlIndex, /bmsPosDeviceTypeDefs/);
  assert.match(graphqlIndex, /bmsMobileOperationsTypeDefs/);
  assert.match(resolvers, /\.\.\.bmsPosDeviceResolvers\.Query/);
  assert.match(resolvers, /\.\.\.bmsPosDeviceResolvers\.Mutation/);
  assert.match(resolvers, /\.\.\.bmsMobileOperationsResolvers\.Query/);
  assert.match(resolvers, /\.\.\.bmsMobileOperationsResolvers\.Mutation/);
});

/**
 * field ที่ประกาศใน SDL แต่ไม่มี resolver จะตอบ null แทนที่จะล้ม (จอเงียบ ๆ ไม่มีข้อมูล)
 * ส่วน resolver ที่ไม่มี field คือชื่อที่พิมพ์ผิดแล้วไม่มีใครเรียกได้ · ต้องว่างทั้งสองทิศ
 */
test("every declared mobile/POS operation is backed by a resolver, and vice versa", () => {
  const pairs = [
    ["POS", posFields, bmsPosDeviceResolvers],
    ["mobile", mobileFields, bmsMobileOperationsResolvers],
  ] as const;
  for (const [label, fields, moduleResolvers] of pairs) {
    for (const kind of ["Query", "Mutation"] as const) {
      const declared = [...fields[kind]].sort();
      const implemented = Object.keys((moduleResolvers as any)[kind] ?? {}).sort();
      assert.deepEqual(
        declared.filter((name) => !implemented.includes(name)),
        [],
        `${label} ${kind}: SDL field without a resolver`,
      );
      assert.deepEqual(
        implemented.filter((name) => !declared.includes(name)),
        [],
        `${label} ${kind}: resolver without an SDL field`,
      );
    }
  }
});

/**
 * SDL ที่พังทำให้ `/api/graphql` ล้มตั้งแต่ import = ทุก operation ของทุกคนตาย ไม่ใช่แค่ของ POS
 * · typecheck มองไม่เห็นเพราะ SDL เป็นสตริง จึงต้องประกอบสคีมาจริงหนึ่งครั้ง
 */
test("the merged HTTP schema still builds with the mobile and POS operations installed", () => {
  const schema = buildBmsGraphqlSchema();
  const queryFields = schema.getQueryType()?.getFields() ?? {};
  const mutationFields = schema.getMutationType()?.getFields() ?? {};
  for (const operation of posFields.Query) {
    assert.ok(operation in queryFields, `${operation} must reach the merged schema`);
  }
  for (const operation of posFields.Mutation) {
    assert.ok(operation in mutationFields, `${operation} must reach the merged schema`);
  }
  for (const operation of mobileFields.Query) {
    assert.ok(operation in queryFields, `${operation} must reach the merged schema`);
  }
  for (const operation of mobileFields.Mutation) {
    assert.ok(operation in mutationFields, `${operation} must reach the merged schema`);
  }
});

test("POS device GraphQL context accepts native Bearer auth without turning a device into a user", () => {
  assert.match(graphqlRoute, /scope === "pos"/);
  assert.match(graphqlRoute, /authorization\.match\(\/\^Bearer/);
  assert.match(graphqlRoute, /authenticatePosDevice\(token\)/);
  assert.match(graphqlRoute, /return \{ scope, admin, user, posDevice, req: request \}/);
  assert.match(posAuth, /ctx\.posDevice/);
  assert.match(posAuth, /verifyCashierPin/);
  assert.match(posAuth, /cashierHasPermission/);
  assert.match(posAuth, /isDistinctPosApprover/);
  assert.doesNotMatch(posAuth, /posDevice.*user\s*=/s);
});

test("POS realtime ticket supports the same Bearer credential and remains server scoped", () => {
  assert.match(ticketRoute, /requestedScope === "pos"/);
  assert.match(ticketRoute, /authorization\.match\(\/\^Bearer/);
  assert.match(ticketRoute, /mintPosRealtimeTicket\(bearerToken \|\|/);
  assert.doesNotMatch(ticketRoute, /tenantId\s*=\s*req\./);
  assert.doesNotMatch(ticketRoute, /locationId\s*=\s*req\./);
});

test("normal POS REST workflows have named GraphQL equivalents", () => {
  const queries = [
    "bmsPosSession", "bmsPosCatalogSearch", "bmsPosScan", "bmsPosLastSale",
    "bmsPosRecentSales", "bmsPosParkedSales", "bmsPosCashMovements", "bmsPosNoSales",
    "bmsPosDeposits", "bmsPosExpenses", "bmsPosKitchenTickets", "bmsPosRestaurantFloor",
    "bmsPosRestaurantMenu", "bmsPosRestaurantCheck", "bmsPosRestaurantIncoming",
    "bmsPosRestaurantQrOrders", "bmsPosRestaurantRequests", "bmsPosRestaurantServiceCalls",
    "bmsPosRestaurantWaitlist", "bmsPosMemberSearch", "bmsPosShiftHistory",
    "bmsPosShiftReport", "bmsPosArAccount", "bmsPosStoreCredit", "bmsPosPurchaseOrders",
    "bmsPosPurchaseOrder", "bmsPosMemberPreview",
  ];
  const mutations = [
    "bmsPosSale", "bmsPosShift", "bmsPosPark", "bmsPosReturn", "bmsPosBlindReturn",
    "bmsPosVoid", "bmsPosCompleteRefund", "bmsPosCashMovement", "bmsPosNoSale",
    "bmsPosEnrollMember", "bmsPosCollectAr", "bmsPosReceivePurchase", "bmsPosSendReceipt",
    "bmsPosDeposit", "bmsPosExpense", "bmsPosRequestPharmacyReview",
    "bmsPosKitchenTicketStatus", "bmsPosKitchenTicketsStatus", "bmsPosRestaurantFloorSetup",
    "bmsPosRestaurantMenuAvailability", "bmsPosRestaurantOpenCheck", "bmsPosRestaurantCheckAction",
    "bmsPosRestaurantIncomingAction", "bmsPosRestaurantQrOrderAction",
    "bmsPosRestaurantRequestAction", "bmsPosRestaurantServiceCallAction",
    "bmsPosRestaurantWaitlistAction",
  ];
  for (const operation of queries) {
    assert.ok(posFields.Query.has(operation), `${operation} must be a Query field`);
  }
  for (const operation of mutations) {
    assert.ok(posFields.Mutation.has(operation), `${operation} must be a Mutation field`);
  }
});

/**
 * เครื่องขายเป็น device principal — tenant/สาขา/เครื่อง มาจากแถว device ที่ยืนยันตัวตนแล้วเท่านั้น
 * รับค่าไหนจากผู้เรียกก็เท่ากับข้ามร้านได้ · `shiftId` เป็นข้อยกเว้นที่จดไว้ (hint ของกะก่อนหน้า)
 * และยัง scope ด้วย device ที่ปลายทาง
 */
const AUTHORITY_FIELD = /([A-Za-z_$][A-Za-z0-9_$]*|\))\s*\??\.\s*(tenantId|locationId|deviceId|actingTenantId)\b/g;

/** Every place the source reads an authority field, paired with the expression it reads from. */
function authorityReads(source: string): { receiver: string; field: string }[] {
  return [...withoutComments(source).matchAll(AUTHORITY_FIELD)]
    .map((match) => ({ receiver: match[1], field: match[2] }));
}

test("POS resolvers never take tenant, location, or device authority from the caller", () => {
  const body = withoutComments(posSchema);
  // เล็งที่ "อ่านมาจากอะไร" ไม่ใช่ที่ชื่อตัวแปรชุดใดชุดหนึ่ง — `inputRecord(args.input).tenantId`
  // ต้องแดงเท่ากับ `input.tenantId` ไม่งั้นการเขียนอีกรูปหนึ่งก็รอดไปเงียบ ๆ
  const foreign = authorityReads(posSchema).filter((read) => read.receiver !== "device");
  assert.deepEqual(
    foreign,
    [],
    "POS resolvers must derive tenant/location/device from the authenticated device only",
  );
  assert.match(body, /requirePosDevice\(ctx\)/);
  assert.ok(
    authorityReads(posSchema).length > 50,
    "POS resolvers must actually read scope from the authenticated device",
  );
});

test("mobile back-office resolvers derive tenant from context, not from the caller", () => {
  const body = withoutComments(mobileSchema);
  // สาขามาจากผู้ใช้ได้ (คนเลือกสาขาที่หน้าจอ — เท่ากับ REST เดิม) แต่ tenant ห้ามมาจากผู้เรียก
  const foreign = authorityReads(mobileSchema)
    .filter((read) => !(read.receiver === "input" && read.field === "locationId"));
  assert.deepEqual(
    foreign,
    [],
    "mobile resolvers must derive tenant from getTenantId(ctx); only locationId may come from the caller",
  );
  assert.match(body, /getTenantId\(ctx\)/);
  assert.match(body, /requirePermission/);
});

test("POS GraphQL adapters stay DB-free and preserve human authorization and idempotency", () => {
  assert.doesNotMatch(posSchema, /from ["']@\/lib\/db["']/);
  assert.doesNotMatch(posSchema, /\bquery\s*\(/);
  assert.match(posSchema, /requirePosCashier/);
  assert.match(posSchema, /requirePosSecondPerson/);
  assert.match(posSchema, /"pos\.discount\.approve"/);
  assert.match(posSchema, /"pos\.void"/);
  assert.match(posSchema, /"pos\.cash\.movement"/);
  assert.match(posSchema, /idempotencyKey/);
  assert.doesNotMatch(scanRoute, /from ["']@\/lib\/db["']/);
  assert.doesNotMatch(receiptRoute, /from ["']@\/lib\/db["']/);
});

test("remaining mobile BMS REST gaps use tenant context, RBAC, and shared services", () => {
  const queries = [
    "bmsStockTransfers", "bmsStockCounts", "bmsMobileRestaurantRequests", "bmsStoreCredit",
    "bmsCommissionRules", "bmsCommissionReport", "bmsPosReturnSummary", "bmsPosReturnAuditSummary",
  ];
  const mutations = [
    "bmsStockTransfer", "bmsStockCount", "bmsReviewRestaurantRequest", "bmsIssueStoreCredit",
    "bmsCommissionRule",
  ];
  for (const operation of queries) {
    assert.ok(mobileFields.Query.has(operation), `${operation} must be a Query field`);
  }
  for (const operation of mutations) {
    assert.ok(mobileFields.Mutation.has(operation), `${operation} must be a Mutation field`);
  }
  assert.doesNotMatch(mobileSchema, /from ["']@\/lib\/db["']/);
});
