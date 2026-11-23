import { cookies } from "next/headers";
import { getMessage, type Lang } from "@/i18n";
import styles from "./loading.module.css";

// Keep the route fallback independent of Ant styles so it paints before the page bundle.
export default async function AdminLoading() {
  const lang: Lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-label={getMessage(lang, "common.loading_app_label")}>
      <div className={styles.status} aria-hidden="true">
        <span className={styles.spinner} />
        <span>{getMessage(lang, "common.loading_page")}</span>
      </div>
      <div className={styles.content} aria-hidden="true">
        <div className={styles.heading}>
          <span className={`${styles.bar} ${styles.title}`} />
          <span className={`${styles.bar} ${styles.subtitle}`} />
        </div>
        <div className={styles.cards}>
          {[0, 1, 2].map((index) => (
            <div className={styles.card} key={index}>
              <span className={`${styles.bar} ${styles.cardLabel}`} />
              <span className={`${styles.bar} ${styles.cardValue}`} />
            </div>
          ))}
        </div>
        <div className={styles.panel}>
          <span className={`${styles.bar} ${styles.panelTitle}`} />
          {[0, 1, 2, 3].map((index) => (
            <div className={styles.row} key={index}>
              <span className={`${styles.bar} ${styles.rowMain}`} />
              <span className={`${styles.bar} ${styles.rowSide}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
