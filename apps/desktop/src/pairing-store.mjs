import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { parsePairingInput } from "./pairing.mjs";
import { cachedPosEntryPath } from "./renderer-route.mjs";

export const PAIRING_CONFIG_VERSION = 1;

/** Serialize pairing IO so restores observe completed transitions and cache writes cannot resurrect tokens. */
export function createPairingWriter(file, encrypt, io = { readFile, writeFile, rename, rm }) {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const result = pending.then(operation);
    // Report the caller's failure but let subsequent recovery/removal proceed.
    pending = result.catch(() => undefined);
    return result;
  };
  return {
    read(decrypt) {
      // A reopened window must observe preceding writes/removal, not a half-finished transition.
      return enqueue(() => readSavedPairing(file, decrypt, io.readFile));
    },
    write(pairing, isCurrent = () => true) {
      const snapshot = { ...pairing };
      return enqueue(async () => {
        if (!isCurrent()) throw new Error("Pairing request is no longer current");
        const payload = JSON.stringify({
          version: PAIRING_CONFIG_VERSION,
          serverUrl: snapshot.serverUrl,
          token: encrypt(snapshot.token),
          posEntryPath: cachedPosEntryPath(snapshot.posEntryPath),
        });
        await io.writeFile(`${file}.tmp`, payload, { encoding: "utf8", mode: 0o600 });
        if (!isCurrent()) {
          await io.rm(`${file}.tmp`, { force: true });
          throw new Error("Pairing request is no longer current");
        }
        await io.rename(`${file}.tmp`, file);
      });
    },
    remove() {
      return enqueue(() => io.rm(file, { force: true }));
    },
  };
}

const RECOVERY_MESSAGE = "พบข้อมูลจับคู่เดิม แต่ยังอ่านหรือถอดรหัสไม่ได้ ไม่ได้แปลว่า token หมดอายุ กรุณาปลดล็อกที่เก็บข้อมูลของระบบและใช้บัญชีระบบปฏิบัติการเดิม แล้วกดลองใหม่ ข้อมูลจับคู่เดิมยังไม่ถูกลบ";

export class PairingRestoreError extends Error {
  constructor() {
    super("Unable to restore saved desktop pairing");
    this.name = "PairingRestoreError";
    this.userMessage = RECOVERY_MESSAGE;
  }
}

/** Only a missing file means unpaired. Never erase/replace an unreadable credential. */
export async function readSavedPairing(file, decrypt, read = readFile) {
  let bytes;
  try {
    bytes = await read(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new PairingRestoreError();
  }
  try {
    const raw = JSON.parse(bytes);
    if (raw?.version !== PAIRING_CONFIG_VERSION || typeof raw.serverUrl !== "string"
      || typeof raw.token !== "string") throw new Error("Unsupported pairing format");
    const token = decrypt(raw.token);
    const parsed = token ? parsePairingInput({ serverUrl: raw.serverUrl, pairingInput: token }) : null;
    if (!parsed?.ok) throw new Error("Invalid saved pairing");
    return { serverUrl: parsed.serverUrl, token: parsed.token, posEntryPath: cachedPosEntryPath(raw.posEntryPath) };
  } catch {
    // Do not forward OS/JSON errors: they may contain credential bytes or private paths.
    throw new PairingRestoreError();
  }
}
