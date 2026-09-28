import type { PoolClient } from "pg";

import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { normalizeShopArchetype, shopArchetypeHasStarterCatalog, type ShopArchetype } from "./shopArchetypes";

export type SampleDataMode = "STARTER_CATALOG" | "FULL_DEMO";
export type SampleRunStatus = "RUNNING" | "ACTIVE" | "FAILED" | "DELETING" | "DELETED";

type StockPolicy = "DIRECT" | "PACK" | "BUNDLE" | "WEIGHTED" | "RECIPE" | "SERIALIZED" | "NON_STOCK";
type SalesSurface = "RETAIL_POS" | "RESTAURANT_POS" | "PUBLIC_STOREFRONT" | "CUSTOMER_AI" | "ONLINE_ORDER";

type StarterProduct = {
  code: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  variants?: string[];
  stockPolicy?: StockPolicy;
  baseUnit?: string;
  surfaces?: SalesSurface[];
  description: string;
};

const retail = ["RETAIL_POS"] as SalesSurface[];
const restaurant = ["RESTAURANT_POS"] as SalesSurface[];

const STARTER_CATALOGS: Record<ShopArchetype, StarterProduct[]> = {
  mini_mart: [
    { code: "WATER-600", name: "น้ำดื่ม 600 มล. (ตัวอย่าง)", category: "เครื่องดื่ม", price: 10, cost: 6, description: "ตัวอย่างสินค้าขายเป็นชิ้น" },
    { code: "NOODLE-CUP", name: "บะหมี่ถ้วย (ตัวอย่าง)", category: "ของแห้ง", price: 22, cost: 15, description: "ตัวอย่างสินค้าที่ควรตั้ง lot และวันหมดอายุ" },
    { code: "DETERGENT", name: "น้ำยาล้างจาน (ตัวอย่าง)", category: "ของใช้ในบ้าน", price: 49, cost: 32, variants: ["500ML", "750ML"], description: "ตัวอย่างสินค้าหลายขนาด" },
    { code: "FRUIT-WEIGHT", name: "ผลไม้ชั่งน้ำหนัก (ตัวอย่าง)", category: "ของสด", price: 65, cost: 38, stockPolicy: "WEIGHTED", baseUnit: "GRAM", description: "ตัวอย่างสินค้าชั่งขาย" },
  ],
  fashion: [
    { code: "TEE", name: "เสื้อยืด Cotton (ตัวอย่าง)", category: "เสื้อผ้า", price: 490, cost: 220, variants: ["S", "M", "L", "XL"], description: "ตัวอย่างสินค้าแฟชั่นหลายไซซ์" },
    { code: "DRESS", name: "เดรสทรง A (ตัวอย่าง)", category: "เดรส", price: 1190, cost: 560, variants: ["S", "M", "L"], description: "ตัวอย่างเดรสหลายไซซ์" },
    { code: "JEANS", name: "กางเกงยีนส์ (ตัวอย่าง)", category: "กางเกง", price: 990, cost: 470, variants: ["28", "30", "32", "34"], description: "ตัวอย่าง variant ตามรอบเอว" },
    { code: "BAG", name: "กระเป๋าสะพาย (ตัวอย่าง)", category: "กระเป๋า", price: 790, cost: 350, variants: ["BLACK", "BEIGE"], description: "ตัวอย่าง variant ตามสี" },
  ],
  home_kitchen: [
    { code: "PAN", name: "กระทะสเตนเลส (ตัวอย่าง)", category: "เครื่องครัว", price: 890, cost: 520, variants: ["24CM", "28CM"], description: "ตัวอย่างเครื่องครัวหลายขนาด" },
    { code: "FOOD-BOX", name: "กล่องเก็บอาหาร (ตัวอย่าง)", category: "กล่องเก็บอาหาร", price: 159, cost: 82, variants: ["500ML", "1000ML"], description: "ตัวอย่างสินค้าหลายความจุ" },
    { code: "PLATE-SET", name: "ชุดจาน 6 ใบ (ตัวอย่าง)", category: "จานชาม", price: 590, cost: 310, description: "ตัวอย่างสินค้าขายเป็นชุด" },
    { code: "BLENDER", name: "เครื่องปั่น (ตัวอย่าง)", category: "เครื่องใช้ไฟฟ้า", price: 1590, cost: 980, stockPolicy: "SERIALIZED", description: "ตัวอย่างสินค้าที่ติดตาม serial number" },
  ],
  beauty_personal_care: [
    { code: "CLEANSER", name: "Gentle Cleanser (ตัวอย่าง)", category: "คลีนเซอร์", price: 390, cost: 190, variants: ["120ML", "250ML"], description: "ตัวอย่างเครื่องสำอางที่ควรตั้ง lot/expiry" },
    { code: "SERUM", name: "Barrier Serum (ตัวอย่าง)", category: "เซรั่ม", price: 590, cost: 280, variants: ["15ML", "30ML"], description: "ตัวอย่างเซรั่มหลายขนาด" },
    { code: "SUNSCREEN", name: "Daily Sunscreen (ตัวอย่าง)", category: "ครีมกันแดด", price: 520, cost: 250, description: "ตัวอย่างสินค้าที่ควรตรวจวันหมดอายุ" },
    { code: "COTTON", name: "สำลีแผ่น (ตัวอย่าง)", category: "ของใช้ส่วนตัว", price: 69, cost: 34, description: "ตัวอย่างสินค้าพร้อมขาย" },
  ],
  food_beverage: [
    { code: "COOKIE", name: "คุกกี้ช็อกโกแลต (ตัวอย่าง)", category: "เบเกอรี่", price: 65, cost: 28, description: "ตัวอย่างอาหารพร้อมขาย" },
    { code: "JUICE", name: "น้ำผลไม้ขวด (ตัวอย่าง)", category: "เครื่องดื่ม", price: 45, cost: 22, variants: ["250ML", "500ML"], description: "ตัวอย่างเครื่องดื่มหลายขนาด" },
    { code: "SANDWICH", name: "แซนด์วิชพร้อมขาย (ตัวอย่าง)", category: "อาหารพร้อมทาน", price: 69, cost: 35, description: "ตัวอย่างสินค้าที่ควรตั้ง expiry/wastage" },
    { code: "COFFEE", name: "กาแฟเย็น (ตัวอย่าง)", category: "เครื่องดื่มชง", price: 55, cost: 19, stockPolicy: "NON_STOCK", variants: ["REGULAR", "LARGE"], description: "ตัวอย่างเมนูที่ไม่ตัดสต็อกตรง" },
  ],
  gadgets_accessories: [
    { code: "PHONE-CASE", name: "เคสโทรศัพท์ (ตัวอย่าง)", category: "เคส", price: 390, cost: 150, variants: ["BLACK", "CLEAR"], description: "ตัวอย่างอุปกรณ์เสริมหลายสี" },
    { code: "USB-CABLE", name: "สาย USB-C (ตัวอย่าง)", category: "สายชาร์จ", price: 290, cost: 110, variants: ["1M", "2M"], description: "ตัวอย่างสินค้าหลายความยาว" },
    { code: "CHARGER", name: "หัวชาร์จ USB-C (ตัวอย่าง)", category: "อะแดปเตอร์", price: 690, cost: 330, description: "ตัวอย่างสินค้าพร้อมขาย" },
    { code: "POWERBANK", name: "Power Bank (ตัวอย่าง)", category: "แบตเตอรี่สำรอง", price: 1290, cost: 720, stockPolicy: "SERIALIZED", description: "ตัวอย่างสินค้าที่ติดตาม serial" },
  ],
  b2b_wholesale: [
    { code: "PAPER-A4", name: "กระดาษ A4 (ตัวอย่าง)", category: "กระดาษ", price: 125, cost: 92, variants: ["REAM", "CARTON"], baseUnit: "REAM", description: "ตัวอย่างสินค้าขายเป็นรีมและลัง" },
    { code: "GLOVE", name: "ถุงมืออเนกประสงค์ (ตัวอย่าง)", category: "วัสดุสิ้นเปลือง", price: 180, cost: 110, variants: ["BOX", "CARTON"], baseUnit: "BOX", description: "ตัวอย่างสินค้าขายส่งหลายหน่วย" },
    { code: "TRASH-BAG", name: "ถุงขยะ (ตัวอย่าง)", category: "ของใช้สำนักงาน", price: 89, cost: 48, variants: ["ROLL", "CARTON"], baseUnit: "ROLL", description: "ตัวอย่างม้วนและลัง" },
    { code: "CLEANER", name: "น้ำยาทำความสะอาด (ตัวอย่าง)", category: "เคมีภัณฑ์", price: 390, cost: 240, variants: ["1L", "5L"], baseUnit: "BOTTLE", description: "ตัวอย่างสินค้าหลายบรรจุภัณฑ์" },
  ],
  gifts_seasonal: [
    { code: "GIFT-BOX", name: "กล่องของขวัญ (ตัวอย่าง)", category: "บรรจุภัณฑ์", price: 120, cost: 55, variants: ["S", "M", "L"], description: "ตัวอย่างกล่องหลายขนาด" },
    { code: "CARD", name: "การ์ดอวยพร (ตัวอย่าง)", category: "การ์ด", price: 49, cost: 18, description: "ตัวอย่างสินค้าชิ้นเล็ก" },
    { code: "GIFT-SET", name: "ชุดของขวัญ Everyday (ตัวอย่าง)", category: "Gift Set", price: 790, cost: 390, stockPolicy: "BUNDLE", description: "ตัวอย่าง bundle ที่ต้องกำหนดส่วนประกอบก่อนขาย" },
    { code: "WRAP-SET", name: "ชุดห่อของขวัญ (ตัวอย่าง)", category: "บรรจุภัณฑ์", price: 99, cost: 42, description: "ตัวอย่างสินค้าเสริม" },
  ],
  pharmacy: [
    { code: "MASK", name: "หน้ากากอนามัย (ตัวอย่าง)", category: "ของใช้สุขภาพ", price: 69, cost: 35, description: "ข้อมูลตัวอย่าง ไม่ใช่คำแนะนำทางการแพทย์" },
    { code: "GAUZE", name: "ผ้าก๊อซ (ตัวอย่าง)", category: "ดูแลแผล", price: 45, cost: 22, description: "ข้อมูลตัวอย่าง ต้องตั้งนโยบายก่อนเปิดขาย" },
    { code: "PLASTER", name: "พลาสเตอร์ปิดแผล (ตัวอย่าง)", category: "ดูแลแผล", price: 39, cost: 18, description: "ข้อมูลตัวอย่าง ไม่ใช่คำแนะนำการรักษา" },
    { code: "THERMOMETER", name: "เทอร์โมมิเตอร์ (ตัวอย่าง)", category: "อุปกรณ์สุขภาพ", price: 290, cost: 160, stockPolicy: "SERIALIZED", description: "ข้อมูลตัวอย่าง ต้องให้ผู้รับผิดชอบตรวจสอบก่อนขาย" },
  ],
  pet_supply: [
    { code: "CAT-FOOD", name: "อาหารแมว (ตัวอย่าง)", category: "อาหารสัตว์", price: 220, cost: 145, variants: ["1KG", "3KG"], description: "ตัวอย่างอาหารสัตว์ที่ควรตั้ง lot/expiry" },
    { code: "DOG-TREAT", name: "ขนมสุนัข (ตัวอย่าง)", category: "ขนมสัตว์เลี้ยง", price: 95, cost: 52, description: "ตัวอย่างสินค้าที่ควรตั้ง expiry" },
    { code: "CAT-LITTER", name: "ทรายแมว (ตัวอย่าง)", category: "ทรายและสุขอนามัย", price: 180, cost: 110, variants: ["5L", "10L"], description: "ตัวอย่างสินค้าหลายขนาด" },
    { code: "PET-FOOD-WEIGHT", name: "อาหารสัตว์แบ่งขาย (ตัวอย่าง)", category: "อาหารสัตว์", price: 85, cost: 48, stockPolicy: "WEIGHTED", baseUnit: "GRAM", description: "ตัวอย่างสินค้าชั่งขาย" },
  ],
  building_materials: [
    { code: "CEMENT", name: "ปูนซีเมนต์ 50 กก. (ตัวอย่าง)", category: "ปูนและวัสดุก่อ", price: 145, cost: 118, baseUnit: "BAG", description: "ตัวอย่างสินค้าขายเป็นถุง" },
    { code: "PVC-PIPE", name: "ท่อ PVC (ตัวอย่าง)", category: "ประปา", price: 120, cost: 78, variants: ["1IN", "2IN"], baseUnit: "LENGTH", description: "ตัวอย่างสินค้าหลายขนาด" },
    { code: "WIRE", name: "สายไฟขายเป็นเมตร (ตัวอย่าง)", category: "ไฟฟ้า", price: 25, cost: 16, stockPolicy: "WEIGHTED", baseUnit: "METER", description: "ตัวอย่างสินค้าขายตามความยาว" },
    { code: "DRILL", name: "สว่านไฟฟ้า (ตัวอย่าง)", category: "เครื่องมือช่าง", price: 1890, cost: 1250, stockPolicy: "SERIALIZED", description: "ตัวอย่างเครื่องมือที่ติดตาม serial" },
  ],
  restaurant: [
    { code: "MENU-KAPRAO", name: "ข้าวกะเพรา (ตัวอย่าง)", category: "อาหารจานเดียว", price: 79, cost: 0, stockPolicy: "RECIPE", surfaces: restaurant, description: "เมนูตัวอย่าง ต้องกำหนดสูตรก่อนเปิดขาย" },
    { code: "MENU-COFFEE", name: "กาแฟเย็น (ตัวอย่าง)", category: "เครื่องดื่ม", price: 55, cost: 0, stockPolicy: "NON_STOCK", variants: ["REGULAR", "LARGE"], surfaces: restaurant, description: "เมนูตัวอย่างสำหรับ modifier" },
    { code: "READY-WATER", name: "น้ำดื่ม (ตัวอย่าง)", category: "เครื่องดื่มพร้อมขาย", price: 15, cost: 7, surfaces: restaurant, description: "สินค้าพร้อมขายบน Restaurant POS" },
    { code: "ING-RICE", name: "ข้าวสาร (วัตถุดิบตัวอย่าง)", category: "วัตถุดิบ", price: 0, cost: 42, surfaces: [], baseUnit: "GRAM", description: "วัตถุดิบตัวอย่าง ไม่แสดงบนเมนู" },
  ],
  board_game_cafe: [
    { code: "WATER", name: "น้ำดื่ม (ตัวอย่าง)", category: "เครื่องดื่ม", price: 15, cost: 7, description: "สินค้าขายจริง ไม่ใช่ค่าเวลาเล่น" },
    { code: "SNACK", name: "ขนมขบเคี้ยว (ตัวอย่าง)", category: "ขนม", price: 35, cost: 18, description: "สินค้าขายหน้าร้าน" },
    { code: "SLEEVE", name: "ซองใส่การ์ด (ตัวอย่าง)", category: "Board Game Accessories", price: 120, cost: 70, variants: ["STANDARD", "JAPANESE"], description: "สินค้าเสริมที่ขายออกจริง" },
    { code: "DICE", name: "ชุดลูกเต๋า (ตัวอย่าง)", category: "Board Game Accessories", price: 190, cost: 95, description: "สินค้าเสริม ไม่ใช่เกมที่ให้ยืม" },
  ],
  other: [
    { code: "ITEM", name: "สินค้าทั่วไป (ตัวอย่าง)", category: "ทั่วไป", price: 100, cost: 60, description: "ตัวอย่างสินค้าสต็อกทั่วไป" },
    { code: "ITEM-SIZE", name: "สินค้าหลายขนาด (ตัวอย่าง)", category: "ทั่วไป", price: 150, cost: 90, variants: ["S", "M", "L"], description: "ตัวอย่าง variant" },
    { code: "ITEM-PACK", name: "สินค้าขายเป็นแพ็ก (ตัวอย่าง)", category: "ทั่วไป", price: 250, cost: 140, stockPolicy: "PACK", description: "ตัวอย่างสินค้าที่ต้องตั้ง pack เพิ่มเติม" },
    { code: "ITEM-SERIAL", name: "สินค้าติด Serial (ตัวอย่าง)", category: "ทั่วไป", price: 990, cost: 620, stockPolicy: "SERIALIZED", description: "ตัวอย่างสินค้าที่ติดตาม serial" },
  ],
};

export class SampleDataError extends Error {
  constructor(message: string, readonly code: "INVALID_ARCHETYPE" | "ACTIVE_RUN" | "SKU_CONFLICT" | "NOT_FOUND" | "BLOCKED") {
    super(message);
  }
}

export type SampleProductPreview = {
  sku: string;
  name: string;
  modified: boolean;
  referenced: boolean;
  converted: boolean;
};

export type SampleDataStatus = {
  id: string;
  mode: SampleDataMode;
  archetype: ShopArchetype;
  status: SampleRunStatus;
  generatorVersion: number;
  counts: Record<string, number>;
  products: SampleProductPreview[];
  blocked: boolean;
};

function skuFor(archetype: ShopArchetype, code: string): string {
  return `SAMPLE-${archetype.replaceAll("_", "-").toUpperCase()}-${code}`.slice(0, 120);
}

function uuidOrNull(value: string | number | null | undefined): string | null {
  const normalized = value == null ? "" : String(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function productBaseline(
  item: StarterProduct,
  archetype: ShopArchetype,
  variants: string[],
  surfaces: SalesSurface[],
  stockPolicy: StockPolicy
) {
  const stockBacked = !["NON_STOCK", "RECIPE", "BUNDLE"].includes(stockPolicy);
  return {
    name: item.name,
    price: item.price.toFixed(2),
    category: item.category,
    brand: "BMS Sample",
    description: item.description,
    costPrice: item.cost.toFixed(2),
    keywords: ["sample", archetype, item.code.toLowerCase()].sort(),
    barcode: null,
    imageUrl: null,
    weightGrams: null,
    vatCategory: "UNKNOWN",
    isBundle: false,
    active: false,
    serialTracked: stockPolicy === "SERIALIZED",
    stockPolicy,
    baseUnit: item.baseUnit ?? "PIECE",
    variants: variants.map((variant) => `${variant}:${variant}:true`).sort(),
    surfaces: surfaces.map((surface) => `${surface}:true`).sort(),
    inventory: stockBacked ? variants.map((variant) => `${variant}:0:0:0`).sort() : [],
    packs: stockBacked
      ? variants.map((variant) => `${variant}:BASE:${item.baseUnit ?? "ชิ้น"}:1::true:true`).sort()
      : [],
  };
}

async function loadStatusInTx(client: PoolClient, tenantId: string): Promise<SampleDataStatus | null> {
  const run = await client.query<{
    id: string; mode: SampleDataMode; archetype: ShopArchetype; status: SampleRunStatus;
    generator_version: number; counts: Record<string, number>;
  }>(
    `SELECT id, mode, archetype, status, generator_version, counts
       FROM bms_sample_runs
      WHERE tenant_id = $1
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId]
  );
  if (!run.rows[0]) return null;
  const row = run.rows[0];
  const products = await client.query<{
    entity_key: string; baseline: any; converted_at: Date | null;
    name: string | null; price: string | null; category: string | null; brand: string | null;
    description: string | null; cost_price: string | null; keywords: string[] | null;
    barcode: string | null; image_url: string | null; weight_grams: number | null;
    vat_category: string | null; is_bundle: boolean | null;
    active: boolean | null; serial_tracked: boolean | null;
    stock_policy: string | null; base_unit: string | null;
    variants: string[]; surfaces: string[]; inventory: string[]; packs: string[];
    configured: boolean; referenced: boolean;
  }>(
    `SELECT record.entity_key, record.baseline, record.converted_at,
            product.name, product.price::text, product.category, product.brand, product.description,
            product.cost_price::text, product.keywords, product.barcode, product.image_url,
            product.weight_grams, product.vat_category, product.is_bundle,
            product.active, product.serial_tracked,
            policy.stock_policy, policy.base_unit,
            COALESCE((
              SELECT array_agg(
                       variant.code || ':' || COALESCE(variant.display_name, '') || ':' || variant.active::text
                       ORDER BY variant.code
                     )
                FROM bms_product_variants variant
               WHERE variant.tenant_id = record.tenant_id
                 AND variant.product_sku = record.entity_key
            ), ARRAY[]::text[]) AS variants,
            COALESCE((
              SELECT array_agg(surface.surface || ':' || surface.enabled::text ORDER BY surface.surface)
                FROM bms_product_sales_surfaces surface
               WHERE surface.tenant_id = record.tenant_id
                 AND surface.product_sku = record.entity_key
            ), ARRAY[]::text[]) AS surfaces,
            COALESCE((
              SELECT array_agg(
                       inventory.size || ':' || inventory.current_stock::text || ':' ||
                       inventory.reserved_stock::text || ':' || inventory.reorder_point::text
                       ORDER BY inventory.size
                     )
                FROM bms_inventory inventory
               WHERE inventory.tenant_id = record.tenant_id
                 AND inventory.product_sku = record.entity_key
            ), ARRAY[]::text[]) AS inventory,
            COALESCE((
              SELECT array_agg(
                       COALESCE(pack.size, '') || ':' || pack.pack_code || ':' || pack.unit_name || ':' ||
                       pack.base_qty::text || ':' || COALESCE(pack.price::text, '') || ':' ||
                       pack.is_base::text || ':' || pack.active::text
                       ORDER BY pack.size NULLS FIRST, pack.pack_code
                     )
                FROM bms_product_packs pack
               WHERE pack.tenant_id = record.tenant_id
                 AND pack.product_sku = record.entity_key
            ), ARRAY[]::text[]) AS packs,
            EXISTS (
              SELECT 1 FROM bms_product_images image
               WHERE image.tenant_id = record.tenant_id AND image.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_product_bundle_items bundle
               WHERE bundle.tenant_id = record.tenant_id AND bundle.bundle_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_product_recipes recipe
               WHERE recipe.tenant_id = record.tenant_id AND recipe.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_product_modifiers modifier
               WHERE modifier.tenant_id = record.tenant_id AND modifier.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_product_serials serial
               WHERE serial.tenant_id = record.tenant_id AND serial.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_inventory_lots lot
               WHERE lot.tenant_id = record.tenant_id AND lot.product_sku = record.entity_key
            ) AS configured,
            EXISTS (
              SELECT 1 FROM bms_order_items item
               WHERE item.tenant_id = record.tenant_id AND item.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_purchase_order_items item
               WHERE item.tenant_id = record.tenant_id AND item.product_sku = record.entity_key
              UNION ALL
              SELECT 1 FROM bms_stock_movements movement
               WHERE movement.tenant_id = record.tenant_id AND movement.product_sku = record.entity_key
            ) AS referenced
       FROM bms_sample_records record
       LEFT JOIN bms_products product
         ON product.tenant_id = record.tenant_id AND product.sku = record.entity_key
       LEFT JOIN bms_product_stock_policies policy
         ON policy.tenant_id = record.tenant_id AND policy.product_sku = record.entity_key
      WHERE record.tenant_id = $1 AND record.sample_run_id = $2
        AND record.entity_type = 'PRODUCT'
      ORDER BY record.entity_key`,
    [tenantId, row.id]
  );
  const preview = products.rows.map((product) => {
    const current = {
      name: product.name,
      price: product.price == null ? null : Number(product.price).toFixed(2),
      category: product.category,
      brand: product.brand,
      description: product.description,
      costPrice: product.cost_price == null ? null : Number(product.cost_price).toFixed(2),
      keywords: product.keywords?.slice().sort() ?? null,
      barcode: product.barcode,
      imageUrl: product.image_url,
      weightGrams: product.weight_grams,
      vatCategory: product.vat_category,
      isBundle: product.is_bundle,
      active: product.active,
      serialTracked: product.serial_tracked,
      stockPolicy: product.stock_policy,
      baseUnit: product.base_unit,
      variants: product.variants,
      surfaces: product.surfaces,
      inventory: product.inventory,
      packs: product.packs,
    };
    const baseline = product.baseline ?? {};
    const modified = product.name == null ||
      current.name !== baseline.name ||
      current.price !== baseline.price ||
      current.category !== baseline.category ||
      current.brand !== baseline.brand ||
      current.description !== baseline.description ||
      current.costPrice !== baseline.costPrice ||
      JSON.stringify(current.keywords) !== JSON.stringify([...(baseline.keywords ?? [])].sort()) ||
      current.barcode !== baseline.barcode ||
      current.imageUrl !== baseline.imageUrl ||
      current.weightGrams !== baseline.weightGrams ||
      current.vatCategory !== baseline.vatCategory ||
      current.isBundle !== baseline.isBundle ||
      current.active !== baseline.active ||
      current.serialTracked !== baseline.serialTracked ||
      current.stockPolicy !== baseline.stockPolicy ||
      current.baseUnit !== baseline.baseUnit ||
      JSON.stringify(current.variants) !== JSON.stringify(baseline.variants) ||
      JSON.stringify(current.surfaces) !== JSON.stringify(baseline.surfaces) ||
      JSON.stringify(current.inventory) !== JSON.stringify(baseline.inventory) ||
      JSON.stringify(current.packs) !== JSON.stringify(baseline.packs) ||
      product.configured;
    return {
      sku: product.entity_key,
      name: product.name ?? String(product.baseline?.name ?? product.entity_key),
      modified,
      referenced: Boolean(product.referenced),
      converted: Boolean(product.converted_at),
    };
  });
  return {
    id: row.id,
    mode: row.mode,
    archetype: row.archetype,
    status: row.status,
    generatorVersion: row.generator_version,
    counts: row.counts ?? {},
    products: preview,
    blocked: preview.some((product) => product.modified || product.referenced || product.converted),
  };
}

export async function getSampleDataStatus(tenantId: string): Promise<SampleDataStatus | null> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const status = await loadStatusInTx(client, tenantId);
    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createStarterCatalog(
  tenantId: string,
  requestedBy?: string | number | null
): Promise<SampleDataStatus> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, requestedBy ? { editorId: requestedBy } : undefined);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bms.sample_data'), hashtext($1::text))`, [tenantId]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM bms_sample_runs
        WHERE tenant_id = $1 AND status IN ('RUNNING','ACTIVE','DELETING')
        FOR UPDATE`,
      [tenantId]
    );
    if (existing.rows[0]) {
      const current = await loadStatusInTx(client, tenantId);
      if (current?.status === "ACTIVE") {
        await client.query("COMMIT");
        return current;
      }
      throw new SampleDataError("ร้านนี้มีงานข้อมูลตัวอย่างที่ยังไม่เสร็จ", "ACTIVE_RUN");
    }

    const profile = await client.query<{ business_archetype: string | null }>(
      `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1 FOR SHARE`,
      [tenantId]
    );
    const archetype = normalizeShopArchetype(profile.rows[0]?.business_archetype);
    if (!archetype || !shopArchetypeHasStarterCatalog(archetype)) {
      throw new SampleDataError("ประเภทร้านนี้ไม่มี Starter Catalog ใน release ปัจจุบัน", "INVALID_ARCHETYPE");
    }
    const location = await client.query<{ id: string }>(
      `SELECT id FROM bms_locations
        WHERE tenant_id = $1 AND active
        ORDER BY (code = 'MAIN') DESC, is_head_office DESC, created_at
        LIMIT 1`,
      [tenantId]
    );
    if (!location.rows[0]) throw new Error("ไม่พบสาขาสำหรับสร้าง Starter Catalog");

    const run = await client.query<{ id: string }>(
      `INSERT INTO bms_sample_runs
         (tenant_id, archetype, mode, generator_version, status, requested_by)
       VALUES ($1,$2,'STARTER_CATALOG',1,'RUNNING',$3)
       RETURNING id`,
      [tenantId, archetype, uuidOrNull(requestedBy)]
    );
    const runId = run.rows[0].id;
    const items = STARTER_CATALOGS[archetype];

    for (const item of items) {
      const sku = skuFor(archetype, item.code);
      const variants = item.variants?.length ? item.variants : ["STD"];
      const surfaces = item.surfaces ?? (archetype === "restaurant" ? restaurant : retail);
      const policy = item.stockPolicy ?? "DIRECT";
      const inserted = await client.query(
        `INSERT INTO bms_products
           (tenant_id, sku, name, active, price, keywords, description, cost_price, category, brand, vat_category)
         VALUES ($1,$2,$3,FALSE,$4,$5,$6,$7,$8,'BMS Sample','UNKNOWN')
         ON CONFLICT (tenant_id, sku) DO NOTHING
         RETURNING sku`,
        [tenantId, sku, item.name, item.price, ["sample", archetype, item.code.toLowerCase()], item.description, item.cost, item.category]
      );
      if (!inserted.rowCount) {
        throw new SampleDataError(`SKU ตัวอย่างชนกับสินค้าที่มีอยู่: ${sku}`, "SKU_CONFLICT");
      }
      await client.query(
        `INSERT INTO bms_product_stock_policies (tenant_id, product_sku, stock_policy, base_unit)
         VALUES ($1,$2,$3,$4)`,
        [tenantId, sku, policy, item.baseUnit ?? "PIECE"]
      );
      if (policy === "SERIALIZED") {
        await client.query(
          `UPDATE bms_products SET serial_tracked = TRUE WHERE tenant_id = $1 AND sku = $2`,
          [tenantId, sku]
        );
      }
      for (const [sortOrder, variant] of variants.entries()) {
        await client.query(
          `INSERT INTO bms_product_variants (tenant_id, product_sku, code, display_name, sort_order)
           VALUES ($1,$2,$3,$3,$4)`,
          [tenantId, sku, variant, sortOrder]
        );
        if (policy !== "NON_STOCK" && policy !== "RECIPE" && policy !== "BUNDLE") {
          await client.query(
            `INSERT INTO bms_inventory
               (tenant_id, location_id, product_sku, size, current_stock, reserved_stock, reorder_point)
             VALUES ($1,$2,$3,$4,0,0,0)`,
            [tenantId, location.rows[0].id, sku, variant]
          );
          await client.query(
            `INSERT INTO bms_product_packs
               (tenant_id, product_sku, size, pack_code, unit_name, base_qty, price, is_base, active)
             VALUES ($1,$2,$3,'BASE',$4,1,NULL,TRUE,TRUE)`,
            [tenantId, sku, variant, item.baseUnit ?? "ชิ้น"]
          );
        }
      }
      for (const surface of surfaces) {
        await client.query(
          `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
           VALUES ($1,$2,$3,TRUE)`,
          [tenantId, sku, surface]
        );
      }
      await client.query(
        `INSERT INTO bms_sample_records
           (sample_run_id, tenant_id, entity_type, entity_key, baseline)
         VALUES ($1,$2,'PRODUCT',$3,$4::jsonb)`,
        [runId, tenantId, sku, JSON.stringify(productBaseline(item, archetype, variants, surfaces, policy))]
      );
    }

    await client.query(
      `UPDATE bms_sample_runs
          SET status = 'ACTIVE', counts = $3::jsonb, completed_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId, JSON.stringify({ products: items.length })]
    );
    const result = await loadStatusInTx(client, tenantId);
    if (!result) throw new Error("สร้าง Starter Catalog สำเร็จแต่ไม่พบ Sample Run");
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSampleData(
  tenantId: string,
  requestedBy?: string | number | null
): Promise<{ deletedProducts: number; runId: string }> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, requestedBy ? { editorId: requestedBy } : undefined);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bms.sample_data'), hashtext($1::text))`, [tenantId]);
    const status = await loadStatusInTx(client, tenantId);
    if (!status || status.status === "DELETED") throw new SampleDataError("ไม่พบข้อมูลตัวอย่างที่ลบได้", "NOT_FOUND");
    if (status.status !== "ACTIVE") throw new SampleDataError("ข้อมูลตัวอย่างยังไม่พร้อมให้ลบ", "ACTIVE_RUN");
    if (status.blocked) {
      throw new SampleDataError("ข้อมูลตัวอย่างบางรายการถูกแก้ไข เปิดขาย หรือถูกธุรกรรมอ้างถึง จึงยกเลิกการลบทั้งชุด", "BLOCKED");
    }
    await client.query(
      `UPDATE bms_sample_runs SET status = 'DELETING', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, status.id]
    );
    const skus = status.products.map((product) => product.sku);
    const deleted = await client.query(
      `DELETE FROM bms_products
        WHERE tenant_id = $1 AND sku = ANY($2::text[])
        RETURNING sku`,
      [tenantId, skus]
    );
    if (deleted.rowCount !== skus.length) {
      throw new SampleDataError("จำนวนสินค้าตัวอย่างที่ลบไม่ตรงกับ Sample Run", "BLOCKED");
    }
    await client.query(
      `UPDATE bms_sample_runs
          SET status = 'DELETED', deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, status.id]
    );
    await client.query("COMMIT");
    return { deletedProducts: deleted.rowCount, runId: status.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const __sampleDataTest = {
  catalogs: STARTER_CATALOGS,
  skuFor,
};
