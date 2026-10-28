import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryLabels, getTrackLessons, isTrack, localize, tracks } from "@/lib/learning/catalog";
import { learningLang, learningMetadata, Sidebar } from "../shared";
import { ReadingChecklist } from "../Controls";
import s from "../learning.module.css";

export function generateMetadata({ params }: { params: { track: string } }) {
  if (!isTrack(params.track)) return {};
  const lang = learningLang(); const track = tracks[params.track];
  return learningMetadata(localize(track.title, lang), localize(track.description, lang), `/learn/${params.track}`);
}
export default function TrackPage({ params }: { params: { track: string } }) {
  if (!isTrack(params.track)) notFound();
  const id = params.track; const track = tracks[id]; const lang = learningLang(); const th = lang === "th";
  const items = getTrackLessons(id);
  return <>
    <nav className={s.breadcrumb} aria-label="Breadcrumb"><Link href="/learn">{th ? "ศูนย์เรียนรู้" : "Learning center"}</Link><span>/</span><span>{localize(track.title, lang)}</span></nav>
    <section className={s.trackHero}><div><span className={s.eyebrow}>{items.length} {th ? "บทเรียน · อ่านได้โดยไม่ต้องสมัคร" : "lessons · No signup needed"}</span><h1>{track.icon} {th ? "คู่มือ" : "Guide:"} {localize(track.title, lang)}</h1><p>{localize(track.description, lang)}</p></div><Link className={s.button} href={`/learn/guides/${items[0].slug}?track=${id}`}>{th ? "เริ่มจากบทแรก" : "Start the first lesson"} →</Link></section>
    <div className={`${s.layout} ${s.trackLayout}`}><Sidebar lang={lang} track={id} /><div className={s.trackContents}>
      {(Object.keys(categoryLabels) as (keyof typeof categoryLabels)[]).map((category) => <section className={s.section} key={category}>
        <h2 className={s.sectionTitle}>{localize(categoryLabels[category], lang)}</h2>
        <ol className={`${s.lessonList} ${s.compactLessons}`}>{items.filter((lesson) => lesson.category === category).map((lesson) => <li key={lesson.slug}>
          <Link className={s.lessonRow} href={`/learn/guides/${lesson.slug}?track=${id}`}><span>{String(items.indexOf(lesson) + 1).padStart(2, "0")}</span><div><h3>{localize(lesson.title, lang)}</h3><p>{localize(lesson.summary, lang)}</p></div></Link>
        </li>)}</ol>
      </section>)}
      <details className={s.readingDetails}><summary>{th ? "Checklist การอ่าน" : "Reading checklist"} · {items.length} {th ? "บทเรียน" : "lessons"}</summary>
        <ReadingChecklist items={items.map(({ slug, title }) => ({ slug, title }))} track={id} lang={lang} />
      </details>
    </div></div>
  </>;
}
