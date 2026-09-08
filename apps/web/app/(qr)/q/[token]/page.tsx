"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { unmetModifierGroups } from "@/lib/pos/modifierSelection";
import styles from "./qr-order.module.css";

type Bootstrap = {
  status: "READY" | "WAITING_FOR_TABLE" | "TABLE_UNAVAILABLE" | "INVALID_QR";
  storeName?: string;
  locationName?: string;
  tableCode?: string;
  tableName?: string;
  guestCount?: number;
};
type MenuItem = {
  sku: string;
  name: string;
  price: number;
  imageUrl: string | null;
  kitchenStation: string | null;
  availableSizes: Array<{ size: string; available: boolean }>;
  sellable: boolean;
  availability: string;
};
type Modifier = {
  code: string;
  name: string;
  priceDelta: number;
  groupCode: string;
  groupName: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number | null;
  defaultSelected: boolean;
};
type MenuDetail = {
  sku: string;
  productName: string;
  size: string | null;
  packCode: string | null;
  unitName: string;
  packPrice: number;
  modifiers: Modifier[];
};
type CartLine = MenuDetail & {
  key: string;
  qty: number;
  modifierCodes: string[];
  kitchenNote: string;
};
type Submission = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
};
type ServiceCall = {
  id: string;
  requestCode: "WATER" | "CUTLERY" | "BILL" | "MENU_HELP" | "OTHER";
  requestNote: string | null;
  status: "PENDING" | "ACKNOWLEDGED" | "COMPLETED" | "EXPIRED";
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
};

const SERVICE_OPTIONS = [
  { code: "WATER", icon: "💧", th: "ขอน้ำเปล่าเพิ่ม", en: "More drinking water" },
  { code: "CUTLERY", icon: "🍴", th: "ขอช้อนส้อม / ทิชชู่", en: "Cutlery / tissues" },
  { code: "BILL", icon: "🧾", th: "ขอเช็กบิล", en: "Ask for the bill" },
  { code: "MENU_HELP", icon: "❓", th: "สอบถามเมนู", en: "Menu question" },
  { code: "OTHER", icon: "☝️", th: "อื่น ๆ", en: "Something else" },
] as const;

async function api<T>(url: string, init?: RequestInit, tableToken?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (tableToken) headers.set("x-bms-restaurant-qr", tableToken);
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body as T;
}

function amount(value: number, lang: "th" | "en") {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency", currency: "THB", maximumFractionDigits: 2,
  }).format(value);
}

export default function RestaurantQrOrderPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const [lang, setLang] = useState<"th" | "en">("th");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [serviceCalls, setServiceCalls] = useState<ServiceCall[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<MenuItem | null>(null);
  const [selected, setSelected] = useState<MenuDetail | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"MENU" | "CART" | "ORDERS">("MENU");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceCode, setServiceCode] = useState<ServiceCall["requestCode"] | null>(null);
  const [serviceNote, setServiceNote] = useState("");
  const [serviceToast, setServiceToast] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const submitKey = useRef<string | null>(null);
  const serviceKey = useRef<string | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const sheetCloseButton = useRef<HTMLButtonElement | null>(null);

  const th = lang === "th";
  const menuOpen = selected !== null;
  const loadStatus = useCallback(async () => {
    const [orders, calls] = await Promise.all([
      api<{ submissions: Submission[] }>("/api/bms/restaurant-qr/submissions", undefined, token),
      api<{ calls: ServiceCall[] }>("/api/bms/restaurant-qr/service-calls", undefined, token),
    ]);
    setSubmissions(orders.submissions);
    setServiceCalls(calls.calls);
  }, [token]);
  const open = useCallback(async () => {
    try {
      const state = await api<Bootstrap>(`/api/bms/restaurant-qr/${encodeURIComponent(token)}`);
      setBootstrap(state);
      if (state.status === "READY") {
        const result = await api<{ items: MenuItem[] }>(
          "/api/bms/restaurant-qr/menu", undefined, token
        );
        setMenu(result.items);
        await loadStatus();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QR unavailable");
    }
  }, [loadStatus, token]);

  useEffect(() => { void open(); }, [open]);
  useEffect(() => {
    if (bootstrap?.status !== "WAITING_FOR_TABLE") return;
    const timer = window.setInterval(() => void open(), 5000);
    return () => window.clearInterval(timer);
  }, [bootstrap?.status, open]);
  useEffect(() => {
    if (bootstrap?.status !== "READY") return;
    const timer = window.setInterval(() => void loadStatus().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [bootstrap?.status, loadStatus]);
  useEffect(() => {
    if (!menuOpen) return;
    sheetCloseButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  function closeMenu() {
    setSelectedSummary(null);
    setSelected(null);
    window.requestAnimationFrame(() => menuTrigger.current?.focus());
  }

  const visibleMenu = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return menu.filter((item) => !q || item.name.toLocaleLowerCase().includes(q) || item.sku.toLocaleLowerCase().includes(q));
  }, [menu, search]);
  const cartTotal = cart.reduce((sum, line) => sum + (
    line.packPrice + line.modifiers.filter((modifier) => line.modifierCodes.includes(modifier.code))
      .reduce((delta, modifier) => delta + modifier.priceDelta, 0)
  ) * line.qty, 0);

  async function loadMenuDetail(item: MenuItem, size: string | null, resetDraft: boolean) {
    setBusy(true);
    setError("");
    try {
      const detail = await api<MenuDetail>("/api/bms/restaurant-qr/menu-item", {
        method: "POST",
        body: JSON.stringify({ sku: item.sku, size }),
      }, token);
      setSelectedSummary(item);
      setSelected(detail);
      setSelectedModifiers(detail.modifiers.filter((modifier) => modifier.defaultSelected).map((modifier) => modifier.code));
      if (resetDraft) {
        setQty(1);
        setNote("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Menu unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function chooseMenu(item: MenuItem) {
    if (!item.sellable) return;
    // RECIPE/NON_STOCK menu variants intentionally have no stock of their own, so zero cannot
    // disable a size. Prefer a stocked variant for DIRECT items, then fall back to the first code.
    const initialSize = item.availableSizes.find((variant) => variant.available)?.size
      ?? item.availableSizes[0]?.size ?? null;
    await loadMenuDetail(item, initialSize, true);
  }

  function toggleModifier(modifier: Modifier) {
    setSelectedModifiers((current) => {
      if (current.includes(modifier.code)) return current.filter((code) => code !== modifier.code);
      if (modifier.selectionType === "SINGLE") {
        const groupCodes = new Set(selected?.modifiers.filter((item) => item.groupCode === modifier.groupCode).map((item) => item.code));
        return [...current.filter((code) => !groupCodes.has(code)), modifier.code];
      }
      const selectedInGroup = selected?.modifiers.filter((item) => item.groupCode === modifier.groupCode && current.includes(item.code)).length ?? 0;
      if (modifier.maxSelect != null && selectedInGroup >= modifier.maxSelect) return current;
      return [...current, modifier.code];
    });
  }

  function addToCart() {
    if (!selected) return;
    for (const modifier of selected.modifiers) {
      const group = selected.modifiers.filter((item) => item.groupCode === modifier.groupCode);
      const selectedCount = group.filter((item) => selectedModifiers.includes(item.code)).length;
      if (selectedCount < modifier.minSelect) {
        setError(th ? `กรุณาเลือก ${modifier.groupName} อย่างน้อย ${modifier.minSelect} รายการ` : `Choose at least ${modifier.minSelect} option(s) from ${modifier.groupName}`);
        return;
      }
    }
    setCart((current) => [...current, {
      ...selected,
      key: crypto.randomUUID(),
      qty,
      modifierCodes: selectedModifiers,
      kitchenNote: note.trim(),
    }]);
    closeMenu();
    setError("");
  }

  async function submit() {
    if (!cart.length || busy) return;
    setBusy(true);
    setError("");
    submitKey.current ||= crypto.randomUUID();
    try {
      await api("/api/bms/restaurant-qr/submissions", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: submitKey.current,
          items: cart.map((line) => ({
            sku: line.sku,
            size: line.size,
            packCode: line.packCode,
            packQty: line.qty,
            modifierCodes: line.modifierCodes,
            kitchenNote: line.kitchenNote,
          })),
        }),
      }, token);
      submitKey.current = null;
      setCart([]);
      await loadStatus();
      setView("ORDERS");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function callStaff() {
    if (!serviceCode || serviceBusy) return;
    if (serviceCode === "OTHER" && serviceNote.trim().length < 3) {
      setError(th ? "กรุณาระบุสิ่งที่ต้องการอย่างน้อย 3 ตัวอักษร" : "Please add at least 3 characters");
      return;
    }
    setServiceBusy(true);
    setError("");
    serviceKey.current ||= crypto.randomUUID();
    try {
      await api("/api/bms/restaurant-qr/service-calls", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: serviceKey.current,
          requestCode: serviceCode,
          requestNote: serviceCode === "OTHER" ? serviceNote.trim() : null,
        }),
      }, token);
      serviceKey.current = null;
      setServiceOpen(false);
      setServiceCode(null);
      setServiceNote("");
      setServiceToast(true);
      window.setTimeout(() => setServiceToast(false), 3500);
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Call failed");
    } finally {
      setServiceBusy(false);
    }
  }

  if (error && !bootstrap) return <div className={styles.centerState}><div><span>⚠</span><h1>{th ? "เปิด QR ไม่สำเร็จ" : "Could not open QR"}</h1><p>{error}</p></div></div>;
  if (!bootstrap) return <div className={styles.centerState}><div className={styles.spinner} /></div>;
  if (bootstrap.status !== "READY") return <div className={styles.centerState}><div><span>🍽️</span><h1>{bootstrap.tableName ?? bootstrap.tableCode}</h1><p>{bootstrap.status === "WAITING_FOR_TABLE" ? (th ? "กรุณาให้พนักงานเปิดโต๊ะก่อนเริ่มสั่งอาหาร" : "Ask a staff member to open the table before ordering") : (th ? "โต๊ะนี้ยังไม่พร้อมรับออร์เดอร์" : "This table is not accepting orders")}</p>{bootstrap.status === "WAITING_FOR_TABLE" && <small>{th ? "หน้านี้จะตรวจสอบอีกครั้งอัตโนมัติ" : "This page will refresh automatically"}</small>}</div></div>;

  const modifierGroups = selected ? Array.from(new Set(selected.modifiers.map((item) => item.groupCode))) : [];
  // กติกาเดียวกับหน้าเครื่องขาย: ปุ่มที่กดแล้ว server ปฏิเสธแน่ ๆ ต้องกดไม่ได้และต้องบอกว่าติดกลุ่มไหน
  // (เคสจริง 2026-09-05 ที่หน้าร้าน: ส้มตำมีกลุ่มบังคับที่ไม่มีค่าปริยาย แล้วพนักงานกดซ้ำสี่ครั้ง)
  const unmetGroups = selected ? unmetModifierGroups(selected.modifiers, selectedModifiers) : [];
  const pendingServiceCall = serviceCalls.find((call) => call.status === "PENDING") ?? null;
  const activeServiceCallCount = serviceCalls.filter((call) => call.status === "PENDING" || call.status === "ACKNOWLEDGED").length;
  return <div className={styles.app}>
    {serviceToast && <div className={styles.toast} role="status"><span aria-hidden="true">🔔</span><div><b>{th ? "แจ้งพนักงานแล้ว" : "Staff notified"}</b><small>{th ? `แจ้งเตือน · กำลังไปที่โต๊ะ ${bootstrap.tableName}` : `Request sent · coming to ${bootstrap.tableName}`}</small></div></div>}
    <header className={styles.header}>
      <div><strong>{bootstrap.storeName}</strong><small>{bootstrap.locationName}</small></div>
      <button type="button" onClick={() => setLang(th ? "en" : "th")}>{th ? "EN" : "ไทย"}</button>
      <div className={styles.table}><small>{th ? "กำลังสั่งให้" : "Ordering for"}</small><b>{bootstrap.tableName}</b><span>{bootstrap.guestCount} {th ? "ท่าน" : "guests"}</span></div>
    </header>

    {view === "MENU" && <section className={styles.content}>
      <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? "ค้นหาเมนู..." : "Search menu..."} aria-label={th ? "ค้นหาเมนู" : "Search menu"} />
      <div className={styles.sectionTitle}><h1>{th ? "เมนูอาหาร" : "Menu"}</h1><span>{visibleMenu.filter((item) => item.sellable).length} {th ? "รายการ" : "items"}</span></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.menuGrid}>{visibleMenu.map((item) => <button type="button" className={styles.menuCard} key={item.sku} disabled={!item.sellable || busy} onClick={(event) => { menuTrigger.current = event.currentTarget; void chooseMenu(item); }}>
        <div className={styles.image}>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span aria-hidden="true">🍲</span>}{!item.sellable && <em>{th ? "หมดวันนี้" : "Sold out"}</em>}</div>
        <div className={styles.menuText}><strong>{item.name}</strong><small>{item.kitchenStation ?? (th ? "ไม่ระบุสถานี" : "Unassigned")}</small><b>{amount(item.price, lang)}</b></div>
      </button>)}</div>
    </section>}

    {view === "CART" && <section className={styles.content}>
      <div className={styles.sectionTitle}><h1>{th ? "ตรวจรายการ" : "Review order"}</h1><span>{cart.length}</span></div>
      {!cart.length ? <div className={styles.empty}>🛒<p>{th ? "ยังไม่มีรายการในตะกร้า" : "Your cart is empty"}</p></div> : <>
        <div className={styles.cartLines}>{cart.map((line) => <div className={styles.cartLine} key={line.key}><span>{line.qty}×</span><div><strong>{line.productName}</strong><small>{[line.size, ...line.modifiers.filter((modifier) => line.modifierCodes.includes(modifier.code)).map((modifier) => modifier.name)].filter(Boolean).join(" · ")}</small>{line.kitchenNote && <em>{line.kitchenNote}</em>}</div><button type="button" aria-label={th ? `ลบ ${line.productName}` : `Remove ${line.productName}`} onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))}>×</button></div>)}</div>
        <div className={styles.total}><span>{th ? "ยอดประมาณการ" : "Estimated total"}</span><b>{amount(cartTotal, lang)}</b></div>
        <button className={styles.submit} type="button" disabled={busy} onClick={() => void submit()}>{busy ? (th ? "กำลังส่ง..." : "Submitting...") : (th ? "ส่งให้พนักงานตรวจ" : "Submit for staff review")}</button>
        <p className={styles.notice}>{th ? "ราคาจริงและวัตถุดิบจะตรวจอีกครั้งเมื่อพนักงานกดรับ กรุณาแจ้งพนักงานโดยตรงหากมีอาการแพ้อาหารรุนแรง" : "Price and stock are checked again when staff accept. Tell staff directly about severe food allergies."}</p>
      </>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>}

    {view === "ORDERS" && <section className={styles.content}>
      <div className={styles.sectionTitle}><h1>{th ? "ออร์เดอร์ของฉัน" : "My orders"}</h1><button type="button" aria-label={th ? "โหลดสถานะใหม่" : "Refresh order status"} title={th ? "โหลดสถานะใหม่" : "Refresh order status"} onClick={() => void loadStatus()}>↻</button></div>
      {!submissions.length ? <div className={styles.empty}>◷<p>{th ? "ยังไม่มีออร์เดอร์ที่ส่งแล้ว" : "No submitted orders"}</p></div> : <div className={styles.orders}>{submissions.map((submission, index) => <article key={submission.id} className={styles.orderCard}>
        <div><strong>{th ? `รอบที่ ${submissions.length - index}` : `Round ${submissions.length - index}`}</strong><small>{new Date(submission.submittedAt).toLocaleTimeString(th ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}</small></div>
        <span data-status={submission.status}>{submission.status === "PENDING" ? (th ? "รอพนักงานรับ" : "Waiting for staff") : submission.status === "ACCEPTED" ? (th ? "รับและส่งครัวแล้ว" : "Sent to kitchen") : submission.status === "REJECTED" ? (th ? "ร้านปฏิเสธ" : "Declined") : (th ? "หมดอายุ" : "Expired")}</span>
        {submission.rejectionReason && <p>{submission.rejectionReason}</p>}
      </article>)}</div>}
    </section>}

    <nav className={styles.nav} aria-label={th ? "เมนูหลัก" : "Main navigation"}>
      <button type="button" data-active={view === "MENU"} aria-current={view === "MENU" ? "page" : undefined} onClick={() => setView("MENU")}><span aria-hidden="true">⌂</span>{th ? "เมนู" : "Menu"}</button>
      <button type="button" className={styles.cartButton} aria-current={view === "CART" ? "page" : undefined} onClick={() => setView("CART")}><b>{th ? "ตะกร้า" : "Cart"} · {amount(cartTotal, lang)}</b><small>{cart.reduce((sum, item) => sum + item.qty, 0)} {th ? "รายการ" : "items"}</small></button>
      <button type="button" data-active={view === "ORDERS"} aria-current={view === "ORDERS" ? "page" : undefined} onClick={() => setView("ORDERS")}><span aria-hidden="true">◷</span>{th ? "ออร์เดอร์" : "Orders"}</button>
    </nav>

    <button type="button" className={styles.callStaffButton}
      aria-label={pendingServiceCall ? (th ? "รอพนักงานรับทราบ" : "Waiting for staff") : (th ? "เรียกพนักงาน" : "Call staff")}
      title={pendingServiceCall ? (th ? "รอพนักงานรับทราบ" : "Waiting for staff") : (th ? "เรียกพนักงาน" : "Call staff")}
      disabled={Boolean(pendingServiceCall)} onClick={() => { setError(""); setServiceOpen(true); }}>
      <span aria-hidden="true">🔔</span>
      {activeServiceCallCount > 0 && <b>{activeServiceCallCount}</b>}
    </button>

    {serviceOpen && <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="service-call-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setServiceOpen(false); }}>
      <section className={`${styles.sheet} ${styles.serviceSheet}`}>
        <div className={styles.sheetHead}><div><h2 id="service-call-title">{th ? "เรียกพนักงาน" : "Call staff"}</h2></div><button type="button" aria-label={th ? "ปิด" : "Close"} onClick={() => setServiceOpen(false)}>×</button></div>
        <p className={styles.serviceIntro}>{th ? `เลือกเหตุผล พนักงานจะมาที่โต๊ะ ${bootstrap.tableName}` : `Choose a reason. Staff will come to ${bootstrap.tableName}.`}</p>
        <div className={styles.serviceOptions}>{SERVICE_OPTIONS.map((option) => <button type="button" key={option.code}
          data-active={serviceCode === option.code} onClick={() => setServiceCode(option.code)}>
          <span aria-hidden="true">{option.icon}</span><b>{th ? option.th : option.en}</b>
          {option.code === "OTHER" && <small>{th ? "พิมพ์สั้น ๆ ด้านล่าง" : "Add a short note below"}</small>}
        </button>)}</div>
        {serviceCode === "OTHER" && <label className={styles.serviceNote}>{th ? "ต้องการให้ช่วยอะไร" : "How can we help?"}<textarea autoFocus maxLength={200} value={serviceNote} onChange={(event) => setServiceNote(event.target.value)} placeholder={th ? "อย่างน้อย 3 ตัวอักษร" : "At least 3 characters"} /></label>}
        {error && <div className={styles.error} role="alert">{error}</div>}
        <button type="button" className={styles.submit} disabled={serviceBusy || !serviceCode || (serviceCode === "OTHER" && serviceNote.trim().length < 3)} onClick={() => void callStaff()}>{serviceBusy ? (th ? "กำลังแจ้ง..." : "Sending...") : (th ? "แจ้งพนักงาน" : "Notify staff")}</button>
      </section>
    </div>}

    {selected && <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="qr-menu-item-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
      <section className={styles.sheet}>
        <div className={styles.sheetHead}><div><h2 id="qr-menu-item-title">{selected.productName}</h2><b>{amount(selected.packPrice, lang)}</b></div><button ref={sheetCloseButton} type="button" aria-label={th ? "ปิด" : "Close"} onClick={closeMenu}>×</button></div>
        {(selectedSummary?.availableSizes.length ?? 0) > 1 && <fieldset className={styles.sizePicker} disabled={busy}>
          <legend>{th ? "เลือกขนาด" : "Choose size"}</legend>
          <div>{selectedSummary!.availableSizes.map((option) => <button type="button" key={option.size} data-active={selected.size === option.size} disabled={busy} onClick={() => void loadMenuDetail(selectedSummary!, option.size, false)}>{option.size}</button>)}</div>
        </fieldset>}
        {modifierGroups.map((groupCode) => {
          const group = selected.modifiers.filter((item) => item.groupCode === groupCode);
          return <fieldset key={groupCode}><legend>{group[0].groupName}{group[0].minSelect > 0 && <small>{th ? "จำเป็น" : "Required"}</small>}</legend>{group.map((modifier) => <label key={modifier.code}><input type={modifier.selectionType === "SINGLE" ? "radio" : "checkbox"} name={groupCode} checked={selectedModifiers.includes(modifier.code)} onChange={() => toggleModifier(modifier)} /><span>{modifier.name}</span><b>{modifier.priceDelta ? `+${amount(modifier.priceDelta, lang)}` : ""}</b></label>)}</fieldset>;
        })}
        <label className={styles.note}>{th ? "หมายเหตุถึงครัว" : "Kitchen note"}<textarea maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder={th ? "เช่น ไม่ใส่ถั่ว" : "e.g. no peanuts"} /></label>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <div className={styles.addRow}><div><button type="button" aria-label={th ? "ลดจำนวน" : "Decrease quantity"} onClick={() => setQty((value) => Math.max(1, value - 1))}>−</button><b aria-live="polite">{qty}</b><button type="button" aria-label={th ? "เพิ่มจำนวน" : "Increase quantity"} onClick={() => setQty((value) => Math.min(99, value + 1))}>+</button></div><button type="button" disabled={busy || unmetGroups.length > 0} onClick={addToCart}>{th ? "เพิ่มลงตะกร้า" : "Add to cart"}</button></div>
        {unmetGroups.length > 0 && <p className={styles.notice} role="status">{th ? `ยังต้องเลือก: ${unmetGroups.join(" · ")}` : `Still to choose: ${unmetGroups.join(" · ")}`}</p>}
      </section>
    </div>}
  </div>;
}
