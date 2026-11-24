// =============================================================
// What an anonymous caller may read from a caught error.
// -------------------------------------------------------------
// Public routes (signed checkout, board-game bookings, nearby search) catch every error and used
// to return `error.message`. Their services do throw messages written for customers ("this
// booking has expired"), but the same catch also received PostgreSQL errors (constraint, column and
// type names) and JavaScript runtime errors, which then reached strangers verbatim and bypassed
// withRouteErrorLog's production redaction. Keep the service's own messages; replace everything
// that came from the database, the network stack or a programming error with the route's fallback.
// =============================================================

const RUNTIME_ERROR_NAMES = new Set([
  "TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError", "AggregateError",
]);

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const detail = error as Error & { severity?: unknown; routine?: unknown; code?: unknown; syscall?: unknown; errno?: unknown };
  // pg DatabaseError carries severity/routine and a five-character SQLSTATE.
  if (typeof detail.severity === "string" || typeof detail.routine === "string") return fallback;
  if (typeof detail.code === "string" && /^[0-9A-Z]{5}$/.test(detail.code)) return fallback;
  // Node system errors (ECONNREFUSED, ETIMEDOUT, ENOENT ...) carry syscall/errno; a domain code
  // such as "EXPIRED" does not, so it is not mistaken for one.
  if (typeof detail.syscall === "string" || typeof detail.errno === "number") return fallback;
  if (RUNTIME_ERROR_NAMES.has(error.name)) return fallback;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  return message || fallback;
}
