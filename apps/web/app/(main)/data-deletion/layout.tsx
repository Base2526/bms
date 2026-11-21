import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/data-deletion", locale,
    title: locale === "th" ? "ขอลบข้อมูลจาก BMS POS+" : "Request data deletion from BMS POS+",
    description: locale === "th" ? "ขั้นตอนและข้อมูลที่จำเป็นสำหรับยื่นคำขอลบข้อมูลส่วนบุคคลจาก BMS POS+" : "Steps and information required to request deletion of personal data from BMS POS+." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
