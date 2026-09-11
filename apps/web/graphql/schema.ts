import { makeExecutableSchema } from "@graphql-tools/schema";
// `graphql` is also this app's local folder name and tsconfig has baseUrl=".". Importing the
// package utility subpath prevents tsx from resolving this back to graphql/index.ts.
import { lexicographicSortSchema, printSchema } from "graphql/utilities/index.js";

import { mergedTypeDefs, mergedResolvers } from "./index";

/**
 * สคีมา HTTP ชุดเดียวของทั้งแอป — `/api/graphql` สร้างจากตัวนี้ และเทสสัญญาก็ตรวจตัวเดียวกัน
 * SDL ที่พังหรือ resolver ที่ไม่ตรง type ทำให้ route ทั้งเส้นล้มตั้งแต่ import
 * (ไม่ใช่แค่ operation นั้นพัง) ซึ่ง typecheck มองไม่เห็น จึงต้องมีด่านที่ "สร้างจริง"
 */
export function buildBmsGraphqlSchema() {
  return makeExecutableSchema({ typeDefs: mergedTypeDefs, resolvers: mergedResolvers });
}

/**
 * Canonical SDL for code generation and review. Sorting makes the committed artifact independent
 * of module registration order; a trailing newline keeps command-line diffs stable.
 */
export function renderBmsGraphqlSdl(): string {
  return `${printSchema(lexicographicSortSchema(buildBmsGraphqlSchema()))}\n`;
}
