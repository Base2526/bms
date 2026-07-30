import { getCheckoutByToken } from "@/lib/bms/checkout";
import CheckoutClient from "./CheckoutClient";
import styles from "./checkout.module.css";

export const dynamic = "force-dynamic";

type CheckoutPageProps = {
  searchParams?: Promise<{ t?: string }> | { t?: string };
};

export default async function CheckoutPage({
  searchParams,
}: CheckoutPageProps) {
  const params = await searchParams;
  const token = typeof params?.t === "string" ? params.t : "";
  const result = token
    ? await getCheckoutByToken(token)
    : { ok: false as const, reason: "ไม่พบลิงก์ checkout" };

  if (!result.ok) {
    return (
      <main className={styles.page}>
        <section className={styles.invalidCard}>
          <span className={styles.invalidMark}>!</span>
          <p className={styles.eyebrow}>SECURE CHECKOUT</p>
          <h1>เปิดออร์เดอร์ไม่ได้</h1>
          <p>{result.reason}</p>
          <p className={styles.muted}>
            กรุณากลับไปที่แชทของร้านและขอลิงก์ใหม่
          </p>
        </section>
      </main>
    );
  }

  return <CheckoutClient token={token} initialCheckout={result.checkout} />;
}

