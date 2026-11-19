import assert from "node:assert/strict";
import test from "node:test";

test("staff quotation rejects every invalid line instead of returning a partial document", async () => {
  const state = globalThis as any;
  const previousPool = state.__bmsPostgresPool;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const reads: string[] = [];
  state.__bmsPostgresPool = {
    query: async (sql: string, params: unknown[] = []) => {
      reads.push(sql);
      if (sql.includes("SELECT p.name FROM bms_products")) {
        return params[1] === "VALID"
          ? { rows: [{ name: "FAKE product" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT COALESCE(sized.price")) {
        return { rows: [{ price: "100.00" }], rowCount: 1 };
      }
      throw new Error("A rejected quotation must not calculate shipping or publish a document");
    },
  };
  try {
    const { generateQuotation, QuotationValidationError, quotationTotal } =
      await import("../apps/web/lib/bms/documents.ts");
    await assert.rejects(
      generateQuotation("tenant-a", [
        { sku: "VALID", size: "STD", qty: 2 },
        { sku: "MISSING", size: "STD", qty: 3 },
        { sku: "INVALID", size: "STD", qty: 0 },
      ]),
      (error: unknown) => {
        assert.ok(error instanceof QuotationValidationError);
        assert.deepEqual(error.issues.map((issue) => [issue.line, issue.code]), [
          [2, "PRODUCT_UNAVAILABLE"], [3, "INVALID_ITEM"],
        ]);
        return true;
      }
    );
    assert.equal(reads.filter((sql) => sql.includes("SELECT p.name FROM bms_products")).length, 2);
    assert.equal(quotationTotal(200, null), null, "unknown shipping must not become zero in the payable total");
    assert.equal(quotationTotal(200, 0), 200, "an explicit free-shipping quote is a known total");
  } finally {
    if (previousPool === undefined) delete state.__bmsPostgresPool;
    else state.__bmsPostgresPool = previousPool;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
