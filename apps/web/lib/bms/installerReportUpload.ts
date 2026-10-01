import type { IncomingMessage } from "node:http";
import { INSTALLER_REPORT_LIMIT, InstallerReportError } from "./installerReportFormat";

export function readInstallerReportUpload(request: IncomingMessage): Promise<Buffer> {
  if (Number(request.headers["content-length"]) > INSTALLER_REPORT_LIMIT) {
    return Promise.reject(new InstallerReportError("payload_too_large", 413));
  }
  if (request.destroyed || request.readableEnded) return Promise.reject(new InstallerReportError());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const finish = (error?: InstallerReportError) => {
      clearTimeout(timer);
      request.pause();
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAbort);
      request.off("error", onAbort);
      request.off("close", onAbort);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, length));
    };
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > INSTALLER_REPORT_LIMIT) finish(new InstallerReportError("payload_too_large", 413));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onAbort = () => finish(new InstallerReportError("request_aborted"));
    const timer = setTimeout(() => finish(new InstallerReportError("request_timeout", 408)), 15_000);
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAbort);
    request.once("error", onAbort);
    request.once("close", onAbort);
  });
}
