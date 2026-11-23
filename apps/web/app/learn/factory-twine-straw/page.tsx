import Link from "next/link";
import { learningLang, learningMetadata, Sidebar } from "../shared";
import { localizedPublicPath } from "@/lib/publicSeo";
import s from "../learning.module.css";
import g from "./factory-guide.module.css";
import { FactoryGuideOverview } from "./FactoryGuideOverview";

const path = "/learn/factory-twine-straw";

export async function generateMetadata() {
  const lang = await learningLang();
  return {
    ...learningMetadata(
      lang === "th" ? "คู่มือโรงงานเชือกพลาสติกและหลอดพลาสติก" : "Plastic twine and straw factory guide",
      lang === "th"
        ? "ตัวอย่างการกรอก BMS POS+ ตั้งแต่สมัครกิจการ สร้าง SKU รับวัตถุดิบ ตั้ง BOM ผลิต ตรวจคุณภาพ จนถึงสต็อกคงเหลือ สำหรับ pilot ที่ยังไม่เปิดใช้ production"
        : "Worked BMS POS+ examples from signup and receiving through BOMs, production, quality review and stock balances for a pilot not yet deployed to production.",
      path,
      lang,
    ),
    robots: { index: false, follow: true },
  };
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className={g.tableWrap}><table className={g.table}>
    <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={headers[cellIndex]}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default async function FactoryTwineStrawGuide() {
  const lang = await learningLang();
  const th = lang === "th";
  const t = (thai: string, english: string) => th ? thai : english;
  const sections = [
    ["signup", t("สมัครและตั้งสาขา", "Signup and branches")],
    ["catalog", t("สินค้าและหน่วย", "Products and units")],
    ["receiving", t("รับวัตถุดิบ", "Receive materials")],
    ["bom", t("สูตรผลิต BOM", "Production BOMs")],
    ["production", t("ใบผลิตและ QC", "Batches and QC")],
    ["stock", t("ตรวจยอดสต็อก", "Reconcile stock")],
  ] as const;

  return <div className={`${s.layout} ${s.trackLayout} ${s.inventoryFullLayout} ${g.layout}`}>
    <Sidebar lang={lang} factoryGuide />
    <div className={s.trackContents}>
      <nav className={s.breadcrumb} aria-label="Breadcrumb">
        <Link href={localizedPublicPath("/learn", lang)}>{t("ศูนย์เรียนรู้", "Learning center")}</Link><span>/</span>
        <span aria-current="page">{t("โรงงานเชือกและหลอดพลาสติก", "Twine and straw factory")}</span>
      </nav>
      <article className={`${s.article} ${g.article}`}>
        <section className={`${s.inventoryTrackHero} ${g.hero}`} aria-labelledby="factory-guide-title">
          <div className={`${s.inventoryHeroCopy} ${g.heroCopy}`}>
            <span className={s.eyebrow}>{t("คู่มือเฉพาะงาน · ตัวอย่างการกรอก · อ่านได้โดยไม่ต้องสมัคร", "Specialist guide · Worked examples · No signup needed")}</span>
            <h1 id="factory-guide-title">{t("คู่มือโรงงานเชือกพลาสติกและหลอดพลาสติก", "Plastic twine and straw factory guide")}</h1>
            <p>{t(
              "เริ่มจากสมัครกิจการและตั้ง SKU แล้วรับเม็ดพลาสติก ผลิตเชือกกับหลอด ตรวจคุณภาพ และเทียบยอดสต็อกทุกขั้น",
              "Set up the business and SKUs, receive resin, produce twine and straws, review quality, then reconcile every stock movement.",
            )}</p>
            <a className={s.button} href="#signup">{t("เริ่มจากขั้นแรก", "Start with step one")} →</a>
          </div>
          <div className={g.heroVisual} aria-hidden="true">
            <div className={g.spool}><span /></div>
            <div className={g.straws}><i /><i /><i /><i /><i /></div>
            <ul>
              <li>✓ {t("รับวัตถุดิบ", "Receive materials")}</li>
              <li>✓ {t("ผลิตเชือก / หลอด", "Produce twine / straws")}</li>
              <li>✓ {t("ตรวจ QC", "Review QC")}</li>
              <li>✓ {t("เทียบยอดสต็อก", "Reconcile stock")}</li>
            </ul>
          </div>
        </section>
        <p className={g.status}><strong>{t("สถานะ pilot", "Pilot status")}</strong> {t(
          "ส่วน Factory BOM และใบผลิตสำหรับโรงงานอยู่ใน branch ทดสอบ ยังไม่ยืนยันว่าติดตั้งบน production หรือผ่านการทดสอบกับโรงงานจริง ตัวเลขทั้งหมดในหน้านี้เป็นตัวอย่าง",
          "The factory BOM and production extension is on a test branch. Production deployment and validation with a real factory are unverified. All quantities on this page are examples.",
        )}</p>
        <FactoryGuideOverview lang={lang} />
        <nav className={g.jump} aria-label={t("ข้ามไปยังขั้นตอน", "Jump to a step")}>
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>

        <h2 id="signup">1 {t("สมัครและตั้งสาขา", "Signup and branches")}</h2>
        <p>{t("เข้า /shop-signup กรอกข้อมูลเจ้าของกิจการ ยืนยันอีเมล แล้วเข้าระบบ ตัวอย่างนี้ใช้สาขาเดียวเพื่อให้ตรวจยอดง่าย", "Open /shop-signup, enter the owner's details, verify the email and sign in. This example uses one branch to make reconciliation easier.")}</p>
        <DataTable headers={[t("ช่อง", "Field"), t("ตัวอย่างที่กรอก", "Example")]} rows={[
          [t("ชื่อกิจการ", "Business name"), t("โรงงานพลาสติกตัวอย่าง", "Example Plastics Factory")],
          [t("ประเภทร้าน", "Business type"), t("ประเภทร้านอื่น ๆ หรือ ขายส่ง / ธุรกิจ B2B", "Other, or B2B / Wholesale")],
          [t("สาขาใน /admin/locations", "Branch in /admin/locations"), t("โรงงานหลัก · FACTORY-01", "Main factory · FACTORY-01")],
        ]} />
        <p>{t("ระบบยังไม่มีประเภทร้าน “โรงงาน” โดยเฉพาะ เพิ่มบัญชีและสิทธิ์ที่ /admin/users และ /admin/permissions สำหรับผู้ดูแลสินค้า ผู้จัดซื้อ ผู้รับสินค้า ผู้ผลิต ผู้ตรวจ QC และผู้อนุมัติคนละคน เปิดความสามารถ RECIPE และ WASTAGE ที่ต้องใช้กับงานผลิต", "There is no dedicated factory business type yet. Set up individual accounts and permissions in /admin/users and /admin/permissions for catalog, purchasing, receiving, production, QC inspection and separate approval. Enable the RECIPE and WASTAGE capabilities needed for production.")}</p>

        <h2 id="catalog">2 {t("สร้างสินค้าและกำหนดหน่วยฐาน", "Create products and base units")}</h2>
        <p>{t("สร้าง SKU แยกตามจุดที่โรงงานนับสต็อกจริง ถ้าไม่ได้นับหลอดก่อนบรรจุ ไม่ควรสร้างสต็อกระหว่างขั้นสมมติ", "Use a separate SKU for each stock state the factory actually counts. Do not invent an intermediate loose-straw balance if it is never counted.")}</p>
        <DataTable headers={["SKU", t("ชื่อสินค้า", "Product"), t("หน่วยฐาน", "Base unit"), t("ราคาตัวอย่าง", "Example price")]} rows={[
          ["PP-RAW", t("เม็ด PP", "PP resin"), "GRAM", "0"],
          ["COLOR-RAW", t("สี masterbatch", "Color masterbatch"), "GRAM", "0"],
          ["BAG-EMPTY", t("ถุงเปล่า", "Empty bag"), "PIECE", "0"],
          ["CARTON-EMPTY", t("กล่องเปล่า", "Empty carton"), "PIECE", "0"],
          ["TWINE-ROLL", t("เชือกฟางม้วน", "Twine roll"), "ROLL", "65"],
          ["STRAW-LOOSE", t("หลอดก่อนบรรจุ", "Loose straws"), "PIECE", "0"],
          ["STRAW-BAG", t("หลอด 100 ชิ้นต่อถุง", "Bag of 100 straws"), "BAG", "8"],
          ["STRAW-CARTON", t("หลอด 10 ถุงต่อลัง", "Carton of 10 bags"), "CARTON", "75"],
        ]} />
        <p>{t("ที่ /admin/products กดนำเข้า ใช้ชีต Products กรอก SKU ชื่อสินค้า ราคาขาย Stock Policy = DIRECT หน่วยฐาน และตัวเลือก = STD วัตถุดิบใช้รูปแบบ INGREDIENT และไม่เปิดช่องทางขาย ส่วนสินค้าสำเร็จรูปใช้ GENERAL และเปิด ONLINE_ORDER หากต้องแปลงความต้องการผลิตเป็นออร์เดอร์ ตรวจผล CREATE ก่อนยืนยันนำเข้า", "In /admin/products, download the import template and fill the Products sheet with SKU, name, price, DIRECT stock policy, base unit and STD variant. Use the INGREDIENT template with no sales surface for materials. Use GENERAL with ONLINE_ORDER for outputs that may become customer orders. Check every CREATE preview before committing.")}</p>
        <p className={g.note}>{t("ช่องหน่วยฐานในฟอร์มเพิ่มทีละตัวไม่มี ROLL, BAG และ CARTON ให้เลือก ใช้ไฟล์นำเข้ากำหนดหน่วยเหล่านี้ หรือแก้ใน /admin/stock-models ก่อนมีสต็อกและ BOM สินค้าใหม่เริ่มเป็นร่าง และการนำเข้าไม่เพิ่มสต็อก", "The one-at-a-time product form does not list ROLL, BAG or CARTON. Set these units in the import file, or change them in /admin/stock-models before creating stock or BOMs. Imported products start as drafts and import does not create stock.")}</p>
        <p>{t("ที่ /admin/stock-models ตรวจหน่วยฐานและเปิดติดตามล็อตสำหรับ PP สี และผลผลิตที่ต้องสืบย้อน ถ้าเปิดวันหมดอายุหรือ FEFO ต้องเปิดล็อตด้วย ตรวจและเปิดใช้งานสินค้าที่พร้อมก่อนนำไปใช้", "In /admin/stock-models, verify base units and enable lot tracking for resin, color and traceable outputs. Expiry tracking and FEFO require lots. Review and activate eligible products before using them.")}</p>

        <h2 id="receiving">3 {t("สร้าง PO และรับวัตถุดิบ", "Create a PO and receive materials")}</h2>
        <p>{t("ที่ /admin/purchase สร้าง PO ให้ผู้ขาย “บริษัท วัตถุดิบตัวอย่าง จำกัด” จำนวนใน PO เป็นหน่วยฐาน จึงกรอกเม็ด PP 50,000 GRAM ไม่ใช่ 50 กิโลกรัม", "In /admin/purchase, create a PO for Example Materials Co. Enter quantities in base units: 50,000 GRAM for PP, not 50 kilograms.")}</p>
        <DataTable headers={["SKU / STD", t("จำนวนสั่ง", "Ordered"), t("ต้นทุนต่อหน่วย", "Unit cost"), t("ล็อตเมื่อรับ", "Receipt lot")]} rows={[
          ["PP-RAW", "50,000 GRAM", "0.04", "PP-261117-A"],
          ["COLOR-RAW", "2,000 GRAM", "0.20", "COLOR-261117-A"],
          ["BAG-EMPTY", "100 PIECE", "1.00", t("ตามนโยบาย", "Per policy")],
          ["CARTON-EMPTY", "5 PIECE", "10.00", t("ตามนโยบาย", "Per policy")],
        ]} />
        <p>{t("เมื่อของมาถึง เปิด PO แล้วกดรับสินค้า กรอกจำนวนรับจริง เลขล็อต และวันหมดอายุหากนโยบายบังคับ ตรวจสาขาปลายทางก่อนยืนยัน: หน้ารับ PO แอดมินปัจจุบันรับเข้าที่สาขาเริ่มต้น", "When goods arrive, open the PO and receive the actual quantity, lot and expiry date when required. Verify the destination branch before posting: the current admin PO screen receives into the default branch.")}</p>
        <p className={g.stockChange}>{t("สต็อก: สร้าง PO = ไม่เปลี่ยน · ยืนยันรับสินค้า = วัตถุดิบเพิ่มตามจำนวนรับจริง", "Stock: create PO = no change · confirm receipt = materials increase by the actual received quantity")}</p>

        <h2 id="bom">4 {t("ตั้ง Checklist เครื่องจักร และ Factory BOM", "Set up checklists, machines and factory BOMs")}</h2>
        <p>{t("ที่ /admin/operations สร้าง Checklist ที่เผยแพร่สำหรับสาขา เช่น ตรวจล็อตวัตถุดิบ ความสะอาดเครื่อง สี ขนาด น้ำหนัก และจำนวนคัดทิ้ง จากนั้นใน Production → เครื่องจักรโรงงาน เพิ่ม EXT-TW-01 เครื่องรีดเชือก 1 และ EXT-ST-01 เครื่องรีดหลอด 1", "In /admin/operations, publish a branch checklist for material lots, machine cleanliness, color, dimensions, weight and rejected output. Then register EXT-TW-01 as Twine Extruder 1 and EXT-ST-01 as Straw Extruder 1 under Production → Factory machines.")}</p>
        <p>{t("ใน Production → BOM โรงงาน กรอกผลผลิตต่อสูตร วัตถุดิบที่ใช้ และ SOP ทีละขั้น", "Under Production → Factory BOM, enter the output yield, input quantities and SOP for each counted stage.")}</p>
        <DataTable headers={[t("ผลผลิตต่อสูตร", "Output per BOM"), t("วัตถุดิบต่อสูตร", "Inputs per BOM")]} rows={[
          ["TWINE-ROLL 1 ROLL", "PP-RAW 990 GRAM + COLOR-RAW 10 GRAM"],
          ["STRAW-LOOSE 1,000 PIECE", "PP-RAW 990 GRAM + COLOR-RAW 10 GRAM"],
          ["STRAW-BAG 1 BAG", "STRAW-LOOSE 100 PIECE + BAG-EMPTY 1 PIECE"],
          ["STRAW-CARTON 1 CARTON", "STRAW-BAG 10 BAG + CARTON-EMPTY 1 PIECE"],
        ]} />
        <p>{t("SOP ตัวอย่างของเชือก: ตรวจล็อต → ผสม → รีดเส้น → ม้วน → ตรวจน้ำหนัก BOM มีเวอร์ชันและตรึงหน่วยฐาน หากเปลี่ยนหน่วยหรือสูตรต้องทบทวนปริมาณและบันทึกเวอร์ชันใหม่", "Example twine SOP: inspect lots → blend → extrude → wind → check weight. BOMs are versioned and pin base units. Review quantities and save a new version after changing a unit or recipe.")}</p>
        <p className={g.stockChange}>{t("สต็อก: บันทึก Checklist เครื่องจักร หรือ BOM = ไม่เปลี่ยน", "Stock: saving checklists, machines or BOMs = no change")}</p>

        <h2 id="production">5 {t("สร้างใบผลิต โพสต์ผลจริง และตรวจ QC", "Create batches, post actual output and review QC")}</h2>
        <p>{t("ถ้ามีคำขอจากลูกค้า ให้เพิ่มลูกค้าใน CRM แล้วสร้างความต้องการผลิต เช่น STRAW-CARTON / STD จำนวน 1 กำหนดงานตามที่ทีมตกลง ความต้องการนี้ยังไม่มีราคา ไม่จองสต็อก และไม่ใช่ออร์เดอร์", "For customer demand, create a CRM customer and a factory demand such as one STRAW-CARTON / STD due at the agreed internal time. Demand has no price, reservation or order yet.")}</p>
        <p>{t("สร้างใบผลิตโดยเลือก BOM สาขา จำนวนที่วางแผน Checklist ที่เผยแพร่ วันครบกำหนด ผู้รับผิดชอบ และเครื่องจักร เปลี่ยนจากร่างเป็นพร้อมผลิต แล้วตรวจวัตถุดิบที่ใช้ได้", "Create each production batch with BOM, branch, planned quantity, published checklist, due time, assignee and machine. Move draft to ready and inspect usable material stock.")}</p>
        <DataTable headers={[t("ใบผลิต", "Batch"), t("จำนวนวางแผน", "Planned output"), t("วัตถุดิบที่คาดใช้", "Expected inputs")]} rows={[
          [t("เชือก", "Twine"), "10 ROLL", "PP 9,900 GRAM + COLOR 100 GRAM"],
          [t("หลอดเปล่า", "Loose straws"), "3,000 PIECE", "PP 2,970 GRAM + COLOR 30 GRAM"],
          [t("หลอดถุง", "Bagged straws"), "20 BAG", "STRAW-LOOSE 2,000 PIECE + BAG-EMPTY 20 PIECE"],
          [t("หลอดลัง", "Cartoned straws"), "1 CARTON", "STRAW-BAG 10 BAG + CARTON-EMPTY 1 PIECE"],
        ]} />
        <p>{t("ตัวอย่างตอนโพสต์ใบเชือก: จำนวนดีจริง 10 ROLL, PP ใช้จริง 9,900 GRAM, สี 100 GRAM, คัดทิ้ง 0, วันที่ผลิตจริง และหมายเหตุ “ผลิตเชือกล็อตทดลอง ตรวจน้ำหนักครบ” กรอกเวลาเครื่อง นาทีแรงงาน และ kWh เฉพาะเมื่อมีหลักฐานจริง ข้อมูลสามรายการหลังเป็นหลักฐาน ยังไม่บวกเป็นต้นทุนแปรสภาพในสต็อก", "Example twine post: 10 good ROLL, 9,900 GRAM PP, 100 GRAM color, zero rejects, actual production date and an inspection note. Record machine time, labor minutes and kWh only when evidenced; those metrics do not add conversion cost to inventory.")}</p>
        <p>{t("ถ้าเปิดนโยบาย QC ผลผลิตล็อตใหม่ถูกพักทันที ผู้ตรวจทำ Checklist แล้วเสนอปล่อยหรือทิ้งล็อต ให้ผู้มีสิทธิ์อีกคนอนุมัติ ระหว่างพักล็อตยังขาย จอง โอน หรือใช้ผลิตต่อไม่ได้ ต้องปล่อยล็อต STRAW-BAG ก่อนนำไปผลิตลัง", "When QC policy is enabled, a new output lot is held immediately. An inspector completes the checklist and proposes release or disposal; another authorized reviewer approves. A held lot cannot be sold, reserved, transferred or consumed. Release the STRAW-BAG lot before using it for cartons.")}</p>
        <p className={g.stockChange}>{t("สต็อก: สร้างใบผลิตหรือกดพร้อมผลิต = ไม่เปลี่ยน · โพสต์ผลจริง = ตัดวัตถุดิบและรับผลผลิตพร้อมล็อตในธุรกรรมเดียว", "Stock: create or ready batch = no change · post actual output = consume inputs and receive the output lot in one transaction")}</p>

        <h2 id="stock">6 {t("ตรวจยอดสต็อกและเริ่มขาย", "Reconcile stock and begin selling")}</h2>
        <p>{t("ตารางนี้สมมติว่ารับ PO ครบ โพสต์ทั้งสี่ใบผลิตสำเร็จ ปล่อยล็อต QC แล้ว และยังไม่มีการขาย", "This balance assumes full PO receipt, all four batches posted, QC holds released and no sales yet.")}</p>
        <DataTable headers={["SKU", t("รับเข้า", "Received"), t("ใช้ผลิต", "Consumed"), t("ผลิตเข้า", "Produced"), t("คงเหลือ", "Balance")]} rows={[
          ["PP-RAW GRAM", "50,000", "12,870", "0", "37,130"],
          ["COLOR-RAW GRAM", "2,000", "130", "0", "1,870"],
          ["BAG-EMPTY PIECE", "100", "20", "0", "80"],
          ["CARTON-EMPTY PIECE", "5", "1", "0", "4"],
          ["TWINE-ROLL ROLL", "0", "0", "10", "10"],
          ["STRAW-LOOSE PIECE", "0", "2,000", "3,000", "1,000"],
          ["STRAW-BAG BAG", "0", "10", "20", "10"],
          ["STRAW-CARTON CARTON", "0", "0", "1", "1"],
        ]} />
        <p>{t("ถ้าล็อตยังถูกพัก QC ยอดทางกายภาพยังมี แต่ยอดใช้ได้จริงต่ำกว่า เมื่อผลิตครบและปล่อยล็อตแล้ว ผู้มีสิทธิ์จึงแปลงความต้องการลูกค้าเป็นออร์เดอร์ ระบบตรวจราคาและสต็อกปัจจุบันอีกครั้ง ออร์เดอร์จองของที่ใช้ได้ และการส่งของตัดสต็อกตามกระบวนการปกติ", "A QC hold leaves physical stock present while usable stock is lower. After production and release, an authorized person may convert demand to an order. The system rechecks current price and usable stock; the order reserves stock and shipment consumes it through the normal workflow.")}</p>
        <p>{t("หลังเริ่มงานให้ตรวจยอดแยกสาขา SKU และล็อต รับ PO ค้างรับ บันทึกของเสีย และตรวจรายการเคลื่อนไหว โอนสาขาแบบส่งแล้วรับ การนับยอดรวมทั่วไปไม่รองรับสินค้าที่ติดตามล็อต ต้องใช้กระบวนการที่รักษาตัวตนล็อต", "After starting, review branch, SKU and lot balances, receive outstanding PO quantities, record wastage and inspect movement history. Transfers send then receive. Aggregate counts do not support lot-tracked goods; preserve lot identity when reconciling.")}</p>
        <p className={g.note}>{t("ก่อนใช้จริง ยืนยันน้ำหนักต่อม้วน จำนวนหลอดต่อถุง/ลัง จุดนับสต็อก สูตรสี ของเสีย เกณฑ์ QC ราคา ภาษี และวิธีขายกับโรงงาน ทดสอบวัตถุดิบไม่พอ ของคัดทิ้ง QC ไม่ผ่าน และสต็อกไม่พอตอนสร้างออร์เดอร์", "Before live use, confirm roll weight, pack quantities, counting points, pigment ratio, rejects, QC criteria, prices, tax and selling terms with the factory. Rehearse insufficient materials, rejects, failed QC and stock shortage at order creation.")}</p>
        <Link className={s.secondary} href={localizedPublicPath("/learn", lang)}>{t("← กลับศูนย์เรียนรู้", "← Back to learning center")}</Link>
      </article>
    </div>
  </div>;
}
