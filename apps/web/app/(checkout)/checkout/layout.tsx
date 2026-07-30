import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ตรวจสอบออร์เดอร์และชำระเงิน | BMS",
  description: "ตรวจสอบข้อมูลจัดส่งและแจ้งชำระเงินสำหรับออร์เดอร์ของคุณ",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
