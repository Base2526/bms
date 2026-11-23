import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export async function generateMetadata() {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/roadmap", locale,
    title: locale === "th" ? "แผนพัฒนา BMS POS+" : "BMS POS+ roadmap",
    description: locale === "th" ? "ดูทิศทางและสถานะการพัฒนา BMS POS+ พร้อมขอบเขตที่เปิดใช้งานแล้วและงานที่ยังอยู่ระหว่างพัฒนา" : "See the direction and status of BMS POS+ development, including released capabilities and work still in progress." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
