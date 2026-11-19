import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bank = readFileSync(new URL("../../docs/ai/customer-inbox-question-bank-th.md", import.meta.url), "utf8");
const audit = readFileSync(new URL("../../docs/ai/customer-inbox-coverage-audit-th.md", import.meta.url), "utf8");

function questionIds(): Map<string, number[]> {
  const ids = new Map<string, number[]>();
  let section = "";
  for (const line of bank.split(/\r?\n/)) {
    const heading = /^## (\d+)\./.exec(line);
    if (line === "## คำถามร่วมทุกประเภทร้าน") section = "C";
    else if (heading) section = heading[1].padStart(2, "0");
    else if (line === "## ชุดคำถามต่อเนื่องและกรณีต้านการเดา") section = "X";
    const question = /^(\d+)\. /.exec(line);
    if (question && section) ids.set(section, [...(ids.get(section) ?? []), Number(question[1])]);
  }
  return ids;
}

function expanded(rangeList: string): number[] {
  return rangeList.split(",").flatMap((entry) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(entry);
    assert.ok(match, `bad audit range ${entry}`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    assert.ok(first > 0 && last >= first, `bad audit bounds ${entry}`);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });
}

test("every customer Inbox question has exactly one audited disposition", () => {
  const expected = questionIds();
  const actual = new Map<string, number[]>();
  for (const line of audit.split(/\r?\n/)) {
    const row = /^\| (C|\d{2}):([\d,\-]+) \| ([R P W H N D E]) \|/.exec(line);
    if (!row) continue;
    actual.set(row[1], [...(actual.get(row[1]) ?? []), ...expanded(row[2])]);
  }
  assert.equal([...expected.values()].reduce((sum, ids) => sum + ids.length, 0) - (expected.get("X")?.length ?? 0), 440);
  for (const [section, ids] of expected) {
    if (section === "X") continue;
    const covered = actual.get(section) ?? [];
    assert.deepEqual(covered.toSorted((a, b) => a - b), ids.toSorted((a, b) => a - b), section);
  }
  assert.deepEqual([...actual.keys()].toSorted(), [...expected.keys()].filter((key) => key !== "X").toSorted());
});

test("all fifty multi-turn scenarios are present and mapped once", () => {
  const expected = questionIds().get("X") ?? [];
  assert.deepEqual(expected, Array.from({ length: 50 }, (_, index) => index + 1));
  const mapped = audit.split(/\r?\n/).flatMap((line) => {
    const match = /^\| (\d+(?:-\d+)?) \|/.exec(line);
    return match && audit.indexOf(line) > audit.indexOf("## บทสนทนาต่อเนื่อง 50 กรณี")
      ? expanded(match[1]) : [];
  });
  assert.deepEqual(mapped.toSorted((a, b) => a - b), expected);
});
