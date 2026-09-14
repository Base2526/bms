"use client";

import Link from "next/link";
import { EnvironmentOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import type { PublicBoardGameCafe } from "@/lib/bms/boardGameCafe";
import styles from "./page.module.css";

type SearchState = "idle" | "locating" | "loading" | "error";

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
  };

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
              <Link href={`/shop/${encodeURIComponent(cafe.tenantSlug)}`}>{copy.details}</Link>
            </div>
          </article>
        ))}
      </div> : <div className={styles.empty}>{copy.empty}</div>}
    </div>
  );
}
