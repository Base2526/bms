import dynamic from "next/dynamic";
import { cookies } from "next/headers";
import { localizedPublicPath } from "@/lib/publicSeo";
import BrandedNotFound from "@/components/not-found/BrandedNotFound";
import NotFoundActions from "./NotFoundActions";
import styles from "./not-found.module.css";

const HeaderBar = dynamic(() => import("@/components/HeaderBar"), {
  ssr: false,
  loading: () => <div className={styles.headerPlaceholder} />,
});

export default function NotFound() {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  const homePath = localizedPublicPath("/", lang);

  return (
    <>
      <HeaderBar initialLang={lang} isMobile={false} />
      <main className={styles.page}>
        <BrandedNotFound
          id="page-not-found-title"
          eyebrow={lang === "en" ? "This link is unavailable · 404" : "ลิงก์นี้ไม่พร้อมให้เข้าชม · 404"}
          title={lang === "en" ? "The page is missing, but you can keep going" : "ไม่พบหน้านี้ แต่ยังไปต่อได้"}
          description={lang === "en"
            ? "The address may be incorrect or the page may have moved. Choose where to continue."
            : "ลิงก์อาจไม่ถูกต้องหรือหน้านี้ถูกย้าย เลือกทางไปต่อด้านล่างได้เลย"}
          actions={<NotFoundActions lang={lang} homePath={homePath} />}
        />
      </main>
    </>
  );
}
