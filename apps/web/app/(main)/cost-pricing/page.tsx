import type { Metadata } from "next";
import { cookies } from "next/headers";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { costCopy } from "@/components/marketing/cost-pricing/content";
import CostPricingPage from "@/components/marketing/cost-pricing/CostPricingPage";

export function generateMetadata(): Metadata {
  const copy = resolveBilingual(costCopy, cookies().get("lang")?.value === "en" ? "en" : "th");
  return { title: copy.title, description: copy.description, alternates: { canonical: "/cost-pricing" },
    openGraph: { title: copy.title, description: copy.description, url: "/cost-pricing", type: "website" } };
}
export default function Page() { return <CostPricingPage />; }
