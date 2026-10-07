import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  customerFoodProfile,
  normalizeDietaryTags,
  normalizeFoodAllergenCodes,
} from "../../apps/web/lib/bms/productFoodSafety.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("food declarations are bounded enums and missing data never becomes allergen-free", () => {
  assert.deepEqual(normalizeFoodAllergenCodes(["shellfish", "EGG", "shellfish"]), ["SHELLFISH", "EGG"]);
  assert.deepEqual(normalizeDietaryTags(["jay", "vegetarian"]), ["JAY", "VEGETARIAN"]);
  assert.throws(() => normalizeFoodAllergenCodes(["FAKE_SAFE"]), /ไม่รองรับ/);
  assert.deepEqual(customerFoodProfile({ allergenCodes: ["SHELLFISH"] }), {
    allergenInformationProvided: false,
    declaredAllergens: [],
    dietaryTags: [],
    note: null,
    crossContactUnknown: true,
  });
  assert.deepEqual(customerFoodProfile({
    allergenCodes: ["SHELLFISH"], allergenInformationProvided: true, dietaryTags: ["HALAL"],
  }).declaredAllergens, ["SHELLFISH"]);
});

test("customer product tools expose structured declarations with an explicit unknown state", () => {
  const catalog = source("apps/web/lib/bms/tools/catalog.ts");
  const products = source("apps/web/lib/bms/products.ts");
  assert.match(catalog, /foodProfile:\s*customerFoodProfile/);
  assert.match(products, /allergen_information_provided/);
  assert.match(products, /dietary_tags/);
  assert.match(source("apps/web/app/(admin)/admin/products/page.tsx"), /allergen_information_provided/);
});

test("restaurant reservation chat writes REQUESTED and staff must accept it", () => {
  const migration = source("db/migrations/10.43__bms_restaurant_customer_assistance.sql");
  const customer = source("apps/web/lib/bms/restaurantCustomer.ts");
  const waitlist = source("apps/web/lib/bms/restaurantWaitlist.ts");
  const route = source("apps/web/app/api/pos/restaurant/waitlist/route.ts");
  assert.match(migration, /'REQUESTED'/);
  assert.match(migration, /source = 'CUSTOMER_AI'/);
  assert.match(customer, /'RESERVATION', 'REQUESTED'/);
  assert.match(customer, /RETURNING id, status, party_size, reserved_for, created_at/);
  assert.match(customer, /FOR SHARE OF location, profile/);
  assert.match(source("apps/web/lib/bms/tools/catalog.ts"), /missingContact[\s\S]*?save_customer_checkout_details/);
  assert.match(customer, /customer_id/);
  assert.doesNotMatch(customer, /request_customer_ref|external_ref/);
  assert.match(waitlist, /acceptRestaurantReservationRequest/);
  assert.match(waitlist, /status = 'WAITING'/);
  assert.match(route, /authenticateRestaurantMutation[\s\S]*?accept_request/);
  assert.match(waitlist, /seatRestaurantWaitlistEntry[\s\S]*?status IN \('WAITING','CALLED'\)/);
});

test("restaurant aggregate reads do not expose table ids, guests or promised estimates", () => {
  const customer = source("apps/web/lib/bms/restaurantCustomer.ts");
  assert.match(customer, /availableNow/);
  assert.match(customer, /walkInWaitingParties/);
  assert.match(customer, /acceptedUnseated/);
  assert.match(customer, /inProgressTickets/);
  assert.match(customer, /readyAwaitingServiceTickets/);
  assert.match(customer, /estimatedWaitMinutes:\s*null/);
  assert.match(customer, /estimatedPrepMinutes:\s*null/);
  const returnedBlock = customer.slice(customer.indexOf("return {\n    status: \"OK\""), customer.indexOf("export async function requestRestaurantReservation"));
  assert.doesNotMatch(returnedBlock, /tableId|guestName|guestPhone|ticketId/);
});

test("restaurant prompt corpus pins allergen, availability and reservation behavior", () => {
  const pipeline = source("apps/web/lib/bms/pipeline.ts");
  for (const tool of [
    "get_restaurant_availability",
    "request_restaurant_reservation",
    "get_restaurant_reservation_status",
  ]) assert.match(pipeline, new RegExp(tool));
  assert.match(pipeline, /allergenInformationProvided=false/);
  assert.match(pipeline, /estimatedWaitMinutes\/estimatedPrepMinutes เป็น null/);
  assert.match(pipeline, /ยังไม่ได้จองหรือยืนยันโต๊ะ/);
  const runner = source("scripts/ai-eval/run.mjs");
  for (const caseId of [
    "restaurant-allergen-grounding",
    "restaurant-availability-and-prep",
    "restaurant-reservation-request",
    "restaurant-reservation-status",
    "restaurant-human-support",
  ]) assert.match(runner, new RegExp(caseId));
});

test("live eval inventory knows every new customer tool and reservation is a write", () => {
  const runner = source("scripts/ai-eval/run.mjs");
  for (const tool of [
    "list_restaurant_order_locations",
    "get_restaurant_availability",
    "get_restaurant_reservation_status",
    "request_restaurant_reservation",
  ]) assert.match(runner, new RegExp(`"${tool}"`));
  assert.match(runner, /const WRITE_TOOLS[\s\S]*?"request_restaurant_reservation"/);
});

test("reservation services validate input, replay stored evidence, and preserve CRM ownership", async (t) => {
  // Exercise the real service and transaction flow with a database double, without network access.
  const global = globalThis as typeof globalThis & { __bmsPostgresPool?: unknown };
  const previousPool = global.__bmsPostgresPool;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const calls: Array<{ sql: string; params: any[] }> = [];
  let response: (sql: string, params: any[]) => any[] = () => [];
  let releases = 0;
  const query = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    const rows = response(sql, params);
    return { rows, rowCount: rows.length };
  };
  global.__bmsPostgresPool = {
    query,
    connect: async () => ({ query, release: () => { releases++; } }),
  };
  try {
    const { requestRestaurantReservation, getRestaurantCustomerAvailability,
      listCustomerRestaurantReservations } = await import("../../apps/web/lib/bms/restaurantCustomer.ts");
    const { mergeCustomers } = await import("../../apps/web/lib/bms/customers.ts");
    const desiredAt = new Date(Date.now() + 86_400_000).toISOString();
    const input = { tenantId: "tenant-a", locationId: "branch-a", customerId: "customer-a",
      partySize: 4, desiredAt, note: "window if available" };
    const reset = () => { calls.length = 0; releases = 0; };
    const requestResponse = (sql: string) => {
      if (sql.includes("FROM bms_locations location")) return [{ id: "branch-a", name: "A", branch_code: "A" }];
      if (sql.includes("SELECT name, phone")) return [{ name: "FAKE Guest", phone: "0000000000" }];
      if (sql.includes("INSERT INTO bms_restaurant_waitlist")) return [{ id: "request-a", status: "WAITING",
        party_size: 4, reserved_for: new Date(desiredAt), created_at: new Date() }];
      return [];
    };

    await t.test("invalid party size and ambiguous/impossible timestamps never reach the database", async () => {
      reset();
      for (const partySize of [0, 101, 2.5, NaN, "4"])
        await assert.rejects(requestRestaurantReservation({ ...input, partySize: partySize as number }), /จำนวนลูกค้า/);
      for (const value of [desiredAt.replace(/Z$/, ""), desiredAt.slice(0, 10), "2030-02-30T19:00:00+07:00"])
        await assert.rejects(requestRestaurantReservation({ ...input, desiredAt: value }), /ISO-8601/);
      assert.equal(calls.length, 0);
    });

    await t.test("successful retry reports the persisted party and accepted status, within tenant transaction", async () => {
      reset(); response = requestResponse;
      const result = await requestRestaurantReservation(input);
      assert.equal(result.status, "WAITING");
      assert.equal(result.partySize, 4);
      assert.equal(result.desiredAt, desiredAt);
      assert.equal(calls[0].sql, "BEGIN");
      assert.ok(calls.some((call) => call.sql.includes("set_config('bms.tenant_id'") && call.params[0] === "tenant-a"));
      const insert = calls.find((call) => call.sql.includes("INSERT INTO bms_restaurant_waitlist"))!;
      assert.deepEqual(insert.params.slice(0, 5), ["tenant-a", "branch-a", 4, input.note, desiredAt]);
      assert.match(insert.sql, /party_size = EXCLUDED.party_size/);
      assert.match(insert.sql, /note IS NOT DISTINCT FROM EXCLUDED.note/);
      assert.equal(calls.at(-1)?.sql, "COMMIT");
      assert.equal(releases, 1);
      assert.doesNotMatch(JSON.stringify(result), /FAKE Guest|0000000000/);
    });

    await t.test("changed retry rolls back without a success audit", async () => {
      reset();
      response = (sql) => sql.includes("INSERT INTO bms_restaurant_waitlist") ? [] : requestResponse(sql);
      await assert.rejects(requestRestaurantReservation({ ...input, partySize: 6 }), /ยังไม่ได้บันทึก/);
      assert.equal(calls.at(-1)?.sql, "ROLLBACK");
      assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO bms_audit_log")));
      assert.equal(releases, 1);
    });

    await t.test("missing branch or customer stops before writing any request", async () => {
      for (const missing of ["FROM bms_locations location", "SELECT name, phone"]) {
        reset(); response = (sql) => sql.includes(missing) ? [] : requestResponse(sql);
        await assert.rejects(requestRestaurantReservation(input), /ไม่พบ/);
        assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO bms_restaurant_waitlist")));
        assert.equal(calls.at(-1)?.sql, "ROLLBACK");
      }
    });

    await t.test("availability scopes SLA to the branch and keeps unknown estimates and personal data out", async () => {
      reset(); response = requestResponse;
      const result = await getRestaurantCustomerAvailability("tenant-a", "branch-a");
      const sla = calls.find((call) => call.sql.includes("FROM bms_kitchen_station_slas"))!;
      assert.deepEqual(sla.params, ["tenant-a", "branch-a"]);
      assert.match(sla.sql, /station.location_id IS NULL OR station.location_id = \$2/);
      assert.equal(result.kitchen.estimatedPrepMinutes, null);
      assert.equal(result.queue.estimatedWaitMinutes, null);
      assert.doesNotMatch(JSON.stringify(result), /branch-a|customer-a|guestName|guestPhone|tableId|ticketId/);
      reset();
      await listCustomerRestaurantReservations("tenant-a", "customer-a");
      assert.deepEqual(calls[0].params, ["tenant-a", "customer-a"]);
      assert.match(calls[0].sql, /w.tenant_id = \$1 AND w.customer_id = \$2/);
    });

    const mergeResponse = (sql: string) => sql.includes("SELECT id, name, phone, email")
      ? ["keep", "merge"].map((id) => ({ id, tags: [], followup_opt_out: false }))
      : sql.includes("SELECT COUNT(*)::int AS count FROM bms_board_game_waitlist") ? [{ count: 0 }] : [];
    await t.test("CRM merge moves all reservation history to the surviving customer", async () => {
      reset(); response = mergeResponse;
      assert.equal(await mergeCustomers("tenant-a", "keep", "merge"), true);
      const move = calls.find((call) => call.sql.includes("UPDATE bms_restaurant_waitlist SET customer_id"));
      assert.ok(move);
      assert.deepEqual(move.params, ["tenant-a", "merge", "keep"]);
      assert.equal(calls.at(-1)?.sql, "COMMIT");
    });
    await t.test("CRM merge refuses duplicate active appointments before moving identities", async () => {
      reset(); response = (sql) => sql.includes("FROM bms_restaurant_waitlist source") ? [{ id: "conflict" }] : mergeResponse(sql);
      await assert.rejects(mergeCustomers("tenant-a", "keep", "merge"), /คำขอจองร้านอาหารซ้ำ/);
      assert.ok(!calls.some((call) => call.sql.includes("UPDATE bms_customer_identities")));
      assert.equal(calls.at(-1)?.sql, "ROLLBACK");
    });
    await t.test("shared CRM merge refuses more than three pending CHAT requests without moving identities", async () => {
      reset(); response = sql => sql.includes("SELECT COUNT(*)::int AS count FROM bms_board_game_waitlist")
        ? [{ count: 4 }] : mergeResponse(sql);
      await assert.rejects(mergeCustomers("tenant-a", "keep", "merge"), /ไม่เกิน 3/);
      assert.ok(!calls.some(call => call.sql.includes("UPDATE bms_customer_identities")));
      assert.equal(calls.at(-1)?.sql, "ROLLBACK");
    });
    await t.test("tool boundary returns actionable refusals but propagates unexpected failures", async () => {
      const { ALL_TOOLS } = await import("../../apps/web/lib/bms/tools/catalog.ts");
      const reservation = ALL_TOOLS.find((tool) => tool.name === "request_restaurant_reservation")!;
      const availability = ALL_TOOLS.find((tool) => tool.name === "get_restaurant_availability")!;
      const context = { tenantId: "tenant-a", surface: "customer", channel: "web", customerRef: "fake-ref" } as any;
      reset(); response = (sql) => {
        if (sql.includes("SELECT ci.customer_id")) return [{ customer_id: "customer-a" }];
        if (sql.includes("COUNT(a.id)")) return [{ name: "FAKE Guest", phone: "0000000000", shipping_address_count: 0 }];
        return requestResponse(sql);
      };
      const result = await reservation.execute({ locationId: "branch-a", partySize: 4,
        desiredAt: desiredAt.replace(/Z$/, "") }, context);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /ISO-8601/);
      assert.equal(context.restaurantReservationRequestId, undefined);
      response = () => [];
      const missingBranch = await availability.execute({ locationId: "branch-a" }, context);
      assert.equal(missingBranch.ok, false);
      if (!missingBranch.ok) assert.match(missingBranch.error, /ไม่พบสาขา/);
      // Do not hide a real DB outage as a normal refusal.
      response = (sql) => {
        if (sql.includes("SELECT ci.customer_id")) return [{ customer_id: "customer-a" }];
        if (sql.includes("COUNT(a.id)")) return [{ name: "FAKE Guest", phone: "0000000000", shipping_address_count: 0 }];
        if (sql.includes("INSERT INTO bms_restaurant_waitlist")) throw new Error("fixture database outage");
        return requestResponse(sql);
      };
      await assert.rejects(reservation.execute({ locationId: "branch-a", partySize: 4, desiredAt }, context), /fixture database outage/);
      assert.equal(context.restaurantReservationRequestId, undefined);
    });
  } finally {
    global.__bmsPostgresPool = previousPool;
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
  }
});
