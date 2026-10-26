import type { Metadata } from "next";
import { cookies } from "next/headers";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { restaurantCopy } from "@/components/marketing/restaurant/content";
import RestaurantGuide from "@/components/marketing/restaurant/RestaurantGuide";

export async function generateMetadata(): Promise<Metadata> {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  const content = resolveBilingual(restaurantCopy, lang);
  return {
    title: content.title,
    description: content.metaDescription,
    alternates: { canonical: "/restaurant" },
    openGraph: { title: content.title, description: content.metaDescription, url: "/restaurant", type: "website" },
    twitter: { card: "summary_large_image", title: content.title, description: content.metaDescription },
  };
}

export default function RestaurantPage() { return <RestaurantGuide />; }
