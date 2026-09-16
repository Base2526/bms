// param list ของแต่ละ navigator — ids มาจาก GraphQL และ server เป็นผู้ตรวจ scope ซ้ำเสมอ

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  /**
   * หน้าตั้งค่าเครื่อง — เปิดเองจากหน้า Login หรือถูกเปิดด้วยลิงก์ `bmspos://pair?t=...&h=...`
   * (react-navigation แกะ query string ของ deep link มาเป็น route params ให้เอง จึงเป็น string
   * ดิบที่ยังไม่ผ่านการตรวจ — ต้องส่งเข้า `parsePairingInput()` ก่อนเชื่อเสมอ)
   */
  Settings: { t?: string; h?: string } | undefined;
};

export type SellStackParamList = {
  Menu: undefined;
  Checkout:
    | { source?: 'retail'; tableId?: undefined }
    | { source: 'restaurant'; tableId?: string; checkId?: string }
    | { source: 'board_game'; boardGameBillingGroupId: string };
  Receipt: { saleId: string };
  SalesHistory: undefined;
  SaleDetail: { saleId: string };
};

export type FloorStackParamList = {
  Floor: undefined;
  CheckDetail: {
    tableId?: string;
    checkId?: string;
    serviceMode?: 'DINE_IN' | 'TAKEAWAY';
  };
  /** จอสั่งอาหารของโต๊ะ — ใช้เฉพาะมือถือ (แท็บเล็ตสั่งได้จากหน้าบิลเลย) */
  TableMenu: { tableId: string };
};

export type OrdersStackParamList = {
  IncomingOrders: undefined;
  /**
   * คิว · QR · เรียกพนักงาน · คำขอจากแชท — งานที่ "มีคนรออยู่ปลายทาง" เหมือนออร์เดอร์เข้า
   * จึงอยู่ในสแตกเดียวกันใต้แท็บ "งานเข้า" ไม่ใช่ไปปนกับงานหลังร้านที่ทำนาน ๆ ครั้ง
   */
  RestaurantOps: undefined;
};

export type KitchenStackParamList = {
  KitchenBoard: undefined;
};

export type ShiftStackParamList = {
  Shift: undefined;
};

export type OperationsStackParamList = {
  Operations: undefined;
  Inventory: undefined;
  /**
   * เปิด/ปิดกะสำหรับ **โหมดร้านอาหาร** ซึ่งถอดแท็บกะออกจากแถบเพื่อเอารางไปให้งานที่ใช้ทั้งวัน
   * · โหมดอื่นยังมีแท็บกะของตัวเอง (`ShiftStackParamList`) เพราะแถบไม่ได้แน่น
   */
  Shift: undefined;
};

export type BoardGameStackParamList = {
  BoardGame: undefined;
  BoardGameOpen: { tableId: string };
  BoardGameDetail: { sessionId: string };
};

/**
 * แถบล่างถือได้ 5 แท็บบนจอ 402pt (80pt ต่อแท็บ) — เกินกว่านั้นป้ายไทยเริ่มถูกตัด
 *
 * สิ่งที่อยู่บนแถบตัดสินจาก **ความถี่ระหว่างเปิดร้าน** ไม่ใช่จากความสำคัญของฟีเจอร์:
 * ผังโต๊ะเปิดตลอดเวลา · งานเข้ามี badge ให้ตอบ · ครัวกวาดตาเป็นระยะ ·
 * ส่วนกะ (วันละ 2 ครั้ง) กับงานหลังร้าน ไปอยู่ใต้ "เพิ่มเติม"
 */
export type MainTabParamList = {
  FloorTab: undefined;
  SellTab: undefined;
  OrdersTab: undefined;
  KitchenTab: undefined;
  BoardGameTab: undefined;
  OperationsTab: undefined;
  ShiftTab: undefined;
  /**
   * สามตัวนี้เป็นของ **รางด้านซ้ายบนแท็บเล็ตเท่านั้น**
   *
   * บนมือถือมันอยู่ใต้ "เพิ่มเติม" เพราะแถบล่างมี 5 ช่อง — ข้อจำกัดนั้นไม่มีอยู่บนรางแนวตั้ง
   * ที่สูงเต็มจอ การซ่อนต่อไปคือการคิดค่าผ่านทางเป็นจำนวนแตะ โดยไม่ได้ประหยัดพื้นที่อะไร
   */
  InventoryTab: undefined;
  CounterTab: undefined;
  SupportTab: undefined;
};
