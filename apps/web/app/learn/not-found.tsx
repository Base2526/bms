import Link from "next/link";
import { learningLang } from "./shared";
import s from "./learning.module.css";
import { localizedPublicPath } from "@/lib/publicSeo";
export default function NotFound() {
  const lang = learningLang(); const th = lang === "th";
  return <section className={s.hero}><h1>{th ? "ไม่พบบทเรียนนี้" : "Lesson not found"}</h1><p>{th ? "ลิงก์อาจเปลี่ยน ลองค้นหาจากศูนย์เรียนรู้" : "The link may have changed. Search from the learning center."}</p><Link href={localizedPublicPath("/learn", lang)} className={s.button}>{th ? "กลับศูนย์เรียนรู้" : "Back to learning center"}</Link></section>;
}
