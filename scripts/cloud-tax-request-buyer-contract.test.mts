import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { normalizeTaxRequestBuyer } from "../apps/web/lib/bms/taxInvoiceRequests.ts";
import { isValidThaiTaxId } from "../apps/web/lib/bms/thaiTaxId.ts";
import * as fields from "../apps/web/lib/taxRequestFields.ts";
import { isTaxEmailRecipient } from "../apps/web/lib/bms/taxRequestEmail.ts";

const legacy = { name: "FAKE buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address", phone: null };
const structured = { ...legacy, buyerType: "INDIVIDUAL", addressLine1: " FAKE line 1 ", addressLine2: "FAKE line 2", province: "กรุงเทพมหานคร", postcode: "10140", email: "fake@example.test" };

test("legacy requests retain exactly their original shape", () => {
  assert.deepEqual(normalizeTaxRequestBuyer(legacy), legacy);
});
test("structured request retains contact fields and composes invoice address on the server", () => {
  const buyer = normalizeTaxRequestBuyer({ ...structured, address: "UNTRUSTED combined address", branchCode: "12345" });
  assert.equal(buyer.address, "FAKE line 1\nFAKE line 2\nกรุงเทพมหานคร\n10140");
  // บุคคลธรรมดาไม่มีสาขา — ค่าที่ผู้เรียกส่งมาถูกทิ้ง ไม่พิมพ์ "สำนักงานใหญ่" ให้คนธรรมดา
  assert.equal(buyer.branchCode, null);
  assert.equal(buyer.email, "fake@example.test");
  assert.equal(buyer.buyerType, "INDIVIDUAL");
  assert.deepEqual(normalizeTaxRequestBuyer(buyer), buyer, "tracking/correction round trip is stable");
});
test("a buyer who is not VAT-registered may omit the tax ID; a company may not", () => {
  for (const buyerType of ["INDIVIDUAL", "FOREIGNER"]) {
    const buyer = normalizeTaxRequestBuyer({ ...structured, buyerType, taxId: "" });
    assert.equal(buyer.taxId, null, buyerType);
    assert.equal(buyer.branchCode, null, buyerType);
  }
  // ใส่มาก็ต้องเป็นเลขที่ถูก checksum
  assert.throws(() => normalizeTaxRequestBuyer({ ...structured, taxId: "1234567890123" }), /เลขผู้เสียภาษี/);
  assert.throws(() => normalizeTaxRequestBuyer({ ...structured, buyerType: "COMPANY", taxId: "" }));
  // คำขอรุ่นเก่าที่ไม่มีประเภทยังถือเป็นผู้ประกอบการ
  assert.throws(() => normalizeTaxRequestBuyer({ ...legacy, taxId: "" }));
});
test("old company snapshots without contact fields remain readable", () => {
  const buyer = normalizeTaxRequestBuyer({ ...structured, buyerType: "COMPANY", branchCode: "00001", addressLine2: undefined, postcode: undefined, email: undefined });
  assert.equal(buyer.branchCode, "00001");
  assert.equal(buyer.address, "FAKE line 1\nกรุงเทพมหานคร");
  assert.equal(buyer.email, "");
});
test("single-address clients retain and validate contact email", () => {
  assert.equal(normalizeTaxRequestBuyer({ ...legacy, email: " fake@example.test " }).email, "fake@example.test");
  assert.throws(() => normalizeTaxRequestBuyer({ ...legacy, email: "invalid" }), /อีเมล/);
});

function serviceWithReplay(replay: unknown = null) {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const ts = require("typescript");
  const source = readFileSync(new URL("../apps/web/lib/bms/taxInvoiceRequests.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      let rows: unknown[] = [];
      if (sql.startsWith("SELECT id,access_hash,buyer")) rows = replay ? [{ id: "request", access_hash: "hash", buyer: replay }] : [];
      else if (sql.startsWith("SELECT * FROM bms_tax_invoice_requests")) rows = [{ id: "request", order_id: "order", status: "PENDING", version: 1 }];
      else if (sql.startsWith("SELECT buyer FROM bms_tax_request_submissions")) rows = replay ? [{ buyer: replay }] : [];
      else if (!sql.startsWith("SELECT id FROM bms_orders") && !["COMMIT", "ROLLBACK"].includes(sql)) {
        throw new Error("REACHED_RECEIPT_VALIDATION");
      }
      return { rows, rowCount: rows.length };
    },
    release() {},
  };
  const exports: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/db") return { getClient: async () => client };
    if (id === "./tenant") return { beginTenantTx: async () => {} };
    if (id === "./thaiTaxId") return { isValidThaiTaxId };
    if (id === "../taxRequestFields") return fields;
    if (id === "./taxRequestToken") return {
      taxRequestConfiguration: () => ({ enabled: true }),
      verifyTaxRequestToken: () => ({ tenantId: "tenant", orderId: "order" }),
      parseTaxRequestAccess: () => ({ tenantId: "tenant", id: "request", accessHash: "hash" }),
      taxRequestAccessHash: () => "hash",
    };
    if (id === "./taxRequestEmail") return { isTaxEmailRecipient };
    if (id === "./thaiAddress") return { resolveThaiAddressCodesInTx: async () => null, structuredAddressSnapshot: (line: string) => line };
    if (["./permissions", "./locations", "./taxDocuments", "./taxRequestPolicy"].includes(id)) return {};
    throw new Error(`Unexpected import ${id}`);
  }, exports);
  return { ...exports, queries };
}

test("new submissions and corrections require email for every buyer shape before writing", async () => {
  const service = serviceWithReplay();
  for (const shape of [legacy, ...fields.TAX_BUYER_TYPES.map(({ value }) => ({ ...structured, buyerType: value }))]) {
    for (const email of [undefined, null, "", "   "]) {
      const buyer = { ...shape, email };
      await assert.rejects(service.submitTaxRequest("token", buyer, "secret"), /กรุณากรอกอีเมล/);
      await assert.rejects(service.reviseTaxRequest("access", 1, buyer), /กรุณากรอกอีเมล/);
    }
    const buyer = { ...shape, email: "fake@example.test" };
    await assert.rejects(service.submitTaxRequest("token", buyer, "secret"), /REACHED_RECEIPT_VALIDATION/);
    await assert.rejects(service.reviseTaxRequest("access", 1, buyer), /REACHED_RECEIPT_VALIDATION/);
    for (const email of ["fake,other@example.test", "fake;other@example.test", "<fake@example.test>"]) {
      await assert.rejects(service.submitTaxRequest("token", { ...shape, email }, "secret"), /อีเมล/);
      await assert.rejects(service.reviseTaxRequest("access", 1, { ...shape, email }), /อีเมล/);
    }
  }
  assert.ok(service.queries.every((sql: string) => !/^(INSERT|UPDATE|DELETE)/.test(sql)));
});

test("committed requests without email can still replay without another write", async () => {
  for (const raw of [legacy, { ...structured, email: "" }]) {
    const buyer = normalizeTaxRequestBuyer(raw);
    const service = serviceWithReplay(buyer);
    assert.deepEqual(await service.submitTaxRequest("token", raw, "secret"), { access: "tenant.request.secret" });
    assert.deepEqual(await service.reviseTaxRequest("access", 1, raw), { ok: true });
    assert.ok(service.queries.every((sql: string) => !/^(INSERT|UPDATE|DELETE)/.test(sql)));
  }
});
test("invalid fields and foreign passport identifiers never bypass issuance validation", () => {
  for (const patch of [
    { buyerType: "OTHER" }, { buyerType: "" }, { province: "FAKE province" },
    { addressLine1: " " }, { postcode: "12x45" }, { email: "invalid" },
    { email: "fake@example.test\r\nBcc: other@example.test" },
    { email: "x".repeat(255) }, { taxId: "0105555555555" },
    { buyerType: "COMPANY", branchCode: "xyz" },
    { buyerType: "FOREIGNER", taxId: "FAKE-PASSPORT" },
  ]) assert.throws(() => normalizeTaxRequestBuyer({ ...structured, ...patch }));
  assert.equal(normalizeTaxRequestBuyer({ ...structured, buyerType: "FOREIGNER" }).buyerType, "FOREIGNER");
});
