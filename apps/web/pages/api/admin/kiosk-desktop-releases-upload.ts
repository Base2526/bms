import type { NextApiRequest, NextApiResponse } from "next";
import { authorizePlatformAdminCookieHeader } from "@/lib/bms/platformAdminNodeAuth";
import { parseRetailLocalReleaseUploadStream, RetailLocalReleaseUploadError } from "@/lib/bms/retailLocalReleaseUpload";
import { createKioskDesktopReleaseDraft, KioskDesktopReleaseError } from "@/lib/bms/kioskDesktopReleases";

// Large installers must use the raw Node request. The App Router adapter may
// buffer multipart bodies before a streaming parser can apply backpressure.
export const config = { api: { bodyParser: false, responseLimit: "1mb" } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ code: "METHOD_NOT_ALLOWED" }); }
  const auth = await authorizePlatformAdminCookieHeader(req.headers.cookie);
  if (!auth.ok) return res.status(auth.status).json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" });
  try {
    const { fields, storedFile } = await parseRetailLocalReleaseUploadStream(req, req.headers,
      { maxBytes: 512 * 1024 * 1024,
        allowedFields: ["version", "channel", "sha256", "minOs", "releaseNotes"],
        requiredBeforeFile: ["version", "channel", "sha256", "minOs"] });
    const release = await createKioskDesktopReleaseDraft({ storedFile,
      version: fields.version, channel: fields.channel, expectedSha256: fields.sha256,
      minOs: fields.minOs, releaseNotes: fields.releaseNotes, adminId: auth.adminId });
    return res.status(201).json({ release });
  } catch (error) {
    if (error instanceof KioskDesktopReleaseError) return res.status(error.status).json({ code: error.code });
    if (error instanceof RetailLocalReleaseUploadError) return res.status(error.status).json({ code: "INVALID_UPLOAD" });
    return res.status(503).json({ code: "UPLOAD_UNAVAILABLE" });
  }
}
