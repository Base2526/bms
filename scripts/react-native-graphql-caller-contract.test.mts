import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(repo, "apps", "mobile", "src");
const read = (relative: string) =>
  readFileSync(path.join(repo, relative), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory()
      ? sourceFiles(target)
      : /\.(ts|tsx)$/.test(name)
      ? [target]
      : [];
  });
}

test("RN runtime screens and state no longer import mock data", () => {
  const runtimeRoots = ["components", "screens", "state"];
  const offenders = runtimeRoots.flatMap((root) =>
    sourceFiles(path.join(mobile, root))
      .filter((file) =>
        /from\s+["'][^"']*\/mocks(?:\/|["'])/.test(readFileSync(file, "utf8"))
      )
      .map((file) => path.relative(repo, file))
  );
  assert.deepEqual(offenders, []);
});

test("RN pairing bootstrap uses GraphQL rather than a POS REST caller", () => {
  const device = read("apps/mobile/src/state/DeviceContext.tsx");
  assert.match(device, /graphqlHttpUrl\(candidate\.serverUrl\)/);
  assert.match(device, /print\(PosBootstrapDocument\)/);
  assert.doesNotMatch(device, /\/api\/pos\/session/);
});

test("parked-bill caller uses the resolver's exact action and status contract", () => {
  const cart = read("apps/mobile/src/state/CartContext.tsx");
  assert.match(cart, /action:\s*'park'/);
  assert.match(cart, /action:\s*'resume'/);
  assert.match(cart, /action:\s*'drop'/);
  assert.match(cart, /\['PARKED', 'RESUMED', 'DROPPED'\]/);
  assert.doesNotMatch(cart, /action:\s*'(?:PARK|RESUME|DELETE)'/);
});

test("shift-bound reads are not sent before an open shift exists", () => {
  const shift = read("apps/mobile/src/state/ShiftContext.tsx");
  const cart = read("apps/mobile/src/state/CartContext.tsx");
  assert.match(
    shift,
    /MobilePosCashMovementsDocument[\s\S]*?skip:\s*!session \|\| !shift/
  );
  assert.match(
    cart,
    /MobilePosParkedSalesDocument[\s\S]*?skip:\s*!session \|\| !isShiftOpen/
  );
});

test("RN money callers retain stable retry keys and filter second-person permissions", () => {
  const checkout = read("apps/mobile/src/screens/sell/CheckoutScreen.tsx");
  const detail = read("apps/mobile/src/screens/sell/SaleDetailScreen.tsx");
  const shift = read("apps/mobile/src/screens/shift/ShiftScreen.tsx");
  const adjustments = read(
    "apps/mobile/src/components/CheckoutAdjustmentsCard.tsx"
  );
  assert.match(
    checkout,
    /idempotencyRef\.current \?\?= createIdempotencyKey\('sale'\)/
  );
  assert.match(
    detail,
    /returnKey\.current \?\?= createIdempotencyKey\('return'\)/
  );
  assert.match(detail, /voidKey\.current \?\?= createIdempotencyKey\('void'\)/);
  assert.match(
    detail,
    /note:\s*`\[\$\{returnReason\}\] \$\{reason\.trim\(\)\}`/
  );
  assert.match(shift, /createIdempotencyKey\('cash'\)/);
  assert.match(adjustments, /approvals\.includes\('pos\.discount\.approve'\)/);
  assert.match(detail, /approvals\.includes\('pos\.void'\)/);
  assert.match(shift, /approvals\.includes\('pos\.cash\.movement'\)/);
});

test("RN GraphQL document contains the authoritative core workflows", () => {
  const operations = read("apps/mobile/src/graphql/operations.graphql");
  for (const name of [
    "MobilePosCatalog",
    "MobilePosSale",
    "MobilePosReturn",
    "MobilePosVoid",
    "MobilePosShift",
    "MobilePosCashMovement",
    "MobilePosPark",
    "MobileRestaurantOpenCheck",
    "MobileRestaurantAddCheckItem",
    "MobileRestaurantSendCheck",
    "MobileRestaurantSettleCheck",
    "MobileKitchenTicketStatus",
    "MobileRestaurantAcceptIncoming",
  ]) {
    assert.match(operations, new RegExp(`(?:query|mutation)\\s+${name}\\b`));
  }
});
