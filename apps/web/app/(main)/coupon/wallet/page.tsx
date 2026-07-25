import Link from "next/link";
import { listCouponWalletByToken, type CustomerCouponWalletItem } from "@/lib/bms/coupons";
import styles from "./wallet.module.css";

type WalletPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

type CouponGroupKey = "ready" | "upcoming" | "used" | "unavailable";

const sectionMeta: Record<CouponGroupKey, { title: string; empty: string; accent: string }> = {
  ready: { title: "พร้อมใช้", empty: "ยังไม่มีคูปองที่พร้อมใช้ตอนนี้", accent: "green" },
  upcoming: { title: "รอเริ่มใช้", empty: "ยังไม่มีคูปองที่รอเริ่มใช้", accent: "orange" },
  used: { title: "ใช้แล้ว / จองอยู่", empty: "ยังไม่มีคูปองที่ใช้แล้วหรือจองกับออเดอร์", accent: "blue" },
  unavailable: { title: "ใช้ไม่ได้ / หมดอายุ", empty: "ยังไม่มีคูปองที่ใช้ไม่ได้", accent: "gray" },
};

function formatDate(value: string | null): string {
  if (!value) return "ไม่ระบุ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ไม่ระบุ";
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function discountText(coupon: CustomerCouponWalletItem): string {
  return coupon.type === "PERCENT"
    ? `ลด ${Number(coupon.value).toLocaleString("th-TH")}%`
    : `ลด ${Number(coupon.value).toLocaleString("th-TH")} บาท`;
}

function stateText(coupon: CustomerCouponWalletItem): string {
  if (coupon.state === "REDEEMED") return "ใช้แล้ว";
  if (coupon.state === "RESERVED") return "จองกับออเดอร์อยู่";
  if (coupon.state === "EXPIRED") return "หมดอายุ";
  if (coupon.state === "REVOKED") return "ใช้ไม่ได้";
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) return "รอเริ่มใช้";
  if (coupon.available) return "พร้อมใช้";
  return "ใช้ไม่ได้";
}

function badgeTone(coupon: CustomerCouponWalletItem): string {
  const state = stateText(coupon);
  if (state === "พร้อมใช้") return styles.badgeReady;
  if (state === "รอเริ่มใช้") return styles.badgeUpcoming;
  if (state === "ใช้แล้ว" || state === "จองกับออเดอร์อยู่") return styles.badgeUsed;
  return styles.badgeUnavailable;
}

function groupCoupons(coupons: CustomerCouponWalletItem[]): Record<CouponGroupKey, CustomerCouponWalletItem[]> {
  const now = Date.now();
  return {
    ready: coupons.filter((coupon) => coupon.available && (!coupon.startsAt || new Date(coupon.startsAt).getTime() <= now)),
    upcoming: coupons.filter((coupon) => coupon.startsAt && new Date(coupon.startsAt).getTime() > now && coupon.state !== "REDEEMED" && coupon.state !== "RESERVED"),
    used: coupons.filter((coupon) => coupon.state === "REDEEMED" || coupon.state === "RESERVED"),
    unavailable: coupons.filter((coupon) => {
      const future = coupon.startsAt && new Date(coupon.startsAt).getTime() > now;
      return !coupon.available && !future && coupon.state !== "REDEEMED" && coupon.state !== "RESERVED";
    }),
  };
}

function CouponCard({ coupon }: { coupon: CustomerCouponWalletItem }) {
  const minOrder = coupon.minOrderAmount ? `${Number(coupon.minOrderAmount).toLocaleString("th-TH")} บาท` : "ไม่มีขั้นต่ำ";
  const remaining = coupon.remainingRedemptions == null
    ? "ไม่จำกัดจำนวนครั้ง"
    : `เหลือ ${coupon.remainingRedemptions.toLocaleString("th-TH")} ครั้ง`;
  const orderId = coupon.reservedOrderId || coupon.redeemedOrderId;

  return (
    <article className={styles.couponCard}>
      <div className={styles.ticketStub}>
        <span className={styles.ticketIcon}>%</span>
        <span className={styles.ticketText}>COUPON</span>
      </div>
      <div className={styles.couponMain}>
        <div className={styles.couponTop}>
          <div>
            <p className={styles.label}>รหัสคูปอง</p>
            <h3 className={styles.code}>{coupon.code}</h3>
          </div>
          <span className={`${styles.statusBadge} ${badgeTone(coupon)}`}>{stateText(coupon)}</span>
        </div>

        <div className={styles.discount}>{discountText(coupon)}</div>

        <dl className={styles.conditions}>
          <div>
            <dt>ขั้นต่ำ</dt>
            <dd>{minOrder}</dd>
          </div>
          <div>
            <dt>เริ่มใช้</dt>
            <dd>{coupon.startsAt ? formatDate(coupon.startsAt) : "ใช้ได้แล้ว"}</dd>
          </div>
          <div>
            <dt>หมดอายุ</dt>
            <dd>{formatDate(coupon.expiresAt)}</dd>
          </div>
          <div>
            <dt>สิทธิ์</dt>
            <dd>{remaining}</dd>
          </div>
        </dl>

        {(coupon.reason || orderId) && (
          <div className={styles.noteBox}>
            {coupon.reason && <p>{coupon.reason}</p>}
            {orderId && <p>{coupon.state === "RESERVED" ? "จองกับออเดอร์" : "ใช้กับออเดอร์"} #{orderId.slice(0, 8)}</p>}
          </div>
        )}
      </div>
    </article>
  );
}

function CouponSection({ id, coupons }: { id: CouponGroupKey; coupons: CustomerCouponWalletItem[] }) {
  const meta = sectionMeta[id];
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{meta.title}</h2>
        <span>{coupons.length.toLocaleString("th-TH")} ใบ</span>
      </div>
      {coupons.length > 0 ? (
        <div className={styles.couponList}>
          {coupons.map((coupon) => <CouponCard key={coupon.walletId || coupon.id} coupon={coupon} />)}
        </div>
      ) : (
        <div className={styles.emptyState}>{meta.empty}</div>
      )}
    </section>
  );
}

export default async function CouponWalletPage({ searchParams }: WalletPageProps) {
  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token ? await listCouponWalletByToken(token) : { ok: false as const, reason: "ไม่พบลิงก์กระเป๋าคูปอง" };
  const coupons = result.ok ? result.coupons : [];
  const groups = groupCoupons(coupons);
  const summary: Array<{ id: CouponGroupKey; label: string; count: number }> = [
    { id: "ready", label: "พร้อมใช้", count: groups.ready.length },
    { id: "upcoming", label: "รอเริ่ม", count: groups.upcoming.length },
    { id: "used", label: "ใช้แล้ว/จอง", count: groups.used.length },
    { id: "unavailable", label: "ใช้ไม่ได้", count: groups.unavailable.length },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.hero}>
          <div className={styles.brandRow}>
            <div className={styles.logoMark}>🎟</div>
            <div>
              <p className={styles.eyebrow}>Coupon Wallet</p>
              <p className={styles.brandSub}>กระเป๋าคูปองส่วนตัวของคุณ</p>
            </div>
          </div>

          <h1>คูปองของคุณอยู่ที่นี่แล้ว</h1>
          <p className={styles.lead}>
            ร้านได้เพิ่มคูปองเข้ากระเป๋าของคุณเรียบร้อย ไม่ต้องกดรับซ้ำ ส่วนลดจะถูกตรวจและใช้จริงตอนร้านสร้างออเดอร์ค่ะ
          </p>
        </div>

        <div className={styles.card}>
          {result.ok ? (
            <>
              <div className={styles.summaryGrid}>
                {summary.map((item) => (
                  <a key={item.id} href={`#${item.id}`} className={`${styles.summaryCard} ${styles[sectionMeta[item.id].accent]}`}>
                    <strong>{item.count.toLocaleString("th-TH")}</strong>
                    <span>{item.label}</span>
                  </a>
                ))}
              </div>

              <div className={styles.infoStrip}>
                <span>วิธีใช้</span>
                <p>แจ้งร้านว่าต้องการใช้คูปองใบไหนตอนสั่งซื้อ ระบบจะตรวจยอดขั้นต่ำ วันหมดอายุ และสิทธิ์คงเหลืออีกครั้งก่อนลดราคา</p>
              </div>

              {coupons.length === 0 ? (
                <div className={styles.emptyWallet}>
                  <div className={styles.emptyIcon}>🎁</div>
                  <h2>ยังไม่มีคูปองในบัญชีนี้</h2>
                  <p>ถ้ามีโปรโมชันใหม่ ร้านจะแจ้งและเพิ่มคูปองให้คุณอัตโนมัติค่ะ</p>
                </div>
              ) : (
                <>
                  <CouponSection id="ready" coupons={groups.ready} />
                  <CouponSection id="upcoming" coupons={groups.upcoming} />
                  <CouponSection id="used" coupons={groups.used} />
                  <CouponSection id="unavailable" coupons={groups.unavailable} />
                </>
              )}
            </>
          ) : (
            <div className={styles.errorState}>
              <div className={styles.errorIcon}>!</div>
              <p className={styles.eyebrow}>Coupon Wallet</p>
              <h1>เปิดกระเป๋าคูปองไม่ได้</h1>
              <p>{result.reason}</p>
              <p>กรุณากลับไปที่แชทและขอลิงก์ใหม่จากร้านค่ะ</p>
            </div>
          )}

          <div className={styles.footer}>
            <Link href="/">กลับหน้าแรก</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
