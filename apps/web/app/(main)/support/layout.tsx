import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/support", locale,
    title: locale === "th" ? "ติดต่อทีม BMS" : "Contact BMS support",
    description: locale === "th" ? "ช่องทางติดต่อทีม BMS สำหรับคำถามการใช้งาน ปัญหาหน้างาน และข้อมูลที่ต้องการให้ทีมตรวจสอบ" : "Contact BMS for product questions, operational issues and cases that need team review." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
