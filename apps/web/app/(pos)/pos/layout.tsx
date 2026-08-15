// จอขายหน้าร้าน — layout เต็มจอ แยกจาก /admin โดยตั้งใจ
//
// อยู่ใน apps/web แทนที่จะแยกเป็น apps/pos ตามที่เคยเสนอไว้ตอนวิเคราะห์
// เพราะสิ่งที่ต้องแยกจริงคือ "หน้าจอ" ไม่ใช่ build/deploy — route group นี้
// ให้ layout เต็มจอโดยไม่ต้องทำ pipeline ใหม่ ยกออกไปเป็น app แยกทีหลังได้
// เมื่อมีเหตุผลจริง (เช่น ทำ PWA offline ซึ่งตอนนี้ตัดสินใจว่าไม่ทำ)
import type { ReactNode } from "react";

export const metadata = {
  title: "POS — ขายหน้าร้าน",
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        // จอสัมผัส: กันการเลือกข้อความค้างตอนกดปุ่มรัว ๆ
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {children}
    </div>
  );
}
