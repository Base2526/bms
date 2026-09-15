import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bmsPosDeviceResolvers,
  bmsPosDeviceTypeDefs,
} from "../apps/web/graphql/bmsPosDevice";
import {
  bmsMobileOperationsResolvers,
  bmsMobileOperationsTypeDefs,
} from "../apps/web/graphql/bmsMobileOperations";
import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const posSchema = read("../apps/web/graphql/bmsPosDevice.ts");
const mobileSchema = read("../apps/web/graphql/bmsMobileOperations.ts");
const posAuth = read("../apps/web/graphql/posDeviceAuth.ts");
const graphqlRoute = read("../apps/web/app/api/graphql/route.ts");
const ticketRoute = read("../apps/web/app/api/bms/realtime/ticket/route.ts");
const graphqlIndex = read("../apps/web/graphql/index.ts");
const resolvers = read("../apps/web/graphql/resolvers.ts");
const scanRoute = read("../apps/web/app/api/pos/scan/route.ts");
const receiptRoute = read("../apps/web/app/api/pos/send-receipt/route.ts");
const mobileOperationsScreen = read(
  "../apps/mobile/src/screens/operations/OperationsScreen.tsx",
);
const mobileIncomingScreen = read(
  "../apps/mobile/src/screens/orders/IncomingOrdersScreen.tsx",
);
const mobileCheckoutScreen = read(
  "../apps/mobile/src/screens/sell/CheckoutScreen.tsx",
);
const mobileBoardGameScreen = read(
  "../apps/mobile/src/screens/boardGame/BoardGameScreen.tsx",
);
const mobileInventoryScreen = read(
  "../apps/mobile/src/screens/inventory/InventoryScreen.tsx",
);
const mobileFloorScreen = read(
  "../apps/mobile/src/screens/floor/FloorScreen.tsx",
);
const mobileCheckDetailScreen = read(
  "../apps/mobile/src/screens/floor/CheckDetailScreen.tsx",
);
const mobileAdjustmentsCard = read(
  "../apps/mobile/src/components/CheckoutAdjustmentsCard.tsx",
);
const mobileSalesContext = read("../apps/mobile/src/state/SalesContext.tsx");
const mobileReceiptScreen = read(
  "../apps/mobile/src/screens/sell/ReceiptScreen.tsx",
);
const mobileMainTabs = read("../apps/mobile/src/navigation/MainTabs.tsx");
const mobileDeviceSettingsScreen = read(
  "../apps/mobile/src/screens/settings/DeviceSettingsScreen.tsx",
);
const mobileLoginScreen = read("../apps/mobile/src/screens/LoginScreen.tsx");
const mobileRestaurantOperationsContext = read(
  "../apps/mobile/src/state/RestaurantOperationsContext.tsx",
);
const mobileOrderAlertWatcher = read(
  "../apps/mobile/src/components/OrderAlertWatcher.tsx",
);
const mobileGraphqlOperations = read(
  "../apps/mobile/src/graphql/operations.graphql",
);
const boardGamePosOperations = read(
  "../apps/web/lib/bms/boardGamePosOperations.ts",
);
const inventoryIdempotency = read(
  "../apps/web/lib/bms/inventoryIdempotency.ts",
);
const inventoryIdempotencyMigration = read(
  "../db/migrations/9.88__bms_inventory_operation_idempotency.sql",
);

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

function sdlOperationFields(sdl: string): {
  Query: Set<string>;
  Mutation: Set<string>;
} {
  const fields = { Query: new Set<string>(), Mutation: new Set<string>() };
  for (const typeName of ["Query", "Mutation"] as const) {
    const block = withoutArgumentLists(sdlBlock(sdl, typeName));
    for (const line of block.split(/\r?\n/)) {
      const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (field) fields[typeName].add(field[1]);
    }
    assert.ok(
      fields[typeName].size > 0,
      `extend type ${typeName} must declare fields`,
    );
  }
  return fields;
}

const posFields = sdlOperationFields(bmsPosDeviceTypeDefs);
const mobileFields = sdlOperationFields(bmsMobileOperationsTypeDefs);

type OperationKind = "Query" | "Mutation";
type InputFieldContract = { name: string; type: string };

let cachedSchema: ReturnType<typeof buildBmsGraphqlSchema> | null = null;

function schema() {
  cachedSchema ??= buildBmsGraphqlSchema();
  return cachedSchema;
}

function namedType(type: string): string {
  return type.replace(/[\[\]!]/g, "");
}

function rootField(kind: OperationKind, name: string): any {
  const root =
    kind === "Query" ? schema().getQueryType() : schema().getMutationType();
  const field = root?.getFields()[name];
  assert.ok(field, `${kind}.${name} must exist in the executable schema`);
  return field;
}

function inputArgument(kind: OperationKind, name: string): any | null {
  return (
    rootField(kind, name).args.find((arg: any) => arg.name === "input") ?? null
  );
}

function inputFields(typeName: string): InputFieldContract[] {
  const type = schema().getType(typeName) as any;
  assert.ok(
    type && typeof type.getFields === "function",
    `${typeName} must be an input object`,
  );
  return Object.values(type.getFields()).map((field: any) => ({
    name: field.name,
    type: String(field.type),
  }));
}

const moduleOperations = () => [
  ...[...posFields.Query].map((name) => ({
    module: "POS",
    kind: "Query" as const,
    name,
  })),
  ...[...posFields.Mutation].map((name) => ({
    module: "POS",
    kind: "Mutation" as const,
    name,
  })),
  ...[...mobileFields.Query].map((name) => ({
    module: "mobile",
    kind: "Query" as const,
    name,
  })),
  ...[...mobileFields.Mutation].map((name) => ({
    module: "mobile",
    kind: "Mutation" as const,
    name,
  })),
];

const namedActionAliases = new Set([
  "bmsPosRestaurantAddCheckItem",
  "bmsPosRestaurantRemoveCheckItem",
  "bmsPosRestaurantSetCheckGuestCount",
  "bmsPosRestaurantSendCheckToKitchen",
  "bmsPosRestaurantMoveCheck",
  "bmsPosRestaurantSplitCheck",
  "bmsPosRestaurantMergeChecks",
  "bmsPosRestaurantCancelCheck",
  "bmsPosRestaurantSettleCheck",
  "bmsPosRestaurantAcceptIncomingOrder",
  "bmsPosRestaurantSetOrderingPaused",
  "bmsPosRestaurantCancelOrderLines",
  "bmsPosRestaurantAcceptQrSubmission",
  "bmsPosRestaurantRejectQrSubmission",
  "bmsPosRestaurantContactRequest",
  "bmsPosRestaurantConfirmRequest",
  "bmsPosRestaurantCancelRequest",
  "bmsPosRestaurantAcknowledgeServiceCall",
  "bmsPosRestaurantCompleteServiceCall",
  "bmsPosRestaurantAddWaitlistEntry",
  "bmsPosRestaurantCallWaitlistEntry",
  "bmsPosRestaurantCancelWaitlistEntry",
  "bmsPosRestaurantNoShowWaitlistEntry",
  "bmsPosRestaurantSeatWaitlistEntry",
  "bmsCreateStockTransfer",
  "bmsSendStockTransfer",
  "bmsReceiveStockTransfer",
  "bmsCancelStockTransfer",
  "bmsCreateStockCount",
  "bmsRecordStockCountItem",
  "bmsApplyStockCount",
  "bmsCancelStockCount",
]);

/** ตัดบล็อก `{ ... }` ที่เริ่มตรง openIndex ออกมาโดยนับวงเล็บเอง */
function braceBlockAt(source: string, openIndex: number): string {
  assert.equal(source[openIndex], "{", "expected a block to open here");
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  assert.fail("unbalanced block");
}

function bodyOfTopLevelFunction(source: string, header: RegExp): string {
  const clean = withoutComments(source);
  const start = header.exec(clean);
  assert.ok(start, `${header} must match a declaration`);
  const tail = clean.slice(start.index);
  const end = /\n}\n/.exec(tail);
  assert.ok(end, "a top-level function must close at column 0");
  return tail.slice(0, end.index);
}

/**
 * เส้นบอร์ดเกมย้าย **ตารางสิทธิ์และการอ่าน input** ไปไว้ที่
 * `lib/bms/boardGamePosOperations.ts` เพราะ REST ของเบราว์เซอร์ (`/api/pos/board-game`)
 * ต้องตัดสินเหมือนกันเป๊ะ · ตัว resolver จึงไม่มี `input.<field>` ให้สแกนอีกแล้ว
 *
 * ถ้าเทสอ่านแค่ตัว resolver มันจะเห็นว่า "ไม่มีใครอ่าน field ไหนเลย" ซึ่งเขียวได้ทั้งตอนที่ SDL
 * ประกาศ field ที่ไม่มีใครใช้ และตอนที่โค้ดอ่าน field ที่ไม่มีใน SDL — การันตีไม่ได้หายไป
 * แค่ย้ายบ้าน เทสจึงต้องเดินตามไปอ่านของจริงที่นั่น
 */
function boardGameDelegatedBody(body: string): string | null {
  const authorized =
    /boardGamePosAccess\(\s*ctx\s*,\s*args\.input\s*,\s*"([a-z.]+)"\s*\)/.exec(
      body,
    );
  if (!authorized) return null;
  const action = authorized[1];
  const executed =
    /runBoardGamePosMutation\(\s*access\.scope\s*,\s*access\.actorUserId\s*,\s*"([a-z.]+)"/.exec(
      body,
    );
  assert.ok(executed, `${action} must run through runBoardGamePosMutation`);
  // อนุญาตด้วยสิทธิ์ของคำสั่งหนึ่งแล้วไปทำอีกคำสั่งหนึ่ง = ด่านสิทธิ์ที่ไม่ได้กันอะไรเลย
  assert.equal(
    executed[1],
    action,
    "a board-game resolver must execute the action it authorized",
  );

  const clean = withoutComments(boardGamePosOperations);
  // ด่าน PIN อยู่ใน boardGamePosAccess ของโมดูล POS — ยกมาด้วย ไม่งั้น cashierUserId/pin
  // จะถูกอ่านว่าไม่มีใครใช้ ทั้งที่เป็นสิ่งที่ผู้เรียกต้องส่งมาทุกคำสั่ง
  let text = bodyOfTopLevelFunction(
    posSchema,
    /async function boardGamePosAccess\(/,
  );

  const quoted = clean.indexOf(`  "${action}": {`);
  const specAt = quoted >= 0 ? quoted : clean.indexOf(`  ${action}: {`);
  assert.ok(specAt >= 0, `BOARD_GAME_POS_ACTIONS must declare "${action}"`);
  // สิทธิ์เพิ่มเติมของบางคำสั่งอ่าน input เอง (คืนกล่องเกมในสถานะที่ไม่ใช่ปกติ)
  text += braceBlockAt(clean, clean.indexOf("{", specAt));

  const dispatcherAt = clean.indexOf(
    "export async function runBoardGamePosMutation",
  );
  assert.ok(dispatcherAt >= 0, "runBoardGamePosMutation must exist");
  const switchAt = clean.indexOf("switch (action)", dispatcherAt);
  assert.ok(switchAt > dispatcherAt, "the dispatcher must switch on action");
  // ส่วนหัวก่อน switch อ่าน field ที่ทุกคำสั่งใช้ร่วมกัน (idempotencyKey)
  text += clean.slice(dispatcherAt, switchAt);
  // คำสั่งที่ใช้ body ร่วมกันเขียนเป็น `case "a":` แล้ว fall-through ลง `case "b": {`
  // การบังคับให้มี `{` ติดกับ label ทำให้ตัวแรกอ่านว่า "dispatcher ไม่รับคำสั่งนี้"
  const caseAt = clean.indexOf(`case "${action}":`, switchAt);
  assert.ok(caseAt > switchAt, `the dispatcher must handle "${action}"`);
  const bodyAt = /^(?:\s*case "[a-z.]+":)*\s*\{/.exec(
    clean.slice(caseAt + `case "${action}":`.length),
  );
  assert.ok(bodyAt, `the "${action}" case must open a block, possibly after fall-through labels`);
  text += braceBlockAt(
    clean,
    caseAt + `case "${action}":`.length + bodyAt[0].length - 1,
  );

  // ตัวแปลงผู้เล่นอ่าน field ระดับบนสุดแทน case นั้นเมื่อเพิ่มผู้เล่นทีละคน
  if (/participantDraft\(input\)/.test(text)) {
    const draftAt = clean.indexOf("function participantDraft(");
    assert.ok(draftAt >= 0, "participantDraft must exist");
    text += braceBlockAt(
      clean,
      clean.indexOf("{", clean.indexOf(")", draftAt)),
    ).replace(/\brow\./g, "input.");
  }
  return text;
}

function resolverMethod(source: string, operation: string): string {
  const clean = withoutComments(source);
  const start = new RegExp(`^    async ${operation}\\b`, "m").exec(clean);
  assert.ok(start, `${operation} must have a resolver method`);
  const tail = clean.slice(start.index + start[0].length);
  const next = /^    async bms[A-Za-z0-9]+\b/m.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

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
      const implemented = Object.keys(
        (moduleResolvers as any)[kind] ?? {},
      ).sort();
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
    assert.ok(
      operation in queryFields,
      `${operation} must reach the merged schema`,
    );
  }
  for (const operation of posFields.Mutation) {
    assert.ok(
      operation in mutationFields,
      `${operation} must reach the merged schema`,
    );
  }
  for (const operation of mobileFields.Query) {
    assert.ok(
      operation in queryFields,
      `${operation} must reach the merged schema`,
    );
  }
  for (const operation of mobileFields.Mutation) {
    assert.ok(
      operation in mutationFields,
      `${operation} must reach the merged schema`,
    );
  }
});

test("all 81 mobile/POS input arguments are typed", () => {
  const operations = moduleOperations();
  const inputOperations = operations
    .map((operation) => ({
      ...operation,
      input: inputArgument(operation.kind, operation.name),
    }))
    .filter((operation) => operation.input != null);

  assert.equal(
    inputOperations.length,
    81,
    "the mobile/POS surface must keep all 81 input-bearing operations",
  );
  assert.deepEqual(
    inputOperations
      .filter((operation) => namedType(String(operation.input.type)) === "JSON")
      .map((operation) => `${operation.kind}.${operation.name}`),
    [],
    "typed client operations must not accept an opaque JSON input argument",
  );
});

test("all 126 mobile/POS outputs are recursively typed with no JSON escape hatch", () => {
  const operations = moduleOperations();
  assert.equal(
    operations.length,
    126,
    "the complete mobile/POS output surface must stay in the contract",
  );
  const jsonRoots = operations
    .filter(
      (operation) =>
        namedType(String(rootField(operation.kind, operation.name).type)) ===
        "JSON",
    )
    .map((operation) => `${operation.kind}.${operation.name}`);
  assert.deepEqual(
    jsonRoots,
    [],
    "no mobile/POS operation may return opaque JSON",
  );

  const pending = [
    ...new Set(
      operations.map((operation) =>
        namedType(String(rootField(operation.kind, operation.name).type)),
      ),
    ),
  ];
  const visited = new Set<string>();
  const opaque: string[] = [];
  while (pending.length) {
    const typeName = pending.pop()!;
    if (visited.has(typeName)) continue;
    visited.add(typeName);
    const type = schema().getType(typeName) as any;
    assert.ok(
      type && typeof type.getFields === "function",
      `${typeName} must be an output object`,
    );
    for (const field of Object.values(type.getFields()) as any[]) {
      const child = namedType(String(field.type));
      if (child === "JSON") opaque.push(`${typeName}.${field.name}`);
      const candidate = schema().getType(child) as any;
      if (candidate && typeof candidate.getFields === "function")
        pending.push(child);
    }
  }
  assert.deepEqual(
    opaque.sort(),
    [],
    "a typed root must not hide another opaque JSON contract below it",
  );
});

test("typed parked-cart output normalizes both legacy arrays and current snapshots", () => {
  const resolveCart = (bmsPosDeviceResolvers as any).BmsPosParkedSale?.cart;
  assert.equal(
    typeof resolveCart,
    "function",
    "parked-sale cart needs an explicit compatibility formatter",
  );
  const line = { sku: "SKU-1", size: "M", packQty: 1 };
  assert.deepEqual(resolveCart({ cart: [line] }), {
    version: 2,
    lines: [line],
  });
  assert.deepEqual(
    resolveCart({ cart: { version: 2, lines: [line], couponCode: "SAVE10" } }),
    { version: 2, lines: [line], couponCode: "SAVE10", pharmacyReview: null },
  );
});

test("nullable runtime branches stay nullable in the first typed output batch", () => {
  const expected = new Map([
    ["BmsPosSessionResult.location", "BmsPosLocationSummary"],
    ["BmsPosSessionResult.shift", "BmsPosShift"],
    ["BmsPosScanResult.imageUrl", "String"],
    ["BmsPosScanResult.promotion", "BmsPosPromotion"],
    ["BmsPosRestaurantFloorTable.check", "BmsPosRestaurantFloorCheck"],
    ["BmsPosRestaurantCheck.note", "String"],
    ["BmsPosRestaurantCheck.openedAt", "String"],
    ["BmsPosRestaurantCheckItem.lineAmount", "Float"],
    ["BmsKitchenTicket.orderId", "ID"],
    ["BmsKitchenTicket.checkId", "ID"],
    ["BmsPosSaleResult.orderId", "ID"],
    ["BmsPosSaleResult.reason", "String"],
    ["BmsPosShiftActionResult.shift", "BmsPosShift"],
  ]);
  const actual = new Map<string, string>();
  for (const path of expected.keys()) {
    const [typeName, fieldName] = path.split(".");
    const type = schema().getType(typeName) as any;
    const field = type?.getFields?.()[fieldName];
    assert.ok(field, `${path} must exist`);
    actual.set(path, String(field.type));
  }
  assert.deepEqual(
    actual,
    expected,
    "fields absent/null on valid runtime branches cannot be non-null",
  );
});

test("typed mobile/POS inputs cannot carry tenant, device, acting-tenant, location, or shift authority", () => {
  const roots = moduleOperations()
    .map((operation) => inputArgument(operation.kind, operation.name))
    .filter(Boolean)
    .map((argument) => namedType(String(argument.type)))
    // The preceding typed-input subtest owns JSON regressions. Skipping a scalar here keeps a
    // single mutation tied to the one contract it broke instead of producing cascade failures.
    .filter((typeName) => typeName !== "JSON");
  const pending = [...new Set(roots)];
  const visited = new Set<string>();
  const forbidden: string[] = [];
  const authorityFields = new Set([
    "tenantId",
    "locationId",
    "deviceId",
    "actingTenantId",
    "shiftId",
  ]);
  // These two staff operations preserve the existing REST-equivalent branch selection. The service
  // still verifies that the selected branch belongs to the context-derived tenant.
  const allowedStaffLocation = new Set([
    "BmsStockCountInput.locationId",
    "BmsCreateStockCountInput.locationId",
    "BmsReviewRestaurantRequestInput.locationId",
  ]);

  while (pending.length) {
    const typeName = pending.pop()!;
    if (visited.has(typeName)) continue;
    visited.add(typeName);
    for (const field of inputFields(typeName)) {
      const path = `${typeName}.${field.name}`;
      if (authorityFields.has(field.name) && !allowedStaffLocation.has(path))
        forbidden.push(path);
      const child = namedType(field.type);
      const candidate = schema().getType(child) as any;
      if (candidate && typeof candidate.getFields === "function")
        pending.push(child);
    }
  }

  assert.deepEqual(
    forbidden.sort(),
    [],
    "authorization scope must be derived from GraphQL context/device",
  );
});

test("write inputs that consume client idempotency keys expose the key with action-safe nullability", () => {
  const alwaysRequired = [
    "bmsPosSale",
    "bmsPosReturn",
    "bmsPosBlindReturn",
    "bmsPosVoid",
    "bmsPosCashMovement",
    "bmsPosCollectAr",
    "bmsPosReceivePurchase",
    "bmsPosExpense",
    "bmsPosRequestPharmacyReview",
    "bmsPosCreateStockTransfer",
    "bmsPosSendStockTransfer",
    "bmsPosReceiveStockTransfer",
    "bmsPosCancelStockTransfer",
    "bmsPosCreateStockCount",
    "bmsPosRecordStockCountItem",
    "bmsPosApplyStockCount",
    "bmsPosCancelStockCount",
    "bmsPosOpenBoardGameSession",
    "bmsPosAddBoardGameParticipant",
    "bmsPosLeaveBoardGameParticipant",
    "bmsPosAdjustBoardGameTiming",
    "bmsPosCloseBoardGameSession",
    "bmsPosCancelBoardGameSession",
    "bmsPosCheckoutBoardGameCopy",
    "bmsPosReturnBoardGameCopy",
  ];
  for (const operation of alwaysRequired) {
    const input = inputArgument("Mutation", operation);
    const typeName = namedType(String(input.type));
    if (typeName === "JSON") continue;
    const field = inputFields(typeName).find(
      (item) => item.name === "idempotencyKey",
    );
    assert.equal(
      field?.type,
      "String!",
      `${operation} must require idempotencyKey`,
    );
  }

  // These legacy action multiplexers include actions that do not consume a key. Phase 4 will split
  // them into named mutations; until then the field must exist but cannot be required globally.
  for (const operation of ["bmsPosDeposit", "bmsPosRestaurantIncomingAction"]) {
    const input = inputArgument("Mutation", operation);
    const typeName = namedType(String(input.type));
    if (typeName === "JSON") continue;
    const field = inputFields(typeName).find(
      (item) => item.name === "idempotencyKey",
    );
    assert.equal(
      field?.type,
      "String",
      `${operation} must expose its action-scoped idempotencyKey`,
    );
  }
});

test("each typed top-level input field matches what its resolver reads, in both directions", () => {
  const mismatches: string[] = [];
  for (const operation of moduleOperations()) {
    // Named Phase 4 fields deliberately delegate their whole typed input to the compatibility
    // resolver. The dedicated action-alias contract verifies that mapping and forbids service forks.
    if (namedActionAliases.has(operation.name)) continue;
    const argument = inputArgument(operation.kind, operation.name);
    if (!argument || namedType(String(argument.type)) === "JSON") continue;
    const source = operation.module === "POS" ? posSchema : mobileSchema;
    const resolverBody = resolverMethod(source, operation.name);
    const delegated = boardGameDelegatedBody(resolverBody);
    const body = delegated ? `${resolverBody}\n${delegated}` : resolverBody;
    const read = new Set(
      [...body.matchAll(/\binput\.([A-Za-z_][A-Za-z0-9_]*)/g)]
        .map((match) => match[1])
        // The typed GraphQL boundary deliberately removes this legacy retry hint. Current scope is
        // derived from the authenticated device and open shift instead.
        .filter((field) => field !== "shiftId"),
    );
    if (/requirePosCashier\(\s*device\s*,\s*input\s*,/.test(body)) {
      read.add("cashierUserId");
      read.add("pin");
    }
    const declared = new Set(
      inputFields(namedType(String(argument.type))).map((field) => field.name),
    );
    const missing = [...read].filter((field) => !declared.has(field)).sort();
    const unused = [...declared].filter((field) => !read.has(field)).sort();
    if (missing.length || unused.length) {
      mismatches.push(
        `${operation.name}: missing=[${missing.join(
          ",",
        )}] unused=[${unused.join(",")}]`,
      );
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    "SDL and resolver input names must remain the same contract",
  );
});

test("POS device GraphQL context accepts native Bearer auth without turning a device into a user", () => {
  assert.match(graphqlRoute, /scope === "pos"/);
  assert.match(graphqlRoute, /authorization\.match\(\/\^Bearer/);
  assert.match(graphqlRoute, /authenticatePosDevice\(token\)/);
  assert.match(
    graphqlRoute,
    /return \{ scope, admin, user, posDevice, req: request \}/,
  );
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
    "bmsPosSession",
    "bmsPosCatalogSearch",
    "bmsPosScan",
    "bmsPosLastSale",
    "bmsPosRecentSales",
    "bmsPosParkedSales",
    "bmsPosCashMovements",
    "bmsPosNoSales",
    "bmsPosDeposits",
    "bmsPosExpenses",
    "bmsPosKitchenTickets",
    "bmsPosRestaurantFloor",
    "bmsPosRestaurantMenu",
    "bmsPosRestaurantCheck",
    "bmsPosRestaurantIncoming",
    "bmsPosRestaurantQrOrders",
    "bmsPosRestaurantRequests",
    "bmsPosRestaurantServiceCalls",
    "bmsPosRestaurantWaitlist",
    "bmsPosMemberSearch",
    "bmsPosShiftHistory",
    "bmsPosShiftReport",
    "bmsPosArAccount",
    "bmsPosStoreCredit",
    "bmsPosPurchaseOrders",
    "bmsPosPurchaseOrder",
    "bmsPosMemberPreview",
    "bmsPosStockTransfers",
    "bmsPosStockCounts",
    "bmsPosBoardGameWorkspace",
    "bmsPosBoardGameSession",
    "bmsPosBoardGameCheckout",
  ];
  const mutations = [
    "bmsPosVerifyCashier",
    "bmsPosSale",
    "bmsPosShift",
    "bmsPosPark",
    "bmsPosReturn",
    "bmsPosBlindReturn",
    "bmsPosVoid",
    "bmsPosCompleteRefund",
    "bmsPosCashMovement",
    "bmsPosNoSale",
    "bmsPosEnrollMember",
    "bmsPosCollectAr",
    "bmsPosReceivePurchase",
    "bmsPosSendReceipt",
    "bmsPosDeposit",
    "bmsPosExpense",
    "bmsPosRequestPharmacyReview",
    "bmsPosKitchenTicketStatus",
    "bmsPosKitchenTicketsStatus",
    "bmsPosRestaurantFloorSetup",
    "bmsPosRestaurantMenuAvailability",
    "bmsPosRestaurantOpenCheck",
    "bmsPosRestaurantCheckAction",
    "bmsPosRestaurantIncomingAction",
    "bmsPosRestaurantQrOrderAction",
    "bmsPosRestaurantRequestAction",
    "bmsPosRestaurantServiceCallAction",
    "bmsPosRestaurantWaitlistAction",
    "bmsPosCreateStockTransfer",
    "bmsPosSendStockTransfer",
    "bmsPosReceiveStockTransfer",
    "bmsPosCancelStockTransfer",
    "bmsPosCreateStockCount",
    "bmsPosRecordStockCountItem",
    "bmsPosApplyStockCount",
    "bmsPosCancelStockCount",
    "bmsPosOpenBoardGameSession",
    "bmsPosAddBoardGameParticipant",
    "bmsPosLeaveBoardGameParticipant",
    "bmsPosAdjustBoardGameTiming",
    "bmsPosCloseBoardGameSession",
    "bmsPosCancelBoardGameSession",
    "bmsPosCheckoutBoardGameCopy",
    "bmsPosReturnBoardGameCopy",
  ];
  for (const operation of queries) {
    assert.ok(
      posFields.Query.has(operation),
      `${operation} must be a Query field`,
    );
  }
  for (const operation of mutations) {
    assert.ok(
      posFields.Mutation.has(operation),
      `${operation} must be a Mutation field`,
    );
  }
});

/**
 * เครื่องขายเป็น device principal — tenant/สาขา/เครื่อง มาจากแถว device ที่ยืนยันตัวตนแล้วเท่านั้น
 * รับค่าไหนจากผู้เรียกก็เท่ากับข้ามร้านได้ · `shiftId` เป็นข้อยกเว้นที่จดไว้ (hint ของกะก่อนหน้า)
 * และยัง scope ด้วย device ที่ปลายทาง
 */
const AUTHORITY_FIELD =
  /([A-Za-z_$][A-Za-z0-9_$]*|\))\s*\??\.\s*(tenantId|locationId|deviceId|actingTenantId)\b/g;

/** Every place the source reads an authority field, paired with the expression it reads from. */
function authorityReads(source: string): { receiver: string; field: string }[] {
  return [...withoutComments(source).matchAll(AUTHORITY_FIELD)].map(
    (match) => ({ receiver: match[1], field: match[2] }),
  );
}

test("POS resolvers never take tenant, location, or device authority from the caller", () => {
  const body = withoutComments(posSchema);
  // เล็งที่ "อ่านมาจากอะไร" ไม่ใช่ที่ชื่อตัวแปรชุดใดชุดหนึ่ง — `inputRecord(args.input).tenantId`
  // ต้องแดงเท่ากับ `input.tenantId` ไม่งั้นการเขียนอีกรูปหนึ่งก็รอดไปเงียบ ๆ
  const foreign = authorityReads(posSchema).filter(
    (read) => read.receiver !== "device",
  );
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
  const foreign = authorityReads(mobileSchema).filter(
    (read) => !(read.receiver === "input" && read.field === "locationId"),
  );
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
    "bmsStockTransfers",
    "bmsStockCounts",
    "bmsMobileRestaurantRequests",
    "bmsStoreCredit",
    "bmsCommissionRules",
    "bmsCommissionReport",
    "bmsPosReturnSummary",
    "bmsPosReturnAuditSummary",
  ];
  const mutations = [
    "bmsStockTransfer",
    "bmsStockCount",
    "bmsReviewRestaurantRequest",
    "bmsIssueStoreCredit",
    "bmsCommissionRule",
  ];
  for (const operation of queries) {
    assert.ok(
      mobileFields.Query.has(operation),
      `${operation} must be a Query field`,
    );
  }
  for (const operation of mutations) {
    assert.ok(
      mobileFields.Mutation.has(operation),
      `${operation} must be a Mutation field`,
    );
  }
  assert.doesNotMatch(mobileSchema, /from ["']@\/lib\/db["']/);
});

test("RN money and stock commands retain idempotency keys across unknown outcomes", () => {
  assert.match(mobileOperationsScreen, /operationKeys\.current\[key\] \?\?=/);
  assert.match(mobileOperationsScreen, /cause instanceof BusinessResultError/);
  assert.doesNotMatch(
    mobileOperationsScreen,
    /idempotencyKey:\s*createIdempotencyKey\(/,
    "an operation button must not mint a new key on every retry",
  );
  assert.match(mobileIncomingScreen, /cancelKeys\.current\[intent\]/);
  assert.doesNotMatch(
    mobileIncomingScreen,
    /idempotencyKey:\s*createIdempotencyKey\(/,
  );
  assert.match(mobileCheckoutScreen, /pharmacyReviewKeyRef\.current \?\?=/);
  assert.match(
    mobileCheckoutScreen,
    /idempotencyKey: pharmacyReviewKeyRef\.current/,
  );
  for (const screen of [mobileInventoryScreen, mobileBoardGameScreen]) {
    assert.match(screen, /operationKeys\.current\[key\] \?\?=/);
    assert.doesNotMatch(
      screen,
      /idempotencyKey:\s*createIdempotencyKey\(/,
      "mobile retries must reuse the original operation key",
    );
  }
});

/**
 * เก็บคีย์ไว้กดซ้ำเป็นของที่ถูก **เฉพาะตอนยังไม่รู้ผล** เท่านั้น
 *
 * คำขอที่เซิร์ฟเวอร์ตัดสินแล้ว (ผิด input / ไม่มีสิทธิ์ / ไม่พบ / ชนคีย์) ไม่ได้เขียนอะไรลงไป
 * ถ้าหน้าจอยังถือคีย์เดิมไว้ คนหน้าเครื่องจะแก้ตามที่ error บอกแล้วกดใหม่ → ชนคีย์เดิมด้วย
 * ข้อมูลคนละชุด → CONFLICT ทุกครั้ง และออกจากทางตันไม่ได้จนกว่าจะปิดแอป
 */
/**
 * "ทดสอบการเชื่อมต่อ" ที่ผ่านต้องเปลี่ยนอะไรบนจอเสมอ
 *
 * การ์ดผลตอนผ่านแสดงสาขา/เครื่อง/กะชุดเดิมทุกตัวอักษร กดแล้วผ่านอีกจึงอ่านไม่ออกว่าปุ่มทำงาน
 * (รายงานจากไอแพดหน้าร้าน 2026-09-14 ว่า "กดแล้วไม่มีอะไรเกิดขึ้น") · และคำตอบที่ค้างจอมาจาก
 * ตอนเปิดแอปก็หน้าตาเหมือนคำตอบสด ทั้งที่ token อาจถูกยกเลิกไปแล้วระหว่างนั้น
 */
/**
 * แถบสถานะบนหน้าล็อกอินต้องบอก "คำตอบคืออะไร" ไม่ใช่แค่ "ยังตรวจไม่ได้"
 *
 * ต่อไม่ถึง (TLS/DNS/เน็ต) กับต่อถึงแล้วเซิร์ฟเวอร์ตอบพัง (HTTP 5xx / ตอบไม่ใช่ข้อมูลเครื่องขาย)
 * พาไปทำคนละอย่างกันคนละทิศ · เหมารวมเป็นบรรทัดเดียวแล้วทิ้ง `verify.cause` คือการลบเบาะแส
 * เดียวที่มี — เคสจริง 2026-09-14: เครื่องต่อไม่ได้เพราะยังไม่ได้ติดตั้ง local CA แต่จอบอกแค่
 * "ยังตรวจกับเซิร์ฟเวอร์ไม่ได้" ทั้งที่ข้อความจริงบอกเรื่อง CA ไว้ครบแล้ว
 */
test("RN login strip names the failure class and the raw cause", () => {
  const screen = withoutComments(mobileLoginScreen);
  for (const kind of ["OFFLINE", "SERVER_ERROR"]) {
    assert.match(
      screen,
      new RegExp(`verify\\.kind === '${kind}'`),
      `${kind} ต้องมีบรรทัดของตัวเอง ไม่ใช่ตกลงไปกิ่งรวม`,
    );
  }
  assert.match(screen, /verify\.cause/, "ต้องแสดงคำตอบดิบที่เซิร์ฟเวอร์/สายเน็ตให้มา");
  assert.doesNotMatch(
    screen,
    /OFFLINE \/ SERVER_ERROR \/ IDLE/,
    "สามสถานะนี้ต้องไม่ถูกเหมารวมกลับมาอีก",
  );
});

test("RN device settings proves the connection test actually ran", () => {
  const screen = withoutComments(mobileDeviceSettingsScreen);
  assert.match(screen, /lastCheckedAt/, "จอต้องอ่านเวลาที่คำตอบกลับมาถึงเครื่อง");
  assert.match(
    screen,
    /verify\.kind !== 'IDLE' && lastCheckedAt != null/,
    "เวลาต้องขึ้นกับทุกผลที่ได้คำตอบแล้ว ไม่ใช่เฉพาะตอนผ่าน",
  );
  // วินาทีสำคัญ: กดสองครั้งในนาทีเดียวต้องเห็นตัวเลขขยับ ไม่งั้นยังอ่านว่าปุ่มเสียเหมือนเดิม
  assert.match(screen, /getSeconds\(\)/, "ต้องแสดงถึงวินาที");
});

test("RN screens release a stale operation key and refetch instead of looping on it", () => {
  for (const screen of [mobileInventoryScreen, mobileBoardGameScreen]) {
    const source = withoutComments(screen);
    assert.match(
      source,
      /isDecidedRejection\(cause\)[\s\S]{0,120}delete operationKeys\.current\[key\]/,
      "a decided rejection must release the key so the next attempt is a new intent",
    );
    assert.match(
      source,
      /const stale = isStaleOperationConflict\(cause\)/,
      "CONFLICT must be told apart from an unknown outcome",
    );
    assert.match(
      source,
      /if \(stale\)[\s\S]{0,240}refetch\(\)/,
      "CONFLICT means the screen is showing stale truth — pull the real state before asking again",
    );
  }
});

test("RN Board Game covers floor, time alerts, members, bill groups, library loans, and POS checkout", () => {
  const boardGame = withoutComments(mobileBoardGameScreen);
  const checkout = withoutComments(mobileCheckoutScreen);
  assert.match(boardGame, /MobilePosBoardGameWorkspaceDocument/);
  assert.match(boardGame, /\['ENDING_SOON', 'OVERDUE'\]/);
  assert.match(boardGame, /MobilePosMembersDocument/);
  assert.match(boardGame, /customerId: selectedMember\?\.customerId \?\? null/);
  assert.match(boardGame, /billingGroupNo/);
  assert.match(boardGame, /MobilePosCloseBoardGameBillingGroupDocument/);
  assert.match(boardGame, /billingGroupId: group\.id/);
  assert.match(boardGame, /MobilePosCheckoutBoardGameCopyDocument/);
  assert.match(boardGame, /MobilePosReturnBoardGameCopyDocument/);
  // `9.91`: import เอกสารไว้เฉย ๆ = คำสั่งที่แอปเอื้อมไม่ถึง · ต้องถูก *เรียก* พร้อมโต๊ะปลายทาง
  // และต้องเลือกย้าย/รวมจากสภาพของโต๊ะปลายทาง ไม่ใช่ให้คนหน้าเครื่องเดาเอง
  for (const document of [
    "MobilePosMoveBoardGameSeatingDocument",
    "MobilePosMergeBoardGameSeatingDocument",
    // `9.93`: แอปให้ยืมกล่องเกมได้แต่บันทึกบัตรไม่ได้ = ด่านตอนปิดบิลไล่ให้ไปหาเบราว์เซอร์
    "MobilePosTakeBoardGameIdentityHoldDocument",
    "MobilePosReleaseBoardGameIdentityHoldDocument",
  ]) {
    assert.match(boardGame, new RegExp(`useMutation\\(\\s*${document}`), `${document} is never used`);
  }
  assert.match(boardGame, /const merging = Boolean\(target\.openSession\)/);
  assert.match(boardGame, /merging\s*\n?\s*\?\s*mergeSeating\s*\n?\s*:\s*moveSeating/);
  assert.match(boardGame, /targetTableId: target\.id/);
  assert.match(boardGame, /source: 'board_game'/);
  // `9.93`: จอเครื่องขายหันออกทางลูกค้า — สี่ตัวท้ายพอให้หาบัตรในลิ้นชัก เลขเต็มไม่มีที่นี่
  assert.match(boardGame, /documentNumberTail/);
  assert.ok(
    !/reveal/i.test(boardGame),
    "the native register must have no way to read a stored ID number",
  );
  assert.match(checkout, /boardGameBillingGroupId/);
  assert.doesNotMatch(checkout, /boardGameSessionId/);
  assert.match(checkout, /MobilePosBoardGameCheckoutDocument/);
  assert.match(checkout, /item\.sku === '__BOARD_GAME_TIME__'/);
  assert.doesNotMatch(
    mobileGraphqlOperations.slice(
      mobileGraphqlOperations.indexOf("mutation MobilePosSale"),
      mobileGraphqlOperations.indexOf("mutation MobilePosShift"),
    ),
    /__BOARD_GAME_TIME__/,
    "the display-only time line must never be sent as a product SKU",
  );
});

test("RN branch inventory keeps branch authority server-side and makes discrepancies explicit", () => {
  const inventory = withoutComments(mobileInventoryScreen);
  assert.match(inventory, /destinationId/);
  assert.doesNotMatch(inventory, /fromLocationId\s*:/);
  assert.doesNotMatch(inventory, /locationId\s*:/);
  assert.match(inventory, /SOURCE_SHORT_SHIP/);
  assert.match(inventory, /LOST_IN_TRANSIT/);
  assert.match(inventory, /hasDiscrepancy\(row\)/);
  assert.match(inventory, /snapshotQty/);
  assert.match(inventory, /MobilePosApplyStockCountDocument/);
  assert.match(inventory, /skip: !credentials \|\| mode !== 'TRANSFER'/);
  assert.match(inventory, /skip: !credentials \|\| mode !== 'COUNT'/);
  assert.match(
    inventory,
    /mode === 'TRANSFER' \? transfers\.error : counts\.error/,
  );
  assert.match(inventory, /run\(`count-item-\$\{selectedCount\.id\}`/);
  assert.match(
    inventory,
    /retryKey\(\s*`count-item-\$\{selectedCount\.id\}`\s*,?\s*\)/,
  );
});

test("mobile inventory idempotency is transactional, tenant-scoped, and rejects changed retries", () => {
  assert.match(inventoryIdempotency, /pg_advisory_xact_lock/);
  assert.match(
    inventoryIdempotency,
    /tenant_id = \$1 AND action = \$2 AND idempotency_key = \$3/,
  );
  assert.match(inventoryIdempotency, /request_hash !== request\.requestHash/);
  assert.match(
    inventoryIdempotencyMigration,
    /PRIMARY KEY \(tenant_id, action, idempotency_key\)/,
  );
  assert.match(inventoryIdempotencyMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(inventoryIdempotencyMigration, /FORCE ROW LEVEL SECURITY/);
  assert.match(inventoryIdempotencyMigration, /TO bms_app/);
});

test("RN expense and petty-cash forms send the evidence required by the shared service", () => {
  assert.match(
    mobileOperationsScreen,
    /placeholder="เลขที่ใบเสร็จ \/ หลักฐาน"/,
  );
  assert.match(mobileOperationsScreen, /receiptRef:\s*evidenceRef\.trim\(\)/);
  assert.match(mobileOperationsScreen, /evidenceRef: evidenceRef\.trim\(\)/);
  assert.match(
    mobileOperationsScreen,
    /ensure\(response\.data\?\.bmsPosExpense, \['FUNDED'\]\)/,
  );
});

test("RN restaurant floor and split checks remain reachable by their exact check id", () => {
  const floor = withoutComments(mobileFloorScreen);
  const detail = withoutComments(mobileCheckDetailScreen);
  assert.match(floor, /table\.checks\.length > 1/);
  assert.match(floor, /checkId: check\.id/);
  assert.match(floor, /checkId: table\.checks\[0\]\?\.id/);
  assert.match(detail, /result\?\.status !== 'SPLIT' \|\| !result\.target/);
  assert.match(detail, /navigation\.replace\('CheckDetail'/);
  const splitOperation = mobileGraphqlOperations.slice(
    mobileGraphqlOperations.indexOf("mutation MobileRestaurantSplitCheck"),
    mobileGraphqlOperations.indexOf("mutation MobileRestaurantMergeChecks"),
  );
  assert.match(
    splitOperation,
    /target\s*\{\s*\.\.\.MobileRestaurantCheckFields/,
  );
});

test("RN restaurant actions mirror server status and second-person contracts", () => {
  const operations = withoutComments(mobileOperationsScreen);
  const detail = withoutComments(mobileCheckDetailScreen);
  assert.match(operations, /table\.status === 'AVAILABLE'/);
  assert.match(operations, /approvals\.includes\('pos\.return\.noreceipt'\)/);
  assert.match(
    operations,
    /bmsPosRestaurantAcceptQrSubmission,[\s\S]{0,80}\['ACCEPTED'\]/,
  );
  assert.match(
    operations,
    /bmsPosRestaurantAcknowledgeServiceCall,[\s\S]{0,80}\['ACKNOWLEDGED'\]/,
  );
  assert.match(
    operations,
    /bmsPosRestaurantContactRequest,[\s\S]{0,80}\['CONTACTING'\]/,
  );
  assert.match(operations, /confirmed:\s*true/);
  assert.match(operations, /kitchenNote:\s*''/);
  assert.match(detail, /option\.status === 'AVAILABLE'/);
  assert.match(detail, /current\?\.hasCurrentOrder/);
  assert.match(
    detail,
    /cancelNeedsApproval && \(!approverId \|\| !approverPin\)/,
  );
  assert.match(detail, /selectedItemIds\.length >= splittableItems\.length/);
  assert.match(detail, /splittableItems\.length === 0/);
  assert.match(detail, /current\?\.status === 'OPEN'/);
  assert.match(
    detail,
    /mobilePane === 'MENU'[\s\S]*<MenuGrid/,
    "a phone-sized restaurant check must expose the menu instead of becoming read-only",
  );
});

test("RN restaurant checkout scopes members per check and exposes only supported payments", () => {
  const checkout = withoutComments(mobileCheckoutScreen);
  const adjustments = withoutComments(mobileAdjustmentsCard);
  assert.match(
    checkout,
    /RESTAURANT_PAYMENT_METHODS[^=]*= \['cash', 'qr', 'card'\]/,
  );
  assert.match(checkout, /restaurantMembers\[restaurantCheckId\]/);
  assert.match(checkout, /customerId: activeMember\?\.id \?\? null/);
  assert.match(checkout, /memberName=\{activeMember\?\.name\}/);
  assert.match(checkout, /memberSelection=\{/);
  assert.doesNotMatch(
    adjustments,
    /memberSelection\?\.member\s*\?\?\s*cart\.member/,
    "an explicitly empty restaurant member must not fall back to the retail cart member",
  );
  assert.match(
    adjustments,
    /memberSelection\s*\?\s*memberSelection\.member\s*:\s*cart\.member/,
    "restaurant member selection must preserve null as an explicit no-member value",
  );
  assert.match(adjustments, /setSelectedMember\(null\)/);
});

test("RN receipts preserve the restaurant service-mode snapshot", () => {
  assert.match(
    posSchema,
    /type BmsPosReceipt \{[\s\S]*restaurantServiceMode: String/,
  );
  assert.match(
    mobileGraphqlOperations,
    /fragment MobilePosReceiptFields[\s\S]*restaurantServiceMode/,
  );
  assert.match(
    mobileSalesContext,
    /receipt\.restaurantServiceMode \? 'restaurant' : 'retail'/,
  );
  assert.match(
    mobileReceiptScreen,
    /sale\.restaurantServiceMode === 'TAKEAWAY'/,
  );
});

/**
 * ไอคอนของแท็บต้องไม่ซ้ำกันในโหมดเดียวกัน
 *
 * ก่อนหน้านี้ "ออร์เดอร์เข้า" กับ "คิว/QR" ใช้ `OrdersIcon` ตัวเดียวกัน **และมี badge ทั้งคู่**
 * บนแถบ 6 แท็บที่ป้ายถูกบีบจนอ่านยาก คนหน้าร้านจึงแยกไม่ออกว่าตัวไหนคืออะไร — นั่นคือเหตุที่
 * สองแท็บนั้นถูกยุบเป็น "งานเข้า" ตัวเดียว · ด่านนี้กันไม่ให้ความกำกวมแบบเดิมกลับมาโดยไม่มีใครเห็น
 */
test("RN tab bar fits both the phone bar and the tablet rail", () => {
  const tabs = withoutComments(mobileMainTabs);

  // อ่านแถบออกมาเป็น "แท็บอะไรโผล่ตอนไหน" จากตัวโค้ดเอง ไม่ใช่จากลิสต์ที่เทสพิมพ์ไว้ —
  // แท็บถูกกรองตอนรันด้วย `mode` และ `isTablet` การนับ <Tab.Screen> ทั้งไฟล์จึงตอบผิดเสมอ
  type Ctx = { mode: string; isTablet: boolean };
  const CASES: { name: string; ctx: Ctx; budget: number }[] = [
    // 402pt ÷ 5 = 80pt ต่อแท็บ · มากกว่านั้นป้ายไทยอย่าง "ออร์เดอร์เข้า" เริ่มถูกตัด
    { name: "phone/restaurant", ctx: { mode: "restaurant", isTablet: false }, budget: 5 },
    { name: "phone/retail", ctx: { mode: "retail", isTablet: false }, budget: 5 },
    { name: "phone/board_game", ctx: { mode: "board_game_cafe", isTablet: false }, budget: 5 },
    // รางสูงเต็มจอ 1366pt — ~64pt ต่อรายการ จึงมีที่ให้ปลายทางจริงโดยไม่ต้องซ่อนใต้ "เพิ่มเติม"
    { name: "tablet/restaurant", ctx: { mode: "restaurant", isTablet: true }, budget: 10 },
    { name: "tablet/retail", ctx: { mode: "retail", isTablet: true }, budget: 10 },
  ];

  /** ประเมิน guard ของ JSX — รูปที่ไม่รู้จักต้องทำให้เทสแดง ไม่ใช่ถูกนับข้ามเงียบ ๆ */
  const evaluate = (expression: string, ctx: Ctx): boolean => {
    const term = (raw: string): boolean => {
      const text = raw.trim().replace(/^\(|\)$/g, "").trim();
      const eq = text.match(/^mode (===|!==) '([a-z_]+)'$/);
      if (eq) return eq[1] === "===" ? ctx.mode === eq[2] : ctx.mode !== eq[2];
      if (text === "isTablet") return ctx.isTablet;
      if (text === "!isTablet") return !ctx.isTablet;
      return assert.fail(`guard ที่เทสยังไม่รู้จัก: ${raw}`);
    };
    return expression.split("||").some(term);
  };

  const seen: Record<string, { tab: string; icon: string }[]> = {};
  for (const entry of CASES) seen[entry.name] = [];
  let guard: string | null = null;
  let pending: string | null = null;
  for (const line of tabs.split(/\r?\n/)) {
    const open = line.match(/^\s*\{(.+?) && \(\s*$/);
    if (open) {
      guard = open[1];
      continue;
    }
    if (/^\s*\)\}\s*$/.test(line)) {
      guard = null;
      continue;
    }
    const named = line.match(/name="(\w+Tab)"/);
    if (named) {
      pending = named[1];
      continue;
    }
    const icon = line.match(/<(\w+Icon) color=/);
    if (!icon || !pending) continue;
    for (const entry of CASES) {
      if (!guard || evaluate(guard, entry.ctx)) {
        seen[entry.name].push({ tab: pending, icon: icon[1] });
      }
    }
    pending = null;
  }

  assert.ok(
    seen["phone/restaurant"].length >= 4,
    "ต้องอ่านโครงแถบออกมาจากซอร์สได้จริง ไม่ใช่ได้ลิสต์ว่าง",
  );
  for (const entry of CASES) {
    const list = seen[entry.name];
    assert.ok(
      list.length <= entry.budget,
      `${entry.name} มี ${list.length} แท็บ — งบคือ ${entry.budget}`,
    );
    // ⚠️ ต้นเหตุที่แถบเดิมอ่านไม่ออก: "ออร์เดอร์เข้า" กับ "คิว/QR" ใช้ OrdersIcon ตัวเดียวกัน
    // และมี badge ทั้งคู่ · ด่านนี้กันไม่ให้ความกำกวมแบบนั้นกลับมาโดยไม่มีใครเห็น
    const icons = list.map((item) => item.icon);
    assert.deepEqual(
      icons.filter((icon, index) => icons.indexOf(icon) !== index),
      [],
      `${entry.name} ใช้ไอคอนซ้ำกัน`,
    );
  }

  const has = (name: string, tab: string) =>
    seen[name].some((item) => item.tab === tab);

  // มือถือ: กะถูกยุบเข้า "เพิ่มเติม" เฉพาะร้านอาหารซึ่งเป็นโหมดเดียวที่แน่นจนป้ายถูกตัด
  assert.equal(has("phone/restaurant", "ShiftTab"), false);
  assert.equal(has("phone/retail", "ShiftTab"), true);
  assert.match(tabs, /OperationsStack\.Screen name="Shift"/, "ยุบแล้วต้องยังหาเจอ");

  // แท็บเล็ต: รางมีที่ — ของที่ถูกยุบเพราะข้อจำกัดของแถบล่างต้องกลับมาเป็นปลายทางของตัวเอง
  // ไม่งั้นคือคิดค่าผ่านทางเป็นจำนวนแตะโดยไม่ได้ประหยัดพื้นที่อะไร
  for (const tab of ["ShiftTab", "InventoryTab", "CounterTab", "SupportTab"]) {
    assert.equal(has("tablet/restaurant", tab), true, `รางต้องมี ${tab}`);
    assert.equal(
      has("phone/restaurant", tab),
      false,
      `${tab} ต้องไม่กินช่องบนแถบล่างของมือถือ`,
    );
  }
  assert.equal(
    has("tablet/restaurant", "OperationsTab"),
    false,
    "กางของออกมาแล้ว 'เพิ่มเติม' ไม่เหลืออะไรให้ถือ",
  );

  // ⚠️ แถบล่างเต็มความกว้างบนไอแพด 13" ยืดแท็บละ ~340pt จนไอคอนลอยกลางช่องว่าง
  assert.match(
    tabs,
    /tabBarPosition: isTablet \? 'left' : 'bottom'/,
    "แท็บเล็ตต้องใช้รางด้านซ้าย ไม่ใช่แถบล่างที่ถูกยืดเต็มจอ",
  );
  assert.match(
    tabs,
    /tabBarVariant: isTablet \? 'material' : 'uikit'/,
    "รางแนวตั้งต้องไม่ยืดเป็นช่องเท่า ๆ กันแบบแถบล่าง",
  );

  // badge ที่นับของซึ่งกดเข้าไปจากแท็บนั้นไม่ถึง คือการส่งคนไปหาของที่ไม่มีอยู่
  const operationsTab = tabs.slice(tabs.indexOf('name="OperationsTab"'));
  assert.doesNotMatch(
    operationsTab.slice(0, 400),
    /tabBarBadge/,
    "แท็บงานหลังร้านไม่มีจอออร์เดอร์เข้าในสแตก จึงต้องไม่ติด badge ของออร์เดอร์",
  );
});

test("RN keeps restaurant queue, QR orders, and service calls visible across every tab", () => {
  const operations = withoutComments(mobileOperationsScreen);
  const context = withoutComments(mobileRestaurantOperationsContext);
  const tabs = withoutComments(mobileMainTabs);
  const watcher = withoutComments(mobileOrderAlertWatcher);
  assert.match(context, /useQuery\(MobileRestaurantQrOrdersDocument/);
  assert.match(context, /useQuery\(MobileRestaurantServiceCallsDocument/);
  assert.match(context, /useQuery\(MobileRestaurantWaitlistDocument/);
  assert.match(context, /const skip = !session \|\| mode !== 'restaurant'/);
  assert.match(
    context,
    /initialized:[\s\S]*!qr\.loading[\s\S]*!calls\.loading[\s\S]*!waitlist\.loading/,
  );
  assert.match(tabs, /<RestaurantOperationsProvider>/);
  // badge เดียวของแท็บ "งานเข้า" ต้องเป็นผลรวมของทุกถังที่กดเข้าไปถึงได้จากแท็บนั้น
  // — นับไม่ครบคือบอกว่าไม่มีงานทั้งที่มี · นับเกินคือส่งคนไปหาของที่กดเข้าไปไม่เจอ
  assert.match(
    tabs,
    /const inboxCount = pendingCount \+ restaurantPendingCount;/,
    "เลขบนแถบต้องรวมทั้งออร์เดอร์เข้าและงานร้านอาหาร",
  );
  assert.match(tabs, /tabBarBadge: inboxCount > 0 \? inboxCount : undefined/);
  assert.match(
    tabs,
    /name="RestaurantOps"[\s\S]{0,200}section="RESTAURANT"/,
    "คิว/QR/เรียก ต้องอยู่ในสแตกเดียวกับออร์เดอร์เข้า ไม่ใช่ใต้แท็บงานหลังร้าน",
  );
  assert.match(watcher, /fireOrderAlert\('service_call'\)/);
  assert.match(watcher, /fireOrderAlert\('qr_order'\)/);
  assert.match(watcher, /fireOrderAlert\('waitlist'\)/);
  assert.match(watcher, /if \(!restaurantOperationsInitialized\)/);
  assert.match(operations, /pendingServiceCallCount > 0[\s\S]*\? 'CALLS'/);
  for (const view of ["QUEUE", "QR", "CALLS"] as const) {
    assert.match(
      operations,
      new RegExp(`restaurantView === '${view}'`),
      `${view} must be directly reachable without scrolling through other restaurant work`,
    );
  }
});
