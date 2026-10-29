import Link from "next/link";
import { localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";
import { resolveBilingual } from "@/lib/static-page-i18n";
import StructuredData from "@/components/seo/StructuredData";
import { faqPageJsonLd } from "@/lib/seoJsonLd";
import { publicAnswers, ANSWERS_REVIEWED_AT } from "./content";
import s from "./answers.module.css";

export default function PublicAnswers({ topic, locale }: { topic: keyof typeof publicAnswers; locale: PublicSeoLocale }) {
  const c = resolveBilingual(publicAnswers[topic], locale);
  return <section className={s.section} aria-labelledby={`${topic}-answers-title`} data-public-answers>
    <StructuredData id={`${topic}-faq-jsonld`} data={faqPageJsonLd(c.faq)} />
    <div className={s.intro}>
      <p className={s.eyebrow}>{locale === "th" ? "คำตอบก่อนเริ่มใช้งาน" : "BEFORE YOU START"}</p>
      <h2 id={`${topic}-answers-title`}>{c.title}</h2>
      <p>{c.summary}</p>
    </div>
    <div className={s.grid}>
      <div className={s.faq}>{c.faq.map((item, index) => <details key={item.question} open={index === 0}>
        <summary>{item.question}</summary><p>{item.answer}</p>
      </details>)}</div>
      <aside className={s.references}>
        <h3>{locale === "th" ? "อ่านขั้นตอนและข้อจำกัดเพิ่มเติม" : "Read the steps and boundaries"}</h3>
        <ul>{c.links.map(link => <li key={link.path}><Link href={localizedPublicPath(link.path, locale)}>{link.label} →</Link></li>)}</ul>
        <p>{locale === "th" ? "จัดทำโดย " : "Prepared by "}<Link href={localizedPublicPath("/about", locale)}>BMS</Link><br />
          {locale === "th" ? "ทบทวนเนื้อหา " : "Reviewed "}<time dateTime={ANSWERS_REVIEWED_AT}>{ANSWERS_REVIEWED_AT}</time>
        </p>
        <Link href={localizedPublicPath("/support", locale)}>{locale === "th" ? "แจ้งข้อมูลที่ควรแก้ไข" : "Suggest a correction"}</Link>
      </aside>
    </div>
  </section>;
}
