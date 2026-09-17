// =============================================================
// เครื่องขายต้องสแกนด้วยกล้องจริง ไม่ใช่เพียงเปิดช่องกรอกที่หน้าตาเหมือน scanner
// ---------------------------------------------------------------------------
// จอเดิมมี TextInput + autofocus อย่างเดียว จึงรับได้เฉพาะการพิมพ์หรือ HID keyboard
// แต่คำว่า “สแกนบาร์โค้ด” บนโทรศัพท์/แท็บเล็ตต้องเปิด native camera เป็นทางหลัก
// และยังคงช่องกรอกไว้เป็น fallback เมื่อกล้องใช้ไม่ได้เท่านั้น
//
//   cd apps/web && npx tsx --test ../../scripts/mobile-camera-scanner-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const scanner = read("../apps/mobile/src/components/BarcodeScannerModal.tsx");
const menu = read("../apps/mobile/src/screens/sell/MenuScreen.tsx");
const infoPlist = read("../apps/mobile/ios/BmsPos/Info.plist");
const podLock = read("../apps/mobile/ios/Podfile.lock");
const packageJson = JSON.parse(read("../apps/mobile/package.json"));

test("mobile POS ติดตั้ง native camera scanner ครบทั้ง JavaScript และ iOS", () => {
  assert.equal(packageJson.dependencies["react-native-data-scanner"], "^0.1.2");
  assert.ok(
    packageJson.dependencies["react-native-nitro-modules"],
    "native scanner ต้องมี Nitro runtime ที่ประกาศตรง ๆ ไม่พึ่ง dependency แฝง"
  );
  assert.match(podLock, /NitroDataScanner \(0\.1\.2\)/);
  assert.match(podLock, /NitroModules \(/);
  assert.match(
    infoPlist,
    /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/,
    "iOS ต้องบอกเหตุผลขอใช้กล้อง มิฉะนั้นแอปจะปิดทันทีเมื่อเปิดกล้อง"
  );
});

test("กดสแกนจากหน้าขายแล้วเปิด native camera โดยอัตโนมัติ", () => {
  assert.match(menu, /<BarcodeScannerModal[\s\S]*visible=\{scannerOpen\}/);
  assert.match(scanner, /DataScanner\.scanBarcode\(\{/);
  assert.match(scanner, /enableAutoZoom:\s*true/);
  assert.match(scanner, /targetFormats:\s*\[\.\.\.BARCODE_FORMATS\]/);
  assert.match(
    scanner,
    /if \(visible && !startedForOpenRef\.current\)[\s\S]*openCamera\(\)/,
    "modal เปิดแล้วต้องเริ่ม camera flow เอง ไม่บังคับให้กดซ้ำอีกครั้ง"
  );
});

test("binary เก่าที่ไม่มี native scanner ต้องตก fallback ไม่ทำให้ทั้งแอปแดง", () => {
  assert.doesNotMatch(
    scanner,
    /^import\s+\{\s*DataScanner\s*\}\s+from\s+['"]react-native-data-scanner['"]/m,
    "top-level native import จะ throw ก่อน component จับ error ได้"
  );
  assert.match(scanner, /import\('react-native-data-scanner'\)/);
  assert.match(
    scanner,
    /NitroModules\|Turbo\\\/Native-Module\|could not be found/
  );
  assert.match(scanner, /แอปที่ติดตั้งอยู่ยังไม่มีโมดูลกล้อง/);
});

test("รหัสจากกล้องต้องผ่าน resolver เดิมก่อนเพิ่มสินค้า", () => {
  assert.match(
    scanner,
    /resolveScannedCode\(result\.value, attempt\)/,
    "ค่าที่กล้องอ่านได้ต้องเข้าเส้นทางตรวจสินค้าเดียวกับการกรอกเอง"
  );
  assert.match(scanner, /resolveCodeRef\.current\(normalized\)/);
  assert.match(scanner, /if \(!item\.sellable\)/);
  assert.match(scanner, /onScannedRef\.current\(item\)/);
});

test("ยกเลิก native scanner ต้องกลับหน้าขาย ส่วนกล้องเสียจึงค่อยแสดงช่องกรอก", () => {
  assert.match(
    scanner,
    /if \(scanWasCancelled\(scanError\)\)[\s\S]*onCancelRef\.current\(\)/
  );
  assert.match(
    scanner,
    /setView\('manual'\);\s*setError\(scannerFailureMessage\(scanError\)\)/
  );
  assert.match(scanner, /return 'เปิดกล้องสแกนไม่ได้/);
  assert.match(scanner, /view === 'manual'[\s\S]*<TextInput/);
  assert.match(scanner, /label="เปิดกล้องอีกครั้ง"/);
});
