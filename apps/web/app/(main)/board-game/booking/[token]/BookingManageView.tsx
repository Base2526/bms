"use client";

import { useEffect, useState } from "react";
import styles from "../../page.module.css";

type Reservation = {
  status: string; partySize: number; reservedFor: string;
  reservedDurationMinutes: number; locationName: string | null;
  reservedTableCode: string | null; rejectionReason: string | null;
};

export default function BookingManageView({ token, lang }: { token: string; lang: "th" | "en" }) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = lang === "en" ? {
    title: "Booking request", loading: "Loading...", people: "players", minutes: "minutes",
    table: "Table", pending: "Waiting for cafe review", confirmed: "Confirmed",
    cancelled: "Cancelled", rejected: "Not accepted", cancel: "Cancel request",
    waiting: "Checked in — waiting for a table", called: "The cafe has called your party",
    seated: "Seated", noShow: "Marked as no-show",
    error: "Unable to load this booking request.",
  } : {
    title: "คำขอจองโต๊ะ", loading: "กำลังโหลด...", people: "คน", minutes: "นาที",
    table: "โต๊ะ", pending: "รอร้านพิจารณา", confirmed: "ยืนยันแล้ว",
    cancelled: "ยกเลิกแล้ว", rejected: "ร้านไม่สามารถรับคำขอได้", cancel: "ยกเลิกคำขอ",
    waiting: "เช็กอินแล้ว — กำลังรอโต๊ะ", called: "ร้านเรียกคิวแล้ว",
    seated: "ได้นั่งโต๊ะแล้ว", noShow: "บันทึกว่าไม่มาตามนัด",
    error: "ไม่สามารถโหลดคำขอจองนี้ได้",
  };

  useEffect(() => {
    fetch(`/api/board-game/bookings/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error ?? copy.error);
        setReservation(body.reservation);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : copy.error));
  }, [copy.error, token]);

  async function cancel() {
    setBusy(true); setError("");
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

  const statusLabel = reservation?.status === "CONFIRMED" ? copy.confirmed
    : reservation?.status === "CANCELLED" ? copy.cancelled
      : reservation?.status === "REJECTED" ? copy.rejected
        : reservation?.status === "WAITING" ? copy.waiting
          : reservation?.status === "CALLED" ? copy.called
            : reservation?.status === "SEATED" ? copy.seated
              : reservation?.status === "NO_SHOW" ? copy.noShow : copy.pending;

  return <main className={styles.bookingPage}>
    <section className={styles.bookingModal}>
      <h1>{copy.title}</h1>
      {!reservation && !error && <p>{copy.loading}</p>}
      {reservation && <>
        <strong className={styles.bookingStatus}>{statusLabel}</strong>
        <p>{reservation.locationName}</p>
        <p>{new Date(reservation.reservedFor).toLocaleString(lang === "en" ? "en" : "th-TH")}</p>
        <p>{reservation.partySize} {copy.people} · {reservation.reservedDurationMinutes} {copy.minutes}</p>
        {reservation.reservedTableCode && <p>{copy.table} {reservation.reservedTableCode}</p>}
        {reservation.rejectionReason && <p>{reservation.rejectionReason}</p>}
        {(reservation.status === "REQUESTED" || reservation.status === "CONFIRMED")
          && <button type="button" disabled={busy} onClick={cancel}>{copy.cancel}</button>}
      </>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>
  </main>;
}
