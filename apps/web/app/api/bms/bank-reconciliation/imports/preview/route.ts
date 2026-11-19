import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  parseBankStatementBuffer,
  BANK_STATEMENT_MAX_BYTES,
} from "@/lib/bms/bankStatementFormat";
import { createStatementImport } from "@/lib/bms/bankReconciliation";
import { requireBankReconciliationEnabled } from "@/lib/bms/bankReconciliationFeature";
import { deleteStoredFile, persistWebFile } from "@/lib/storage";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = BANK_STATEMENT_MAX_BYTES + 256_000;

class RequestTooLargeError extends Error {}

/** Bound chunked uploads before multipart parsing can buffer them in memory. */
async function readBoundedBody(
  request: NextRequest,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) throw new Error("ไม่พบข้อมูลแบบฟอร์ม");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestTooLargeError("ไฟล์ใหญ่เกิน 10 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    return (
      originHost ===
      (
        forwardedHost ||
        request.headers.get("host") ||
        request.nextUrl.host
      ).toLowerCase()
    );
  } catch {
    return false;
  }
}

async function cleanupFile(
  file: { id: number; relpath: string },
  tenantId: string,
) {
  await query(
    `UPDATE files SET deleted_at=now() WHERE id=$1 AND tenant_id=$2`,
    [file.id, tenantId],
  ).catch(() => undefined);
  await deleteStoredFile(file.relpath).catch(() => undefined);
}

async function handlePOST(request: NextRequest) {
  const auth = await authorizeAdminRoute("bank_reconciliation.import");
  if (!auth.ok)
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status },
    );
  if (!sameOrigin(request))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    requireBankReconciliationEnabled();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "feature disabled" },
      { status: 404 },
    );
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 10 MB" }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return NextResponse.json({ error: "รูปแบบแบบฟอร์มไม่ถูกต้อง" }, { status: 400 });
  }
  let body: Uint8Array;
  try {
    body = await readBoundedBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "อ่านแบบฟอร์มไม่สำเร็จ",
      },
      { status: error instanceof RequestTooLargeError ? 413 : 400 },
    );
  }
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: body.buffer as ArrayBuffer,
  })
    .formData()
    .catch(() => null);
  if (!form)
    return NextResponse.json(
      { error: "อ่านแบบฟอร์มไม่สำเร็จ" },
      { status: 400 },
    );
  const file = form.get("file");
  const accountId = String(form.get("accountId") || "").trim();
  const idempotencyKey = String(
    form.get("idempotencyKey") || crypto.randomUUID(),
  ).trim();
  if (!(file instanceof File))
    return NextResponse.json({ error: "กรุณาเลือกไฟล์" }, { status: 400 });
  if (file.size > BANK_STATEMENT_MAX_BYTES)
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 10 MB" }, { status: 413 });
  if (!file.name || file.name.length > 255)
    return NextResponse.json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }, { status: 400 });

  let stored: Awaited<ReturnType<typeof persistWebFile>> | null = null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseBankStatementBuffer(buffer, file.name);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const ext = file.name.toLowerCase().split(".").pop() || "bin";
    stored = await persistWebFile(
      file,
      `bank-statement-${crypto.randomUUID()}.${ext}`,
      "private",
      auth.tenantId,
      String(auth.adminId),
    );
    const result = await createStatementImport({
      tenantId: auth.tenantId,
      actorId: auth.adminId,
      accountId,
      fileId: stored.id,
      fileSha256: sha256,
      originalFilename: file.name,
      idempotencyKey,
      parsed,
    });
    if (result.replayed) {
      await cleanupFile(stored, auth.tenantId);
      stored = null;
    }
    return NextResponse.json(
      {
        import: result,
        preview: {
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          openingBalance: parsed.openingBalance,
          closingBalance: parsed.closingBalance,
          rowCount: parsed.rows.length,
          warnings: parsed.warnings,
          rows: parsed.rows.slice(0, 20),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (stored) await cleanupFile(stored, auth.tenantId);
    const dbCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    const rawMessage =
      error instanceof Error ? error.message : "นำเข้าไฟล์ไม่สำเร็จ";
    const message =
      dbCode === "23505"
        ? "ไฟล์นี้หรือรายการภายในไฟล์ถูกนำเข้าแล้ว"
        : dbCode.startsWith("23") || dbCode.startsWith("22")
          ? "ข้อมูลในไฟล์ขัดแย้งกับข้อมูลที่มีอยู่ กรุณาตรวจสอบไฟล์"
          : rawMessage;
    const conflict =
      dbCode === "23505" ||
      /duplicate|already|ซ้ำ|ถูกใช้/.test(message.toLowerCase());
    return NextResponse.json(
      { error: message },
      {
        status: conflict ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export const POST = withRouteErrorLog(
  "POST /api/bms/bank-reconciliation/imports/preview",
  handlePOST,
);
