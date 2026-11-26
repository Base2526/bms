import assert from "node:assert/strict";
import test from "node:test";
import { graphql } from "../apps/web/node_modules/graphql/index.js";
import { buildBmsGraphqlSchema, validateBmsGraphqlDocument } from "../apps/web/graphql/schema";

const schema = buildBmsGraphqlSchema();

test("mobile kiosk documents validate and never accept client tenant, branch or device authority", () => {
  const operations = [
    `query($code: String) { bmsPosRestaurantKioskOrders(requestCode: $code) {
      active submissions { id serviceMode status checkId checkStatus orderId items { sku productName } }
    } }`,
    `mutation($input: BmsPosRestaurantKioskPreviewInput!) { bmsPosRestaurantKioskPreview(input: $input) {
      quote { fingerprint total lines { sku lineAmount modifiers { code name priceDelta } } }
      check { id version tableId openedAt } priceChanged
    } }`,
    `mutation($input: BmsPosRestaurantKioskAcceptInput!) { bmsPosRestaurantKioskAccept(input: $input) {
      status reason replayed check { id }
    } }`,
    `mutation($input: BmsPosRestaurantKioskRejectInput!) { bmsPosRestaurantKioskReject(input: $input) {
      status reason
    } }`,
  ];
  for (const operation of operations) assert.deepEqual(validateBmsGraphqlDocument(operation), []);
  for (const name of ["BmsPosRestaurantKioskPreviewInput", "BmsPosRestaurantKioskAcceptInput", "BmsPosRestaurantKioskRejectInput"]) {
    const fields = (schema.getType(name) as any).getFields();
    for (const forbidden of ["tenantId", "locationId", "deviceId", "shiftId", "actorUserId"])
      assert.equal(fields[forbidden], undefined);
  }
});

test("unpaired mobile device cannot list or decide kiosk requests", async () => {
  const read = await graphql({ schema,
    source: `{ bmsPosRestaurantKioskOrders { submissions { id } } }`,
    contextValue: {},
  });
  assert.equal(read.data, null);
  assert.equal(read.errors?.[0]?.extensions.code, "UNAUTHENTICATED");
  const accept = await graphql({ schema,
    source: `mutation($input: BmsPosRestaurantKioskAcceptInput!) {
      bmsPosRestaurantKioskAccept(input: $input) { status }
    }`,
    variableValues: { input: { cashierUserId: "00000000-0000-4000-8000-000000000001",
      pin: "1234", submissionId: "00000000-0000-4000-8000-000000000002" } },
    contextValue: {},
  });
  assert.equal(accept.data, null);
  assert.equal(accept.errors?.[0]?.extensions.code, "UNAUTHENTICATED");
});
