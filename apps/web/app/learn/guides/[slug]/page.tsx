import Link from "next/link";
import { notFound } from "next/navigation";
import { getLesson, getTrackLessons, isTrack, isTrackFormat, LEARNING_REVIEWED_AT, lessonSupportsTrackFormat, localize, roleLabels, tracks } from "@/lib/learning/catalog";
import { ArticleTools, StoreLink } from "../../Controls";
import { learningLang, learningMetadata, LessonCard } from "../../shared";
import s from "../../learning.module.css";
import StructuredData from "@/components/seo/StructuredData";
import { localizedPublicPath } from "@/lib/publicSeo";
import { breadcrumbJsonLd, learningArticleJsonLd } from "@/lib/seoJsonLd";

type Props = { params: { slug: string }; searchParams: { track?: string; format?: string } };
export function generateMetadata({ params }: Props) {
  const lesson = getLesson(params.slug); if (!lesson) return {};
  const lang = learningLang();
  return learningMetadata(localize(lesson.title, lang), localize(lesson.summary, lang), `/learn/guides/${lesson.slug}`, lang);
}
export default function ArticlePage({ params, searchParams }: Props) {
  const lesson = getLesson(params.slug); if (!lesson) notFound();
  const track = typeof searchParams.track === "string" && isTrack(searchParams.track) && lesson.tracks.includes(searchParams.track) ? searchParams.track : lesson.tracks[0];
  const requestedFormat = typeof searchParams.format === "string" && isTrackFormat(track, searchParams.format) ? searchParams.format : undefined;
  const format = requestedFormat && lessonSupportsTrackFormat(lesson, track, requestedFormat) ? requestedFormat : undefined;
  const items = getTrackLessons(track, format); const index = items.findIndex((item) => item.slug === lesson.slug);
  const prev = items[index - 1]; const next = items[index + 1];
  const lang = learningLang(); const th = lang === "th";
  const trackHref = localizedPublicPath(`/learn/${track}${format ? `?format=${format}` : ""}`, lang);
  const lessonHref = (slug: string) => localizedPublicPath(`/learn/guides/${slug}?track=${track}${format ? `&format=${format}` : ""}`, lang);
  const txt = (value: Parameters<typeof localize>[0]) => localize(value, lang);
  const anchors = [["prepare", th ? "ก่อนเริ่ม" : "Before you begin"], ["steps", th ? "ขั้นตอนใช้งาน" : "Steps"], ["verify", th ? "ตรวจผลลัพธ์" : "Verify the result"], ["limits", th ? "ข้อจำกัดและกรณีติดขัด" : "Limits & troubleshooting"]];
  return <>
    <StructuredData id="learning-article-jsonld" data={learningArticleJsonLd({
      locale: lang,
      path: `/learn/guides/${lesson.slug}`,
      title: txt(lesson.title),
      description: txt(lesson.summary),
      reviewedAt: LEARNING_REVIEWED_AT,
    })} />
    <StructuredData id="learning-article-breadcrumb-jsonld" data={breadcrumbJsonLd(lang, [
      { name: th ? "หน้าหลัก" : "Home", path: "/" },
      { name: th ? "ศูนย์เรียนรู้" : "Learning center", path: "/learn" },
      { name: txt(tracks[track].title), path: `/learn/${track}` },
      { name: txt(lesson.title), path: `/learn/guides/${lesson.slug}` },
    ])} />
    <nav className={s.breadcrumb} aria-label="Breadcrumb"><Link href={localizedPublicPath("/learn", lang)}>{th ? "ศูนย์เรียนรู้" : "Learning center"}</Link><span>/</span><Link href={trackHref}>{txt(tracks[track].title)}</Link><span>/</span><span aria-current="page">{th ? "บทที่" : "Lesson"} {index + 1}</span></nav>
    <div className={s.articleLayout}>
      <article className={s.article}>
        <span className={s.eyebrow}>{th ? "บทที่" : "Lesson"} {index + 1} / {items.length}</span>
        <h1>{txt(lesson.title)}</h1><p className={s.lead}>{txt(lesson.summary)}</p>
        <div className={`${s.muted} ${s.articleMeta}`}><span>{th ? "จัดทำโดย " : "Prepared by "}<Link href={localizedPublicPath("/about", lang)}>BMS</Link></span><span>{lesson.roles.map((role) => txt(roleLabels[role])).join(" · ")}</span><span>{th ? "ทบทวนเนื้อหา" : "Content reviewed"} <time dateTime={LEARNING_REVIEWED_AT}>{LEARNING_REVIEWED_AT}</time></span></div>
        <details className={`${s.mobileContents} ${s.noPrint}`}><summary>{th ? "ในบทนี้ · ข้ามไปยังหัวข้อ" : "On this page · Jump to a section"}</summary><nav aria-label={th ? "หัวข้อในบทเรียน" : "Lesson sections"}>{anchors.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav></details>
        <h2 id="prepare">{th ? "ก่อนเริ่ม" : "Before you begin"}</h2><p>{txt(lesson.prerequisite)}</p>
        <div className={s.callout}><strong>{th ? "เมนูที่ใช้" : "Where to go"}</strong><p>{txt(lesson.menu)}</p><span className={s.muted}>{th ? "ชื่อและรายการที่เห็นอาจต่างตามภาษา สิทธิ์ รุ่นแอป และการตั้งค่าร้าน" : "Visible menus may vary with language, permissions, app version and shop configuration."}</span></div>
        <h2 id="steps">{th ? "ทำตามทีละขั้น" : "Follow these steps"}</h2><ol className={s.steps}>{lesson.steps.map((step, i) => <li key={i}>{txt(step)}</li>)}</ol>
        <h2 id="verify">{th ? "รู้ได้อย่างไรว่าทำสำเร็จ" : "How to verify success"}</h2><p>{txt(lesson.check)}</p>
        <h2 id="limits">{th ? "ข้อจำกัดและสิ่งที่ต้องตรวจ" : "Limits & things to check"}</h2><div className={s.callout}><p>{txt(lesson.caution)}</p></div>
        <section className={`${s.callout} ${s.practiceCallout} ${s.noPrint}`}><div><h2>{th ? "พร้อมลองทำในร้านของคุณ" : "Ready to try it in your shop"}</h2><p>{th ? "อ่านบทเรียนได้ฟรี การทำรายการจริงต้องเข้าสู่ระบบและมีสิทธิ์ของเมนูนั้น สำหรับฝึกงานให้ใช้ข้อมูลทดสอบ" : "Lessons are free to read. Actual operations require sign-in and the appropriate permission. Use test data for training."}</p></div>
          {lesson.action.startsWith("/admin/") ? <StoreLink lang={lang} action={lesson.action} /> : <Link href={localizedPublicPath(lesson.action, lang)} className={s.button}>{th ? "ไปหน้าที่เกี่ยวข้อง" : "Open related page"} →</Link>}
        </section>
        <ArticleTools slug={lesson.slug} lang={lang} />
        <nav className={s.pager} aria-label={th ? "บทเรียนก่อนหน้าและถัดไป" : "Lesson navigation"}>
          {prev ? <Link href={lessonHref(prev.slug)}><small>← {th ? "บทก่อนหน้า" : "Previous"}</small>{txt(prev.title)}</Link> : <Link href={trackHref}>{th ? "← กลับสารบัญ" : "← Contents"}</Link>}
          {next ? <Link href={lessonHref(next.slug)}><small>{th ? "บทถัดไป" : "Next"} →</small>{txt(next.title)}</Link> : <Link href={trackHref}>{th ? "กลับไปตรวจ Checklist →" : "Review your checklist →"}</Link>}
        </nav>
        <div className={`${s.links} ${s.noPrint}`}><Link href={localizedPublicPath("/support", lang)}>{th ? "พบข้อมูลไม่ตรง / ต้องการความช่วยเหลือ" : "Report outdated guidance / Get help"}</Link><Link href={localizedPublicPath(`/learn?q=${encodeURIComponent(txt(lesson.title))}`, lang)}>{th ? "ค้นหาบทเรียนที่เกี่ยวข้อง" : "Search related lessons"}</Link></div>
      </article>
      <aside className={s.articleAside}><h2>{th ? "ในบทนี้" : "On this page"}</h2>{anchors.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}<p>{th ? "บททั่วไปใช้ร่วมกันระหว่างประเภทร้าน เพื่อให้เนื้อหาอัปเดตตรงกัน" : "Shared lessons are reused across business guides to keep instructions consistent."}</p><Link href={trackHref}>← {txt(tracks[track].title)}</Link></aside>
    </div>
    <section className={`${s.section} ${s.relatedLessons} ${s.noPrint}`}><h2 className={s.sectionTitle}>{th ? "อ่านต่อ" : "Keep learning"}</h2><div className={s.grid}>{items.filter((item) => item.category === lesson.category && item.slug !== lesson.slug).slice(0, 2).map((item) => <LessonCard key={item.slug} lesson={item} lang={lang} track={track} format={format} />)}</div></section>
  </>;
}
