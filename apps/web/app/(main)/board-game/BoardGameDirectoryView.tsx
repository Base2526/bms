"use client";

import Link from "next/link";
import { EnvironmentOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState, type FormEvent } from "react";
import type { PublicBoardGameCafe } from "@/lib/bms/boardGameCafe";
import styles from "./page.module.css";

type SearchState = "idle" | "locating" | "loading" | "error";

function newBookingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export default function BoardGameDirectoryView({
  initialCafes,
  lang,
}: {
  initialCafes: PublicBoardGameCafe[];
  lang: "th" | "en";
}) {
  const [cafes, setCafes] = useState(initialCafes);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [nearby, setNearby] = useState(false);
  const [bookingCafe, setBookingCafe] = useState<PublicBoardGameCafe | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingResult, setBookingResult] = useState<{ token: string; status: string } | null>(null);
  const [bookingRequestToken, setBookingRequestToken] = useState("");
  const copy = lang === "en" ? {
    title: "Board game cafes",
    subtitle: "Find published cafes, compare play rates and see aggregate table availability before you go.",
    search: "Search cafe, branch, address or game",
    near: "Near me",
    locating: "Getting location...",
    retry: "Location unavailable. Check browser permission and try again.",
    distance: "away",
    available: "tables available",
    availabilityHidden: "Call the cafe for table availability",
    rates: "Play rates",
    perHour: "/ hour",
    games: "Game highlights",
    hours: "Hours",
    call: "Call",
    details: "Open shop",
    empty: "No published board game cafes match this search yet.",
    privacy: "Your location is used only for this search and is not saved.",
    all: "All published cafes",
    nearbyTitle: "Nearest published cafes",
    book: "Request a table",
    bookingTitle: "Request a table",
    bookingNote: "This is a request. The cafe will choose a suitable table and confirm it.",
    name: "Booking name",
    phone: "Phone",
    email: "Email for confirmation and reminder",
    when: "Date and time",
    duration: "Duration (minutes)",
    party: "Players",
    note: "Note",
    submit: "Send request",
    close: "Close",
    requested: "Request sent. Keep this page open until you save the management link.",
    cancelRequest: "Cancel request",
    cancelled: "Request cancelled",
    bookingTerms: "Times use the cafe's timezone. The request must be made at least {minutes} minutes ahead.",
    depositNone: "No reservation deposit",
    depositFixed: "Deposit after confirmation: THB {amount}",
    depositPercent: "Deposit after confirmation: {percent}% of the estimated play fee",
  } : {
    title: "ค้นหาร้านบอร์ดเกม",
    subtitle: "ดูร้านที่เปิดเผยข้อมูล เปรียบเทียบค่าเล่น และเช็กจำนวนโต๊ะว่างแบบรวมก่อนเดินทาง",
    search: "ค้นหาชื่อร้าน สาขา ที่อยู่ หรือเกม",
    near: "ร้านใกล้ฉัน",
    locating: "กำลังหาตำแหน่ง...",
    retry: "ไม่สามารถอ่านตำแหน่งได้ กรุณาตรวจสิทธิ์ของเบราว์เซอร์แล้วลองใหม่",
    distance: "จากคุณ",
    available: "โต๊ะว่าง",
    availabilityHidden: "โทรสอบถามโต๊ะว่างกับร้าน",
    rates: "อัตราค่าเล่น",
    perHour: "/ ชั่วโมง",
    games: "เกมเด่น",
    hours: "เวลาเปิด",
    call: "โทร",
    details: "ดูหน้าร้าน",
    empty: "ยังไม่มีร้านบอร์ดเกมที่เปิดเผยข้อมูลตรงกับคำค้นหานี้",
    privacy: "ตำแหน่งของคุณใช้จัดเรียงผลการค้นหาครั้งนี้เท่านั้น และไม่ถูกบันทึก",
    all: "ร้านที่เผยแพร่ทั้งหมด",
    nearbyTitle: "ร้านที่ใกล้คุณที่สุด",
    book: "ขอจองโต๊ะ",
    bookingTitle: "ส่งคำขอจองโต๊ะ",
    bookingNote: "รายการนี้ยังไม่ยืนยัน ร้านจะเลือกโต๊ะที่เหมาะสมและยืนยันอีกครั้ง",
    name: "ชื่อผู้จอง",
    phone: "เบอร์โทร",
    email: "อีเมลรับผลยืนยันและแจ้งเตือน",
    when: "วันและเวลา",
    duration: "ระยะเวลา (นาที)",
    party: "จำนวนผู้เล่น",
    note: "หมายเหตุ",
    submit: "ส่งคำขอ",
    close: "ปิด",
    requested: "ส่งคำขอแล้ว กรุณาเก็บลิงก์จัดการรายการนี้ไว้",
    cancelRequest: "ยกเลิกคำขอ",
    cancelled: "ยกเลิกคำขอแล้ว",
    bookingTerms: "วันเวลาอ้างอิงเขตเวลาของร้าน และต้องจองล่วงหน้าอย่างน้อย {minutes} นาที",
    depositNone: "ไม่เก็บมัดจำการจอง",
    depositFixed: "หลังร้านยืนยัน ต้องชำระมัดจำ {amount} บาท",
    depositPercent: "หลังร้านยืนยัน ต้องชำระมัดจำ {percent}% ของค่าเล่นโดยประมาณ",
  };

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingCafe) return;
    setBookingBusy(true); setBookingError("");
    try {
      const form = new FormData(event.currentTarget);
      const token = bookingRequestToken || newBookingToken();
      if (!bookingRequestToken) setBookingRequestToken(token);
      const response = await fetch("/api/board-game/bookings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: bookingCafe.tenantSlug, locationId: bookingCafe.locationId,
          requestToken: token, guestName: form.get("guestName"), guestPhone: form.get("guestPhone"),
          guestEmail: form.get("guestEmail"), reservedLocal: form.get("reservedFor"), locale: lang,
          durationMinutes: Number(form.get("durationMinutes")), partySize: Number(form.get("partySize")),
          note: form.get("note"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setBookingResult({ token, status: body.reservation.status });
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Unable to submit request");
    } finally { setBookingBusy(false); }
  }

  async function cancelBooking() {
    if (!bookingResult) return;
    setBookingBusy(true); setBookingError("");
    try {
      const response = await fetch(`/api/board-game/bookings/${encodeURIComponent(bookingResult.token)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setBookingResult(current => current ? { ...current, status: "CANCELLED" } : null);
    } catch (error) { setBookingError(error instanceof Error ? error.message : "Unable to cancel"); }
    finally { setBookingBusy(false); }
  }

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return cafes;
    return cafes.filter((cafe) => [
      cafe.shopName,
      cafe.displayName,
      cafe.publicAddress,
      ...cafe.games.map((game) => game.title),
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(keyword));
  }, [cafes, search]);

  function findNearby() {
    if (!navigator.geolocation) {
      setState("error");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(async (position) => {
      setState("loading");
      try {
        const params = new URLSearchParams({
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
          radiusKm: "100",
          limit: "60",
        });
        const response = await fetch(`/api/board-game/nearby?${params.toString()}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setCafes(Array.isArray(body.cafes) ? body.cafes : []);
        setNearby(true);
        setState("idle");
      } catch {
        setState("error");
      }
    }, () => setState("error"), { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <button className={styles.nearButton} type="button" onClick={findNearby}
          disabled={state === "locating" || state === "loading"}>
          <EnvironmentOutlined /> {state === "locating" || state === "loading" ? copy.locating : copy.near}
        </button>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <SearchOutlined aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.search} aria-label={copy.search} />
        </label>
        <span className={styles.count}>{visible.length} {nearby ? copy.nearbyTitle : copy.all}</span>
      </div>
      <p className={styles.privacy}>{copy.privacy}</p>
      {state === "error" && <div className={styles.error} role="alert">{copy.retry}</div>}

      {visible.length ? <div className={styles.grid}>
        {visible.map((cafe) => (
          <article className={styles.card} key={`${cafe.tenantSlug}-${cafe.locationId}`}>
            <div className={styles.cardHead}>
              {cafe.logoUrl
                ? <img src={cafe.logoUrl} alt="" className={styles.logo} />
                : <div className={styles.logoFallback}>{cafe.shopName.slice(0, 1).toUpperCase()}</div>}
              <div>
                <h2>{cafe.displayName}</h2>
                {cafe.displayName !== cafe.shopName && <p>{cafe.shopName}</p>}
              </div>
              {cafe.distanceKm != null && <strong className={styles.distance}>{cafe.distanceKm.toFixed(1)} km {copy.distance}</strong>}
            </div>
            {cafe.summary && <p className={styles.summary}>{cafe.summary}</p>}
            <dl className={styles.facts}>
              {cafe.publicAddress && <><dt><EnvironmentOutlined /></dt><dd>{cafe.publicAddress}</dd></>}
              {cafe.openingHours && <><dt>{copy.hours}</dt><dd>{cafe.openingHours}</dd></>}
              <dt>{copy.available}</dt>
              <dd>{cafe.availableTables == null || cafe.totalTables == null
                ? copy.availabilityHidden
                : `${cafe.availableTables}/${cafe.totalTables} ${copy.available}`}</dd>
            </dl>
            {cafe.rates.length > 0 && <section className={styles.detailSection}>
              <h3>{copy.rates}</h3>
              <div className={styles.tags}>{cafe.rates.map((rate) => (
                <span key={`${rate.customerType}-${rate.name}`}>{rate.name} ฿{rate.pricePerHour.toFixed(2)} {copy.perHour}</span>
              ))}</div>
            </section>}
            {cafe.games.length > 0 && <section className={styles.detailSection}>
              <h3>{copy.games}</h3>
              <div className={styles.tags}>{cafe.games.map((game) => <span key={game.title}>{game.title}</span>)}</div>
            </section>}
            <div className={styles.actions}>
              {cafe.publicPhone && <a href={`tel:${cafe.publicPhone}`}>{copy.call} {cafe.publicPhone}</a>}
              {cafe.bookingEnabled && <button type="button" onClick={() => {
                setBookingCafe(cafe); setBookingResult(null); setBookingError("");
                setBookingRequestToken(newBookingToken());
              }}>{copy.book}</button>}
              <Link href={`/shop/${encodeURIComponent(cafe.tenantSlug)}`}>{copy.details}</Link>
            </div>
          </article>
        ))}
      </div> : <div className={styles.empty}>{copy.empty}</div>}

      {bookingCafe && <div className={styles.modalBackdrop} role="presentation">
        <section className={styles.bookingModal} role="dialog" aria-modal="true" aria-labelledby="booking-title">
          <div className={styles.bookingHead}>
            <div><h2 id="booking-title">{copy.bookingTitle} · {bookingCafe.displayName}</h2><p>{copy.bookingNote}</p></div>
            <button type="button" onClick={() => setBookingCafe(null)}>{copy.close}</button>
          </div>
          {bookingResult ? <div className={styles.bookingResult}>
            <strong>{bookingResult.status === "CANCELLED" ? copy.cancelled : copy.requested}</strong>
            {bookingResult.status !== "CANCELLED" && <>
              <input readOnly value={`${location.origin}/board-game/booking/${bookingResult.token}`} />
              <button type="button" disabled={bookingBusy} onClick={cancelBooking}>{copy.cancelRequest}</button>
            </>}
          </div> : <form className={styles.bookingForm} onSubmit={submitBooking}>
            <p className={styles.fullField}>
              {copy.bookingTerms.replace("{minutes}", String(bookingCafe.reservationMinAdvanceMinutes))}
              {" · "}{bookingCafe.timezone}
              {" · "}{bookingCafe.reservationDepositPolicy === "FIXED"
                ? copy.depositFixed.replace("{amount}", bookingCafe.reservationDepositAmount.toFixed(2))
                : bookingCafe.reservationDepositPolicy === "PERCENT"
                  ? copy.depositPercent.replace("{percent}", bookingCafe.reservationDepositPercent.toFixed(0))
                  : copy.depositNone}
            </p>
            <label>{copy.name}<input name="guestName" required maxLength={120} /></label>
            <label>{copy.phone}<input name="guestPhone" type="tel" maxLength={40} /></label>
            <label>{copy.email}<input name="guestEmail" type="email" required maxLength={254} /></label>
            <label>{copy.when}<input name="reservedFor" type="datetime-local" required /></label>
            <label>{copy.duration}<input name="durationMinutes" type="number" min={30} max={720} defaultValue={120} required /></label>
            <label>{copy.party}<input name="partySize" type="number" min={1} max={500} defaultValue={2} required /></label>
            <label className={styles.fullField}>{copy.note}<textarea name="note" maxLength={300} rows={2} /></label>
            <button type="submit" disabled={bookingBusy}>{copy.submit}</button>
          </form>}
          {bookingError && <div className={styles.error} role="alert">{bookingError}</div>}
        </section>
      </div>}
    </div>
  );
}
