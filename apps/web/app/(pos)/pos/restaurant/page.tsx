"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppstoreOutlined, ArrowRightOutlined, CloseCircleOutlined, CoffeeOutlined, ReloadOutlined, SearchOutlined, ShopOutlined, SwapOutlined, WalletOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Segmented, Spin, Tag, message } from "antd";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
import { appendSplitPaymentRow, type PosPaymentDraft } from "@/lib/pos/paymentDraft";
import { useI18n } from "@/lib/i18nContext";
import styles from "./restaurant.module.css";

const TOKEN_KEY = "bms.pos.deviceToken";
type Staff = { id: string; name: string | null; email: string | null; hasPin: boolean };
type Session = { device: { id: string; code: string; name: string | null }; location: { id: string; name: string; branchCode: string } | null; shift: { id: string; openedAt: string; openingFloat: number } | null; cashiers: Staff[]; approvers: Array<Staff & { approvals: string[] }>; kitchenOperators: Staff[]; businessArchetype?: string | null; vat: { cashRounding?: CashRounding } };
type FloorCheck = { id: string; status: string; guestCount: number; amountDue: number; openedAt: string; itemCount: number; unsentCount: number; version: number; reservedVersion: number | null };
type DiningTable = { id: string; areaId: string; code: string; name: string; seats: number; blocked: boolean; status: "AVAILABLE" | "OCCUPIED" | "BLOCKED"; check: FloorCheck | null };
type Floor = { areas: Array<{ id: string; name: string; sortOrder: number }>; tables: DiningTable[] };
type CheckItem = { id: string; sku: string; productName: string; size: string; packQty: number; packCode: string | null; unitName: string | null; packPrice: number | null; modifierNames: string[]; kitchenNote: string | null; status: "NEW" | "SENT"; roundNo: number | null };
type RestaurantCheck = { id: string; tableId: string; tableCode: string; tableName: string; areaName: string; status: string; guestCount: number; amountDue: number; version: number; reservedVersion: number | null; items: CheckItem[] };
type SearchItem = { sku: string; name: string; price: number; availableTotal: number; availableSizes: Array<{ size: string; available: number; price?: number }> };
type ScanHit = { sku: string; productName: string; size: string; packCode: string; unitName: string; baseQty: number; packPrice: number; available: number; modifiers: Array<{ code: string; name: string; priceDelta: number }> };
type KitchenTicket = { id: string; orderId: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; station: string | null; status: string; modifierCodes: string[]; productName: string; size: string; packQty: number | null; qty: number; createdAt: string };

const LANES = [
  { status: "NEW", label: "เข้าใหม่", color: "#dd5d3d", next: "PREPARING", nextLabel: "เริ่มทำ" },
  { status: "PREPARING", label: "กำลังทำ", color: "#e7a335", next: "READY", nextLabel: "พร้อมเสิร์ฟ" },
  { status: "READY", label: "พร้อมเสิร์ฟ", color: "#30745b", next: "SERVED", nextLabel: "เสิร์ฟแล้ว" },
  { status: "SERVED", label: "เสิร์ฟแล้ว", color: "#718078", next: null, nextLabel: null },
] as const;
const money = (value: number) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export default function RestaurantPosPage() {
  const { lang } = useI18n();
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [floor, setFloor] = useState<Floor>({ areas: [], tables: [] });
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [activeArea, setActiveArea] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [check, setCheck] = useState<RestaurantCheck | null>(null);
  const [screen, setScreen] = useState<"FLOOR" | "KITCHEN">("FLOOR");
  const [actorUserId, setActorUserId] = useState("");
  const [actorPin, setActorPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [menuHit, setMenuHit] = useState<ScanHit | null>(null);
  const [modifierCodes, setModifierCodes] = useState<string[]>([]);
  const [kitchenNote, setKitchenNote] = useState("");
  const [menuQty, setMenuQty] = useState(1);
  const [openTable, setOpenTable] = useState<DiningTable | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [shiftModal, setShiftModal] = useState<"OPEN" | "CLOSE" | null>(null);
  const [cashAmount, setCashAmount] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState<PosPaymentDraft[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetTableId, setTargetTableId] = useState("");

  useEffect(() => { setToken(window.localStorage.getItem(TOKEN_KEY) ?? ""); setReady(true); }, []);
  const staff = useMemo(() => { const map = new Map<string, Staff>(); for (const person of [...(session?.cashiers ?? []), ...(session?.approvers ?? []), ...(session?.kitchenOperators ?? [])]) map.set(person.id, person); return [...map.values()]; }, [session]);
  const visibleTables = activeArea ? floor.tables.filter((table) => table.areaId === activeArea) : floor.tables;
  const availableTables = floor.tables.filter((table) => table.status === "AVAILABLE" && table.id !== selectedTableId);
  // เกณฑ์เดียวที่ใช้ทั้งคำเตือนและป้ายยอดเงิน: "มีบรรทัดที่ยังไม่ส่งครัวจริงไหม"
  // (เทียบ version กับ reservedVersion ตรง ๆ จะเตือนตั้งแต่บิลยังว่าง เพราะบิลใหม่มี
  // version = 0 แต่ reservedVersion = null) · ยอดที่แสดงยังเป็นตัวเลขจาก server เสมอ
  // ห้ามคำนวณเองที่จอ เพราะจะกลายเป็นสูตรเงินชุดที่สอง
  const hasUnsent = Boolean(check?.items.some((item) => item.status === "NEW"));
  const paymentTotal = Math.round(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) * 100) / 100;
  const checkoutDue = check == null ? 0 : Math.round((check.amountDue + (
    payments.length === 1 && payments[0].method === "CASH"
      ? cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")
      : 0
  )) * 100) / 100;

  async function json(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "x-pos-device-token": token, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? body.reason ?? `HTTP ${response.status}`));
    return body;
  }
  function auth(extra: Record<string, unknown> = {}) { if (!actorUserId || !actorPin) throw new Error("เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"); return { ...extra, cashierUserId: actorUserId, cashierPin: actorPin }; }
  async function run(work: () => Promise<void>) { setWorking(true); try { await work(); setError(""); } catch (cause) { const text = cause instanceof Error ? cause.message : String(cause); setError(text); message.error(text); } finally { setWorking(false); } }
  async function loadSession() { const data: Session = await json("/api/pos/session"); if (data.businessArchetype !== "restaurant") { window.location.replace("/pos?surface=retail"); return null; } setSession(data); setActorUserId((current) => current || data.cashiers.find((p) => p.hasPin)?.id || data.kitchenOperators.find((p) => p.hasPin)?.id || ""); return data; }
  async function loadFloor() { const data: Floor = await json("/api/pos/restaurant/floor"); setFloor(data); setActiveArea((current) => current && data.areas.some((area) => area.id === current) ? current : data.areas[0]?.id ?? ""); return data; }
  async function loadTickets() { const data = await json("/api/pos/kitchen/tickets?limit=200"); setTickets(Array.isArray(data.tickets) ? data.tickets : []); }
  async function loadCheck(id: string) { const data = await json(`/api/pos/restaurant/checks/${id}`); setCheck(data.check); return data.check as RestaurantCheck; }
  async function refresh() { if (!token) return; setLoading(true); try { if (!(await loadSession())) return; await Promise.all([loadFloor(), loadTickets()]); if (check?.id) await loadCheck(check.id).catch(() => setCheck(null)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); } }
  useEffect(() => { if (token) void refresh(); else if (ready) setLoading(false); }, [token, ready]);
  useEffect(() => { if (!token || !search.trim() || !check) { setSearchResults([]); return; } const timer = window.setTimeout(() => { void json(`/api/pos/search?q=${encodeURIComponent(search.trim())}`).then((body) => setSearchResults(Array.isArray(body.items) ? body.items : [])).catch((cause) => message.error(cause.message)); }, 250); return () => clearTimeout(timer); }, [search, token, check?.id]);
  // KDS/floor are operational screens, so stale data is more dangerous than a
  // small bounded poll. The API remains branch-scoped by the device token.
  useEffect(() => {
    if (!token || screen !== "KITCHEN") return;
    const timer = window.setInterval(() => { void Promise.all([loadTickets(), loadFloor()]).catch(() => {}); }, 5000);
    return () => window.clearInterval(timer);
  }, [token, screen]);

  async function chooseTable(table: DiningTable) { if (table.blocked) return; setSelectedTableId(table.id); if (table.check) await run(async () => { await loadCheck(table.check!.id); }); else { setCheck(null); setGuestCount(Math.min(table.seats, 2)); setOpenTable(table); } }
  async function openCheck() { if (!openTable) return; await run(async () => { const body = await json("/api/pos/restaurant/checks", { method: "POST", body: JSON.stringify(auth({ tableId: openTable.id, guestCount })) }); setOpenTable(null); setCheck(body.check); await loadFloor(); }); }
  async function chooseMenu(item: SearchItem) { await run(async () => { const size = item.availableSizes.find((v) => v.available > 0)?.size ?? item.availableSizes[0]?.size ?? ""; const hit = await json(`/api/pos/scan?code=${encodeURIComponent(item.sku)}&size=${encodeURIComponent(size)}&withImage=1`); setMenuHit(hit); setModifierCodes([]); setKitchenNote(""); setMenuQty(1); }); }
  async function addMenu() { if (!check || !menuHit) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: "add_item", sku: menuHit.sku, size: menuHit.size, packCode: menuHit.packCode, packQty: menuQty, modifierCodes, kitchenNote })) }); setCheck(body.check); setMenuHit(null); setSearch(""); await loadFloor(); }); }
  async function action(name: string, extra: Record<string, unknown> = {}) { if (!check) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: name, ...extra })) }); if (body.check) setCheck(body.check); await Promise.all([loadFloor(), loadTickets()]); }); }
  async function settle() {
    if (!check) return;
    if (payments.length === 0) { message.error("ต้องระบุช่องทางชำระเงิน"); return; }
    if (Math.abs(paymentTotal - checkoutDue) > 0.009) { message.error(`ยอดชำระรวมต้องเท่ากับ ฿${money(checkoutDue)}`); return; }
    await run(async () => {
      const result = await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({
          action: "settle",
          payments: payments.map((payment) => ({
            method: payment.method,
            amount: Number(payment.amount),
            cashTendered: payment.method === "CASH"
              ? Math.max(Number(payment.tendered || payment.amount), Number(payment.amount))
              : null,
            ref: payment.ref.trim() || null,
          })),
        })),
      });
      message.success(`ปิดบิลแล้ว ฿${money(result.total)}`);
      setCheckoutOpen(false);
      setPayments([]);
      setCheck(null);
      setSelectedTableId("");
      await Promise.all([loadFloor(), loadTickets(), loadSession()]);
    });
  }
  async function ticketStatus(ticket: KitchenTicket, status: string) { await run(async () => { const body = await json(`/api/pos/kitchen/tickets/${ticket.id}/status`, { method: "POST", body: JSON.stringify({ userId: actorUserId, pin: actorPin, status }) }); setTickets((current) => current.map((row) => row.id === ticket.id ? body.ticket : row)); }); }
  async function changeShift() { if (!shiftModal) return; await run(async () => { await json("/api/pos/shift", { method: "POST", body: JSON.stringify({ action: shiftModal.toLowerCase(), userId: actorUserId, pin: actorPin, ...(shiftModal === "OPEN" ? { openingFloat: cashAmount } : { countedCash: cashAmount }) }) }); setShiftModal(null); setCashAmount(0); await loadSession(); }); }

  if (!ready || loading) return <main className={styles.page}><div className={styles.empty}><Spin size="large" /></div></main>;
  if (!token) return <main className={styles.page}><Alert type="warning" showIcon message="ยังไม่พบ device token" description="จับคู่เครื่อง POS จากหลังบ้านก่อนเปิดหน้านี้" /></main>;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><div className={styles.brandMark}>B</div><div><h1 className={styles.title}>BMS Restaurant</h1><p className={styles.subtitle}>{session?.location?.name ?? "-"} · {session?.device.code} · โต๊ะและครัวแยกจาก Retail POS</p></div></div>
        <div className={styles.topActions}><Segmented value={screen} onChange={(value) => setScreen(value as "FLOOR" | "KITCHEN")} options={[{ value: "FLOOR", label: <span><AppstoreOutlined /> โต๊ะ</span> }, { value: "KITCHEN", label: <span><CoffeeOutlined /> ครัว</span> }]} /><Button icon={<ReloadOutlined />} onClick={() => void refresh()}>รีเฟรช</Button><Button icon={<ShopOutlined />} onClick={() => { window.location.href = "/pos?surface=retail"; }} title="คืนสินค้า · รับของเข้าคลัง · มัดจำ · บัตรของขวัญ · ขายเชื่อ ยังอยู่ที่หน้าค้าปลีก">โหมดค้าปลีก</Button><Button type={session?.shift ? "default" : "primary"} onClick={() => setShiftModal(session?.shift ? "CLOSE" : "OPEN")}>{session?.shift ? "ปิดกะ" : "เปิดกะ"}</Button></div>
      </header>
      <section className={styles.operatorBar}><div className={styles.operatorFields}><strong>ผู้ปฏิบัติงาน</strong><select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}><option value="">เลือกพนักงาน</option>{staff.map((person) => <option key={person.id} value={person.id} disabled={!person.hasPin}>{person.name ?? person.email ?? person.id}{person.hasPin ? "" : " · ยังไม่มี PIN"}</option>)}</select><input value={actorPin} onChange={(event) => setActorPin(event.target.value)} type="password" inputMode="numeric" placeholder="PIN" /></div><Tag color={session?.shift ? "green" : "orange"}>{session?.shift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}</Tag></section>
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}

      {screen === "FLOOR" ? <Spin spinning={working}><div className={styles.workspace}>
        <section className={styles.panel}>{floor.areas.length === 0 ? <div className={styles.setup}><div><div className={styles.setupIcon}><ShopOutlined /></div><h2>ยังไม่มีผังโต๊ะของสาขานี้</h2><p>เริ่มด้วยโซนหน้าร้านและโต๊ะ 12 ตัว</p><Button type="primary" size="large" disabled={!session?.shift} onClick={() => void run(async () => { const data = await json("/api/pos/restaurant/floor", { method: "POST", body: JSON.stringify(auth({ tableCount: 12 })) }); setFloor(data); setActiveArea(data.areas[0]?.id ?? ""); })}>สร้างผังเริ่มต้น</Button></div></div> : <>
          <div className={styles.panelHeader}><div><h2>ผังโต๊ะ</h2><small>{floor.tables.filter((t) => t.status === "AVAILABLE").length} โต๊ะว่าง · {floor.tables.filter((t) => t.status === "OCCUPIED").length} โต๊ะใช้งาน</small></div><Tag color="volcano">LIVE</Tag></div>
          <div className={styles.areaTabs}>{floor.areas.map((area) => <button key={area.id} className={`${styles.areaButton} ${activeArea === area.id ? styles.areaButtonActive : ""}`} onClick={() => setActiveArea(area.id)}>{area.name}</button>)}</div>
          <div className={styles.tableGrid}>{visibleTables.map((table) => <button key={table.id} className={`${styles.tableCard} ${table.status === "OCCUPIED" ? styles.tableOccupied : ""} ${table.blocked ? styles.tableBlocked : ""} ${selectedTableId === table.id ? styles.tableSelected : ""}`} onClick={() => void chooseTable(table)}><span className={styles.dot} /><div className={styles.tableCode}>{table.code}</div><div className={styles.tableName}>{table.name}</div><div className={styles.tableMeta}>{table.check ? `${table.check.guestCount} คน · ${table.check.itemCount} รายการ` : `${table.seats} ที่นั่ง · ว่าง`}</div>{table.check && <div className={styles.tableAmount}>฿{money(table.check.amountDue)}</div>}{(table.check?.unsentCount ?? 0) > 0 && <Tag color="orange" style={{ marginTop: 7 }}>{table.check!.unsentCount} ยังไม่ส่ง</Tag>}</button>)}</div>
        </>}</section>
        <aside className={styles.checkPanel}>{check ? <>
          <div className={styles.checkHead}><h2>{check.tableName}</h2><p>{check.areaName} · {check.guestCount} คน · บิล #{check.id.slice(0, 8)}</p></div>
          <div className={styles.checkBody}><div className={styles.searchRow}><input className={styles.field} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นชื่อเมนู / SKU" /><Button icon={<SearchOutlined />} /></div>
            {searchResults.length > 0 && <div className={styles.searchResults}>{searchResults.map((item) => <button key={item.sku} className={styles.menuResult} onClick={() => void chooseMenu(item)}><span><strong>{item.name}</strong><br /><small>{item.sku} · คงเหลือ {item.availableTotal}</small></span><strong>฿{money(item.price)}</strong></button>)}</div>}
            <div className={styles.items}>{check.items.length === 0 && <div className={styles.empty}>ค้นเมนูด้านบนเพื่อเริ่มรับออร์เดอร์</div>}{check.items.map((item) => <article className={styles.item} key={item.id}><div className={styles.itemTop}><div><div className={styles.itemName}>{item.productName}</div><div className={styles.itemMeta}>{item.size !== "-" ? `${item.size} · ` : ""}{item.packQty} {item.unitName ?? "รายการ"}{item.roundNo ? ` · รอบ ${item.roundNo}` : ""}</div></div>{item.status === "NEW" ? <Button danger size="small" icon={<CloseCircleOutlined />} onClick={() => void action("remove_item", { itemId: item.id })} /> : <Tag color="green">ส่งแล้ว</Tag>}</div><div className={styles.itemTags}>{item.status === "NEW" && <span className={`${styles.tag} ${styles.tagNew}`}>รอส่งครัว</span>}{item.modifierNames.map((name) => <span className={styles.tag} key={name}>{name}</span>)}{item.kitchenNote && <span className={styles.tag}>โน้ต: {item.kitchenNote}</span>}</div></article>)}</div>
          </div>
          <div className={styles.checkFooter}>{hasUnsent && <Alert type="warning" showIcon message="มีรายการใหม่ที่ยังไม่จองสต็อก/ส่งครัว" />}<div className={styles.total}><span>{hasUnsent ? "ยอดที่ส่งครัวแล้ว" : "ยอดบิลปัจจุบัน"}</span><strong>฿{money(check.amountDue)}</strong></div><div className={styles.footerButtons}><Button icon={<SwapOutlined />} onClick={() => { setTargetTableId(availableTables[0]?.id ?? ""); setMoveOpen(true); }}>ย้ายโต๊ะ</Button><Button danger onClick={() => { const reason = window.prompt("เหตุผลที่ยกเลิกบิล"); if (reason) void action("cancel", { reason }).then(() => { setCheck(null); setSelectedTableId(""); }); }}>ยกเลิกบิล</Button><Button className={styles.primaryAction} size="large" icon={<CoffeeOutlined />} disabled={!hasUnsent} onClick={() => void action("send_kitchen")}>ส่งครัว / จองวัตถุดิบ</Button><Button className={styles.primaryAction} type="primary" size="large" icon={<WalletOutlined />} disabled={!check.items.length || hasUnsent || check.amountDue <= 0} onClick={() => { const cashDue = Math.round((check.amountDue + cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")) * 100) / 100; setPayments([{ id: `pay-${Date.now()}`, method: "CASH", amount: String(cashDue), tendered: String(cashDue), ref: "" }]); setCheckoutOpen(true); }}>คิดเงิน</Button></div></div>
        </> : <div className={styles.empty}><div><AppstoreOutlined style={{ fontSize: 40 }} /><h3>เลือกโต๊ะเพื่อเริ่มงาน</h3><p>โต๊ะว่างจะเปิดบิลใหม่ โต๊ะสีส้มจะเรียกบิลเดิม</p></div></div>}</aside>
      </div></Spin> : <Spin spinning={working}><section className={styles.kitchenBoard}><div className={styles.panelHeader}><div><h2>Kitchen Display</h2><small>รายการจากโต๊ะเข้าครัวก่อนชำระเงิน</small></div><Button icon={<ReloadOutlined />} onClick={() => void loadTickets()}>รีเฟรชคิว</Button></div><div className={styles.lanes}>{LANES.map((lane) => { const rows = tickets.filter((ticket) => ticket.status === lane.status); return <section className={styles.lane} style={{ "--lane-color": lane.color } as CSSProperties} key={lane.status}><div className={styles.laneHead}><strong>{lane.label}</strong><span className={styles.laneCount}>{rows.length}</span></div>{rows.map((ticket) => <article className={styles.ticket} key={ticket.id}><div className={styles.ticketTable}>{ticket.tableName ? `${ticket.tableName} · รอบ ${ticket.roundNo ?? 1}` : `บิล #${ticket.orderId?.slice(0, 8) ?? "-"}`}</div><div className={styles.ticketName}>{ticket.productName}</div><div className={styles.ticketMeta}>{ticket.size !== "-" ? `${ticket.size} · ` : ""}x {ticket.packQty ?? ticket.qty} · {ticket.station ?? "ไม่ระบุ station"} · {new Date(ticket.createdAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</div>{ticket.modifierCodes.length > 0 && <div className={styles.itemTags}>{ticket.modifierCodes.map((code) => <span className={styles.tag} key={code}>{code}</span>)}</div>}{ticket.kitchenNote && <div className={styles.ticketNote}>{ticket.kitchenNote}</div>}<div className={styles.ticketActions}>{lane.next && <Button type="primary" size="small" onClick={() => void ticketStatus(ticket, lane.next!)}>{lane.nextLabel} <ArrowRightOutlined /></Button>}{lane.status !== "SERVED" && <Button danger size="small" onClick={() => void ticketStatus(ticket, "CANCELLED")}>ยกเลิก</Button>}</div></article>)}</section>; })}</div></section></Spin>}
    </div>

    <Modal title={`เปิดบิล ${openTable?.name ?? ""}`} open={Boolean(openTable)} onCancel={() => setOpenTable(null)} onOk={() => void openCheck()} confirmLoading={working} okText="เปิดโต๊ะ"><div className={styles.modalGrid}><label>จำนวนลูกค้า<input type="number" min={1} max={500} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} /></label></div></Modal>
    <Modal title={menuHit?.productName ?? "เพิ่มเมนู"} open={Boolean(menuHit)} onCancel={() => setMenuHit(null)} onOk={() => void addMenu()} confirmLoading={working} okText="เพิ่มในบิล">{menuHit && <div className={styles.modalGrid}><Alert type="info" message={`${menuHit.size} · ฿${money(menuHit.packPrice + menuHit.modifiers.filter((modifier) => modifierCodes.includes(modifier.code)).reduce((sum, modifier) => sum + modifier.priceDelta, 0))} / ${menuHit.unitName} · รวม ${menuQty} รายการ ฿${money((menuHit.packPrice + menuHit.modifiers.filter((modifier) => modifierCodes.includes(modifier.code)).reduce((sum, modifier) => sum + modifier.priceDelta, 0)) * menuQty)}`} /><label>จำนวน<input type="number" min={1} max={9999} value={menuQty} onChange={(event) => setMenuQty(Number(event.target.value))} /></label>{menuHit.modifiers.length > 0 && <div><strong>ตัวเลือก</strong><div className={styles.modifierList}>{menuHit.modifiers.map((modifier) => <label className={styles.modifierChoice} key={modifier.code}><input type="checkbox" checked={modifierCodes.includes(modifier.code)} onChange={(event) => setModifierCodes((current) => event.target.checked ? [...current, modifier.code] : current.filter((code) => code !== modifier.code))} /><span>{modifier.name}{modifier.priceDelta > 0 ? ` (+฿${money(modifier.priceDelta)})` : ""}</span></label>)}</div></div>}<label>โน้ตถึงครัว<textarea rows={3} maxLength={300} value={kitchenNote} onChange={(event) => setKitchenNote(event.target.value)} placeholder="เช่น ไม่เผ็ด, แยกน้ำ" /></label></div>}</Modal>
    <Modal title={shiftModal === "OPEN" ? "เปิดกะ" : "ปิดกะ"} open={Boolean(shiftModal)} onCancel={() => setShiftModal(null)} onOk={() => void changeShift()} confirmLoading={working} okText={shiftModal === "OPEN" ? "เปิดกะ" : "ยืนยันปิดกะ"}><div className={styles.modalGrid}><Alert type={shiftModal === "OPEN" ? "info" : "warning"} message={shiftModal === "OPEN" ? "ระบุเงินทอนตั้งต้น" : "นับเงินสดจริงในลิ้นชัก"} /><label>จำนวนเงิน<input type="number" min={0} step="0.01" value={cashAmount} onChange={(event) => setCashAmount(Number(event.target.value))} /></label></div></Modal>
    <Modal title={`รับชำระ ${check?.tableName ?? ""}`} open={checkoutOpen} onCancel={() => setCheckoutOpen(false)} onOk={() => void settle()} confirmLoading={working} okText="ยืนยันรับเงิน" width={680}>{check && <div className={styles.modalGrid}><div className={styles.total}><span>ยอดที่ต้องชำระ</span><strong>฿{money(checkoutDue)}</strong></div>{payments.map((payment, index) => <div className={styles.modalGrid} key={payment.id}><label>วิธีชำระ<select value={payment.method} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, method: event.target.value, tendered: "", ref: "" } : row))}><option value="CASH">เงินสด</option><option value="QR">QR / พร้อมเพย์</option><option value="CARD">บัตร</option></select></label><label>ยอดช่องทางนี้<input type="number" min={0.01} step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value } : row))} /></label>{payment.method === "CASH" ? <label>เงินสดที่รับมา<input type="number" min={Number(payment.amount) || 0} step="0.01" value={payment.tendered} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, tendered: event.target.value } : row))} /></label> : <label>เลขอ้างอิง<input value={payment.ref} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, ref: event.target.value } : row))} /></label>}{payments.length > 1 && <Button danger onClick={() => setPayments((current) => current.filter((row) => row.id !== payment.id))}>ลบช่องทาง {index + 1}</Button>}</div>)}<Button type="dashed" onClick={() => setPayments((current) => appendSplitPaymentRow(current, check.amountDue, `pay-${Date.now()}`))}>+ แบ่งชำระอีกช่องทาง</Button><Alert type={Math.abs(paymentTotal - checkoutDue) <= 0.009 ? "success" : "warning"} showIcon message={`รวม ฿${money(paymentTotal)} · ${paymentTotal < checkoutDue ? `เหลือ ฿${money(checkoutDue - paymentTotal)}` : paymentTotal > checkoutDue ? `เกิน ฿${money(paymentTotal - checkoutDue)}` : "ครบยอด"}`} /></div>}</Modal>
    <Modal title="ย้ายโต๊ะ" open={moveOpen} onCancel={() => setMoveOpen(false)} onOk={() => void action("move", { targetTableId }).then(() => setMoveOpen(false))} confirmLoading={working} okText="ย้าย"><div className={styles.modalGrid}><label>โต๊ะปลายทาง<select value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.code}</option>)}</select></label></div></Modal>
  </main>;
}
