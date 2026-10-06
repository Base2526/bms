import type { NextApiRequest, NextApiResponse } from "next";

import { parseAndPublishManagedRuntimeRelease } from "@/lib/bms/managedRuntimeReleaseUpload";
import { ManagedRuntimeReleaseError } from "@/lib/bms/managedRuntimeReleases";
import { authorizePlatformAdminCookieHeader } from "@/lib/bms/platformAdminNodeAuth";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: "1mb",
  },
};

function firstHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || "").split(",", 1)[0].trim();
}

function hasSameOrigin(req: NextApiRequest): boolean {
  const origin = firstHeader(req.headers.origin);
  const host = firstHeader(req.headers["x-forwarded-host"]) || firstHeader(req.headers.host);
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const encrypted = Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted);
  const protocol = forwardedProto || (encrypted ? "https" : "http");
  if (!origin || !host || (protocol !== "http" && protocol !== "https")) return false;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!hasSameOrigin(req)) return res.status(403).json({ error: "invalid_origin" });
  const auth = await authorizePlatformAdminCookieHeader(req.headers.cookie);
  if (!auth.ok) return res.status(auth.status).json({ error: "unauthorized" });
  try {
    const release = await parseAndPublishManagedRuntimeRelease(req, req.headers);
    console.info("[retail-local] managed runtime release published", {
      adminId: String(auth.adminId),
      releaseVersion: release.releaseVersion,
      platformTarget: release.platformTarget,
      keyId: release.keyId,
    });
    return res.status(201).json({ release });
  } catch (error) {
    if (error instanceof ManagedRuntimeReleaseError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("[route] unhandled POST /api/admin/retail-local/runtime-release-upload", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({ error: "เซิร์ฟเวอร์ผิดพลาด" });
  }
}
