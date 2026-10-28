import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageControl, MobileNavigation, StoreLink } from "./Controls";
import s from "./learning.module.css";

export const metadata: Metadata = { robots: { index: true, follow: true } };

export default function LearningLayout({ children }: { children: React.ReactNode }) {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  const links = <>
    <Link href="/learn">{lang === "th" ? "คู่มือทั้งหมด" : "All guides"}</Link>
    <Link href="/learn/retail">{lang === "th" ? "ค้าปลีกและค้าส่ง" : "Retail & wholesale"}</Link>
    <Link href="/learn/board-game">{lang === "th" ? "บอร์ดเกม" : "Board games"}</Link>
    <Link href="/learn/restaurant">{lang === "th" ? "ร้านอาหารและคาเฟ่" : "Restaurants & cafes"}</Link>
    <Link href="/learn/pharmacy">{lang === "th" ? "ร้านขายยา" : "Pharmacy"}</Link>
    <Link href="/learn/inventory">{lang === "th" ? "สต็อก" : "Inventory"}</Link>
    <LanguageControl lang={lang} /><StoreLink lang={lang} />
  </>;
  return <div className={s.shell}>
    <a className={s.skip} href="#learning-content">{lang === "th" ? "ข้ามไปเนื้อหา" : "Skip to content"}</a>
    <header className={s.header}>
      <Link href="/" className={s.brand}>BMS <small>{lang === "th" ? "ศูนย์เรียนรู้" : "Learning center"}</small></Link>
      <nav className={`${s.nav} ${s.desktopNav}`} aria-label={lang === "th" ? "เมนูศูนย์เรียนรู้" : "Learning navigation"}>
        {links}
      </nav>
      <MobileNavigation lang={lang}><nav className={s.mobileNav} aria-label={lang === "th" ? "เมนูศูนย์เรียนรู้" : "Learning navigation"}>{links}</nav></MobileNavigation>
    </header>
    <main id="learning-content" className={s.main} data-print-root>{children}</main>
    <footer className={s.footer}>
      <span>BMS · {lang === "th" ? "เรียนรู้ก่อนเริ่ม ใช้ต่อเมื่อเปิดร้าน" : "Learn before signup. Keep learning as you grow."}</span>
      <div className={s.links}><Link href="/support">{lang === "th" ? "ติดต่อทีมงาน" : "Contact support"}</Link><Link href="/help">{lang === "th" ? "คำถามทั่วไป" : "General help"}</Link><Link href="/privacy">{lang === "th" ? "ความเป็นส่วนตัว" : "Privacy"}</Link></div>
    </footer>
  </div>;
}
