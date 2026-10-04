export type SearchableGame = {
  id: string;
  title: string;
  copies: Array<{ id: string; copyCode: string; status: string }>;
};

export const normalizeGameSearch = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase();

export function matchesGameSearch(query: string, ...fields: string[]): boolean {
  const terms = normalizeGameSearch(query).split(/\s+/).filter(Boolean);
  const haystack = fields.map(normalizeGameSearch).join(" ");
  return terms.every((term) => haystack.includes(term));
}

export function searchGameLibrary<T extends SearchableGame>(titles: T[], query: string, availableOnly = false): T[] {
  return titles.filter((title) => {
    const copies = availableOnly ? title.copies.filter((copy) => copy.status === "AVAILABLE") : title.copies;
    if (availableOnly && !copies.length) return false;
    return matchesGameSearch(query, title.title) || copies.some((copy) => matchesGameSearch(query, title.title, copy.copyCode));
  });
}

export function gameCopyOptions(titles: SearchableGame[]) {
  return titles.flatMap((title) => title.copies.map((copy) => ({
    value: copy.id, label: `${title.title} · ${copy.copyCode}`, title: title.title,
    copyCode: copy.copyCode, status: copy.status, disabled: copy.status !== "AVAILABLE",
  }))).sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.title.localeCompare(b.title) || a.copyCode.localeCompare(b.copyCode));
}
