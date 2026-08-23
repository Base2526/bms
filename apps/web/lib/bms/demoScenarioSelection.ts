import type { ShopArchetype } from "./shopArchetypes";

export type DemoScenarioShop = {
  key: string;
  name: string;
  slug: string;
  businessArchetype: ShopArchetype;
  counts: {
    staff: number;
    posDevices: number;
    products: number;
    customers: number;
    orders: number;
    conversations: number;
    purchase: number;
    coupons: number;
    restockSubscriptions: number;
  };
};

export const DEMO_SCENARIO_SHOPS = [
  {
    key: "fashion",
    name: "Nami Studio",
    slug: "demo-fashion",
    businessArchetype: "fashion",
    counts: { staff: 43, posDevices: 6, products: 1000, customers: 1800, orders: 10000, conversations: 520, purchase: 180, coupons: 36, restockSubscriptions: 180 },
  },
  {
    key: "food",
    name: "QuickBite Kitchen",
    slug: "demo-food",
    businessArchetype: "food_beverage",
    counts: { staff: 47, posDevices: 8, products: 1000, customers: 2200, orders: 10000, conversations: 650, purchase: 260, coupons: 40, restockSubscriptions: 220 },
  },
  {
    key: "beauty",
    name: "Lumi Skin",
    slug: "demo-beauty",
    businessArchetype: "beauty_personal_care",
    counts: { staff: 41, posDevices: 5, products: 1000, customers: 1600, orders: 10000, conversations: 560, purchase: 160, coupons: 44, restockSubscriptions: 180 },
  },
  {
    key: "grocery",
    name: "Daily Mart",
    slug: "demo-minimart",
    businessArchetype: "mini_mart",
    counts: { staff: 49, posDevices: 8, products: 1000, customers: 3000, orders: 10000, conversations: 450, purchase: 300, coupons: 50, restockSubscriptions: 260 },
  },
  {
    key: "gadgets",
    name: "Spark Mobile",
    slug: "demo-gadget",
    businessArchetype: "gadgets_accessories",
    counts: { staff: 39, posDevices: 5, products: 1000, customers: 1400, orders: 10000, conversations: 480, purchase: 140, coupons: 30, restockSubscriptions: 160 },
  },
  {
    key: "pharmacy",
    name: "บ้านยาใส่ใจ",
    slug: "demo-pharmacy",
    businessArchetype: "pharmacy",
    counts: { staff: 45, posDevices: 7, products: 1000, customers: 2200, orders: 10000, conversations: 700, purchase: 240, coupons: 24, restockSubscriptions: 300 },
  },
  {
    key: "general",
    name: "Everyday Market",
    slug: "demo-general",
    businessArchetype: "other",
    counts: { staff: 44, posDevices: 7, products: 1000, customers: 2600, orders: 10000, conversations: 500, purchase: 220, coupons: 40, restockSubscriptions: 220 },
  },
] as const satisfies readonly DemoScenarioShop[];

export type DemoScenarioKey = (typeof DEMO_SCENARIO_SHOPS)[number]["key"];

export const DEMO_SCENARIO_KEYS = DEMO_SCENARIO_SHOPS.map((shop) => shop.key) as DemoScenarioKey[];

export function parseDemoScenarioKey(value: unknown): DemoScenarioKey | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return DEMO_SCENARIO_KEYS.includes(key as DemoScenarioKey) ? key as DemoScenarioKey : null;
}
