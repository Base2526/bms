import Link from "next/link";
import { localizedPublicPath } from "@/lib/publicSeo";
import BrandedNotFound from "@/components/not-found/BrandedNotFound";
import { learningLang } from "./shared";
import s from "./learning.module.css";

export type LearningNotFoundKind = "generic" | "track" | "lesson";

export default function LearningNotFoundView({ kind }: { kind: LearningNotFoundKind }) {
  const lang = learningLang();
  const copy = {
    generic: lang === "en"
      ? { title: "We couldn't find this guide", description: "The learning link may have changed. Browse the current guides to continue." }
      : { title: "ไม่พบหน้านี้ในศูนย์เรียนรู้", description: "ลิงก์เนื้อหาอาจเปลี่ยนไป ลองดูคู่มือที่เปิดให้อ่านอยู่ตอนนี้" },
    track: lang === "en"
      ? { title: "We couldn't find this topic", description: "This topic is unavailable at this link. Browse the learning center for other topics." }
      : { title: "ไม่พบหมวดนี้", description: "หมวดคู่มือที่ลิงก์นี้ไม่พร้อมให้เข้าชม ลองเลือกหมวดอื่นจากศูนย์เรียนรู้" },
    lesson: lang === "en"
      ? { title: "We couldn't find this lesson", description: "This lesson is unavailable at this link. Browse the current guides to continue." }
      : { title: "ไม่พบบทเรียนนี้", description: "บทเรียนที่ลิงก์นี้ไม่พร้อมให้อ่าน ลองดูคู่มือที่เปิดอยู่ในศูนย์เรียนรู้" },
  }[kind];
  const learningPath = localizedPublicPath("/learn", lang);

  return (
    <>
      <nav className={s.breadcrumb} aria-label="Breadcrumb">
        <Link href={learningPath}>{lang === "en" ? "Learning center" : "ศูนย์เรียนรู้"}</Link>
        <span>/</span>
        <span>{lang === "en" ? "Page not found" : "ไม่พบหน้านี้"}</span>
      </nav>
      <BrandedNotFound
        id="learning-not-found-title"
        eyebrow={lang === "en" ? "LEARNING · 404" : "ศูนย์เรียนรู้ · 404"}
        title={copy.title}
        description={copy.description}
        kind="book"
        primary={{ href: learningPath, label: lang === "en" ? "Browse guides" : "ดูคู่มือทั้งหมด" }}
        secondary={{ href: localizedPublicPath("/", lang), label: lang === "en" ? "Back to home" : "กลับหน้าหลัก" }}
      />
    </>
  );
}
