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


test("flow section header names the product once, inside the hub", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../apps/web/components/marketing/flow/BmsFlowDiagram.tsx", import.meta.url), "utf8");
  const start = source.indexOf("styles.flowHeader");
  assert.ok(start > 0, "flow header not found");
  const header = source.slice(start, source.indexOf("</div>", start));
  assert.ok(header.length > 0, "flow header slice is empty");
  // The eyebrow used to spell out "BUSINESS MANAGEMENT SYSTEM" right above a
  // heading that said "BMS" again, with the hub naming it a third time.
  assert.equal(/BUSINESS MANAGEMENT SYSTEM/.test(header), false, "eyebrow must not spell the product name");
  assert.equal(header.includes('t("bmsFlow.title")'), false, "heading must not repeat the product name");
  assert.ok(header.includes('t("bmsFlow.eyebrow")'), "eyebrow must come from i18n");
  assert.ok(header.includes('t("bmsFlow.subtitle")'), "heading must state the outcome");
  for (const key of ["bmsFlow.eyebrow", "bmsFlow.subtitle"]) {
    assert.notEqual(getMessage("th", key), key, `missing Thai key ${key}`);
    assert.notEqual(getMessage("en", key), key, `missing English key ${key}`);
    assert.equal(/BMS/.test(getMessage("th", key)), false, `${key} (th) repeats BMS`);
    assert.equal(/BMS/.test(getMessage("en", key)), false, `${key} (en) repeats BMS`);
  }
});

test("/how-it-works has one visible title, the diagram's own h1", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../apps/web/app/(main)/how-it-works/page.tsx", import.meta.url), "utf8")
    .replace(/\/\/.*$/gm, "");
  const diagram = readFileSync(new URL("../apps/web/components/marketing/flow/BmsFlowDiagram.tsx", import.meta.url), "utf8");
  // The page used to render its own h1 + description right above the
  // diagram's eyebrow + heading + intro: two stacked titles for one idea.
  assert.equal(/<h1[\s>]/.test(page), false, "page must not render a second title above the diagram");
  assert.ok(page.includes('variant="full"'), "page must render the full diagram");
  assert.ok(/const Heading = variant === "full" \? "h1" : "h2"/.test(diagram), "full diagram heading must be the page h1");
});

test("flow diagram draws no dashed strokes", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../apps/web/components/marketing/flow/BmsFlowDiagram.module.css", import.meta.url), "utf8");
  const tsx = readFileSync(new URL("../apps/web/components/marketing/flow/BmsFlowDiagram.tsx", import.meta.url), "utf8");
  assert.equal(/stroke-dasharray|strokeDasharray|\bdashed\b/.test(css + tsx), false, "dashed stroke found");
});

test("detail panel can stick: the flow section clips instead of becoming a scroll container", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../apps/web/components/marketing/flow/BmsFlowDiagram.module.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string) => {
    const start = css.search(new RegExp(`^\\${selector} \\{`, "m"));
    assert.ok(start >= 0, `${selector} rule not found`);
    return css.slice(start, css.indexOf("}", start));
  };
  // overflow: hidden on the section made it the panel's sticky scroll
  // container, so the panel scrolled off-screen with the diagram.
  const root = rule(".flowRoot");
  const overflows = [...root.matchAll(/overflow:\s*([a-z]+)/g)].map((m) => m[1]);
  assert.equal(overflows.at(-1), "clip", "the last overflow declaration on .flowRoot must be clip");
  const panel = rule(".detailPanel");
  assert.match(panel, /position:\s*sticky/);
  assert.match(panel, /top:\s*\d+px/);
});
