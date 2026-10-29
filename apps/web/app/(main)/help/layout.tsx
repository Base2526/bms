import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/help", locale,
    title: locale === "th" ? "คำถามที่พบบ่อยเกี่ยวกับ BMS" : "BMS frequently asked questions",
    description: locale === "th" ? "คำตอบเกี่ยวกับการเริ่มใช้ BMS การขาย สต็อก ช่องทางออนไลน์ ความปลอดภัย และการขอความช่วยเหลือ" : "Answers about getting started with BMS, sales, stock, online channels, security and support." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
