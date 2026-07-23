import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicProduct, listPublicRelatedProducts } from "@/lib/bms/products";
import PublicProductView from "./PublicProductView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: { tenantSlug: string; sku: string } };

const loadProduct = cache((tenantSlug: string, sku: string) => getPublicProduct(tenantSlug, sku));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const result = await loadProduct(params.tenantSlug, params.sku);
  if (!result) return { title: "ไม่พบสินค้า", robots: { index: false, follow: false } };

  const canonical = `/shop/${encodeURIComponent(result.shop.slug)}/products/${encodeURIComponent(result.product.sku)}`;
  const description = result.product.description || `${result.product.name} จาก ${result.shop.name}`;
  return {
    title: `${result.product.name} — ${result.shop.name}`,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title: result.product.name,
      description,
      url: canonical,
      images: result.product.images[0] ? [{ url: result.product.images[0], alt: result.product.name }] : undefined,
    },
    twitter: {
      card: result.product.images[0] ? "summary_large_image" : "summary",
      title: result.product.name,
      description,
      images: result.product.images[0] ? [result.product.images[0]] : undefined,
    },
  };
}

export default async function PublicProductPage({ params }: PageProps) {
  const result = await loadProduct(params.tenantSlug, params.sku);
  if (!result) notFound();

  const related = await listPublicRelatedProducts(result.shop.slug, result.product.sku, {
    category: result.product.category,
    brand: result.product.brand,
    limit: 3,
  });

  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const available = result.product.variants.some((variant) => variant.available > 0);
  const productUrl = `/shop/${encodeURIComponent(result.shop.slug)}/products/${encodeURIComponent(result.product.sku)}`;
  const publicBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: result.product.name,
    sku: result.product.sku,
    description: result.product.description || undefined,
    brand: result.product.brand ? { "@type": "Brand", name: result.product.brand } : undefined,
    image: result.product.images,
    url: publicBaseUrl ? `${publicBaseUrl}${productUrl}` : productUrl,
    offers: {
      "@type": "Offer",
      price: result.product.price,
      priceCurrency: result.shop.currency,
      availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PublicProductView data={result} related={related} lang={lang} />
    </>
  );
}
