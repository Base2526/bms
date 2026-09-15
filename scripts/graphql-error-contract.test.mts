import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BMS_GRAPHQL_CLIENT_ERROR_CODES,
  ensureBmsGraphqlErrorCode,
  mobileGraphqlError,
} from "../apps/web/graphql/mobileErrorContract";
import { BoardGamePosError } from "../apps/web/lib/bms/boardGamePosOperations";
import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IdempotencyConflictError,
} from "../apps/web/lib/bms/idempotencyErrors";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

test("the final GraphQL formatter always emits a stable error code", () => {
  const preserved = ensureBmsGraphqlErrorCode({
    message: "conflict",
    extensions: { code: "CONFLICT", reason: "SHIFT_NOT_OPEN" },
  });
  assert.deepEqual(preserved.extensions, { code: "CONFLICT", reason: "SHIFT_NOT_OPEN" });

  // ⚠️ รูปที่ Apollo ส่งให้จริงคือ error ที่ **มี** `INTERNAL_SERVER_ERROR` ติดมาแล้ว —
  // ป้อนแต่ error ที่ยังไม่มี code คือการทดสอบรูปที่ไม่มีอยู่จริงในเส้นทางจริง และเป็นเหตุที่
  // การปฏิเสธตามกติกาของบอร์ดเกมออกไปเป็น 500 อยู่นานโดยที่เทสชุดนี้เขียวตลอด
  const apolloDefaulted = ensureBmsGraphqlErrorCode(
    { message: "โต๊ะถูกปิดไปแล้ว", extensions: { code: "INTERNAL_SERVER_ERROR" } },
    { originalError: new BoardGamePosError("โต๊ะถูกปิดไปแล้ว") },
  );
  assert.equal(
    apolloDefaulted.extensions?.code,
    "CONFLICT",
    "รหัสปริยายของ Apollo ต้องไม่ชนะตัวจัดประเภท ไม่งั้นไคลเอนต์จะยิงซ้ำคำขอที่ไม่มีวันสำเร็จ",
  );
  const apolloDefaultedConflict = ensureBmsGraphqlErrorCode(
    { message: "คีย์ซ้ำ", extensions: { code: "INTERNAL_SERVER_ERROR" } },
    { originalError: new IdempotencyConflictError("คีย์ซ้ำ", "identity.hold") },
  );
  assert.equal(apolloDefaultedConflict.extensions?.code, "CONFLICT");
  // ...แต่ของที่พังจริงยังต้องเป็น 500 ที่มี stack ใน system_logs
  assert.equal(
    ensureBmsGraphqlErrorCode(
      { message: "boom", extensions: { code: "INTERNAL_SERVER_ERROR" } },
      { originalError: new TypeError("boom") },
    ).extensions?.code,
    "INTERNAL_SERVER_ERROR",
  );

  const missing = ensureBmsGraphqlErrorCode({ message: "database unavailable" });
  assert.equal(missing.extensions?.code, "INTERNAL_SERVER_ERROR");
  const blank = ensureBmsGraphqlErrorCode({ message: "blank", extensions: { code: "  " } });
  assert.equal(blank.extensions?.code, "INTERNAL_SERVER_ERROR");

  const clientError = mobileGraphqlError("bad input", "BAD_USER_INPUT", {
    field: "qty",
    code: "FORBIDDEN",
  });
  assert.equal(clientError.extensions.code, "BAD_USER_INPUT");
  assert.equal(clientError.extensions.field, "qty");
});

test("mobile adapters use the central error contract while business statuses remain data", () => {
  const route = withoutComments(read("../apps/web/app/api/graphql/route.ts"));
  const adapters = [
    read("../apps/web/graphql/bmsPosDevice.ts"),
    read("../apps/web/graphql/bmsMobileOperations.ts"),
    read("../apps/web/graphql/posDeviceAuth.ts"),
  ].map(withoutComments).join("\n");
  const businessServices = withoutComments([
    read("../apps/web/lib/bms/pos.ts"),
    read("../apps/web/lib/bms/orders.ts"),
  ].join("\n"));
  const docs = read("../docs/architecture/react-native-graphql-client.md");

  assert.match(route, /formatError:\s*ensureBmsGraphqlErrorCode/);
  assert.doesNotMatch(adapters, /new\s+GraphQLError\s*\(/);
  assert.deepEqual(BMS_GRAPHQL_CLIENT_ERROR_CODES, [
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "BAD_USER_INPUT",
    "NOT_FOUND",
    "CONFLICT",
  ]);

  const documentedCodes = [
    "GRAPHQL_PARSE_FAILED",
    "GRAPHQL_VALIDATION_FAILED",
    ...BMS_GRAPHQL_CLIENT_ERROR_CODES,
    "INTERNAL_SERVER_ERROR",
  ];
  for (const code of documentedCodes) {
    assert.ok(docs.includes("| `" + code + "` |"), "docs must explain " + code);
  }

  const businessStatuses = [
    "PAYMENT_MISMATCH",
    "SHIFT_NOT_OPEN",
    "INSUFFICIENT",
    "SOLD_OUT_TODAY",
  ];
  for (const status of businessStatuses) {
    assert.match(
      businessServices,
      new RegExp('return \\{[^}]{0,160}status: "' + status + '"', "s"),
      status + " must remain data",
    );
    assert.ok(!BMS_GRAPHQL_CLIENT_ERROR_CODES.includes(status as any), status + " must not be an error code");
  }
  const saleStatus = (buildBmsGraphqlSchema().getType("BmsPosSaleResult") as any)?.getFields?.().status;
  assert.equal(String(saleStatus?.type), "String!", "typed sale data must expose its business status");
});

/**
 * คีย์กันรายการซ้ำที่ถูกใช้ไปแล้วกับข้อมูลคนละชุด = คำขอ **เก่า** สำเร็จไปแล้ว
 *
 * ถ้าปล่อยให้ตกเป็น `INTERNAL_SERVER_ERROR` เอกสารสัญญาไคลเอนต์สั่งให้ "ลองใหม่ด้วยคีย์เดิม"
 * ซึ่งกับเคสนี้คือวนล้มแบบเดิมตลอดไป — เครื่องขายไปต่อไม่ได้จนกว่าจะปิดแอป
 */
test("a reused idempotency key is a client conflict, not a server fault", () => {
  const wrapped = {
    originalError: new IdempotencyConflictError(
      IDEMPOTENCY_CONFLICT_MESSAGE,
      "transfer.create",
    ),
  };
  const formatted = ensureBmsGraphqlErrorCode(
    { message: IDEMPOTENCY_CONFLICT_MESSAGE },
    wrapped,
  );
  assert.equal(formatted.extensions?.code, "CONFLICT");
  assert.equal(formatted.extensions?.reason, "IDEMPOTENCY_CONFLICT");

  // รหัสที่ adapter ระบุมาเองต้องชนะเสมอ — ตัวนี้เป็นด่านท้าย ไม่ใช่ตัวเขียนทับ
  const declared = ensureBmsGraphqlErrorCode(
    { message: "ไม่พบใบโอน", extensions: { code: "NOT_FOUND" } },
    { originalError: new IdempotencyConflictError("x", "transfer.send") },
  );
  assert.equal(declared.extensions?.code, "NOT_FOUND");

  // ของจริงยังต้องเป็น 500 เหมือนเดิม
  assert.equal(
    ensureBmsGraphqlErrorCode(
      { message: "boom" },
      { originalError: new Error("connection terminated") },
    ).extensions?.code,
    "INTERNAL_SERVER_ERROR",
  );
});

/**
 * ด่านนี้ไล่จาก **ของจริงในซอร์ส** ไม่ใช่จากลิสต์ที่เทสพิมพ์เอง: ทุกจุดที่เทียบ request hash
 * แล้วปฏิเสธ ต้องโยนคลาสที่ตัวแปลง error รู้จัก ไม่งั้นมันกลับไปเป็น 500 เงียบ ๆ อีกรอบ
 * แล้วเอกสารสัญญาไคลเอนต์จะสั่งให้ยิงซ้ำด้วยคีย์เดิม ซึ่งล้มแบบเดิมตลอดไป
 *
 * คีย์ที่ผิดรูป (สั้น/ยาวเกิน) จงใจไม่อยู่ในด่านนี้ — นั่นคือ input ที่ผิด ไม่ใช่คำขอที่ชนกัน
 * และเส้นทาง POS ตรวจความยาวไปแล้วที่ resolver ก่อนถึง service
 */
test("every idempotency-key rejection throws the typed conflict, never a bare Error", () => {
  const services = [
    "../apps/web/lib/bms/inventoryIdempotency.ts",
    "../apps/web/lib/bms/boardGameCafe.ts",
  ];
  const offenders: string[] = [];
  let typed = 0;
  for (const path of services) {
    const lines = withoutComments(read(path)).split(/\r?\n/);
    typed += lines.filter((line) => line.includes("new IdempotencyConflictError(")).length;
    lines.forEach((line, index) => {
      if (!/request_hash/.test(line) || !/!==/.test(line)) return;
      const guarded = lines.slice(index, index + 4).join("\n");
      if (/throw new Error\(/.test(guarded)) {
        offenders.push(`${path}:${index + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "การชนคีย์ต้องเป็น IdempotencyConflictError เท่านั้น");
  assert.equal(typed, 7, "ทั้งสต็อกสาขาและบอร์ดเกมต้องใช้คลาสเดียวกันครบทุกจุด");
});
