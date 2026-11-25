// =============================================================
// antd v5 static message / Modal.confirm / notification must render on React 19.
// -------------------------------------------------------------
// After the Next 16 / React 19 upgrade, rc-util's mount found neither ReactDOM.createRoot nor
// ReactDOM.render on the main "react-dom" export and silently did nothing: 867 message.* toasts,
// 45 static Modal dialogs (delete/cancel confirmations) and 2 notifications never appeared, with no
// console error. Proven 2026-11-24 on the local dev server by calling the bundle's own
// message.success and Modal.confirm on /admin/dashboard (nothing rendered; both render after the
// fix). There is no DOM in the pure suite, so this contract pins the wiring and the installed
// versions it was proven with.
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));

test("the React 19 render hook is registered with react-dom/client createRoot", () => {
  const hook = read("lib/antdReact19Render.ts");
  assert.match(hook, /^"use client";/);
  assert.match(hook, /import \{ unstableSetRender \} from "antd";/);
  assert.match(hook, /import \{ createRoot, type Root \} from "react-dom\/client";/);
  assert.match(hook, /\nunstableSetRender\(\(node, container\) => \{/);
  assert.match(hook, /root\.render\(node\);/);
  assert.match(hook, /root\.unmount\(\);/);
});

test("ClientProviders loads the hook before anything else", () => {
  const lines = read("app/ClientProviders.tsx").split(/\r?\n/).filter((line) => /^import\b/.test(line));
  assert.equal(lines[0], 'import "@/lib/antdReact19Render";', "first import, ahead of any antd use");
});

test("the hook is needed: React 19's react-dom main export has no render or createRoot", () => {
  const reactDom = require("react-dom");
  const major = Number(String(require("react/package.json").version).split(".")[0]);
  const antdMajor = Number(String(require("antd/package.json").version).split(".")[0]);
  if (major >= 19 && antdMajor === 5) {
    assert.equal(typeof reactDom.render, "undefined");
    assert.equal(typeof reactDom.createRoot, "undefined");
    assert.equal(typeof require("antd").unstableSetRender, "function");
  }
});
