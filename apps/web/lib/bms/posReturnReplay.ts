type ReturnLine = { orderItemId: number; packQty: number };

/** The same return key may replay only the same partial-return selection. */
export function matchesPosReturnReplayLines(
  mode: "FULL" | "PARTIAL",
  requested: ReturnLine[],
  committed: ReturnLine[],
): boolean {
  if (mode === "FULL") return true;
  const quantities = (lines: ReturnLine[]) => {
    const result = new Map<number, number>();
    for (const line of lines) {
      result.set(line.orderItemId, (result.get(line.orderItemId) ?? 0) + line.packQty);
    }
    return result;
  };
  const wanted = quantities(requested);
  const actual = quantities(committed);
  return wanted.size === actual.size
    && [...wanted].every(([id, qty]) => actual.get(id) === qty);
}
