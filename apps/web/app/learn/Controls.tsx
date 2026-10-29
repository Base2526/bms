"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { setLangCookie } from "@/lib/lang";
import { localize, type Lesson, type TrackFormat, type TrackId } from "@/lib/learning/catalog";
import s from "./learning.module.css";
import { localizedPublicPath, localeFromPublicPath, stripPublicLocale } from "@/lib/publicSeo";

type Lang = "th" | "en";
export function MobileNavigation({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [pathname, lang]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target)) ref.current.open = false;
    };
    const desktop = window.matchMedia("(min-width: 851px)");
    const closeOnDesktop = () => { if (desktop.matches && ref.current) ref.current.open = false; };
    document.addEventListener("pointerdown", closeOutside);
    desktop.addEventListener("change", closeOnDesktop);
    return () => { document.removeEventListener("pointerdown", closeOutside); desktop.removeEventListener("change", closeOnDesktop); };
  }, []);
  return <details ref={ref} className={s.mobileMenu} onKeyDown={(event) => {
    if (event.key === "Escape" && ref.current?.open) {
      ref.current.open = false; ref.current.querySelector("summary")?.focus(); event.preventDefault();
    }
  }} onClick={(event) => {
    if (event.target instanceof Element && event.target.closest("a,button") && ref.current) ref.current.open = false;
  }}>
    <summary><span aria-hidden="true">☰</span> {lang === "th" ? "เมนู" : "Menu"}</summary>
    {children}
  </details>;
}

const STORAGE_KEY = "bms.learning.read.v1";
function readCompleted(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 200) : [];
  } catch { return []; }
}
function writeCompleted(value: string[]): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); return true; } catch { return false; }
}

export function LanguageControl({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname() || "/learn";
  return <button className={s.secondary} type="button" aria-label={lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
    onClick={() => {
      const nextLang = lang === "th" ? "en" : "th";
      setLangCookie(nextLang);
      if (localeFromPublicPath(pathname)) {
        const nextPath = localizedPublicPath(stripPublicLocale(pathname), nextLang);
        window.location.assign(`${nextPath}${window.location.search}${window.location.hash}`);
      } else {
        router.refresh();
      }
    }}>
    {lang === "th" ? "EN" : "ไทย"}
  </button>;
}

export function StoreLink({ lang, action }: { lang: Lang; action?: string }) {
  const { admin, loading, error } = useSession();
  if (loading) return <span className={s.disabled}>{lang === "th" ? "กำลังตรวจบัญชี…" : "Checking account…"}</span>;
  const signedIn = Boolean(admin);
  // Authentication and permission are rechecked by the destination. This is navigation only.
  const href = signedIn ? action || "/admin/dashboard" : action ? "/admin/login" : error ? "/admin/login" : "/shop-signup";
  const label = signedIn
    ? (lang === "th" ? action ? "เปิดหน้าทำรายการ" : "จัดการร้านของฉัน" : action ? "Open workspace" : "Manage my shop")
    : (lang === "th" ? action || error ? "เข้าสู่ระบบเพื่อทำตาม" : "เริ่มใช้ฟรี" : action || error ? "Sign in to follow along" : "Start free");
  return <Link href={href} className={s.button}>{label} →</Link>;
}

export function ArticleTools({ slug, lang }: { slug: string; lang: Lang }) {
  const [completed, setCompleted] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => { setCompleted(readCompleted().includes(slug)); setNotice(""); setStorageError(false); }, [slug]);
  function toggle() {
    const current = readCompleted();
    const alreadyRead = storageError ? completed : current.includes(slug);
    const next = alreadyRead ? current.filter((id) => id !== slug) : [...current, slug];
    const saved = writeCompleted(next);
    setStorageError(!saved);
    setCompleted(next.includes(slug));
    setNotice(saved ? (lang === "th" ? "บันทึกบนเบราว์เซอร์นี้แล้ว" : "Saved in this browser") : (lang === "th" ? "เก็บได้เฉพาะหน้านี้: เบราว์เซอร์ไม่อนุญาตให้บันทึก" : "Session only: browser storage is unavailable"));
  }
  return <div className={s.noPrint}>
    <div className={s.toolbar}>
      <button className={s.secondary} type="button" aria-pressed={completed} onClick={toggle}>{lang === "th" ? completed ? "✓ อ่านแล้ว" : "ทำเครื่องหมายว่าอ่านแล้ว" : completed ? "✓ Read" : "Mark as read"}</button>
      <button className={s.secondary} type="button" onClick={() => window.print()}>{lang === "th" ? "พิมพ์บทเรียน" : "Print lesson"}</button>
      <button className={s.secondary} type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(window.location.href); setNotice(lang === "th" ? "คัดลอกลิงก์แล้ว" : "Link copied"); }
        catch { setNotice(lang === "th" ? "คัดลอกจากแถบที่อยู่ของเบราว์เซอร์ได้เลย" : "Copy the address from your browser's address bar"); }
      }}>{lang === "th" ? "คัดลอกลิงก์" : "Copy link"}</button>
    </div>
    <div className={s.status} role="status">{notice}</div>
  </div>;
}

export function ReadingChecklist({ items, track, format, lang }: { items: Pick<Lesson, "slug" | "title">[]; track: TrackId; format?: TrackFormat; lang: Lang }) {
  const [done, setDone] = useState<string[]>([]);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => { setDone(readCompleted()); }, []);
  const count = items.filter((item) => done.includes(item.slug)).length;
  return <section className={s.callout} aria-label={lang === "th" ? "ความคืบหน้าการอ่าน" : "Reading progress"}>
    <h2>{lang === "th" ? "เส้นทางเรียนรู้ของคุณ" : "Your learning path"}</h2>
    <p className={s.muted}>{lang === "th" ? "บันทึกเฉพาะการอ่านบนเบราว์เซอร์นี้ ไม่ใช่สถานะตั้งค่าร้านจริง" : "Reading progress is stored in this browser, not your shop's actual setup status."}</p>
    <p role="status">{count} / {items.length} {lang === "th" ? "บทที่อ่านแล้ว" : "lessons read"}</p>
    <progress className={s.progress} value={count} max={items.length} aria-label={lang === "th" ? "บทที่อ่านแล้ว" : "Lessons read"} />
    <ul className={s.checklist}>{items.map((item) => <li key={item.slug}>
      <label><input type="checkbox" checked={done.includes(item.slug)} onChange={() => {
        const current = storageError ? done : readCompleted();
        const next = current.includes(item.slug) ? current.filter((id) => id !== item.slug) : [...current, item.slug];
        setStorageError(!writeCompleted(next)); setDone(next);
      }} /><span>{localize(item.title, lang)}</span></label>
      <div className={s.checklistLinks}><Link href={localizedPublicPath(`/learn/guides/${item.slug}?track=${track}${format ? `&format=${format}` : ""}`, lang)}>{lang === "th" ? "อ่านบทเรียน →" : "Read lesson →"}</Link></div>
    </li>)}</ul>
    {storageError && <p role="status">{lang === "th" ? "เบราว์เซอร์ไม่อนุญาตให้บันทึก ความคืบหน้าจะหายเมื่อออกจากหน้านี้" : "Browser storage is unavailable; progress will be lost when you leave."}</p>}
  </section>;
}
