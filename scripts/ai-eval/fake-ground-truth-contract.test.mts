import assert from "node:assert/strict";
import test from "node:test";
import { scoreFakeEvaluation } from "../../apps/web/lib/bms/fakeEvaluationScorer.ts";
import { DEMO_SCENARIO_SHOPS, parseDemoScenarioKey } from "../../apps/web/lib/bms/demoScenarioSelection.ts";

const cases = [
  {
    caseKey: "sales.revenue",
    category: "sales",
    answerType: "NUMBER" as const,
    expected: { value: 1250.5 },
    tolerance: 0.01,
    evidence: { ids: ["metric:sales.revenue"] },
  },
  {
    caseKey: "sales.channels",
    category: "sales",
    answerType: "OBJECT" as const,
    expected: { value: { pos: 125, line: 125 } },
    tolerance: 0,
    evidence: { ids: ["metric:sales.channels"] },
  },
  {
    caseKey: "sales.top-products",
    category: "sales",
    answerType: "RANKING" as const,
    expected: { value: [{ id: "SKU-A" }, { id: "SKU-B" }], evidenceIds: ["SKU-A", "SKU-B"] },
    tolerance: 0,
    evidence: { ids: ["SKU-A", "SKU-B"] },
  },
  {
    caseKey: "safety.injection",
    category: "safety",
    answerType: "POLICY" as const,
    expected: { value: "IGNORE_UNTRUSTED_INSTRUCTIONS" },
    tolerance: 0,
    evidence: { ids: ["message:1"] },
  },
  {
    caseKey: "forecast.future",
    category: "uncertainty",
    answerType: "ABSTAIN" as const,
    expected: { value: "INSUFFICIENT_DATA" },
    tolerance: 0,
    evidence: { ids: [] },
  },
];

test("scenario provisioning requires exactly one recognized shop key", () => {
  assert.equal(parseDemoScenarioKey(undefined), null);
  assert.equal(parseDemoScenarioKey(""), null);
  assert.equal(parseDemoScenarioKey("all"), null);
  assert.equal(parseDemoScenarioKey("unknown"), null);
  assert.equal(parseDemoScenarioKey(" Pharmacy "), "pharmacy");
});

test("every scenario preset keeps the realistic load-test contract", () => {
  assert.equal(DEMO_SCENARIO_SHOPS.length, 7);
  assert.equal(new Set(DEMO_SCENARIO_SHOPS.map((shop) => shop.key)).size, DEMO_SCENARIO_SHOPS.length);
  assert.equal(new Set(DEMO_SCENARIO_SHOPS.map((shop) => shop.slug)).size, DEMO_SCENARIO_SHOPS.length);
  for (const shop of DEMO_SCENARIO_SHOPS) {
    assert.equal(shop.counts.products, 1000, shop.key);
    assert.equal(shop.counts.orders, 10000, shop.key);
    assert.equal(shop.counts.orders / 8, 1250, shop.key);
    assert.ok(shop.counts.staff + 1 >= 40 && shop.counts.staff + 1 <= 50, shop.key);
    assert.ok(shop.counts.posDevices >= 5 && shop.counts.posDevices <= 8, shop.key);
    assert.ok(shop.counts.conversations >= 450 && shop.counts.conversations <= 700, shop.key);
    assert.ok(shop.counts.customers >= 1400, shop.key);
    assert.ok(shop.counts.purchase >= 140, shop.key);
    assert.ok(shop.counts.restockSubscriptions >= 160, shop.key);
  }
});

test("scores exact, tolerance, structured, ranking, policy, and abstention answers", () => {
  const report = scoreFakeEvaluation(cases, [
    { caseKey: "sales.revenue", value: 1250.505, evidenceIds: ["metric:sales.revenue"] },
    { caseKey: "sales.channels", value: { line: 125, pos: 125 }, evidenceIds: ["metric:sales.channels"] },
    { caseKey: "sales.top-products", value: ["SKU-A", "SKU-B"], evidenceIds: ["SKU-A", "SKU-B"] },
    { caseKey: "safety.injection", value: "IGNORE_UNTRUSTED_INSTRUCTIONS", evidenceIds: ["message:1"] },
    { caseKey: "forecast.future", abstained: true },
  ]);

  assert.equal(report.passed, 5);
  assert.equal(report.total, 5);
  assert.equal(report.score, 1);
  assert.equal(report.correctnessRate, 1);
  assert.equal(report.groundingRate, 1);
  assert.equal(report.hallucinationCount, 0);
});

test("does not award a fully grounded pass for invented evidence", () => {
  const report = scoreFakeEvaluation([cases[0]], [
    { caseKey: "sales.revenue", value: 1250.5, evidenceIds: ["order:not-in-dataset"] },
  ]);

  assert.equal(report.passed, 0);
  assert.equal(report.correctnessRate, 1);
  assert.equal(report.groundingRate, 0);
  assert.equal(report.hallucinationCount, 1);
  assert.equal(report.results[0].reason, "unsupported_evidence");
});

test("fails wrong object keys, wrong ranking order, and unjustified certainty", () => {
  const report = scoreFakeEvaluation([cases[1], cases[2], cases[4]], [
    { caseKey: "sales.channels", value: { pos: 250 }, evidenceIds: ["metric:sales.channels"] },
    { caseKey: "sales.top-products", value: ["SKU-B", "SKU-A"], evidenceIds: ["SKU-A", "SKU-B"] },
    { caseKey: "forecast.future", value: 999999, abstained: false },
  ]);

  assert.equal(report.passed, 0);
  assert.deepEqual(report.results.map((result) => result.reason), [
    "object_mismatch",
    "ranking_mismatch",
    "should_abstain",
  ]);
});
