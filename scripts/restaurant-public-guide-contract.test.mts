import assert from "node:assert/strict";
import test from "node:test";
import { restaurantFlows } from "../apps/web/components/marketing/restaurant/flowContent.ts";
import { restaurantCopy } from "../apps/web/components/marketing/restaurant/content.ts";
import { parseSequence, layoutSequence, paginateSequence, wrapSequenceText } from "../apps/web/components/marketing/restaurant/sequence.ts";

const measure = (text: string) => [...text].length * 9;

test("print pagination preserves every step without splitting labels or arrows", () => {
  for (const flow of restaurantFlows) for (const lang of ["th", "en"] as const) {
    const layout = layoutSequence(parseSequence(flow[lang].source), measure, lang, restaurantCopy[lang].labels);
    const pages = paginateSequence(layout);
    assert.equal(pages[0].start, layout.headerBottom);
    assert.equal(pages.at(-1)!.end, layout.height);
    pages.forEach((page, i) => {
      assert.ok(page.end - page.start + layout.headerBottom <= layout.width * 145 / 277);
      if (i) assert.equal(pages[i - 1].end, page.start);
      for (const shape of layout.shapes) {
        if (shape.type === "text") for (let row = 0; row < shape.rows.length; row++) {
          const baseline = shape.y + row * 21;
          assert.ok(!(baseline - 16 < page.end && baseline + 5 > page.end), `Split label: ${lang} ${flow.id}`);
        }
        if (shape.type === "self") assert.ok(!(shape.y < page.end && shape.y + 22 > page.end));
      }
    });
  }
});
const topology = (source: string) => {
  const parsed = parseSequence(source);
  return { participants: parsed.participants.map(({ id, human }) => ({ id, human })),
    events: parsed.events.map(event => event.kind === "message"
      ? { kind: event.kind, from: event.from, to: event.to, reply: event.reply }
      : { kind: event.kind }) };
};

test("all 11 translated guides preserve actors, messages and exception branches", () => {
  assert.deepEqual(restaurantFlows.map(f => f.id), Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(new Set(restaurantFlows.map(f => f.group)).size, 4);
  for (const flow of restaurantFlows) {
    assert.deepEqual(topology(flow.th.source), topology(flow.en.source), `Flow ${flow.id}`);
    assert.ok(parseSequence(flow.th.source).events.filter(e => e.kind === "message").length > 3);
  }
});

test("all diagram shapes remain inside the canvas in both languages", () => {
  for (const flow of restaurantFlows) for (const lang of ["th", "en"] as const) {
    const layout = layoutSequence(parseSequence(flow[lang].source), measure, lang, restaurantCopy[lang].labels);
    for (const shape of layout.shapes) {
      const points = shape.type === "rect" ? [[shape.x, shape.y], [shape.x + shape.width, shape.y + shape.height]]
        : shape.type === "line" ? [[shape.x1, shape.y1], [shape.x2, shape.y2]]
        : shape.type === "self" ? [[shape.x, shape.y], [shape.x + 32, shape.y + 17]]
        : shape.rows.flatMap((row, i) => {
          const w = measure(row), left = shape.anchor === "start" ? shape.x : shape.x - (shape.anchor === "middle" ? w / 2 : w);
          return [[left, shape.y + i * 21], [left + w, shape.y + i * 21]];
        });
      for (const [x, y] of points) assert.ok(x >= 0 && x <= layout.width && y >= 0 && y <= layout.height,
        `${lang} flow ${flow.id}: ${JSON.stringify(shape)}`);
    }
  }
});

test("invalid authored syntax fails instead of silently dropping a business step", () => {
  const header = "sequenceDiagram\nactor A as Staff\nparticipant B as BMS\n";
  for (const body of ["A->>C: Unknown", "else Missing case", "end", "opt Unclosed\nA->>B: Send", "Note over C: Unknown", "A=>B: Wrong arrow", "participant A as Duplicate", "loop Retry\nelse Invalid\nend"])
    assert.throws(() => parseSequence(header + body));
  assert.doesNotThrow(() => parseSequence(header + "alt Ready\nopt Approved\nA->>B: Send\nend\nelse Missing\nB-->>A: Review\nend"));
});

test("long identifiers wrap without losing characters or Thai combining marks", () => {
  for (const text of ["LONG_UNBROKEN_IDENTIFIER_1234567890", "สั่งซื้อสินค้า"] ) {
    const rows = wrapSequenceText(text, 54, measure, "th");
    assert.equal(rows.join(""), text);
    assert.ok(rows.every(row => measure(row) <= 54));
    assert.ok(rows.every(row => !/^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(row)));
  }
});
