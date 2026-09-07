// Database-free contract for the Admin sidebar footer.
// Run from apps/web: npx tsx --test ../../scripts/admin-sidebar-footer-contract.test.mts
//
// The footer used to be 5 blocks in 3 containers — 191px expanded and 223px collapsed, i.e.
// *more* space in the mode you pick to save space. Two failure modes matter here and both are
// invisible in a browser: a destination that quietly stops being reachable when a row folds into
// the ⋯ menu, and the loudness order inverting again so the rarest action (signing out) outshouts
// the page the user is actually on.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const sidebar = src("apps/web/components/AdminSidebar.tsx");
const slice = (from: string, to: string) => {
  const a = sidebar.indexOf(from);
  const b = sidebar.indexOf(to);
  // An anchor that stops matching would turn every assertion below into a vacuous pass.
  assert.ok(a >= 0, `anchor missing: ${from}`);
  assert.ok(b > a, `anchor out of order: ${to}`);
  return sidebar.slice(a, b);
};

const accountMenu = () => slice("const accountMenuItems", "const sidebarBody");
const footer = () => slice("{/* ท้ายแถบ:", "{mini && !aiOverLimit ? quotaMeter : null}");

test("expanded keeps the assistant on its own row; collapsed folds it into the ⋯ menu", () => {
  const block = footer();
  // The row is what the whole layout is built around: it is the one thing here touched daily.
  assert.match(block, /\{\(!mini \|\| aiOverLimit\) && \(/,
    "the assistant row must render while expanded, and while collapsed only when the quota is out");
  // Collapsed there is no room for a label, so a bare 16px icon would need a hover to identify —
  // not worth 43px of a 64px rail. It moves into the menu instead of disappearing for that mode.
  assert.match(accountMenu(), /\.\.\.\(compact\s*\n?\s*\?\s*\[\{\s*\n?\s*key: 'assistant'/,
    "the collapsed rail must still offer the assistant somewhere");
});

test("nothing that folded into the ⋯ menu lost its way in", () => {
  const menu = accountMenu();
  // Folding rows into a menu is only safe if the menu actually carries them.
  for (const href of ["/admin/assistant", "/admin/manual", "/admin/profile"]) {
    assert.ok(menu.includes(href), `${href} is no longer offered anywhere in the footer`);
  }
  // Signing out is the one item with no route; it has to keep calling the real handler.
  assert.match(menu, /key: 'logout'[\s\S]*?danger: true[\s\S]*?onClick: onLogout/,
    "sign out must stay in the menu, marked destructive, wired to onLogout");
});

test("signing out is no longer the loudest control on the rail", () => {
  // A filled full-width danger Button for the rarest action outshouted the active menu entry.
  // It reads as the primary action of the whole sidebar, which is exactly backwards.
  assert.doesNotMatch(sidebar, /danger type="primary"/,
    "sign out must not go back to being a filled full-width button");
  assert.doesNotMatch(footer(), /<Button/, "the footer holds rows and a menu, not a button block");
});

test("the identity row goes to the profile it names; ⋮ carries the rest", () => {
  const block = footer();
  const identity = block.slice(block.indexOf("{admin && ("));
  const collapsed = identity.slice(identity.indexOf("{mini ? ("), identity.indexOf(") : ("));
  const expanded = identity.slice(identity.indexOf(") : ("));
  assert.ok(collapsed.length > 0 && expanded.length > 0, "identity branches moved — re-aim this slice");

  // The row shows the signed-in person's own name, so tapping it has one obvious meaning.
  // Routing it to the menu instead would put their profile two taps behind the thing naming them.
  assert.match(expanded, /<Link\s*\n?\s*className="bms-sider-quiet"\s*\n?\s*href="\/admin\/profile"/);
  // ⋮ is its own control with its own name — a <div onClick> here would be unfocusable, and the
  // menu holds the only path to signing out.
  assert.match(expanded, /<button\s*\n?\s*type="button"[\s\S]*?aria-haspopup="menu"[\s\S]*?<MoreOutlined/);
  assert.match(expanded, /aria-label=\{t\('admin\.account_menu'\)\}/);
});

test("the collapsed rail keeps its one target on the menu, not on the profile", () => {
  const block = footer();
  const identity = block.slice(block.indexOf("{admin && ("));
  const collapsed = identity.slice(identity.indexOf("{mini ? ("), identity.indexOf(") : ("));
  assert.ok(collapsed.length > 0, "collapsed branch moved — re-aim this slice");
  // 64px of rail fits one target. Pointing it at the profile would strand sign-out: there is no
  // second control down there, and a pos_only account cannot reach /admin to find another way out.
  assert.match(collapsed, /<Dropdown menu=\{\{ items: accountMenuItems\(true\) \}\}/);
  assert.doesNotMatch(collapsed, /href="\/admin\/profile"/,
    "the collapsed avatar must open the menu — sign out has nowhere else to live");
});

test("the quota lives on the row that spends it, and its destination follows its message", () => {
  const block = footer();
  // Two blocks pointing at two pages answered one question before this. The number rides the
  // assistant row now, so "how much is left" sits on the thing that consumes it.
  assert.match(block, /t\('admin\.ai_quota_count'/);
  assert.match(block, /t\('admin\.ai_quota_remaining'/);
  // Out of quota is the only state whose text tells the reader to go add a key, so it is the only
  // state whose link may leave the assistant. Sending a normal click to settings would be a lie.
  assert.match(block, /href=\{aiOverLimit \? '\/admin\/settings' : '\/admin\/assistant'\}/);
});

test("the quota meter is an indicator, never a 3px tap target", () => {
  const meter = slice("const quotaMeter", "const accountMenuItems");
  assert.match(meter, /height: 3/);
  assert.match(meter, /aria-hidden/);
  // A 3px line that claims to be clickable cannot be hit, especially by a finger.
  assert.doesNotMatch(meter, /href|Tooltip|onClick/,
    "the meter must not pretend to be interactive — the row above it is the target");
  // Full-bleed: it sits outside the rows' 10px padding, so it must not carry padding of its own.
  assert.doesNotMatch(meter, /padding/);
});

test("running out of quota is still allowed to shout", () => {
  const block = footer();
  // Escalation is the reason the normal state can be quiet. Lose this and the redesign turns a
  // real "customers are waiting" alert into a grey line nobody notices.
  assert.match(block, /background: aiOverLimit \? aiBg : undefined/);
  assert.match(block, /aiOverLimit \? aiStripText : t\('admin_nav\.assistant'\)/);
  assert.match(block, /\{aiOverLimit && \(/, "the alert dot belongs to the out-of-quota state");
});

test("the ⋯ menu does not grow a second theme switch", () => {
  // ThemeToggle already sits on HeaderBar on every page. Two places doing one job is the pattern
  // this footer was collapsed to remove, so it must not be reintroduced one row lower.
  assert.match(src("apps/web/components/HeaderBar.tsx"), /<ThemeToggle \/>/);
  assert.doesNotMatch(accountMenu(), /theme|Theme/,
    "theme belongs to HeaderBar's toggle, not to the sidebar account menu");
});
