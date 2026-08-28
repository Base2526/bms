// จอขายหน้าร้าน — layout เต็มจอ แยกจาก /admin โดยตั้งใจ
//
// อยู่ใน apps/web แทนที่จะแยกเป็น apps/pos ตามที่เคยเสนอไว้ตอนวิเคราะห์
// เพราะสิ่งที่ต้องแยกจริงคือ "หน้าจอ" ไม่ใช่ build/deploy — route group นี้
// ให้ layout เต็มจอโดยไม่ต้องทำ pipeline ใหม่ ยกออกไปเป็น app แยกทีหลังได้
// เมื่อมีเหตุผลจริง (เช่น ทำ PWA offline ซึ่งตอนนี้ตัดสินใจว่าไม่ทำ)
//
// สไตล์อยู่ใน pos.css — เขียนเองไม่ใช้ antd เพราะจอนี้ต้องการปุ่มขนาดนิ้วโป้ง
// และแท็บเล็ตหน้าร้านมักเป็นเครื่องเก่า (ดูเหตุผลเต็มในหัวไฟล์ CSS)
import type { ReactNode } from "react";
import "./pos.css";
import PosGuideAssistant from "@/components/work-assistant/PosGuideAssistant";

export const metadata = {
  title: "POS — ขายหน้าร้าน",
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return <div className="pos-root">{children}<PosGuideAssistant /></div>;
}
