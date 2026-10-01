import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fromBuffer } from "yauzl";
import { extract } from "tar-stream";

export const INSTALLER_REPORT_LIMIT = 64 * 1024;
export class InstallerReportError extends Error {
  constructor(message = "invalid_report", public status = 400) { super(message); }
}

export function redactInstallerText(value: unknown, limit = 2048): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value).slice(0, 8192)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/gi, "[private key removed]")
    .replace(/^.*(?:password|passwd|\bpwd\b|\bpin\b|token|secret|authorization|cookie|credential|private.?key|api.?key|รหัสผ่าน|ชื่อร้าน|ผู้ดูแล|อีเมล).*$/gim, "[sensitive line removed]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "[url removed]")
    .replace(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/gi, "[email removed]")
    .replace(/(?:[A-Z]:[\\/]|\\\\|\/home\/|\/Users\/)[^\r\n"'<>]*/gi, "[path removed]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[opaque value removed]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, limit).trim();
}

const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const pick = (source: unknown, keys: string[]) => Object.fromEntries(keys.flatMap(key => {
  const value = object(source)[key];
  return ["string", "number", "boolean"].includes(typeof value) ? [[key, redactInstallerText(value, 160)]] : [];
}));

export function normalizeInstallerReport(text: string) {
  if (Buffer.byteLength(text) > INSTALLER_REPORT_LIMIT) throw new InstallerReportError("payload_too_large", 413);
  let raw: Record<string, any>;
  let windows = false;
  text = text.replace(/^\uFEFF/, "");
  if (text.trimStart().startsWith("{")) {
    try { raw = object(JSON.parse(text)); } catch { throw new InstallerReportError(); }
    windows = true;
  } else {
    raw = Object.create(null);
    for (const line of text.split(/\r?\n/)) {
      const match = /^([a-zA-Z][a-zA-Z0-9.]+)=(.*)$/.exec(line);
      if (match) raw[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
  }
  if (String(raw.formatVersion) !== "1" || !["pos", "server-pos"].includes(raw.product)
      || typeof raw.stage !== "string" || !raw.stage || typeof raw.installerVersion !== "string") throw new InstallerReportError();
  const machine = object(raw.machine), os = object(machine.windows), failure = object(raw.failure);
  const platform = windows ? "windows" : /^Darwin\b/.test(raw.kernel || "") ? "macos" : /^Linux\b/.test(raw.kernel || "") ? "linux" : "unknown";
  const arch = String(windows ? machine.architecture || os.architecture || "" : raw.architecture || "").toLowerCase();
  const architecture = /arm64|aarch64/.test(arch) ? "arm64" : /x86_64|amd64|64-bit|x64/.test(arch) ? "x64" : /i[3-6]86|x86|32-bit/.test(arch) ? "x86" : "unknown";
  const hardware = windows ? {
    ...pick(machine.hardware, ["ramBytes", "logicalProcessors", "hypervisorPresent", "virtualizationFirmwareEnabled"]),
    ...pick(machine.systemDisk, ["totalBytes", "freeBytes"]),
  } : pick(raw, ["ramBytes", "ramKiB", "logicalProcessors", "virtualizationSupported", "virtualizationCpuFlag", "diskTotalKiB", "diskFreeKiB", "diskUsedKiB"]);
  const runtime = windows ? {
    ...pick(machine, ["status", "powershellVersion"]),
    ...pick(machine.wsl, ["launcherPresent", "packageVersion", "bmsRuntimeRegisteredForCurrentUser"]),
    services: (Array.isArray(machine.services) ? machine.services : []).slice(0, 8)
      .filter((s: any) => ["WslService", "LxssManager", "vmcompute", "com.docker.service"].includes(s?.name))
      .map((s: any) => pick(s, ["name", "status"])),
  } : pick(raw, ["kernel", "dockerService", "shopService", "privateRuntimeState"]);
  const date = typeof raw.createdAt === "string" ? Date.parse(raw.createdAt) : NaN;
  const report = {
    formatVersion: 1, product: raw.product as "pos" | "server-pos", platform, architecture,
    installerVersion: redactInstallerText(raw.installerVersion, 128) || "unknown",
    osName: redactInstallerText(windows ? os.name : raw["os.ID"] || platform, 128) || "unknown",
    osVersion: redactInstallerText(windows ? os.version : raw.osVersion || raw["os.VERSION_ID"], 128) || "unknown",
    osBuild: redactInstallerText(windows ? os.build : raw.osBuild, 128),
    stage: redactInstallerText(raw.stage, 128),
    occurredAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    failure: {
      message: redactInstallerText(windows ? failure.message : raw.error),
      exceptionType: redactInstallerText(failure.exceptionType, 160),
      code: windows ? numeric(failure.hresult) ?? null : /^-?\d{1,10}$/.test(raw.exitCode || "") ? Number(raw.exitCode) : null,
      sourceLine: windows ? numeric(failure.scriptLine) ?? null : /^\d{1,8}$/.test(raw.sourceLine || "") ? Number(raw.sourceLine) : null,
    }, hardware, runtime,
  };
  if (!report.failure.message) throw new InstallerReportError();
  // Group exact sanitized failures, not guesses about their root cause.
  const fingerprint = createHash("sha256").update(JSON.stringify([report.platform, report.architecture,
    report.installerVersion, report.stage, report.failure.message, report.failure.code])).digest("hex");
  const contentHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return { report, fingerprint, contentHash };
}

export async function unpackInstallerReport(body: Buffer): Promise<string> {
  if (!body.length || body.length > INSTALLER_REPORT_LIMIT) throw new InstallerReportError("payload_too_large", 413);
  const names = new Set<string>();
  let report: string | undefined;
  const accept = (name: string, data: Buffer) => {
    if (!["diagnostics.json", "diagnostics.txt", "README.txt"].includes(name) || names.has(name)) throw new InstallerReportError();
    names.add(name);
    if (name !== "README.txt") {
      if (report !== undefined) throw new InstallerReportError();
      report = data.toString("utf8");
    }
  };
  try {
    if (body[0] === 0x50 && body[1] === 0x4b) {
      await new Promise<void>((resolve, reject) => fromBuffer(body, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => {
        if (err || !zip) return reject(new InstallerReportError());
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", entry => {
          const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
          if ((unixType !== 0 && unixType !== 0x8000) || zip.entryCount > 3 || entry.uncompressedSize > INSTALLER_REPORT_LIMIT || !["diagnostics.json", "diagnostics.txt", "README.txt"].includes(entry.fileName)) return reject(new InstallerReportError());
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return reject(new InstallerReportError());
            const chunks: Buffer[] = []; let length = 0;
            stream.on("error", reject);
            stream.on("data", (chunk: Buffer) => {
              length += chunk.length;
              if (length > INSTALLER_REPORT_LIMIT) stream.destroy(new InstallerReportError());
              else chunks.push(chunk);
            });
            stream.on("end", () => { try { accept(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); } catch (e) { reject(e); } });
          });
        });
        zip.readEntry();
      }));
    } else if (body[0] === 0x1f && body[1] === 0x8b) {
      // Bound decompression before parsing. Never write archive entries to disk.
      const tar = gunzipSync(body, { maxOutputLength: 128 * 1024 });
      await new Promise<void>((resolve, reject) => {
        const parser = extract();
        parser.on("error", reject);
        parser.on("finish", resolve);
        parser.on("entry", (header, stream, next) => {
          if (header.type !== "file" || (header.size || 0) > INSTALLER_REPORT_LIMIT || names.size >= 3) {
            stream.resume(); parser.destroy(new InstallerReportError()); return;
          }
          const chunks: Buffer[] = [];
          stream.on("error", reject);
          stream.on("data", chunk => { chunks.push(Buffer.from(chunk as Uint8Array)); });
          stream.on("end", () => { try { accept(header.name, Buffer.concat(chunks)); next(); } catch { parser.destroy(new InstallerReportError()); } });
        });
        parser.end(tar);
      });
    } else return body.toString("utf8");
  } catch { throw new InstallerReportError(); }
  if (report === undefined) throw new InstallerReportError();
  return report;
}

export async function readInstallerReportBody(request: Request): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > INSTALLER_REPORT_LIMIT) throw new InstallerReportError("payload_too_large", 413);
  if (!request.body) throw new InstallerReportError();
  const reader = request.body.getReader();
  const chunks: Buffer[] = []; let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15_000);
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > INSTALLER_REPORT_LIMIT) { await reader.cancel(); throw new InstallerReportError("payload_too_large", 413); }
      chunks.push(Buffer.from(result.value));
    }
    if (timedOut) throw new InstallerReportError("request_timeout", 408);
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
