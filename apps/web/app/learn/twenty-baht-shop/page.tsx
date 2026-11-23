import Link from "next/link";
import { learningLang, learningMetadata, Sidebar } from "../shared";
import { localizedPublicPath } from "@/lib/publicSeo";
import { twentyBahtSteps } from "@/lib/learning/twentyBahtGuide";
import { TwentyBahtOverview } from "./TwentyBahtOverview";
import s from "../learning.module.css";
import g from "./twenty-baht.module.css";

const path = "/learn/twenty-baht-shop";
export async function generateMetadata() {
  const lang = await learningLang();
  return { ...learningMetadata(
    lang === "th" ? "คู่มือร้าน 20 บาท (ทดลอง)" : "Twenty-baht shop guide (pilot)",
    lang === "th" ? "คู่มือสาธารณะร้าน 20 บาท: แยก SKU นำเข้าสินค้า นับสต็อก รับของ ขาย คืน และปิดกะ พร้อมตัวอย่างและเสียงบรรยาย" : "Public pilot guide for a twenty-baht shop: SKUs, imports, stock counts, receiving, sales, returns, shifts, and narrated examples.",
    path, lang,
  ), robots: { index: false, follow: true } };
}

export default async function TwentyBahtShopGuide() {
  const lang = await learningLang();
  const th = lang === "th";
  const t = (thai: string, english: string) => th ? thai : english;
  const admin = (url: string) => <Link href={url}>{url}</Link>;
  return <div className={`${s.layout} ${s.trackLayout} ${g.layout}`}>
    <Sidebar lang={lang} twentyBahtGuide />
    <div className={s.trackContents}>
      <nav className={s.breadcrumb} aria-label="Breadcrumb"><Link href={localizedPublicPath("/learn", lang)}>{t("ศูนย์เรียนรู้", "Learning center")}</Link><span>/</span><span aria-current="page">{t("ร้าน 20 บาท", "Twenty-baht shop")}</span></nav>
      <article className={`${s.article} ${g.article}`}>
        <header className={g.hero}>
          <div><span className={g.pilot}>{t("คู่มือเฉพาะงาน · PILOT · อ่านฟรี", "Specialist guide · PILOT · Free to read")}</span><h1>{t("คู่มือร้าน 20 บาท", "Twenty-baht shop guide")}</h1><p>{t("เริ่มจาก 1 สาขา 1–3 จุดคิดเงิน สินค้าราคา 20 บาทและราคาอื่น แยกสต็อกตาม SKU ฝึกขาย รับเข้า คืน และตรวจยอดก่อนเปิดจริง", "Start with one branch and 1–3 registers. Keep separate SKU stock for 20-baht and other priced items. Rehearse selling, receiving, returns, and reconciliation before go-live.")}</p><a href="#steps" className={s.button}>{t("เริ่มขั้นตอน", "Start the steps")} →</a></div>
          <div className={g.heroArt} aria-hidden="true"><span>▥</span><b>฿20</b><i>SKU A ≠ SKU B</i><small>SCAN · STOCK · SALE</small></div>
        </header>
        <p className={g.status}><strong>{t("สถานะ pilot", "Pilot status")}</strong> {t("คู่มือนี้อธิบายความสามารถในโค้ด ยังไม่มีหลักฐานว่าร้าน 20 บาทจริง อุปกรณ์ ภาษี หรือ production deployment ผ่านแล้ว การทำรายการใน Admin/POS ต้องเข้าสู่ระบบและมีสิทธิ์", "This guide describes code paths, not verified real-shop hardware, tax treatment, or production deployment. Admin/POS actions require sign-in and permission.")}</p>
        <TwentyBahtOverview lang={lang} />
        <nav className={g.jump} aria-label={t("ข้ามไปยังส่วน", "Jump to section")}><a href="#example">{t("ตัวอย่างตัวเลข", "Worked numbers")}</a><a href="#steps">{t("ขั้นตอนปฏิบัติ", "Operator steps")}</a><a href="#limits">{t("ขอบเขต pilot", "Pilot limits")}</a><a href="#rehearsal">{t("ซ้อมเปิดร้าน", "Rehearsal")}</a></nav>

        <section id="example" className={g.section}><span className={g.pilot}>{t("ตัวอย่าง · ข้อมูลสมมติ", "EXAMPLE · FICTIONAL DATA")}</span><h2>{t("สามสินค้า หนึ่งบิล หนึ่งรายการคืน", "Three products, one sale, one return")}</h2>
          <div className={g.tableWrap}><table><thead><tr><th>SKU</th><th>{t("ราคาขาย", "Price")}</th><th>{t("ตั้งต้น", "Opening")}</th><th>{t("รับ PO", "PO receipt")}</th><th>{t("ขาย", "Sold")}</th><th>{t("คืน", "Returned")}</th><th>{t("คงเหลือ", "Closing")}</th></tr></thead><tbody>
            <tr><th>WATER-500</th><td>฿20</td><td>30</td><td>0</td><td>2</td><td>0</td><td>28</td></tr>
            <tr><th>SOAP-01</th><td>฿20</td><td>20</td><td>5</td><td>1</td><td>1</td><td>25</td></tr>
            <tr><th>TISSUE-01</th><td>฿35</td><td>10</td><td>0</td><td>1</td><td>0</td><td>9</td></tr>
          </tbody></table></div>
          <p>{t("บิลตัวอย่าง 2×20 + 1×20 + 1×35 = 95 บาท รับเงินสด 100 ทอน 5 คืนสบู่ 20 บาท ยอดขายสุทธิ 75 บาท เงินสดในกะเพิ่ม 75 บาทจากเงินทอนตั้งต้น ไม่มีตัวเลขกำไรเพราะต้นทุนยังไม่ผ่านการตรวจ", "Example bill: 2×20 + 1×20 + 1×35 = 95 baht. Take 100 cash and give 5 change. Return the 20-baht soap. Net sales are 75 baht and shift cash rises by 75 from opening float. No profit is calculated because costs are unverified.")}</p>
        </section>

        <section id="steps" className={g.section}><h2>{t("ทำตามลำดับบนร้านทดสอบ", "Follow these steps in a test shop")}</h2><p>{t("แต่ละขั้นบอกหน้า ข้อมูลที่ต้องเตรียม วิธีทำ ผลที่ต้องเห็น วิธีแก้ และข้อจำกัด", "Each step gives the screen, preparation, action, expected result, repair, and limitation.")}</p>
          <div className={g.steps}>{twentyBahtSteps.map((item, index) => <section key={item.title.en} id={`step-${index + 1}`} className={g.step}><div className={g.stepHead}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title[lang]}</h3></div><dl>
            <div><dt>{t("ทำที่หน้า", "Screen")}</dt><dd>{index === 0 ? <>{admin("/admin/settings")} · {admin("/admin/locations")} · {admin("/admin/users")} · {admin("/admin/permissions")} · {admin("/admin/pos-devices")}</> : <>{admin(item.page)}</>}</dd></div>
            <div><dt>{t("เตรียม", "Prepare")}</dt><dd>{item.prepare[lang]}</dd></div>
            <div><dt>{t("กรอก / กด", "Enter / select")}</dt><dd>{item.action[lang]}</dd></div>
            <div><dt>{t("ต้องเห็น", "Expected")}</dt><dd>{item.check[lang]}</dd></div>
            <div><dt>{t("ถ้าผิด", "If wrong")}</dt><dd>{item.repair[lang]}</dd></div>
            <div><dt>{t("ข้อจำกัด", "Limit")}</dt><dd>{item.limit[lang]}</dd></div>
          </dl></section>)}</div>
        </section>

        <section className={g.section}><h2>{t("งานที่ต้องทำระหว่างวัน", "Daily controls")}</h2><ul className={g.checklist}>
          <li>{t("ที่", "At")} {admin("/pos")}: {t("พักบิลแล้วกลับมาทำต่อก่อนชำระ ตรวจรายการและราคาทุกครั้ง บิลพักยังไม่รับเงินและไม่จองสต็อก", "Park and resume a bill before payment; recheck items and prices. A parked bill has no payment and does not reserve stock.")}</li>
          <li>{t("ที่", "At")} {admin("/admin/products")}: {t("ตั้งจุดสั่งซื้อใหม่แยก SKU/ตัวเลือก/สาขา แล้วตรวจรายการใกล้หมด; คำแนะนำสั่งซื้อเป็นเพียงข้อมูลให้คนตัดสินใจ", "Set reorder points by SKU, variant, and branch, then review low stock; recommendations are advisory.")}</li>
          <li>{t("ที่", "At")} {admin("/admin/wastage")}: {t("บันทึกของเสียจริงและตรวจ movement แยกจากยอดขาย; ตัวอย่างสามสินค้าไม่มีของเสีย", "Record actual wastage and inspect its movement separately from sales; the three-item example has no wastage.")}</li>
        </ul></section>

        <section id="limits" className={g.section}><h2>{t("แพ็กเกจและขอบเขตที่ต้องตรวจ", "Plans and boundaries to check")}</h2><p>{t("นับ SKU จริง (ไม่ใช่จำนวนป้ายราคา) บัญชีพนักงานรวมเจ้าของ เครื่องที่จับคู่ และสาขา เทียบกับโควตาปัจจุบันที่ Billing ก่อนนำเข้าชุดใหญ่ ค่าด้านล่างเป็นค่าเริ่มต้นตาม migration ไม่ใช่คำยืนยันโควตาของร้านที่ใช้อยู่", "Count actual SKUs (not price labels), staff accounts including the owner, paired devices, and branches. Check the current tenant limits in Billing before a large import. The defaults below come from migrations and may differ for your shop.")}</p>
          <div className={g.tableWrap}><table><thead><tr><th>{t("แผน", "Plan")}</th><th>SKU</th><th>{t("ผู้ใช้รวมเจ้าของ", "Users incl. owner")}</th><th>{t("สาขา", "Branches")}</th><th>{t("เครื่อง", "Registers")}</th><th>{t("เหมาะกับตัวอย่าง", "Example fit")}</th></tr></thead><tbody>
            <tr><th>Free</th><td>100</td><td>2</td><td>1</td><td>1</td><td>{t("1 เครื่อง ถ้าไม่เกินโควตา", "1 register if within quota")}</td></tr>
            <tr><th>Pro</th><td>5,000</td><td>5</td><td>1</td><td>3</td><td>{t("1–3 เครื่องใน 1 สาขา", "1–3 registers in 1 branch")}</td></tr>
            <tr><th>Growth</th><td>15,000</td><td>15</td><td>3</td><td>6</td><td>{t("เมื่อสินค้า/คน/สาขาเกิน Pro", "When products, staff or branches exceed Pro")}</td></tr>
          </tbody></table></div><p>{t("ราคาแพ็กเกจในแค็ตตาล็อกไม่ใช่หลักฐานว่าระบบตัดเงินสมาชิกอัตโนมัติ", "Catalog plan prices do not prove automated subscription charging.")}</p><p>{t("QR/โอน/บัตรต้องกำหนดวิธีและยืนยันหลักฐานจากผู้ให้บริการ; เงินสดเป็นตัวอย่างที่ตรวจยอดได้ในคู่มือนี้ การกดซ้ำใช้คีย์เดิมและต้องตรวจบิลก่อน retry สินค้าชิ้นสุดท้ายต้องทดสอบสองเครื่องกับฐานทดสอบจริง", "QR, transfer, and card need configured methods and provider evidence. This example reconciles cash. Retry uncertain operations with the original key after looking up the bill; test last-unit contention with two registers against a disposable database.")}</p><p>{t("Mobile Emergency Offline เป็นคิวขายปลีกเงินสดแบบจำกัด, Desktop เป็น shell ออนไลน์ที่ไม่มี offline tender, Retail Local เป็น technical pilot ทั้งสามอย่างไม่ใช่การขายออฟไลน์ครบทุกงาน", "Mobile Emergency Offline is a bounded retail cash queue, Desktop is an online shell without offline tender, and Retail Local is a technical pilot. None means every workflow runs offline.")}</p><p><Link href={localizedPublicPath("/cost-pricing", lang)}>{t("ดูราคาและแพ็กเกจ", "Check pricing and plans")}</Link> · {admin("/admin/billing")}</p></section>

        <section id="rehearsal" className={g.section}><h2>{t("Checklist Go / No-Go", "Go / No-Go checklist")}</h2><ul className={g.checklist}>{[
          t("SKU และบาร์โค้ดจริงทุกชิ้นแยกถูกต้อง สินค้าไร้บาร์โค้ดค้นหาได้", "Real SKUs/barcodes resolve correctly; barcode-free items can be found"),
          t("preview นำเข้าไม่มี error สำคัญ สินค้า Draft ถูกตรวจและเปิดขายโดยคน", "Import preview has no material errors; a person reviews and activates Draft items"),
          t("นับตั้งต้น รับ PO ขาย คืน และประวัติ movement ตรงยอด 28/25/9 ของตัวอย่าง", "Opening count, PO, sale, return, and movements reconcile to the example 28/25/9"),
          t("ปฏิเสธ PIN/สิทธิ์ผิด ผู้อนุมัติ void เป็นอีกคน กดซ้ำและเน็ตหลุดไม่ทำเงินซ้ำ", "Wrong PIN/permission denied; a distinct person approves void; retries/outages do not duplicate money"),
          t("สแกนและพิมพ์บนอุปกรณ์จริง ปิดกะและตรวจเงินสดจริง", "Scan and print on actual hardware; close shift and count physical cash"),
          t("ผู้ทำบัญชีรับรอง VAT/เอกสาร และผู้ดูแล production ยืนยัน migration/backup", "Accountant signs off VAT/documents; production owner confirms migrations and backup"),
        ].map((line) => <li key={line}>☐ {line}</li>)}</ul><p>{t("Go เมื่อทุกข้อมีหลักฐานและผู้รับผิดชอบลงชื่อ; ไม่ผ่านข้อใดเป็น No-Go สำหรับรับเงินจริง", "Go only when every check has evidence and a named reviewer. Any failed check is No-Go for real payments.")}</p></section>
        <Link className={s.secondary} href={localizedPublicPath("/learn", lang)}>{t("← กลับศูนย์เรียนรู้", "← Back to learning center")}</Link>
      </article>
    </div>
  </div>;
}
