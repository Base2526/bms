import { cookies } from "next/headers";
import Link from "next/link";
import { listCouponWalletByToken, type CustomerCouponWalletItem } from "@/lib/bms/coupons";
import { getMessage, type Lang } from "@/i18n";
import styles from "./wallet.module.css";

type WalletPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

type CouponGroupKey = "ready" | "upcoming" | "used" | "unavailable";
type T = (key: string, vars?: Record<string, string | number>) => string;

function sectionMeta(t: T): Record<CouponGroupKey, { title: string; empty: string; accent: string }> {
  return {
    ready: { title: t("couponWallet.section_ready_title"), empty: t("couponWallet.section_ready_empty"), accent: "green" },
    upcoming: { title: t("couponWallet.section_upcoming_title"), empty: t("couponWallet.section_upcoming_empty"), accent: "orange" },
    used: { title: t("couponWallet.section_used_title"), empty: t("couponWallet.section_used_empty"), accent: "blue" },
    unavailable: { title: t("couponWallet.section_unavailable_title"), empty: t("couponWallet.section_unavailable_empty"), accent: "gray" },
  };
}

function formatDate(value: string | null, lang: Lang, t: T): string {
  if (!value) return t("couponWallet.unspecified");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("couponWallet.unspecified");
  return date.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function discountText(coupon: CustomerCouponWalletItem, lang: Lang, t: T): string {
  const locale = lang === "en" ? "en-US" : "th-TH";
  return coupon.type === "PERCENT"
    ? t("couponWallet.discount_percent", { value: Number(coupon.value).toLocaleString(locale) })
    : t("couponWallet.discount_amount", { value: Number(coupon.value).toLocaleString(locale) });
}

function stateText(coupon: CustomerCouponWalletItem, t: T): string {
  if (coupon.state === "REDEEMED") return t("couponWallet.state_redeemed");
  if (coupon.state === "RESERVED") return t("couponWallet.state_reserved");
  if (coupon.state === "EXPIRED") return t("couponWallet.state_expired");
  if (coupon.state === "REVOKED") return t("couponWallet.state_revoked");
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) return t("couponWallet.state_upcoming");
  if (coupon.available) return t("couponWallet.state_ready");
  return t("couponWallet.state_unavailable");
}

function badgeTone(coupon: CustomerCouponWalletItem, t: T): string {
  const state = stateText(coupon, t);
  if (state === t("couponWallet.state_ready")) return styles.badgeReady;
  if (state === t("couponWallet.state_upcoming")) return styles.badgeUpcoming;
  if (state === t("couponWallet.state_redeemed") || state === t("couponWallet.state_reserved")) return styles.badgeUsed;
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

function CouponCard({ coupon, lang, t }: { coupon: CustomerCouponWalletItem; lang: Lang; t: T }) {
  const locale = lang === "en" ? "en-US" : "th-TH";
  const minOrder = coupon.minOrderAmount
    ? t("couponWallet.min_amount", { value: Number(coupon.minOrderAmount).toLocaleString(locale) })
    : t("couponWallet.no_min");
  const remaining = coupon.remainingRedemptions == null
    ? t("couponWallet.unlimited_uses")
    : t("couponWallet.remaining_uses", { n: coupon.remainingRedemptions.toLocaleString(locale) });
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
            <p className={styles.label}>{t("couponWallet.code_label")}</p>
            <h3 className={styles.code}>{coupon.code}</h3>
          </div>
          <span className={`${styles.statusBadge} ${badgeTone(coupon, t)}`}>{stateText(coupon, t)}</span>
        </div>

        <div className={styles.discount}>{discountText(coupon, lang, t)}</div>

        <dl className={styles.conditions}>
          <div>
            <dt>{t("couponWallet.min_label")}</dt>
            <dd>{minOrder}</dd>
          </div>
          <div>
            <dt>{t("couponWallet.starts_label")}</dt>
            <dd>{coupon.startsAt ? formatDate(coupon.startsAt, lang, t) : t("couponWallet.starts_now")}</dd>
          </div>
          <div>
            <dt>{t("couponWallet.expires_label")}</dt>
            <dd>{formatDate(coupon.expiresAt, lang, t)}</dd>
          </div>
          <div>
            <dt>{t("couponWallet.rights_label")}</dt>
            <dd>{remaining}</dd>
          </div>
        </dl>

        {(coupon.reason || orderId) && (
          <div className={styles.noteBox}>
            {coupon.reason && <p>{coupon.reason}</p>}
            {orderId && (
              <p>
                {coupon.state === "RESERVED" ? t("couponWallet.reserved_with_order") : t("couponWallet.used_with_order")} #{orderId.slice(0, 8)}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function CouponSection({ id, coupons, lang, t }: { id: CouponGroupKey; coupons: CustomerCouponWalletItem[]; lang: Lang; t: T }) {
  const meta = sectionMeta(t)[id];
  const locale = lang === "en" ? "en-US" : "th-TH";
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{meta.title}</h2>
        <span>{coupons.length.toLocaleString(locale)} {t("couponWallet.count_unit")}</span>
      </div>
      {coupons.length > 0 ? (
        <div className={styles.couponList}>
          {coupons.map((coupon) => <CouponCard key={coupon.walletId || coupon.id} coupon={coupon} lang={lang} t={t} />)}
        </div>
      ) : (
        <div className={styles.emptyState}>{meta.empty}</div>
      )}
    </section>
  );
}

export default async function CouponWalletPage({ searchParams }: WalletPageProps) {
  const lang = (cookies().get("lang")?.value === "en" ? "en" : "th") as Lang;
  const t: T = (key, vars) => getMessage(lang, key, vars);
  const locale = lang === "en" ? "en-US" : "th-TH";

  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token
    ? await listCouponWalletByToken(token, t("couponWallet.invalid_or_expired"))
    : { ok: false as const, reason: t("couponWallet.link_not_found") };
  const coupons = result.ok ? result.coupons : [];
  const groups = groupCoupons(coupons);
  const meta = sectionMeta(t);
  const summary: Array<{ id: CouponGroupKey; label: string; count: number }> = [
    { id: "ready", label: meta.ready.title, count: groups.ready.length },
    { id: "upcoming", label: t("couponWallet.summary_upcoming"), count: groups.upcoming.length },
    { id: "used", label: t("couponWallet.summary_used"), count: groups.used.length },
    { id: "unavailable", label: meta.unavailable.title, count: groups.unavailable.length },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.hero}>
          <div className={styles.brandRow}>
            <div className={styles.logoMark}>🎟</div>
            <div>
              <p className={styles.eyebrow}>Coupon Wallet</p>
              <p className={styles.brandSub}>{t("couponWallet.brand_sub")}</p>
            </div>
          </div>

          <h1>{t("couponWallet.hero_title")}</h1>
          <p className={styles.lead}>
            {t("couponWallet.hero_lead")}
          </p>
        </div>

        <div className={styles.card}>
          {result.ok ? (
            <>
              <div className={styles.summaryGrid}>
                {summary.map((item) => (
                  <a key={item.id} href={`#${item.id}`} className={`${styles.summaryCard} ${styles[meta[item.id].accent]}`}>
                    <strong>{item.count.toLocaleString(locale)}</strong>
                    <span>{item.label}</span>
                  </a>
                ))}
              </div>

              <div className={styles.infoStrip}>
                <span>{t("couponWallet.howto_label")}</span>
                <p>{t("couponWallet.howto_text")}</p>
              </div>

              {coupons.length === 0 ? (
                <div className={styles.emptyWallet}>
                  <div className={styles.emptyIcon}>🎁</div>
                  <h2>{t("couponWallet.empty_wallet_title")}</h2>
                  <p>{t("couponWallet.empty_wallet_text")}</p>
                </div>
              ) : (
                <>
                  <CouponSection id="ready" coupons={groups.ready} lang={lang} t={t} />
                  <CouponSection id="upcoming" coupons={groups.upcoming} lang={lang} t={t} />
                  <CouponSection id="used" coupons={groups.used} lang={lang} t={t} />
                  <CouponSection id="unavailable" coupons={groups.unavailable} lang={lang} t={t} />
                </>
              )}
            </>
          ) : (
            <div className={styles.errorState}>
              <div className={styles.errorIcon}>!</div>
              <p className={styles.eyebrow}>Coupon Wallet</p>
              <h1>{t("couponWallet.error_title")}</h1>
              <p>{result.reason}</p>
              <p>{t("couponWallet.error_hint")}</p>
            </div>
          )}

          <div className={styles.footer}>
            <Link href="/">{t("couponWallet.back_home")}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
