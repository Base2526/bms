import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/privacy", locale,
    title: locale === "th" ? "นโยบายความเป็นส่วนตัว BMS" : "BMS privacy policy",
    description: locale === "th" ? "นโยบายการเก็บ ใช้ ปกป้อง และจัดการข้อมูลส่วนบุคคลของ BMS" : "How BMS collects, uses, protects and manages personal information." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
