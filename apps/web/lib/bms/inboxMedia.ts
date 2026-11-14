import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";

const MEDIA_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const LOCAL_FILE_URL = /^\/api\/files\/([1-9][0-9]*)$/;
const SIGNED_MEDIA_URL = /^\/api\/bms\/inbox\/media\/([1-9][0-9]*)\?token=([^&#]+)$/;

function secret(): string {
  const value = process.env.BMS_CHECKOUT_SECRET || process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("Inbox media signing secret is not configured");
  return value;
}

function mac(value: string): string {
  return createHmac("sha256", secret()).update(`inbox-media-v1.${value}`).digest("base64url");
}

export function assertInboxMediaSigningConfigured(): void { secret(); }

export function signInboxMedia(tenantId: string, fileId: number): string {
  const body = Buffer.from(JSON.stringify({ v: 1, tenantId, fileId,
    exp: Math.floor(Date.now() / 1000) + MEDIA_LIFETIME_SECONDS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function inboxMediaPath(tenantId: string, fileId: number): string {
  return `/api/bms/inbox/media/${fileId}?token=${encodeURIComponent(signInboxMedia(tenantId, fileId))}`;
}

export function verifyInboxMedia(token: unknown): { tenantId: string; fileId: number } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed?.v !== 1 || typeof parsed.tenantId !== "string" ||
        !Number.isSafeInteger(parsed.fileId) || parsed.fileId < 1 ||
        !Number.isSafeInteger(parsed.exp) || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { tenantId: parsed.tenantId, fileId: parsed.fileId };
  } catch { return null; }
}

export async function outboundInboxMediaUrl(tenantId: string, url: string): Promise<string> {
  const signedMatch = SIGNED_MEDIA_URL.exec(url);
  const localMatch = LOCAL_FILE_URL.exec(url);
  if (!signedMatch && !localMatch) return url;
  const fileId = Number((signedMatch || localMatch)![1]);
  if (!Number.isSafeInteger(fileId)) throw new Error("Invalid Inbox attachment");
  const file = await query<{ id: number; visibility: string; filename: string }>(
    `SELECT id,visibility,filename FROM files
      WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL LIMIT 1`,
    [fileId, tenantId]
  );
  if (!file.rowCount) throw new Error("Inbox attachment is unavailable or belongs to another shop");
  if (file.rows[0].visibility === "public" && localMatch) return url;
  const proof = signedMatch ? verifyInboxMedia(signedMatch[2]) : null;
  if (file.rows[0].visibility !== "private" || !file.rows[0].filename.startsWith("bms-inbox-") ||
      !proof || proof.tenantId !== tenantId || proof.fileId !== fileId)
    throw new Error("Invalid Inbox attachment authorization");
  return inboxMediaPath(tenantId, fileId);
}
