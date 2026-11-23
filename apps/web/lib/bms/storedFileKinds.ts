// =============================================================
// Recognize sensitive file kinds by the name the storage layer actually stores.
// -------------------------------------------------------------
// persistWebFile()/persistBuffer() store `files.filename` as `${Date.now()}-${safeName}`
// (lib/storage.ts buildKey). A check written as startsWith("bms-inbox-") or
// LIKE 'bms-inbox-%' never matches a real upload, which silently disabled the Inbox download
// gate and the signed provider media route until the 2026-11-23 recheck. Keep every
// stored-name rule here so SQL and TypeScript agree. No imports: route tests load this as is.
// =============================================================

/** POSIX regex shared with SQL (`filename ~ '<pattern>'`). */
export const INBOX_STORED_FILENAME_PATTERN =
  "^([0-9]+-)?(bms-inbox-|line-(image|video|audio)-[0-9]+[.])";

/**
 * Inbox attachments: staff uploads (`bms-inbox-<uuid>`, also used for new LINE inbound media) and
 * LINE inbound media stored before that rename (`line-<type>-<messageId>.<ext>`).
 */
export function isInboxStoredFilename(name: string | null | undefined): boolean {
  return typeof name === "string" && new RegExp(INBOX_STORED_FILENAME_PATTERN).test(name);
}

/** Customer payment slips from signed checkout links and board-game reservation deposits. */
export function isPaymentSlipStoredFilename(name: string | null | undefined): boolean {
  return typeof name === "string" && /^([0-9]+-)?(checkout|board-game-reservation)-/.test(name);
}
