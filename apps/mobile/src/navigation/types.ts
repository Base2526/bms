import type { NavigatorScreenParams } from '@react-navigation/native';

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
};

export type AppStackParamList = {
  /** แถบแท็บมีเฉพาะหน้าหลัก งานที่ drill down จะถูก push เหนือ route นี้ */
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Checkout:
    | { source?: 'retail'; tableId?: undefined }
    | { source: 'restaurant'; tableId?: string; checkId?: string }
    | { source: 'board_game'; boardGameBillingGroupId: string };
  Receipt: {
    saleId: string;
    source: 'retail' | 'restaurant' | 'board_game';
  };
  SalesHistory: undefined;
  SaleDetail: { saleId: string };
  CheckDetail: {
    tableId?: string;
    checkId?: string;
    serviceMode?: 'DINE_IN' | 'TAKEAWAY';
  };
  RestaurantOps:
    | { initialView?: 'OVERVIEW' | 'QUEUE' | 'QR' | 'CALLS' | 'REQUESTS' }
    | undefined;
  InventoryDetail: undefined;
  ShiftDetail: undefined;
  BoardGameOpen: { tableId: string; queueEntryId?: string };
  BoardGameDetail: { sessionId: string };
};

export type FloorStackParamList = {
  Floor: undefined;
};

export type OrdersStackParamList = {
  IncomingOrders: undefined;
};

export type KitchenStackParamList = {
  KitchenBoard: undefined;
};

export type ShiftStackParamList = {
  Shift: undefined;
};

export type InventoryStackParamList = {
  Inventory: undefined;
};

export type OperationsStackParamList = {
  Operations: undefined;
};

export type BoardGameStackParamList = {
  BoardGame: undefined;
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
   * สต็อกเป็นปลายทางตรงของร้าน Board Game ทุกขนาดจอตาม register mockup และของร้านอื่นบน
   * **แท็บเล็ต non-restaurant เท่านั้น**
   *
   * ร้านอาหารใช้ห้าช่องกับงานหน้าร้านครบแล้วจึงอยู่ใต้ "เพิ่มเติม" เพื่อให้แถบล่างทุกขนาดจอ
   * มีไม่เกินห้าช่อง
   */
  InventoryTab: undefined;
};
