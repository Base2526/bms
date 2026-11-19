import assert from "node:assert/strict";
import electronMain from "electron/main";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { secureStorageStatus } from "../src/secure-storage.mjs";

// Exercise the host keystore with synthetic text and a separate Electron profile.
// Never read the register's real pairing file or persist a device credential.
const { app, safeStorage } = electronMain;
app.setPath("userData", mkdtempSync(path.join(os.tmpdir(), "bms-keystore-smoke-")));
const watchdog = setTimeout(() => { console.error("Keystore smoke timed out"); app.exit(1); }, 30_000);
app.whenReady().then(() => {
  try {
    const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
    const status = secureStorageStatus({
      platform: process.platform,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      backend,
    });
    assert.equal(status.ok, true, status.error);
    const sample = "BMS keystore smoke: synthetic, not a device token";
    const encrypted = safeStorage.encryptString(sample);
    assert.notEqual(encrypted.toString("utf8"), sample);
    assert.equal(safeStorage.decryptString(encrypted), sample);
    console.log(`PASS native ${process.platform} secure-storage encryption/decryption`);
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  } finally {
    clearTimeout(watchdog);
  }
});
