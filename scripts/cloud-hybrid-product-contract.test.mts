import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public packaging presents Cloud and Hybrid POS as one BMS product", () => {
  const page = read("apps/web/app/(main)/page.tsx");
  const thai = read("apps/web/i18n/th.ts");
  const english = read("apps/web/i18n/en.ts");

  assert.match(page, /id="resilience"/);
  assert.match(page, /landing\.hybridIncluded/);
  assert.match(thai, /Cloud และ Hybrid POS อยู่ในผลิตภัณฑ์เดียวกัน/);
  assert.match(thai, /ไม่ใช่แพ็กเกจแยก/);
  assert.match(english, /Cloud and Hybrid POS belong to one product/);
  assert.match(english, /not separate packages/);
});

test("Emergency Offline claims stay inside the implemented mobile cash boundary", () => {
  const contract = read("docs/business/cloud-hybrid-pos.md");
  const repositoryReadme = read("README.md");
  const mobile = read("apps/mobile/README.md");
  const desktop = read("apps/desktop/README.md");
  const manual = read("apps/web/lib/pos/posManualContent.tsx");

  for (const source of [contract, mobile, desktop, manual]) {
    assert.match(source, /Emergency Offline Mode/);
  }

  assert.match(contract, /plain retail cash sale/);
  assert.match(contract, /not a receipt or tax document/);
  assert.match(repositoryReadme, /BMS Cloud and BMS Hybrid POS are one product/);
  assert.match(repositoryReadme, /BMS Cloud และ BMS Hybrid POS เป็นผลิตภัณฑ์เดียวกัน/);
  assert.match(mobile, /not a local server or full-offline promise/);
  assert.match(desktop, /Emergency Offline Mode is mobile-only/);
  assert.match(manual, /BMS เดียว: Cloud \+ Emergency Offline/);
  assert.match(manual, /One BMS: Cloud \+ Emergency Offline/);
  assert.match(manual, /Restaurant\/board-game\/pharmacy require Cloud/);
  assert.doesNotMatch(manual, /Offline-first sync/);
  assert.doesNotMatch(manual, /This is not an offline POS/);
  assert.doesNotMatch(manual, /นี่ไม่ใช่ POS แบบออฟไลน์/);
});
