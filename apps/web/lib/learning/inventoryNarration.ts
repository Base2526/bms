export type InventoryNarrationTarget =
  | "product" | "receiving" | "sellable" | "reservation" | "handoff" | "deduction"
  | "transfer" | "transit" | "outcome"
  | "snapshot" | "physical-count" | "approve-delta" | "adjust-delta"
  | "customer" | "owner";

export type InventoryNarrationCue = {
  target: InventoryNarrationTarget;
  text: string;
};

export const inventoryNarrationCues: Record<"th" | "en", readonly InventoryNarrationCue[]> = {
  th: [
    { target: "product", text: "เริ่มจากตั้งข้อมูลสินค้า เอสเคยู ตัวเลือก แพ็ก และหน่วยนับให้ชัดเจน เพื่อให้ทุกช่องทางใช้สินค้าและหน่วยเดียวกัน" },
    { target: "receiving", text: "เมื่อสั่งซื้อและรับสินค้า ระบบอ้างอิงใบสั่งซื้อ จำนวนที่มาถึงจริง ต้นทุน สาขา และหลักฐานการรับเข้า" },
    { target: "sellable", text: "สินค้าที่รับและผ่านเงื่อนไขแล้วจึงอยู่ในยอดพร้อมขาย โดยแยกตามสาขาและไม่ปนกับยอดจองหรือของกักกัน" },
    { target: "reservation", text: "เมื่อมีออร์เดอร์จากหน้าร้าน ไลน์โอเอ หรือโซเชียล ระบบจองสินค้าให้บิลที่ถือของ เพื่อไม่ขายชิ้นเดียวกันซ้ำ" },
    { target: "handoff", text: "หลังตรวจการชำระและส่งมอบสินค้า ระบบใช้ข้อมูลบิลจริงเป็นหลักฐานว่าการขายสำเร็จ" },
    { target: "deduction", text: "เมื่อตกลงขายสำเร็จ ระบบจึงตัดสต็อกและบันทึกรายการเคลื่อนไหวในธุรกรรมเดียวกัน" },
    { target: "transfer", text: "การโอนระหว่างสาขาเริ่มจากคำขอและการอนุมัติ ยอดปลายทางยังไม่เพิ่มจนกว่าจะรับสินค้าจริง" },
    { target: "transit", text: "หลังสาขาต้นทางส่งของ สินค้าจะอยู่สถานะระหว่างทาง เพื่อแยกจากยอดพร้อมขายของทั้งสองสาขา" },
    { target: "outcome", text: "สาขาปลายทางบันทึกจำนวนรับจริง ส่วนต่าง ของเสีย ของกักกัน หรือสูญหายตามหลักฐาน โดยไม่เพิ่มยอดผิด" },
    { target: "snapshot", text: "การตรวจนับเริ่มจากบันทึก Snapshot ของยอดระบบ ณ วันเวลา เพื่อไม่ให้ยอดขายระหว่างนับถูกทับหาย" },
    { target: "physical-count", text: "พนักงานนับของจริงตามหน้างานและบันทึกจำนวนที่พบ โดยยังไม่ปรับยอดทันที" },
    { target: "approve-delta", text: "ผู้มีสิทธิ์ตรวจสอบผลต่าง สาเหตุ และหลักฐาน ก่อนอนุมัติการแก้ยอด" },
    { target: "adjust-delta", text: "เมื่ออนุมัติแล้ว ระบบปรับเฉพาะ Delta ระหว่างยอดนับจริงกับ Snapshot พร้อมบันทึกประวัติตรวจสอบ" },
    { target: "customer", text: "เมื่อต่อและเปิดช่องทางของร้าน ลูกค้าสามารถทักไลน์โอเอ เฟซบุ๊ก อินสตาแกรม หรือเว็บแชต ให้เอไอตรวจสินค้า ราคา สินค้าทดแทน และสถานะออร์เดอร์จากข้อมูลที่อนุญาต" },
    { target: "owner", text: "แอดมินที่ผ่านการตรวจสิทธิ์ สามารถให้เอไอวิเคราะห์ยอดขาย ความเร็วการขาย และจำนวนวันที่สต็อกน่าจะเพียงพอ แยกตามสินค้า สาขา และช่วงเวลา ตรวจของเสี่ยงหมด ของเกินความต้องการ ของค้างคลัง หรือไม่มีการเคลื่อนไหว รวมถึงยอดจอง สินค้าระหว่างทาง ของกักกัน สูญหาย ของเสีย และผลต่างจากการตรวจนับ เอไอช่วยเปรียบเทียบสาขา อธิบายหลักฐาน แนะนำจำนวนเติมหรือการโอน และส่งออกรายงาน เอ็กเซล ซีเอสวี หรือพีดีเอฟได้ แต่การสร้างใบสั่งซื้อ การโอน และการปรับยอดจริง ต้องให้คนที่มีสิทธิ์ตรวจและยืนยัน" },
  ],
  en: [
    { target: "product", text: "Start with clear product, SKU, variant, pack and counting-unit data so every channel uses the same catalog and units." },
    { target: "receiving", text: "Purchasing and receiving reference the purchase order, actual quantity, cost, branch and receiving evidence." },
    { target: "sellable", text: "Only received stock that passes its checks becomes sellable, separated by branch from reservations and quarantine." },
    { target: "reservation", text: "Orders from the counter, LINE OA or social channels reserve stock for the bill that holds it, preventing a duplicate sale." },
    { target: "handoff", text: "After payment review and handoff, the completed bill is the evidence that the sale succeeded." },
    { target: "deduction", text: "A completed sale deducts stock and records its movement in the same transaction." },
    { target: "transfer", text: "A branch transfer starts with a request and approval. The destination balance does not increase before actual receipt." },
    { target: "transit", text: "After dispatch, stock is in transit and excluded from the sellable balance of both branches." },
    { target: "outcome", text: "The destination records the actual receipt, variance, damage, quarantine or loss from evidence without inflating stock." },
    { target: "snapshot", text: "A count begins with a system snapshot at a defined time, so sales during counting are not overwritten." },
    { target: "physical-count", text: "Staff record the physical quantity found on site without immediately changing the balance." },
    { target: "approve-delta", text: "An authorized person reviews the variance, reason and evidence before approving an adjustment." },
    { target: "adjust-delta", text: "After approval, the system applies only the delta between the physical count and snapshot, with an audit trail." },
    { target: "customer", text: "On connected and enabled shop channels, customers can ask AI to verify products, prices, alternatives and order status using only approved customer-safe data." },
    { target: "owner", text: "Authorized admins can ask AI to analyze sales velocity and estimated days of stock by product, branch and period; identify stockout, overstock, dead-stock or no-movement risk; and review reservations, transit, quarantine, loss, waste and count variance. AI can compare branches, explain evidence, recommend replenishment or transfer quantities and export XLSX, CSV or PDF, while purchase orders, transfers and real balance adjustments require authorized human confirmation." },
  ],
};
