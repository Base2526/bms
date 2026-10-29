import { cookies } from "next/headers";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";

export function generateMetadata() {
  const locale: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/terms", locale,
    title: locale === "th" ? "ข้อกำหนดการใช้บริการ BMS" : "BMS terms of service",
    description: locale === "th" ? "ข้อกำหนดและเงื่อนไขสำหรับการเข้าใช้เว็บไซต์และบริการ BMS" : "Terms and conditions for accessing the BMS website and services." });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
