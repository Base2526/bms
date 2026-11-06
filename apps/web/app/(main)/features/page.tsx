import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import { publicFeatureLead, searchPublicFeature } from "@/lib/bms/publicFeatureSearch";
import { localizedPublicPath, publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";
import styles from "./page.module.css";

const copy = {
  th: {
    title: "BMS ช่วยร้านคุณได้อย่างไร?",
    description: "พิมพ์สิ่งที่ร้านต้องการ แล้วดูว่า BMS ช่วยได้อย่างไร",
    label: "ร้านคุณอยากให้ระบบช่วยเรื่องอะไร?",
    placeholder: "เช่น รับออร์เดอร์จาก LINE ได้ไหม",
    submit: "ถาม",
    details: "ดูรายละเอียดและเงื่อนไข",
    unknownTitle: "ยังตอบเรื่องนี้ให้ชัดเจนไม่ได้",
    unknown: "ลองถามเรื่องที่ต้องการทีละข้อ หรือคุยกับทีม BMS เพื่อเช็กกับงานของร้านคุณ",
    partialTitle: "คำถามนี้มีหลายเรื่อง",
    partial: "พบข้อมูลเกี่ยวกับ {topic} แต่ยังยืนยันส่วนอื่นไม่ได้ ลองถามทีละเรื่อง หรือให้ทีม BMS ช่วยดู",
    priceTitle: "ดูราคาแพ็กเกจล่าสุด",
    price: "ราคาและจำนวนที่ใช้ได้ขึ้นกับแพ็กเกจ เลือกจากข้อมูลปัจจุบันและขนาดร้านของคุณ",
    localPriceTitle: "สอบถามราคา Retail Local",
    localPrice: "Retail Local ยังเป็นรุ่นนำร่อง ให้ทีม BMS ประเมินขอบเขตและยืนยันราคาก่อนตัดสินใจ",
    viewPrice: "ดูราคาแพ็กเกจ",
    contact: "คุยกับทีม BMS ทาง LINE",
    examples: "ลองถาม เช่น",
    sampleOne: "โอนสต็อกข้ามสาขาได้ไหม",
    sampleTwo: "ร้านอาหารใช้ QR สั่งอาหารได้ไหม",
  },
  en: {
    title: "How can BMS help your shop?",
    description: "Describe what your shop needs and see how BMS can help.",
    label: "What would you like the system to help with?",
    placeholder: "For example, can it take orders from LINE?",
    submit: "Ask",
    details: "See details and conditions",
    unknownTitle: "We cannot confirm this yet",
    unknown: "Try asking about one need at a time, or ask the BMS team to check your shop's workflow.",
    partialTitle: "This question covers several things",
    partial: "I found information about {topic}, but cannot confirm the other parts. Try one question at a time or ask the BMS team.",
    priceTitle: "Check current plan prices",
    price: "Prices and capacity depend on the plan. Compare current options against your shop's needs.",
    localPriceTitle: "Ask about Retail Local pricing",
    localPrice: "Retail Local remains a pilot. Ask BMS to assess the scope and confirm pricing before deciding.",
    viewPrice: "View plan prices",
    contact: "Chat with the BMS team on LINE",
    examples: "Try asking",
    sampleOne: "Can I transfer stock between branches?",
    sampleTwo: "Can restaurants take table QR orders?",
  },
} as const;

type SearchParams = { q?: string | string[] };

export async function generateMetadata(): Promise<Metadata> {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return publicPageMetadata({ path: "/features", locale, title: copy[locale].title, description: copy[locale].description });
}

export default async function FeaturesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const locale: PublicSeoLocale = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  const c = copy[locale];
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const result = query ? searchPublicFeature(query, locale) : undefined;
  const entry = result?.kind === "answer" ? result.entry : undefined;
  const fullAnswer = entry?.answer[locale] ?? "";
  const lead = entry ? publicFeatureLead(entry, locale) : "";

  return (
    <div className={styles.page}>
      <h1>{c.title}</h1>
      <form action={localizedPublicPath("/features", locale)} method="get" role="search" className={styles.search}>
        <label htmlFor="feature-question">{c.label}</label>
        <div className={styles.row}>
          <input id="feature-question" type="search" name="q" maxLength={200} required
            placeholder={c.placeholder} defaultValue={query} autoFocus />
          <button type="submit">{c.submit}</button>
        </div>
      </form>
      {query && (
        <section className={styles.result} aria-live="polite">
          {entry ? (
            <>
              <h2>{entry.title[locale]}</h2>
              <p>{lead}</p>
              {lead !== fullAnswer && <details><summary>{c.details}</summary><p>{fullAnswer}</p></details>}
            </>
          ) : result?.kind === "price" ? <><h2>{c.priceTitle}</h2><p>{c.price}</p><Link className={styles.priceLink} href={localizedPublicPath("/#pricing", locale)}>{c.viewPrice}</Link></>
            : result?.kind === "localPrice" ? <><h2>{c.localPriceTitle}</h2><p>{c.localPrice}</p></>
              : result?.kind === "partial" ? <><h2>{c.partialTitle}</h2><p>{c.partial.replace("{topic}", result.title)}</p></>
                : <><h2>{c.unknownTitle}</h2><p>{c.unknown}</p></>}
          <a className={styles.contact} href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{c.contact}</a>
        </section>
      )}
      {!query && <div className={styles.examples}><span>{c.examples}</span>
        {[c.sampleOne, c.sampleTwo].map(sample => <Link key={sample} href={`${localizedPublicPath("/features", locale)}?q=${encodeURIComponent(sample)}`}>{sample}</Link>)}
      </div>}
    </div>
  );
}
