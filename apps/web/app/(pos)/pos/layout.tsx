// จอขายหน้าร้าน — layout เต็มจอ แยกจาก /admin โดยตั้งใจ
//
// อยู่ใน apps/web แทนที่จะแยกเป็น apps/pos ตามที่เคยเสนอไว้ตอนวิเคราะห์
// เพราะสิ่งที่ต้องแยกจริงคือ "หน้าจอ" ไม่ใช่ build/deploy — route group นี้
// ให้ layout เต็มจอโดยไม่ต้องทำ pipeline ใหม่ ยกออกไปเป็น app แยกทีหลังได้
// เมื่อมีเหตุผลจริง (เช่น ทำ PWA offline ซึ่งตอนนี้ตัดสินใจว่าไม่ทำ)
//
// สไตล์อยู่ใน pos.css — ใช้ token/visual language ของ Ant Design แต่คง element เบา ๆ
// ที่มีเป้ากดขนาดนิ้วโป้งสำหรับแท็บเล็ตหน้าร้าน (ดูเหตุผลเต็มในหัวไฟล์ CSS)
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./pos.css";
import PosGuideAssistant from "@/components/work-assistant/PosGuideAssistant";
import { PosOperatorSessionProvider } from "@/components/pos/PosOperatorSession";

// โหลดและ self-host ฟอนต์จริงผ่าน Next แทนการระบุชื่อฟอนต์ที่เครื่องแคชเชียร์อาจไม่มี
// IBM Plex Sans Thai คือ face ที่ใช้เป็น reference ใน mockup Ant: ทรงอักษรแคบและเป็นระบบกว่า
// system Thai font และต้องระบุน้ำหนักจริงเพื่อไม่ให้แต่ละ OS synthesize ตัวหนาต่างกัน.
const posFont = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-pos",
});

export const metadata = {
  title: "POS — ขายหน้าร้าน",
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <PosOperatorSessionProvider>
      <div className={`pos-root ${posFont.variable}`}>
        {children}
        <PosGuideAssistant className="pos-guide-floating" />
      </div>
    </PosOperatorSessionProvider>
  );
}
