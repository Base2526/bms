export type Lang = "th" | "en";
type Copy = { th: string; en: string };
type FlowNode = {
  icon: string;
  title: Copy;
  detail: Copy;
  explanation: Copy;
  tone?: "green" | "orange" | "purple";
};

export const factoryLanes: { label: Copy; nodes: FlowNode[] }[] = [
  { label: { th: "เริ่มต้น", en: "Setup" }, nodes: [
    { icon: "①", title: { th: "สมัครกิจการ", en: "Sign up" }, detail: { th: "ยืนยันอีเมลและตั้งสาขา", en: "Verify email; set branch" }, explanation: { th: "สมัครกิจการ ยืนยันอีเมล ตั้งสาขาและสิทธิ์ผู้ทำงานแต่ละหน้าที่ ขั้นนี้ยังไม่มีสต็อก", en: "Register, verify email, and set branch and staff permissions. There is no stock yet." } },
    { icon: "▣", title: { th: "สร้าง SKU", en: "Create SKUs" }, detail: { th: "วัตถุดิบ เชือก หลอด ถุง ลัง", en: "Materials, twine, straws, packs" }, explanation: { th: "กำหนด SKU และหน่วยฐานตามจุดที่นับจริง เช่น PP เป็นกรัม เชือกเป็นม้วน และหลอดเป็นชิ้น", en: "Define each counted SKU and base unit, such as resin in grams, twine in rolls and straws in pieces." } },
    { icon: "↓", title: { th: "รับวัตถุดิบ", en: "Receive materials" }, detail: { th: "รับ PO พร้อมล็อต", en: "Receive PO with lots" }, explanation: { th: "รับเม็ด PP สี ถุงเปล่าและกล่องตาม PO ที่ตรวจแล้ว การรับเข้าทำให้วัตถุดิบเพิ่มตามสาขาและล็อต", en: "Receive resin, color, empty bags and cartons against the checked PO. Receipt increases material stock by branch and lot." }, tone: "green" },
    { icon: "≡", title: { th: "ตั้งสูตร BOM", en: "Set BOMs" }, detail: { th: "ตรึงหน่วยและเวอร์ชัน", en: "Pin units and versions" }, explanation: { th: "ตั้ง BOM แยกเชือก หลอดชิ้น หลอดถุง และหลอดลัง สูตรที่บันทึกยังไม่ตัดหรือเพิ่มสต็อก", en: "Version separate BOMs for twine, loose straws, bags and cartons. Saving a BOM does not move stock." }, tone: "purple" },
  ] },
  { label: { th: "สายเชือก", en: "Twine line" }, nodes: [
    { icon: "▤", title: { th: "สร้างใบผลิต", en: "Create batch" }, detail: { th: "เลือก BOM และจำนวนแผน", en: "Choose BOM and planned qty" }, explanation: { th: "สร้างใบผลิตเชือก 10 ม้วน ตรวจวัตถุดิบที่ใช้ได้ แล้วเปลี่ยนเป็นพร้อมผลิต การวางแผนยังไม่เปลี่ยนสต็อก", en: "Plan a 10-roll twine batch and check usable materials. Planning or marking ready does not move stock." }, tone: "purple" },
    { icon: "↗", title: { th: "โพสต์ผลเชือก", en: "Post twine output" }, detail: { th: "ตัด PP/สี รับเชือก 10 ม้วน", en: "Consume inputs; receive 10 rolls" }, explanation: { th: "โพสต์จำนวนดีและวัตถุดิบที่ใช้จริง ระบบตัด PP กับสี และรับเชือกพร้อมล็อตในธุรกรรมเดียว", en: "Post good output and actual inputs. The system consumes resin and color and receives the twine lot in one transaction." }, tone: "green" },
    { icon: "✓", title: { th: "ตรวจ QC เชือก", en: "Twine QC" }, detail: { th: "ปล่อยล็อตก่อนขาย", en: "Release lot before sale" }, explanation: { th: "ถ้าเปิดนโยบาย QC ล็อตเชือกถูกพักทันที ผู้ตรวจเสนอผล และผู้มีสิทธิ์อีกคนอนุมัติการปล่อยล็อต", en: "With QC enabled, the twine lot is held immediately. An inspector proposes a decision and another authorized reviewer releases it." }, tone: "orange" },
  ] },
  { label: { th: "สายหลอด · ผลิตและบรรจุถุง", en: "Straw line · pieces and bags" }, nodes: [
    { icon: "↗", title: { th: "ผลิตหลอดชิ้น", en: "Post loose straws" }, detail: { th: "รับ 3,000 ชิ้น", en: "Receive 3,000 pieces" }, explanation: { th: "โพสต์ใบผลิตหลอดชิ้น ตัด PP กับสี แล้วรับหลอด 3,000 ชิ้นพร้อมล็อต", en: "Post loose-straw production, consuming resin and color and receiving a lot of 3,000 pieces." }, tone: "green" },
    { icon: "✓", title: { th: "ตรวจ QC หลอดชิ้น", en: "Loose-straw QC" }, detail: { th: "ปล่อยล็อตก่อนบรรจุ", en: "Release before packing" }, explanation: { th: "ถ้าเปิดนโยบาย QC ต้องตรวจและปล่อยล็อตหลอดชิ้นก่อนนำ 2,000 ชิ้นไปบรรจุถุง", en: "With QC enabled, inspect and release the loose-straw lot before using 2,000 pieces for bagging." }, tone: "orange" },
    { icon: "▥", title: { th: "บรรจุถุง", en: "Pack bags" }, detail: { th: "ตัด 2,000 ชิ้น รับ 20 ถุง", en: "Use 2,000; receive 20 bags" }, explanation: { th: "หลังปล่อยล็อตที่ใช้ได้ โพสต์งานบรรจุถุง ตัดหลอด 2,000 ชิ้นและถุงเปล่า 20 ใบ รับผลผลิต 20 ถุง", en: "After lot release, post bagging: consume 2,000 straws and 20 empty bags, then receive 20 packed bags." }, tone: "green" },
  ] },
  { label: { th: "สายหลอด · บรรจุลัง", en: "Straw line · cartons" }, nodes: [
    { icon: "✓", title: { th: "ตรวจ QC ถุง", en: "Bag QC" }, detail: { th: "ปล่อยล็อตก่อนขึ้นลัง", en: "Release before cartoning" }, explanation: { th: "ตรวจและปล่อยล็อตหลอดถุงก่อนนำ 10 ถุงไปบรรจุเป็นลัง ล็อตที่พักอยู่ยังใช้ผลิตต่อไม่ได้", en: "Inspect and release the bag lot before using 10 bags for cartoning. A held lot cannot be used downstream." }, tone: "orange" },
    { icon: "▣", title: { th: "บรรจุลัง", en: "Pack carton" }, detail: { th: "ตัด 10 ถุง รับ 1 ลัง", en: "Use 10 bags; receive 1 carton" }, explanation: { th: "หลังปล่อยล็อตถุงที่ใช้ได้ โพสต์งานบรรจุลัง ตัด 10 ถุงกับกล่องเปล่า 1 ใบ รับหลอด 1 ลัง", en: "After releasing the bag lot, post cartoning: consume 10 bags and one empty carton, then receive one finished carton." }, tone: "green" },
    { icon: "✓", title: { th: "ตรวจ QC ลัง", en: "Carton QC" }, detail: { th: "ปล่อยล็อตก่อนขาย", en: "Release before sale" }, explanation: { th: "ตรวจและปล่อยล็อตหลอดลังที่ใช้ได้ก่อนสร้างออร์เดอร์ ล็อตที่พัก QC ยังอยู่ในยอดกายภาพแต่ขายหรือจองไม่ได้", en: "Inspect and release the finished carton lot before ordering. A QC-held lot remains in physical stock but cannot be sold or reserved." }, tone: "orange" },
  ] },
  { label: { th: "ยอดสุดท้าย", en: "Final balance" }, nodes: [
    { icon: "▦", title: { th: "เทียบยอดสต็อก", en: "Reconcile stock" }, detail: { th: "แยกสาขา SKU และล็อต", en: "By branch, SKU and lot" }, explanation: { th: "หลังรับเข้าและโพสต์ทั้งสี่ใบผลิต ตัวอย่างคงเหลือ PP 37,130 กรัม เชือก 10 ม้วน หลอดชิ้น 1,000 ชิ้น ถุง 10 ถุง และลัง 1 ลัง", en: "After receipt and four posted batches, example balances are 37,130 g resin, 10 twine rolls, 1,000 loose straws, 10 bags and 1 carton." } },
    { icon: "→", title: { th: "สร้างออร์เดอร์", en: "Create order" }, detail: { th: "ตรวจราคาและของที่ใช้ได้", en: "Recheck price and usable stock" }, explanation: { th: "เมื่อผลิตครบและปล่อยล็อตแล้ว ผู้มีสิทธิ์จึงแปลงความต้องการเป็นออร์เดอร์ ระบบตรวจราคาและสต็อกที่ใช้ได้อีกครั้ง การสร้างออร์เดอร์จองสต็อกแต่ยังไม่ตัดยอดทางกายภาพ", en: "After production and lot release, an authorized person converts demand to an order. The system rechecks price and usable stock. Order creation reserves stock but does not consume physical stock." } },
  ] },
];

export const factoryNodes = factoryLanes.flatMap((lane) => lane.nodes);

