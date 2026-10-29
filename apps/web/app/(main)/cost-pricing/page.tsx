import type { Metadata } from "next";
import { cookies } from "next/headers";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { costCopy } from "@/components/marketing/cost-pricing/content";
import CostPricingPage from "@/components/marketing/cost-pricing/CostPricingPage";
import StructuredData from "@/components/seo/StructuredData";
import { publicAlternates, localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";
import { breadcrumbJsonLd } from "@/lib/seoJsonLd";

export function generateMetadata(): Metadata {
  const lang: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  const copy = resolveBilingual(costCopy, lang);
  return { title: copy.title, description: copy.description, alternates: publicAlternates("/cost-pricing", lang),
    openGraph: { title: copy.title, description: copy.description, url: localizedPublicPath("/cost-pricing", lang), type: "website", locale: lang === "th" ? "th_TH" : "en_US", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description, images: ["/og.png"] } };
}
export default function Page() {
  const lang: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return <>
    <StructuredData id="cost-pricing-breadcrumb-jsonld" data={breadcrumbJsonLd(lang, [
      { name: lang === "th" ? "หน้าหลัก" : "Home", path: "/" },
      { name: lang === "th" ? "ต้นทุนและราคาขาย" : "Cost & pricing", path: "/cost-pricing" },
    ])} />
    <CostPricingPage />
  </>;
}
