"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PublicProduct, PublicProductCard } from "@/lib/bms/products";
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

function formatUpdatedAt(value: string | null, lang: "th" | "en") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return value;
  }
}

export default function PublicProductView({
  data,
  related,
  lang,
}: {
  data: PublicProduct;
  related: PublicProductCard[];
  lang: "th" | "en";
}) {
  const { shop, product } = data;
  const [selectedImage, setSelectedImage] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const website = useMemo(() => safeWebsite(shop.website), [shop.website]);
  const phoneHref = shop.phone ? `tel:${shop.phone.replace(/[^+\d]/g, "")}` : null;
  const totalAvailable = product.variants.reduce((sum, variant) => sum + variant.available, 0);
  const updatedLabel = formatUpdatedAt(product.updatedAt, lang);
  const copy = lang === "en"
    ? {
        sku: "SKU",
        available: "In stock",
        out: "Out of stock",
        choose: "Available sizes",
        units: "left",
        details: "Product details",
        updated: "Stock shown when this page was loaded",
        orderAction: "Order via chat",
        copyLink: "Copy link",
        website: "Visit store website",
        call: "Call store",
        ask: "To place an order, please return to the chat where you received this link.",
        noImage: "No product image",
        manyImages: "More photos",
        latestStock: "Latest stock update",
        imageCount: "images",
        summaryTitle: "Quick summary",
        category: "Category",
        brand: "Brand",
        related: "Related products",
        orderHint: "Use the chat where you received this link to confirm the exact size and quantity you want.",
        availableNow: "Ready to ship",
        openProduct: "View product",
        copied: "Link copied",
        copyFailed: "Copy failed",
        imageLabel: "View image",
      }
    : {
        sku: "SKU",
        available: "มีสินค้า",
        out: "สินค้าหมด",
        choose: "ไซซ์และสต็อกที่พร้อมขาย",
        units: "ชิ้น",
        details: "รายละเอียดสินค้า",
        updated: "ข้อมูลสต็อก ณ เวลาที่เปิดหน้านี้",
        orderAction: "สั่งซื้อผ่านแชท",
        copyLink: "คัดลอกลิงก์",
        website: "เยี่ยมชมเว็บไซต์ร้าน",
        call: "โทรหาร้าน",
        ask: "หากต้องการสั่งซื้อ กรุณากลับไปยังแชทที่ได้รับลิงก์นี้",
        noImage: "ยังไม่มีรูปสินค้า",
        manyImages: "มีหลายรูป",
        latestStock: "อัปเดตสต็อกล่าสุด",
        imageCount: "รูป",
        summaryTitle: "สรุปข้อมูลสินค้า",
        category: "หมวดหมู่",
        brand: "แบรนด์",
        related: "สินค้าที่เกี่ยวข้อง",
        orderHint: "ใช้แชทเดิมที่ได้รับลิงก์นี้เพื่อยืนยันไซซ์ จำนวน และปิดการขายต่อได้ทันที",
        availableNow: "พร้อมส่ง",
        openProduct: "ดูสินค้า",
        copied: "คัดลอกลิงก์แล้ว",
        copyFailed: "คัดลอกลิงก์ไม่สำเร็จ",
        imageLabel: "ดูรูป",
      };

  const handleCopyLink = async () => {
    const value = window.location.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        setCopyState("copied");
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.opacity = "0";
        textarea.setAttribute("readonly", "");
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopyState(ok ? "copied" : "error");
      }
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2200);
  };

  return (
    <article className={styles.page}>
      <header className={styles.shopHeader}>
        <div className={styles.shopIdentity}>
          {shop.logoUrl
            ? <img className={styles.logo} src={shop.logoUrl} alt={shop.name} />
            : <div className={styles.logoFallback}>{shop.name.slice(0, 1).toUpperCase()}</div>}
          <div className={styles.shopMeta}>
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
              <>
                <img className={styles.mainImage} src={product.images[selectedImage]} alt={`${product.name} ${selectedImage + 1}`} />
                {product.images.length > 1 && (
                  <div className={styles.imageCount}>
                    {selectedImage + 1} / {product.images.length}
                  </div>
                )}
              </>
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
                  aria-label={`${copy.imageLabel} ${index + 1}`}
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

          <div className={styles.skuRow}>
            <span className={styles.sku}>{copy.sku}: {product.sku}</span>
          </div>

          <div className={styles.price}>{formatPrice(product.price, shop.currency, lang)}</div>

          <div className={styles.actionRow}>
            <a className={styles.primaryAction} href="#order-note">{copy.orderAction}</a>
            <button type="button" className={styles.secondaryAction} onClick={handleCopyLink}>
              {copy.copyLink}
            </button>
          </div>

          <div className={styles.copyStatus} aria-live="polite">
            {copyState === "copied" ? copy.copied : copyState === "error" ? copy.copyFailed : "\u00a0"}
          </div>

          <div className={styles.trustStrip}>
            <div className={styles.trustItem}>
              <strong>{copy.availableNow}</strong>
              <span>{totalAvailable > 0 ? `${totalAvailable} ${copy.units}` : copy.out}</span>
            </div>
            <div className={styles.trustItem}>
              <strong>{copy.manyImages}</strong>
              <span>{product.images.length} {copy.imageCount}</span>
            </div>
            <div className={styles.trustItem}>
              <strong>{copy.latestStock}</strong>
              <span>{updatedLabel || copy.updated}</span>
            </div>
          </div>

          <div className={styles.divider} />
          <h2 className={styles.sectionTitle}>{copy.choose}</h2>
          {product.variants.length ? (
            <div className={styles.variants}>
              {product.variants.map((variant) => (
                <div key={variant.size} className={`${styles.variant} ${variant.available <= 0 ? styles.variantUnavailable : ""}`}>
                  <div className={styles.variantTop}>
                    <strong>{variant.size}</strong>
                    <span className={styles.variantStatus}>{variant.available > 0 ? copy.availableNow : copy.out}</span>
                  </div>
                  <span className={styles.variantCount}>
                    {variant.available > 0 ? `${variant.available} ${copy.units}` : copy.out}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className={styles.muted}>{copy.out}</p>}

          <div className={styles.summaryCard}>
            <div className={styles.summaryBody}>
              {product.description && (
                <div>
                  <h2 className={styles.sectionTitle}>{copy.details}</h2>
                  <p className={styles.description}>{product.description}</p>
                </div>
              )}
              <div>
                <h2 className={styles.sectionTitle}>{copy.summaryTitle}</h2>
                <dl className={styles.summaryList}>
                  <div>
                    <dt>{copy.category}</dt>
                    <dd>{product.category || "-"}</dd>
                  </div>
                  <div>
                    <dt>{copy.brand}</dt>
                    <dd>{product.brand || "-"}</dd>
                  </div>
                  <div>
                    <dt>{copy.sku}</dt>
                    <dd>{product.sku}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className={styles.shopActionRow}>
            {website && <a className={styles.linkPill} href={website} target="_blank" rel="noreferrer">{copy.website} ↗</a>}
            {phoneHref && <a className={styles.linkPill} href={phoneHref}>{copy.call}</a>}
          </div>

          <div className={styles.orderNote} id="order-note">
            <strong>{copy.ask}</strong>
            <span>{copy.orderHint}</span>
          </div>
          <p className={styles.updated}>{copy.updated}</p>
        </section>
      </div>

      {related.length > 0 && (
        <section className={styles.relatedSection} aria-label={copy.related}>
          <h2 className={styles.relatedTitle}>{copy.related}</h2>
          <div className={styles.relatedGrid}>
            {related.map((item) => (
              <Link
                key={item.sku}
                href={`/shop/${encodeURIComponent(shop.slug)}/products/${encodeURIComponent(item.sku)}`}
                className={styles.relatedCard}
              >
                <div className={styles.relatedImageWrap}>
                  {item.imageUrl ? <img className={styles.relatedImage} src={item.imageUrl} alt={item.name} /> : <div className={styles.relatedPlaceholder}>▧</div>}
                </div>
                <div className={styles.relatedCardName}>{item.name}</div>
                <div className={styles.relatedCardPrice}>{formatPrice(item.price, shop.currency, lang)}</div>
                <div className={styles.relatedCardStock}>
                  {item.available > 0 ? `${copy.availableNow}` : copy.out}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
