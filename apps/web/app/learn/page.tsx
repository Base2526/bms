import Link from "next/link";
import { businessTrackIds, categoryLabels, lessons, localize, roleLabels, searchLessons, specialistTrackIds, tracks, trackOrder, isTrack, type Role } from "@/lib/learning/catalog";
import { learningLang, learningMetadata, LessonCard, Sidebar } from "./shared";
import s from "./learning.module.css";

type Params = { q?: string; track?: string; role?: string };
export function generateMetadata() {
  const th = learningLang() === "th";
  return learningMetadata(th ? "ศูนย์เรียนรู้สาธารณะ" : "Public learning center", th ? "คู่มือ BMS ตามประเภทร้าน พร้อมคู่มือเฉพาะงานสต็อกและคลังสินค้า ตั้งค่า POS ใช้งานประจำวัน และเตรียมเปิดร้าน อ่านฟรีโดยไม่ต้องสมัคร" : "Free BMS guides by business type, plus a specialist inventory and warehouse path for setup, daily operations and go-live. No signup needed.", "/learn");
}
export default function LearnPage({ searchParams }: { searchParams: Params }) {
  const lang = learningLang(); const th = lang === "th";
  const q = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 200) : "";
  const track = typeof searchParams.track === "string" && isTrack(searchParams.track) ? searchParams.track : undefined;
  const role = typeof searchParams.role === "string" && Object.hasOwn(roleLabels, searchParams.role) ? searchParams.role as Role : undefined;
  const filtered = Boolean(q || track || role);
  const results = searchLessons(q, lang, track, role);
  return <>
    <section className={s.homeHero}>
      <span className={s.eyebrow}>{th ? "อ่านฟรี · ไม่ต้องสมัคร · เริ่มได้ทีละขั้น" : "Free to read · No signup · Step by step"}</span>
      <h1>{th ? "เรียนรู้วันนี้ พร้อมเปิดร้านจริง" : "Learn today. Get ready to open."}</h1>
      <p>{th ? "เลือกคู่มือให้ตรงประเภทร้าน ตั้งค่าครั้งแรก ฝึกพนักงาน และหาคำตอบระหว่างทำงาน ทุกบทบอกขั้นตอน สิ่งที่ต้องตรวจ และข้อจำกัดตามระบบจริง" : "Choose your business guide, set up your shop, train your team and find help during service. Every lesson includes steps, checks and actual limitations."}</p>
      <form key={`${q}:${track || ""}:${role || ""}`} className={s.homeSearch} action="/learn" method="get" role="search">
        <label htmlFor="learning-query">{th ? "ค้นหาวิธีใช้งาน" : "Search guides"}
        <input id="learning-query" type="search" name="q" defaultValue={q} maxLength={200} placeholder={th ? "เช่น แยกบิล, สมัครสมาชิก, QR รับเงิน" : "Try split bills, member signup, payment QR"} />
        </label>
          <label>{th ? "ประเภทคู่มือ" : "Guide type"}<select name="track" defaultValue={track || ""}><option value="">{th ? "ทุกคู่มือ" : "All guides"}</option><optgroup label={th ? "ตามประเภทร้าน" : "By business type"}>{businessTrackIds.map((id) => <option key={id} value={id}>{localize(tracks[id].title, lang)}</option>)}</optgroup><optgroup label={th ? "คู่มือเฉพาะงาน" : "Specialist guides"}>{specialistTrackIds.map((id) => <option key={id} value={id}>{localize(tracks[id].title, lang)}</option>)}</optgroup></select></label>
          <label>{th ? "บทบาทของคุณ" : "Your role"}<select name="role" defaultValue={role || ""}><option value="">{th ? "ทุกบทบาท" : "All roles"}</option>{(Object.keys(roleLabels) as Role[]).map((id) => <option key={id} value={id}>{localize(roleLabels[id], lang)}</option>)}</select></label>
        <button type="submit" className={s.button}>{th ? "ค้นหาคู่มือ" : "Search guides"}</button>
        {filtered && <Link href="/learn" className={s.clearFilters}>{th ? "ล้างตัวกรอง" : "Clear filters"}</Link>}
      </form>
    </section>
    <div className={`${s.layout} ${s.homeLayout}`}>
      <Sidebar lang={lang} />
      <div className={s.homeContents}>
        {filtered ? <section>
          <h2 className={s.sectionTitle}>{th ? "ผลการค้นหา" : "Search results"} · {results.length}</h2>
          {results.length ? <div className={s.grid}>{results.map((lesson) => <LessonCard key={lesson.slug} lesson={lesson} lang={lang} track={track} />)}</div> : <div className={s.empty}><h3>{th ? "ยังไม่พบบทเรียนที่ตรงกัน" : "No matching lesson"}</h3><p>{th ? "ลองคำสั้นลง เช่น โต๊ะ, PIN หรือ คืนเงิน หรือเลือกดูเส้นทางตามประเภทร้าน" : "Try shorter terms such as table, PIN or refund, or browse a business learning path."}</p><Link className={s.secondary} href="/learn">{th ? "ดูคู่มือทั้งหมด" : "Browse all guides"}</Link></div>}
        </section> : <>
          <section><h2 className={s.sectionTitle}>{th ? "เริ่มจากร้านของคุณ" : "Start with your business"}</h2>
            <div className={s.grid}>{businessTrackIds.map((id) => <Link className={`${s.card} ${s.businessCard}`} href={`/learn/${id}`} key={id}>
              <h3><span className={s.icon} aria-hidden="true">{tracks[id].icon}</span> {localize(tracks[id].title, lang)}</h3>
              <p>{localize(tracks[id].description, lang)}</p><div className={s.businessMeta}><span className={s.tag}>{trackOrder[id].length} {th ? "บทเรียน · ตั้งค่าถึงเปิดจริง" : "lessons · Setup to launch"}</span><span className={s.arrow}>{th ? "เริ่มเรียน" : "Start learning"} →</span></div>
            </Link>)}</div>
          </section>
          <section><h2 className={s.sectionTitle}>{th ? "คู่มือเฉพาะงาน" : "Specialist guides"}</h2>
            <div className={s.grid}>{specialistTrackIds.map((id) => <Link className={`${s.card} ${s.businessCard}`} href={`/learn/${id}`} key={id}>
              <h3><span className={s.icon} aria-hidden="true">{tracks[id].icon}</span> {localize(tracks[id].title, lang)}</h3>
              <p>{localize(tracks[id].description, lang)}</p><div className={s.businessMeta}><span className={s.tag}>{trackOrder[id].length} {th ? "บทเรียน · ใช้ร่วมหลายประเภทร้าน" : "lessons · Cross-business workflow"}</span><span className={s.arrow}>{th ? "เปิดคู่มือ" : "Open guide"} →</span></div>
            </Link>)}</div>
          </section>
          <section className={s.callout}><h2>{th ? "เพิ่งเริ่มใช้ BMS?" : "New to BMS?"}</h2><p>{th ? "อ่านภาพรวมก่อน แล้วตั้งสาขา พนักงาน สินค้า และเครื่องขายตามลำดับ ทดลองในร้านทดสอบก่อนเริ่มรับเงินจริง" : "Start with the overview, then configure branches, staff, products and registers. Rehearse in a test shop before taking real payments."}</p><div className={s.links}><Link href="/learn/guides/start-here">{th ? "เริ่มบทแรก →" : "First lesson →"}</Link><Link href="/learn/guides/launch-checklist">{th ? "Checklist เปิดร้าน →" : "Launch checklist →"}</Link></div></section>
          {(Object.keys(categoryLabels) as (keyof typeof categoryLabels)[]).map((category) => <section className={s.section} key={category}>
            <h2 className={s.sectionTitle}>{localize(categoryLabels[category], lang)}</h2><div className={s.grid}>{lessons.filter((lesson) => lesson.category === category).map((lesson) => <LessonCard key={lesson.slug} lesson={lesson} lang={lang} />)}</div>
          </section>)}
        </>}
        <section className={s.callout}><h2>{th ? "มีผู้ช่วยแนะนำการใช้งานอยู่ในระบบ" : "In-app guidance when you need it"}</h2>
          <p>{th ? "ถามวิธีใช้เมนูหรือข้อมูลร้านผ่านผู้ช่วยหลังเข้าสู่ระบบตามสิทธิ์ ศูนย์เรียนรู้นี้ค้นบทความสาธารณะได้ทันที และไม่อ่านข้อมูลของร้าน" : "After signing in, ask the assistant about workflows or authorized shop data. This public learning center searches published articles without accessing shop records."}</p>
          <div className={s.links}><Link href="/learn/guides/reports-ai">{th ? "ดูตัวอย่างคำถามและขอบเขต AI →" : "Example questions & AI limits →"}</Link><Link href="/support">{th ? "ยังหาคำตอบไม่เจอ? ติดต่อทีมงาน" : "Still need help? Contact support"}</Link></div>
        </section>
      </div>
    </div>
  </>;
}
