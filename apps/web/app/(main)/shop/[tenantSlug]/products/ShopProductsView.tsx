"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";
import PublicProductCard from "../../PublicProductCard";
import type { PublicProductCard as PublicProductCardData, PublicShop } from "@/lib/bms/products";
import styles from "../../public-shop.module.css";

export default function ShopProductsView({
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
        eyebrow: "Products",
        title: `${shop.name} products`,
        subtitle: "Customer-safe product listing from this shop's active catalog.",
        backToShop: "Back to shop",
        available: "Ready to ship",
        out: "Out of stock",
        emptyTitle: "No public products yet",
        emptyBody: "This shop has not published any active products yet.",
      }
    : {
        eyebrow: "Products",
        title: `สินค้าที่เปิดขายของ ${shop.name}`,
        subtitle: "รายการสินค้าที่ลูกค้าดูได้จาก catalog สาธารณะของร้านนี้",
        backToShop: "กลับไปหน้าร้าน",
        available: "พร้อมส่ง",
        out: "สินค้าหมด",
        emptyTitle: "ร้านนี้ยังไม่มีสินค้าที่เปิดขาย",
        emptyBody: "ยังไม่มีสินค้าที่ active สำหรับหน้า public ของร้านนี้",
      };

  useEffect(() => {
    setOverride(productsPath, [
      { href: "/", isClickable: true, label: lang === "en" ? "Home" : "หน้าแรก" },
      { href: "/shop", isClickable: true, label: "Shop" },
      { href: shopPath, isClickable: true, label: shop.name },
      { isClickable: false, isLast: true, label: "Products" },
    ]);
    return () => clearOverride(productsPath);
  }, [clearOverride, lang, productsPath, setOverride, shop.name, shopPath]);

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>{copy.eyebrow}</div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.subtitle}>{copy.subtitle}</p>
        <div className={styles.ctaRow}>
          <Link href={shopPath} className={styles.secondaryAction}>{copy.backToShop}</Link>
        </div>
      </header>

      {products.length > 0 ? (
        <div className={styles.grid}>
          {products.map((product) => (
            <PublicProductCard
              key={product.sku}
              currency={shop.currency}
              eyebrow={[product.brand, product.category].filter(Boolean).join(" · ") || "SKU"}
              href={`${productsPath}/${encodeURIComponent(product.sku)}`}
              lang={lang}
              product={product}
              stockLabel={product.available > 0 ? copy.available : copy.out}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <h2 className={styles.shopName}>{copy.emptyTitle}</h2>
          <p>{copy.emptyBody}</p>
        </div>
      )}
    </section>
  );
}
