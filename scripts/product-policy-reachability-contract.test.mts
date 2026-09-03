// สัญญาว่า "ทุกตัวเลือกในฟอร์มสินค้าต้องมีทางไปต่อจนเปิดขายได้"
//
// ทำไมต้องมีเทสชุดนี้: ดรอปดาวน์รูปแบบสต็อกยื่นครบ 7 ค่ามาตั้งแต่ 9.40 แต่ 2 ค่าเป็น
// ทางตันถาวรอยู่หลายเดือนโดยไม่มีอะไรฟ้อง —
//   · SERIALIZED ต้องการ `bms_products.serial_tracked` ซึ่งไม่มีที่ไหนในแอปตั้งได้เลย
//     (ผู้เขียนคอลัมน์นี้ตัวเดียวคือปุ่มทำสำเนาสินค้า)
//   · BUNDLE ต้องการ `is_bundle` + แถวใน `bms_product_bundle_items` ซึ่งไม่มีทั้งคู่
// ทั้งสองข้อ tsc จับไม่ได้ เพราะ "ตัวเลือกที่กดแล้วตัน" ไม่ใช่ type error — มันคือ
// ร้านที่สร้างสินค้าแล้วเปิดขายไม่ได้ตลอดไปโดยข้อความ blocker ก็ไม่ได้บอกทางออก
//
// อีกครึ่งหนึ่งคุมกฎ `external`: ข้อที่แก้ที่ฟอร์มไม่ได้ต้องบล็อกแค่ "การเปิดขาย"
// ไม่ใช่ "การบันทึกข้อมูลอื่นของสินค้าที่เปิดขายอยู่แล้ว" — ไม่งั้นร้านยาที่มีสินค้า
// เปิดขาย 500 ตัวจะแก้ชื่อสินค้าไม่ได้เลยทั้งร้าน

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  POLICY_FOLLOW_UP_PATH,
  POLICY_REQUIRED_CAPABILITY,
  PRODUCT_STOCK_POLICIES,
  productStockPolicyOptions,
} from "../apps/web/lib/bms/productStockPolicyOptions.ts";
import { SHOP_EXPERIENCE_PROFILES } from "../apps/web/lib/bms/shopExperience.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFileSync(path.join(REPO, relative), "utf8");

/**
 * เทสสแกนซอร์สในไฟล์นี้ต้องตัดคอมเมนต์ก่อนเทียบเสมอ — คอมเมนต์ที่อธิบาย "กฎเก่า"
 * เคยทำให้ assertion เขียว/แดงผิดตัวมาแล้วหลายรอบในเทสตระกูลนี้
 */
const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// 1. ทุกนโยบายต้องไปต่อได้
// ---------------------------------------------------------------------------

test("SERIALIZED มีทางตั้งค่า — ธง serial_tracked ถูก derive จากนโยบาย", () => {
  const policies = withoutComments(source("apps/web/lib/bms/productStockPolicies.ts"));
  // ต้องไม่กลับไปเป็น "ต้องเปิด Serial tracking ที่สินค้าก่อน" ซึ่งไม่มีปุ่มให้เปิด
  assert.doesNotMatch(policies, /throw new Error\("ต้องเปิด Serial tracking/);
  assert.match(policies, /const serialTracked = stockPolicy === "SERIALIZED"/);
  assert.match(policies, /UPDATE bms_products SET serial_tracked/);

  const products = withoutComments(source("apps/web/lib/bms/products.ts"));
  assert.match(products, /requestedPolicy === "SERIALIZED"/);
  assert.match(products, /UPDATE bms_products SET serial_tracked = TRUE/);
});

test("BUNDLE มีทางตั้งค่า — มีบริการเขียนส่วนประกอบและ derive is_bundle", () => {
  const bundles = withoutComments(source("apps/web/lib/bms/productBundles.ts"));
  assert.match(bundles, /INSERT INTO bms_product_bundle_items/);
  assert.match(bundles, /DELETE FROM bms_product_bundle_items/);
  // ธงต้องมาจาก "มีส่วนประกอบไหม" ไม่ใช่สวิตช์อิสระที่ไม่มีใครกดได้
  assert.match(bundles, /UPDATE bms_products SET is_bundle = \$3/);
  assert.match(bundles, /rows\.length > 0/);

  // ต้องมีทางเรียกจากหน้าจอจริง ไม่ใช่ service ที่ไม่มีใครเรียก
  const schema = source("apps/web/graphql/typeDefs.ts");
  assert.match(schema, /bmsSetProductBundleItems\(bundleSku: String!, items: \[BmsBundleItemInput!\]!\)/);
  const resolvers = source("apps/web/graphql/bmsStockCapabilities.ts");
  assert.match(resolvers, /async bmsSetProductBundleItems\(/);
  assert.match(resolvers, /setProductBundleItems\(/);
  const stockModels = source("apps/web/app/(admin)/admin/stock-models/page.tsx");
  assert.match(stockModels, /bmsSetProductBundleItems/);
  assert.match(stockModels, /stockSectionVisible\("BUNDLE"\)/);
});

test("เซ็ตซ้อนเซ็ตถูกปฏิเสธ — view ขยายส่วนประกอบชั้นเดียว", () => {
  const bundles = withoutComments(source("apps/web/lib/bms/productBundles.ts"));
  assert.match(bundles, /is_bundle/);
  assert.match(bundles, /nested/);
  assert.match(bundles, /componentSku === sku/);
});

test("นโยบายที่ต้องใช้ความสามารถ ต้องเป็นตัวที่ readiness ตรวจจริง", () => {
  const readiness = withoutComments(source("apps/web/lib/bms/productConfiguration.ts"));
  const checked = new Set(
    [...readiness.matchAll(/isCapabilityEnabledInTx\([^,]+,[^,]+,\s*"([A-Z_]+)"\)/g)].map((m) => m[1])
  );
  for (const [policy, capability] of Object.entries(POLICY_REQUIRED_CAPABILITY)) {
    assert.ok(
      checked.has(capability as string),
      `${policy} ประกาศว่าต้องใช้ ${capability} แต่ readiness ไม่ได้ตรวจความสามารถนั้น`
    );
  }
  // และในทางกลับกัน: ความสามารถที่ readiness ตรวจสำหรับ "รูปแบบสต็อก" ต้องถูกประกาศไว้
  // ไม่งั้นดรอปดาวน์จะยื่นรูปแบบที่ร้านนี้เปิดขายไม่ได้
  for (const capability of ["RECIPE", "WEIGHTED_PRODUCT"]) {
    assert.ok(
      Object.values(POLICY_REQUIRED_CAPABILITY).includes(capability),
      `readiness ตรวจ ${capability} แต่ไม่มีนโยบายไหนประกาศว่าต้องใช้`
    );
  }
});

test("ดรอปดาวน์ทั้งสองหน้าอ่านลิสต์เดียวกัน ไม่ใช่ลิสต์ที่พิมพ์เอง", () => {
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  const stockModels = withoutComments(source("apps/web/app/(admin)/admin/stock-models/page.tsx"));
  assert.match(productForm, /productStockPolicyOptions\(capabilityIsActive/);
  assert.doesNotMatch(productForm, /\["DIRECT", "PACK", "BUNDLE", "WEIGHTED"/);
  assert.match(stockModels, /POLICY_REQUIRED_CAPABILITY\[option\.value\]/);
  assert.doesNotMatch(stockModels, /\["DIRECT", "PACK", "BUNDLE"\]\.includes/);
});

test("รูปแบบที่ต้องไปตั้งค่าต่อ ชี้ไปหน้าที่ทำได้จริง", () => {
  for (const [policy, route] of Object.entries(POLICY_FOLLOW_UP_PATH)) {
    const page = path.join("apps/web/app/(admin)", route, "page.tsx");
    assert.doesNotThrow(() => source(page), `${policy} ชี้ไป ${route} ซึ่งไม่มีหน้าอยู่จริง`);
  }
});

test("productStockPolicyOptions ตัดเฉพาะรูปแบบที่ยังเปิดขายไม่ได้", () => {
  const none = productStockPolicyOptions(() => false);
  assert.deepEqual(none, ["DIRECT", "PACK", "BUNDLE", "SERIALIZED", "NON_STOCK"]);
  const all = productStockPolicyOptions(() => true);
  assert.deepEqual([...all], [...PRODUCT_STOCK_POLICIES]);
  // สินค้าที่ตั้งไว้แล้วต้องเห็นค่าเดิมของตัวเองเสมอ ไม่งั้นเปิดมาแก้แล้วช่องว่าง
  assert.ok(productStockPolicyOptions(() => false, "RECIPE").includes("RECIPE"));
});

// ---------------------------------------------------------------------------
// 2. ความสามารถที่ preset ของแต่ละประเภทร้านแนะนำ ต้องตั้งค่าได้จริง
// ---------------------------------------------------------------------------

test("ทุกความสามารถที่ preset แนะนำ มีทางตั้งค่าในแอป", () => {
  // ความสามารถที่ผู้ใช้ "กดสวิตช์" ไม่ได้ ต้องมีทางอื่นที่ทำให้มันเกิดขึ้นจริง
  // (ตรวจพบจากข้อมูล) — ไม่งั้น preset จะแนะนำสิ่งที่ร้านทำตามไม่ได้
  const detectors = withoutComments(source("apps/web/lib/bms/storeCapabilities.ts"));
  const gating = withoutComments(source("apps/web/lib/bms/storeCapabilities.ts"))
    .match(/GATING_CAPABILITIES[^=]*=\s*\[([^\]]+)\]/)?.[1] ?? "";
  const recommended = new Set(
    Object.values(SHOP_EXPERIENCE_PROFILES).flatMap((profile) => profile.recommendedCapabilities)
  );
  for (const capability of recommended) {
    const switchable = gating.includes(`"${capability}"`);
    const detected = detectors.includes(`SELECT '${capability}'`) || detectors.includes(`UNION ALL SELECT '${capability}'`);
    assert.ok(switchable || detected, `ไม่มีทางทำให้ความสามารถ ${capability} เกิดขึ้นจริง`);
  }
});

test("SERIAL_TRACKING ตรวจพบได้จากข้อมูลที่แอปเขียนเองได้แล้ว", () => {
  const detectors = source("apps/web/lib/bms/storeCapabilities.ts");
  assert.match(detectors, /SERIAL_TRACKING[\s\S]{0,120}serial_tracked/);
  // จุดที่เคยขาด: ไม่มีใครเขียน serial_tracked เลย ความสามารถนี้จึงไม่มีวันติด
  const writers = ["apps/web/lib/bms/productStockPolicies.ts", "apps/web/lib/bms/products.ts"]
    .map((file) => withoutComments(source(file)))
    .filter((code) => /UPDATE bms_products SET serial_tracked/.test(code));
  assert.ok(writers.length >= 2, "ต้องมีทั้งเส้นทางสร้างใหม่และเส้นทางเปลี่ยนนโยบายที่เขียนธงนี้");
});

// ---------------------------------------------------------------------------
// 3. blocker ที่แก้ที่ฟอร์มไม่ได้ ต้องไม่ล็อกการบันทึกข้อมูลอื่น
// ---------------------------------------------------------------------------

test("ร้านยา: readiness รู้จักนโยบายสินค้า และเป็นข้อแบบ external", () => {
  const readiness = withoutComments(source("apps/web/lib/bms/productConfiguration.ts"));
  assert.match(readiness, /PHARMACY_POLICY_REQUIRED/);
  assert.match(readiness, /business_archetype === "pharmacy"/);
  // เงื่อนไขต้องตรงกับที่เส้นทางขายใช้ปฏิเสธบิลจริง
  assert.match(readiness, /status !== "APPROVED"/);
  assert.match(readiness, /external: true/);
  assert.match(readiness, /fixPath: "\/admin\/pharmacy-protocols"/);
  const decision = source("apps/web/lib/bms/pharmacy/productPolicyDecision.ts");
  assert.match(decision, /policy\.status !== "APPROVED"/);
});

test("ด่านตอนบันทึกกรอง external ออก แต่ด่านตอนเปิดขายไม่กรอง", () => {
  const readiness = withoutComments(source("apps/web/lib/bms/productConfiguration.ts"));
  assert.match(
    readiness,
    /assertReadinessAllowsSaveOfActiveProduct[\s\S]{0,240}filter\(\(issue\) => !issue\.external\)/
  );
  // publishProduct ต้องยังใช้ readiness.ready ตรง ๆ — เปิดขายทั้งที่ขายไม่ได้คือคำโกหก
  assert.match(readiness, /export async function publishProduct[\s\S]{0,900}if \(!readiness\.ready\)/);
});

test("ทุกเส้นทางบันทึกใช้ด่านตัวเดียวกัน", () => {
  const files = [
    "apps/web/lib/bms/productConfiguration.ts",
    "apps/web/lib/bms/productRecipes.ts",
    "apps/web/lib/bms/productStockPolicies.ts",
    "apps/web/lib/bms/products.ts",
    "apps/web/lib/bms/productBundles.ts",
  ];
  for (const file of files) {
    const code = withoutComments(source(file));
    if (!code.includes("getProductReadinessInTx")) continue;
    assert.match(code, /assertReadinessAllowsSaveOfActiveProduct\(readiness\)/, file);
    // ห้ามมีด่านที่เขียนเองข้าง ๆ ซึ่งจะกลับไปบล็อกด้วย external
    assert.doesNotMatch(
      code,
      /if \(!readiness\.ready\) \{\s*throw new Error\(`สินค้าที่เปิดขายต้องผ่าน readiness/,
      `${file} ยังมีด่านที่เขียนเอง — ต้องเรียก assertReadinessAllowsSaveOfActiveProduct`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. ช่องในฟอร์มที่เคยทำข้อมูลของประเภทร้านอื่นพัง
// ---------------------------------------------------------------------------

test("โมดัลสินค้าไม่ส่งชื่อหน่วยตายตัวทับแพ็กเดิม", () => {
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  assert.doesNotMatch(productForm, /unitName: "ชิ้น"/);
  const packs = withoutComments(source("apps/web/lib/bms/productPacks.ts"));
  // ไม่ส่งมา = คงของเดิม (กฎเดียวกับ vat_category / price_tiers)
  assert.match(packs, /const requestedUnitName/);
  assert.match(packs, /pack\.unit_name/);
});

test("RESTAURANT_POS ยื่นให้เฉพาะร้านอาหาร (หรือสินค้าที่เปิดไว้แล้ว)", () => {
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  assert.match(
    productForm,
    /isRestaurantShop \|\| \(editing\?\.salesSurfaces \?\? \[\]\)\.includes\("RESTAURANT_POS"\)/
  );
  assert.doesNotMatch(productForm, /specialMode === "RESTAURANT" \|\| showSpecializedTemplates/);
  // และ readiness ต้องเตือนถ้าเปิดช่องทางที่ร้านนี้ไม่มีหน้าจอรองรับ
  const readiness = withoutComments(source("apps/web/lib/bms/productConfiguration.ts"));
  assert.match(readiness, /SURFACE_NOT_SERVED/);
});

test("สถานีครัวแก้ได้จากฟอร์มสินค้า ไม่ใช่แค่หน้า Stock models", () => {
  const schema = source("apps/web/graphql/typeDefs.ts");
  assert.match(schema, /kitchen_station: String/);
  const products = withoutComments(source("apps/web/lib/bms/products.ts"));
  // ไม่ส่งมา = คงค่าเดิม — bulk import ที่ไม่รู้จักฟิลด์นี้ต้องไม่ล้างสถานีทั้งร้าน
  assert.match(products, /input\.kitchen_station !== undefined/);
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  assert.match(productForm, /name="kitchenStation"/);
  assert.match(productForm, /showKitchenStationField \? \{ kitchen_station/);
});

test("รหัสตัวเลือกที่พิมพ์ในหน้าสินค้าไม่ถูกบังคับเป็นตัวพิมพ์ใหญ่", () => {
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  assert.doesNotMatch(productForm, /setNewVariantCode\(event\.target\.value\.toUpperCase\(\)\)/);
  assert.match(productForm, /setNewVariantCode\(event\.target\.value\)/);
});

test("ร้านที่ไม่จด VAT ไม่ถูกถามประเภท VAT และค่าเดิมไม่ถูกล้าง", () => {
  const productForm = withoutComments(source("apps/web/app/(admin)/admin/products/page.tsx"));
  assert.match(productForm, /vatRegistered && <Form\.Item/);
  // ไม่ส่ง vat_category เมื่อไม่มีช่อง — backend คงค่าเดิมด้วย COALESCE
  assert.match(productForm, /vatRegistered \? \{ vat_category/);
  const products = withoutComments(source("apps/web/lib/bms/products.ts"));
  assert.match(products, /vat_category = COALESCE\(\$14, bms_products\.vat_category\)/);
});

// ---------------------------------------------------------------------------
// 5. เอกสาร GraphQL ของสองหน้านี้ต้อง validate กับ schema จริง
// ---------------------------------------------------------------------------

/**
 * เทสในตระกูลนี้ทั้ง repo "regex ใส่สตริง SDL" เท่านั้น ไม่มีที่ไหน parse schema จริง
 * — ซึ่งคือช่องที่ทำให้กระดานครัวพังทั้งหน้าตอน 9.44 (`orderId: ID!` ชนกับตั๋วที่ยังไม่มี
 * ออร์เดอร์) เพราะฟิลด์ที่หน้าจอถามกับที่ schema ประกาศไม่ตรงกันจะรู้ตอน runtime เท่านั้น
 */
test("schema parse ผ่าน และ query/mutation ของหน้าสินค้า+Stock models ตรงกับ schema", async () => {
  // ⚠️ ชื่อโมดูล "graphql" ในโปรเจกต์นี้ resolve ไปที่โฟลเดอร์ `apps/web/graphql/`
  // ของตัวเอง (tsconfig paths ซึ่ง tsx ก็ทำตาม แม้ผ่าน createRequire) ไม่ใช่ไลบรารี
  // — ต้องชี้เข้าไฟล์ใน node_modules ตรง ๆ
  const requireFromWeb = createRequire(path.join(REPO, "apps/web/package.json"));
  const { parse, validate } = requireFromWeb("./node_modules/graphql/index.js");
  // ประกอบ schema ด้วยตัวเดียวกับที่ route ใช้ (`makeExecutableSchema`) ไม่ใช่ buildSchema
  // — typeDefs ของ repo นี้ประกาศ `type Chat` ซ้ำสองที่ (บรรทัด 40 กับ 233) ซึ่ง
  // graphql-tools merge ให้ แต่ buildSchema ปฏิเสธ · ถ้าใช้คนละตัวกับ runtime
  // เทสจะบอกคนละความจริงกับของจริง
  const { makeExecutableSchema } = requireFromWeb("./node_modules/@graphql-tools/schema/cjs/index.js");
  const { typeDefs } = await import("../apps/web/graphql/typeDefs.ts");
  const schema = makeExecutableSchema({ typeDefs });

  const pages = [
    "apps/web/app/(admin)/admin/products/page.tsx",
    "apps/web/app/(admin)/admin/stock-models/page.tsx",
  ];
  let checked = 0;
  for (const page of pages) {
    const code = source(page);
    for (const match of code.matchAll(/gql`([\s\S]*?)`/g)) {
      const document = match[1];
      // ข้ามเอกสารที่ประกอบด้วย interpolation (ไม่มีในสองหน้านี้วันนี้ แต่กันไว้)
      if (document.includes("${")) continue;
      const errors = validate(schema, parse(document));
      assert.deepEqual(
        errors.map((error) => error.message),
        [],
        `${page}: ${document.slice(0, 80).trim()}`
      );
      checked += 1;
    }
  }
  // กันเคสที่ regex พลาดแล้วเทสเขียวเพราะไม่ได้ตรวจอะไรเลย
  assert.ok(checked >= 10, `ตรวจเอกสารได้แค่ ${checked} ชุด — ตัวดึงเอกสารคงพลาด`);
});
