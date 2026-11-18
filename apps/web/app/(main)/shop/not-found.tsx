import Link from "next/link";
import { cookies } from "next/headers";
import { localizedPublicPath } from "@/lib/publicSeo";
import MissingShopBreadcrumb from "./MissingShopBreadcrumb";
import styles from "./shop-not-found.module.css";

export default async function ShopNotFound() {
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  const copy = lang === "en"
    ? {
        eyebrow: "Shop · 404",
        title: "We couldn't find this page",
        description: "The shop or product link may have changed. Browse the public shops to find what is available now.",
        shops: "Browse shops",
        home: "Back to home",
      }
    : {
        eyebrow: "Shop · 404",
        title: "ไม่พบหน้าที่ต้องการ",
        description: "ลิงก์หน้าร้านหรือสินค้าอาจเปลี่ยนไป ลองกลับไปเลือกร้านที่เปิดให้เข้าชมอยู่ตอนนี้",
        shops: "ดูร้านค้าทั้งหมด",
        home: "กลับหน้าหลัก",
      };

  return (
    <section className={styles.missingPage} aria-labelledby="shop-not-found-title">
      <MissingShopBreadcrumb lang={lang} />
      <div className={styles.content}>
        <div className={styles.symbol} aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none">
            <path d="M12 28h40v27H12V28Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            <path d="M8 28 15 11h34l7 17c0 5-4 9-9 9s-8-4-8-9c0 5-3 9-8 9s-8-4-8-9c0 5-3 9-8 9s-7-4-7-9Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            <path d="M25 55V43h14v12" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          </svg>
        </div>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 id="shop-not-found-title" className={styles.title}>{copy.title}</h1>
        <p className={styles.description}>{copy.description}</p>
        <div className={styles.actions}>
          <Link href="/shop" className={styles.primaryAction}>{copy.shops}</Link>
          <Link href={localizedPublicPath("/", lang)} className={styles.secondaryAction}>{copy.home}</Link>
        </div>
      </div>
    </section>
  );
}
