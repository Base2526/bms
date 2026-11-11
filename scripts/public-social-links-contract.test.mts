import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");
const footer = readFileSync(resolve(repo, "apps/web/components/footer/AppFooter.tsx"), "utf8");

test("public footer exposes the verified BMS social destinations safely", () => {
  assert.match(footer, /const BMS_FACEBOOK_PAGE_URL = "https:\/\/www\.facebook\.com\/bmsaipos";/);
  assert.match(footer, /const BMS_YOUTUBE_CHANNEL_URL = "https:\/\/www\.youtube\.com\/@bmspos-ai";/);
  assert.match(footer, /href=\{BMS_FACEBOOK_PAGE_URL\}[\s\S]*?target="_blank" rel="noopener noreferrer"/);
  assert.match(footer, /href=\{BMS_YOUTUBE_CHANNEL_URL\}[\s\S]*?target="_blank" rel="noopener noreferrer"/);
  assert.match(footer, /<FacebookFilled \/>Facebook Page/);
  assert.match(footer, /<YoutubeFilled \/>YouTube/);
});

test("public footer keeps the social links bilingual and phone-safe", () => {
  assert.match(footer, /follow: "ติดตาม BMS"/);
  assert.match(footer, /follow: "Follow BMS"/);

  const phone = footer.slice(footer.indexOf("@media (max-width: 640px)"));
  assert.match(phone, /\.bms-footer-social-links \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); width: 100%; \}/);
  assert.match(phone, /\.bms-footer-social-link \{ min-width: 0;/);
});
