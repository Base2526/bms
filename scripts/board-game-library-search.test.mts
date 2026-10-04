import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gameCopyOptions, matchesGameSearch, normalizeGameSearch, searchGameLibrary } from "../apps/web/lib/pos/boardGameLibrarySearch.ts";

const games = [
  { id: "a", title: "Catan ภาคหลัก", copies: [{ id: "a1", copyCode: "BG-001", status: "IN_USE" }, { id: "a2", copyCode: "BG-002", status: "AVAILABLE" }] },
  { id: "b", title: "Azul", copies: [{ id: "b1", copyCode: "8851234567890", status: "AVAILABLE" }] },
  { id: "c", title: "เกมใหม่", copies: [] },
];
test("game search matches Thai, case-insensitive names and exact barcode/copy codes", () => {
  for (const query of ["catan", "ภาคหลัก", " cAtAn 002 ", "BG-002"]) {
    assert.deepEqual(searchGameLibrary(games, query).map((game) => game.id), ["a"]);
  }
  assert.equal(searchGameLibrary(games, "8851234567890")[0].id, "b");
  assert.equal(searchGameLibrary(games, "เกมใหม่")[0].id, "c");
  assert.deepEqual(searchGameLibrary(games, "unknown"), []);
  assert.equal(searchGameLibrary(games, "").length, 3);
});
test("availability never confuses two copies of the same game", () => {
  assert.equal(searchGameLibrary(games, "", true).length, 2);
  assert.equal(searchGameLibrary(games, "BG-001", true).length, 0);
  const options = gameCopyOptions(games);
  assert.equal(options.find((item) => item.value === "a1")?.disabled, true);
  assert.equal(options.find((item) => item.value === "a2")?.disabled, false);
  assert.equal(options.at(-1)?.value, "a1");
  assert.ok(matchesGameSearch("catan bg-002", "Catan ภาคหลัก", "BG-002"));
});
test("large catalog retains all copy identities and searchable codes", () => {
  const catalog = Array.from({ length: 5000 }, (_, i) => ({ id: `title-${i}`, title: `Game ${i}`,
    copies: [{ id: `copy-${i}`, copyCode: `BOX-${String(i).padStart(5, "0")}`, status: "AVAILABLE" }] }));
  assert.equal(gameCopyOptions(catalog).length, 5000);
  assert.equal(searchGameLibrary(catalog, "BOX-04999")[0].id, "title-4999");
});

test("Enter selects an exact available copy without submitting the surrounding form", () => {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const ts = require("typescript");
  const source = readFileSync(new URL("../apps/web/components/pos/BoardGameCopyPicker.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("onInputKeyDown={") + "onInputKeyDown={".length, source.indexOf("    optionRender=")).trim().replace(/}$/, "");
  const compiled = ts.transpileModule(`const handle = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [search, selected, stopped] of [["BG-002", "a2", true], ["BG-001", "", true], ["catan", "", false], ["", "", false], ["UNKNOWN", "", false]] as const) {
    let actual = "";
    let prevented = false;
    let propagationStopped = false;
    const handle = new Function("search", "options", "normalizeGameSearch", "onChange", "setSearch", `${compiled}; return handle;`)(search, gameCopyOptions(games), normalizeGameSearch, (value: string) => { actual = value; }, () => {});
    handle({ key: "Enter", nativeEvent: {}, preventDefault: () => { prevented = true; }, stopPropagation: () => { propagationStopped = true; } });
    assert.equal(actual, selected);
    assert.equal(prevented, true);
    assert.equal(propagationStopped, stopped, "ordinary name searches keep the Select's keyboard navigation");
  }
});
