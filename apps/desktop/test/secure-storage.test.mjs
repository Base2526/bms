import assert from "node:assert/strict";
import test from "node:test";
import { createPairingWriter, readSavedPairing, PairingRestoreError } from "../src/pairing-store.mjs";
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

const savedToken = `pos_${"a".repeat(43)}`;
const savedPairing = JSON.stringify({ version: 1, serverUrl: "https://shop.example.com", token: "encrypted", posEntryPath: "/pos/app" });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("unpair waits for an in-flight cache write and cannot resurrect its token", async () => {
  let stored = savedPairing;
  let temporary;
  const writing = deferred();
  const release = deferred();
  const writer = createPairingWriter("fixture/pairing.json", () => "encrypted", {
    writeFile: async (_file, payload, options) => {
      assert.equal(options.mode, 0o600);
      temporary = payload;
      writing.resolve();
      await release.promise;
    },
    rename: async () => { stored = temporary; },
    rm: async () => { stored = null; },
  });
  const saving = writer.write({ serverUrl: "https://shop.example.com", token: savedToken, posEntryPath: "/pos/app" });
  await writing.promise;
  const removing = writer.remove();
  release.resolve();
  await Promise.all([saving, removing]);
  assert.equal(stored, null);
});

test("concurrent pairing writes use separate turns and retain the final requested token", async () => {
  let temporary;
  let stored;
  let writes = 0;
  const writing = deferred();
  const release = deferred();
  const writer = createPairingWriter("fixture/pairing.json", token => `encrypted-${token}`, {
    writeFile: async (_file, payload) => {
      temporary = payload;
      if (++writes === 1) { writing.resolve(); await release.promise; }
    },
    rename: async () => { stored = temporary; temporary = undefined; },
    rm: async () => { stored = null; },
  });
  const first = writer.write({ serverUrl: "https://shop.example.com", token: "first" });
  await writing.promise;
  const next = writer.write({ serverUrl: "https://shop.example.com", token: "second" });
  assert.equal(writes, 1);
  release.resolve();
  await Promise.all([first, next]);
  assert.equal(JSON.parse(stored).token, "encrypted-second");
});

test("a failed write preserves the previous pairing and does not block later removal", async () => {
  let stored = savedPairing;
  const writer = createPairingWriter("fixture/pairing.json", () => "encrypted", {
    writeFile: async () => {},
    rename: async () => { throw new Error("rename unavailable"); },
    rm: async () => { stored = null; },
  });
  await assert.rejects(writer.write({ serverUrl: "https://shop.example.com", token: savedToken }), /rename unavailable/);
  assert.equal(stored, savedPairing);
  await writer.remove();
  assert.equal(stored, null);
});

test("the saved pairing survives relaunch/app-version changes without reissuing a token", async () => {
  const read = async () => savedPairing;
  const decrypt = (value) => { assert.equal(value, "encrypted"); return savedToken; };
  const first = await readSavedPairing("pairing.json", decrypt, read);
  const nextLaunch = await readSavedPairing("pairing.json", decrypt, read);
  assert.deepEqual(nextLaunch, first);
  assert.equal(nextLaunch.token, savedToken);
});

test("only ENOENT means unpaired; unreadable files are recoverable failures", async () => {
  assert.equal(await readSavedPairing("pairing.json", () => null, async () => { throw { code: "ENOENT" }; }), null);
  await assert.rejects(readSavedPairing("pairing.json", () => null, async () => { throw { code: "EACCES" }; }), PairingRestoreError);
});

test("locked/decryption-failed storage preserves the saved record for a later successful retry", async () => {
  let unlocked = false;
  const read = async () => savedPairing;
  const decrypt = () => unlocked ? savedToken : null;
  await assert.rejects(readSavedPairing("pairing.json", decrypt, read), PairingRestoreError);
  unlocked = true;
  assert.equal((await readSavedPairing("pairing.json", decrypt, read)).token, savedToken);
});

test("malformed/unsupported pairing and decrypt exceptions never masquerade as a fresh installation or leak secrets", async () => {
  for (const bytes of [savedToken, '{"version":2}', savedPairing]) {
    await assert.rejects(readSavedPairing("pairing.json", () => { throw new Error(savedToken); }, async () => bytes), error => {
      assert.ok(error instanceof PairingRestoreError);
      assert.ok(!String(error).includes(savedToken));
      assert.ok(!error.userMessage.includes(savedToken));
      return true;
    });
  }
});
