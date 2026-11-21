import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/demo", locale,
    title: locale === "th" ? "ทดลองคุยกับ BMS POS+ AI" : "Try the BMS POS+ AI demo",
    description: locale === "th" ? "ทดลองดูแนวทางที่ BMS POS+ ใช้ AI ช่วยตอบคำถามและเชื่อมงานขาย โดยไม่ใช้ข้อมูลร้านจริง" : "Explore how BMS POS+ uses AI to answer questions and connect sales workflows without using real shop data." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
