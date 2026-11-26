"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { unmetModifierGroups } from "@/lib/pos/modifierSelection";
import styles from "./kiosk.module.css";

type Mode = "DINE_IN" | "TAKEAWAY";
type MenuItem = { sku: string; name: string; category: string | null; price: number; imageUrl: string | null;
  sellable: boolean; availability: "AVAILABLE" | "SOLD_OUT_TODAY" | "OUT_OF_STOCK";
  availableSizes: Array<{ size: string; available: boolean }> };
type Modifier = { code: string; name: string; priceDelta: number; groupCode: string; groupName: string;
  selectionType: "SINGLE" | "MULTIPLE"; minSelect: number; maxSelect: number | null; defaultSelected: boolean };
type Detail = { sku: string; productName: string; size: string | null; packCode: string | null;
  unitName: string; packPrice: number; modifiers: Modifier[] };
type CartLine = Detail & { id: string; qty: number; modifierCodes: string[]; kitchenNote: string };
type Submission = { submissionId: string; status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  rejectionReason?: string | null };
class KioskUnavailableError extends Error {}

function MenuImage({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div className={className}>
    {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} />
      : <span className={styles.imageFallback} aria-hidden="true"><span>🍽️</span><span>🥤</span></span>}
  </div>;
}

async function api<T>(token: string, init?: RequestInit, submissionId?: string): Promise<T> {
  const suffix = submissionId ? `?submissionId=${encodeURIComponent(submissionId)}` : "";
  const response = await fetch(`/api/bms/restaurant-kiosk/${encodeURIComponent(token)}${suffix}`, {
    ...init, cache: "no-store",
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 410) throw new KioskUnavailableError("จอสั่งอาหารนี้ปิดใช้งานแล้ว");
  if (!response.ok) throw new Error(body.error || "จอสั่งอาหารไม่พร้อมใช้งาน");
  return body as T;
}

export default function RestaurantKioskPage() {
  const token = String(useParams<{ token: string }>()?.token ?? "");
  const [lang, setLang] = useState<"th" | "en">("th");
  const th = lang === "th";
  const [store, setStore] = useState("");
  const [branch, setBranch] = useState("");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<MenuItem | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [screen, setScreen] = useState<"HOME" | "MENU" | "CART" | "STATUS" | "UNAVAILABLE">("HOME");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [menuError, setMenuError] = useState("");
  const submitKey = useRef<string | null>(null);
  const sessionVersion = useRef(0);
  const unavailable = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const price = (value: number) => new Intl.NumberFormat(th ? "th-TH" : "en-US", {
    style: "currency", currency: "THB", maximumFractionDigits: 2,
  }).format(value);

  const reset = useCallback(() => {
    sessionVersion.current += 1;
    setMode(null); setCart([]); setSelected(null); setSubmission(null);
    setSelectedSummary(null); setSelectedModifiers([]); setNote(""); setSearch(""); setCategory(null);
    setError(""); setStatusError(""); setBusy(false);
    setScreen(unavailable.current ? "UNAVAILABLE" : "HOME"); submitKey.current = null;
  }, []);
  const closeKiosk = useCallback(() => {
    unavailable.current = true;
    reset(); setStore(""); setBranch(""); setMenu([]); setMenuError("");
  }, [reset]);
  useEffect(() => {
    const bump = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(reset, 120_000);
    };
    for (const event of ["pointerdown", "keydown"] as const) window.addEventListener(event, bump);
    bump();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      for (const event of ["pointerdown", "keydown"] as const) window.removeEventListener(event, bump);
    };
  }, [reset]);
  useEffect(() => {
    const clearPrevious = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    window.addEventListener("pageshow", clearPrevious);
    window.addEventListener("popstate", reset);
    return () => { window.removeEventListener("pageshow", clearPrevious); window.removeEventListener("popstate", reset); };
  }, [reset]);
  const refreshMenu = useCallback(() => {
    void api<{ storeName: string; locationName: string; items: MenuItem[] }>(token)
      .then((data) => { if (!unavailable.current) {
        setStore(data.storeName); setBranch(data.locationName); setMenu(data.items); setMenuError("");
      } })
      .catch((cause) => {
        if (cause instanceof KioskUnavailableError) { closeKiosk(); return; }
        if (unavailable.current) return;
        setMenuError(cause instanceof Error ? cause.message : "จอสั่งอาหารไม่พร้อมใช้งาน");
      });
  }, [token, closeKiosk]);
  useEffect(() => {
    refreshMenu();
    const timer = window.setInterval(refreshMenu, 60_000);
    return () => clearInterval(timer);
  }, [refreshMenu]);
  useEffect(() => {
    if (!submission?.submissionId || submission.status !== "PENDING") return;
    const session = sessionVersion.current;
    const timer = window.setInterval(() => {
      void api<Omit<Submission, "submissionId">>(token, undefined, submission.submissionId)
        .then((state) => { if (!unavailable.current && sessionVersion.current === session) {
          setSubmission({ ...state, submissionId: submission.submissionId }); setStatusError("");
        } })
        .catch((cause) => {
          if (sessionVersion.current !== session) return;
          if (cause instanceof KioskUnavailableError) { closeKiosk(); return; }
          if (unavailable.current) return;
          setStatusError(cause instanceof Error ? cause.message : "ติดตามสถานะไม่ได้");
        });
    }, 5000);
    return () => clearInterval(timer);
  }, [submission?.submissionId, submission?.status, token, closeKiosk]);

  const categories = useMemo(() => Array.from(new Set(menu.map((item) => item.category?.trim()).filter(
    (value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, th ? "th" : "en")), [menu, th]);
  const visible = useMemo(() => menu.filter((item) =>
    (!category || item.category === category) &&
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())
  ), [menu, search, category]);
  const heroImage = menu.find((item) => item.sellable && item.imageUrl)?.imageUrl ?? null;
  const total = cart.reduce((sum, line) => sum + (line.packPrice
    + line.modifiers.filter((item) => line.modifierCodes.includes(item.code))
      .reduce((n, item) => n + item.priceDelta, 0)) * line.qty, 0);
  const unmet = selected ? unmetModifierGroups(selected.modifiers, selectedModifiers) : [];
  const selectedTotal = selected ? (selected.packPrice + selected.modifiers
    .filter((item) => selectedModifiers.includes(item.code))
    .reduce((sum, item) => sum + item.priceDelta, 0)) * qty : 0;
  const lineCount = cart.length;
  const closeItem = useCallback(() => { setSelected(null); setSelectedSummary(null); }, []);
  const isItemOpen = selected !== null;
  useEffect(() => {
    if (!isItemOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeItem(); return; }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown); triggerRef.current?.focus(); };
  }, [isItemOpen, closeItem]);

  async function openItem(item: MenuItem, size?: string | null) {
    const session = sessionVersion.current;
    setBusy(true); setError("");
    try {
      const chosenSize = size ?? item.availableSizes.find((value) => value.available)?.size ?? null;
      if (item.availableSizes.length && !item.availableSizes.some((value) => value.size === chosenSize && value.available)) {
        throw new Error(th ? "ขนาดนี้ไม่พร้อมขาย" : "This size is unavailable");
      }
      const detail = await api<Detail>(token, { method: "POST", body: JSON.stringify({
        action: "detail", sku: item.sku,
        size: chosenSize,
      }) });
      if (unavailable.current || sessionVersion.current !== session) return;
      setSelected(detail); setSelectedSummary(item);
      setSelectedModifiers(detail.modifiers.filter((value) => value.defaultSelected).map((value) => value.code));
      if (size == null) { setQty(1); setNote(""); }
    } catch (cause) {
      if (sessionVersion.current !== session) return;
      if (cause instanceof KioskUnavailableError) { closeKiosk(); return; }
      if (unavailable.current) return;
      setError(th && cause instanceof Error ? cause.message : th ? "เมนูไม่พร้อมขาย" : "This item is unavailable. Please ask staff.");
    }
    finally { if (sessionVersion.current === session) setBusy(false); }
  }
  function toggle(modifier: Modifier) {
    setSelectedModifiers((current) => {
      if (current.includes(modifier.code)) return current.filter((code) => code !== modifier.code);
      const group = selected?.modifiers.filter((item) => item.groupCode === modifier.groupCode) ?? [];
      if (modifier.selectionType === "SINGLE") {
        return [...current.filter((code) => !group.some((item) => item.code === code)), modifier.code];
      }
      if (modifier.maxSelect != null && group.filter((item) => current.includes(item.code)).length >= modifier.maxSelect) return current;
      return [...current, modifier.code];
    });
  }
  function addItem() {
    if (!selected || unmet.length) return;
    if (cart.length >= 20) {
      setError(th ? "หนึ่งครั้งสั่งได้ไม่เกิน 20 รายการ" : "You can add up to 20 lines per request.");
      return;
    }
    setCart((current) => [...current, { ...selected, id: crypto.randomUUID(), qty,
      modifierCodes: selectedModifiers, kitchenNote: note.trim() }]);
    closeItem(); setError("");
  }
  async function submit() {
    if (!mode || !cart.length || busy) return;
    const session = sessionVersion.current;
    setBusy(true); setError("");
    submitKey.current ||= crypto.randomUUID();
    try {
      const result = await api<Submission>(token, { method: "POST", body: JSON.stringify({
        action: "submit", serviceMode: mode, idempotencyKey: submitKey.current,
        items: cart.map((line) => ({ sku: line.sku, size: line.size,
          packCode: line.packCode, packQty: line.qty, modifierCodes: line.modifierCodes,
          kitchenNote: line.kitchenNote })),
      }) });
      if (unavailable.current || sessionVersion.current !== session) return;
      setSubmission(result); setScreen("STATUS"); setCart([]); submitKey.current = null;
    } catch (cause) { if (sessionVersion.current !== session) return;
      if (cause instanceof KioskUnavailableError) { closeKiosk(); return; }
      if (unavailable.current) return;
      setError(`${th && cause instanceof Error ? cause.message : th ? "ส่งคำขอไม่สำเร็จ" : "The request could not be confirmed."} ${th
      ? "หากเน็ตหลุด ผลอาจไม่แน่นอน ให้พนักงานตรวจรายการรอรับใน POS ก่อนคีย์ใหม่ หรือกดส่งซ้ำด้วยคำขอเดิม"
      : "If the network failed, ask staff to check the pending POS list before entering a new order. Retrying here uses the same request key."}`); }
    finally { if (sessionVersion.current === session) setBusy(false); }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><span className={styles.brandMark} aria-hidden="true">B</span>
        <div><b>BMS ORDER</b><small>{store ? `${store}${branch ? ` · ${branch}` : ""}` : "SELF SERVICE"}</small></div>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.staffHelp}>{th ? "ต้องการความช่วยเหลือ? เรียกพนักงาน" : "Need help? Please ask staff"}</span>
        <button type="button" className={styles.languageButton} aria-label={th ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
          onClick={() => setLang(th ? "en" : "th")}>{th ? "EN" : "ไทย"}</button>
      </div>
    </header>
    {error && <div className={styles.alert} role="alert">{error}</div>}
    {screen === "HOME" && <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.eyebrow}>{th ? "สั่งง่าย ๆ ในไม่กี่ขั้นตอน" : "Easy ordering in a few steps"}</span>
          <h1>{th ? <>มื้ออร่อย<br />เริ่มที่นี่</> : <>Your meal<br />starts here</>}</h1>
          <p>{th ? "เลือกเมนูที่ชอบ แล้วให้พนักงานตรวจรายการก่อนส่งครัว" : "Choose your meal. Staff review it before the kitchen starts."}</p>
        </div><MenuImage src={heroImage} className={styles.heroImage} />
      </section>
      <div className={styles.modeWrap}><div className={styles.modePanel}>
        <h2>{th ? "วันนี้ทานแบบไหน?" : "How will you dine today?"}</h2>
        <div className={styles.modeButtons}>
          <button type="button" disabled={!store} onClick={() => { setMode("DINE_IN"); setScreen("MENU"); }}><span aria-hidden="true">🍽️</span>{th ? "กินในร้าน" : "Dine in"}</button>
          <button type="button" disabled={!store} onClick={() => { setMode("TAKEAWAY"); setScreen("MENU"); }}><span aria-hidden="true">🥡</span>{th ? "รับกลับ" : "Takeaway"}</button>
        </div></div>
        <p className={styles.modeNote}>{th ? "พนักงานจะตรวจรายการก่อนส่งครัว · ชำระเงินผ่าน POS ที่เคาน์เตอร์" : "Staff review before kitchen dispatch · Pay at the POS counter"}</p>
      </div>
      {menuError && <div className={styles.networkNotice} role="alert"><b>{th ? "เชื่อมต่อเมนูไม่ได้" : "Cannot load the menu"}</b>
        <p>{th ? "กรุณาเรียกพนักงานหรือทดลองเชื่อมต่ออีกครั้ง" : "Ask staff for help or try again."}</p>
        <button type="button" onClick={refreshMenu}>{th ? "ลองอีกครั้ง" : "Retry"}</button></div>}
      {!store && !menuError && <p className={styles.loading} role="status">{th ? "กำลังโหลดเมนู…" : "Loading menu…"}</p>}
      {store && menu.some((item) => item.sellable) && <section className={styles.homePreview} aria-label={th ? "ตัวอย่างเมนูของร้าน" : "Restaurant menu preview"}>
        <div><h2>{th ? "เมนูจากร้านนี้" : "On this menu"}</h2>
          <p>{th ? "เลือกวิธีรับอาหารด้านบนเพื่อเริ่มสั่ง" : "Choose a dining option above to start ordering"}</p></div>
        <div className={styles.homePreviewGrid}>{menu.filter((item) => item.sellable).slice(0, 4).map((item) => <article key={item.sku}>
          <MenuImage src={item.imageUrl} className={styles.previewImage} /><b>{item.name}</b>
        </article>)}</div>
      </section>}
      <p className={styles.privacyNote}>{th ? "ถ้าจอถูกรีเฟรชหลังส่งคำขอ กรุณาให้พนักงานค้นรหัสคำขอก่อนสั่งใหม่" : "If the screen refreshed after submitting, ask staff to check your request before ordering again."}</p>
    </>}
    {screen === "MENU" && <div className={styles.menuPage}>
      <section className={styles.menuHero}><div><button type="button" className={styles.backOnRed} onClick={reset}>‹ {th ? "เริ่มใหม่" : "Start over"}</button>
        <h1>{th ? "เลือกเมนูที่ชอบ" : "Choose your favorites"}</h1><p>{th ? "อาหารและเครื่องดื่มจากเมนูของร้าน" : "Food and drinks from this restaurant"}</p></div>
        <MenuImage src={heroImage} className={styles.menuHeroImage} />
      </section>
      <div className={styles.modeWrap}><div className={styles.modePanel}>
        <h2>{th ? "วิธีรับอาหาร" : "Dining option"}</h2><div className={styles.modeButtons}>
          <button type="button" className={mode === "DINE_IN" ? styles.modeSelected : ""} aria-pressed={mode === "DINE_IN"}
            onClick={() => setMode("DINE_IN")}><span aria-hidden="true">🍽️</span>{th ? "กินในร้าน" : "Dine in"}</button>
          <button type="button" className={mode === "TAKEAWAY" ? styles.modeSelected : ""} aria-pressed={mode === "TAKEAWAY"}
            onClick={() => setMode("TAKEAWAY")}><span aria-hidden="true">🥡</span>{th ? "รับกลับ" : "Takeaway"}</button>
        </div></div><p className={styles.modeNote}>{mode === "DINE_IN"
          ? (th ? "พนักงานจะยืนยันโต๊ะกับคุณก่อนรับคำขอ" : "Staff will confirm your table before accepting the request.")
          : (th ? "เลขรับอาหารอาจออกหลังชำระเงินที่ POS" : "A pickup number may be issued after POS payment.")}</p></div>
      {menuError && <div className={styles.networkNotice} role="alert"><b>{th ? "อัปเดตเมนูไม่ได้" : "Cannot refresh the menu"}</b>
        <p>{th ? "ราคาและความพร้อมอาจเปลี่ยนไป พนักงานจะตรวจอีกครั้ง" : "Prices and availability may have changed. Staff will recheck."}</p>
        <button type="button" onClick={refreshMenu}>{th ? "ลองอีกครั้ง" : "Retry"}</button></div>}
      <main className={styles.content}>
        <div className={styles.sectionTop}><div><h2>{th ? "เลือกเมนูที่ชอบ" : "Browse the menu"}</h2><p>{th ? "แตะเมนูเพื่อเลือกขนาดและตัวเลือก" : "Tap an item to choose its size and options"}</p></div>
          <input className={styles.search} type="search" aria-label={th ? "ค้นหาเมนู" : "Search menu"}
            value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? "ค้นหาเมนู" : "Search menu"} /></div>
        {categories.length > 0 && <div className={styles.categories} role="group" aria-label={th ? "กรองหมวดเมนู" : "Filter menu categories"}>
          <button type="button" aria-pressed={category === null} className={category === null ? styles.categorySelected : ""}
            onClick={() => setCategory(null)}>{th ? "ทั้งหมด" : "All"}</button>
          {categories.map((value) => <button key={value} type="button" aria-pressed={category === value}
            className={category === value ? styles.categorySelected : ""} onClick={() => setCategory(value)}>{value}</button>)}
        </div>}
        {visible.length ? <div className={styles.menuGrid}>{visible.map((item) => <button key={item.sku} type="button"
          className={styles.menuCard} disabled={!item.sellable || busy}
          onClick={(event) => { triggerRef.current = event.currentTarget; void openItem(item); }}>
          <MenuImage src={item.imageUrl} className={styles.cardImage} />
          <span className={styles.cardBody}><b>{item.name}</b>{item.category && <small>{item.category}</small>}
            <span className={styles.cardBottom}><strong>{item.sellable
              ? <>{item.availableSizes.length > 1 && <small>{th ? "ราคาเริ่มต้น" : "From"}</small>}{price(item.price)}</>
              : item.availability === "SOLD_OUT_TODAY" ? (th ? "หมดวันนี้" : "Sold out today")
              : (th ? "สินค้าหมด" : "Out of stock")}</strong>
              <span className={styles.selectLabel}>{item.sellable ? (th ? "เลือก" : "Select") : "×"}</span></span></span>
        </button>)}</div> : <p className={styles.empty}>{th ? "ไม่พบเมนูที่ค้นหา" : "No matching menu items"}</p>}
        <p className={styles.estimateNote}>{th ? "ราคาบนจอเป็นประมาณการก่อน VAT โปรโมชัน และส่วนลด · ยอดชำระจริงยึด POS" : "Screen prices are estimates before VAT, promotions and discounts · The POS sets the final amount"}</p>
      </main>
      <div className={styles.cartDock}><span className={styles.cartIcon} aria-hidden="true">🛒</span>
        <span className={styles.cartInfo}><b>{lineCount ? (th ? `ตะกร้า ${lineCount} รายการ` : `${lineCount} items in cart`) : (th ? "ตะกร้ายังว่าง" : "Your cart is empty")}</b>
          <small>{th ? "ตรวจรายการก่อนส่งให้พนักงาน" : "Review before sending to staff"}</small></span>
        <span className={styles.dockTotal}><small>{th ? "ยอดประมาณการ" : "Estimated total"}</small><b>{price(total)}</b></span>
        <button type="button" onClick={() => setScreen("CART")}>{th ? "ตรวจรายการ" : "Review order"} →</button></div>
    </div>}
    {screen === "CART" && <main className={styles.reviewPage}>
      <button type="button" className={styles.backButton} onClick={() => setScreen("MENU")}>‹ {th ? "เพิ่มเมนู" : "Add items"}</button>
      <div className={styles.reviewHeading}><span className={styles.eyebrow}>{th ? "ขั้นตอนสุดท้าย" : "Last step"}</span>
        <h1>{th ? "ตรวจรายการของคุณ" : "Review your order"}</h1>
        <p>{mode === "DINE_IN" ? (th ? "กินในร้าน · พนักงานจะยืนยันโต๊ะ" : "Dine in · Staff will confirm your table")
          : (th ? "รับกลับ · ชำระเงินที่เคาน์เตอร์" : "Takeaway · Pay at the counter")}</p></div>
      {cart.length ? <div className={styles.reviewList}>{cart.map((line) => <div className={styles.cartLine} key={line.id}>
        <span className={styles.lineQty}>{line.qty}×</span><div><b>{line.productName}</b>
          <small>{[line.size, ...line.modifiers.filter((item) => line.modifierCodes.includes(item.code)).map((item) => item.name)].filter(Boolean).join(" · ")}</small>
          {line.kitchenNote && <small>{th ? "หมายเหตุ: " : "Note: "}{line.kitchenNote}</small>}</div>
        <strong>{price((line.packPrice + line.modifiers.filter((item) => line.modifierCodes.includes(item.code))
          .reduce((sum, item) => sum + item.priceDelta, 0)) * line.qty)}</strong>
        <button type="button" className={styles.removeButton} aria-label={th ? `ลบ ${line.productName}` : `Remove ${line.productName}`}
          onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>×</button>
      </div>)}</div> : <p className={styles.empty}>{th ? "ยังไม่มีเมนูในตะกร้า" : "Your cart is empty"}</p>}
      <div className={styles.reviewTotal}><span>{th ? "ยอดประมาณการ" : "Estimated total"}</span><b>{price(total)}</b></div>
      <p className={styles.reviewNotice}>{th ? "ยอดนี้เป็นประมาณการก่อน VAT โปรโมชัน และส่วนลด ยอดชำระจริงยึด POS พนักงานจะตรวจราคาและความพร้อมก่อนส่งครัว" : "This is an estimate before VAT, promotions and discounts. The POS determines the final amount. Staff recheck before sending to the kitchen."}</p>
      <button type="button" className={styles.primary} disabled={!cart.length || busy} onClick={() => void submit()}>
        {busy ? (th ? "กำลังส่ง…" : "Submitting…") : submitKey.current
          ? (th ? "ส่งคำขอเดิมอีกครั้ง" : "Retry the same request") : (th ? "ส่งให้พนักงานตรวจ" : "Submit for staff review")}</button>
    </main>}
    {screen === "STATUS" && submission && <main className={styles.statusPage}>
      <span className={styles.statusSymbol} aria-hidden="true">{submission.status === "ACCEPTED" ? "✓" : submission.status === "PENDING" ? "⌛" : "!"}</span>
      <h1>{submission.status === "PENDING" ? (th ? "ส่งคำขอแล้ว" : "Request sent")
        : submission.status === "ACCEPTED" ? (th ? "ร้านรับรายการแล้ว" : "Order accepted")
        : submission.status === "REJECTED" ? (th ? "ร้านไม่สามารถรับรายการ" : "Request declined")
        : (th ? "คำขอหมดอายุ" : "Request expired")}</h1>
      <p>{th ? "รหัสคำขอ" : "Request code"}</p><strong className={styles.requestCode}>{submission.submissionId.slice(0, 8).toUpperCase()}</strong>
      <small className={styles.fullCode}>{th ? "รหัสเต็ม" : "Full request ID"}: {submission.submissionId}</small>
      <p className={styles.statusMessage}>{submission.status === "PENDING" ? (th ? "รอพนักงานตรวจ กรุณาแจ้งรหัสนี้ที่เคาน์เตอร์" : "Waiting for staff. Show this code at the counter.")
        : submission.status === "ACCEPTED" ? (th ? "กรุณาชำระเงินผ่าน POS ที่เคาน์เตอร์" : "Please pay at the POS counter.")
        : submission.status === "REJECTED" ? (submission.rejectionReason || (th ? "กรุณาติดต่อพนักงาน" : "Please ask staff for help."))
        : (th ? "กรุณาติดต่อพนักงานก่อนสั่งใหม่" : "Please ask staff before ordering again.")}</p>
      {statusError && <div className={styles.networkNotice} role="alert"><b>{th ? "ติดตามสถานะไม่ได้" : "Cannot check status"}</b>
        <p>{th ? "กรุณาแจ้งรหัสคำขอให้พนักงานตรวจใน POS" : "Ask staff to check this request code in the POS."}</p></div>}
      <p className={styles.statusHint}>{mode === "TAKEAWAY"
        ? (th ? "รหัสคำขอนี้ไม่ใช่เลขรับอาหาร เลขรับอาหารอาจออกหลังชำระเงินที่ POS" : "This request code is not a pickup number. A pickup number may be issued after POS payment.")
        : (th ? "พนักงานจะยืนยันโต๊ะและผูกคำขอกับบิลของคุณ" : "Staff will confirm your table and link this request to your bill.")}</p>
      <button type="button" className={styles.primary} onClick={reset}>{th ? "เสร็จสิ้น / เริ่มลูกค้าคนถัดไป" : "Done / next customer"}</button>
    </main>}
    {screen === "UNAVAILABLE" && <main className={styles.statusPage} role="alert">
      <span className={styles.statusSymbol} aria-hidden="true">!</span><h1>{th ? "จอนี้ปิดใช้งานแล้ว" : "This screen is unavailable"}</h1>
      <p className={styles.statusMessage}>{th ? "กรุณาติดต่อพนักงาน คำขอที่ยังรอตรวจจะไม่ถูกส่งครัว" : "Please ask staff for help. Pending requests will not be sent to the kitchen."}</p>
    </main>}
    {selected && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeItem(); }}>
      <div className={styles.sheet} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="kiosk-item-title">
        <div className={styles.sheetTop}><MenuImage src={selectedSummary?.imageUrl ?? null} className={styles.sheetImage} />
          <div className={styles.sheetTitle}><button ref={modalCloseRef} type="button" className={styles.closeButton}
            aria-label={th ? "ปิดรายละเอียดเมนู" : "Close item details"} onClick={closeItem}>×</button>
            {selectedSummary?.category && <small>{selectedSummary.category}</small>}
            <h2 id="kiosk-item-title">{selected.productName}</h2>
            <p>{th ? "เลือกตัวเลือกก่อนเพิ่มลงตะกร้า" : "Choose options before adding to cart"}</p>
          </div></div>
        <div className={styles.sheetBody}>
          {selectedSummary && selectedSummary.availableSizes.length > 1 && <fieldset className={styles.optionGroup}>
            <legend>{th ? "เลือกขนาด" : "Choose a size"}</legend><div className={styles.sizeChoices}>
              {selectedSummary.availableSizes.map((value) => <button type="button" key={value.size}
                disabled={busy || !value.available} aria-pressed={selected.size === value.size}
                onClick={() => void openItem(selectedSummary, value.size)}>{value.size}{value.available ? "" : (th ? " · หมด" : " · unavailable")}</button>)}
            </div></fieldset>}
          {Array.from(new Set(selected.modifiers.map((value) => value.groupCode))).map((code) => {
            const group = selected.modifiers.filter((item) => item.groupCode === code);
            return <fieldset key={code} className={styles.optionGroup}><legend>{group[0].groupName}
              {group[0].minSelect > 0 && <small> · {th ? "ต้องเลือก" : "Required"}</small>}</legend>
              <div className={styles.modifierChoices}>{group.map((modifier) => <label key={modifier.code}
                className={selectedModifiers.includes(modifier.code) ? styles.modifierSelected : ""}>
                <input type={modifier.selectionType === "SINGLE" ? "radio" : "checkbox"} name={code}
                  checked={selectedModifiers.includes(modifier.code)} onChange={() => toggle(modifier)} />
                <span>{modifier.name}</span>{modifier.priceDelta > 0 && <small>+{price(modifier.priceDelta)}</small>}
              </label>)}</div></fieldset>;
          })}
          <label className={styles.noteLabel}>{th ? "หมายเหตุถึงครัว" : "Kitchen note"}
            <textarea maxLength={300} value={note} onChange={(event) => setNote(event.target.value)}
              placeholder={th ? "เช่น ไม่ใส่พริก" : "For example, no chili"} /></label>
          {unmet.length > 0 && <p className={styles.requiredNotice} role="status">{th ? "ยังต้องเลือก" : "Still to choose"}: {unmet.join(" · ")}</p>}
          <div className={styles.sheetFooter}><div className={styles.qty}><button type="button" aria-label={th ? "ลดจำนวน" : "Decrease quantity"}
            onClick={() => setQty((value) => Math.max(1, value - 1))}>−</button><b>{qty}</b>
            <button type="button" aria-label={th ? "เพิ่มจำนวน" : "Increase quantity"}
              onClick={() => setQty((value) => Math.min(99, value + 1))}>+</button></div>
            <span className={styles.sheetPrice}><small>{th ? "ยอดประมาณการ" : "Estimated"}</small><b>{price(selectedTotal)}</b></span>
            <button type="button" className={styles.primary} disabled={busy || unmet.length > 0}
              onClick={addItem}>{th ? "เพิ่มลงตะกร้า" : "Add to cart"}</button></div>
        </div>
      </div>
    </div>}
  </div>;
}
