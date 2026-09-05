import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import {
  createRestaurantArea,
  createRestaurantTable,
  deleteRestaurantArea,
  deleteRestaurantTable,
  listRestaurantFloor,
  renameRestaurantArea,
  reorderRestaurantAreas,
  saveRestaurantFloorLayout,
  updateRestaurantTable,
} from "@/lib/bms/restaurantPos";

async function floorContext(ctx: any) {
  await requirePermission(ctx, "restaurant.floor.manage");
  const auth = requireAuth(ctx);
  return { tenantId: getTenantId(ctx), actorUserId: String(auth.author_id) };
}

async function floorMutation<T>(work: () => Promise<T>, fallback: string) {
  try {
    return await work();
  } catch (error: any) {
    throw new GraphQLError(error?.message || fallback, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export const bmsRestaurantFloorAdminResolvers = {
  Query: {
    async bmsRestaurantFloorAdmin(_parent: unknown, args: { locationId: string }, ctx: any) {
      const actor = await floorContext(ctx);
      return listRestaurantFloor(actor.tenantId, args.locationId);
    },
  },
  Mutation: {
    async bmsCreateRestaurantArea(_parent: unknown, args: { locationId: string; name: string }, ctx: any) {
      const actor = await floorContext(ctx);
      return floorMutation(
        () => createRestaurantArea({ ...actor, locationId: args.locationId, name: args.name }),
        "สร้างโซนไม่สำเร็จ"
      );
    },
    async bmsRenameRestaurantArea(_parent: unknown, args: { areaId: string; name: string }, ctx: any) {
      const actor = await floorContext(ctx);
      return floorMutation(
        () => renameRestaurantArea({ ...actor, areaId: args.areaId, name: args.name }),
        "เปลี่ยนชื่อโซนไม่สำเร็จ"
      );
    },
    async bmsReorderRestaurantAreas(
      _parent: unknown,
      args: { locationId: string; orderedAreaIds: string[] },
      ctx: any
    ) {
      const actor = await floorContext(ctx);
      return floorMutation(
        () => reorderRestaurantAreas({ ...actor, locationId: args.locationId, orderedAreaIds: args.orderedAreaIds }),
        "เรียงลำดับโซนไม่สำเร็จ"
      );
    },
    async bmsDeleteRestaurantArea(_parent: unknown, args: { areaId: string }, ctx: any) {
      const actor = await floorContext(ctx);
      return floorMutation(() => deleteRestaurantArea({ ...actor, areaId: args.areaId }), "ลบโซนไม่สำเร็จ");
    },
    async bmsCreateRestaurantTable(
      _parent: unknown,
      args: { locationId: string; areaId: string; name: string; seats: number; shape: "round" | "rect" },
      ctx: any
    ) {
      const actor = await floorContext(ctx);
      return floorMutation(() => createRestaurantTable({ ...actor, ...args }), "สร้างโต๊ะไม่สำเร็จ");
    },
    async bmsUpdateRestaurantTable(
      _parent: unknown,
      args: { tableId: string; patch: any },
      ctx: any
    ) {
      const actor = await floorContext(ctx);
      return floorMutation(
        () => updateRestaurantTable({ ...actor, tableId: args.tableId, patch: args.patch }),
        "แก้ไขโต๊ะไม่สำเร็จ"
      );
    },
    async bmsDeleteRestaurantTable(_parent: unknown, args: { tableId: string }, ctx: any) {
      const actor = await floorContext(ctx);
      return floorMutation(() => deleteRestaurantTable({ ...actor, tableId: args.tableId }), "ลบโต๊ะไม่สำเร็จ");
    },
    async bmsSaveRestaurantFloorLayout(
      _parent: unknown,
      args: { locationId: string; positions: Array<{ tableId: string; x: number; y: number }> },
      ctx: any
    ) {
      const actor = await floorContext(ctx);
      return floorMutation(
        () => saveRestaurantFloorLayout({ ...actor, locationId: args.locationId, positions: args.positions }),
        "บันทึกผังร้านไม่สำเร็จ"
      );
    },
  },
};
