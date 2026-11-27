import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { parseKioskUrl, validDeviceCredential } from "./url-policy.mjs";

const VERSION = 1;

export class KioskConfigRestoreError extends Error {
  constructor() { super("Saved kiosk configuration cannot be restored"); this.name = "KioskConfigRestoreError"; }
}

/** The entire URL/credential pair is one encrypted, atomically replaced record. */
export function createKioskConfigStore(file, encrypt, decrypt, allowedOrigins, io = { readFile, writeFile, rename, rm }) {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
  return {
    read() {
      return enqueue(async () => {
        let raw;
        try { raw = await io.readFile(file, "utf8"); }
        catch (error) { if (error?.code === "ENOENT") return null; throw new KioskConfigRestoreError(); }
        try {
          const record = JSON.parse(raw);
          if (record?.version !== VERSION || typeof record.payload !== "string") throw new Error("format");
          const config = JSON.parse(decrypt(record.payload));
          if (!parseKioskUrl(config?.url, allowedOrigins) || !validDeviceCredential(config?.deviceToken)) throw new Error("content");
          return { url: config.url, deviceToken: config.deviceToken };
        } catch { throw new KioskConfigRestoreError(); }
      });
    },
    write(config) {
      return enqueue(async () => {
        if (!parseKioskUrl(config?.url, allowedOrigins) || !validDeviceCredential(config?.deviceToken)) {
          throw new Error("Invalid kiosk configuration");
        }
        const payload = JSON.stringify({ version: VERSION,
          payload: encrypt(JSON.stringify({ url: config.url, deviceToken: config.deviceToken })) });
        await io.writeFile(`${file}.tmp`, payload, { encoding: "utf8", mode: 0o600 });
        try { await io.rename(`${file}.tmp`, file); }
        catch (error) { await io.rm(`${file}.tmp`, { force: true }); throw error; }
      });
    },
  };
}
