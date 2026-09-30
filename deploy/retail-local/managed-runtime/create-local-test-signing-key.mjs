#!/usr/bin/env node

import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

function fail(message) {
  throw new Error(`create-local-test-signing-key: ${message}`);
}

async function writeExclusive(path, contents, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { flag: "wx", mode });
}

async function main() {
  const [keyId, privateKeyPath, publicKeyPath, keyringPath] = process.argv.slice(2);
  if (!keyId || !privateKeyPath || !publicKeyPath || !keyringPath) {
    fail("usage: node create-local-test-signing-key.mjs KEY_ID PRIVATE_KEY PUBLIC_KEY KEYRING");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) fail("key id ไม่ถูกต้อง");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const keyring = JSON.stringify({ formatVersion: 1, keys: { [keyId]: publicPem } }, null, 2) + "\n";

  await writeExclusive(privateKeyPath, privatePem, 0o600);
  await writeExclusive(publicKeyPath, publicPem, 0o644);
  await writeExclusive(keyringPath, keyring, 0o600);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
