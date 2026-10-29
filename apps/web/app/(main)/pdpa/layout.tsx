import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/pdpa", locale,
    title: locale === "th" ? "สิทธิข้อมูลส่วนบุคคลและ PDPA" : "Personal data rights and PDPA",
    description: locale === "th" ? "ข้อมูลเกี่ยวกับสิทธิของเจ้าของข้อมูลและแนวทางยื่นคำขอด้านข้อมูลส่วนบุคคลกับ BMS" : "Information about data-subject rights and how to submit a personal-data request to BMS." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
