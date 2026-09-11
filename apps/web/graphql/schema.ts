import { makeExecutableSchema } from "@graphql-tools/schema";

import { mergedTypeDefs, mergedResolvers } from "./index";

/**
 * สคีมา HTTP ชุดเดียวของทั้งแอป — `/api/graphql` สร้างจากตัวนี้ และเทสสัญญาก็ตรวจตัวเดียวกัน
 * SDL ที่พังหรือ resolver ที่ไม่ตรง type ทำให้ route ทั้งเส้นล้มตั้งแต่ import
 * (ไม่ใช่แค่ operation นั้นพัง) ซึ่ง typecheck มองไม่เห็น จึงต้องมีด่านที่ "สร้างจริง"
 */
export function buildBmsGraphqlSchema() {
  return makeExecutableSchema({ typeDefs: mergedTypeDefs, resolvers: mergedResolvers });
}
