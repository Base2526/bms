import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Non-sensitive display preference, isolated from encrypted pairing and all business data. */
export function createLanguageStore(directory) {
  const file = path.join(directory, "language.json");
  let lock = Promise.resolve();
  return {
    async read() {
      try {
        await lock;
        const value = JSON.parse(await readFile(file, "utf8"));
        return value === "en" ? "en" : "th";
      } catch {
        return "th";
      }
    },
    write(value) {
      if (value !== "th" && value !== "en")
        return Promise.reject(new Error("Invalid language"));
      const operation = lock.then(async () => {
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(value), {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(`${file}.tmp`, file);
      });
      lock = operation.catch(() => undefined);
      return operation;
    },
  };
}
