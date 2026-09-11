import { GraphQLError } from "graphql/error";

import type { PosDevice, PinVerifyResult } from "@/lib/bms/pos";
import { cashierHasPermission, getOpenPosShift, verifyCashierPin } from "@/lib/bms/pos";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import { isDistinctPosApprover } from "@/lib/bms/posRouteHelpers";

export type PosDeviceGraphqlContext = {
  scope?: string;
  posDevice?: PosDevice | null;
};

function gqlError(message: string, code: string, extra: Record<string, unknown> = {}): never {
  throw new GraphQLError(message, {
    extensions: { code, http: { status: code === "UNAUTHENTICATED" ? 401 : 403 }, ...extra },
  });
}

/**
 * Resolve the register identity established by the GraphQL HTTP context.
 * A client-supplied tenant/location/device argument is never accepted as authority.
 */
export function requirePosDevice(ctx: PosDeviceGraphqlContext): PosDevice {
  if (ctx?.scope !== "pos" || !ctx.posDevice?.active) {
    return gqlError("device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว", "UNAUTHENTICATED", {
      reason: "pos_device",
    });
  }
  return ctx.posDevice;
}

export type PosCashierCredentials = {
  cashierUserId?: unknown;
  pin?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verify the human for this operation. A device token alone never grants a person permission. */
export async function requirePosCashier(
  device: PosDevice,
  credentials: PosCashierCredentials,
  permission: string,
): Promise<Extract<PinVerifyResult, { ok: true }>> {
  const userId = typeof credentials.cashierUserId === "string"
    ? credentials.cashierUserId.trim()
    : "";
  const pin = typeof credentials.pin === "string" ? credentials.pin : "";
  if (!UUID_RE.test(userId) || !pin || pin.length > 32) {
    return gqlError("ต้องระบุพนักงานและ PIN", "BAD_USER_INPUT");
  }
  const actor = await verifyCashierPin(device.tenantId, userId, pin);
  if (!actor.ok) {
    const message = actor.reason === "NO_PIN"
      ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : actor.reason === "LOCKED"
        ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
        : "PIN ไม่ถูกต้อง";
    return gqlError(message, "FORBIDDEN", {
      reason: actor.reason,
      ...(actor.lockedUntil ? { lockedUntil: actor.lockedUntil } : {}),
    });
  }
  if (!(await cashierHasPermission(device.tenantId, actor.userId, permission))) {
    return gqlError(await posPermissionDeniedMessage(device.tenantId, permission), "FORBIDDEN", {
      permission,
    });
  }
  return actor;
}

export async function requirePosSecondPerson(
  device: PosDevice,
  actorUserId: string,
  credentials: { userId?: unknown; pin?: unknown },
  permission: string,
  labels: { required: string; samePerson: string; invalidPin?: string },
): Promise<Extract<PinVerifyResult, { ok: true }>> {
  const userId = typeof credentials.userId === "string" ? credentials.userId.trim() : "";
  const pin = typeof credentials.pin === "string" ? credentials.pin : "";
  if (!UUID_RE.test(userId) || !pin || pin.length > 32) return badPosInput(labels.required);
  if (!isDistinctPosApprover(actorUserId, userId)) return badPosInput(labels.samePerson);
  const approver = await verifyCashierPin(device.tenantId, userId, pin);
  if (!approver.ok) {
    return gqlError(labels.invalidPin ?? "PIN ผู้อนุมัติไม่ถูกต้อง", "FORBIDDEN", {
      reason: approver.reason,
      ...(approver.lockedUntil ? { lockedUntil: approver.lockedUntil } : {}),
    });
  }
  if (!(await cashierHasPermission(device.tenantId, approver.userId, permission))) {
    return gqlError(
      await posPermissionDeniedMessage(device.tenantId, permission, { secondPerson: true }),
      "FORBIDDEN",
      { permission },
    );
  }
  return approver;
}

export async function requirePosPermissionForActor(
  device: PosDevice,
  actorUserId: string,
  permission: string,
): Promise<void> {
  if (!(await cashierHasPermission(device.tenantId, actorUserId, permission))) {
    return gqlError(await posPermissionDeniedMessage(device.tenantId, permission), "FORBIDDEN", {
      permission,
    });
  }
}

export async function verifyOptionalPosPerson(
  device: PosDevice,
  userIdValue: unknown,
  pinValue: unknown,
): Promise<string | null> {
  const userId = typeof userIdValue === "string" ? userIdValue.trim() : "";
  const pin = typeof pinValue === "string" ? pinValue : "";
  if (!userId && !pin) return null;
  if (!UUID_RE.test(userId) || !pin || pin.length > 32) return badPosInput("ข้อมูลผู้อนุมัติไม่ครบ");
  const result = await verifyCashierPin(device.tenantId, userId, pin);
  if (!result.ok) return gqlError("PIN ผู้อนุมัติไม่ถูกต้อง", "FORBIDDEN", { reason: result.reason });
  return result.userId;
}

export async function requireOpenPosShift(device: PosDevice) {
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return gqlError("ยังไม่ได้เปิดกะ", "CONFLICT", { reason: "SHIFT_NOT_OPEN" });
  return shift;
}

export function badPosInput(message: string): never {
  return gqlError(message, "BAD_USER_INPUT");
}

export function posConflict(message: string, reason?: string): never {
  return gqlError(message, "CONFLICT", reason ? { reason } : {});
}
