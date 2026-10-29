import type { Metadata } from "next";
import { cookies } from "next/headers";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { restaurantCopy } from "@/components/marketing/restaurant/content";
import RestaurantGuide from "@/components/marketing/restaurant/RestaurantGuide";
import StructuredData from "@/components/seo/StructuredData";
import { publicAlternates, localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";
import { breadcrumbJsonLd } from "@/lib/seoJsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const lang: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  const content = resolveBilingual(restaurantCopy, lang);
  return {
    title: content.title,
    description: content.metaDescription,
    alternates: publicAlternates("/restaurant", lang),
    openGraph: { title: content.title, description: content.metaDescription, url: localizedPublicPath("/restaurant", lang), type: "website", locale: lang === "th" ? "th_TH" : "en_US", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: content.title, description: content.metaDescription, images: ["/og.png"] },
  };
}

export default function RestaurantPage() {
  const lang: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  return <>
    <StructuredData id="restaurant-breadcrumb-jsonld" data={breadcrumbJsonLd(lang, [
      { name: lang === "th" ? "หน้าหลัก" : "Home", path: "/" },
      { name: lang === "th" ? "ร้านอาหารและคาเฟ่" : "Restaurants & cafes", path: "/restaurant" },
    ])} />
    <RestaurantGuide />
  </>;
}
