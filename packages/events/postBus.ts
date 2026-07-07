// packages/events/postBus.ts
import { EventEmitter } from "node:events";

/**
 * Event names ที่เกี่ยวกับ post lifecycle
 */
export type PostEventName =
  | "post.created"
  | "post.updated"
  | "post.deleted";

/**
 * Image payload (ใช้กับ social worker)
 */
export type PostImagePayload = {
  id: number | string;
  url: string;

  // เผื่อใช้งานในอนาคต
  relpath?: string | null;
  mime?: string | null;
};

/**
 * Tel number payload
 * - เป็น "final state" หลัง sync แล้ว
 * - ไม่มี mode (new/edited/deleted)
 */
export type PostTelNumberPayload = {
  id: number | string;
  tel: string;
};

/**
 * Payload หลักของ Post Event
 */
export type PostEventPayload = {
  // =====================================================
  // meta
  // =====================================================
  eventId: string;
  occurredAt?: string | null;

  // =====================================================
  // actor
  // =====================================================
  actorId: string;

  // =====================================================
  // post identity
  // =====================================================
  postId: string;
  revisionId?: string | null;

  // =====================================================
  // post fields (เลือกใช้ตาม worker)
  // =====================================================
  title?: string | null;
  detail?: string | null;          // raw detail
  summary?: string | null;         // summary สำหรับ social
  website?: string | null;         // raw website
  url?: string | null;             // url สำหรับ social
  status?: string | null;

  first_last_name?: string | null;
  id_card?: string | null;

  transfer_amount?: number | null;
  transfer_date?: string | null;   // ISO string

  province_id?: number | string | null;

  auto_publish?: boolean | null;

  // =====================================================
  // relations
  // =====================================================
  images?: PostImagePayload[];
  

  /**
   * ✅ NEW
   * tel_numbers ของ post (final state)
   * - จะถูกส่งมาเฉพาะกรณี client ส่ง data.tel_numbers
   * - worker สามารถใช้ทำ layout / contact ได้ทันที
   */
  tel_numbers?: PostTelNumberPayload[];
};

/**
 * Global singleton event bus
 * (กัน duplicate instance ตอน hot-reload / test)
 */
const g = globalThis as any;

export const postBus: EventEmitter =
  g.__jachoei_postBus__ ??
  (g.__jachoei_postBus__ = new EventEmitter());

// กัน memory leak ตอนมี worker หลายตัว subscribe
postBus.setMaxListeners(50);
