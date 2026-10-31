import { restaurantFlows, type RestaurantFlow, type RestaurantFlowCopy } from "./flowContent";

export type ShopType = "overview" | "restaurant" | "food_beverage" | "board_game_cafe";
export type ServiceStyle = "dine_in" | "counter" | "online";
/** `centralKitchen` only matters with several branches: one branch prepares goods for the others. */
export type GuideProfile = { shop: ShopType; service: ServiceStyle; multiBranch: boolean; centralKitchen?: boolean };
export type FlowFit = "recommended" | "related" | "restaurant_example";
export const PRIMARY_GUIDE_SHOPS = ["overview", "restaurant", "food_beverage"] as const;
export const ADDITIONAL_GUIDE_SHOPS = ["board_game_cafe"] as const;

/** Scope of this public guide only; never an authority for actual store capabilities. */
export function guideFlows(profile: GuideProfile, includeExamples = false) {
  return restaurantFlows.map(flow => flow.id)
    .filter(id => includeExamples || flowFit(id, profile) !== "restaurant_example");
}

export function flowFit(id: number, profile: GuideProfile): FlowFit {
  if (profile.shop === "overview") return "related";
  if (id === 12) {
    if (profile.shop === "board_game_cafe" || !profile.multiBranch) return "restaurant_example";
    return profile.centralKitchen ? "recommended" : "related";
  }
  if (id === 2 && !profile.multiBranch) return "restaurant_example";
  if (profile.shop === "restaurant") {
    if (id === 6 && profile.service !== "dine_in") return "restaurant_example";
    if (id === 3 && profile.service === "online") return "restaurant_example";
    if (id === 2) return profile.multiBranch ? "recommended" : "related";
    if (id === 7) return profile.service === "online" ? "recommended" : "related";
    return [1, 3, 5, 10, 11].includes(id) ? "recommended" : "related";
  }
  if (profile.shop === "food_beverage") {
    if ([5, 6, 7].includes(id)) return "restaurant_example";
    if (id === 2) return profile.multiBranch ? "recommended" : "related";
    return [1, 3, 8, 10, 11].includes(id) ? "recommended" : "related";
  }
  if (id === 3) return "recommended";
  if ([8, 10, 11].includes(id)) return "related";
  return "restaurant_example";
}

const restaurantCounter: Record<"th" | "en", RestaurantFlowCopy> = {
  th: {
    title: "รับออร์เดอร์หน้าเคาน์เตอร์ ส่งครัว และรับเงิน",
    description: "เปิดบิลซื้อกลับบ้าน รับออร์เดอร์ ส่งครัว และรับชำระ โดยไม่ต้องผูกโต๊ะหรือใช้ QR โต๊ะ",
    note: "การขายแบบ Takeaway ไม่มี table_id; งานครัวเกิดเมื่อส่งรอบที่ผ่านการตรวจและจองของแล้ว",
    source: `sequenceDiagram
autonumber
actor Customer as ลูกค้า
actor Staff as พนักงาน
participant POS as บิล Takeaway
participant Stock as สต็อก
participant Kitchen as งานครัว
participant Money as รับชำระ
Staff->>POS: ยืนยันพนักงานและกะขาย
Customer->>Staff: สั่งอาหารและตัวเลือก
Staff->>POS: เปิดบิล Takeaway และเพิ่มรายการ
POS->>POS: ตรวจเมนู ตัวเลือก และราคา
Staff->>POS: ยืนยันส่งรอบ
POS->>Stock: จองวัตถุดิบตามรายการและสูตร
alt ของพร้อมขาย
Stock-->>POS: จองสำเร็จ
POS->>Kitchen: สร้างงานครัวตาม Station
Kitchen-->>Staff: แจ้งอาหารพร้อมส่งมอบ
Staff-->>Customer: ส่งมอบอาหาร
Customer->>Staff: ชำระตามช่องทางที่ร้านเปิดใช้
Staff->>Money: ยืนยันรับชำระด้วยรหัสคำขอเดิม
Money->>Stock: ชำระและตัดสต็อกในธุรกรรมเดียวกัน
Money-->>Customer: แสดงใบเสร็จ
else ของไม่พอหรือขายไม่ได้
Stock-->>Staff: แจ้งรายการให้แก้ก่อนส่งครัว
Staff-->>Customer: ตกลงเปลี่ยนรายการ
end
Note over POS,Money: Takeaway ไม่มีโต๊ะและไม่มี QR โต๊ะ; กดซ้ำต้องไม่ขายซ้ำ`,
  },
  en: {
    title: "Take counter orders, send them to the kitchen and collect payment",
    description: "Open a takeaway check, take the order, send it to the kitchen and collect payment without a table or table QR.",
    note: "Takeaway has no table_id; kitchen work starts after a validated, reserved round is sent.",
    source: `sequenceDiagram
autonumber
actor Customer as Customer
actor Staff as Staff
participant POS as Takeaway check
participant Stock as Inventory
participant Kitchen as Kitchen work
participant Money as Payments
Staff->>POS: Verify staff and open shift
Customer->>Staff: Order dishes and options
Staff->>POS: Open takeaway check and add lines
POS->>POS: Validate menu options and prices
Staff->>POS: Confirm kitchen round
POS->>Stock: Reserve ingredients from lines and recipes
alt Available to sell
Stock-->>POS: Reservation succeeds
POS->>Kitchen: Create station work
Kitchen-->>Staff: Food ready for handover
Staff-->>Customer: Hand over food
Customer->>Staff: Pay by an enabled method
Staff->>Money: Settle with original request reference
Money->>Stock: Settle and deduct stock atomically
Money-->>Customer: Present receipt
else Unavailable or insufficient stock
Stock-->>Staff: Explain what must change before kitchen send
Staff-->>Customer: Agree replacement lines
end
Note over POS,Money: Takeaway has no table QR; retry must not create a second sale`,
  },
};

const cafeCounter: Record<"th" | "en", RestaurantFlowCopy> = {
  th: {
    title: "คาเฟ่: รับออร์เดอร์หน้าเคาน์เตอร์และรับเงิน",
    description: "ขายเครื่องดื่มหรือสินค้า ตรวจราคาและสต็อก แล้วรับชำระผ่าน POS โดยไม่ต้องมีโต๊ะหรืองานครัวแบบร้านอาหาร",
    note: "สูตรเครื่องดื่มและตัวเลือกใช้ได้ตามข้อมูลสินค้าและความสามารถที่ร้านเปิดใช้; คาเฟ่ไม่ถูกบังคับใช้ขั้นตอนออร์เดอร์ออนไลน์เฉพาะร้านอาหาร",
    source: `sequenceDiagram
autonumber
actor Customer as ลูกค้า
actor Cashier as แคชเชียร์
participant Catalog as สินค้าและราคา
participant POS as BMS POS
participant Stock as สต็อก
participant Money as รับชำระ
Cashier->>POS: ยืนยัน PIN สิทธิ์ และกะขาย
Customer->>Cashier: เลือกเครื่องดื่มหรือสินค้า
Cashier->>POS: เพิ่มสินค้า ขนาด และตัวเลือกที่รองรับ
POS->>Catalog: ตรวจราคาและข้อมูลสินค้าจริง
Catalog-->>POS: คืนรายการที่ขายได้
POS->>Stock: ตรวจความพร้อมของสินค้าและส่วนประกอบ
alt ขายได้
Stock-->>POS: ผ่านการตรวจ
POS-->>Cashier: แสดงยอดสุทธิให้ตรวจ
Customer->>Cashier: ชำระตามช่องทางที่ร้านเปิดใช้
Cashier->>Money: ยืนยันรับชำระด้วยรหัสคำขอ
Money->>Stock: บันทึกการขายและตัดสต็อกในธุรกรรมเดียวกัน
Money-->>Customer: แสดงใบเสร็จ
else ข้อมูลไม่ครบหรือขายไม่ได้
Stock-->>Cashier: ระบุรายการที่ต้องแก้
Cashier-->>Customer: ตกลงรายการใหม่
end
Note over POS,Money: การเลือกดูตัวอย่างนี้ไม่เปลี่ยนประเภทร้านหรือการตั้งค่าจริง`,
  },
  en: {
    title: "Cafe: take counter orders and collect payment",
    description: "Sell drinks or goods, check prices and stock, then collect payment in POS without restaurant tables or kitchen workflow.",
    note: "Recipes and options depend on configured products and enabled capabilities; cafes retain ordinary online-order behavior.",
    source: `sequenceDiagram
autonumber
actor Customer as Customer
actor Cashier as Cashier
participant Catalog as Catalog and prices
participant POS as BMS POS
participant Stock as Inventory
participant Money as Payments
Cashier->>POS: Verify PIN permission and shift
Customer->>Cashier: Choose drinks or goods
Cashier->>POS: Add supported products sizes and options
POS->>Catalog: Validate real product and price data
Catalog-->>POS: Return saleable lines
POS->>Stock: Check goods and ingredient availability
alt Ready to sell
Stock-->>POS: Checks pass
POS-->>Cashier: Show final amount for review
Customer->>Cashier: Pay by an enabled method
Cashier->>Money: Settle with request reference
Money->>Stock: Record sale and deduct stock atomically
Money-->>Customer: Present receipt
else Incomplete data or unavailable
Stock-->>Cashier: Identify lines to correct
Cashier-->>Customer: Agree new items
end
Note over POS,Money: Selecting this example does not change the store archetype or configuration`,
  },
};

const boardGame: Record<"th" | "en", RestaurantFlowCopy> = {
  th: {
    title: "บอร์ดเกมคาเฟ่: เปิดโต๊ะ จับเวลา และปิดบิลกลุ่ม",
    description: "แยกเวลาเล่น กลุ่มที่ชำระเงิน และสินค้าหรือเครื่องดื่มในบิล เพื่อคิดยอดแต่ละส่วนได้ถูกต้อง",
    note: "กลุ่มคิดเงินเป็นเจ้าของยอดชำระ โต๊ะเป็นข้อมูลการนั่ง และสิทธิ์เวลา/บัตรผ่านไม่ใช่สินค้าในสต็อก",
    source: `sequenceDiagram
autonumber
actor Guest as ลูกค้า
actor Staff as พนักงาน
participant Session as โต๊ะและเวลาเล่น
participant Group as กลุ่มคิดเงิน
participant Stock as สินค้าและสต็อก
participant POS as รับชำระ
Staff->>Session: ตรวจสิทธิ์และเปิดการนั่งโต๊ะ
Session->>Group: สร้างกลุ่มคิดเงินของผู้เล่น
Guest->>Staff: เล่นเกมและสั่งเครื่องดื่มเพิ่มเติม
Staff->>Group: เพิ่มสินค้าลงบิลของกลุ่ม
Group->>Stock: จองสินค้าที่นำไปใช้จริง
Stock-->>Group: ยืนยันยอดจอง
Staff->>Group: ตรวจเวลาเล่นและขอปิดกลุ่ม
Group->>Group: คำนวณเวลาจากอัตราที่บันทึกไว้
alt มีสิทธิ์บัตรผ่านหรือข้อเสนอที่เข้าเงื่อนไข
Group->>Group: เลือกสิทธิ์ตามกติกาและตรึงยอด
else ไม่มีสิทธิ์เพิ่มเติม
Group->>Group: ตรึงค่าเวลาและค่าสินค้าตามจริง
end
Group-->>Staff: แสดงยอดรวมของกลุ่มให้ตรวจ
Guest->>Staff: ชำระตามช่องทางที่ร้านเปิดใช้
Staff->>POS: ยืนยันชำระของกลุ่มด้วยรหัสคำขอ
POS->>Stock: ตัดสินค้าที่ขายในธุรกรรมชำระ
POS-->>Guest: แสดงใบเสร็จ
Note over Session,POS: เวลาที่เล่นไม่ใช่ SKU และโต๊ะไม่ใช่เจ้าของบิล`,
  },
  en: {
    title: "Board game cafe: seat guests, track time and settle the group",
    description: "Keep play time, the paying group, and food or drinks on its tab separate so each part is charged correctly.",
    note: "The billing group owns money, the session owns seating, and time or passes are not inventory SKUs.",
    source: `sequenceDiagram
autonumber
actor Guest as Guest
actor Staff as Staff
participant Session as Seating and time
participant Group as Billing group
participant Stock as Goods and inventory
participant POS as Payment
Staff->>Session: Verify permission and seat the party
Session->>Group: Create a billing group for players
Guest->>Staff: Play and request drinks
Staff->>Group: Add goods to the group's tab
Group->>Stock: Reserve the goods on the tab
Stock-->>Group: Confirm reservation
Staff->>Group: Review play time and close the group
Group->>Group: Calculate time from the saved rate
alt An eligible pass or offer applies
Group->>Group: Choose permitted coverage and freeze charges
else No additional entitlement
Group->>Group: Freeze actual time and goods charges
end
Group-->>Staff: Present group total for review
Guest->>Staff: Pay by an enabled method
Staff->>POS: Settle the group with request reference
POS->>Stock: Deduct sold goods in settlement
POS-->>Guest: Present receipt
Note over Session,POS: Play time is not a SKU and the table does not own the bill`,
  },
};

export function guideFlowCopy(flow: RestaurantFlow, profile: GuideProfile, lang: "th" | "en"): RestaurantFlowCopy {
  if (flow.id === 3 && profile.shop === "restaurant" && profile.service === "counter") return restaurantCounter[lang];
  if (flow.id === 3 && profile.shop === "food_beverage") return cafeCounter[lang];
  if (flow.id === 3 && profile.shop === "board_game_cafe") return boardGame[lang];
  return flow[lang];
}
