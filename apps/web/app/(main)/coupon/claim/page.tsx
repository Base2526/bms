import Link from "next/link";
import { claimCouponByToken } from "@/lib/bms/coupons";

type ClaimPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

function formatStartDate(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

export default async function CouponClaimPage({ searchParams }: ClaimPageProps) {
  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token
    ? await claimCouponByToken(token)
    : { ok: false as const, reason: "ไม่พบลิงก์คูปอง" };
  const startDate = result.ok ? formatStartDate(result.startsAt) : null;

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
            ? `คูปอง ${result.code} ถูกบันทึกไว้ให้คุณแล้ว${startDate ? ` ใช้ได้ตั้งแต่ ${startDate}` : ""} ส่วนลดจะถูกตรวจอีกครั้งตอนสร้างออเดอร์`
            : result.reason}
        </p>
        <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>
          {result.ok
            ? "Your coupon has been saved to your wallet. Final discount is verified again when the order is created."
            : "Please contact the shop if you think this coupon should be available."}
        </p>
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
