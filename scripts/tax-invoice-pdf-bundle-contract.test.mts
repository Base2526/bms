import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const require = createRequire(path.join(web, "package.json"));

test("bundled invoice renderer uses the embedded Thai font without PDFKit's unbundled AFM files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bms-tax-pdf-"));
  try {
    const ts = require("typescript");
    const source = await readFile(path.join(web, "lib/bms/taxInvoicePdf.ts"), "utf8");
    const transpile = (code: string) => ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    await writeFile(path.join(directory, "entry.cjs"), transpile(source));
    // ข้อความบนเอกสาร (สาขา/วันที่) ต้องเป็นโมดูลเดียวกับหน้าพิมพ์และสำเนาลูกค้า
    for (const helper of ["taxDocumentText", "taxReportMath"]) {
      await writeFile(path.join(directory, `${helper}.js`),
        transpile(await readFile(path.join(web, `lib/bms/${helper}.ts`), "utf8")));
    }
    const webpack = require("next/dist/compiled/webpack/webpack");
    webpack.init();
    const compiler = webpack.webpack({
      mode: "production", target: "node", entry: path.join(directory, "entry.cjs"),
      output: { path: directory, filename: "bundle.cjs", library: { type: "commonjs2" } },
      resolve: { modules: [path.join(web, "node_modules")] },
      node: { __dirname: false, __filename: false },
      optimization: { minimize: false },
    });
    try {
      await new Promise<void>((resolve, reject) => compiler.run((error: Error, stats: any) => {
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      }));
    } finally { await new Promise<void>((resolve, reject) => compiler.close((error: Error) => error ? reject(error) : resolve())); }
    const { renderTaxInvoicePdf } = require(path.join(directory, "bundle.cjs"));
    const party = { name: "FAKE ผู้ซื้อทดสอบ", taxId: "0105555555554", branchCode: "00000", address: "FAKE กรุงเทพมหานคร", phone: null, locationName: "FAKE" };
    // ผู้ซื้อบุคคลธรรมดาที่ไม่ได้จด VAT: ไม่มีเลขและไม่มีสาขา
    const individual = { name: "FAKE บุคคลธรรมดา", taxId: null, branchCode: null, address: "FAKE เชียงใหม่", phone: null };
    const pdf = await renderTaxInvoicePdf({ id: "FAKE", orderId: "FAKE", docNo: "FAKE-001", issueDate: "2026-10-13",
      seller: party, buyer: individual, replacesDocNo: "FAKE-ABB-001", calendarEra: "BE",
      lines: [{ name: "FAKE สินค้า", sku: "FAKE", size: "XL", qty: 1, unit: "ชิ้น", unitPrice: 107, amount: 107 }],
      subtotal: 107, discount: 0, shipping: 0, netBeforeVat: 100, exemptAmount: 0, vatAmount: 7,
      vatRate: 7, roundingAmount: 0, grandTotal: 107, amountText: "หนึ่งร้อยเจ็ดบาทถ้วน",
    });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("latin1"), /\/FontFile2\b/, "Thai font is embedded");
    assert.equal([...pdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
