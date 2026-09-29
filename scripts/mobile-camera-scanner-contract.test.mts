import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\r\n]*/g, "");

const scanner = withoutComments(
  read("../apps/mobile/src/components/BarcodeScannerModal.tsx")
);
const menu = withoutComments(
  read("../apps/mobile/src/screens/sell/MenuScreen.tsx")
);
const preference = withoutComments(
  read("../apps/mobile/src/lib/scannerPreference.ts")
);
const scannerInput = withoutComments(
  read("../apps/mobile/src/lib/scannerInput.ts")
);
const infoPlist = read("../apps/mobile/ios/BmsPos/Info.plist");
const podLock = read("../apps/mobile/ios/Podfile.lock");
const packageJson = JSON.parse(read("../apps/mobile/package.json"));

test("mobile POS ติดตั้ง native camera scanner ครบทั้ง JavaScript และ iOS", () => {
  assert.equal(packageJson.dependencies["react-native-data-scanner"], "^0.1.2");
  assert.ok(
    packageJson.dependencies["react-native-nitro-modules"],
    "native scanner ต้องมี Nitro runtime ที่ประกาศตรง ๆ ไม่พึ่ง dependency แฝง"
  );
  assert.ok(/NitroDataScanner \(0\.1\.2\)/.test(podLock));
  assert.ok(/NitroModules \(/.test(podLock));
  assert.ok(
    /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(
      infoPlist
    ),
    "iOS ต้องบอกเหตุผลขอใช้กล้อง มิฉะนั้นแอปจะปิดทันทีเมื่อเปิดกล้อง"
  );
});

test("ค่าปริยายยังเปิดกล้องอัตโนมัติ แต่ค่าที่จำเป็น hardware ข้ามกล้อง", () => {
  assert.ok(/<BarcodeScannerModal[\s\S]*visible=\{scannerOpen\}/.test(menu));
  assert.ok(/DataScanner\.scanBarcode\(\{/.test(scanner));
  assert.ok(/enableAutoZoom:\s*true/.test(scanner));
  assert.ok(/targetFormats:\s*\[\.\.\.BARCODE_FORMATS\]/.test(scanner));
  assert.ok(
    /loadScannerInputMode\(\)[\s\S]*preferredMode === 'hardware'[\s\S]*enterHardwareScannerMode\(false\)[\s\S]*openCamera\(false\)/.test(
      scanner
    ),
    "modal ต้องอ่านค่าต่อเครื่องก่อนตัดสินใจเปิดกล้อง"
  );
});

test("binary เก่าที่ไม่มี native scanner ต้องตก fallback ไม่ทำให้ทั้งแอปแดง", () => {
  assert.ok(
    !/^import\s+\{\s*DataScanner\s*\}\s+from\s+['"]react-native-data-scanner['"]/m.test(
      scanner
    ),
    "top-level native import จะ throw ก่อน component จับ error ได้"
  );
  assert.ok(/import\('react-native-data-scanner'\)/.test(scanner));
  assert.ok(/NitroModules\|Turbo\\\/Native-Module\|could not be found/.test(scanner));
  assert.ok(/แอปที่ติดตั้งอยู่ยังไม่มีโมดูลกล้อง/.test(scanner));
});

test("เลือกเครื่องสแกนได้ทั้งตอนเปิดกล้องและในช่องกรอก และจำค่าด้วย Keychain", () => {
  assert.equal(scanner.match(/label="ใช้เครื่องสแกน"/g)?.length, 2);
  assert.ok(/label="เปิดกล้องอีกครั้ง"/.test(scanner));
  assert.ok(/saveScannerInputMode\('hardware'\)/.test(scanner));
  assert.ok(/saveScannerInputMode\('camera'\)/.test(scanner));
  assert.ok(/com\.bms\.pos\.scanner-preference\.v1/.test(preference));
  assert.ok(/Keychain\.getGenericPassword\(\{ service: SERVICE \}\)/.test(preference));
  assert.ok(/Keychain\.setGenericPassword\(USERNAME, mode,/.test(preference));
  assert.ok(/await storageLock/.test(preference));
  assert.ok(/catch\s*\{[\s\S]*return 'camera'/.test(preference));
});

test("รหัสทุกโหมดต้องผ่าน resolver เดิมก่อนเพิ่มสินค้า", () => {
  assert.ok(/resolveScannedCode\(result\.value, attempt, 'camera'\)/.test(scanner));
  assert.ok(/resolveCodeRef\.current\(normalized\)/.test(scanner));
  assert.ok(/if \(!item\.sellable\)/.test(scanner));
  assert.ok(/onScannedRef\.current\(item, source\)/.test(scanner));
});

test("โหมด hardware เพิ่มต่อเนื่องโดย modal ไม่ปิด ล้างช่อง คืน focus และบอกสินค้าล่าสุด", () => {
  const hardwareBranch =
    /if \(inputMode === 'hardware'\)\s*\{([\s\S]*?)\s*return;\s*\}/.exec(
      menu
    )?.[1] ??
    "";
  assert.ok(
    /if \(inputMode === 'hardware'\)\s*\{[\s\S]*scannedItemNeedsOptions\(item\)[\s\S]*setConfiguring\(item\)[\s\S]*addCompletedHardwareScan\(item\)[\s\S]*return;\s*\}[\s\S]*setScannerOpen\(false\)/.test(
      menu
    ),
    "เฉพาะ camera flow เท่านั้นที่ปิด modal หลัง resolve สำเร็จ"
  );
  assert.ok(
    !/setScannerOpen\(false\)/.test(hardwareBranch),
    "hardware flow ต้องรอให้ผู้ใช้กดเสร็จเอง"
  );
  assert.ok(
    /const addCompletedHardwareScan[\s\S]*addItem\(item\);[\s\S]*setCompletedHardwareScan\(\{[\s\S]*name: item\.name/.test(
      menu
    ),
    "ต้องยืนยัน completion หลังเพิ่มลงตะกร้าจริง"
  );
  assert.ok(
    /completedHardwareScan\.sequence === completedSequenceRef\.current[\s\S]*setLastAdded\(completedHardwareScan\.name\);[\s\S]*manualInputRef\.current\?\.focus\(\)/.test(
      scanner
    )
  );
  assert.ok(/เพิ่มแล้ว · \{lastAdded\}/.test(scanner));
  assert.ok(/label=\{inputMode === 'hardware' \? 'เสร็จ' : 'ยกเลิก'\}/.test(scanner));
});

test("submit จาก HID กัน CR+LF ซ้ำและ response เก่าเพิ่มสินค้าไม่ได้", () => {
  const resolvedHardwareBlock =
    /onScannedRef\.current\(item, source\);\s*if \(source === 'hardware'\)\s*\{([\s\S]*?)\}\s*\} catch/.exec(
      scanner
    )?.[1] ?? "";
  assert.ok(
    /const currentCode = codeRef\.current;\s*if \(!currentCode\.trim\(\) \|\| loading \|\| submittingRef\.current\) return;\s*submittingRef\.current = true/.test(
      scanner
    )
  );
  assert.ok(
    /codeRef\.current = '';[\s\S]*manualInputRef\.current\?\.clear\(\)/.test(
      resolvedHardwareBlock
    ),
    "ต้องล้างค่าที่ submit อ่านแบบ synchronous ก่อน CR+LF terminator ถัดไป"
  );
  assert.ok(/const attempt = \+\+attemptRef\.current/.test(scanner));
  assert.ok(/attempt !== attemptRef\.current/.test(scanner));
  assert.ok(/attempt === attemptRef\.current\) submittingRef\.current = false/.test(scanner));
});

test("รหัสไม่พบค้างในช่องและถูกเลือกทั้งหมด ส่วนอักษรไทยแนะนำ English (US)", () => {
  assert.ok(/setCode\(normalized\)/.test(scanner));
  assert.ok(/setSelection\(\{ start: 0, end: normalized\.length \}\)/.test(scanner));
  assert.ok(/selection=\{selection\}/.test(scanner));
  assert.ok(/containsThaiCharacters\(normalized\)/.test(scanner));
  assert.ok(/\\u0E00-\\u0E7F/.test(scannerInput));
  assert.ok(
    /เปลี่ยนคีย์บอร์ดฮาร์ดแวร์เป็น English \(US\) ที่ ตั้งค่า > ทั่วไป > คีย์บอร์ด/.test(
      scanner
    )
  );
});

test("กล้องยังปิด modal เมื่อสำเร็จหรือยกเลิก และกล้องเสียจึงแสดงช่องกรอก", () => {
  assert.ok(
    /if \(scanWasCancelled\(scanError\)\)[\s\S]*onCancelRef\.current\(\)/.test(
      scanner
    )
  );
  assert.ok(
    /setView\('manual'\);\s*setError\(scannerFailureMessage\(scanError\)\)/.test(
      scanner
    )
  );
  assert.ok(/return 'เปิดกล้องสแกนไม่ได้/.test(scanner));
  assert.ok(/view === 'manual'[\s\S]*<TextInput/.test(scanner));
});
