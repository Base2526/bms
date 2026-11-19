export type AssistantAnswerBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; start?: number; items: string[] }
  | { kind: "code"; text: string };

/** Presentation only: keep the original reply for history, copying, and tool evidence. */
export function parseAssistantAnswer(text: string): AssistantAnswerBlock[] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: AssistantAnswerBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let listStart = 1;
  let nextNumber = 1;
  let codeLines: string[] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) blocks.push({ kind: "list", ordered: listOrdered,
      ...(listOrdered ? { start: listStart } : {}), items: listItems });
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (codeLines) {
      if (/^\s*```\s*$/.test(line)) {
        blocks.push({ kind: "code", text: codeLines.join("\n") });
        codeLines = null;
      } else {
        codeLines.push(raw);
      }
      continue;
    }
    if (/^\s*```[^`]*$/.test(line)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^\s*(?:#{1,3}\s+(.+)|\*\*([^*]+)\*\*)\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: heading[1] ?? heading[2] });
      continue;
    }
    const item = line.match(/^\s*(?:(\d+)[.)]|([-*•]))\s+(.+)$/);
    if (item) {
      const number = item[1] ? Number(item[1]) : null;
      if (number !== null && !Number.isSafeInteger(number)) {
        flushList();
        paragraph.push(line);
        continue;
      }
      flushParagraph();
      const ordered = Boolean(item[1]);
      if (listItems.length && (listOrdered !== ordered || (ordered && number !== nextNumber))) flushList();
      if (!listItems.length && number !== null) listStart = number;
      listOrdered = ordered;
      listItems.push(item[3]);
      if (number !== null) nextNumber = number + 1;
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (codeLines) blocks.push({ kind: "code", text: codeLines.join("\n") });
  return blocks;
}
