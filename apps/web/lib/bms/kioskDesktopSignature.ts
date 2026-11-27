import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { promisify } from "node:util";
import { openStoredFileStream } from "@/lib/storage";

const run = promisify(execFile);
export type KioskSignatureEvidence = {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  verifier: "windows-authenticode" | "osslsigncode" | null;
  thumbprint: string | null;
};

/** Verify the actual stored bytes. No filename, form field or caller assertion is signature evidence. */
export async function verifyStoredKioskInstaller(
  relpath: string, expectedSha256: string, expectedSize: number,
): Promise<{ integrity: boolean; signature: KioskSignatureEvidence }> {
  const directory = await mkdtemp(join(tmpdir(), "bms-kiosk-signature-"));
  const target = join(directory, "installer.exe");
  try {
    const hash = createHash("sha256");
    let size = 0;
    const tap = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(await openStoredFileStream(relpath), tap, createWriteStream(target, { flags: "wx" }));
    if (size !== expectedSize || hash.digest("hex") !== expectedSha256.toLowerCase()) {
      return { integrity: false, signature: { status: "INVALID", verifier: null, thumbprint: null } };
    }
    if (process.platform === "win32") {
      const literal = target.replace(/'/g, "''");
      const script = `$s=Get-AuthenticodeSignature -LiteralPath '${literal}'; `
        + `[pscustomobject]@{Status=[string]$s.Status;Thumbprint=[string]$s.SignerCertificate.Thumbprint}`
        + ` | ConvertTo-Json -Compress`;
      try {
        const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64")], { timeout: 120_000, maxBuffer: 64 * 1024 });
        const verdict = JSON.parse(stdout.trim());
        return { integrity: true, signature: {
          status: verdict.Status === "Valid" ? "VALID" : "INVALID",
          verifier: "windows-authenticode", thumbprint: /^[0-9a-f]{40}$/i.test(verdict.Thumbprint)
            ? verdict.Thumbprint.toLowerCase() : null,
        } };
      } catch { return { integrity: true, signature: { status: "UNAVAILABLE", verifier: null, thumbprint: null } }; }
    }
    try {
      await run("osslsigncode", ["verify", "-in", target], { timeout: 120_000, maxBuffer: 64 * 1024 });
      return { integrity: true, signature: { status: "VALID", verifier: "osslsigncode", thumbprint: null } };
    } catch (error) {
      return { integrity: true, signature: {
        status: (error as NodeJS.ErrnoException).code === "ENOENT" || (error as { killed?: boolean }).killed
          ? "UNAVAILABLE" : "INVALID",
        verifier: "osslsigncode", thumbprint: null,
      } };
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
