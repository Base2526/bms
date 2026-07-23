"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";
import type { PublicShopCard } from "@/lib/bms/products";
import styles from "./public-shop.module.css";

function formatUpdatedAt(value: string | null, lang: "th" | "en") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
      dateStyle: "medium",
    }).format(date);
  } catch {
    return value;
  }
}

export default function ShopDirectoryView({
  lang,
  shops,
}: {
  lang: "th" | "en";
  shops: PublicShopCard[];
}) {
  const { clearOverride, setOverride } = useBreadcrumbsOverride();
  const pathname = "/shop";
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"recommended" | "largest" | "recent" | "az">("recommended");
  const totalProducts = useMemo(() => shops.reduce((sum, shop) => sum + shop.productCount, 0), [shops]);
  const copy = lang === "en"
    ? {
        eyebrow: "Public Shops",
        title: "Browse active public shops",
        subtitle: "Search by shop name, sort quickly, and open a storefront right away.",
        searchPlaceholder: "Search by shop name or @handle",
        productCount: "active products",
        updated: "Updated",
        openShop: "Open shop",
        recommended: "Shops",
        recommendedSubtitle: "Only active public shops are listed here.",
        results: "results",
        shopsLabel: "public shops",
        productsLabel: "active products",
        allShops: "Recommended",
        largest: "Most products",
        recent: "Latest",
        alphabet: "A–Z",
        emptyTitle: "No public shops yet",
        emptyBody: "Once a shop has active products, it will appear here automatically.",
        emptySearch: "No shops matched your search.",
        verified: "Public",
      }
    : {
        eyebrow: "Public Shops",
        title: "เลือกร้านที่เปิดขายอยู่ได้เลย",
        subtitle: "ค้นหาชื่อร้าน จัดเรียงแบบง่าย ๆ แล้วกดเข้าหน้าร้านได้ทันที",
        searchPlaceholder: "ค้นหาร้านค้า เช่น ชื่อร้าน หรือ @username",
        productCount: "สินค้าที่เปิดขาย",
        updated: "อัปเดตล่าสุด",
        openShop: "ดูหน้าร้าน",
        recommended: "ร้านทั้งหมด",
        recommendedSubtitle: "แสดงเฉพาะร้าน public ที่กำลังเปิดขายจริง",
        results: "ผลลัพธ์",
        shopsLabel: "ร้าน public",
        productsLabel: "สินค้าที่เปิดขาย",
        allShops: "แนะนำ",
        largest: "สินค้าเยอะ",
        recent: "ล่าสุด",
        alphabet: "A-Z",
        emptyTitle: "ยังไม่มีร้านที่เปิดขายสาธารณะ",
        emptyBody: "เมื่อร้านมีสินค้าที่เปิดขายอยู่ ร้านนั้นจะปรากฏที่นี่อัตโนมัติ",
        emptySearch: "ไม่พบร้านที่ตรงกับคำค้นหา",
        verified: "Public",
      };

  const filteredShops = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const matched = keyword
      ? shops.filter((shop) => `${shop.name} ${shop.slug}`.toLowerCase().includes(keyword))
      : shops;

    const scored = [...matched];
    if (mode === "largest") {
      scored.sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
    } else if (mode === "recent") {
      scored.sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime || b.productCount - a.productCount;
      });
    } else if (mode === "az") {
      scored.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      scored.sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        const aScore = a.productCount * 100000 + aTime;
        const bScore = b.productCount * 100000 + bTime;
        return bScore - aScore || a.name.localeCompare(b.name);
      });
    }

    return scored;
  }, [mode, search, shops]);

  useEffect(() => {
    setOverride(pathname, [
      { href: "/", isClickable: true, label: lang === "en" ? "Home" : "หน้าแรก" },
      { isClickable: false, isLast: true, label: "Shop" },
    ]);
    return () => clearOverride(pathname);
  }, [clearOverride, lang, pathname, setOverride]);

  return (
    <section className={styles.page}>
      <header className={`${styles.hero} ${styles.directoryHeroSimple}`}>
        <div className={styles.directoryLead}>
          <div className={styles.eyebrow}>{copy.eyebrow}</div>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.subtitle}>{copy.subtitle}</p>
        </div>

        <div className={styles.stats}>
          <span className={styles.statPill}>{shops.length} {copy.shopsLabel}</span>
          <span className={styles.statPill}>{totalProducts} {copy.productsLabel}</span>
        </div>
      </header>

      <div className={styles.directoryToolbar}>
        <label className={styles.searchField}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
          />
        </label>

        <div className={styles.filterPills} role="tablist" aria-label="shop sorting">
          {[
            { key: "recommended", label: copy.allShops },
            { key: "largest", label: copy.largest },
            { key: "recent", label: copy.recent },
            { key: "az", label: copy.alphabet },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.filterPill} ${mode === item.key ? styles.filterPillActive : ""}`}
              onClick={() => setMode(item.key as typeof mode)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filteredShops.length > 0 ? (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>{copy.recommended}</h2>
              <p className={styles.sectionSubtitle}>{copy.recommendedSubtitle}</p>
            </div>
            <div className={styles.sectionCount}>{filteredShops.length} {copy.results}</div>
          </div>

          <div className={styles.directoryGrid}>
            {filteredShops.map((shop) => (
              <Link key={shop.slug} href={`/shop/${encodeURIComponent(shop.slug)}`} className={`${styles.card} ${styles.shopDirectoryCard}`}>
                <div className={styles.shopDirectoryTop}>
                  <div className={styles.shopCardTop}>
                    {shop.logoUrl
                      ? <img className={styles.logo} src={shop.logoUrl} alt={shop.name} />
                      : <div className={styles.logoFallback}>{shop.name.slice(0, 1).toUpperCase()}</div>}
                    <div className={styles.shopMeta}>
                      <h2 className={styles.shopName}>{shop.name}</h2>
                      <div className={styles.shopHandle}>@{shop.slug}</div>
                    </div>
                  </div>
                </div>

                <div className={styles.tagRow}>
                  <span className={styles.verifiedPill}>{copy.verified}</span>
                  <span className={styles.tag}>{shop.productCount} {copy.productCount}</span>
                  {formatUpdatedAt(shop.updatedAt, lang) && (
                    <span className={styles.softTag}>{copy.updated} {formatUpdatedAt(shop.updatedAt, lang)}</span>
                  )}
                </div>

                <div className={styles.ctaRow}>
                  <span className={`${styles.primaryAction} ${styles.fullWidthAction}`}>{copy.openShop}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <h2 className={styles.shopName}>{search.trim() ? copy.emptySearch : copy.emptyTitle}</h2>
          <p>{search.trim() ? copy.emptyBody : copy.emptyBody}</p>
        </div>
      )}
    </section>
  );
}
