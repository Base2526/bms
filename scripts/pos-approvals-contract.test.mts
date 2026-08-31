/**
 * "ใครอนุมัติงานนี้ได้" ต้องตอบได้ก่อนคนเดินไปตาม ไม่ใช่หลังจากกด PIN แล้ว
 *
 * ทุก dropdown ผู้อนุมัติที่หน้าขายเคยกรองแค่ `hasPin` (บางที่ไม่ตัดตัวเองออกด้วยซ้ำ) แคชเชียร์
 * จึงเลือกคนที่อนุมัติไม่ได้ แล้วเพิ่งรู้ตอนคนนั้นเดินมากด PIN ต่อหน้าลูกค้า · เทสนี้ตรึงสองอย่าง:
 * ทุกกล่องเลือกผู้อนุมัติต้องกรองด้วยสิทธิ์จริง และสิทธิ์ที่กรองต้องเป็นตัวเดียวกับที่ route ตรวจ
 * — ถ้าสองฝั่งหลุดจากกัน จอจะยื่นชื่อคนที่ server จะปฏิเสธอยู่ดี ซึ่งคือบั๊กเดิมกลับมา
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BMS_PERMISSIONS } from "../apps/web/lib/bms/permissions.ts";
import {
  POS_APPROVAL_PERMISSIONS,
  posActionLabel,
  unknownPosPermissions,
} from "../apps/web/lib/bms/posApprovals.ts";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
const POS_PAGE = readFileSync(path.join(WEB, "app", "(pos)", "pos", "page.tsx"), "utf8");
const POS_API = path.join(WEB, "app", "api", "pos");

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routeFiles(path.join(dir, entry.name))
      : entry.name === "route.ts" ? [path.join(dir, entry.name)] : []
  );

test("every approval permission the catalogue names is a real permission", () => {
  const known = new Set<string>(BMS_PERMISSIONS as readonly string[]);
  for (const permission of POS_APPROVAL_PERMISSIONS) {
    assert.ok(known.has(permission), `${permission} is not in BMS_PERMISSIONS`);
    assert.notEqual(posActionLabel(permission), permission, `${permission} has no human label`);
  }
  assert.deepEqual(unknownPosPermissions(), [], "these labelled permissions do not exist");
});

test("no approver dropdown is left filtering on 'has a PIN' alone", () => {
  // The old shape, in every variation it appeared in. Any survivor means a cashier can still pick
  // someone who cannot approve.
  const legacy = [...POS_PAGE.matchAll(/session\?\.cashiers \?\? \[\]\)\.filter\(\(c\) => c\.hasPin/g)];
  assert.equal(legacy.length, 0, "an approver list still filters only by PIN");
  const approverSelects = [...POS_PAGE.matchAll(/<ApproverOptions session=\{session\} permission="([a-z_.]+)"/g)]
    .map((match) => match[1]);
  assert.ok(approverSelects.length >= 7, `expected the approver dropdowns, found ${approverSelects.length}`);
  for (const permission of approverSelects) {
    assert.ok(
      (POS_APPROVAL_PERMISSIONS as readonly string[]).includes(permission),
      `${permission} is offered on screen but is not an approval permission the session resolves`
    );
  }
});

test("the screen filters on a permission the counter really enforces", () => {
  // The re-check lives in two layers: most routes call `cashierHasPermission()` directly, but the
  // refund threshold resolves its permission from `approvalRuleForRefundAmount()` inside the sale
  // service, so scanning routes alone would call a real gate "decorative". Both layers are read.
  const enforced = new Set<string>();
  const sources = [
    ...routeFiles(POS_API).map((file) => readFileSync(file, "utf8")),
    readFileSync(path.join(WEB, "lib", "bms", "pos.ts"), "utf8"),
  ];
  for (const source of sources) {
    for (const match of source.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) enforced.add(match[1]);
  }
  const offered = new Set(
    [...POS_PAGE.matchAll(/<ApproverOptions session=\{session\} permission="([a-z_.]+)"/g)].map((m) => m[1])
  );
  assert.ok(offered.size >= 5, `expected several approver dropdowns, found ${offered.size}`);
  for (const permission of offered) {
    assert.ok(
      enforced.has(permission),
      `the screen offers approvers for ${permission} but nothing at the counter checks it — the list would be decorative`
    );
  }
});

test("a permission denial tells the cashier what to do next, not only what failed", () => {
  const denials: string[] = [];
  for (const file of routeFiles(POS_API)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/error:\s*"([^"]*ไม่มีสิทธิ์[^"]*)"/g)) {
      denials.push(`${path.relative(POS_API, file)}: ${match[1]}`);
    }
  }
  // Pharmacist authorisation is the one denial that must NOT be phrased as a permission: that gate
  // is a licence (`users.is_licensed_pharmacist`), and telling staff to "ask for the permission"
  // would be telling them something untrue about dispensing medicine.
  const allowed = denials.filter((line) => line.includes("เภสัชกร"));
  assert.deepEqual(
    denials.filter((line) => !allowed.includes(line)),
    [],
    "these still say only what failed — route them through posPermissionDeniedMessage()"
  );
});
