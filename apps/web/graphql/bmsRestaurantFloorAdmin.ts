import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { listLocationsForUser, userCanAccessLocation } from "@/lib/bms/locations";
import {
  createRestaurantArea,
  createRestaurantTable,
  deleteRestaurantArea,
  deleteRestaurantTable,
  listRestaurantFloor,
  locationOfRestaurantArea,
  locationOfRestaurantTable,
  renameRestaurantArea,
  reorderRestaurantAreas,
  saveRestaurantFloorLayout,
  updateRestaurantTable,
} from "@/lib/bms/restaurantPos";
import { getRestaurantTableQr, issueRestaurantTableQr } from "@/lib/bms/restaurantQrOrdering";

async function floorContext(ctx: any) {
  await requirePermission(ctx, "restaurant.floor.manage");
  const auth = requireAuth(ctx);
  return { tenantId: getTenantId(ctx), actorUserId: String(auth.author_id) };
}

/**
 * ขอบเขตสาขาของคนกด (9.37) — `restaurant.floor.manage` บอกว่า "จัดผังร้านได้" ไม่ได้บอกว่า
 * "จัดผังของสาขาไหนได้" · ไม่มีด่านนี้ พนักงานที่ร้านตั้งให้ดูแลสาขาเดียวจะแก้โซน/โต๊ะ และ
 * **หมุน QR ที่ติดอยู่บนโต๊ะจริงของอีกสาขา** ได้ (หมุนแล้วสติกเกอร์ที่พิมพ์ไปแล้วใช้ไม่ได้ทันที
 * และ session ของลูกค้าที่กำลังนั่งอยู่ถูกตัด) ซึ่งกว้างกว่าที่ร้านตั้งใจให้
 *
 * `userCanAccessLocation()` คืน true เมื่อผู้ใช้ไม่ได้ถูกจำกัดสาขาเลย — ร้านที่ไม่ได้ใช้
 * bms_user_allowed_locations จึงไม่มีอะไรเปลี่ยน (9.37 เป็น opt-in)
 */
async function assertFloorBranch(
  actor: { tenantId: string; actorUserId: string },
  locationId: string | null | undefined
) {
  if (!locationId || !(await userCanAccessLocation(actor.tenantId, actor.actorUserId, locationId))) {
    throw new GraphQLError("ไม่มีสิทธิ์จัดผังร้านของสาขานี้", { extensions: { code: "FORBIDDEN" } });
  }
  return locationId;
}

async function floorContextForLocation(ctx: any, locationId: string) {
  const actor = await floorContext(ctx);
  await assertFloorBranch(actor, locationId);
  return actor;
}

async function floorContextForArea(ctx: any, areaId: string) {
  const actor = await floorContext(ctx);
  await assertFloorBranch(actor, await locationOfRestaurantArea(actor.tenantId, areaId));
  return actor;
}

async function floorContextForTable(ctx: any, tableId: string) {
  const actor = await floorContext(ctx);
  await assertFloorBranch(actor, await locationOfRestaurantTable(actor.tenantId, tableId));
  return actor;
}

async function floorMutation<T>(work: () => Promise<T>, fallback: string) {
  try {
    return await work();
  } catch (error: any) {
    // ด่านสิทธิ์/ขอบเขตสาขาต้องไม่ถูกแปลงเป็น BAD_USER_INPUT — ฝั่งจอแยก "กรอกผิด"
    // ออกจาก "ไม่มีสิทธิ์" ไม่ได้ถ้าทุกอย่างมาเป็นรหัสเดียวกัน
    if (error instanceof GraphQLError) throw error;
    throw new GraphQLError(error?.message || fallback, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export const bmsRestaurantFloorAdminResolvers = {
  Query: {
    async bmsRestaurantFloorAdmin(_parent: unknown, args: { locationId: string }, ctx: any) {
      const actor = await floorContextForLocation(ctx, args.locationId);
      return listRestaurantFloor(actor.tenantId, args.locationId);
    },
    async bmsRestaurantFloorLocations(_parent: unknown, _args: unknown, ctx: any) {
      const actor = await floorContext(ctx);
      return listLocationsForUser(actor.tenantId, actor.actorUserId);
    },
    async bmsRestaurantTableQr(_parent: unknown, args: { tableId: string }, ctx: any) {
      const actor = await floorContextForTable(ctx, args.tableId);
      return getRestaurantTableQr(actor.tenantId, args.tableId);
    },
  },
  Mutation: {
    async bmsIssueRestaurantTableQr(
      _parent: unknown,
      args: { tableId: string; rotate?: boolean | null },
      ctx: any
    ) {
      const actor = await floorContextForTable(ctx, args.tableId);
      return floorMutation(
        () => issueRestaurantTableQr({ ...actor, tableId: args.tableId, rotate: Boolean(args.rotate) }),
        "สร้าง QR โต๊ะไม่สำเร็จ"
      );
    },
    async bmsCreateRestaurantArea(_parent: unknown, args: { locationId: string; name: string }, ctx: any) {
      const actor = await floorContextForLocation(ctx, args.locationId);
      return floorMutation(
        () => createRestaurantArea({ ...actor, locationId: args.locationId, name: args.name }),
        "สร้างโซนไม่สำเร็จ"
      );
    },
    async bmsRenameRestaurantArea(_parent: unknown, args: { areaId: string; name: string }, ctx: any) {
      const actor = await floorContextForArea(ctx, args.areaId);
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
      const actor = await floorContextForLocation(ctx, args.locationId);
      return floorMutation(
        () => reorderRestaurantAreas({ ...actor, locationId: args.locationId, orderedAreaIds: args.orderedAreaIds }),
        "เรียงลำดับโซนไม่สำเร็จ"
      );
    },
    async bmsDeleteRestaurantArea(_parent: unknown, args: { areaId: string }, ctx: any) {
      const actor = await floorContextForArea(ctx, args.areaId);
      return floorMutation(() => deleteRestaurantArea({ ...actor, areaId: args.areaId }), "ลบโซนไม่สำเร็จ");
    },
    async bmsCreateRestaurantTable(
      _parent: unknown,
      args: { locationId: string; areaId: string; name: string; seats: number; shape: "round" | "rect" },
      ctx: any
    ) {
      const actor = await floorContextForLocation(ctx, args.locationId);
      // โซนปลายทางต้องอยู่ในสาขาเดียวกันอยู่แล้ว (FK composite ของ 9.47) แต่ตรวจที่นี่ด้วย
      // เพื่อให้คำตอบเป็น "ไม่มีสิทธิ์" ไม่ใช่ error ของ FK ที่อ่านไม่รู้เรื่อง
      await assertFloorBranch(actor, await locationOfRestaurantArea(actor.tenantId, args.areaId));
      return floorMutation(() => createRestaurantTable({ ...actor, ...args }), "สร้างโต๊ะไม่สำเร็จ");
    },
    async bmsUpdateRestaurantTable(
      _parent: unknown,
      args: { tableId: string; patch: any },
      ctx: any
    ) {
      const actor = await floorContextForTable(ctx, args.tableId);
      // ย้ายโต๊ะข้ามโซนได้ แต่ย้ายข้ามสาขาที่ตัวเองดูแลไม่ได้
      if (args.patch?.areaId) {
        await assertFloorBranch(actor, await locationOfRestaurantArea(actor.tenantId, String(args.patch.areaId)));
      }
      return floorMutation(
        () => updateRestaurantTable({ ...actor, tableId: args.tableId, patch: args.patch }),
        "แก้ไขโต๊ะไม่สำเร็จ"
      );
    },
    async bmsDeleteRestaurantTable(_parent: unknown, args: { tableId: string }, ctx: any) {
      const actor = await floorContextForTable(ctx, args.tableId);
      return floorMutation(() => deleteRestaurantTable({ ...actor, tableId: args.tableId }), "ลบโต๊ะไม่สำเร็จ");
    },
    async bmsSaveRestaurantFloorLayout(
      _parent: unknown,
      args: { locationId: string; positions: Array<{ tableId: string; x: number; y: number }> },
      ctx: any
    ) {
      const actor = await floorContextForLocation(ctx, args.locationId);
      return floorMutation(
        () => saveRestaurantFloorLayout({ ...actor, locationId: args.locationId, positions: args.positions }),
        "บันทึกผังร้านไม่สำเร็จ"
      );
    },
  },
};
