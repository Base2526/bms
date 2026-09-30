import assert from "node:assert/strict";
import test from "node:test";

import { getMessage } from "../apps/web/i18n/index.ts";
import {
  flowEdges,
  flowNodes,
  flowScenarios,
  realFlowRoutes,
} from "../apps/web/components/marketing/flow/flowData.ts";

const ids = new Set(flowNodes.map((node) => node.id));
const forbiddenProviders = [
  "ShopeeFood", "Robinhood", "Lalamove", "Grab Express", "LINE MAN Messenger", "ไปรษณีย์ไทย", "foodpanda",
];

test("BMS flow node ids are unique", () => {
  assert.equal(ids.size, flowNodes.length);
});

test("BMS flow edges and scenarios reference existing nodes", () => {
  for (const edge of flowEdges) {
    assert.ok(ids.has(edge.from), `missing edge source ${edge.from}`);
    assert.ok(ids.has(edge.to), `missing edge target ${edge.to}`);
  }
  for (const scenario of flowScenarios) {
    for (const step of scenario.steps) assert.ok(ids.has(step.nodeId), `missing scenario node ${step.nodeId}`);
  }
});

test("compact flow never exposes a planned feature", () => {
  assert.equal(flowNodes.some((node) => node.compact && node.status === "planned"), false);
});

test("every BMS flow key resolves in Thai and English", () => {
  const keys = new Set<string>();
  for (const node of flowNodes) {
    keys.add(node.labelKey); keys.add(node.shortKey); keys.add(node.detail.whatKey);
    if (node.detail.exampleKey) keys.add(node.detail.exampleKey);
    if (node.detail.noteKey) keys.add(node.detail.noteKey);
  }
  for (const scenario of flowScenarios) {
    keys.add(scenario.labelKey);
    for (const step of scenario.steps) keys.add(step.captionKey);
  }
  for (const edge of flowEdges) if (edge.labelKey) keys.add(edge.labelKey);

  for (const key of keys) {
    assert.notEqual(getMessage("th", key), key, `missing Thai key ${key}`);
    assert.notEqual(getMessage("en", key), key, `missing English key ${key}`);
  }
});

test("BMS flow data contains no prohibited provider name", () => {
  const serialized = JSON.stringify({ flowNodes, flowEdges, flowScenarios });
  for (const provider of forbiddenProviders) assert.equal(serialized.includes(provider), false, provider);
});

test("node links point only at verified public routes", () => {
  const routes = new Set<string>(realFlowRoutes);
  for (const node of flowNodes) if (node.href) assert.ok(routes.has(node.href), node.href);
});

