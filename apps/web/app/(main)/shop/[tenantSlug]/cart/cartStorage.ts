export type StoredCartLine = { sku: string; size: string; qty: number; name: string };

const key = (slug: string) => `bms:retail-cart:${slug}`;

export function readCart(slug: string): StoredCartLine[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(slug)) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((line) => line && typeof line.sku === "string" && typeof line.size === "string" &&
      typeof line.name === "string" && Number.isSafeInteger(line.qty) && line.qty > 0).slice(0, 10);
  } catch { return []; }
}

export function writeCart(slug: string, lines: StoredCartLine[]) {
  localStorage.setItem(key(slug), JSON.stringify(lines.slice(0, 10)));
}

export function addCartLine(slug: string, line: StoredCartLine): boolean {
  const lines = readCart(slug);
  const current = lines.find((item) => item.sku === line.sku && item.size === line.size);
  if (current) current.qty = Math.min(100, current.qty + line.qty);
  else if (lines.length < 10) lines.push(line);
  else return false;
  writeCart(slug, lines);
  return true;
}
