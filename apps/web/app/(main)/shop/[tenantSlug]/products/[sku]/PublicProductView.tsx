"use client";

import { useMemo, useState } from "react";
import type { PublicProduct } from "@/lib/bms/products";
import styles from "./page.module.css";

function safeWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatPrice(price: number, currency: string, lang: "th" | "en") {
  try {
    return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price.toLocaleString(lang === "th" ? "th-TH" : "en-US")} ${currency}`;
  }
}

export default function PublicProductView({ data, lang }: { data: PublicProduct; lang: "th" | "en" }) {
  const { shop, product } = data;
  const [selectedImage, setSelectedImage] = useState(0);
  const website = useMemo(() => safeWebsite(shop.website), [shop.website]);
  const phoneHref = shop.phone ? `tel:${shop.phone.replace(/[^+\d]/g, "")}` : null;
  const totalAvailable = product.variants.reduce((sum, variant) => sum + variant.available, 0);
  const copy = lang === "en" ? {
    sku: "SKU",
    available: "Available",
    out: "Out of stock",
    choose: "Available sizes",
    units: "left",
    details: "Product details",
    updated: "Stock shown when this page was loaded",
    website: "Visit store website",
    call: "Call store",
    ask: "For ordering, return to the chat where you received this link.",
    noImage: "No product image",
  } : {
    sku: "SKU",
    available: "มีสินค้า",
    out: "สินค้าหมด",
    choose: "ไซซ์และสต็อกที่พร้อมขาย",
    units: "ชิ้น",
    details: "รายละเอียดสินค้า",
    updated: "ข้อมูลสต็อก ณ เวลาที่เปิดหน้านี้",
    website: "เยี่ยมชมเว็บไซต์ร้าน",
    call: "โทรหาร้าน",
    ask: "หากต้องการสั่งซื้อ กรุณากลับไปยังแชทที่ได้รับลิงก์นี้",
    noImage: "ยังไม่มีรูปสินค้า",
  };

  return (
    <article className={styles.page}>
      <header className={styles.shopHeader}>
        <div className={styles.shopIdentity}>
          {shop.logoUrl ? <img className={styles.logo} src={shop.logoUrl} alt={shop.name} /> : <div className={styles.logoFallback}>{shop.name.slice(0, 1).toUpperCase()}</div>}
          <div>
            <div className={styles.shopName}>{shop.name}</div>
            <div className={styles.shopHandle}>@{shop.slug}</div>
          </div>
        </div>
        <div className={`${styles.stockBadge} ${totalAvailable > 0 ? styles.inStock : styles.outOfStock}`}>
          {totalAvailable > 0 ? copy.available : copy.out}
        </div>
      </header>

      <div className={styles.productGrid}>
        <section className={styles.gallery} aria-label={lang === "en" ? "Product gallery" : "รูปสินค้า"}>
          <div className={styles.mainImageFrame}>
            {product.images.length ? (
              <img className={styles.mainImage} src={product.images[selectedImage]} alt={`${product.name} ${selectedImage + 1}`} />
            ) : (
              <div className={styles.imagePlaceholder}><span>▧</span>{copy.noImage}</div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className={styles.thumbnails}>
              {product.images.map((image, index) => (
                <button
                  type="button"
                  key={`${image}-${index}`}
                  className={`${styles.thumbnailButton} ${selectedImage === index ? styles.thumbnailSelected : ""}`}
                  onClick={() => setSelectedImage(index)}
                  aria-label={`${lang === "en" ? "View image" : "ดูรูป"} ${index + 1}`}
                >
                  <img src={image} alt="" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.productInfo}>
          <div className={styles.eyebrow}>{[product.brand, product.category].filter(Boolean).join(" · ") || copy.sku}</div>
          <h1 className={styles.productName}>{product.name}</h1>
          <div className={styles.sku}>{copy.sku}: {product.sku}</div>
          <div className={styles.price}>{formatPrice(product.price, shop.currency, lang)}</div>

          <div className={styles.divider} />
          <h2 className={styles.sectionTitle}>{copy.choose}</h2>
          {product.variants.length ? (
            <div className={styles.variants}>
              {product.variants.map((variant) => (
                <div key={variant.size} className={`${styles.variant} ${variant.available <= 0 ? styles.variantUnavailable : ""}`}>
                  <strong>{variant.size}</strong>
                  <span>{variant.available > 0 ? `${variant.available} ${copy.units}` : copy.out}</span>
                </div>
              ))}
            </div>
          ) : <p className={styles.muted}>{copy.out}</p>}

          {product.description && (
            <>
              <div className={styles.divider} />
              <h2 className={styles.sectionTitle}>{copy.details}</h2>
              <p className={styles.description}>{product.description}</p>
            </>
          )}

          <div className={styles.actions}>
            {website && <a className={styles.primaryAction} href={website} target="_blank" rel="noreferrer">{copy.website} ↗</a>}
            {phoneHref && <a className={styles.secondaryAction} href={phoneHref}>{copy.call}</a>}
          </div>
          <p className={styles.chatHint}>{copy.ask}</p>
          <p className={styles.updated}>{copy.updated}</p>
        </section>
      </div>
    </article>
  );
}
