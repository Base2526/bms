import { previewMenuProfit, confirmMenuProfit, getMenuProfit, type MenuProfitInput } from "@/lib/bms/restaurantMenuProfit";
import { previewBundlePublication, publishMenuBundle, type BundlePublicationInput } from "@/lib/bms/restaurantBundlePublishing";
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { inventoryValuation, confirmInventoryValue } from "@/lib/bms/inventoryValuation";
import { getRestaurantMenuActual } from "@/lib/bms/restaurantMenuActual";
import { previewPricePublication, publishPricePlan, type PublishPriceInput } from "@/lib/bms/restaurantPricePublishing";
async function result<T>(work:()=>Promise<T>) {
  try { return await work(); } catch(e) {
    const code=e instanceof Error ? e.message : '';
    if (code.endsWith('FORBIDDEN') || code.endsWith('ALL_BRANCH_ACCESS_REQUIRED')) throw new GraphQLError('Forbidden',{extensions:{code:'FORBIDDEN'}});
    if (['VALUATION_','PRICE_PUBLISH_','PRICE_PLAN_','SALES_EVIDENCE_','MENU_PROFIT_','BUNDLE_PUBLISH_','MENU_PLAN_','NET_PROFIT_','COST_'].some(p=>code.startsWith(p))) return {status:'REJECTED',errorCode:code};
    throw e;
  }
}
export const bmsRestaurantCostingResolvers = {
  Query: {
    async bmsMenuNetProfit(_p:unknown,args:{month:string;locationId?:string},ctx:any) {
      for(const p of ['report.view','expense.view','delivery.settlement.view','tax.document.view','product.view'] as const) await requirePermission(ctx,p);
      return result(()=>getMenuProfit(getTenantId(ctx),String(requireAuth(ctx).author_id),args));
    },
    async bmsPreviewMenuNetProfit(_p:unknown,args:{input:MenuProfitInput},ctx:any) {
      for(const p of ['report.view','expense.view','delivery.settlement.view','tax.document.view','product.view'] as const) await requirePermission(ctx,p);
      return result(()=>previewMenuProfit(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input));
    },
    async bmsPreviewMenuBundle(_p:unknown,args:{input:BundlePublicationInput},ctx:any) {
      for(const p of ['product.edit','product.delete','report.view'] as const) await requirePermission(ctx,p);
      return result(()=>previewBundlePublication(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input));
    },
    async bmsInventoryValuation(_p:unknown,args:{locationId:string;search?:string;offset?:number;limit?:number},ctx:any) {
      await requirePermission(ctx,'product.view'); await requirePermission(ctx,'report.view');
      return result(async()=>({status:'OK',...await inventoryValuation(getTenantId(ctx),String(requireAuth(ctx).author_id),args.locationId,args)}));
    },
    async bmsRestaurantMenuActual(_p:unknown,args:{input:unknown},ctx:any) {
      for(const perm of ['product.view','report.view','tax.document.view'] as const) await requirePermission(ctx,perm);
      return result(()=>getRestaurantMenuActual(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input));
    },
    async bmsPreviewPricePublication(_p:unknown,args:{input:PublishPriceInput},ctx:any) {
      await requirePermission(ctx,'product.edit'); await requirePermission(ctx,'report.view');
      return result(()=>previewPricePublication(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input));
    },
  },
  Mutation: {
    async bmsConfirmMenuNetProfit(_p:unknown,args:{input:MenuProfitInput;review:Parameters<typeof confirmMenuProfit>[3]},ctx:any) {
      for(const p of ['report.view','expense.view','expense.manage','delivery.settlement.view','tax.document.view','product.view'] as const) await requirePermission(ctx,p);
      return result(()=>confirmMenuProfit(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input,args.review));
    },
    async bmsPublishMenuBundle(_p:unknown,args:{input:BundlePublicationInput;review:Parameters<typeof publishMenuBundle>[3]},ctx:any) {
      for(const p of ['product.edit','product.delete','report.view'] as const) await requirePermission(ctx,p);
      return result(()=>publishMenuBundle(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input,args.review));
    },
    async bmsConfirmInventoryValue(_p:unknown,args:{input:Parameters<typeof confirmInventoryValue>[2]},ctx:any) {
      await requirePermission(ctx,'inventory.count.apply'); await requirePermission(ctx,'report.view');
      return result(()=>confirmInventoryValue(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input));
    },
    async bmsPublishPricePlan(_p:unknown,args:{input:PublishPriceInput;review:Parameters<typeof publishPricePlan>[3]},ctx:any) {
      await requirePermission(ctx,'product.edit'); await requirePermission(ctx,'report.view');
      return result(()=>publishPricePlan(getTenantId(ctx),String(requireAuth(ctx).author_id),args.input,args.review));
    },
  },
};
