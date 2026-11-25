// Which AR statement /admin/receivables may show: only the loaded statement of the account the user
// opened. Before any account is opened (or while the query has no data) the answer is null — the
// old inline comparison treated `undefined === undefined` as a match and dereferenced missing data,
// crashing the page on first load. No imports: used by the client page and the pure contract.
export function visibleArStatement<T extends { accountId?: string | null }>(
  data: { bmsArStatement?: T | null } | null | undefined,
  statementFor: { id?: string | null } | null | undefined,
): T | null {
  const loaded = data?.bmsArStatement ?? null;
  if (!loaded || !statementFor?.id) return null;
  return loaded.accountId === statementFor.id ? loaded : null;
}
