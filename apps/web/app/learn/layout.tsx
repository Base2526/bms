import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { HeaderDropdown, LanguageControl, MobileNavigation, StoreLink } from "./Controls";
import s from "./learning.module.css";
import { localizedPublicPath } from "@/lib/publicSeo";

export default function LearningLayout({ children }: { children: React.ReactNode }) {
  const lang = cookies().get("lang")?.value === "en" ? "en" : "th";
  const businessLinks = [
    { path: "/learn/retail", icon: "🛒", th: "ค้าปลีกและค้าส่ง", en: "Retail & wholesale" },
    { path: "/learn/board-game", icon: "🎲", th: "บอร์ดเกม", en: "Board games" },
    { path: "/learn/restaurant", icon: "🍽️", th: "ร้านอาหารและคาเฟ่", en: "Restaurants & cafes" },
    { path: "/learn/pharmacy", icon: "⚕️", th: "ร้านขายยา", en: "Pharmacy" },
    { path: "/learn/building-materials", icon: "🧱", th: "วัสดุก่อสร้าง (ทดลอง)", en: "Building materials (pilot)" },
  ];
  const specialistLinks = [
    { path: "/learn/inventory", icon: "📦", th: "สต็อกและคลังสินค้า", en: "Inventory & warehouse" },
    { path: "/learn/guides/pos-devices", icon: "▣", th: "POS และอุปกรณ์", en: "POS & hardware" },
    { path: "/learn/guides/line-ai-booking", icon: "◉", th: "LINE OA + AI", en: "LINE OA + AI" },
    { path: "/learn/guides/outages-support", icon: "◇", th: "แก้ปัญหาหน้างาน", en: "Troubleshooting" },
    { path: "/learn/guides/launch-checklist", icon: "✓", th: "Checklist ก่อนเปิดจริง", en: "Launch checklist" },
    { path: "/learn/twenty-baht-shop", icon: "🏷️", th: "ร้าน 20 บาท (ทดลอง)", en: "Twenty-baht shop (pilot)" },
    { path: "/learn/factory-twine-straw", icon: "🏭", th: "โรงงานเชือกและหลอด (ทดลอง)", en: "Twine & straw factory (pilot)" },
  ];
  return <div className={s.shell}>
    <a className={s.skip} href="#learning-content">{lang === "th" ? "ข้ามไปเนื้อหา" : "Skip to content"}</a>
    <header className={s.header}>
      <Link href={localizedPublicPath("/", lang)} className={s.brand}><Image src="/icons/app-icon.svg" alt="" width={36} height={36} priority /><span>BMS</span><small>{lang === "th" ? "ศูนย์เรียนรู้" : "Learning center"}</small></Link>
      <nav className={`${s.nav} ${s.desktopNav}`} aria-label={lang === "th" ? "เมนูศูนย์เรียนรู้" : "Learning navigation"}>
        <Link href={localizedPublicPath("/learn", lang)}>{lang === "th" ? "คู่มือทั้งหมด" : "All guides"}</Link>
        <Link href={localizedPublicPath("/learn/getting-started", lang)}>{lang === "th" ? "เริ่มต้นใช้งาน" : "Getting started"}</Link>
        <HeaderDropdown lang={lang} label={lang === "th" ? "ประเภทร้าน" : "Business types"}>
          <div className={s.dropdownPanel} role="group" aria-label={lang === "th" ? "คู่มือตามประเภทร้าน" : "Business guides"}>
            <strong>{lang === "th" ? "คู่มือตามประเภทร้าน" : "Business guides"}</strong>
            <div className={s.dropdownGrid}>{businessLinks.map((link) => <Link key={link.path} href={localizedPublicPath(link.path, lang)}><span aria-hidden="true">{link.icon}</span>{link[lang]}</Link>)}</div>
          </div>
        </HeaderDropdown>
        <HeaderDropdown lang={lang} label={lang === "th" ? "งานเฉพาะทาง" : "Specialist guides"}>
          <div className={s.dropdownPanel} role="group" aria-label={lang === "th" ? "คู่มือเฉพาะงาน" : "Specialist guides"}>
            <strong>{lang === "th" ? "คู่มือเฉพาะงาน" : "Specialist guides"}</strong>
            <div className={s.dropdownGrid}>{specialistLinks.map((link) => <Link key={link.path} href={localizedPublicPath(link.path, lang)}><span aria-hidden="true">{link.icon}</span>{link[lang]}</Link>)}</div>
          </div>
        </HeaderDropdown>
      </nav>
      <div className={s.headerActions}><LanguageControl lang={lang} /><div className={s.desktopCta}><StoreLink lang={lang} /></div><MobileNavigation lang={lang}>
        <nav className={s.mobileNav} aria-label={lang === "th" ? "เมนูศูนย์เรียนรู้" : "Learning navigation"}>
          <Link href={localizedPublicPath("/learn", lang)}>{lang === "th" ? "คู่มือทั้งหมด" : "All guides"}</Link>
          <Link href={localizedPublicPath("/learn/getting-started", lang)}>{lang === "th" ? "เริ่มต้นใช้งาน" : "Getting started"}</Link>
          <span className={s.mobileGroupTitle}>{lang === "th" ? "คู่มือตามประเภทร้าน" : "Business guides"}</span>
          {businessLinks.map((link) => <Link key={link.path} href={localizedPublicPath(link.path, lang)}>{link[lang]}</Link>)}
          <span className={s.mobileGroupTitle}>{lang === "th" ? "คู่มือเฉพาะงาน" : "Specialist guides"}</span>
          {specialistLinks.map((link) => <Link key={link.path} href={localizedPublicPath(link.path, lang)}>{link[lang]}</Link>)}
          <div className={s.mobileCta}><StoreLink lang={lang} /></div>
        </nav>
      </MobileNavigation></div>
    </header>
    <main id="learning-content" className={s.main} data-print-root>{children}</main>
    <footer className={s.footer}>
      <span>BMS · {lang === "th" ? "เรียนรู้ก่อนเริ่ม ใช้ต่อเมื่อเปิดร้าน" : "Learn before signup. Keep learning as you grow."}</span>
      <div className={s.links}><Link href={localizedPublicPath("/support", lang)}>{lang === "th" ? "ติดต่อทีมงาน" : "Contact support"}</Link><Link href={localizedPublicPath("/help", lang)}>{lang === "th" ? "คำถามทั่วไป" : "General help"}</Link><Link href={localizedPublicPath("/privacy", lang)}>{lang === "th" ? "ความเป็นส่วนตัว" : "Privacy"}</Link></div>
    </footer>
  </div>;
}
