import { cookies } from "next/headers";
import { getCheckoutByToken } from "@/lib/bms/checkout";
import { getMessage, type Lang } from "@/i18n";
import CheckoutClient from "./CheckoutClient";
import styles from "./checkout.module.css";

export const dynamic = "force-dynamic";

type CheckoutPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

export default async function CheckoutPage({
  searchParams,
}: CheckoutPageProps) {
  const lang = (cookies().get("lang")?.value === "en" ? "en" : "th") as Lang;
  const t = (key: string) => getMessage(lang, key);

  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token
    ? await getCheckoutByToken(token)
    : { ok: false as const, reason: t("checkout.invalid_order_title") };

  if (!result.ok) {
    return (
      <main className={styles.page}>
        <section className={styles.invalidCard}>
          <span className={styles.invalidMark}>!</span>
          <p className={styles.eyebrow}>SECURE CHECKOUT</p>
          <h1>{t("checkout.invalid_order_title")}</h1>
          <p>{result.reason}</p>
          <p className={styles.muted}>
            {t("checkout.invalid_order_hint")}
          </p>
        </section>
      </main>
    );
  }

  return <CheckoutClient token={token} initialCheckout={result.checkout} />;
}

