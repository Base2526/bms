import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export async function generateMetadata() {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/open-source", locale,
    title: locale === "th" ? "ซอฟต์แวร์โอเพนซอร์สที่ BMS POS+ ใช้" : "Open-source software used by BMS POS+",
    description: locale === "th" ? "รายการซอฟต์แวร์โอเพนซอร์สและข้อมูลใบอนุญาตที่เกี่ยวข้องกับ BMS POS+" : "Open-source software and related licence information used by BMS POS+." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
