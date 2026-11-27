"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";

export type KioskSubmission = {
  id: string; serviceMode: "DINE_IN" | "TAKEAWAY";
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  checkId: string | null; submittedAt: string; rejectionReason: string | null;
  checkStatus?: string | null; orderId?: string | null; acceptedOrderId?: string | null;
  tableCode?: string | null;
  tableName?: string | null; areaName?: string | null; splitGroupNo?: number | null;
  items: Array<{ sku: string; productName: string; size?: string | null;
    packQty: number; modifierCodes?: string[]; kitchenNote?: string | null }>;
};

type KioskQuote = { fingerprint: string; total: number; lines: Array<{
  sku: string; productName: string; size: string; packQty: number;
  unitPrice: number; lineAmount: number; modifiers: Array<{ code: string; name: string; priceDelta: number }>;
}> };
type KioskPreview = { submissionId: string; serviceMode: "DINE_IN" | "TAKEAWAY";
  submittedLines: Array<{ unitPrice?: number; lineAmount?: number } | null>;
  quote: KioskQuote; priceChanged: boolean; check: null | {
    id: string; version: number; tableId: string; tableCode: string;
    tableName: string; areaName: string; splitGroupNo: number; openedAt: string;
  };
};

export default function RestaurantKioskPanel({
  active, submissions, tables, areas, operatorReady, shiftOpen, request, auth, reload, onAccepted, onOpenCheck,
}: {
  active: boolean;
  submissions: KioskSubmission[];
  tables: Array<{ id: string; areaId: string; code: string; name: string;
    checks: Array<{ id: string; status: string; splitGroupNo?: number }> }>;
  areas: Array<{ id: string; name: string }>;
  operatorReady: boolean; shiftOpen: boolean;
  request: (url: string, init?: RequestInit) => Promise<any>;
  auth: (extra?: Record<string, unknown>) => Record<string, unknown>;
  reload: () => Promise<void>;
  onAccepted: () => Promise<void>;
  onOpenCheck: (checkId: string) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const isEnglish = lang === "en";
  const [url, setUrl] = useState("");
  const [requestCode, setRequestCode] = useState("");
  const [searchResults, setSearchResults] = useState<KioskSubmission[] | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, KioskPreview>>({});
  const [confirmedTable, setConfirmedTable] = useState<Record<string, boolean>>({});
  const [confirmedPrice, setConfirmedPrice] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checks = tables.flatMap((table) => table.checks
    .filter((check) => check.status === "OPEN")
    .map((check, index) => ({ id: check.id,
      label: `${areas.find((area) => area.id === table.areaId)?.name ?? ""} · ${table.code} · ${table.name} · ${isEnglish ? "bill" : "บิล"} ${check.splitGroupNo ?? index + 1} · ${check.id.slice(0, 8)}` })));
  const shown = searchResults ?? submissions;
  async function lookup() {
    const code = requestCode.trim();
    if (!code) { setSearchResults(null); return; }
    setBusy(true); setError("");
    try {
      const result = await request(`/api/pos/restaurant/kiosk?requestCode=${encodeURIComponent(code)}`);
      setSearchResults(Array.isArray(result.submissions) ? result.submissions : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pos_restaurant.kiosk_failed")); }
    finally { setBusy(false); }
  }
  async function preview(submission: KioskSubmission) {
    setBusy(true); setError("");
    try {
      const result: KioskPreview = await request("/api/pos/restaurant/kiosk", {
        method: "POST", body: JSON.stringify(auth({
          action: "preview", submissionId: submission.id, checkId: selectedCheck[submission.id] || null,
        })),
      });
      setPreviews((current) => ({ ...current, [submission.id]: result }));
      setConfirmedTable((current) => ({ ...current, [submission.id]: false }));
      setConfirmedPrice((current) => ({ ...current, [submission.id]: false }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pos_restaurant.kiosk_failed")); }
    finally { setBusy(false); }
  }
  async function manage(action: "issue" | "rotate" | "disable") {
    if (!window.confirm(t(action === "rotate" ? "pos_restaurant.kiosk_rotate_confirm"
      : action === "disable" ? "pos_restaurant.kiosk_disable_confirm" : "pos_restaurant.kiosk_issue_confirm"))) return;
    setBusy(true); setError("");
    try {
      const result = await request("/api/pos/restaurant/kiosk", {
        method: "POST", body: JSON.stringify(auth({ action })),
      });
      setUrl(result.token ? `${location.origin}/kiosk/${result.token}` : "");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pos_restaurant.kiosk_failed")); }
    finally { setBusy(false); }
  }
  async function review(submission: KioskSubmission, action: "accept" | "reject") {
    if (action === "accept" && submission.serviceMode === "DINE_IN" && !selectedCheck[submission.id]) {
      setError(t("pos_restaurant.kiosk_choose_table")); return;
    }
    if (action === "reject" && !reason[submission.id]?.trim()) {
      setError(t("pos_restaurant.kiosk_reason_required")); return;
    }
    const checked = previews[submission.id];
    if (action === "accept" && (!checked || checked.check?.id !== (submission.serviceMode === "DINE_IN" ? selectedCheck[submission.id] : undefined)
      || (submission.serviceMode === "DINE_IN" && !confirmedTable[submission.id])
      || (checked.priceChanged && !confirmedPrice[submission.id]))) {
      setError(isEnglish ? "Review the current quote, confirm the guest's table and any price change first."
        : "ตรวจราคาล่าสุด ยืนยันโต๊ะกับลูกค้า และยืนยันราคาใหม่ก่อนรับคำขอ");
      return;
    }
    setBusy(true); setError("");
    try {
      await request("/api/pos/restaurant/kiosk", { method: "POST", body: JSON.stringify(auth({
        action, submissionId: submission.id, checkId: selectedCheck[submission.id] || null,
        reason: reason[submission.id]?.trim() || "",
        quoteFingerprint: checked?.quote.fingerprint,
        confirmedPriceChange: confirmedPrice[submission.id] === true,
        confirmedTable: confirmedTable[submission.id] === true,
        expectedCheckVersion: checked?.check?.version,
        expectedTableId: checked?.check?.tableId,
        expectedCheckOpenedAt: checked?.check?.openedAt,
      })) });
      await reload();
      if (searchResults) await lookup();
      if (action === "accept") await onAccepted();
      setPreviews((current) => { const next = { ...current }; delete next[submission.id]; return next; });
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : t("pos_restaurant.kiosk_failed")} ${isEnglish ? "Check this request code before entering it manually." : "ตรวจรหัสคำขอนี้ก่อนคีย์รายการใหม่"}`); }
    finally { setBusy(false); }
  }
  return <section style={{ padding: 24, maxWidth: 1200, margin: "auto" }}>
    <h2>{t("pos_restaurant.kiosk_title")}</h2>
    <p>{t("pos_restaurant.kiosk_subtitle")}</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <button type="button" disabled={busy || !operatorReady || !shiftOpen || active} onClick={() => void manage("issue")}>{t("pos_restaurant.kiosk_issue")}</button>
      <button type="button" disabled={busy || !operatorReady || !shiftOpen || !active} onClick={() => void manage("rotate")}>{t("pos_restaurant.kiosk_rotate")}</button>
      <button type="button" disabled={busy || !operatorReady || !shiftOpen || !active} onClick={() => void manage("disable")}>{t("pos_restaurant.kiosk_disable")}</button>
      <button type="button" onClick={() => void reload()}>{t("pos_restaurant.kiosk_refresh")}</button>
    </div>
    {url && <div style={{ padding: 16, background: "#ecfdf5", marginBottom: 16, overflowWrap: "anywhere" }}>
      <b>{t("pos_restaurant.kiosk_url_once")}</b><p>{url}</p>
      <button type="button" onClick={() => void navigator.clipboard.writeText(url)}>{t("pos_restaurant.kiosk_copy")}</button>
    </div>}
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void lookup(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <label>{isEnglish ? "Customer request code" : "รหัสคำขอที่ลูกค้าเห็น"}
        <input value={requestCode} onChange={(event) => setRequestCode(event.target.value)}
          placeholder={isEnglish ? "Enter at least 8 characters" : "กรอกอย่างน้อย 8 ตัว"}
          autoComplete="off" style={{ display: "block", padding: 10, minWidth: 240 }} />
      </label>
      <button type="submit" disabled={busy}>{isEnglish ? "Find request" : "ค้นหาคำขอ"}</button>
      {searchResults && <button type="button" onClick={() => { setSearchResults(null); setRequestCode(""); }}>{isEnglish ? "Show recent" : "แสดงล่าสุด"}</button>}
    </form>
    {!shown.length && <p>{searchResults ? (isEnglish ? "No request with this code in this branch" : "ไม่พบรหัสคำขอในสาขานี้") : t("pos_restaurant.kiosk_empty")}</p>}
    <div style={{ display: "grid", gap: 16 }}>
      {shown.map((submission) => <article key={submission.id} style={{ background: "white", border: "1px solid #d4dfd5", borderRadius: 14, padding: 20 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <strong>{submission.id.slice(0, 8).toUpperCase()} · {t(submission.serviceMode === "DINE_IN" ? "pos_restaurant.kiosk_dine_in" : "pos_restaurant.kiosk_takeaway")}</strong>
          <span>{t(submission.status === "PENDING" ? "pos_restaurant.qr_pending"
            : submission.status === "ACCEPTED" ? "pos_restaurant.qr_accepted"
            : submission.status === "EXPIRED" ? "pos_restaurant.kiosk_expired"
            : "pos_restaurant.qr_rejected")}</span>
        </header>
        <small>{new Date(submission.submittedAt).toLocaleString()}</small>
        <small style={{ display: "block", overflowWrap: "anywhere" }}>{isEnglish ? "Full request ID" : "รหัสคำขอเต็ม"}: {submission.id}</small>
        {submission.checkId && <div style={{ padding: 12, marginTop: 10, background: "#eef6ff", overflowWrap: "anywhere" }}>
          <b>{isEnglish ? "Linked POS bill" : "บิล POS ที่ผูกกับคำขอ"}</b>
          <p>{isEnglish ? "Request" : "รหัสคำขอ"} {submission.id.slice(0, 8).toUpperCase()} → {isEnglish ? "check" : "บิล"} {submission.checkId.slice(0, 8).toUpperCase()} · {submission.checkStatus}</p>
          {submission.tableCode && <p>{submission.areaName} · {submission.tableCode} {submission.tableName} · {isEnglish ? "bill" : "บิล"} {submission.splitGroupNo}</p>}
          {submission.acceptedOrderId && <p>{isEnglish ? "Order created at acceptance" : "ออเดอร์ตอนรับคำขอ"} {submission.acceptedOrderId.slice(0, 8).toUpperCase()}</p>}
          {submission.orderId && submission.orderId !== submission.acceptedOrderId &&
            <p>{isEnglish ? "Current bill order" : "ออเดอร์ปัจจุบันของบิล"} {submission.orderId.slice(0, 8).toUpperCase()}</p>}
          <button type="button" disabled={busy} onClick={() => void onOpenCheck(submission.checkId!)}>{isEnglish ? "Open this bill in POS" : "เปิดบิลนี้ใน POS"}</button>
        </div>}
        <ul>{submission.items.map((item, index) => <li key={`${item.sku}:${index}`}>
          {item.packQty} × {item.productName}{item.size ? ` · ${item.size}` : ""}
          {item.modifierCodes?.length ? ` · ${item.modifierCodes.join(", ")}` : ""}
          {item.kitchenNote ? ` · ${item.kitchenNote}` : ""}
        </li>)}</ul>
        {submission.rejectionReason && <p>{submission.rejectionReason}</p>}
        {submission.status === "PENDING" && <div style={{ display: "grid", gap: 12 }}>
          {submission.serviceMode === "DINE_IN" && <label>{t("pos_restaurant.kiosk_select_check")}
            <select value={selectedCheck[submission.id] || ""} onChange={(event) => {
              setSelectedCheck((current) => ({ ...current, [submission.id]: event.target.value }));
              setPreviews((current) => { const next = { ...current }; delete next[submission.id]; return next; });
            }} style={{ display: "block", padding: 12, minWidth: 260, maxWidth: "100%" }}>
              <option value="">{t("pos_restaurant.kiosk_choose_table")}</option>
              {checks.map((check) => <option key={check.id} value={check.id}>{check.label}</option>)}
            </select>
          </label>}
          <button type="button" disabled={busy || !operatorReady || !shiftOpen} onClick={() => void preview(submission)}>
            {isEnglish ? "Review latest server price and bill" : "ตรวจราคาและบิลล่าสุดจาก server"}
          </button>
          {previews[submission.id] && <div style={{ padding: 14, background: "#f8fafc", borderRadius: 8 }}>
            <strong>{isEnglish ? "Server quote before promotion, VAT and discounts" : "ยอดตรวจล่าสุดก่อนโปรโมชัน VAT และส่วนลด"}: ฿{previews[submission.id].quote.total.toFixed(2)}</strong>
            <ul>{previews[submission.id].quote.lines.map((line, index) => <li key={`${line.sku}:${index}`}>
              {line.packQty} × {line.productName} · {line.size} · {line.modifiers.map((modifier) => modifier.name).join(", ")} · ฿{line.lineAmount.toFixed(2)}
              <small style={{ display: "block" }}>{isEnglish ? "At submission" : "ตอนลูกค้าส่ง"}: ฿{Number(previews[submission.id].submittedLines[index]?.lineAmount ?? 0).toFixed(2)}</small>
            </li>)}</ul>
            {previews[submission.id].priceChanged && <label style={{ display: "block", color: "#9a3412" }}>
              <input type="checkbox" checked={confirmedPrice[submission.id] === true} onChange={(event) => setConfirmedPrice((current) => ({ ...current, [submission.id]: event.target.checked }))} />
              {isEnglish ? "I confirmed the changed menu, options or price with the customer" : "ฉันยืนยันเมนู ตัวเลือก หรือราคาที่เปลี่ยนกับลูกค้าแล้ว"}
            </label>}
            {previews[submission.id].check && <div>
              <p>{isEnglish ? "Selected table and bill" : "โต๊ะและบิลที่เลือก"}: {previews[submission.id].check!.areaName} · {previews[submission.id].check!.tableCode} {previews[submission.id].check!.tableName} · {isEnglish ? "bill" : "บิล"} {previews[submission.id].check!.splitGroupNo} · {previews[submission.id].check!.id.slice(0, 8).toUpperCase()}</p>
              <label><input type="checkbox" checked={confirmedTable[submission.id] === true} onChange={(event) => setConfirmedTable((current) => ({ ...current, [submission.id]: event.target.checked }))} />
                {isEnglish ? "I confirmed this guest is at this table and on this bill" : "ฉันยืนยันว่าลูกค้าอยู่โต๊ะและบิลนี้จริง"}
              </label>
            </div>}
            <p>{isEnglish ? "Accepting sends the food to the kitchen. Take payment in the POS; the request code is not a pickup number." : "กดรับแล้วส่งครัวทันที รับเงินผ่าน POS รหัสคำขอไม่ใช่เลขรับอาหาร"}</p>
          </div>}
          <label>{t("pos_restaurant.kiosk_reject_reason")}
            <textarea value={reason[submission.id] || ""} maxLength={300} onChange={(event) => setReason((current) => ({ ...current, [submission.id]: event.target.value }))} style={{ display: "block", width: "100%", minHeight: 65 }} />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" disabled={busy || !operatorReady || !shiftOpen} onClick={() => void review(submission, "accept")}>{t("pos_restaurant.kiosk_accept")}</button>
            <button type="button" disabled={busy || !operatorReady || !shiftOpen} onClick={() => void review(submission, "reject")}>{t("pos_restaurant.kiosk_reject")}</button>
          </div>
        </div>}
      </article>)}
    </div>
  </section>;
}
