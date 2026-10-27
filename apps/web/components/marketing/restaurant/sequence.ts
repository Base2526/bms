/** A deliberately small, validated sequence notation for authored marketing content. */
export type Participant = { id: string; label: string; human: boolean };
export type SequenceEvent =
  | { kind: "message"; from: string; to: string; label: string; reply: boolean }
  | { kind: "alt" | "opt" | "loop" | "else" | "note"; label: string }
  | { kind: "end" };
export type Sequence = { participants: Participant[]; events: SequenceEvent[] };

export function parseSequence(source: string): Sequence {
  const participants: Participant[] = [], events: SequenceEvent[] = [];
  const groups: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line === "sequenceDiagram" || line === "autonumber") continue;
    const actor = line.match(/^(actor|participant) (\w+) as (.+)$/);
    if (actor) {
      if (participants.some(p => p.id === actor[2])) throw new Error("Duplicate participant");
      participants.push({ id: actor[2], label: actor[3], human: actor[1] === "actor" });
      continue;
    }
    const message = line.match(/^(\w+)(--?>>)(\w+):\s*(.+)$/);
    if (message) {
      if (![message[1], message[3]].every(id => participants.some(p => p.id === id)))
        throw new Error("Unknown sequence participant");
      events.push({ kind: "message", from: message[1], to: message[3], label: message[4], reply: message[2] === "-->>" });
      continue;
    }
    const branch = line.match(/^(alt|opt|loop|else) (.+)$/);
    if (branch) {
      const kind = branch[1] as "alt" | "opt" | "loop" | "else";
      if (kind === "else") {
        if (groups.at(-1) !== "alt") throw new Error("Else outside alternative");
      } else groups.push(kind);
      events.push({ kind, label: branch[2] });
      continue;
    }
    if (line === "end") {
      if (!groups.pop()) throw new Error("Unexpected sequence end");
      events.push({ kind: "end" });
      continue;
    }
    const note = line.match(/^Note over ([\w,]+):\s*(.+)$/);
    if (note) {
      if (!note[1].split(",").every(id => participants.some(p => p.id === id))) throw new Error("Unknown note participant");
      events.push({ kind: "note", label: note[2] });
      continue;
    }
    throw new Error(`Unsupported sequence line: ${line}`);
  }
  if (groups.length || participants.length < 2) throw new Error("Incomplete sequence");
  return { participants, events };
}

export type Measure = (text: string) => number;
export function wrapSequenceText(text: string, max: number, measure: Measure, lang: string): string[] {
  const rows: string[] = [];
  let row = "";
  const append = (part: string) => {
    if (row && measure(row + part) > max) { rows.push(row.trim()); row = part.trimStart(); }
    else row += part;
  };
  for (const { segment } of new Intl.Segmenter(lang, { granularity: "word" }).segment(text)) {
    // Long identifiers must fit too; grapheme splitting keeps Thai combining marks intact.
    if (measure(segment) > max) {
      for (const { segment: character } of new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(segment)) append(character);
    } else append(segment);
  }
  if (row.trim()) rows.push(row.trim());
  return rows;
}

export type Shape = (
  | { type: "rect"; x: number; y: number; width: number; height: number; tone: "person" | "system" | "frame" | "paper"; radius: number }
  | { type: "text"; x: number; y: number; rows: string[]; anchor: "start" | "middle" | "end"; small?: boolean; muted?: boolean }
  | { type: "line"; x1: number; x2: number; y1: number; y2: number; tone: "lifeline" | "divider" | "message"; reply?: boolean }
  | { type: "self"; x: number; y: number }) & { eventIndex?: number };
export type DiagramLabels = { person: string; system: string; alt: string; opt: string; loop: string; else: string };

export function layoutSequence(sequence: Sequence, measure: Measure, lang: string, labels: DiagramLabels) {
  const width = Math.max(850, sequence.participants.length * 170 + 100);
  const xs = sequence.participants.map((_, i) => 95 + i * (width - 190) / (sequence.participants.length - 1));
  const content: Shape[] = [], frames: Shape[] = [], headers: Shape[] = [];
  const stack: Array<{ x: number; start: number }> = [];
  const text = (value: string, x: number, y: number, max: number, anchor: "start" | "middle" | "end" = "middle", small = false, muted = false): Extract<Shape, { type: "text" }> =>
    ({ type: "text", x, y, rows: wrapSequenceText(value, max, measure, lang), anchor, small, muted });
  const headerRows = sequence.participants.map(p => wrapSequenceText(p.label, 127, measure, lang));
  const headerHeight = 44 + Math.max(...headerRows.map(r => r.length)) * 21;
  const breaks: Array<{ y: number; context: string[] }> = [];
  const context: string[] = [];
  let y = headerHeight + 45, number = 0;
  for (const [eventIndex, event] of sequence.events.entries()) {
    const shapeStart = content.length;
    if (event.kind === "message") {
      const a = sequence.participants.findIndex(p => p.id === event.from), b = sequence.participants.findIndex(p => p.id === event.to);
      const self = a === b, left = self && xs[a] > width - 320;
      const max = self ? 270 : Math.abs(xs[b] - xs[a]) - 25;
      const x = self ? xs[a] + (left ? -25 : 25) : (xs[a] + xs[b]) / 2;
      const words = text(event.label, x, y + 9, max, self ? (left ? "end" : "start") : "middle");
      const lineY = y + words.rows.length * 21 + 4;
      content.push(text(String(++number).padStart(2, "0"), 15, lineY + 4, 25, "start", true, true));
      content.push({ type: "rect", x: self ? (left ? x - max - 5 : x - 7) : x - max / 2 - 5, y: y - 7, width: max + 10, height: words.rows.length * 21 + 2, radius: 5, tone: "paper" }, words);
      content.push(self ? { type: "self", x: xs[a], y: lineY } : { type: "line", x1: xs[a], x2: xs[b], y1: lineY, y2: lineY, tone: "message", reply: event.reply });
      y = lineY + (self ? 48 : 34);
    } else if (event.kind === "alt" || event.kind === "opt" || event.kind === "loop") {
      context.push(`${labels[event.kind]}: ${event.label}`);
      const x = 36 + stack.length * 10;
      stack.push({ x, start: y - 7 });
      const title = text(event.label, x + 20, y + 33, width - x * 2 - 50, "start");
      content.push({ type: "rect", x: x + 10, y: y - 2, width: width - x * 2 - 20, height: title.rows.length * 21 + 33, radius: 7, tone: "system" }, text(labels[event.kind], x + 20, y + 11, 200, "start", true, true), title);
      y += title.rows.length * 21 + 62;
    } else if (event.kind === "else") {
      context[context.length - 1] = `${labels.else}: ${event.label}`;
      const x = 46 + Math.max(0, stack.length - 1) * 10;
      const title = text(event.label, x + 10, y + 30, width - x * 2 - 35, "start");
      content.push({ type: "line", x1: x, x2: width - x, y1: y - 5, y2: y - 5, tone: "divider" }, text(labels.else, x + 10, y + 9, 200, "start", true, true), title);
      y += title.rows.length * 21 + 59;
    } else if (event.kind === "end") {
      context.pop();
      const frame = stack.pop()!;
      frames.push({ type: "rect", x: frame.x, y: frame.start, width: width - 2 * frame.x, height: y - 8 - frame.start, radius: 10, tone: "frame" });
      y += 18;
    } else {
      const note = text(event.label, 65, y + 23, width - 130, "start");
      content.push({ type: "rect", x: 48, y, width: width - 96, height: note.rows.length * 21 + 22, radius: 9, tone: "person" }, note);
      y += note.rows.length * 21 + 43;
    }
    for (let i = shapeStart; i < content.length; i++) content[i].eventIndex = eventIndex;
    // Break only after a complete step, never between a condition and its first step.
    if (event.kind === "message" || event.kind === "note" || event.kind === "end")
      breaks.push({ y: y - 12, context: [...context] });
  }
  sequence.participants.forEach((p, i) => headers.push(
    { type: "line", x1: xs[i], x2: xs[i], y1: headerHeight + 8, y2: y - 14, tone: "lifeline" },
    { type: "rect", x: xs[i] - 73, y: 8, width: 146, height: headerHeight, radius: 12, tone: p.human ? "person" : "system" },
    text(p.human ? labels.person : labels.system, xs[i], 30, 127, "middle", true, true),
    { type: "text", x: xs[i], y: 53, rows: headerRows[i], anchor: "middle" },
  ));
  return { width, height: y + 10, headerBottom: headerHeight + 20, breaks, shapes: [...headers, ...frames, ...content] };
}

export type SequenceLayout = ReturnType<typeof layoutSequence>;

/** A4 landscape: 277 mm content width and 145 mm for repeated actors + diagram. */
export function paginateSequence(layout: SequenceLayout) {
  const capacity = layout.width * 145 / 277 - layout.headerBottom;
  const pages: Array<{ start: number; end: number; context: string[] }> = [];
  let start = layout.headerBottom, context: string[] = [];
  while (start < layout.height) {
    const limit = start + capacity;
    const cut = layout.height <= limit ? { y: layout.height, context: [] }
      : layout.breaks.filter(b => b.y > start && b.y <= limit).at(-1);
    if (!cut) throw new Error("A sequence step exceeds the printable page height");
    pages.push({ start, end: cut.y, context });
    start = cut.y; context = cut.context;
  }
  return pages;
}
