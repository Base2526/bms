import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";
import { buildSchema, graphql } from "../apps/web/node_modules/graphql/index.js";
import { parseProductImportWorksheet, selectProductImportSheetName } from "../apps/web/lib/bms/productImportTemplate.ts";
import { parseProductImportWorkbook, buildProductImportWorkbook } from "../apps/web/lib/bms/productImportWorkbook.ts";
import { SHOP_ARCHETYPE_OPTIONS } from "../apps/web/lib/bms/shopArchetypes.ts";
import { shopExperienceForArchetype } from "../apps/web/lib/bms/shopExperience.ts";
import { runImport } from "../apps/web/lib/bms/productImport.ts";
import { upsertProduct } from "../apps/web/lib/bms/products.ts";

const headers = ["SKU", "ชื่อสินค้า", "ราคาขาย", "ต้นทุน", "บาร์โค้ด"];
const workbook = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Products");
  return wb;
};
const roundtrip = (wb: XLSX.WorkBook, bookType: "xlsx" | "xls" = "xlsx") => XLSX.read(
  XLSX.write(wb, { type: "buffer", bookType }),
  { type: "buffer", raw: true, cellNF: true, cellDates: true }
);

async function withPool(fn: (pool: any) => Promise<void>) {
  const pool = (globalThis as any).__bmsPostgresPool;
  const query = pool.query;
  const connect = pool.connect;
  const mode = process.env.BMS_DEPLOYMENT_MODE;
  process.env.BMS_DEPLOYMENT_MODE = "retail-local";
  try { await fn(pool); } finally {
    pool.query = query;
    pool.connect = connect;
    if (mode === undefined) delete process.env.BMS_DEPLOYMENT_MODE;
    else process.env.BMS_DEPLOYMENT_MODE = mode;
  }
}

test("physical Excel row numbers survive blank rows, and missing optional columns stay omitted", () => {
  const rows = parseProductImportWorksheet([
    ["SKU", "ชื่อสินค้า", "ราคาขาย"], [], ["001", "one", 0], [], [], ["002", "two", 10],
  ]);
  assert.deepEqual(rows.map((row) => row.rowNumber), [3, 6]);
  assert.equal(rows[0].price, 0);
  for (const field of ["barcode", "cost_price", "brand", "keywords", "sales_surfaces", "variant_codes"]) {
    assert.ok(!Object.hasOwn(rows[0], field), field);
  }
});

test("XLSX and XLS preserve text identifiers and use unrounded numeric prices", () => {
  for (const type of ["xlsx", "xls"] as const) {
    const wb = workbook([headers, ["000123", "sample", 1234.56, 1000.25, "00012345678901234567"]]);
    wb.Sheets.Products.C2.z = '"฿"#,##0';
    wb.Sheets.Products.D2.z = "#,##0.00";
    const [row] = parseProductImportWorkbook(roundtrip(wb, type));
    assert.equal(row.price, 1234.56);
    assert.equal(row.cost_price, 1000.25);
    assert.equal(row.sku, "000123");
    assert.equal(row.barcode, "00012345678901234567");
  }
});

test("CSV text codes retain leading zeroes and grouped price text is parsed strictly", () => {
  const wb = XLSX.read('\ufeffSKU,ชื่อสินค้า,ราคาขาย\r\n000123,สินค้า,"1,234.56"', { type: "string", raw: true });
  assert.equal(parseProductImportWorkbook(wb)[0].sku, "000123");
  assert.equal(parseProductImportWorkbook(wb)[0].price, 1234.56);
  for (const value of ["", "1,23", "฿10", "0x10", "Infinity", "1e999", "ten"]) {
    assert.equal(parseProductImportWorksheet([["SKU", "ชื่อสินค้า", "ราคาขาย"], ["A", "a", value]])[0].price, -1);
  }
});

test("zero-padding formats work, while unsafe IDs, formulas, dates and Excel errors identify the cell", () => {
  const wb = workbook([headers, [123, "sample", 10, 5, "001"]]);
  wb.Sheets.Products.A2.z = "000000";
  assert.equal(parseProductImportWorkbook(roundtrip(wb))[0].sku, "000123");
  for (const [address, cell, code] of [
    ["A2", { t: "n", v: 1234567890123456 }, "INVALID_IDENTIFIER"],
    ["C2", { t: "n", v: 10, f: "5+5" }, "FORMULA_CELL"],
    ["C2", { t: "n", v: 40000, z: "yyyy-mm-dd" }, "INVALID_CELL"],
    ["C2", { t: "e", v: 7 }, "INVALID_CELL"],
  ] as const) {
    const candidate = workbook([headers, ["A", "sample", 10]]);
    candidate.Sheets.Products[address] = cell as any;
    assert.throws(() => parseProductImportWorkbook(roundtrip(candidate)), (error: any) => {
      assert.equal(error.code, code);
      assert.match(error.headers[0], new RegExp(`Products!${address}`));
      return true;
    });
  }
});

test("template samples cannot become fallback import data, and misspelled optional headers cannot lose data silently", () => {
  assert.equal(selectProductImportSheetName(["Examples", "Guide"]), null);
  assert.equal(selectProductImportSheetName(["Guide", "RenamedProducts", "Examples"]), null);
  assert.throws(() => parseProductImportWorksheet([["SKU", "ชื่อสินค้า", "ราคาขาย", "Stock Polcy"]]),
    (error: any) => error.code === "UNKNOWN_HEADERS" && error.headers.includes("stock polcy"));
});

test("invalid prices survive JSON and the real GraphQL input contract to become per-row backend errors", async () => {
  await withPool(async (pool) => {
    pool.query = async () => ({ rows: [], rowCount: 0 });
    const source = readFileSync(new URL("../apps/web/graphql/typeDefs.ts", import.meta.url), "utf8");
    const input = source.match(/input BmsProductImportRowInput\s*\{[^}]+\}/)![0];
    const schema = buildSchema(`${input} type Query { ok: Boolean } type Mutation { check(items: [BmsProductImportRowInput!]!): Boolean }`);
    const rows = parseProductImportWorksheet([headers, ["A", "one", ""], [], ["B", "two", "abc"], ["C", "three", 0], ["D", "four", 10, "bad"]]);
    let checked = false;
    const result = await graphql({ schema,
      source: "mutation($items: [BmsProductImportRowInput!]!) { check(items: $items) }",
      variableValues: JSON.parse(JSON.stringify({ items: rows })),
      rootValue: { check: async ({ items }: any) => {
        const preview = await runImport("contract", items, { commit: false });
        assert.equal(preview.errorCount, 3);
        assert.equal(preview.createCount, 1);
        assert.deepEqual(preview.rows.filter((row) => row.action === "ERROR").map((row) => row.rowNumber), [2, 4, 6]);
        assert.match(preview.rows[0].error!, /ราคาขาย/);
        assert.match(preview.rows[3].error!, /ต้นทุน/);
        checked = true;
        return true;
      } },
    });
    assert.equal(result.errors, undefined);
    assert.ok(checked);
  });
});

test("preview rejects duplicate SKU, equivalent barcodes and unsupported existing stock-model changes", async () => {
  await withPool(async (pool) => {
    pool.query = async (_sql: string, params: any[]) => {
      assert.equal(params[0], "contract");
      return { rows: [{ sku: "EXISTING", stock_policy: "RECIPE", base_unit: "GRAM" }], rowCount: 1 };
    };
    const rows = parseProductImportWorksheet([
      [...headers, "Stock Policy", "หน่วยฐาน"],
      ["A", "a", 10, "", "4006381333931"],
      ["A", "duplicate", 10],
      ["B", "duplicate barcode", 10, "", "04006381333931"],
      ["EXISTING", "existing", 10, "", "", "DIRECT", "PIECE"],
    ]);
    const preview = await runImport("contract", rows, { commit: false });
    assert.equal(preview.errorCount, 3);
    assert.match(preview.rows[1].error!, /แถวที่ 2/);
    assert.match(preview.rows[2].error!, /บาร์โค้ด.*แถวที่ 2/);
    assert.match(preview.rows[3].error!, /หน้ารูปแบบสต็อก/);
  });
});

test("all archetype examples reach commit through real upsert with draft policy/variants/surfaces (mock DB)", async () => {
  await withPool(async (pool) => {
    const calls: Array<{ sql: string; params: any[] }> = [];
    pool.query = async () => ({ rows: [], rowCount: 0 });
    pool.connect = async () => ({ release() {}, query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (/INSERT INTO bms_products\s/.test(sql)) return { rows: [{ sku: params[1], active: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    } });
    for (const { value } of SHOP_ARCHETYPE_OPTIONS) {
      const wb = buildProductImportWorkbook(shopExperienceForArchetype(value).importExamples, value);
      XLSX.utils.sheet_add_aoa(wb.Sheets.Products,
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Examples, { header: 1, raw: true }).slice(1), { origin: "A2" });
      const rows = parseProductImportWorkbook(roundtrip(wb));
      const start = calls.length;
      const result = await runImport(`contract-${value}`, rows, { commit: true, editorId: "contract-editor" });
      assert.equal(result.errorCount, 0, JSON.stringify(result));
      assert.equal(result.createCount, rows.length);
      const writes = calls.slice(start);
      assert.equal(writes.filter((call) => call.sql === "COMMIT").length, rows.length);
      assert.equal(writes.filter((call) => call.sql === "SET LOCAL ROLE bms_app").length, rows.length);
      for (const row of rows) {
        const product = writes.find((call) => /INSERT INTO bms_products\s/.test(call.sql) && call.params[1] === row.sku)!;
        assert.equal(product.params[0], `contract-${value}`);
        assert.equal(product.params[3], row.price);
        assert.equal(product.params[5], false, "never activate imported products");
        assert.ok(!product.params[19].includes("images"));
        assert.ok(!product.params[19].includes("weight_grams"));
        const policy = writes.find((call) => /INSERT INTO bms_product_stock_policies/.test(call.sql) && call.params[1] === row.sku)!;
        assert.deepEqual(policy.params.slice(2), [row.stock_policy, row.base_unit]);
        const variants = writes.filter((call) => /INSERT INTO bms_product_variants/.test(call.sql) && call.params[1] === row.sku);
        assert.deepEqual(variants.map((call) => call.params[2]), row.variant_codes);
        const surfaces = writes.filter((call) => /INSERT INTO bms_product_sales_surfaces/.test(call.sql) && call.params[1] === row.sku);
        assert.deepEqual(surfaces.map((call) => call.params[2]), row.sales_surfaces);
      }
      assert.ok(!writes.some((call) => /DELETE FROM bms_product_images/.test(call.sql)));
    }
  });
});

test("commit rechecks stock configuration under lock and rolls back before changing a conflicting existing SKU", async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string) => {
    calls.push(sql);
    if (/SELECT active FROM/.test(sql)) return { rows: [{ active: false }], rowCount: 1 };
    if (/SELECT stock_policy, base_unit/.test(sql)) return { rows: [{ stock_policy: "RECIPE", base_unit: "GRAM" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }, release() {} };
  await withPool(async (pool) => {
    pool.connect = async () => client;
    await assert.rejects(() => upsertProduct("contract", {
      sku: "A", name: "a", price: 10, stock_policy: "DIRECT",
    }, undefined, undefined, undefined, { importMode: true }), /หน้ารูปแบบสต็อก/);
    assert.ok(calls.some((sql) => sql.includes("FOR UPDATE")));
    assert.ok(calls.includes("ROLLBACK"));
    assert.ok(!calls.some((sql) => sql.includes("INSERT INTO bms_products")));
  });
});

test("updating an existing SKU preserves omitted metadata and gallery, but explicit blank cells can clear values", async () => {
  await withPool(async (pool) => {
    const writes: Array<{ sql: string; params: any[] }> = [];
    pool.query = async () => ({ rows: [{ sku: "A", stock_policy: "DIRECT", base_unit: "PIECE" }], rowCount: 1 });
    pool.connect = async () => ({ release() {}, query: async (sql: string, params: any[] = []) => {
      writes.push({ sql, params });
      if (/SELECT active FROM/.test(sql)) return { rows: [{ active: false }], rowCount: 1 };
      if (/SELECT stock_policy, base_unit/.test(sql)) return { rows: [{ stock_policy: "DIRECT", base_unit: "PIECE" }], rowCount: 1 };
      if (/INSERT INTO bms_products\s/.test(sql)) return { rows: [{ sku: "A", active: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    } });
    const rows = parseProductImportWorksheet([["SKU", "ชื่อสินค้า", "ราคาขาย"], ["A", "updated", 10]]);
    assert.equal((await runImport("contract", rows, { commit: true })).updateCount, 1);
    const insert = writes.find((call) => /INSERT INTO bms_products\s/.test(call.sql))!;
    assert.equal(insert.params[5], null, "preserve lifecycle on update");
    for (const field of ["keywords", "barcode", "description", "cost_price", "category", "brand", "weight_grams", "images"]) {
      assert.ok(!insert.params[19].includes(field));
      assert.ok(insert.sql.includes(`'${field}' = ANY($20::text[])`));
    }
    assert.ok(!writes.some((call) => /DELETE FROM bms_product_images/.test(call.sql)));
    writes.length = 0;
    await runImport("contract", parseProductImportWorksheet([headers, ["A", "updated", 10, "", ""]]), { commit: true });
    const cleared = writes.find((call) => /INSERT INTO bms_products\s/.test(call.sql))!;
    assert.ok(cleared.params[19].includes("barcode"));
    assert.ok(cleared.params[19].includes("cost_price"));
    assert.equal(cleared.params[6], null);
    assert.equal(cleared.params[9], null);
  });
});

test("one database row failure rolls back that row, reports a repair hint and continues the batch", async () => {
  await withPool(async (pool) => {
    const ends: string[] = [];
    pool.query = async () => ({ rows: [], rowCount: 0 });
    pool.connect = async () => ({ release() {}, query: async (sql: string, params: any[] = []) => {
      if (sql === "ROLLBACK" || sql === "COMMIT") ends.push(sql);
      if (/INSERT INTO bms_products\s/.test(sql)) {
        if (params[1] === "BAD") throw Object.assign(new Error("numeric overflow"), { code: "22003" });
        return { rows: [{ sku: params[1], active: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    } });
    const result = await runImport("contract", parseProductImportWorksheet([
      ["SKU", "ชื่อสินค้า", "ราคาขาย"], ["BAD", "bad", 1e100], [], ["OK", "okay", 10],
    ]), { commit: true });
    assert.equal(result.createCount, 1);
    assert.equal(result.errorCount, 1);
    assert.match(result.rows[0].error!, /ลดจำนวนหลัก/);
    assert.equal(result.rows[1].rowNumber, 4);
    assert.deepEqual(ends, ["ROLLBACK", "COMMIT"]);
  });
});
