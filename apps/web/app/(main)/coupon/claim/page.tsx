import Link from "next/link";
import { claimCouponByToken } from "@/lib/bms/coupons";

type ClaimPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

function formatCouponDate(value: string | null, opts?: { futureOnly?: boolean }): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  if (opts?.futureOnly && date.getTime() <= Date.now()) return null;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function DetailRow({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" }) {
  const color = tone === "good" ? "#15803d" : tone === "warn" ? "#c2410c" : "#0f172a";
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 16,
      padding: "10px 0",
      borderBottom: "1px solid #e2e8f0",
      textAlign: "left",
    }}>
      <span style={{ color: "#64748b", fontSize: 14 }}>{label}</span>
      <span style={{ color, fontSize: 14, fontWeight: 800, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default async function CouponClaimPage({ searchParams }: ClaimPageProps) {
  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token
    ? await claimCouponByToken(token)
    : { ok: false as const, reason: "ไม่พบลิงก์คูปอง" };
  const startDate = result.ok ? formatCouponDate(result.startsAt, { futureOnly: true }) : null;
  const expiresDate = result.ok ? formatCouponDate(result.expiresAt) : null;

  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: 24,
      background: "linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <section style={{
        width: "100%",
        maxWidth: 520,
        borderRadius: 24,
        background: "white",
        padding: 28,
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.12)",
        border: "1px solid #dbeafe",
        textAlign: "center",
      }}>
        <div style={{
          width: 64,
          height: 64,
          margin: "0 auto 16px",
          borderRadius: 20,
          display: "grid",
          placeItems: "center",
          background: result.ok ? "#dcfce7" : "#fee2e2",
          color: result.ok ? "#15803d" : "#b91c1c",
          fontSize: 34,
          fontWeight: 800,
        }}>
          {result.ok ? "✓" : "!"}
        </div>
        <p style={{ margin: 0, color: "#64748b", fontSize: 14, fontWeight: 700 }}>
          Coupon Claim
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 30, lineHeight: 1.2, color: "#0f172a" }}>
          {result.ok ? "เก็บคูปองแล้ว" : "ใช้คูปองไม่ได้"}
        </h1>
        <p style={{ margin: "0 auto 20px", color: "#475569", fontSize: 16, lineHeight: 1.7 }}>
          {result.ok
            ? `คูปอง ${result.code} ถูกบันทึกไว้ในกระเป๋าคูปองของคุณแล้ว${startDate ? ` และจะเริ่มใช้ได้ตั้งแต่ ${startDate}` : ""}`
            : result.reason}
        </p>
        {result.ok ? (
          <>
            <div style={{
              margin: "0 0 18px",
              padding: "4px 18px",
              borderRadius: 18,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}>
              <DetailRow label="รหัสคูปอง" value={result.code} />
              <DetailRow label="สถานะ" value="เก็บไว้แล้ว ยังไม่ได้ใช้สิทธิ์" tone="good" />
              <DetailRow label="เริ่มใช้ได้" value={startDate ?? "ใช้ได้แล้ว"} tone={startDate ? "warn" : "good"} />
              <DetailRow label="หมดอายุ" value={expiresDate ?? "ไม่ระบุ"} />
            </div>
            <div style={{
              margin: "0 0 22px",
              padding: 16,
              borderRadius: 16,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1e3a8a",
              textAlign: "left",
              fontSize: 14,
              lineHeight: 1.7,
            }}>
              <strong>ขั้นตอนถัดไป</strong>
              <ol style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
                <li>กลับไปที่แชทกับร้าน แล้วเลือก/สั่งสินค้าที่ต้องการ</li>
                <li>เมื่อร้านสร้างออเดอร์ ระบบจะตรวจเงื่อนไขคูปองอีกครั้ง เช่น ขั้นต่ำ วันเริ่มใช้ วันหมดอายุ และสิทธิ์คงเหลือ</li>
                <li>ถ้าเงื่อนไขผ่าน ส่วนลดจะแสดงในยอดออเดอร์ก่อนชำระเงิน</li>
              </ol>
            </div>
            <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>
              Coupon saved. It has not been redeemed yet; the final discount is verified when the order is created.
            </p>
          </>
        ) : (
          <div style={{
            margin: "0 0 24px",
            padding: 16,
            borderRadius: 16,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            textAlign: "left",
            fontSize: 14,
            lineHeight: 1.7,
          }}>
            <strong>ทำอย่างไรต่อ?</strong>
            <p style={{ margin: "8px 0 0" }}>
              ลองเปิดลิงก์จากข้อความล่าสุดอีกครั้ง หรือส่งภาพหน้านี้ให้ร้านตรวจสอบให้ได้เลยค่ะ
            </p>
          </div>
        )}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 42,
            padding: "0 18px",
            borderRadius: 12,
            background: "#2563eb",
            color: "white",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          กลับหน้าแรก
        </Link>
      </section>
    </main>
  );
}
