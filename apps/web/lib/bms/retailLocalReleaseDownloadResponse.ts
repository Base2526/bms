import { NextResponse } from "next/server";
import type { openRetailLocalReleaseDownload } from "./retailLocalReleases";

function safeFilename(name: string) {
  return (name || "bms-retail-local-installer")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRetailLocalDownloadResponse(
  download: Awaited<ReturnType<typeof openRetailLocalReleaseDownload>>,
) {
  const filename = safeFilename(download.filename);
  return new NextResponse(download.stream, {
    status: 200,
    headers: {
      "Content-Type": download.mime,
      "Content-Length": String(download.size),
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Checksum-SHA256": download.sha256,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
