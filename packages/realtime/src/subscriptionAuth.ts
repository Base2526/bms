import { REALTIME_EVENT_RULES, isRealtimeEventEnabled, type RealtimeEvent } from "./events.js";
import { topicForDevice, topicForLocation, topicForTenant, topicForUser } from "./topics.js";
import type { RealtimeTicketClaims } from "./wsTicket.js";

/**
 * ตัวตัดสินว่า "ผู้ถือ ticket ใบนี้ได้รับ event ใบนี้ไหม" — จุดเดียวที่กันข้ามร้าน
 *
 * อยู่ที่ `packages/realtime` ไม่ใช่ใน resolver เพราะมันไม่พึ่ง GraphQL เลย และเพราะ
 * มันต้อง **ทดสอบพฤติกรรมได้** ไม่ใช่ตรวจแค่ว่ามีการเรียกในซอร์ส · ตอนอยู่ในไฟล์
 * resolver มันเป็นฟังก์ชันภายในที่ไม่มีใคร import ได้ จึงไม่เคยมีเทสป้อน tenant
 * ที่ไม่ตรงแล้ว assert ว่า false สักตัว
 */

const defaultEnv = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

/** หัวข้อที่ ticket ใบนี้มีสิทธิ์ฟัง — มาจาก claims เท่านั้น ไม่เคยมาจาก argument ของผู้เรียก */
export function realtimeTopics(claims: RealtimeTicketClaims): string[] {
  const topics = [topicForUser(claims.tenantId ?? "global", claims.subjectId)];
  if (claims.tenantId) {
    topics.push(topicForTenant(claims.tenantId));
    for (const locationId of claims.locationIds) {
      topics.push(topicForLocation(claims.tenantId, locationId));
    }
    // เครื่องขายต้องฟังหัวข้อของตัวเองด้วย — `device.session.changed` ถูก publish ที่หัวข้อ
    // device เท่านั้น ถ้าไม่ subscribe ตัวนี้ `bmsDeviceSessionChanged` จะไม่มีวันยิงสักครั้ง
    // (ตัวตัดสินสิทธิ์ตอบว่า "ได้" กับ event ที่สายนี้ไม่ได้ฟังอยู่) · ticket ของ POS ถูก
    // validate แล้วว่ามีสาขาเดียวเสมอ
    if (claims.scope === "pos" && claims.locationIds.length === 1) {
      topics.push(topicForDevice(claims.tenantId, claims.locationIds[0], claims.subjectId));
    }
  }
  return topics;
}

export function canReceiveRealtimeEvent(
  event: RealtimeEvent,
  claims: RealtimeTicketClaims,
  env: Readonly<Record<string, string | undefined>> = defaultEnv,
): boolean {
  const rule = REALTIME_EVENT_RULES[event.eventType];
  if (!rule) return false;
  if (!isRealtimeEventEnabled(event.eventType, env)) return false;
  if (event.tenantId !== claims.tenantId) return false;
  if (!rule.permissions.every((permission) => claims.permissions.includes(permission))) return false;
  if (rule.audience === "user") return event.userId === claims.subjectId;
  if (rule.audience === "location") {
    return Boolean(event.locationId)
      && (claims.allLocations || claims.locationIds.includes(event.locationId!));
  }
  if (rule.audience === "device") {
    return claims.scope === "pos" && event.deviceId === claims.subjectId
      && Boolean(event.locationId) && claims.locationIds.includes(event.locationId!);
  }
  return rule.audience === "tenant";
}
