import { query } from "@/lib/db";
import { getPublicShop, listPublicProducts, type PublicProductCard, type PublicShop } from "./products";

export type DemoShopKey = "fashion" | "food" | "beauty" | "grocery" | "gadgets";

export type DemoShopDefinition = {
  key: DemoShopKey;
  label: string;
  archetypeLabel: string;
  tenantSlug: string;
  fallbackShopName: string;
  businessArchetype:
    | "fashion"
    | "food_beverage"
    | "beauty_personal_care"
    | "mini_mart"
    | "gadgets_accessories";
  angle: string;
  starterPrompts: string[];
};

export const DEMO_SHOPS: Record<DemoShopKey, DemoShopDefinition> = {
  fashion: {
    key: "fashion",
    label: "ร้านเสื้อผ้า",
    archetypeLabel: "ไซซ์ สี และสินค้าทดแทน",
    tenantSlug: "demo-fashion",
    fallbackShopName: "Nami Studio",
    businessArchetype: "fashion",
    angle: "variant + alternative + restock",
    starterPrompts: ["เดรสสีดำมีไซซ์ M ไหม", "ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย", "มีโปรถ้าซื้อ 2 ตัวไหม"],
  },
  food: {
    key: "food",
    label: "ร้านอาหาร / delivery",
    archetypeLabel: "เมนูพร้อมขายและ add-on",
    tenantSlug: "demo-food",
    fallbackShopName: "QuickBite Kitchen",
    businessArchetype: "food_beverage",
    angle: "fast order + delivery",
    starterPrompts: ["วันนี้มีข้าวกะเพราไหม", "เพิ่มไข่ดาวได้ไหม", "ส่งถึงคอนโดใช้เวลาประมาณเท่าไร"],
  },
  beauty: {
    key: "beauty",
    label: "ร้าน beauty",
    archetypeLabel: "consultative selling และ routine",
    tenantSlug: "demo-beauty",
    fallbackShopName: "Lumi Skin",
    businessArchetype: "beauty_personal_care",
    angle: "routine + consultative",
    starterPrompts: ["ผิวแพ้ง่ายควรเริ่มตัวไหน", "มีเซ็ตล้างหน้า-บำรุงไหม", "ถ้าตัวหลักหมดมีตัวแทนไหม"],
  },
  grocery: {
    key: "grocery",
    label: "ร้านของชำ / minimart",
    archetypeLabel: "หลายชิ้นและของหมดบ่อย",
    tenantSlug: "demo-minimart",
    fallbackShopName: "Daily Mart",
    businessArchetype: "mini_mart",
    angle: "basket + restock",
    starterPrompts: ["มีมาม่าต้มยำไหม", "เอาโค้ก 2 ขวดด้วย", "ถ้าของโปรหมดช่วยแจ้งด้วย"],
  },
  gadgets: {
    key: "gadgets",
    label: "ร้าน gadget",
    archetypeLabel: "compatibility และ cross-sell",
    tenantSlug: "demo-gadget",
    fallbackShopName: "Spark Mobile",
    businessArchetype: "gadgets_accessories",
    angle: "compatibility + bundle",
    starterPrompts: ["เคส iPhone 15 Pro มีไหม", "มีกระจกกับสายชาร์จที่เข้ากันไหม", "ถ้าเคสหมดมีรุ่นอื่นแทนไหม"],
  },
};

export function getDemoShopDefinition(value: string | null | undefined): DemoShopDefinition {
  const normalized = (value || "").trim().toLowerCase();
  return DEMO_SHOPS[(normalized in DEMO_SHOPS ? normalized : "fashion") as DemoShopKey];
}

export type DemoShopSnapshot = {
  definition: DemoShopDefinition;
  shop: PublicShop | null;
  products: PublicProductCard[];
  ready: boolean;
};

export type DemoTenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  productCount: number;
};

export async function getDemoShopSnapshot(key: string | null | undefined): Promise<DemoShopSnapshot> {
  const definition = getDemoShopDefinition(key);
  const shop = await getPublicShop(definition.tenantSlug);
  const products = shop ? await listPublicProducts(shop.slug, { limit: 12 }) : [];
  return {
    definition,
    shop,
    products,
    ready: !!shop && products.length > 0,
  };
}

export async function getDemoTenantContext(key: string | null | undefined): Promise<DemoTenantContext | null> {
  const definition = getDemoShopDefinition(key);
  const result = await query<{
    tenant_id: string;
    slug: string;
    name: string;
    product_count: string;
  }>(
    `SELECT t.id AS tenant_id,
            t.slug,
            t.name,
            COUNT(p.sku)::text AS product_count
       FROM bms_tenants t
       LEFT JOIN bms_products p
         ON p.tenant_id = t.id
        AND p.active = TRUE
      WHERE t.slug = $1
        AND t.active = TRUE
      GROUP BY t.id, t.slug, t.name
      LIMIT 1`,
    [definition.tenantSlug]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    productCount: Math.max(0, Number(row.product_count) || 0),
  };
}

export function summarizeDemoProducts(products: PublicProductCard[], limit = 8): string {
  return products
    .slice(0, limit)
    .map((product) => {
      const stockLabel = product.available > 0 ? `พร้อมขาย ${product.available}` : "ของหมด";
      const category = product.category ? `หมวด ${product.category}` : null;
      return [product.name, `SKU ${product.sku}`, `${product.price.toLocaleString("th-TH")} บาท`, stockLabel, category]
        .filter(Boolean)
        .join(" | ");
    })
    .join("; ");
}
