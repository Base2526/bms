import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLanguageStore } from "../src/language-store.mjs";
import locale from "../renderer/locale.cjs";
import {
  secureStorageStatus,
  platformSecurityNote,
} from "../src/secure-storage.mjs";
import { desktopMenuTemplate, localizeNativeMenu } from "../src/zoom-policy.mjs";
import { createReceiptPrinter } from "../src/receipt-printer.mjs";

test("native generated menu roles translate in place without changing actions or shortcuts", () => {
  const click = () => {};
  const copy = { role: "copy", label: "Copy", accelerator: "CmdOrCtrl+C", click };
  const custom = { label: "FAKE extension label", click };
  const menu = { items: [{ role: "editmenu", submenu: { items: [copy, custom] } }] };
  try {
    locale.applyAppLanguage("th");
    assert.equal(localizeNativeMenu(menu), menu);
    assert.equal(menu.items[0].label, "แก้ไข");
    assert.equal(copy.label, "คัดลอก");
    assert.equal(copy.accelerator, "CmdOrCtrl+C");
    assert.equal(copy.click, click);
    assert.equal(custom.label, "FAKE extension label");
    locale.applyAppLanguage("en");
    localizeNativeMenu(menu);
    assert.equal(copy.label, "Copy");
    assert.equal(menu.items[0].label, "Edit");
  } finally { locale.applyAppLanguage("th"); }
});

test("shell translations preserve interpolation fields and user-entered values", () => {
  const fields = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, translated] of Object.entries(locale.english)) {
    assert.ok(translated.trim(), source);
    assert.deepEqual(fields(translated), fields(source), source);
  }
  try {
    locale.applyAppLanguage("en");
    assert.equal(locale.posText("ข้อมูลจากผู้ใช้"), "ข้อมูลจากผู้ใช้");
  } finally {
    locale.applyAppLanguage("th");
  }
});

// Removes // and /* */ comments while leaving string and template literal contents intact, so a
// comment that quotes an old message cannot satisfy (or fail) the catalogue scan below.
function stripComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

test("every literal posText message in the shell has an English catalogue entry", () => {
  const sourceDir = new URL("../src/", import.meta.url);
  const rendererDir = new URL("../renderer/", import.meta.url);
  const files = [
    ...readdirSync(sourceDir).filter((name) => /\.(mjs|cjs)$/.test(name)).map((name) => new URL(name, sourceDir)),
    ...readdirSync(rendererDir).filter((name) => /\.(js|cjs)$/.test(name) && name !== "locale.cjs")
      .map((name) => new URL(name, rendererDir)),
  ];
  const missing = [];
  let literalCalls = 0;
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\bposText\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      literalCalls += 1;
      const message = match[2];
      if (!Object.hasOwn(locale.english, message)) missing.push(`${file.pathname.split("/").slice(-2).join("/")}: ${message}`);
    }
  }
  assert.ok(literalCalls > 50, `expected the scan to find the shell's posText calls, found ${literalCalls}`);
  assert.deepEqual(missing, [], "English operators would see these Thai messages untranslated");
});

test("startup messages switch both ways without changing unknown diagnostics", () => {
  try {
    locale.applyAppLanguage("en");
    const translated = locale.shellMessage("ยังอ่านข้อมูลจับคู่เดิมไม่ได้");
    assert.notEqual(translated, "ยังอ่านข้อมูลจับคู่เดิมไม่ได้");
    locale.applyAppLanguage("th");
    assert.equal(locale.shellMessage(translated), "ยังอ่านข้อมูลจับคู่เดิมไม่ได้");
    assert.equal(locale.shellMessage("Unknown OS diagnostic"), "Unknown OS diagnostic");
    assert.equal(locale.shellMessage(null), null);
  } finally {
    locale.applyAppLanguage("th");
  }
});

test("isolated receipt failures are localized without changing OS diagnostics", async () => {
  const print = createReceiptPrinter({
    createWindow: () => assert.fail("A missing receipt must not open a print window"),
    getPrinters: async () => [],
    getConfig: () => ({}),
  });
  try {
    locale.applyAppLanguage("en");
    const missing = await print({ executeJavaScript: async () => { throw new Error("Error: ไม่พบใบเสร็จสำหรับพิมพ์"); } });
    assert.deepEqual(missing, { ok: false, error: "No receipt available to print" });
    const diagnostic = await print({ executeJavaScript: async () => { throw new Error("OS diagnostic 42"); } });
    assert.deepEqual(diagnostic, { ok: false, error: "OS diagnostic 42" });
  } finally {
    locale.applyAppLanguage("th");
  }
});

test("language survives a store restart; rapid writes finish in order; invalid values cannot overwrite it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bms-language-"));
  try {
    const store = createLanguageStore(dir);
    assert.equal(await store.read(), "th");
    await Promise.all([
      store.write("en"),
      store.write("th"),
      store.write("en"),
    ]);
    assert.equal(await createLanguageStore(dir).read(), "en");
    await assert.rejects(store.write("../other"));
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "language.json"), "utf8")),
      "en"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell menu and keystore failures follow language while keeping platform-specific advice", () => {
  try {
    locale.applyAppLanguage("en");
    assert.match(
      secureStorageStatus({ platform: "linux", encryptionAvailable: false })
        .error,
      /Linux Keyring/
    );
    assert.match(platformSecurityNote("darwin"), /Mac.*Keychain/);
    assert.equal(
      desktopMenuTemplate("win32")[0].submenu[0].label,
      "Open back office"
    );
    locale.applyAppLanguage("th");
    assert.match(
      secureStorageStatus({ platform: "linux", encryptionAvailable: false })
        .error,
      /กรุณาติดตั้ง/
    );
    assert.equal(
      desktopMenuTemplate("win32")[0].submenu[0].label,
      "เปิดระบบหลังบ้าน"
    );
  } finally {
    locale.applyAppLanguage("th");
  }
});
