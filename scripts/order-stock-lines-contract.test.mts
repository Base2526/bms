/**
 * "Anything that moves stock reads the view, not the table."
 *
 * `8.8` introduced `bms_order_stock_lines` because a sold line is not always the thing that
 * leaves the shelf: a gift set holds its components, and since `9.40` a menu line holds the
 * ingredients recorded in its consumption snapshot. Those derived products own an inventory row
 * pinned at zero, so any statement that moves stock straight from `bms_order_items` hits
 * `CHECK (current_stock >= 0)` / `CHECK (reserved_stock >= 0)` and takes its whole transaction
 * down, while the units actually reserved are never touched.
 *
 * The docs said four places read the view. Two more did not, and both failed closed in a way
 * nobody would connect to bundles:
 *
 *   - `createShipment()` deducted from `bms_order_items`, so a bill containing a set or a menu
 *     item could not be shipped at all.
 *   - `releaseExpiredOrders()` released from `bms_order_items`, so a single derived order in the
 *     batch rolled back the entire cron — every tenant's expired holds stayed locked, silently.
 *
 * A prose invariant that four call sites must remember is one refactor away from being five.
 * This test reads the source instead: any SQL statement that writes `bms_inventory` and names
 * `bms_order_items` is refused, whichever file it lives in.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BMS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "lib", "bms");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(path.join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [path.join(dir, entry.name)]
        : []
  );

/**
 * Template-literal SQL, the only way this repo writes queries. `--` comments are stripped first:
 * the correct statements explain themselves with "read the view, not bms_order_items", and a
 * scanner that reads its own documentation as a violation is a scanner nobody keeps.
 */
const statements = (source: string): string[] =>
  [...source.matchAll(/`([^`]*)`/g)].map((m) => m[1].replace(/--[^\n]*/g, " "));

const writesInventory = (sql: string) =>
  /update\s+bms_inventory/i.test(sql) ||
  (/insert\s+into\s+bms_inventory\b/i.test(sql) && /do\s+update/i.test(sql));

/** `\b` matters: `bms_order_item_stock_consumption` is the snapshot the view itself reads. */
const readsOrderItems = (sql: string) => /\bbms_order_items\b/.test(sql);

test("no statement moves stock straight from bms_order_items", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(BMS)) {
    const source = readFileSync(file, "utf8");
    for (const sql of statements(source)) {
      if (writesInventory(sql) && readsOrderItems(sql)) {
        offenders.push(`${path.relative(BMS, file).split(path.sep).join("/")}: ${sql.trim().split("\n")[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "these move stock from the sold line instead of bms_order_stock_lines");
});

test("the paths that move stock for an order actually name the view", () => {
  // Guards the inverse mistake: dropping the join altogether would satisfy the test above.
  const expected = ["orders.ts", "pos.ts", "shipping.ts", "deposits.ts"];
  for (const name of expected) {
    const source = readFileSync(path.join(BMS, name), "utf8");
    assert.ok(
      source.includes("bms_order_stock_lines"),
      `${name} moves order stock but never reads bms_order_stock_lines`
    );
  }
});
