import type { Sequence } from "./sequence";

type Leaf = { kind: "message"; index: number; label: string; from: string; to: string }
  | { kind: "note"; index: number; label: string };
type Group = { kind: "alt" | "opt" | "loop"; index: number; label: string; options: Array<{ label: string; index: number; children: Node[] }> };
type Node = Leaf | Group;
export type PlaybackChoice = { id: number; kind: "alt" | "opt"; label: string; options: string[]; selected: number };
export type PlaybackCue = { index: number; kind: "message" | "note" | "condition" | "loop"; label: string; from?: string; to?: string };

/** Compile authored sequence syntax into exclusive branches before producing playback cues. */
export function playbackTree(sequence: Sequence): Node[] {
  const events = sequence.events;
  let cursor = 0;
  const read = (): Node[] => {
    const nodes: Node[] = [];
    while (cursor < events.length) {
      const event = events[cursor];
      if (event.kind === "end" || event.kind === "else") break;
      const index = cursor++;
      if (event.kind === "message") {
        nodes.push({ kind: "message", index, label: event.label, from: event.from, to: event.to });
      } else if (event.kind === "note") {
        nodes.push({ kind: "note", index, label: event.label });
      } else {
        const options = [{ label: event.label, index, children: read() }];
        if (event.kind === "alt") while (events[cursor]?.kind === "else") {
          const alternative = events[cursor] as { kind: "else"; label: string };
          const optionIndex = cursor++;
          options.push({ label: alternative.label, index: optionIndex, children: read() });
        }
        if (events[cursor]?.kind !== "end") throw new Error("Incomplete playback branch");
        cursor++;
        nodes.push({ kind: event.kind, index, label: event.label, options });
      }
    }
    return nodes;
  };
  const tree = read();
  if (cursor !== events.length) throw new Error("Unexpected playback branch");
  return tree;
}

export function compilePlayback(sequence: Sequence, selections: Record<number, number> = {}) {
  const cues: PlaybackCue[] = [], choices: PlaybackChoice[] = [];
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === "message") {
        cues.push({ index: node.index, kind: "message", label: node.label, from: node.from, to: node.to });
      } else if (node.kind === "note") {
        cues.push({ index: node.index, kind: "note", label: node.label });
      } else if (node.kind === "alt") {
        const requested = selections[node.index];
        const selected = Number.isInteger(requested) && requested >= 0 && requested < node.options.length ? requested : 0;
        choices.push({ id: node.index, kind: "alt", label: node.label, options: node.options.map(option => option.label), selected });
        const option = node.options[selected];
        cues.push({ index: option.index, kind: "condition", label: option.label });
        visit(option.children);
      } else if (node.kind === "opt") {
        const selected = selections[node.index] === 1 ? 1 : 0;
        choices.push({ id: node.index, kind: "opt", label: node.label, options: [], selected });
        if (selected) {
          cues.push({ index: node.index, kind: "condition", label: node.label });
          visit(node.options[0].children);
        }
      } else if ("options" in node) {
        cues.push({ index: node.index, kind: "loop", label: node.label });
        visit(node.options[0].children);
      }
    }
  };
  visit(playbackTree(sequence));
  return { cues, choices };
}
