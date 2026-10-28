import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { businessTrackIds, categoryLabels, localize, specialistTrackIds, tracks, type Lesson, type TrackFormat, type TrackId } from "@/lib/learning/catalog";
import s from "./learning.module.css";

export function learningLang(): "th" | "en" { return cookies().get("lang")?.value === "en" ? "en" : "th"; }
export function learningMetadata(title: string, description: string, path: string): Metadata {
  return { title: `${title} | BMS`, description, alternates: { canonical: path },
    openGraph: { title, description, url: path, type: "website", siteName: "BMS" },
    twitter: { card: "summary", title, description } };
}
export function Sidebar({ lang, track }: { lang: "th" | "en"; track?: TrackId }) {
  return <nav className={s.sidebar} aria-label={lang === "th" ? "หมวดคู่มือ" : "Guide categories"}>
    <h2>{lang === "th" ? "เลือกคู่มือ" : "Explore"}</h2>
    <Link href="/learn" aria-current={!track ? "page" : undefined}>{lang === "th" ? "ศูนย์เรียนรู้" : "Learning center"}</Link>
    {businessTrackIds.map((id) => <Link key={id} href={`/learn/${id}`} aria-current={track === id ? "page" : undefined}>{tracks[id].icon} {localize(tracks[id].title, lang)}</Link>)}
    <hr />
    <h2>{lang === "th" ? "คู่มือเฉพาะงาน" : "Specialist guides"}</h2>
    {specialistTrackIds.map((id) => <Link key={id} href={`/learn/${id}`} aria-current={track === id ? "page" : undefined}>{tracks[id].icon} {localize(tracks[id].title, lang)}</Link>)}
    <hr />
    <Link href="/learn/guides/pos-devices">{lang === "th" ? "POS และอุปกรณ์" : "POS & hardware"}</Link>
    <Link href="/learn/guides/line-ai-booking">LINE OA + AI</Link>
    <Link href="/learn/guides/outages-support">{lang === "th" ? "แก้ปัญหาหน้างาน" : "Troubleshooting"}</Link>
    <Link href="/learn/guides/launch-checklist">{lang === "th" ? "Checklist ก่อนเปิดจริง" : "Launch checklist"}</Link>
  </nav>;
}
export function LessonCard({ lesson, lang, track, format }: { lesson: Lesson; lang: "th" | "en"; track?: TrackId; format?: TrackFormat }) {
  return <Link className={s.card} href={`/learn/guides/${lesson.slug}${track ? `?track=${track}${format ? `&format=${format}` : ""}` : ""}`}>
    <span className={s.tag}>{localize(categoryLabels[lesson.category], lang)}</span>
    <h3>{localize(lesson.title, lang)}</h3><p>{localize(lesson.summary, lang)}</p>
    <span className={s.arrow}>{lang === "th" ? "อ่านขั้นตอน" : "Read steps"} →</span>
  </Link>;
}
