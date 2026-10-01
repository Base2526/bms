import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const PAGES = ["setup", "startup"];

// electron-builder's default Depends: overriding `deb.depends` replaces this list, so every
// entry must be carried over or the package installs without a library Electron links against.
const ELECTRON_BUILDER_DEFAULT_DEB_DEPENDS = [
  "libgtk-3-0",
  "libnotify4",
  "libnss3",
  "libxss1",
  "libxtst6",
  "xdg-utils",
  "libatspi2.0-0",
  "libuuid1",
  "libsecret-1-0",
];

test("the .deb declares every library the Electron binary links against", () => {
  const depends = pkg.build?.deb?.depends;
  assert.ok(Array.isArray(depends), "build.deb.depends must be declared");
  for (const dependency of ELECTRON_BUILDER_DEFAULT_DEB_DEPENDS) {
    assert.ok(depends.includes(dependency), `deb.depends dropped electron-builder default ${dependency}`);
  }
  // libasound.so.2 is linked by the binary but missing from electron-builder's defaults: without
  // it apt reports success and the app cannot start. Ubuntu 24.04 renamed it libasound2t64.
  const alsa = depends.find((dependency) => /\blibasound2\b/.test(dependency));
  assert.ok(alsa, "deb.depends must require libasound2");
  assert.match(alsa, /^libasound2t64 \| libasound2$/, "keep the t64 name first so 24.04 and 22.04 both resolve");
});

test("the setup and startup pages use the bundled Thai font, not one the OS may lack", () => {
  const fontsCss = read("renderer/fonts/fonts.css");
  const faces = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1]);
  assert.ok(faces.length > 0, "fonts.css declares no @font-face");

  const thaiWeights = new Set();
  for (const face of faces) {
    assert.match(face, /font-family:\s*"IBM Plex Sans Thai"/);
    const file = /url\("\.\/([^"]+)"\)/.exec(face)?.[1];
    assert.ok(file, "every @font-face must point at a bundled file");
    assert.ok(existsSync(new URL(`renderer/fonts/${file}`, root)), `missing bundled font file ${file}`);
    if (/U\+0E01-0E5B/.test(face)) thaiWeights.add(Number(/font-weight:\s*(\d+)/.exec(face)?.[1]));
  }
  assert.ok(existsSync(new URL("renderer/fonts/OFL-IBM-Plex-Sans-Thai.txt", root)), "OFL licence must ship with the font");

  for (const page of PAGES) {
    const html = read(`renderer/${page}.html`);
    const fontsLink = html.indexOf('href="./fonts/fonts.css"');
    assert.ok(fontsLink > 0, `${page}.html must load fonts/fonts.css`);
    assert.ok(fontsLink < html.indexOf(`href="./${page}.css"`), `${page}.html must load fonts before ${page}.css`);

    const css = read(`renderer/${page}.css`);
    assert.match(
      /:root\s*{[^}]*font-family:\s*([^;]+);/.exec(css)?.[1] ?? "",
      /^"IBM Plex Sans Thai"/,
      `${page}.css must put the bundled face first, ahead of any OS font`,
    );
    // Every weight the page asks for needs its own Thai face (700 is the heaviest IBM Plex Sans
    // Thai ships, so 800 resolves to it). Matching a lighter face would render bold text thin.
    for (const [, weight] of css.matchAll(/font-weight:\s*(\d+)/g)) {
      const required = Math.min(Number(weight), 700);
      assert.ok(thaiWeights.has(required), `${page}.css uses font-weight ${weight} with no bundled Thai ${required} face`);
    }
  }
});

test("the bundled fonts are inside the packaged files glob", () => {
  assert.ok(pkg.build.files.includes("renderer/**/*"), "renderer/fonts must be packaged");
});
