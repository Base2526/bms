// Client and authorization rejections are useful diagnostics, but they are not
// server failures. Keep both GraphQL log paths on the same classification.
const EXPECTED_CODES: ReadonlySet<string> = new Set([
  "BAD_USER_INPUT",
  "BAD_REQUEST",
  "CONFLICT",
  "FEATURE_NOT_INCLUDED",
  "FORBIDDEN",
  "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED",
  "NOT_FOUND",
  "PERSISTED_QUERY_NOT_FOUND",
  "UNAUTHENTICATED",
]);

export function isExpectedGraphqlCode(code: unknown): boolean {
  return typeof code === "string" && EXPECTED_CODES.has(code);
}

export function isExpectedGraphqlError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return isExpectedGraphqlCode((error as { extensions?: { code?: unknown } }).extensions?.code);
}
