"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PublicProductCard as PublicProductCardData } from "@/lib/bms/products";
import styles from "./public-shop.module.css";

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

function formatPriceRange(min: number, max: number, currency: string, lang: "th" | "en") {
  return max > min
    ? `${formatPrice(min, currency, lang)} - ${formatPrice(max, currency, lang)}`
    : formatPrice(min, currency, lang);
}

export default function PublicProductCard({
  ctaLabel,
  currency,
  eyebrow,
  href,
  lang,
  product,
  stockLabel,
}: {
  ctaLabel?: string;
  currency: string;
  eyebrow?: string | null;
  href: string;
  lang: "th" | "en";
  product: PublicProductCardData;
  stockLabel: string;
}) {
  const images = useMemo(() => {
    const picked = Array.isArray(product.images) ? product.images : [];
    if (picked.length > 0) return picked;
    return product.imageUrl ? [product.imageUrl] : [];
  }, [product.imageUrl, product.images]);
  const [selectedImage, setSelectedImage] = useState(0);
  const activeImage = images[selectedImage] || images[0] || null;

  return (
    <Link href={href} className={styles.card}>
      <div className={styles.imageShell}>
        <div className={styles.imageWrap}>
          {activeImage
            ? <img className={styles.image} src={activeImage} alt={product.name} />
            : <div className={styles.imagePlaceholder}>▧</div>}
        </div>

        {images.length > 1 && (
          <div className={styles.floatingThumbRow} aria-label={lang === "en" ? "More product images" : "รูปสินค้าเพิ่มเติม"}>
            {images.slice(0, 4).map((image, index) => {
              const isActive = index === selectedImage;
              return (
                <button
                  key={`${product.sku}-${index}`}
                  type="button"
                  className={`${styles.floatingThumbButton} ${isActive ? styles.floatingThumbActive : ""}`}
                  aria-label={`${lang === "en" ? "View image" : "ดูรูป"} ${index + 1}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedImage(index);
                  }}
                >
                  <img src={image} alt="" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.productInfo}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h3 className={styles.productName}>{product.name}</h3>
        <div className={styles.price}>{formatPriceRange(product.price, product.maxPrice, currency, lang)}</div>
        <div className={styles.metaText}>SKU: {product.sku}</div>
      </div>

      <div className={styles.tagRow}>
        <span className={styles.tag}>{stockLabel}</span>
      </div>

      {ctaLabel && (
        <div className={styles.ctaRow}>
          <span className={styles.primaryAction}>{ctaLabel}</span>
        </div>
      )}
    </Link>
  );
}
