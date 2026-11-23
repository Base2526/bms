import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export async function generateMetadata() {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/license", locale,
    title: locale === "th" ? "ข้อมูลใบอนุญาต BMS POS+" : "BMS POS+ licence information",
    description: locale === "th" ? "ข้อมูลใบอนุญาตและเงื่อนไขที่เกี่ยวข้องกับซอฟต์แวร์และส่วนประกอบของ BMS POS+" : "Licence information and conditions for BMS POS+ software and components." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
