import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BMS_GRAPHQL_CLIENT_ERROR_CODES,
  ensureBmsGraphqlErrorCode,
  mobileGraphqlError,
} from "../apps/web/graphql/mobileErrorContract";
import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

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
