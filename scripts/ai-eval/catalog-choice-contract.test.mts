import assert from "node:assert/strict";
import test from "node:test";

import {
  composeCatalogChoiceReply,
  normalizeCatalogRequestedLine,
  parseCatalogChoiceSelection,
  type PendingCatalogChoices,
} from "../../apps/web/lib/bms/catalogChoices.ts";
import { parseRequestedItems, stripRequestNoise } from "../../apps/web/lib/bms/requestedItems.ts";

const PENDING: PendingCatalogChoices = {
  version: 1,
  lines: [
    {
      lineCode: "A",
      product: "พาราเซตามอล 500 มก.",
      size: "10 เม็ด",
      qty: 5,
      unit: "แผง",
      candidates: [
        { choiceCode: "A1", sku: "PARA-1", name: "พารา 1" },
        { choiceCode: "A2", sku: "PARA-2", name: "พารา 2" },
      ],
    },
    {
      lineCode: "B",
      product: "โดมเพอริโดน",
      size: "10 เม็ด",
      qty: 3,
      unit: "กล่อง",
      candidates: [
        { choiceCode: "B1", sku: "DOM-1", name: "โดม 1" },
        { choiceCode: "B2", sku: "DOM-2", name: "โดม 2" },
      ],
    },
  ],
};

test("choice reply namespaces repeated catalog options by basket line", () => {
  const reply = composeCatalogChoiceReply(PENDING, "th");
  for (const code of ["A1", "A2", "B1", "B2"]) assert.match(reply, new RegExp(code));
  assert.match(reply, /อย่างละ 1 ตัว/);
  assert.doesNotMatch(reply, /ต้องการตัวไหนคะ 1\/2\/3\/4/);
  assert.doesNotMatch(reply, /ราคา|คงเหลือ|baht|available/i);
});

test("naked numbers from the old UI are rejected because they are ambiguous across lines", () => {
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "1 2 3 4 ครับ ยืนยันเลย"), {
    kind: "invalid",
  });
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "1/2/3/4"), { kind: "invalid" });
});

test("a new named-product request is not mistaken for a numeric choice reply", () => {
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "เอาพาราเซตามอล 2 แผงแทน"), {
    kind: "not_selection",
  });
});

test("a complete replacement basket is distinguishable from a pending choice reply", () => {
  const replacement = "พาราเซตามอล 2 แผง, สำลี 1 ห่อ";
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, replacement), { kind: "not_selection" });
  assert.equal(parseRequestedItems(replacement).length, 2);
  assert.deepEqual(parseRequestedItems(replacement).map((item) => item.qty), [2, 1]);
});

test("cancellation is not consumed as an invalid product choice", () => {
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "ยกเลิกรายการนี้"), {
    kind: "not_selection",
  });
});

test("one namespaced code per line resolves exact server-owned SKUs", () => {
  const parsed = parseCatalogChoiceSelection(PENDING, "เอา A2 B1 ครับ ยืนยันเลย");
  assert.equal(parsed.kind, "complete");
  if (parsed.kind !== "complete") return;
  assert.deepEqual(parsed.selected.map((item) => item.sku), ["PARA-2", "DOM-1"]);
});

test("missing, duplicate-line, and unknown codes never partially resolve a basket", () => {
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "A1"), { kind: "invalid" });
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "A1 A2 B1"), { kind: "invalid" });
  assert.deepEqual(parseCatalogChoiceSelection(PENDING, "A1 B9"), { kind: "invalid" });
});

test("a line with one verified candidate is selected automatically", () => {
  const oneKnown: PendingCatalogChoices = {
    ...PENDING,
    lines: [{ ...PENDING.lines[0], candidates: [PENDING.lines[0].candidates[0]] }, PENDING.lines[1]],
  };
  const parsed = parseCatalogChoiceSelection(oneKnown, "B2");
  assert.equal(parsed.kind, "complete");
  if (parsed.kind !== "complete") return;
  assert.deepEqual(parsed.selected.map((item) => item.sku), ["PARA-1", "DOM-2"]);
});

test("pharmacy size is extracted per requested line and removed from the search keyword", () => {
  const normalized = normalizeCatalogRequestedLine(
    "พาราเซตามอล 500 มก. ไซซ์ 10 เม็ด 5 แผง",
    null,
    stripRequestNoise
  );
  assert.equal(normalized.size, "10 เม็ด");
  assert.match(normalized.product, /พาราเซตามอล 500 มก\./);
  assert.doesNotMatch(normalized.product, /ไซซ์|10 เม็ด/);
});

test("the production three-line basket retains every independent size", () => {
  const raw = "**พาราเซตามอล 500 มก. ไซซ์ 10 เม็ด 5 แผง, พาราเซตามอล 500 มก. ไซซ์ 100 เม็ด 2 กล่อง, ยาแก้ท้องอืด โดมเพอริโดน ไซซ์ 10 เม็ด 3 กล่อง**";
  const normalized = parseRequestedItems(raw).map((line) =>
    normalizeCatalogRequestedLine(line.rawText, null, stripRequestNoise)
  );
  assert.deepEqual(normalized.map((line) => line.size), ["10 เม็ด", "100 เม็ด", "10 เม็ด"]);
  assert.equal(normalized.length, 3);
  assert.ok(normalized.every((line) => !/ไซซ์/.test(line.product)));
});
