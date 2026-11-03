import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { parsePairingInput } from "./pairing.mjs";
import { cachedPosEntryPath } from "./renderer-route.mjs";

export const PAIRING_CONFIG_VERSION = 1;

/** Serialize writes and removal so a delayed route-cache write cannot resurrect an unpaired token. */
export function createPairingWriter(file, encrypt, io = { writeFile, rename, rm }) {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const result = pending.then(operation);
    // Report the caller's failure but let subsequent recovery/removal proceed.
    pending = result.catch(() => undefined);
    return result;
  };
  return {
    write(pairing) {
      const snapshot = { ...pairing };
      return enqueue(async () => {
        const payload = JSON.stringify({
          version: PAIRING_CONFIG_VERSION,
          serverUrl: snapshot.serverUrl,
          token: encrypt(snapshot.token),
          posEntryPath: cachedPosEntryPath(snapshot.posEntryPath),
        });
        await io.writeFile(`${file}.tmp`, payload, { encoding: "utf8", mode: 0o600 });
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
