import { coreTypeDefs } from "../../../packages/graphql-core/src/typeDefs";
// NOTE: เราไม่ import coreResolvers ทางฝั่ง Web/HTTP เพื่อเลี่ยงเรื่อง extension และ Redis deps
import { typeDefs } from "./typeDefs";
import { resolvers } from "./resolvers";
import { bmsPosDeviceTypeDefs } from "./bmsPosDevice";
import { bmsMobileOperationsTypeDefs } from "./bmsMobileOperations";
import { bmsTaxReportsTypeDefs } from "./bmsTaxReports";
import { bmsExpenseDocumentsTypeDefs } from "./bmsExpenseDocuments";
import { bmsBranchRequisitionsTypeDefs } from "./bmsBranchRequisitions";
import { bmsBoardGameAnalyticsTypeDefs } from "./bmsBoardGameAnalytics";
import { bmsOperationChecklistsTypeDefs, bmsOperationChecklistsResolvers } from "./bmsOperationChecklists";
import { bmsOperationTeamTypeDefs, bmsOperationTeamResolvers } from "./bmsOperationTeam";
import { bmsOperationProductionTypeDefs, bmsOperationProductionResolvers } from "./bmsOperationProduction";
import { bmsOperationImprovementTypeDefs, bmsOperationImprovementResolvers } from "./bmsOperationImprovement";
import { bmsOperationMaterialsTypeDefs, bmsOperationMaterialsResolvers } from "./bmsOperationMaterials";
import { bmsOperationQualityTypeDefs, bmsOperationQualityResolvers } from "./bmsOperationQuality";

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
export const mergedTypeDefs = [coreTypeDefs, typeDefs, bmsPosDeviceTypeDefs, bmsMobileOperationsTypeDefs, bmsTaxReportsTypeDefs, bmsExpenseDocumentsTypeDefs, bmsBranchRequisitionsTypeDefs, bmsBoardGameAnalyticsTypeDefs];
mergedTypeDefs.push(bmsOperationChecklistsTypeDefs);
mergedTypeDefs.push(bmsOperationTeamTypeDefs);
mergedTypeDefs.push(bmsOperationProductionTypeDefs);
mergedTypeDefs.push(bmsOperationImprovementTypeDefs);
mergedTypeDefs.push(bmsOperationMaterialsTypeDefs);
mergedTypeDefs.push(bmsOperationQualityTypeDefs);
export const mergedResolvers = mergeResolvers(mergeResolvers(mergeResolvers(mergeResolvers(mergeResolvers(mergeResolvers(resolvers, bmsOperationChecklistsResolvers), bmsOperationTeamResolvers), bmsOperationProductionResolvers), bmsOperationImprovementResolvers),bmsOperationMaterialsResolvers),bmsOperationQualityResolvers);
