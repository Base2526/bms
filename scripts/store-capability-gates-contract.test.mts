/**
 * A switch that changes nothing is worse than no switch.
 *
 * `bms_store_capabilities` holds thirteen flags, but only some of them are read before the code
 * does anything. The rest describe what the shop's data already looks like: packs exist because
 * there are rows in `bms_product_packs`, expiry blocking and FEFO happen because there are rows in
 * `bms_inventory_lots`, serial capture happens because `bms_products.serial_tracked` is set, and
 * the pharmacy gate is `business_archetype`. Toggling those changed nothing at the counter while
 * the screen showed a switch — so a shop could read "LOT_TRACKING: off" and still be blocked from
 * selling an expired lot, or believe it had turned something off that was never on.
 *
 * `GATING_CAPABILITIES` is the list the UI renders as switches and the only list
 * `upsertStoreCapability()` will write. This test keeps that list equal to the set of capabilities
 * the source actually gates on, in both directions:
 *
 *   - a switch with no `isCapabilityEnabledInTx()` behind it is a lie to the operator;
 *   - a gate with no switch is a behaviour nobody can turn on.
 *
 * Deliberately not made switchable: turning `LOT_TRACKING`/`EXPIRY_TRACKING`/`FEFO` off would be a
 * button that sells expired stock, and turning `PACK` off would stop pack scanning at every
 * restaurant (that preset has no PACK) even though packs are configured per product.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GATING_CAPABILITIES,
  STORE_CAPABILITIES,
  isGatingCapability,
} from "../apps/web/lib/bms/storeCapabilities.ts";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "node_modules" || entry.name === ".next" ? [] : sourceFiles(path.join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []
  );

const gatedInSource = (): Set<string> => {
  const found = new Set<string>();
  for (const file of sourceFiles(path.join(WEB, "lib"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/isCapabilityEnabledInTx\([^)]*?"([A-Z_]+)"\s*\)/g)) {
      found.add(match[1]);
    }
  }
  return found;
};

test("every capability offered as a switch is one the code actually reads", () => {
  const gated = gatedInSource();
  assert.ok(gated.size > 0, "the scanner found no capability gate at all — the pattern moved");
  assert.deepEqual(
    [...GATING_CAPABILITIES].sort(),
    [...gated].sort(),
    "GATING_CAPABILITIES must equal the capabilities guarded by isCapabilityEnabledInTx()"
  );
  for (const capability of GATING_CAPABILITIES) {
    assert.ok(
      (STORE_CAPABILITIES as readonly string[]).includes(capability),
      `${capability} is gated but is not a known capability`
    );
  }
});

test("a status-only capability cannot be written as if it were a switch", async () => {
  const { upsertStoreCapability } = await import("../apps/web/lib/bms/storeCapabilities.ts");
  const statusOnly = STORE_CAPABILITIES.filter((capability) => !isGatingCapability(capability));
  assert.ok(statusOnly.length > 0, "this test assumes some capabilities are derived, not switched");
  for (const capability of statusOnly) {
    await assert.rejects(
      // No database is touched: the refusal happens before a client is ever taken.
      () => upsertStoreCapability("00000000-0000-0000-0000-000000000000", { capability, enabled: false }),
      /ไม่ใช่สวิตช์/,
      `${capability} must be refused, not written as a meaningless override`
    );
  }
});

/**
 * Turning a capability on or off changes how every bill in the shop is priced and deducted
 * (weighed selling, recipes, the kitchen queue). The screen already hides those switches behind
 * `product.edit`, but the resolver only asked for an admin session — and a hidden button is not a
 * gate. Every mutation in this module must name a permission, the same way its neighbours do.
 */
test("every stock-capability mutation names a permission, not just an admin session", () => {
  const source = readFileSync(path.join(WEB, "graphql", "bmsStockCapabilities.ts"), "utf8");
  const mutationBlock = source.slice(source.indexOf("  Mutation: {"));
  const mutations = [...mutationBlock.matchAll(/^    async (bms\w+)\(/gm)].map((match) => match[1]);
  assert.ok(mutations.length >= 7, `expected the module's mutations, found ${mutations.length}`);
  for (const [index, name] of mutations.entries()) {
    const start = mutationBlock.indexOf(`async ${name}(`);
    const nextName = mutations[index + 1];
    const end = nextName ? mutationBlock.indexOf(`async ${nextName}(`) : mutationBlock.length;
    const body = mutationBlock.slice(start, end);
    assert.match(body, /requirePermission\(ctx, "[a-z.]+"\)/,
      `${name} must re-check a permission on the server — hiding its button is not a gate`);
  }
});

/**
 * A bill that is cancelled or voided has to stop the kitchen too. A ticket left open after the
 * money went back is food that gets cooked and thrown away, and the board gives no reason why.
 */
test("cancelling and voiding a bill both close its open kitchen tickets", () => {
  const orders = readFileSync(path.join(WEB, "lib", "bms", "orders.ts"), "utf8");
  const cancelInTx = orders.slice(orders.indexOf("export async function cancelOrderInTx("));
  assert.match(cancelInTx.slice(0, cancelInTx.indexOf("export async function afterOrderCancellation")),
    /cancelKitchenTicketsForOrderInTx\(/,
    "cancelOrderInTx must close the bill's kitchen tickets in the same transaction");

  const pos = readFileSync(path.join(WEB, "lib", "bms", "pos.ts"), "utf8");
  const voidBlock = pos.slice(pos.indexOf("if (input.isVoid) {"));
  assert.match(voidBlock.slice(0, voidBlock.indexOf("await client.query(\"COMMIT\")")),
    /cancelKitchenTicketsForOrderInTx\(/,
    "the void stamp must close the bill's kitchen tickets in the same transaction");
});
