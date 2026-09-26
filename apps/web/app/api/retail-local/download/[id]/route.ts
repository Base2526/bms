import { NextResponse } from "next/server";
import { openRetailLocalReleaseDownload, RetailLocalReleaseError } from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  return (name || "bms-retail-local-installer")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleGET(_: Request, { params }: { params: { id: string } }) {
  try {
    const download = await openRetailLocalReleaseDownload(params.id);
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
  } catch (error) {
    if (error instanceof RetailLocalReleaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/retail-local/download/[id]", handleGET);
