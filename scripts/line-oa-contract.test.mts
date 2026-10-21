import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BMS_LINE_OA_ID, BMS_LINE_OA_URL, lineAddFriendUrl } from "../apps/web/lib/bms/lineOfficialAccount.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the add-friend link is LINE's documented form for BMS's own account", () => {
  assert.equal(BMS_LINE_OA_ID, "@168tnlzi");
  assert.equal(BMS_LINE_OA_URL, "https://line.me/R/ti/p/%40168tnlzi");
  assert.equal(lineAddFriendUrl("  @abc.def_1 "), "https://line.me/R/ti/p/%40abc.def_1");
});

test("an ID that isn't a LINE ID is refused instead of producing a dead link", () => {
  for (const bad of ["168tnlzi", "@", "@bad id", "@x/../y", "@<script>", `@${"a".repeat(41)}`, ""]) {
    assert.throws(() => lineAddFriendUrl(bad), /Invalid LINE Official Account ID/);
  }
});

test("homepage and footer link through the one constant and open LINE in a new tab safely", () => {
  for (const file of ["apps/web/app/(main)/page.tsx", "apps/web/components/footer/AppFooter.tsx"]) {
    const src = withoutComments(read(file));
    assert.ok(src.includes("href={BMS_LINE_OA_URL}"), `${file} must link to BMS_LINE_OA_URL`);
    assert.ok(!/line\.me|@168tnlzi/.test(src), `${file} must not hardcode the LINE URL or ID`);
    assert.ok(/href=\{BMS_LINE_OA_URL\}[^>]*rel="noopener noreferrer"/s.test(src), `${file} external LINE link needs rel="noopener noreferrer"`);
  }
});

test("the homepage LINE button stays secondary to signing up", () => {
  const page = withoutComments(read("apps/web/app/(main)/page.tsx"));
  const button = page.slice(page.indexOf("className={styles.lineCta}") - 200, page.indexOf("landing.lineAsk"));
  assert.ok(button.length > 0 && !/type="primary"/.test(button.slice(button.lastIndexOf("<Button"))), "LINE button must not be a primary button");
});

test("the footer QR is hidden on phones, which cannot scan their own screen", () => {
  const footer = read("apps/web/components/footer/AppFooter.tsx");
  const phone = footer.slice(footer.indexOf("@media (max-width: 640px)"));
  assert.ok(/\.bms-footer-line-qr \{ display: none; \}/.test(phone), "phone layout must hide .bms-footer-line-qr");
});
