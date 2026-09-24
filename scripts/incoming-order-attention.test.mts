import assert from "node:assert/strict";
import test from "node:test";
import {
  incomingOrderAttentionKeys,
  incomingOrderNeedsAttention,
  incomingOrderOperationalState,
  incomingOrderProblemReason,
  type IncomingOrderAttentionView,
} from "../apps/web/lib/pos/incomingOrderAttention.ts";
import { summarizeDeliveryIntakeControls } from "../apps/web/lib/pos/deliveryIntakePresentation.ts";

const order = (overrides: Partial<IncomingOrderAttentionView> = {}): IncomingOrderAttentionView => ({
  id: "order-1",
  status: "PACKING",
  deliveryStatus: "PREPARING",
  providerCommandStatus: "SUCCEEDED",
  ...overrides,
});

test("incoming attention covers acceptance, hand-off and provider recovery without flagging normal preparation", () => {
  assert.equal(incomingOrderNeedsAttention(order()), false);
  assert.equal(incomingOrderNeedsAttention(order({ status: "PAID" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ deliveryStatus: "READY" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ deliveryStatus: "ACTION_REQUIRED" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ deliveryStatus: "CANCELLED" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ deliveryStatus: "REJECTED" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ deliveryStatus: "EXPIRED" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ providerCommandStatus: "FAILED" })), true);
  assert.equal(incomingOrderNeedsAttention(order({ providerCommandStatus: "MANUAL_ACTION_REQUIRED" })), true);
});

test("a single order receives a new stable key at each actionable transition", () => {
  assert.deepEqual(incomingOrderAttentionKeys([order({ status: "PAID" })]), ["order-1:accept"]);
  assert.deepEqual(incomingOrderAttentionKeys([order({ deliveryStatus: "READY" })]), ["order-1:delivery:READY"]);
  assert.deepEqual(incomingOrderAttentionKeys([order({ providerCommandStatus: "FAILED" })]), ["order-1:command:FAILED"]);
  assert.deepEqual(incomingOrderAttentionKeys([order({ status: "PAID", providerStatus: "CANCELLED" })]), ["order-1:provider:CANCELLED"]);
  assert.deepEqual(incomingOrderAttentionKeys([order()]), []);
});

test("provider failure wins over stale local accept/preparing actions", () => {
  assert.equal(incomingOrderOperationalState(order({ status: "PAID" })), "ACCEPT");
  assert.equal(incomingOrderOperationalState(order({ deliveryStatus: "READY" })), "HANDOFF");
  assert.equal(incomingOrderOperationalState(order()), "PREPARING");
  assert.equal(incomingOrderOperationalState(order({ status: "PAID", deliveryStatus: "CANCELLED" })), "PROBLEM");
  assert.equal(incomingOrderOperationalState(order({ status: "PAID", providerStatus: "CANCELLED" })), "PROBLEM");
  assert.equal(incomingOrderProblemReason(order({ status: "PAID", providerStatus: "CANCELLED" })), "PROVIDER_TERMINAL");
  assert.equal(incomingOrderOperationalState(order({ status: "PAID", providerCommandStatus: "FAILED" })), "PROBLEM");
  assert.equal(incomingOrderOperationalState(order({
    status: "PAID",
    acceptanceDeadlineAt: "2026-01-01T00:00:00.000Z",
  }), Date.parse("2026-01-01T00:00:01.000Z")), "PROBLEM");
  assert.equal(incomingOrderOperationalState(order({
    status: "PAID",
    acceptanceDeadlineAt: "2026-01-01T00:00:02.000Z",
  }), Date.parse("2026-01-01T00:00:01.000Z")), "ACCEPT");
});

test("delivery intake summary includes central and provider-specific controls", () => {
  assert.deepEqual(summarizeDeliveryIntakeControls([]), {
    branchPaused: false,
    state: "ACCEPTING",
    controlledElsewhere: false,
    needsManualAction: false,
  });
  assert.deepEqual(summarizeDeliveryIntakeControls([
    { scope: "PROVIDER", desiredState: "PAUSED", syncStatus: "SYNCED" },
  ]), {
    branchPaused: false,
    state: "PARTIAL",
    controlledElsewhere: false,
    needsManualAction: false,
  });
  assert.deepEqual(summarizeDeliveryIntakeControls([
    { scope: "DELIVERY_PLATFORMS", desiredState: "PAUSED", syncStatus: "FAILED" },
  ]), {
    branchPaused: false,
    state: "PAUSED",
    controlledElsewhere: true,
    needsManualAction: true,
  });
});
