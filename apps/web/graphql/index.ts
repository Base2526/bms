import { coreTypeDefs } from "../../../packages/graphql-core/src/typeDefs";
// NOTE: เราไม่ import coreResolvers ทางฝั่ง Web/HTTP เพื่อเลี่ยงเรื่อง extension และ Redis deps
import { typeDefs } from "./typeDefs";
import { resolvers } from "./resolvers";

function mergeResolvers(base:any, extra:any){
  return {
    ...base, ...extra,
    Query: { ...(base?.Query||{}), ...(extra?.Query||{}) },
    Mutation: { ...(base?.Mutation||{}), ...(extra?.Mutation||{}) },
    Subscription: { ...(base?.Subscription||{}), ...(extra?.Subscription||{}) },
  };
}

// ฝั่ง Web/HTTP เอาเฉพาะ coreTypeDefs เพื่อให้สคีมาครบ
// ส่วน Subscription/Resolvers รันที่บริการ WS แยกอยู่แล้ว
export const mergedTypeDefs = [coreTypeDefs, typeDefs];
export const mergedResolvers = mergeResolvers({}, resolvers);
