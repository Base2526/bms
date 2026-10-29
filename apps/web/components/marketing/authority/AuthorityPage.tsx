import Link from "next/link";
import { localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";
import styles from "./authority-page.module.css";

export type AuthorityPageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  answerLabel: string;
  answer: string;
  reviewedLabel: string;
  reviewedAt: string;
  flowTitle: string;
  flow: string[];
  sections: Array<{
    kicker: string;
    title: string;
    body: string;
    bullets: string[];
  }>;
  principlesTitle: string;
  principles: Array<{ title: string; body: string }>;
  faqTitle: string;
  faq: Array<{ question: string; answer: string }>;
  cta: {
    title: string;
    body: string;
    primary: { label: string; path: string };
    secondary: { label: string; path: string };
  };
};

export default function AuthorityPage({
  content,
  locale,
}: {
  content: AuthorityPageContent;
  locale: PublicSeoLocale;
}) {
  return (
    <article className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className={styles.intro}>{content.intro}</p>
          <p className={styles.reviewed}>
            {content.reviewedLabel} <time dateTime={content.reviewedAt}>{content.reviewedAt}</time>
          </p>
        </div>

        <aside className={styles.answerCard} aria-label={content.answerLabel}>
          <span>{content.answerLabel}</span>
          <p>{content.answer}</p>
        </aside>
      </header>

      <section className={styles.flowSection} aria-labelledby="authority-flow-title">
        <div className={styles.sectionHeading}>
          <span>01</span>
          <h2 id="authority-flow-title">{content.flowTitle}</h2>
        </div>
        <ol className={styles.flow}>
          {content.flow.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.detailGrid} aria-label={content.title}>
        {content.sections.map((section, index) => (
          <div className={styles.detailCard} key={section.title}>
            <span>{section.kicker || String(index + 2).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            <ul>
              {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <section className={styles.principles} aria-labelledby="authority-principles-title">
        <div className={styles.sectionHeading}>
          <span>02</span>
          <h2 id="authority-principles-title">{content.principlesTitle}</h2>
        </div>
        <div className={styles.principleGrid}>
          {content.principles.map((principle, index) => (
            <div key={principle.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.faq} aria-labelledby="authority-faq-title">
        <div className={styles.sectionHeading}>
          <span>03</span>
          <h2 id="authority-faq-title">{content.faqTitle}</h2>
        </div>
        <div className={styles.faqList}>
          {content.faq.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.references} aria-label={locale === "th" ? "ที่มาของเนื้อหา" : "About this content"}>
        <h2>{locale === "th" ? "อ่านต่อและตรวจสอบรายละเอียด" : "Further reading and verification"}</h2>
        <p>{locale === "th"
          ? "BMS จัดทำคำอธิบายนี้จากขอบเขตผลิตภัณฑ์และคู่มือของระบบ ตัวอย่างมีไว้เพื่ออธิบายขั้นตอน ความพร้อมของการเชื่อมต่อและการใช้งานขึ้นอยู่กับการตั้งค่าและสิทธิ์ของร้าน หากพบข้อมูลคลาดเคลื่อน แจ้งทีมงานเพื่อทบทวนได้"
          : "BMS prepares this explanation from its product boundaries and operating guides. Examples illustrate workflows; integration availability and access depend on shop configuration and permissions. Contact the team to report information that needs correction."}</p>
        <nav aria-label={locale === "th" ? "คู่มือประกอบ" : "Supporting guides"}>
          <Link href={localizedPublicPath("/learn/guides/reports-ai", locale)}>{locale === "th" ? "รายงานและผู้ช่วย AI" : "Reports and the AI assistant"}</Link>
          <Link href={localizedPublicPath("/learn/guides/start-here", locale)}>{locale === "th" ? "คู่มือเริ่มต้นใช้งาน" : "Getting started guide"}</Link>
          <Link href={localizedPublicPath("/support", locale)}>{locale === "th" ? "ติดต่อ BMS / แจ้งแก้ไขข้อมูล" : "Contact BMS / report a correction"}</Link>
        </nav>
      </section>

      <section className={styles.cta}>
        <div>
          <h2>{content.cta.title}</h2>
          <p>{content.cta.body}</p>
        </div>
        <div className={styles.ctaActions}>
          <Link className={styles.primary} href={localizedPublicPath(content.cta.primary.path, locale)}>
            {content.cta.primary.label}
          </Link>
          <Link className={styles.secondary} href={localizedPublicPath(content.cta.secondary.path, locale)}>
            {content.cta.secondary.label}
          </Link>
        </div>
      </section>
    </article>
  );
}
