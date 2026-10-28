import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryLabels, getTrackLessons, isTrack, isTrackFormat, localize, tracks, type RestaurantFormat, type RetailFormat, type TrackFormat } from "@/lib/learning/catalog";
import { learningLang, learningMetadata, Sidebar } from "../shared";
import { ReadingChecklist } from "../Controls";
import s from "../learning.module.css";

export function generateMetadata({ params }: { params: { track: string } }) {
  if (!isTrack(params.track)) return {};
  const lang = learningLang(); const track = tracks[params.track];
  return learningMetadata(localize(track.title, lang), localize(track.description, lang), `/learn/${params.track}`);
}
type FormatOption = { value: TrackFormat; icon: string; title: { th: string; en: string }; description: { th: string; en: string } };
const restaurantFormats: Record<RestaurantFormat, Omit<FormatOption, "value">> = {
  "dine-in": {
    icon: "🍽",
    title: { th: "ร้านอาหารนั่งทาน", en: "Dine-in restaurant" },
    description: { th: "ผังโต๊ะ QR โต๊ะ รอบส่งครัว แยกหรือรวมบิล และคิดเงิน", en: "Tables, table QR, kitchen rounds, split or merged checks and checkout." },
  },
  "counter-kitchen": {
    icon: "☕",
    title: { th: "เคาน์เตอร์ที่ใช้ครัว", en: "Counter with kitchen" },
    description: { th: "บิล TAKEAWAY สูตร ตัวเลือกสินค้า รอบส่งครัว และ Kitchen Board โดยไม่ใช้ผังโต๊ะ", en: "TAKEAWAY checks, recipes, modifiers, kitchen rounds and Kitchen Board without a floor plan." },
  },
  "pickup-delivery": {
    icon: "🥡",
    title: { th: "รับกลับและเดลิเวอรี", en: "Pickup & delivery" },
    description: { th: "เมนูตามช่องทาง ออร์เดอร์ออนไลน์ การตรวจชำระ และส่งมอบ", en: "Channel menus, online orders, payment review and handoff." },
  },
};
const retailFormats: Record<RetailFormat, Omit<FormatOption, "value">> = {
  general: {
    icon: "🛍",
    title: { th: "ค้าปลีกทั่วไปและมินิมาร์ท", en: "General retail & grocery" },
    description: { th: "สแกนสินค้า แพ็ก โปรโมชัน รับเข้า สต็อก และขายหน้าร้าน", en: "Scanning, packs, promotions, receiving, stock and counter sales." },
  },
  variants: {
    icon: "👕",
    title: { th: "รุ่น สี ไซซ์ และเลขเครื่อง", en: "Variants & serial goods" },
    description: { th: "แฟชั่น แก็ดเจ็ต ของใช้ และสินค้าที่ต้องเลือก Variant, Lot หรือ Serial", en: "Fashion, gadgets and goods using variants, lots or serials." },
  },
  "food-counter": {
    icon: "☕",
    title: { th: "อาหารและเครื่องดื่มหน้าเคาน์เตอร์", en: "Food & drink counter" },
    description: { th: "ขายเป็นสินค้าผ่าน Retail POS โดยไม่ใช้บิลโต๊ะหรือ Kitchen Board เต็มรูปแบบ", en: "Product sales through Retail POS without full table checks or Kitchen Board." },
  },
  wholesale: {
    icon: "📦",
    title: { th: "B2B และขายส่ง", en: "B2B & wholesale" },
    description: { th: "แพ็ก จำนวนมาก ราคาตามเงื่อนไข ขายเชื่อ และติดตามลูกหนี้", en: "Packs, bulk quantities, conditional pricing, credit sales and receivables." },
  },
};

function formatNotice(format: TrackFormat | undefined, lang: "th" | "en") {
  const th = lang === "th";
  if (format === "counter-kitchen") return th
    ? "เส้นทางนี้ใช้ Restaurant POS และ Kitchen Board หากขายเครื่องดื่มหน้าเคาน์เตอร์ด้วยบิลค้าปลีกทั่วไป ให้เลือกคู่มือค้าปลีก → อาหารและเครื่องดื่มหน้าเคาน์เตอร์"
    : "This path uses Restaurant POS and Kitchen Board. For ordinary product-style counter sales, use Retail → Food & drink counter.";
  if (format === "food-counter") return th
    ? "Food & Beverage ไม่ได้เปิด Restaurant POS เต็มรูปแบบโดยอัตโนมัติ หากต้องใช้รอบครัวหรือบิลโต๊ะ ให้ตรวจคู่มือร้านอาหารก่อนออร์เดอร์จริงแรก"
    : "Food & Beverage does not automatically enable full Restaurant POS. Review the restaurant guide before the first real order if you need kitchen rounds or table checks.";
  if (format === "pickup-delivery") return th ? "ตรวจความพร้อมช่องทางและผู้ให้บริการแยกกัน การมีชื่อเมนูไม่ได้แปลว่าเชื่อมต่อผู้ให้บริการแล้ว" : "Verify each channel/provider separately; a menu label does not prove a live integration.";
  if (format === "dine-in") return th ? "ผังโต๊ะและ QR โต๊ะใช้กับบิล DINE_IN เท่านั้น คำขอจากลูกค้าต้องผ่านการตรวจของพนักงาน" : "Floor plans and table QR apply only to DINE_IN checks; staff must review guest requests.";
  if (format === "wholesale") return th ? "ขายเชื่อสร้างลูกหนี้ ไม่ใช่เงินเข้าลิ้นชัก การเก็บเงินภายหลังต้องบันทึกที่ Receivables" : "A credit sale creates receivables, not drawer cash; later collections are recorded in Receivables.";
  if (format === "variants") return th ? "Variant, Pack, Lot และ Serial มีความหมายต่างกัน เลือกตามหลักฐานที่ต้องระบุตอนขายและคืน" : "Variants, packs, lots and serials are different; choose according to sale and return evidence.";
  return th ? "บททั่วไปใช้ร่วมกัน ส่วนบทเฉพาะจะแสดงตามรูปแบบร้านที่เลือก" : "Shared lessons apply across formats; specialized lessons appear for the selected format.";
}

export default function TrackPage({ params, searchParams }: { params: { track: string }; searchParams: { format?: string } }) {
  if (!isTrack(params.track)) notFound();
  const id = params.track; const track = tracks[id]; const lang = learningLang(); const th = lang === "th";
  const format = typeof searchParams.format === "string" && isTrackFormat(id, searchParams.format) ? searchParams.format : undefined;
  const formatOptions: FormatOption[] | undefined = id === "restaurant"
    ? (Object.keys(restaurantFormats) as RestaurantFormat[]).map((value) => ({ value, ...restaurantFormats[value] }))
    : id === "retail"
      ? (Object.keys(retailFormats) as RetailFormat[]).map((value) => ({ value, ...retailFormats[value] }))
      : undefined;
  const items = getTrackLessons(id, format);
  const lessonQuery = `track=${id}${format ? `&format=${format}` : ""}`;
  return <>
    <nav className={s.breadcrumb} aria-label="Breadcrumb"><Link href="/learn">{th ? "ศูนย์เรียนรู้" : "Learning center"}</Link><span>/</span><span>{localize(track.title, lang)}</span></nav>
    <section className={s.trackHero}><div><span className={s.eyebrow}>{items.length} {th ? "บทเรียน · อ่านได้โดยไม่ต้องสมัคร" : "lessons · No signup needed"}</span><h1>{track.icon} {th ? "คู่มือ" : "Guide:"} {localize(track.title, lang)}</h1><p>{localize(track.description, lang)}</p></div><Link className={s.button} href={`/learn/guides/${items[0].slug}?${lessonQuery}`}>{th ? "เริ่มจากบทแรก" : "Start the first lesson"} →</Link></section>
    {id === "inventory" ? <section className={s.callout}><h2>{th ? "คู่มือเฉพาะงาน ไม่ใช่ประเภทร้าน" : "A specialist guide, not a business type"}</h2><p>{th ? "ใช้คู่มือนี้ร่วมกับคู่มือร้านของคุณเมื่อทำงานสินค้า รับเข้า โอน นับ จอง กักกัน ของเสีย และกระทบยอด การเปิดหน้านี้ไม่เปลี่ยนการตั้งค่าหรือความสามารถของร้าน" : "Use this alongside your business guide for catalog, receiving, transfers, counts, reservations, quarantine, wastage and reconciliation. Opening it changes no shop setting or capability."}</p></section>
      : <section className={s.callout}><h2>{th ? "ต้องทำงานสต็อกแบบละเอียด?" : "Need the full inventory workflow?"}</h2><p>{th ? "บทสต็อกในคู่มือนี้สรุปเฉพาะสิ่งที่ร้านต้องใช้ งานรับเข้า โอน ตรวจนับ ยอดจอง ล็อต กักกัน ของเสีย และกระทบยอดอยู่ในคู่มือเฉพาะงาน" : "This business path summarizes the stock work it needs. Receiving, transfers, counts, reservations, lots, quarantine, wastage and reconciliation are covered in the specialist guide."}</p><div className={s.links}><Link href="/learn/inventory">{th ? "เปิดคู่มือสต็อกและคลังสินค้า →" : "Open inventory & warehouse guide →"}</Link></div></section>}
    {formatOptions && <section className={s.formatPanel} aria-labelledby="track-format-title">
      <div className={s.formatHeading}><div><h2 id="track-format-title">{id === "restaurant" ? (th ? "ร้านของคุณให้บริการแบบไหน?" : "How does your shop serve customers?") : (th ? "ร้านของคุณขายสินค้าแบบไหน?" : "How does your shop sell?")}</h2><p>{th ? "เลือกเพื่อซ่อนขั้นตอนที่ไม่เกี่ยวข้อง การเลือกนี้ไม่เปลี่ยนการตั้งค่าร้านจริง" : "Choose a format to hide unrelated steps. This does not change your actual shop settings."}</p></div>
        <Link href={`/learn/${id}`} className={!format ? s.formatAllActive : s.formatAll} aria-current={!format ? "page" : undefined}>{th ? "ดูคู่มือทั้งหมด" : "View all lessons"}</Link>
      </div>
      <div className={`${s.formatChoices} ${formatOptions.length === 4 ? s.formatChoicesFour : ""}`}>{formatOptions.map((option) => {
        const value = option.value;
        return <Link key={value} href={`/learn/${id}?format=${value}`} className={`${s.formatCard} ${format === value ? s.formatCardActive : ""}`} aria-current={format === value ? "page" : undefined}>
          <span aria-hidden="true">{option.icon}</span><div><h3>{option.title[lang]}</h3><p>{option.description[lang]}</p></div>
        </Link>;
      })}</div>
      <p className={s.formatNotice}>{formatNotice(format, lang)}</p>
    </section>}
    <div className={`${s.layout} ${s.trackLayout}`}><Sidebar lang={lang} track={id} /><div className={s.trackContents}>
      {(Object.keys(categoryLabels) as (keyof typeof categoryLabels)[]).map((category) => items.some((lesson) => lesson.category === category) && <section className={s.section} key={category}>
        <h2 className={s.sectionTitle}>{localize(categoryLabels[category], lang)}</h2>
        <ol className={`${s.lessonList} ${s.compactLessons}`}>{items.filter((lesson) => lesson.category === category).map((lesson) => <li key={lesson.slug}>
          <Link className={s.lessonRow} href={`/learn/guides/${lesson.slug}?${lessonQuery}`}><span>{String(items.indexOf(lesson) + 1).padStart(2, "0")}</span><div><h3>{localize(lesson.title, lang)}</h3><p>{localize(lesson.summary, lang)}</p></div></Link>
        </li>)}</ol>
      </section>)}
      <details className={s.readingDetails}><summary>{th ? "Checklist การอ่าน" : "Reading checklist"} · {items.length} {th ? "บทเรียน" : "lessons"}</summary>
        <ReadingChecklist items={items.map(({ slug, title }) => ({ slug, title }))} track={id} format={format} lang={lang} />
      </details>
    </div></div>
  </>;
}
