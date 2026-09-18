import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applyBestBoardGameOffer,
  type BoardGameOffer,
} from "../apps/web/lib/bms/boardGameOffers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const baseOffer = (overrides: Partial<BoardGameOffer> = {}): BoardGameOffer => ({
  id: "offer-1",
  locationId: null,
  code: "HAPPY_HOUR",
  name: "Happy hour",
  kind: "TIME_PERCENT",
  percentOff: 10,
  fixedPrice: null,
  minPlayers: 1,
  maxPlayers: null,
  minimumMinutes: 0,
  requiredProductSku: null,
  validFrom: null,
  validUntil: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startsLocalTime: null,
  endsLocalTime: null,
  active: true,
  sortOrder: 0,
  note: null,
  ...overrides,
});

const context = {
  at: new Date("2026-09-20T12:00:00.000Z"),
  timezone: "UTC",
  productSkus: new Set<string>(),
};

test("percentage and per-person offers calculate from frozen gross time", () => {
  const percent = applyBestBoardGameOffer(
    [{ billableMinutes: 60, grossAmount: 100 }, { billableMinutes: 90, grossAmount: 150 }],
    [baseOffer({ percentOff: 20 })], context,
  );
  assert.equal(percent?.total, 200);
  assert.deepEqual(percent?.lines.map((line) => line.amount), [80, 120]);

  const perPerson = applyBestBoardGameOffer(
    [{ billableMinutes: 60, grossAmount: 100 }, { billableMinutes: 60, grossAmount: 40 }],
    [baseOffer({ kind: "TIME_FIXED_PER_PERSON", percentOff: null, fixedPrice: 60 })], context,
  );
  assert.equal(perPerson?.total, 100, "a fixed price is a cap and never raises a cheaper line");
});

test("a group price allocates cents without changing the exact frozen total", () => {
  const applied = applyBestBoardGameOffer(
    [{ billableMinutes: 120, grossAmount: 100 }, { billableMinutes: 120, grossAmount: 50 }],
    [baseOffer({ kind: "GROUP_FIXED", percentOff: null, fixedPrice: 99.99 })], context,
  );
  assert.equal(applied?.total, 99.99);
  assert.equal(applied?.lines.reduce((sum, line) => sum + line.amount, 0), 99.99);
  assert.equal(Math.round((applied?.lines.reduce((sum, line) => sum + line.offerDiscountAmount, 0) ?? 0) * 100) / 100, 50.01);
});

test("eligibility requires every participant duration and a real tab SKU", () => {
  const offer = baseOffer({ minimumMinutes: 120, requiredProductSku: "DRINK-01" });
  assert.equal(applyBestBoardGameOffer(
    [{ billableMinutes: 120, grossAmount: 100 }, { billableMinutes: 90, grossAmount: 100 }],
    [offer], { ...context, productSkus: new Set(["DRINK-01"]) },
  ), null);
  assert.equal(applyBestBoardGameOffer(
    [{ billableMinutes: 120, grossAmount: 100 }], [offer], context,
  ), null);
  assert.equal(applyBestBoardGameOffer(
    [{ billableMinutes: 120, grossAmount: 100 }], [offer],
    { ...context, productSkus: new Set(["DRINK-01"]) },
  )?.total, 90);
});

test("the server picks the cheapest eligible offer", () => {
  const applied = applyBestBoardGameOffer(
    [{ billableMinutes: 120, grossAmount: 200 }],
    [
      baseOffer({ id: "percent", percentOff: 20 }),
      baseOffer({ id: "fixed", kind: "GROUP_FIXED", percentOff: null, fixedPrice: 120 }),
    ],
    context,
  );
  assert.equal(applied?.offer.id, "fixed");
  assert.equal(applied?.total, 120);
});

test("offer application competes with member pass and snapshots the winner", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const calculation = service.slice(
    service.indexOf("export async function calculateBoardGameGroupCharges"),
    service.indexOf("async function closeOpenBillingGroupInTx"),
  );
  assert.match(calculation, /eligibleBoardGameOffersInTx/);
  assert.match(calculation, /offer\.total > passTotal/);
  assert.match(calculation, /passId: null/);
  assert.match(calculation, /offerDiscountAmount/);
});

test("offer eligibility reads the shop timezone from the tenant profile", () => {
  const service = read("apps/web/lib/bms/boardGameOffers.ts");
  assert.match(
    service,
    /SELECT s\.location_id, store\.timezone[\s\S]*?LEFT JOIN bms_store_profile store ON store\.tenant_id = s\.tenant_id/,
  );
  assert.doesNotMatch(
    service,
    /bms_board_game_public_locations\s+p[\s\S]*?p\.timezone/,
    "public discovery has no timezone column; billing must use bms_store_profile",
  );
});

test("automatic renewal is one atomic entitlement, payment, and credit-ledger write", () => {
  const migration = read("db/migrations/10.4__bms_board_game_pass_renewals.sql");
  const service = read("apps/web/lib/bms/boardGamePassRenewals.ts");
  const cron = read("apps/web/app/api/bms/board-game/pass-renewals/run/route.ts");
  const workflow = read(".github/workflows/bms-cron.yml");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_pass_renewals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_pass_renewal_runs/);
  assert.match(migration, /BOARD_GAME_MEMBER_PASS/);
  assert.match(migration, /board_game_member_pass_id/);
  assert.match(migration, /status IN \('ACTIVE','PAST_DUE','PAUSED','CANCELLED'\)/);
  assert.match(service, /INSERT INTO bms_board_game_member_passes/);
  assert.match(service, /INSERT INTO bms_board_game_pass_ledger/);
  assert.match(service, /INSERT INTO bms_store_credit_ledger/);
  assert.match(service, /INSERT INTO bms_payments/);
  assert.match(service, /SET status='PAST_DUE'/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(cron, /authorizeCronRequest/);
  assert.match(cron, /recordJobRun\("board-game-pass-renewals"/);
  assert.match(workflow, /board-game-pass-renewals[\s\S]*?\/api\/bms\/board-game\/pass-renewals\/run/);
});

test("a generic payment refund cannot lie about returning renewal store credit", () => {
  const payments = read("apps/web/lib/bms/payments.ts");
  const paymentUi = read("apps/web/app/(admin)/admin/payment/page.tsx");
  assert.match(payments, /to === "REFUNDED" && payment\.payable_type === "BOARD_GAME_MEMBER_PASS"/);
  assert.match(paymentUi, /r\.status === "CONFIRMED" && !r\.sourcePaymentId && !r\.memberPassId/);
  assert.match(paymentUi, /target_member_pass/);
});

test("renewal funding must be store credit owned by the same member", () => {
  const service = read("apps/web/lib/bms/boardGamePassRenewals.ts");
  assert.match(service, /funding\.customer_id !== source\.customer_id/);
  assert.match(service, /row\.credit_customer_id === row\.customer_id/);
  assert.match(service, /Number\(row\.balance\) >= price/);
});

test("CRM merge carries passes, funding credit, and non-duplicate renewals together", () => {
  const customers = read("apps/web/lib/bms/customers.ts");
  assert.match(customers, /UPDATE bms_store_credits SET customer_id/);
  assert.match(customers, /UPDATE bms_board_game_member_passes SET customer_id/);
  assert.match(customers, /UPDATE bms_board_game_pass_renewals source[\s\S]*?status = 'CANCELLED'/);
  assert.match(customers, /UPDATE bms_board_game_pass_renewals SET customer_id/);
});

test("POS shows only the winning time benefit while pass rows keep renewal status compact", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const graphql = read("apps/web/graphql/bmsPosDevice.ts");
  const operations = read("apps/mobile/src/graphql/operations.graphql");
  const mobileCheckout = read("apps/mobile/src/screens/sell/CheckoutScreen.tsx");
  const webPos = read("apps/web/app/(pos)/pos/page.tsx");
  const admin = read("apps/web/app/(admin)/admin/board-game/page.tsx");

  assert.match(service, /AS offer_name/);
  assert.match(service, /AS offer_discount_amount/);
  assert.match(graphql, /offerName: String/);
  assert.match(graphql, /offerDiscountAmount: Float!/);
  assert.match(operations, /passCoveredAmount\s+offerCode\s+offerName\s+offerDiscountAmount/);
  assert.match(mobileCheckout, /boardGameTimeBenefit/);
  assert.match(mobileCheckout, /โปรโมชัน.*ลดค่าเล่น/s);
  assert.match(webPos, /offerDiscountAmount[\s\S]*?ลดค่าเล่น/);
  assert.match(admin, /renewalByPassId/);
  assert.match(admin, /renewal_auto_badge/);
});
