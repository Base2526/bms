import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/roadmap", locale,
    title: locale === "th" ? "แผนพัฒนา BMS" : "BMS roadmap",
    description: locale === "th" ? "ดูทิศทางและสถานะการพัฒนา BMS พร้อมขอบเขตที่เปิดใช้งานแล้วและงานที่ยังอยู่ระหว่างพัฒนา" : "See the direction and status of BMS development, including released capabilities and work still in progress." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
