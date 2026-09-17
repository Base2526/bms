"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "../../page.module.css";

type PaymentAccount = {
  key: string; method: "BANK_TRANSFER" | "QR"; type: string;
  bankName: string | null; accountName: string | null; accountNo: string | null;
  promptpayId: string | null; note: string | null;
};
type Reservation = {
  status: string; partySize: number; reservedFor: string;
  reservedDurationMinutes: number; locationName: string | null;
  reservedTableCode: string | null; rejectionReason: string | null; timezone: string;
  deposit: {
    policy: "NONE" | "FIXED" | "PERCENT"; amount: number; status: string;
    dueAt: string | null; refundEligibleUntil: string | null;
  };
  paymentAccounts: PaymentAccount[];
};

export default function BookingManageView({ token, lang }: { token: string; lang: "th" | "en" }) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = lang === "en" ? {
    title: "Booking request", loading: "Loading...", people: "players", minutes: "minutes",
    table: "Table", pending: "Waiting for cafe review", confirmed: "Confirmed",
    cancelled: "Cancelled", rejected: "Not accepted", expired: "Expired", cancel: "Cancel request",
    waiting: "Checked in — waiting for a table", called: "The cafe has called your party",
    seated: "Seated", noShow: "Marked as no-show", error: "Unable to load this booking request.",
    deposit: "Reservation deposit", due: "Pay by", refundable: "Refundable cancellation until",
    depositPending: "Awaiting payment", depositSubmitted: "Slip submitted — awaiting review",
    depositPaid: "Paid", depositRefundPending: "Refund pending", depositRefunded: "Refunded",
    depositForfeited: "Not refundable", depositCancelled: "Cancelled", depositApplied: "Applied to the final bill",
    method: "Payment method", bank: "Bank transfer", qr: "PromptPay / QR", reference: "Transfer reference (optional)",
    slip: "Slip image", submitPayment: "Submit deposit slip", paymentSubmitted: "Slip submitted successfully.",
  } : {
    title: "คำขอจองโต๊ะ", loading: "กำลังโหลด...", people: "คน", minutes: "นาที",
    table: "โต๊ะ", pending: "รอร้านพิจารณา", confirmed: "ยืนยันแล้ว",
    cancelled: "ยกเลิกแล้ว", rejected: "ร้านไม่สามารถรับคำขอได้", expired: "คำขอหมดอายุ", cancel: "ยกเลิกคำขอ",
    waiting: "เช็กอินแล้ว — กำลังรอโต๊ะ", called: "ร้านเรียกคิวแล้ว",
    seated: "ได้นั่งโต๊ะแล้ว", noShow: "บันทึกว่าไม่มาตามนัด", error: "ไม่สามารถโหลดคำขอจองนี้ได้",
    deposit: "มัดจำการจอง", due: "ชำระภายใน", refundable: "ยกเลิกและขอคืนได้ถึง",
    depositPending: "รอชำระ", depositSubmitted: "ส่งสลิปแล้ว — รอตรวจสอบ",
    depositPaid: "ชำระแล้ว", depositRefundPending: "รอคืนเงิน", depositRefunded: "คืนเงินแล้ว",
    depositForfeited: "ไม่เข้าเงื่อนไขคืนเงิน", depositCancelled: "ยกเลิกแล้ว", depositApplied: "หักในบิลสุดท้ายแล้ว",
    method: "ช่องทางชำระ", bank: "โอนธนาคาร", qr: "พร้อมเพย์ / QR", reference: "เลขอ้างอิงการโอน (ถ้ามี)",
    slip: "รูปสลิป", submitPayment: "ส่งสลิปมัดจำ", paymentSubmitted: "ส่งสลิปเรียบร้อยแล้ว",
  };

  const load = useCallback(async (quiet = false) => {
    try {
      const response = await fetch(`/api/board-game/bookings/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? copy.error);
      setReservation(body.reservation);
      if (!quiet) setError("");
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : copy.error);
    }
  }, [copy.error, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  async function cancel() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/board-game/bookings/${encodeURIComponent(token)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? copy.error);
      setReservation(body.reservation);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { setBusy(false); }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/board-game/bookings/${encodeURIComponent(token)}/payment`, {
        method: "POST", body: new FormData(event.currentTarget),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? copy.error);
      setReservation(body.reservation);
      setNotice(copy.paymentSubmitted);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { setBusy(false); }
  }

  const statusLabel = reservation?.status === "CONFIRMED" ? copy.confirmed
    : reservation?.status === "CANCELLED" ? copy.cancelled
      : reservation?.status === "REJECTED" ? copy.rejected
        : reservation?.status === "EXPIRED" ? copy.expired
          : reservation?.status === "WAITING" ? copy.waiting
            : reservation?.status === "CALLED" ? copy.called
              : reservation?.status === "SEATED" ? copy.seated
                : reservation?.status === "NO_SHOW" ? copy.noShow : copy.pending;
  const depositLabels: Record<string, string> = {
    PENDING: copy.depositPending, SUBMITTED: copy.depositSubmitted, PAID: copy.depositPaid,
    REFUND_PENDING: copy.depositRefundPending, REFUNDED: copy.depositRefunded,
    FORFEITED: copy.depositForfeited, CANCELLED: copy.depositCancelled, APPLIED: copy.depositApplied,
  };
  const dateTime = (value: string | null) => value ? new Date(value).toLocaleString(
    lang === "en" ? "en" : "th-TH", { timeZone: reservation?.timezone || "Asia/Bangkok" },
  ) : "-";
  const canPay = reservation?.status === "CONFIRMED"
    && reservation.deposit.status === "PENDING"
    && reservation.paymentAccounts.length > 0;

  return <main className={styles.bookingPage}>
    <section className={styles.bookingModal}>
      <h1>{copy.title}</h1>
      {!reservation && !error && <p>{copy.loading}</p>}
      {reservation && <>
        <strong className={styles.bookingStatus}>{statusLabel}</strong>
        <p>{reservation.locationName}</p>
        <p>{dateTime(reservation.reservedFor)} · {reservation.timezone}</p>
        <p>{reservation.partySize} {copy.people} · {reservation.reservedDurationMinutes} {copy.minutes}</p>
        {reservation.reservedTableCode && <p>{copy.table} {reservation.reservedTableCode}</p>}
        {reservation.rejectionReason && <p>{reservation.rejectionReason}</p>}
        {reservation.deposit.amount > 0 && <div className={styles.bookingResult}>
          <strong>{copy.deposit}: ฿{reservation.deposit.amount.toFixed(2)}</strong>
          <p>{depositLabels[reservation.deposit.status] ?? reservation.deposit.status}</p>
          {reservation.deposit.dueAt && <p>{copy.due}: {dateTime(reservation.deposit.dueAt)}</p>}
          {reservation.deposit.refundEligibleUntil && <p>{copy.refundable}: {dateTime(reservation.deposit.refundEligibleUntil)}</p>}
          {canPay && <form className={styles.bookingForm} onSubmit={submitPayment}>
            <label>{copy.method}<select name="method" required>
              {reservation.paymentAccounts.map(account => <option key={account.key} value={account.method}>
                {account.method === "BANK_TRANSFER" ? copy.bank : copy.qr}
                {account.bankName ? ` · ${account.bankName}` : ""}
                {account.accountNo ? ` · ${account.accountNo}` : ""}
                {account.promptpayId ? ` · ${account.promptpayId}` : ""}
                {account.accountName ? ` · ${account.accountName}` : ""}
              </option>)}
            </select></label>
            <label>{copy.reference}<input name="slipRef" maxLength={120} /></label>
            <label className={styles.fullField}>{copy.slip}<input name="slip" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
            <button type="submit" disabled={busy}>{copy.submitPayment}</button>
          </form>}
        </div>}
        {(reservation.status === "REQUESTED" || reservation.status === "CONFIRMED")
          && <button type="button" disabled={busy} onClick={cancel}>{copy.cancel}</button>}
      </>}
      {notice && <div className={styles.bookingResult} role="status">{notice}</div>}
      {error && <div className={styles.error} role="status">{error}</div>}
    </section>
  </main>;
}
