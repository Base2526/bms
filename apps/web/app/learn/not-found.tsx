import Link from "next/link";
import { learningLang } from "./shared";
import s from "./learning.module.css";
export default function NotFound() {
  const th = learningLang() === "th";
  return <section className={s.hero}><h1>{th ? "ไม่พบบทเรียนนี้" : "Lesson not found"}</h1><p>{th ? "ลิงก์อาจเปลี่ยน ลองค้นหาจากศูนย์เรียนรู้" : "The link may have changed. Search from the learning center."}</p><Link href="/learn" className={s.button}>{th ? "กลับศูนย์เรียนรู้" : "Back to learning center"}</Link></section>;
}
