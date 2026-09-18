import assert from "node:assert/strict";
import test from "node:test";
import {
  desktopMenuTemplate,
  installFixedZoomPolicy,
  isDesktopZoomShortcut,
} from "../src/zoom-policy.mjs";

test("blocks desktop zoom accelerators without consuming ordinary POS input", () => {
  for (const platformModifier of ["control", "meta"]) {
    assert.equal(isDesktopZoomShortcut({ [platformModifier]: true, key: "+", code: "Equal" }), true);
    assert.equal(isDesktopZoomShortcut({ [platformModifier]: true, key: "-", code: "Minus" }), true);
    assert.equal(isDesktopZoomShortcut({ [platformModifier]: true, key: "0", code: "Digit0" }), true);
    assert.equal(isDesktopZoomShortcut({ [platformModifier]: true, key: "+", code: "NumpadAdd" }), true);
  }
  assert.equal(isDesktopZoomShortcut({ control: false, meta: false, key: "0", code: "Digit0" }), false);
  assert.equal(isDesktopZoomShortcut({ control: true, meta: false, key: "p", code: "KeyP" }), false);
  assert.equal(isDesktopZoomShortcut({ control: true, meta: false, alt: true, key: "+", code: "Equal" }), false);
});

test("fixed zoom policy resets layout zoom and prevents keyboard, wheel, and pinch zoom", async () => {
  const listeners = new Map();
  const factors = [];
  const visualLimits = [];
  const webContents = {
    isDestroyed: () => false,
    setZoomFactor: (factor) => factors.push(factor),
    setVisualZoomLevelLimits: async (minimum, maximum) => visualLimits.push([minimum, maximum]),
    on: (event, listener) => listeners.set(event, listener),
  };

  installFixedZoomPolicy(webContents);
  await Promise.resolve();
  assert.deepEqual(visualLimits, [[1, 1]]);
  assert.deepEqual(factors, [1]);

  let keyboardPrevented = false;
  listeners.get("before-input-event")(
    { preventDefault: () => { keyboardPrevented = true; } },
    { control: true, key: "+", code: "Equal" },
  );
  assert.equal(keyboardPrevented, true);

  let wheelPrevented = false;
  listeners.get("zoom-changed")({ preventDefault: () => { wheelPrevented = true; } }, "in");
  assert.equal(wheelPrevented, true);
  assert.deepEqual(factors, [1, 1, 1]);
});

test("application menus omit zoom roles on macOS, Windows, and Linux", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const template = desktopMenuTemplate(platform);
    const roles = JSON.stringify(template);
    assert.doesNotMatch(roles, /zoomIn|zoomOut|resetZoom/i);
    assert.match(roles, /togglefullscreen/);
  }
});
