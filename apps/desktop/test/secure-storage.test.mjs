import assert from "node:assert/strict";
import test from "node:test";
import {
  platformClientLabel,
  platformSecurityNote,
  secureStorageStatus,
} from "../src/secure-storage.mjs";

test("accepts the OS keystores used by Windows and macOS", () => {
  assert.deepEqual(secureStorageStatus({ platform: "win32", encryptionAvailable: true }), { ok: true });
  assert.deepEqual(secureStorageStatus({ platform: "darwin", encryptionAvailable: true }), { ok: true });
});

test("accepts supported Linux Secret Service and KWallet backends", () => {
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    assert.deepEqual(
      secureStorageStatus({ platform: "linux", encryptionAvailable: true, backend }),
      { ok: true },
    );
  }
});

test("refuses Linux basic_text and unknown backends", () => {
  for (const backend of ["basic_text", "unknown", null]) {
    const status = secureStorageStatus({ platform: "linux", encryptionAvailable: true, backend });
    assert.equal(status.ok, false);
    assert.match(status.error, /Keyring/);
  }
});

test("reports an actionable message when encryption is unavailable", () => {
  const status = secureStorageStatus({
    platform: "linux",
    encryptionAvailable: false,
    backend: "gnome_libsecret",
  });
  assert.equal(status.ok, false);
  assert.match(status.error, /Secret Service|KWallet/);
});

test("uses platform-specific client and security labels", () => {
  assert.equal(platformClientLabel("linux"), "Linux Client");
  assert.equal(platformClientLabel("darwin"), "macOS Client");
  assert.equal(platformClientLabel("win32"), "Windows Client");
  assert.match(platformSecurityNote("linux"), /Linux Keyring/);
});
