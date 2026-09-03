// สัญญาของแคตตาล็อกร้านอาหารที่ seeder ใช้ (apps/web/lib/bms/restaurantCatalogSeed.ts)
//
// ทำไมต้องมีเทสชุดนี้: ข้อมูลชุดนี้พิมพ์ด้วยมือทั้งหมด และผูกกันด้วย "รหัสที่เป็น
// string" — สูตรอ้างวัตถุดิบด้วย code, กลุ่มตัวเลือกอ้างด้วยชื่อคีย์ · tsc จับ
// รหัสที่พิมพ์ผิดไม่ได้เลย ผลของการพิมพ์ผิดคือเมนูที่ "ขายได้ แต่ไม่ตัดวัตถุดิบ"
// ซึ่งเป็นอาการที่มองไม่เห็นจนกว่าจะไปนับสต็อกท้ายวัน
//
// อีกครึ่งหนึ่งของชุดนี้คือกฎที่ฐานข้อมูลบังคับอยู่แล้ว (CHECK/UNIQUE ของ 9.40/9.45/
// 9.51) — ให้แดงที่นี่ในไม่กี่วินาที ดีกว่าไปแดงกลางการ seed แล้วทั้งทรานแซกชัน
// rollback โดยที่ปุ่มบอกแค่ "insert failed"

import assert from "node:assert/strict";
import test from "node:test";

import {
  RESTAURANT_INGREDIENTS,
  RESTAURANT_MENU,
  RESTAURANT_MENU_SERIES,
  RESTAURANT_MODIFIER_GROUPS,
  restaurantMenuName,
  restaurantPackUnitName,
} from "../apps/web/lib/bms/restaurantCatalogSeed.ts";

const ingredientCodes = new Set(RESTAURANT_INGREDIENTS.map((row) => row.code));

test("ทุกรหัสวัตถุดิบที่สูตรอ้างถึงมีอยู่จริง", () => {
  // พิมพ์ผิดตัวเดียว = บรรทัดนั้นถูก `continue` ข้ามเงียบ ๆ ตอน seed
  // เมนูจึงขายได้โดยไม่ตัดของ ซึ่งคือสิ่งที่สูตรมีไว้ป้องกัน
  for (const item of RESTAURANT_MENU) {
    for (const component of item.recipe ?? []) {
      assert.ok(
        ingredientCodes.has(component.code),
        `เมนู ${item.code} อ้างวัตถุดิบ ${component.code} ที่ไม่มีในลิสต์`
      );
      assert.ok(component.qty > 0, `${item.code}/${component.code} ต้องใช้จำนวนมากกว่า 0`);
    }
  }
});

test("วัตถุดิบทุกตัวถูกใช้จริงในสูตรอย่างน้อยหนึ่งเมนู", () => {
  // วัตถุดิบที่ไม่มีสูตรไหนใช้ = สต็อกที่ไม่มีวันขยับ ซึ่งอ่านที่หน้าคลังแล้วสับสน
  // ว่าเป็นของค้างสต็อกจริงหรือของที่ลืมผูกสูตร
  const used = new Set(RESTAURANT_MENU.flatMap((item) => (item.recipe ?? []).map((c) => c.code)));
  const unused = RESTAURANT_INGREDIENTS.filter((row) => !used.has(row.code)).map((row) => row.code);
  assert.deepEqual(unused, [], `วัตถุดิบที่ไม่มีเมนูไหนใช้: ${unused.join(", ")}`);
});

test("รหัสเมนูและรหัสวัตถุดิบไม่ซ้ำกัน", () => {
  // รหัสซ้ำ → SKU ซ้ำ → ตัวที่สองโดน ON CONFLICT DO NOTHING แล้วถูกข้าม
  // ผลคือกดสร้าง 38 เมนูแล้วได้ 37 โดยไม่มี error
  const menuCodes = RESTAURANT_MENU.map((item) => item.code);
  assert.equal(new Set(menuCodes).size, menuCodes.length, "รหัสเมนูซ้ำ");
  assert.equal(ingredientCodes.size, RESTAURANT_INGREDIENTS.length, "รหัสวัตถุดิบซ้ำ");
});

test("เมนูทุกจานมีสถานีครัว และครัวมีมากกว่าหนึ่งสถานี", () => {
  // สถานีคือคีย์ที่กระดานครัวใช้จัดกลุ่ม และ SLA ของ 9.53 ตั้งค่าต่อสถานี
  // เมนูที่ไม่ระบุสถานีจะไปกองที่ช่อง "ไม่ระบุ" ซึ่งเป็นอาการเดิมที่ชุดนี้มาแก้
  for (const item of RESTAURANT_MENU) {
    assert.ok(item.station && item.station.trim(), `เมนู ${item.code} ไม่มีสถานีครัว`);
  }
  const stations = new Set(RESTAURANT_MENU.map((item) => item.station));
  assert.ok(stations.size >= 3, `ต้องมีสถานีอย่างน้อย 3 สถานี ไม่ใช่ ${stations.size}`);
});

test("รูปแบบสต็อกของเมนูสอดคล้องกับข้อมูลที่มันต้องมี", () => {
  // RECIPE ที่ไม่มีสูตร = readiness ฟ้อง RECIPE_REQUIRED และตัดของไม่ได้
  // DIRECT ที่ไม่มีสต็อก = ของบรรจุที่ขายไม่ได้ตั้งแต่บิลแรก
  // NON_STOCK ที่มีสูตร = ข้อมูลที่ขัดกันเอง เพราะมันคืน lines: [] ไม่มีการตัดของ
  for (const item of RESTAURANT_MENU) {
    if (item.stockPolicy === "RECIPE") {
      assert.ok((item.recipe ?? []).length > 0, `${item.code} เป็น RECIPE แต่ไม่มีสูตร`);
      assert.equal(item.stock, undefined, `${item.code} เป็น RECIPE จึงไม่ควรตั้งสต็อกของตัวเอง`);
    }
    if (item.stockPolicy === "DIRECT") {
      assert.ok((item.stock ?? 0) > 0, `${item.code} เป็น DIRECT แต่ไม่มีสต็อก`);
      assert.equal(item.recipe, undefined, `${item.code} เป็น DIRECT จึงไม่ควรมีสูตร`);
    }
    if (item.stockPolicy === "NON_STOCK") {
      assert.equal(item.recipe, undefined, `${item.code} เป็น NON_STOCK จึงต้องไม่มีสูตร`);
      assert.equal(item.stock, undefined, `${item.code} เป็น NON_STOCK จึงต้องไม่นับสต็อก`);
    }
  }
  const policies = new Set(RESTAURANT_MENU.map((item) => item.stockPolicy));
  // ครบทั้งสามแบบคือเหตุผลที่แคตตาล็อกนี้มีอยู่ — ขาดแบบไหนไปคือทดสอบแบบนั้นไม่ได้
  assert.deepEqual([...policies].sort(), ["DIRECT", "NON_STOCK", "RECIPE"]);
});

test("ทุกเมนูมีราคามากกว่า 0 และไซซ์หลายแบบต้องตั้งราคาครบทุกไซซ์", () => {
  // ราคา 0 = blocker VARIANT_PRICE_REQUIRED ตอนเปิดขาย
  // ไซซ์ที่ไม่ตั้งราคาจะตกไปใช้ราคาสินค้า = "จานใหญ่" ขายราคาจานเล็ก
  for (const item of RESTAURANT_MENU) {
    assert.ok(item.price > 0, `${item.code} ต้องมีราคามากกว่า 0`);
    const sizes = item.sizes ?? [];
    if (sizes.length > 1) {
      for (const size of sizes) {
        assert.ok(
          size.price != null && size.price > 0,
          `${item.code} ไซซ์ ${size.code} ต้องตั้งราคาของตัวเอง`
        );
      }
      const codes = sizes.map((size) => size.code);
      assert.equal(new Set(codes).size, codes.length, `${item.code} มีรหัสไซซ์ซ้ำ`);
    }
  }
});

test("กลุ่มตัวเลือกผ่านกฎที่ฐานข้อมูลบังคับ", () => {
  // code ต้องผ่าน CHECK ของ bms_product_modifier_groups (9.51)
  // SINGLE ต้อง max_select = 1 และ min_select <= max_select ตาม CHECK เดียวกัน
  // price_delta ติดลบถูกปฏิเสธด้วย CHECK ของ 9.45
  for (const [key, group] of Object.entries(RESTAURANT_MODIFIER_GROUPS)) {
    assert.match(group.code, /^[A-Z][A-Z0-9_]{0,63}$/, `กลุ่ม ${key} รหัสผิดรูป`);
    const maxSelect = group.maxSelect ?? null;
    const minSelect = group.minSelect ?? 0;
    if (group.selectionType === "SINGLE") {
      assert.equal(maxSelect, 1, `กลุ่ม ${key} เป็น SINGLE จึงต้อง maxSelect = 1`);
    }
    if (maxSelect != null) assert.ok(minSelect <= maxSelect, `กลุ่ม ${key} min > max`);
    assert.ok(group.options.length > 0, `กลุ่ม ${key} ไม่มีตัวเลือก`);
    for (const option of group.options) {
      assert.ok((option.priceDelta ?? 0) >= 0, `${key}/${option.code} ราคาเพิ่มติดลบ`);
    }
    const defaults = group.options.filter((option) => option.defaultSelected).length;
    // จอเลือกเมนูติ๊กตัวเลือกที่ defaultSelected ให้ล่วงหน้า ถ้าค่าเริ่มต้นเกิน
    // เพดานของกลุ่ม ผู้ใช้จะเพิ่มรายการไม่ได้เลยจนกว่าจะไปติ๊กออกเอง
    if (maxSelect != null) assert.ok(defaults <= maxSelect, `กลุ่ม ${key} ติ๊กค่าเริ่มต้นเกินเพดาน`);
  }
});

test("รหัสตัวเลือกไม่ซ้ำข้ามกลุ่มภายในเมนูเดียวกัน", () => {
  // bms_product_modifiers ยูนีคที่ (tenant, sku, size, code) ไม่ได้แยกตามกลุ่ม
  // รหัสซ้ำข้ามกลุ่มจึงถูก ON CONFLICT DO NOTHING กลืนไปเงียบ ๆ แล้วตัวเลือกหาย
  for (const item of RESTAURANT_MENU) {
    const seen = new Set<string>();
    for (const key of item.modifierGroups ?? []) {
      const group = RESTAURANT_MODIFIER_GROUPS[key];
      assert.ok(group, `เมนู ${item.code} อ้างกลุ่มตัวเลือก ${String(key)} ที่ไม่มีอยู่`);
      for (const option of group.options) {
        assert.ok(!seen.has(option.code), `${item.code} มีรหัสตัวเลือกซ้ำ: ${option.code}`);
        seen.add(option.code);
      }
    }
  }
});

test("กลุ่มบังคับเลือกมีได้เฉพาะที่จงใจ", () => {
  // กลุ่มที่ min_select >= 1 ทำให้สั่งจากช่องทางที่ไม่มี UI เลือกตัวเลือกไม่ได้เลย
  // (INVALID_ITEM MODIFIER_GROUP_MIN) จึงจำกัดไว้ที่เมนูตำซึ่งร้านต้องถามจริง
  const required = Object.entries(RESTAURANT_MODIFIER_GROUPS)
    .filter(([, group]) => (group.minSelect ?? 0) >= 1)
    .map(([key]) => key);
  assert.deepEqual(required, ["SPICE_REQUIRED"]);
  const usedBy = RESTAURANT_MENU
    .filter((item) => (item.modifierGroups ?? []).includes("SPICE_REQUIRED"))
    .map((item) => item.code);
  assert.ok(usedBy.length > 0, "กลุ่มบังคับเลือกที่ไม่มีเมนูไหนใช้ = ทดสอบไม่ได้");
  for (const code of usedBy) assert.match(code, /^SOMTAM/, `${code} ไม่ควรบังคับเลือกความเผ็ด`);
});

test("ขอเมนูเกินจำนวนที่ครัวมี ชื่อยังอ่านเป็นอาหาร", () => {
  // ปุ่มสร้างร้านทดสอบตั้งค่าปริยายไว้ 1,000 รายการ ชื่อรอบถัดไปจึงถูกเห็นเสมอ
  // ของเดิมได้ "ข้าวกะเพราหมูสับ · รุ่น Pro" เพราะยืมป้ายของสินค้าแกดเจ็ต
  const first = RESTAURANT_MENU[0];
  assert.equal(restaurantMenuName(first, 0), first.name);
  const second = restaurantMenuName(first, RESTAURANT_MENU.length);
  assert.ok(second.startsWith(`${first.name} · `), second);
  assert.ok(RESTAURANT_MENU_SERIES.some((label) => second.includes(label)), second);
  assert.doesNotMatch(second, /รุ่น|Standard|Plus|Pro|Premium/);
});

test("หน่วยขายที่พิมพ์บนใบเสร็จเป็นภาษาของร้านอาหาร", () => {
  // ของเดิมใช้ "ชิ้น" กับทุกอย่าง — ใบเสร็จร้านอาหารที่เขียนว่า "ข้าวกะเพรา 1 ชิ้น"
  // อ่านแล้วรู้ทันทีว่าเป็นข้อมูลปลอม ซึ่งกลับหัวกับเหตุผลที่ทำชุดนี้
  for (const item of RESTAURANT_MENU) {
    const unit = restaurantPackUnitName(item);
    assert.ok(unit && !unit.includes("ชิ้น"), `${item.code} ได้หน่วย "${unit}"`);
  }
  const water = RESTAURANT_MENU.find((item) => item.code === "WATER-600");
  assert.ok(water);
  assert.equal(restaurantPackUnitName(water), "ขวด");
});
