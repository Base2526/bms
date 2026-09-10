// param list ของแต่ละ navigator — แยกไฟล์เดียวไว้กันหน้าจอ import กันเองมั่ว ๆ
// ยังไม่มี prop จริงจาก backend (id ที่ผ่านกันตอนนี้คือ mock id ในโครง)

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
  Checkout: undefined;
  Receipt: undefined;
};

export type FloorStackParamList = {
  Floor: undefined;
  CheckDetail: { tableId: string };
  /** จอสั่งอาหารของโต๊ะ — ใช้เฉพาะมือถือ (แท็บเล็ตสั่งได้จากหน้าบิลเลย) */
  TableMenu: { tableId: string };
};

export type KitchenStackParamList = {
  KitchenBoard: undefined;
};

export type ShiftStackParamList = {
  Shift: undefined;
};

export type MainTabParamList = {
  SellTab: undefined;
  FloorTab: undefined;
  KitchenTab: undefined;
  ShiftTab: undefined;
};
