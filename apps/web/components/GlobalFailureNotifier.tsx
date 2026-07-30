"use client";

import { gql, useSubscription } from "@apollo/client";
import { notify } from "@/lib/notify";

const SUB_NOTIFICATION_CREATED = gql`
  subscription { notificationCreated { id title message entity_type data } }
`;

/**
 * แจ้งเตือนเมื่อระบบขัดข้องจนกระทบลูกค้า (reportBmsFailure ฝั่ง server —
 * lib/bms/failureAlert.ts) reuse ระบบ notifications เดิมแบบเดียวกับ
 * GlobalMentionNotifier: ฝั่ง WS filter ตาม user_id ให้แล้ว ตรงนี้จึงกรองแค่
 * entity_type ของ incident แล้วเด้ง browser notification ต่อ
 *
 * ต่างจาก GlobalMentionNotifier ที่ skip ด้วย can("inbox.view") — ตัวนี้ไม่เช็ค
 * permission ฝั่ง client เพราะผู้รับถูกเลือกไว้แล้วตอนสร้าง notification
 * (Administrator/Manager ของร้าน + staff หลักของแชท + platform admin) ถ้ามา
 * เช็คซ้ำด้วย inbox.view จะทำให้ platform admin ที่ไม่มีสิทธิ์ในร้านนั้นไม่ได้รับแจ้ง
 */
export function GlobalFailureNotifier() {
  useSubscription(SUB_NOTIFICATION_CREATED, {
    onData: async ({ data }: any) => {
      const n = data?.data?.notificationCreated;
      if (!n || n.entity_type !== "bms_failure_incident") return;

      const conversationId = n.data?.conversationId;
      const result = await notify(n.title || "ระบบขัดข้อง", {
        body: n.message || "",
        tag: `bms-failure-${n.id}`,
      });
      if (!result) return;

      // platform admin ได้ incident ของร้านอื่นด้วย — ลิงก์เข้า Inbox ของร้านนั้น
      // ไม่ได้เพราะยังไม่ได้ drill-down (cookie BMS_ACT_TENANT) จึงส่งไปหน้า
      // ตรวจสอบระบบแทน ส่วนฝั่งร้านลิงก์เข้าแชทที่กระทบตรง ๆ
      result.onclick = () => {
        window.focus();
        window.location.href = n.data?.platform
          ? "/admin/env"
          : conversationId
            ? `/admin/inbox?c=${conversationId}`
            : "/admin/inbox";
      };
    },
  });

  return null;
}
