import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { prepareStoreLogo } from "../apps/web/lib/bms/storeLogo.ts";

const sharp = createRequire(new URL("../apps/web/package.json", import.meta.url))("sharp");

test("valid PNG, JPG and WebP decode to a bounded printable PNG", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const input = await sharp({ create: { width: 1600, height: 800, channels: 4, background: { r: 24, g: 80, b: 120, alpha: 0.5 } } }).toFormat(format).toBuffer();
    const output = await prepareStoreLogo(input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 512);
    if (format !== "jpeg") assert.equal(metadata.hasAlpha, true);
  }
});

test("small transparent logos are not enlarged", async () => {
  const input = await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const metadata = await sharp(await prepareStoreLogo(input)).metadata();
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 60);
  assert.equal(metadata.hasAlpha, true);
});

test("spoofed, empty, oversized and truncated logos cannot be published", async () => {
  for (const input of [Buffer.alloc(0), Buffer.from("<html>not an image</html>"), Buffer.alloc(5 * 1024 * 1024 + 1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')]) {
    await assert.rejects(prepareStoreLogo(input));
  }
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(prepareStoreLogo(png.subarray(0, 40)));
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(prepareStoreLogo(huge));
});
