import Link from "next/link";
import { cookies } from "next/headers";
import { localizedPublicPath } from "@/lib/publicSeo";
import NotFoundActions from "./NotFoundActions";
import styles from "./not-found.module.css";

export default function NotFound() {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  const homePath = localizedPublicPath("/", lang);

  return (
    <main className={styles.page}>
      <Link href={homePath} className={styles.brand} aria-label={lang === "en" ? "BMS home" : "หน้าแรก BMS"}>
        <span className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>BMS</span>
      </Link>

      <section className={styles.card} aria-labelledby="page-not-found-title">
        <span className={styles.code}>404</span>
        <h1 id="page-not-found-title" className={styles.title}>
          {lang === "en" ? "We couldn't find this page" : "ไม่พบหน้าที่ต้องการ"}
        </h1>
        <p className={styles.description}>
          {lang === "en"
            ? "Check the link or choose where to continue."
            : "ลองตรวจสอบลิงก์อีกครั้ง หรือเลือกหน้าที่ต้องการไปต่อ"}
        </p>
        <NotFoundActions lang={lang} homePath={homePath} />
      </section>
    </main>
  );
}
