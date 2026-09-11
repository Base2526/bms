import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

const posSource = readFileSync(new URL("../apps/web/graphql/bmsPosDevice.ts", import.meta.url), "utf8");
const mobileSource = readFileSync(new URL("../apps/web/graphql/bmsMobileOperations.ts", import.meta.url), "utf8");

const aliases = new Map<string, { legacy: string; action: string; source: string }>([
  ["bmsPosRestaurantAddCheckItem", { legacy: "bmsPosRestaurantCheckAction", action: "add_item", source: posSource }],
  ["bmsPosRestaurantRemoveCheckItem", { legacy: "bmsPosRestaurantCheckAction", action: "remove_item", source: posSource }],
  ["bmsPosRestaurantSetCheckGuestCount", { legacy: "bmsPosRestaurantCheckAction", action: "set_guest_count", source: posSource }],
  ["bmsPosRestaurantSendCheckToKitchen", { legacy: "bmsPosRestaurantCheckAction", action: "send_kitchen", source: posSource }],
  ["bmsPosRestaurantMoveCheck", { legacy: "bmsPosRestaurantCheckAction", action: "move", source: posSource }],
  ["bmsPosRestaurantSplitCheck", { legacy: "bmsPosRestaurantCheckAction", action: "split", source: posSource }],
  ["bmsPosRestaurantMergeChecks", { legacy: "bmsPosRestaurantCheckAction", action: "merge", source: posSource }],
  ["bmsPosRestaurantCancelCheck", { legacy: "bmsPosRestaurantCheckAction", action: "cancel", source: posSource }],
  ["bmsPosRestaurantSettleCheck", { legacy: "bmsPosRestaurantCheckAction", action: "settle", source: posSource }],
  ["bmsPosRestaurantAcceptIncomingOrder", { legacy: "bmsPosRestaurantIncomingAction", action: "accept", source: posSource }],
  ["bmsPosRestaurantSetOrderingPaused", { legacy: "bmsPosRestaurantIncomingAction", action: "pause", source: posSource }],
  ["bmsPosRestaurantCancelOrderLines", { legacy: "bmsPosRestaurantIncomingAction", action: "cancel_lines", source: posSource }],
  ["bmsPosRestaurantAcceptQrSubmission", { legacy: "bmsPosRestaurantQrOrderAction", action: "accept", source: posSource }],
  ["bmsPosRestaurantRejectQrSubmission", { legacy: "bmsPosRestaurantQrOrderAction", action: "reject", source: posSource }],
  ["bmsPosRestaurantContactRequest", { legacy: "bmsPosRestaurantRequestAction", action: "contact", source: posSource }],
  ["bmsPosRestaurantConfirmRequest", { legacy: "bmsPosRestaurantRequestAction", action: "confirm", source: posSource }],
  ["bmsPosRestaurantCancelRequest", { legacy: "bmsPosRestaurantRequestAction", action: "cancel", source: posSource }],
  ["bmsPosRestaurantAcknowledgeServiceCall", { legacy: "bmsPosRestaurantServiceCallAction", action: "acknowledge", source: posSource }],
  ["bmsPosRestaurantCompleteServiceCall", { legacy: "bmsPosRestaurantServiceCallAction", action: "complete", source: posSource }],
  ["bmsPosRestaurantAddWaitlistEntry", { legacy: "bmsPosRestaurantWaitlistAction", action: "add", source: posSource }],
  ["bmsPosRestaurantCallWaitlistEntry", { legacy: "bmsPosRestaurantWaitlistAction", action: "call", source: posSource }],
  ["bmsPosRestaurantCancelWaitlistEntry", { legacy: "bmsPosRestaurantWaitlistAction", action: "cancel", source: posSource }],
  ["bmsPosRestaurantNoShowWaitlistEntry", { legacy: "bmsPosRestaurantWaitlistAction", action: "no_show", source: posSource }],
  ["bmsPosRestaurantSeatWaitlistEntry", { legacy: "bmsPosRestaurantWaitlistAction", action: "seat", source: posSource }],
  ["bmsCreateStockTransfer", { legacy: "bmsStockTransfer", action: "create", source: mobileSource }],
  ["bmsSendStockTransfer", { legacy: "bmsStockTransfer", action: "send", source: mobileSource }],
  ["bmsReceiveStockTransfer", { legacy: "bmsStockTransfer", action: "receive", source: mobileSource }],
  ["bmsCancelStockTransfer", { legacy: "bmsStockTransfer", action: "cancel", source: mobileSource }],
  ["bmsCreateStockCount", { legacy: "bmsStockCount", action: "create", source: mobileSource }],
  ["bmsRecordStockCountItem", { legacy: "bmsStockCount", action: "item", source: mobileSource }],
  ["bmsApplyStockCount", { legacy: "bmsStockCount", action: "apply", source: mobileSource }],
  ["bmsCancelStockCount", { legacy: "bmsStockCount", action: "cancel", source: mobileSource }],
]);

const legacyFields = [...new Set([...aliases.values()].map(({ legacy }) => legacy))].sort();

function resolverMethod(source: string, operation: string): string {
  const start = new RegExp(`^    async ${operation}\\b`, "m").exec(source);
  assert.ok(start, `${operation} must have a named resolver method`);
  const tail = source.slice(start.index + start[0].length);
  const next = /^    async bms[A-Za-z0-9]+\b/m.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

test("every compatibility action has one discoverable named mutation and legacy fields are deprecated", () => {
  const mutation = buildBmsGraphqlSchema().getMutationType();
  assert.ok(mutation);
  const fields = mutation.getFields();
  assert.equal(aliases.size, 32);
  for (const name of aliases.keys()) assert.ok(fields[name], `Mutation.${name} must exist`);
  for (const name of legacyFields) {
    assert.ok(fields[name], `legacy Mutation.${name} must remain during migration`);
    assert.match(fields[name].deprecationReason ?? "", /named/i, `${name} must direct clients to named fields`);
  }
});

test("named mutations inject one fixed action and delegate to the original resolver", () => {
  for (const [name, contract] of aliases) {
    const body = resolverMethod(contract.source, name);
    assert.match(body, /named(?:Input|Mobile)Action\(/, `${name} must use the compatibility delegate`);
    assert.match(body, new RegExp(`compatibilityMutations\\.${contract.legacy}\\b`));
    assert.match(body, new RegExp(`"${contract.action}"`), `${name} must inject ${contract.action}`);
    assert.doesNotMatch(body, /await\s+(?:add|remove|set|send|move|split|merge|cancel|settle|accept|reject|review|update|create|record|apply)[A-Z]/,
      `${name} must not fork service/business logic`);
  }
});

test("named action inputs expose no action discriminator and preserve required idempotency", () => {
  const schema = buildBmsGraphqlSchema();
  const mutation = schema.getMutationType();
  assert.ok(mutation);
  for (const name of aliases.keys()) {
    const field = mutation.getFields()[name];
    assert.ok(field);
    assert.equal(field.args.some((argument) => argument.name === "action"), false, `${name} cannot accept action`);
    for (const argument of field.args) {
      const typeName = String(argument.type).replace(/[\[\]!]/g, "");
      const type = schema.getType(typeName) as any;
      if (!type || typeof type.getFields !== "function") continue;
      assert.equal(Boolean(type.getFields().action), false, `${typeName} cannot contain action`);
    }
  }
  const cancelLines = mutation.getFields().bmsPosRestaurantCancelOrderLines;
  const inputName = String(cancelLines.args.find((argument) => argument.name === "input")?.type).replace(/[\[\]!]/g, "");
  const input = schema.getType(inputName) as any;
  assert.equal(String(input.getFields().idempotencyKey.type), "String!");
});
