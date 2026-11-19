export const REQUIRED_PICKUP_EMAIL_TEMPLATES = ["paid", "packing", "shipped", "completed"]
  .flatMap((status) => ["th", "en"].map((locale) => ({ key: `order.pickup.${status}`, locale })));

type TemplateRow = { key: string; locale: string; version: number; subject_tpl: string; html_tpl: string };

export function missingPickupEmailTemplates(rows: ReadonlyArray<TemplateRow>): string[] {
  const latest = new Map<string, TemplateRow>();
  for (const row of rows) {
    const pair = `${row.key}:${row.locale}`;
    if (row.version > (latest.get(pair)?.version ?? -1)) latest.set(pair, row);
  }
  return REQUIRED_PICKUP_EMAIL_TEMPLATES
    .map(({ key, locale }) => `${key}:${locale}`)
    .filter((pair) => {
      const row = latest.get(pair);
      return !row || !row.subject_tpl.trim() || !row.html_tpl.trim();
    });
}
