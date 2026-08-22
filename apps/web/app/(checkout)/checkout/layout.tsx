import type { Metadata } from "next";
import { cookies } from "next/headers";

// Tab title/description only — low-visibility enough that a static Metadata export
// wasn't worth converting to an async generateMetadata() until this pass.
export async function generateMetadata(): Promise<Metadata> {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  return {
    title:
      lang === "en"
        ? "Review your order & submit payment | BMS"
        : "ตรวจสอบออร์เดอร์และชำระเงิน | BMS",
    description:
      lang === "en"
        ? "Review your delivery details and submit payment for your order."
        : "ตรวจสอบข้อมูลจัดส่งและแจ้งชำระเงินสำหรับออร์เดอร์ของคุณ",
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
