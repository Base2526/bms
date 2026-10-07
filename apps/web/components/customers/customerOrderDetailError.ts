import type { ApolloError } from "@apollo/client";
type ReadError = Pick<ApolloError, "graphQLErrors" | "networkError">;

// Use bounded error codes, never raw SQL, stack traces or server messages in the customer UI.
export function customerOrderDetailErrorKey(error: ReadError): string {
  const network = error.networkError;
  const body = network && "result" in network ? network.result : null;
  const bodyErrors = body && typeof body === "object" && Array.isArray(body.errors) ? body.errors : [];
  const codes = [...error.graphQLErrors, ...bodyErrors]
    .map((entry) => entry.extensions?.code);
  if (codes.includes("FORBIDDEN") || (network && "statusCode" in network && network.statusCode === 403)) return "admin_customers.detail_forbidden";
  if (codes.includes("GRAPHQL_VALIDATION_FAILED")) return "admin_customers.detail_version_error";
  if (error.networkError) return "admin_customers.detail_connection_error";
  return "admin_customers.detail_failed";
}
