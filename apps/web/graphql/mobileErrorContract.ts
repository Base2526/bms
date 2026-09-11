import { GraphQLError, type GraphQLFormattedError } from "graphql/error";

export const BMS_GRAPHQL_CLIENT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "BAD_USER_INPUT",
  "NOT_FOUND",
  "CONFLICT",
] as const;

export type BmsGraphqlClientErrorCode = (typeof BMS_GRAPHQL_CLIENT_ERROR_CODES)[number];

/** Client-correctable GraphQL errors. Business rejections remain successful data with status. */
export function mobileGraphqlError(
  message: string,
  code: BmsGraphqlClientErrorCode,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { ...extra, code },
  });
}

/**
 * Apollo normally adds INTERNAL_SERVER_ERROR itself. Keep a repo-owned final guard so plugins,
 * upload handling, and future custom GraphQLError sites cannot emit an error with no stable code.
 */
export function ensureBmsGraphqlErrorCode(error: GraphQLFormattedError): GraphQLFormattedError {
  const code = typeof error.extensions?.code === "string" && error.extensions.code.trim()
    ? error.extensions.code
    : "INTERNAL_SERVER_ERROR";
  return {
    ...error,
    extensions: {
      ...error.extensions,
      code,
    },
  };
}
