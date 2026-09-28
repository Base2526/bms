import type { NextApiRequest, NextApiResponse } from "next";

import {
  parseRetailLocalReleaseUploadStream,
  RetailLocalReleaseUploadError,
} from "@/lib/bms/retailLocalReleaseUpload";
import {
  createRetailLocalReleaseAsset,
  RetailLocalReleaseError,
} from "@/lib/bms/retailLocalReleases";
import { authorizePlatformAdminCookieHeader } from "@/lib/bms/platformAdminNodeAuth";

/**
 * This must remain a Pages API route with bodyParser disabled. Next 14's App
 * Route Request adapter expands large request bodies in memory before the
 * storage stream can apply backpressure (vercel/next.js#59519).
 */
export const config = {
  api: {
    bodyParser: false,
    responseLimit: "1mb",
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const auth = await authorizePlatformAdminCookieHeader(req.headers.cookie);
  if (!auth.ok) return res.status(auth.status).json({ error: "unauthorized" });

  try {
    const { fields, storedFile } = await parseRetailLocalReleaseUploadStream(req, req.headers);
    const release = await createRetailLocalReleaseAsset({
      storedFile,
      platform: fields.platform,
      packageType: fields.packageType,
      version: fields.version,
      channel: fields.channel || "pilot",
      status: fields.status || "supported",
      isLatest: fields.isLatest,
      minOs: fields.minOs,
      releaseNotes: fields.releaseNotes,
      adminId: auth.adminId,
    });
    return res.status(201).json({ release });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError || error instanceof RetailLocalReleaseUploadError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("[route] unhandled POST /api/admin/retail-local/releases-upload", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({ error: "เซิร์ฟเวอร์ผิดพลาด" });
  }
}
