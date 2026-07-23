"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";
import PublicProductCard from "../PublicProductCard";
import type { PublicProductCard as PublicProductCardData, PublicShop } from "@/lib/bms/products";
import styles from "../public-shop.module.css";

export default function ShopLandingView({
  lang,
  products,
  shop,
}: {
  lang: "th" | "en";
  products: PublicProductCardData[];
  shop: PublicShop;
}) {
  const { clearOverride, setOverride } = useBreadcrumbsOverride();
  const shopPath = `/shop/${encodeURIComponent(shop.slug)}`;
  const productsPath = `${shopPath}/products`;
  const copy = lang === "en"
    ? {
        eyebrow: "Public Shop",
        subtitle: "Browse active products from this shop using public, customer-safe links only.",
        openProducts: "Browse products",
        visitWebsite: "Visit website",
        callStore: "Call store",
        featured: "Featured products",
        viewProduct: "View product",
        viewAll: "View all products",
        productCount: "active products",
        noProductsTitle: "No public products yet",
        noProductsBody: "This shop is active, but it has not published any products yet.",
        available: "Ready to ship",
        out: "Out of stock",
      }
    : {
        eyebrow: "Public Shop",
        subtitle: "ดูสินค้าที่ร้านนี้เปิดขายอยู่ผ่านลิงก์สาธารณะที่ปลอดภัยสำหรับลูกค้าเท่านั้น",
        openProducts: "ดูสินค้าทั้งหมด",
        visitWebsite: "เยี่ยมชมเว็บไซต์ร้าน",
        callStore: "โทรหาร้าน",
        featured: "สินค้าแนะนำ",
        viewProduct: "ดูสินค้า",
        viewAll: "เปิดหน้ารวมสินค้า",
        productCount: "สินค้าที่เปิดขาย",
        noProductsTitle: "ร้านนี้ยังไม่มีสินค้าที่เปิดขายสาธารณะ",
        noProductsBody: "ร้านยังเปิดใช้งานอยู่ แต่ยังไม่ได้เปิดขายสินค้าในหน้าสาธารณะ",
        available: "พร้อมส่ง",
        out: "สินค้าหมด",
      };

  useEffect(() => {
    setOverride(shopPath, [
      { href: "/", isClickable: true, label: lang === "en" ? "Home" : "หน้าแรก" },
      { href: "/shop", isClickable: true, label: "Shop" },
      { isClickable: false, isLast: true, label: shop.name },
    ]);
    return () => clearOverride(shopPath);
  }, [clearOverride, lang, setOverride, shop.name, shopPath]);

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.shopCardTop}>
          {shop.logoUrl
            ? <img className={styles.logo} src={shop.logoUrl} alt={shop.name} />
            : <div className={styles.logoFallback}>{shop.name.slice(0, 1).toUpperCase()}</div>}
          <div className={styles.shopMeta}>
            <div className={styles.eyebrow}>{copy.eyebrow}</div>
            <h1 className={styles.title}>{shop.name}</h1>
            <p className={styles.subtitle}>{copy.subtitle}</p>
          </div>
        </div>

        <div className={styles.stats}>
          <span className={styles.statPill}>{shop.productCount} {copy.productCount}</span>
        </div>

        <div className={styles.ctaRow}>
          <Link href={productsPath} className={styles.primaryAction}>{copy.openProducts}</Link>
          {shop.website && <a href={shop.website} target="_blank" rel="noreferrer" className={styles.secondaryAction}>{copy.visitWebsite}</a>}
          {shop.phone && <a href={`tel:${shop.phone.replace(/[^+\d]/g, "")}`} className={styles.secondaryAction}>{copy.callStore}</a>}
        </div>
      </header>

      {products.length > 0 ? (
        <>
          <div className={styles.shopCardTop} style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2 className={styles.shopName}>{copy.featured}</h2>
            <Link href={productsPath} className={styles.linkPill}>{copy.viewAll}</Link>
          </div>
          <div className={styles.grid}>
            {products.map((product) => (
              <PublicProductCard
                key={product.sku}
                ctaLabel={copy.viewProduct}
                currency={shop.currency}
                href={`${productsPath}/${encodeURIComponent(product.sku)}`}
                lang={lang}
                product={product}
                stockLabel={product.available > 0 ? copy.available : copy.out}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <h2 className={styles.shopName}>{copy.noProductsTitle}</h2>
          <p>{copy.noProductsBody}</p>
        </div>
      )}
    </section>
  );
}
