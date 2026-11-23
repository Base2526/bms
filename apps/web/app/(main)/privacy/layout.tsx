import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export async function generateMetadata() {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/privacy", locale,
    title: locale === "th" ? "นโยบายความเป็นส่วนตัว BMS POS+" : "BMS POS+ privacy policy",
    description: locale === "th" ? "นโยบายการเก็บ ใช้ ปกป้อง และจัดการข้อมูลส่วนบุคคลของ BMS POS+" : "How BMS POS+ collects, uses, protects and manages personal information." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
