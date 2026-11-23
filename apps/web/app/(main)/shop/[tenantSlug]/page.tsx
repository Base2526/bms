import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicShop, listPublicProducts } from "@/lib/bms/products";
import ShopLandingView from "./ShopLandingView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ tenantSlug: string }> };

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const shop = await getPublicShop(params.tenantSlug);
  if (!shop) {
    const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
    return { title: lang === "en" ? "Shop not found" : "ไม่พบร้าน", robots: { index: false, follow: false } };
  }

  return {
    title: `${shop.name} — Shop`,
    description: `Public shop page for ${shop.name}`,
    alternates: { canonical: `/shop/${encodeURIComponent(shop.slug)}` },
  };
}

export default async function PublicShopLandingPage(props: PageProps) {
  const params = await props.params;
  const shop = await getPublicShop(params.tenantSlug);
  if (!shop) notFound();

  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const products = await listPublicProducts(shop.slug, { limit: 6 });

  return <ShopLandingView lang={lang} shop={shop} products={products} />;
}
