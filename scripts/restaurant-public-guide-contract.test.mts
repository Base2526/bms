import assert from "node:assert/strict";
import test from "node:test";
import { restaurantFlows } from "../apps/web/components/marketing/restaurant/flowContent.ts";
import { restaurantCopy } from "../apps/web/components/marketing/restaurant/content.ts";
import { parseSequence, layoutSequence, paginateSequence, wrapSequenceText } from "../apps/web/components/marketing/restaurant/sequence.ts";
import { compilePlayback, playbackTree } from "../apps/web/components/marketing/restaurant/playback.ts";
import { PRIMARY_GUIDE_SHOPS, ADDITIONAL_GUIDE_SHOPS, guideFlows, flowFit, guideFlowCopy, type GuideProfile } from "../apps/web/components/marketing/restaurant/guideProfiles.ts";

const measure = (text: string) => [...text].length * 9;

test("main formats and additional board game format have explicit, relevant flow sets", () => {
  assert.deepEqual(PRIMARY_GUIDE_SHOPS, ["overview", "restaurant", "food_beverage"]);
  assert.deepEqual(ADDITIONAL_GUIDE_SHOPS, ["board_game_cafe"]);
  const cases: Array<[GuideProfile, number[]]> = [
    [{ shop: "overview", service: "dine_in", multiBranch: false }, [1,2,3,4,5,6,7,8,9,10,11,12]],
    [{ shop: "restaurant", service: "dine_in", multiBranch: false }, [1,3,4,5,6,7,8,9,10,11]],
    [{ shop: "restaurant", service: "counter", multiBranch: false }, [1,3,4,5,7,8,9,10,11]],
    [{ shop: "restaurant", service: "online", multiBranch: false }, [1,4,5,7,8,9,10,11]],
    [{ shop: "food_beverage", service: "counter", multiBranch: false }, [1,3,4,8,9,10,11]],
    [{ shop: "board_game_cafe", service: "counter", multiBranch: false }, [3,8,10,11]],
  ];
  for (const [profile, expected] of cases) {
    assert.deepEqual(guideFlows(profile), expected, JSON.stringify(profile));
    assert.equal(guideFlows(profile, true).length, 12);
  }
  for (const shop of ["restaurant", "food_beverage"] as const) {
    const profile: GuideProfile = { shop, service: "counter", multiBranch: true };
    assert.ok(guideFlows(profile).includes(2)); assert.equal(flowFit(2, profile), "recommended");
    // The central kitchen flow needs several branches; ticking "central kitchen" promotes it.
    assert.equal(flowFit(12, { ...profile, multiBranch: false }), "restaurant_example");
    assert.equal(flowFit(12, profile), "related");
    assert.equal(flowFit(12, { ...profile, centralKitchen: true }), "recommended");
  }
  assert.equal(flowFit(12, { shop: "board_game_cafe", service: "counter", multiBranch: true, centralKitchen: true }), "restaurant_example");
});

test("the AI assistant is its own read-only participant and never writes business records", () => {
  assert.equal(parseSequence("sequenceDiagram\nassistant AI as Assistant\nparticipant B as BMS\nAI->>B: Read").participants[0].assistant, true);
  for (const flow of restaurantFlows) for (const lang of ["th", "en"] as const) {
    const sequence = parseSequence(flow[lang].source);
    const assistants = sequence.participants.filter(p => p.assistant).map(p => p.id);
    if (flow.id !== 12) { assert.deepEqual(assistants, [], `Flow ${flow.id} has no AI step`); continue; }
    assert.deepEqual(assistants, ["AI"]);
    for (const event of sequence.events) if (event.kind === "message" && event.from === "AI")
      assert.ok(event.to === "Stock" || (event.reply && event.to === "Manager"), `${lang}: AI may only read stock and answer: ${event.label}`);
    const layout = layoutSequence(sequence, measure, lang, restaurantCopy[lang].labels);
    assert.ok(layout.shapes.some(shape => shape.type === "rect" && shape.tone === "assistant"));
    assert.ok(layout.shapes.some(shape => shape.type === "line" && shape.tone === "assistant"));
    // One row only: a wrapped header label would overlap the participant name.
    assert.ok(layout.shapes.some(shape => shape.type === "text" && shape.rows.length === 1 && shape.rows[0] === restaurantCopy[lang].labels.assistant));
    // The page must not claim lot-produced goods can be transferred until transfers move lots.
    assert.match(flow[lang].note, lang === "th" ? /ยังไม่รองรับสินค้าที่ติดล็อต/ : /do not yet support lot/);
  }
});

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
  return { participants: parsed.participants.map(({ id, human, assistant }) => ({ id, human, assistant })),
    events: parsed.events.map(event => event.kind === "message"
      ? { kind: event.kind, from: event.from, to: event.to, reply: event.reply }
      : { kind: event.kind }) };
};

test("all 12 translated guides preserve actors, messages and exception branches", () => {
  // IDs are public deep links (#flow-N); new flows append instead of renumbering.
  assert.deepEqual(restaurantFlows.map(f => f.id), Array.from({ length: 12 }, (_, i) => i + 1));
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

test("shop-specific core examples remain valid and bilingual", () => {
  const profiles: GuideProfile[] = [
    { shop: "restaurant", service: "counter", multiBranch: false },
    { shop: "food_beverage", service: "counter", multiBranch: false },
    { shop: "board_game_cafe", service: "dine_in", multiBranch: false },
  ];
  for (const profile of profiles) {
    const flow = restaurantFlows[2];
    const th = guideFlowCopy(flow, profile, "th"), en = guideFlowCopy(flow, profile, "en");
    assert.deepEqual(topology(th.source), topology(en.source), profile.shop);
    assert.ok(compilePlayback(parseSequence(th.source)).cues.length > 5);
  }
  assert.equal(flowFit(6, { shop: "restaurant", service: "counter", multiBranch: false }), "restaurant_example");
  assert.equal(flowFit(7, { shop: "food_beverage", service: "counter", multiBranch: false }), "restaurant_example");
  assert.equal(flowFit(3, { shop: "board_game_cafe", service: "dine_in", multiBranch: false }), "recommended");
});

test("playback chooses one exclusive branch and respects optional sections", () => {
  const sequence = parseSequence("sequenceDiagram\nactor A as Staff\nparticipant B as BMS\nalt Approved\nA->>B: Execute\nelse Rejected\nB-->>A: Explain\nend\nopt Notify\nB-->>A: Notify\nend");
  const first = compilePlayback(sequence);
  const branch = first.choices.find(choice => choice.kind === "alt")!;
  const optional = first.choices.find(choice => choice.kind === "opt")!;
  assert.ok(first.cues.some(cue => cue.label === "Execute"));
  assert.ok(!first.cues.some(cue => cue.label === "Explain"));
  assert.ok(!first.cues.some(cue => cue.label === "Notify"));
  assert.ok(compilePlayback(sequence, { [optional.id]: 1 }).cues.some(cue => cue.label === "Notify"));
  const other = compilePlayback(sequence, { [branch.id]: 1, [optional.id]: 0 });
  assert.ok(other.cues.some(cue => cue.label === "Explain"));
  assert.ok(!other.cues.some(cue => cue.label === "Execute" || cue.label === "Notify"));
  for (const flow of restaurantFlows) for (const lang of ["th", "en"] as const) {
    const parsed = parseSequence(flow[lang].source), plan = compilePlayback(parsed);
    assert.ok(plan.cues.length > 4, `${lang} flow ${flow.id}`);
    assert.ok(plan.cues.every(cue => cue.index >= 0 && cue.index < parsed.events.length));
  }
});

function scenarios(id: number) {
  const sequence = parseSequence(restaurantFlows.find(flow => flow.id === id)!.en.source);
  let selections: Record<number, number>[] = [{}];
  const walk = (nodes: ReturnType<typeof playbackTree>) => {
    for (const node of nodes) if ("options" in node) {
      if (node.kind !== "loop") selections = selections.flatMap(selection =>
        Array.from({ length: node.kind === "opt" ? 2 : node.options.length }, (_, index) => ({ ...selection, [node.index]: index })));
      node.options.forEach(option => walk(option.children));
    }
  };
  walk(playbackTree(sequence));
  return selections.map(selection => compilePlayback(sequence, selection).cues.map(cue => cue.label));
}

test("failed reservations never proceed to kitchen work or settlement", () => {
  for (const labels of scenarios(3)) if (labels.includes("Unavailable or insufficient stock")) {
    assert.ok(!labels.includes("Create work by station"));
    assert.ok(!labels.includes("Confirm payment with the request reference"));
    assert.ok(!labels.includes("Receipt"));
  }
});

test("online rejection, preparation failure and handover failure cannot narrate completed delivery", () => {
  for (const labels of scenarios(7)) {
    if (labels.includes("Cannot accept or information missing")) assert.ok(!labels.includes("Review and confirm payment"));
    if (labels.includes("Some items cannot be prepared")) assert.ok(!labels.includes("Create kitchen work"));
    if (["Cannot accept or information missing", "Some items cannot be prepared", "Handover fails"].some(label => labels.includes(label))) {
      assert.ok(!labels.includes("Deduct stock and record handover"));
      assert.ok(!labels.includes("Deduct stock and record dispatch"));
      assert.ok(!labels.includes("Deliver food"));
    }
  }
});

test("completed purchase receipts cannot also cancel outstanding quantities", () => {
  for (const labels of scenarios(8)) if (labels.includes("RECEIVED")) assert.ok(!labels.includes("CANCELLED; retain previous receipts"));
});

test("cancel before sale never charges or redeems; manual discounts precede customer confirmation", () => {
  for (const labels of scenarios(9)) {
    if (labels.includes("Cancel before sale completion")) {
      assert.ok(!labels.includes("Confirm payment"));
      assert.ok(!labels.includes("Record benefit redemption and accrual"));
      assert.ok(!labels.includes("Reverse benefits from original evidence"));
    }
    if (labels.includes("Manual discount")) assert.ok(labels.indexOf("Manual discount") < labels.indexOf("Confirm total before payment"));
  }
});

test("invalid branch input falls back safely and loops disclose a single example iteration", () => {
  const sequence = parseSequence("sequenceDiagram\nactor A as Staff\nparticipant B as BMS\nalt First\nA->>B: First\nelse Second\nA->>B: Second\nA->>B: Extra\nend\nloop Each delivery\nA->>B: Receive\nend");
  const first = compilePlayback(sequence), branch = first.choices[0];
  for (const value of [NaN, Infinity, -1, 0.5, 99]) assert.deepEqual(compilePlayback(sequence, { [branch.id]: value }), first);
  assert.ok(!first.cues.some(cue => cue.label === "Second"));
  assert.equal(first.cues.filter(cue => cue.kind === "loop").length, 1);
});
