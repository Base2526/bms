import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { taxRequestUnavailableReason } from "../apps/web/lib/bms/taxRequestToken.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("apps/web/components/pos-desktop/CheckoutBenefits.tsx");
const desktop = read("apps/web/components/pos-desktop/DesktopPosRenderer.tsx");
const functionText = source.slice(source.indexOf("export function benefitsPayable("), source.indexOf("export function useCheckoutBenefits("));
const compiled = ts.transpileModule(functionText.replaceAll("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const payable = new Function(`${compiled}; return benefitsPayable;`)();
const selectionError = new Function(`${compiled}; return benefitsSelectionError;`)();

test("member removal and capped points cannot silently change the requested benefits", () => {
  assert.equal(selectionError({ member: { customerId: "member" }, pointsUsed: 100 }, "member", 100), "");
  assert.equal(selectionError({ member: null, pointsUsed: 0 }, null, 0), "");
  assert.match(selectionError({ member: null, pointsUsed: 0 }, "member", 0), /เลือกสมาชิกใหม่/);
  assert.match(selectionError({ member: { customerId: "member" }, pointsUsed: 50 }, "member", 100), /ใช้ได้ 50 แต้ม/);
});

test("checkout uses only a ready server quote, including deposits and zero-due groups", () => {
  assert.equal(payable({ status: "READY", netTotal: 100, amountDue: 70 }), 70);
  assert.equal(payable({ status: "READY", netTotal: 100, amountDue: 0 }), 0);
  assert.equal(payable({ status: "READY", netTotal: 85 }), 85);
  for (const preview of [null, {}, { status: "COUPON_INVALID", netTotal: 0 }, { status: "READY", netTotal: -1 },
    { status: "READY", netTotal: NaN }, { status: "READY", netTotal: "100" }, { status: "READY", netTotal: 100, couponError: "expired" }]) {
    assert.equal(payable(preview), null);
  }
});

test("member and quote queries conform to the committed API", () => {
  const { buildSchema, parse, validate } = require(new URL("../apps/web/node_modules/graphql/index.js", import.meta.url).pathname);
  const schema = buildSchema(read("schema.graphql"));
  for (const name of ["MEMBER_SEARCH", "BENEFITS_PREVIEW"]) {
    const query = source.match(new RegExp(`export const ${name} = \x60([\\s\\S]*?)\x60;`))?.[1];
    assert.ok(query);
    assert.deepEqual(validate(schema, parse(query)), []);
  }
});

test("stale quotes cannot authorize payment and an uncertain sale keeps its original payload", () => {
  assert.match(source, /result\?\.key === key/);
  assert.match(source, /JSON\.stringify\(\[token, input, retry, revision\]\)/);
  assert.match(source, /if \(!cancelled\) setResult/);
  assert.match(source, /pointsToRedeem: points, lines: \[\]/);
  assert.match(desktop, /\.\.\.benefits\.saleFields/);
  assert.match(desktop, /benefits\.ready && \(validation\.canConfirm/);
  assert.match(desktop, /saleAttemptRef\.current\.payload/);
  assert.match(desktop, /CheckoutBenefits benefits=\{benefits\} disabled=\{busy \|\| Boolean\(saleAttemptRef\.current\)\}/);
  assert.match(desktop, /aria-label="รีเฟรชข้อมูล"/);
  assert.match(desktop, /onClick=\{\(\) => void refreshDesktopContent\(\)\}/);
  assert.match(desktop, /memberName: displayMemberName\(receipt\s*\?/);
  assert.match(desktop, /pointsBalance: receipt \? receipt.pointsBalance \?\? null/);
});

test("QR readiness reports a concrete blocker without enabling requests or fabricating a link", () => {
  assert.match(taxRequestUnavailableReason(false)!, /ไม่มีใบกำกับภาษีอย่างย่อ/);
  assert.match(taxRequestUnavailableReason(true, false)!, /ยกเลิกหรือมีการคืน/);
  const old = process.env.BMS_TAX_REQUESTS_ENABLED;
  try {
    process.env.BMS_TAX_REQUESTS_ENABLED = "false";
    assert.match(taxRequestUnavailableReason(true)!, /ยังไม่พร้อม/);
  } finally {
    if (old === undefined) delete process.env.BMS_TAX_REQUESTS_ENABLED;
    else process.env.BMS_TAX_REQUESTS_ENABLED = old;
  }
});
