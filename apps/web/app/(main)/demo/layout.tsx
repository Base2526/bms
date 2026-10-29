import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/demo", locale,
    title: locale === "th" ? "ทดลองคุยกับ BMS AI" : "Try the BMS AI demo",
    description: locale === "th" ? "ทดลองดูแนวทางที่ BMS ใช้ AI ช่วยตอบคำถามและเชื่อมงานขาย โดยไม่ใช้ข้อมูลร้านจริง" : "Explore how BMS uses AI to answer questions and connect sales workflows without using real shop data." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
