import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicShop } from "@/lib/bms/products";
import CartView from "./CartView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RetailCartPage({ params }: { params: { tenantSlug: string } }) {
  const shop = await getPublicShop(params.tenantSlug);
  if (!shop?.retailCartEnabled) notFound();
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return <CartView slug={shop.slug} shopName={shop.name} currency={shop.currency} lang={lang} />;
}
