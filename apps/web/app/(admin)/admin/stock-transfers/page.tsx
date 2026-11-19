"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
// โอนย้ายสต็อกระหว่างสาขา (7.98)
// -------------------------------------------------------------
// หน้าจอของงานสองขั้น: สาขาต้นทางกด "ส่ง" (ตัดสต็อกทันที) แล้วสาขาปลายทาง
// กด "รับ" เมื่อของถึงจริง · ระหว่างนั้นของอยู่สถานะ IN_TRANSIT คือไม่ได้อยู่ใน
// สต็อกของสาขาไหนเลย ซึ่งตรงกับความจริงว่ามันอยู่บนรถ
//
// จุดสำคัญที่สุดของหน้านี้คือช่อง "รับจริงกี่ชิ้น" ตอนกดรับ — ค่า default เท่ากับ
// ที่ส่งมา แต่แก้ได้ ส่วนต่างจะถูกบันทึกเป็นของขาดระหว่างทางที่ต้นทาง ไม่ใช่หาย
// เงียบ ๆ จากผลต่างของสองสาขา
//
// ใช้ REST (/api/bms/inventory/transfers) ไม่ใช่ GraphQL — ดูเหตุผลใน
// docs/business/inventory.md § ทำไมโมดูลนี้เป็น REST
import {
  Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Select, Space, Table, Tag, Typography, message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader, { ResponsiveStatusFilter } from "@/components/admin/AdminPageHeader";

type TransferStatus = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
type Filter = "ALL" | TransferStatus;

type TransferItem = {
  id: number;
  sku: string;
  productName: string | null;
  size: string;
  qty: number;
  receivedQty: number | null;
  damagedQty: number;
  missingQty: number | null;
  discrepancyReason: string | null;
  discrepancyNote: string | null;
};

type Transfer = {
  id: string;
  transferNo: string;
  fromLocationId: string;
  fromLocationName: string | null;
  toLocationId: string;
  toLocationName: string | null;
  status: TransferStatus;
  note: string | null;
  receivingNote: string | null;
  createdByName: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: TransferItem[];
};

type Location = { id: string; code: string; name: string; active: boolean };
type PendingCommand = { payload: Record<string, unknown>; idempotencyKey: string };
const pendingStorageKey = (scope: string) => `bms:stock-transfer:pending:${scope}`;

const FILTERS: readonly Filter[] = ["ALL", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

const STATUS_LABEL = (uiText: UiTranslator = thaiUiText): Record<TransferStatus, string> => ({
  DRAFT: uiText("admin_ui.draft_d1f1d"),
  IN_TRANSIT: uiText("admin_ui.in_transit_c4409"),
  RECEIVED: uiText("admin_ui.accepted_65451"),
  CANCELLED: uiText("admin_ui.cancelled_fba6e"),
});

const STATUS_COLOR: Record<TransferStatus, string> = {
  DRAFT: "default",
  IN_TRANSIT: "processing",
  RECEIVED: "success",
  CANCELLED: "error",
};

const REASON_LABELS = (uiText: UiTranslator = thaiUiText): Record<string, string> => ({
  LOST_IN_TRANSIT: uiText("admin_ui.lost_in_transit_82b6e"),
  SOURCE_SHORT_SHIP: uiText("admin_ui.short_shipment_from_source_73dc1"),
  COUNT_ERROR: uiText("admin_ui.count_mismatch_93e0e"),
  DAMAGED: uiText("admin_ui.damaged_in_transit_17358"),
  OTHER: uiText("admin_ui.other_b38f6"),
  LEGACY_SHORT_RECEIPT: uiText("admin_ui.legacy_entry_with_no_recorded_reason_2ae14"),
});

const fmtTime = (iso: string | null, uiText: UiTranslator = thaiUiText) =>
  iso ? new Date(iso).toLocaleString(uiText.locale, { dateStyle: "short", timeStyle: "short" }) : "—";

/** แปลผลลัพธ์จาก API เป็นประโยคที่คนหน้างานอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
function explain(body: any, uiText: UiTranslator = thaiUiText): string {
  switch (body?.status) {
    case "FORBIDDEN":
      return uiText("admin_ui.you_do_not_have_permission_to_operate_at_f1f24");
    case "CONFLICT":
      return body.reason ?? uiText("admin_ui.the_previous_request_has_different_data_check_the_b390b");
    case "INVALID":
      return body.reason ?? uiText("admin_ui.invalid_data_9c4d0");
    case "NOT_FOUND":
      return uiText("admin_ui.transfer_not_found_4a612");
    case "WRONG_STATE":
      return uiText("admin_ui.this_transfer_is_already_this_action_is_unavailable_72d04", { v0: STATUS_LABEL(uiText)[body.current as TransferStatus] ?? body.current });
    case "INSUFFICIENT":
      return uiText("admin_ui.size_only_units_can_be_transferred_requested_customer_9ab1a", { v0: body.sku, v1: body.size, v2: body.available, v3: body.requested });
    default:
      return body?.error ?? uiText("admin_ui.could_not_complete_this_action_1af08");
  }
}

export default function StockTransfersPage() {
  const uiText = useUiText();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canUse = can("inventory.transfer");

  const [rows, setRows] = useState<Transfer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [linkedId,setLinkedId] = useState<string | null>(null);
  const [expandedKeys,setExpandedKeys] = useState<React.Key[]>([]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get("id");
    if(id){setLinkedId(id);setExpandedKeys([id]);}
  },[]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadVersion = useRef(0);
  const scopeRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingCommand | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [receivedQty, setReceivedQty] = useState<Record<number, number>>({});
  const [damagedQty, setDamagedQty] = useState<Record<number, number>>({});
  const [discrepancyReason, setDiscrepancyReason] = useState<Record<number, string>>({});
  const [discrepancyNote, setDiscrepancyNote] = useState<Record<number, string>>({});
  const [receivingNote, setReceivingNote] = useState("");

  const load = useCallback(async () => {
    if (busyRef.current) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const params=new URLSearchParams();
      if(filter!=="ALL") params.set("status",filter);
      if(linkedId) params.set("id",linkedId);
      const qs = params.size ? `?${params}` : "";
      const res = await fetch(`/api/bms/inventory/transfers${qs}`, { cache: "no-store" });
      if (version !== loadVersion.current) return;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) setReady(false);
        throw new Error(res.status === 403 ? uiText("admin_ui.you_do_not_have_permission_to_view_transfers_8f7bd") : uiText("admin_ui.could_not_load_the_list_56c99"));
      }
      const body = await res.json();
      if (version !== loadVersion.current) return;
      if (typeof body.commandScope !== "string") throw new Error(uiText("admin_ui.could_not_load_user_context_b912a"));
      if (scopeRef.current !== body.commandScope) {
        setReady(false);
        const saved = sessionStorage.getItem(pendingStorageKey(body.commandScope));
        const restored = saved ? JSON.parse(saved) as PendingCommand : null;
        if (restored && (!restored.payload || typeof restored.idempotencyKey !== "string"))
          throw new Error(uiText("admin_ui.invalid_pending_request_data_contact_an_administrator_b2852"));
        setCreateOpen(false); setReceiving(null); form.resetFields();
        scopeRef.current = body.commandScope;
        pendingRef.current = restored;
        setPending(restored);
      }
      setRows(body.transfers ?? []);
      setLocations(body.locations ?? []);
      setReady(true);
    } catch (e: any) {
      if (version === loadVersion.current) message.error(e?.message ?? uiText("admin_ui.could_not_load_the_list_56c99"));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [uiText, filter,linkedId,form]);

  useEffect(() => {
    if (canUse) void load();
  }, [canUse, load]);

  async function post(payload: Record<string, unknown>, retry = false): Promise<boolean> {
    if (busyRef.current || !scopeRef.current || !ready) return false;
    if (pendingRef.current && !retry) {
      message.warning(uiText("admin_ui.check_the_previous_request_s_outcome_before_starting_25ab5"));
      return false;
    }
    busyRef.current = true;
    const commandScope = scopeRef.current;
    ++loadVersion.current; // An earlier GET must not replace an in-flight command.
    setLoading(false);
    setBusy(true);
    try {
      const command = pendingRef.current ?? { payload, idempotencyKey: crypto.randomUUID() };
      // Persist before I/O; retry after a reload keeps the exact same payload/key.
      try {
        sessionStorage.setItem(pendingStorageKey(commandScope), JSON.stringify(command));
      } catch {
        message.error(uiText("admin_ui.the_browser_could_not_save_the_request_so_731c9"));
        return false;
      }
      pendingRef.current = command;
      setPending(command);
      const res = await fetch("/api/bms/inventory/transfers", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command.payload, idempotencyKey: command.idempotencyKey, commandScope }),
      });
      const body = await res.json();
      const success = res.ok && (body.status === "OK" || body.status === "CREATED");
      const rejected = !res.ok && [400, 404, 409].includes(res.status) &&
        ["INVALID", "NOT_FOUND", "WRONG_STATE", "INSUFFICIENT"].includes(body.status);
      if (success || rejected) {
        sessionStorage.removeItem(pendingStorageKey(commandScope));
        pendingRef.current = null;
        setPending(null);
      }
      if (!success && !rejected) {
        if ([401, 403].includes(res.status) || body.status === "SCOPE_CHANGED") setReady(false);
        message.warning(body.status === "SCOPE_CHANGED" ? body.reason : uiText("admin_ui.the_outcome_is_still_unconfirmed_check_the_previous_f7460"));
        setCreateOpen(false); setReceiving(null);
        return false;
      }
      if (!res.ok) {
        message.error(explain(body, uiText));
        return false;
      }
      return true;
    } catch {
      message.error(uiText("admin_ui.outcome_unconfirmed_check_the_previous_request_before_starting_13971"));
      setCreateOpen(false); setReceiving(null);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function retryPending() {
    if (pendingRef.current && await post(pendingRef.current.payload, true)) {
      message.success(uiText("admin_ui.confirmed_that_the_previous_request_succeeded_5eceb"));
      setCreateOpen(false); setReceiving(null); form.resetFields();
      await load();
    }
  }

  async function create() {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const ok = await post({
      action: "create",
      fromLocationId: values.fromLocationId,
      toLocationId: values.toLocationId,
      note: values.note?.trim() || null,
      items: (values.items ?? []).map((i: any) => ({ sku: i.sku?.trim(), size: i.size?.trim(), qty: i.qty })),
    });
    if (!ok) return;
    message.success(uiText("admin_ui.transfer_created_stock_is_not_deducted_until_dispatch_0a26b"));
    setCreateOpen(false);
    form.resetFields();
    await load();
  }

  async function send(t: Transfer) {
    if (await post({ action: "send", transferId: t.id })) {
      message.success(uiText("admin_ui.dispatched_stock_deducted_from_119b5", { v0: t.transferNo, v1: t.fromLocationName ?? uiText("admin_ui.source_ff61d") }));
      await load();
    }
  }

  async function cancel(t: Transfer) {
    if (await post({ action: "cancel", transferId: t.id })) {
      message.success(uiText("admin_ui.cancelled_aa598", { v0: t.transferNo }));
      await load();
    }
  }

  function openReceive(t: Transfer) {
    setReceiving(t);
    setReceivedQty(Object.fromEntries(t.items.map((i) => [i.id, i.qty])));
    setDamagedQty(Object.fromEntries(t.items.map((i) => [i.id, 0])));
    setDiscrepancyReason({});
    setDiscrepancyNote({});
    setReceivingNote("");
  }

  async function confirmReceive() {
    if (!receiving) return;
    const ok = await post({
      action: "receive",
      transferId: receiving.id,
      receivingNote: receivingNote.trim() || null,
      received: receiving.items.map((i) => ({
        itemId: i.id,
        qty: receivedQty[i.id] ?? i.qty,
        damagedQty: damagedQty[i.id] ?? 0,
        reason: discrepancyReason[i.id] || null,
        note: discrepancyNote[i.id]?.trim() || null,
      })),
    });
    if (!ok) return;
    const missing = receiving.items.reduce((sum, i) =>
      sum + Math.max(0, i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0)), 0
    );
    const damaged = receiving.items.reduce((sum, i) => sum + (damagedQty[i.id] ?? 0), 0);
    message.success(
      missing > 0
        ? uiText("admin_ui.received_units_missing_08835", { v0: receiving.transferNo, v1: missing, v2: damaged ? uiText("admin_ui.units_quarantined_9ffbb", { v0: damaged }) : "" })
        : damaged > 0
          ? uiText("admin_ui.received_damaged_units_quarantined_c293c", { v0: receiving.transferNo, v1: damaged })
        : uiText("admin_ui.received_all_units_dispatched_in_12479", { v0: receiving.transferNo })
    );
    setReceiving(null);
    await load();
  }

  if (!permsLoading && !canUse) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_this_37784")} />;
  }

  const activeLocations = locations.filter((l) => l.active);
  const accessible = new Set(locations.map(l => l.id));
  const blocked = busy || !!pending || !ready;
  const missingOnReceive = receiving
    ? receiving.items.reduce((sum, i) =>
        sum + Math.max(0, i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0)), 0
      )
    : 0;
  const damagedOnReceive = receiving
    ? receiving.items.reduce((sum, i) => sum + (damagedQty[i.id] ?? 0), 0)
    : 0;
  const invalidDiscrepancy = Boolean(receiving?.items.some((item) => {
    const missing = Math.max(0,
      item.qty - (receivedQty[item.id] ?? item.qty) - (damagedQty[item.id] ?? 0)
    );
    return (missing > 0 || (damagedQty[item.id] ?? 0) > 0)
      && (!discrepancyReason[item.id] || !discrepancyNote[item.id]?.trim());
  }));

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {pending && <Card title={uiText("admin_ui.a_request_still_needs_its_outcome_confirmed_3a4c4")} size="small">
        <Space direction="vertical" style={{ width: "100%", overflowWrap: "anywhere" }}>
          <span>{({ create: uiText("admin_ui.create_transfer_49241"), send: uiText("admin_ui.dispatch_42a83"), receive: uiText("admin_ui.receive_243d3"), cancel: uiText("admin_ui.cancel_transfer_ef145") } as Record<string,string>)[String(pending.payload.action)]}
            {pending.payload.transferId ? ` · ${rows.find(r => r.id === pending.payload.transferId)?.transferNo ?? pending.payload.transferId}` : ""}
            {pending.payload.fromLocationId ? ` · ${locations.find(l => l.id === pending.payload.fromLocationId)?.name ?? uiText("admin_ui.source_ff61d")} → ${locations.find(l => l.id === pending.payload.toLocationId)?.name ?? uiText("admin_ui.destination_7c0d1")}` : ""}
          </span>
          {Array.isArray(pending.payload.items) && pending.payload.items.map((item: any, index: number) =>
            <span key={index}>{item.sku} · {item.size} · {item.qty}  {uiText("admin_ui.piece_408d4")}</span>)}
          {Array.isArray(pending.payload.received) && pending.payload.received.map((item: any) => {
            const line = rows.find(r => r.id === pending.payload.transferId)?.items.find(i => i.id === item.itemId);
            return <span key={item.itemId}>{line ? `${line.sku} · ${line.size}` : uiText("admin_ui.items_15d66", { v0: item.itemId })}  {uiText("admin_ui.good_units_received_b0454")} {item.qty}  {uiText("admin_ui.damaged_92c5a")} {item.damagedQty ?? 0}{item.note ? ` · ${item.note}` : ""}</span>;
          })}
          {(pending.payload.note || pending.payload.receivingNote) ? <span>{uiText("admin_ui.note_5d8f3")} {String(pending.payload.note || pending.payload.receivingNote)}</span> : null}
          <span>{uiText("admin_ui.the_system_retains_the_original_request_even_after_d0cd8")}</span>
          <span>{uiText("admin_ui.check_the_original_request_to_prevent_duplicate_stock_c3b3c")}</span>
          <Button onClick={() => void retryPending()} loading={busy} disabled={!ready}>{uiText("admin_ui.check_previous_request_65b85")}</Button>
        </Space></Card>}
      {linkedId && <Button disabled={busy} onClick={()=>{setLinkedId(null);setExpandedKeys([]);}}>{uiText("admin_ui.show_all_documents_3f321")}</Button>}
      <AdminPageHeader title={uiText("admin_ui.stock_transfers_between_branches_f39a1")}>
        <ResponsiveStatusFilter<Filter>
          options={FILTERS}
          value={filter}
          onChange={(value) => { if (!busyRef.current) setFilter(value); }}
          labels={{ ALL: uiText("admin_ui.all_56eff"), ...STATUS_LABEL(uiText) }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} disabled={busy}>
          {uiText("admin_ui.refresh_78a47")}</Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={activeLocations.length < 2 || blocked}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ items: [{ sku: "", size: "", qty: 1 }] });
            setCreateOpen(true);
          }}
        >
          {uiText("admin_ui.create_transfer_49241")}</Button>
      </AdminPageHeader>

      {activeLocations.length < 2 && !loading && (
        <Alert closable
          type="warning"
          showIcon
          message={uiText("admin_ui.you_have_access_to_fewer_than_2_active_bd87d")}
          description={uiText("admin_ui.creating_a_transfer_requires_access_to_both_source_27499")}
        />
      )}

      <Alert closable
        type="info"
        showIcon
        message={uiText("admin_ui.dispatched_goods_that_have_not_arrived_are_not_eae3a")}
        description={uiText("admin_ui.dispatch_deducts_stock_from_the_source_immediately_receive_11486")}
      />

      <Card>
        <Table<Transfer>
          rowKey="id"
          scroll={{ x: 1000 }}
          size="small"
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: <Empty description={uiText("admin_ui.no_transfers_yet_394a3")} /> }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          expandable={{
            expandedRowKeys:expandedKeys,
            onExpandedRowsChange:(keys)=>setExpandedKeys([...keys]),
            expandedRowRender: (t) => (
              <Table<TransferItem>
                rowKey="id"
                scroll={{ x: 1000 }}
                size="small"
                dataSource={t.items}
                pagination={false}
                title={t.receivingNote ? () => (
                  <Typography.Text type="secondary">{uiText("admin_ui.receiving_note_67930")} {t.receivingNote}</Typography.Text>
                ) : undefined}
                columns={[
                  { title: "SKU", dataIndex: "sku", width: 160 },
                  {
                    title: uiText("admin_ui.product_8432c"),
                    dataIndex: "productName",
                    render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                  },
                  { title: uiText("admin_ui.size_ff4b6"), dataIndex: "size", width: 90 },
                  { title: uiText("admin_ui.ship_d6ace"), dataIndex: "qty", width: 80 },
                  {
                    title: uiText("admin_ui.receives_for_real_08dfd"),
                    dataIndex: "receivedQty",
                    width: 110,
                    render: (v: number | null, i) =>
                      v == null ? (
                        <span style={{ color: "#999" }}>—</span>
                      ) : v < i.qty ? (
                        <Tag color="red">{v}  {uiText("admin_ui.short_fd47b")} {i.qty - v})</Tag>
                      ) : (
                        <Tag color="green">{v}</Tag>
                      ),
                  },
                  {
                    title: uiText("admin_ui.damaged_6ed5f"), dataIndex: "damagedQty", width: 90,
                    render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : "0",
                  },
                  {
                    title: uiText("admin_ui.missing_77bc6"), dataIndex: "missingQty", width: 90,
                    render: (value: number | null) => value && value > 0 ? <Tag color="volcano">{value}</Tag> : value ?? "—",
                  },
                  {
                    title: uiText("admin_ui.reason_note_7999d"), width: 260,
                    render: (_: unknown, item) => item.discrepancyReason
                      ? `${REASON_LABELS(uiText)[item.discrepancyReason] ?? item.discrepancyReason}${item.discrepancyNote ? ` · ${item.discrepancyNote}` : ""}`
                      : "—",
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: uiText("admin_ui.document_no_7e315"), dataIndex: "transferNo", width: 150 },
            {
              title: uiText("admin_ui.from_to_ef131"),
              render: (_: unknown, t) => (
                <span>
                  {t.fromLocationName ?? "—"} <b>→</b> {t.toLocationName ?? "—"}
                </span>
              ),
            },
            {
              title: uiText("admin_ui.status_2e8c4"),
              dataIndex: "status",
              width: 140,
              render: (s: TransferStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL(uiText)[s]}</Tag>,
            },
            {
              title: uiText("admin_ui.item_51c19"),
              width: 110,
              render: (_: unknown, t) => uiText("admin_ui.items_d57ca", { v0: t.items.length }),
            },
            { title: uiText("admin_ui.created_by_bafce"), dataIndex: "createdByName", width: 150, render: (v: string | null) => v ?? "—" },
            { title: uiText("admin_ui.created_5b68f"), width: 150, render: (_: unknown, t) => fmtTime(t.createdAt, uiText) },
            {
              title: "",
              width: 190,
              render: (_: unknown, t) => (
                <Space>
                  {t.status === "DRAFT" && accessible.has(t.fromLocationId) && (
                    <Popconfirm
                      title={uiText("admin_ui.dispatch_09725", { v0: t.transferNo })}
                      description={uiText("admin_ui.source_stock_will_be_deducted_immediately_and_this_647ab")}
                      okText={uiText("admin_ui.ship_d6ace")}
                      cancelText={uiText("admin_ui.don_t_send_yet_a98d8")}
                      onConfirm={() => void send(t)}
                    >
                      <Button size="small" type="primary" loading={busy} disabled={blocked}>{uiText("admin_ui.dispatch_42a83")}</Button>
                    </Popconfirm>
                  )}
                  {t.status === "DRAFT" && accessible.has(t.fromLocationId) && (
                    <Popconfirm
                      title={uiText("admin_ui.cancel_4e47c", { v0: t.transferNo })}
                      okText={uiText("admin_ui.cancel_transfer_ef145")}
                      cancelText={uiText("admin_ui.no_d73fb")}
                      onConfirm={() => void cancel(t)}
                    >
                      <Button size="small" danger disabled={blocked}>{uiText("admin_ui.cancelled_fba6e")}</Button>
                    </Popconfirm>
                  )}
                  {t.status === "IN_TRANSIT" && accessible.has(t.toLocationId) && (
                    <Button size="small" type="primary" disabled={blocked} onClick={() => openReceive(t)}>
                      {uiText("admin_ui.receive_243d3")}</Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title={uiText("admin_ui.create_transfer_49241")}
        onCancel={() => { if (!busyRef.current) setCreateOpen(false); }}
        onOk={() => void create()}
        confirmLoading={busy}
        okButtonProps={{ disabled: blocked }}
        okText={uiText("admin_ui.create_no_stock_deduction_yet_4e9be")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
        width={720}
      >
        <Form form={form} layout="vertical" disabled={busy}>
          <Space style={{ width: "100%" }} size="middle" wrap>
            <Form.Item
              name="fromLocationId"
              label={uiText("admin_ui.sending_branch_90a4e")}
              rules={[{ required: true, message: uiText("admin_ui.select_a_source_57fc9") }]}
              style={{ minWidth: 260 }}
            >
              <Select
                placeholder={uiText("admin_ui.select_branch_1bfe8")}
                options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
              />
            </Form.Item>
            <Form.Item
              name="toLocationId"
              label={uiText("admin_ui.destination_branch_e8620")}
              dependencies={["fromLocationId"]}
              rules={[
                { required: true, message: uiText("admin_ui.select_a_destination_1c004") },
                ({ getFieldValue }) => ({
                  validator: (_, v) =>
                    v && v === getFieldValue("fromLocationId")
                      ? Promise.reject(new Error(uiText("admin_ui.must_differ_from_the_source_356fe")))
                      : Promise.resolve(),
                }),
              ]}
              style={{ minWidth: 260 }}
            >
              <Select
                placeholder={uiText("admin_ui.select_branch_1bfe8")}
                options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
              />
            </Form.Item>
          </Space>

          <Form.Item name="note" label={uiText("admin_ui.note_06591")} extra={uiText("admin_ui.e_g_delivery_run_or_reason_for_the_d71cc")}>
            <Input placeholder={uiText("admin_ui.optional_e39a0")} />
          </Form.Item>

          <Typography.Text strong>{uiText("admin_ui.transfer_items_219de")}</Typography.Text>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap style={{ display: "flex", marginBottom: 4 }}>
                    <Form.Item
                      name={[field.name, "sku"]}
                      rules={[{ required: true, message: uiText("admin_ui.enter_a_sku_09104") }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="SKU" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "size"]}
                      rules={[{ required: true, message: uiText("admin_ui.enter_a_size_f6257") }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder={uiText("admin_ui.size_ff4b6")} style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "qty"]}
                      rules={[{ required: true, message: uiText("admin_ui.enter_a_quantity_10971") }]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} precision={0} placeholder={uiText("admin_ui.quantity_6681e")} style={{ width: 110 }} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    )}
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ sku: "", size: "", qty: 1 })}>
                  {uiText("admin_ui.add_item_72c2f")}</Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={!!receiving}
        title={uiText("admin_ui.receive_goods_9182c", { v0: receiving?.transferNo ?? "" })}
        onCancel={() => { if (!busyRef.current) setReceiving(null); }}
        onOk={() => void confirmReceive()}
        confirmLoading={busy}
        okButtonProps={{ disabled: invalidDiscrepancy || blocked }}
        okText={uiText("admin_ui.confirm_receipt_72635")}
        cancelText={uiText("admin_ui.not_received_yet_55c89")}
        width={720}
      >
        {receiving && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={uiText("admin_ui.of_16b68")}>{receiving.fromLocationName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.to_ed56a")}>{receiving.toLocationName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.dispatched_at_189d9")}>{fmtTime(receiving.sentAt, uiText)}</Descriptions.Item>
            </Descriptions>

            <Alert closable
              type={missingOnReceive > 0 || damagedOnReceive > 0 ? "warning" : "info"}
              showIcon
              message={
                missingOnReceive > 0 || damagedOnReceive > 0
                  ? uiText("admin_ui.units_missing_units_damaged_39c6e", { v0: missingOnReceive, v1: damagedOnReceive })
                  : uiText("admin_ui.count_the_actual_goods_before_confirming_83b75")
              }
              description={
                missingOnReceive > 0 || damagedOnReceive > 0
                  ? uiText("admin_ui.good_units_enter_sellable_stock_damaged_units_enter_2b421")
                  : uiText("admin_ui.defaults_to_receiving_all_units_in_good_condition_6b447")
              }
            />

            <Table<TransferItem>
              rowKey="id"
              size="small"
              dataSource={receiving.items}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "SKU", dataIndex: "sku", width: 170 },
                {
                  title: uiText("admin_ui.product_8432c"),
                  dataIndex: "productName",
                  render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                },
                { title: uiText("admin_ui.size_ff4b6"), dataIndex: "size", width: 80 },
                { title: uiText("admin_ui.dispatched_f55e7"), dataIndex: "qty", width: 75 },
                {
                  title: uiText("admin_ui.good_units_received_a0797"),
                  width: 120,
                  render: (_: unknown, i) => (
                    <InputNumber
                      min={0}
                      disabled={busy}
                      max={Math.max(0, i.qty - (damagedQty[i.id] ?? 0))}
                      precision={0}
                      value={receivedQty[i.id] ?? i.qty}
                      onChange={(v) => setReceivedQty((prev) => ({ ...prev, [i.id]: Number(v ?? 0) }))}
                      style={{ width: "100%" }}
                    />
                  ),
                },
                {
                  title: uiText("admin_ui.damaged_quarantined_ebbd8"), width: 130,
                  render: (_: unknown, i) => (
                    <InputNumber
                      min={0}
                      disabled={busy}
                      max={Math.max(0, i.qty - (receivedQty[i.id] ?? i.qty))}
                      precision={0}
                      value={damagedQty[i.id] ?? 0}
                      onChange={(value) => setDamagedQty((prev) => ({
                        ...prev, [i.id]: Number(value ?? 0),
                      }))}
                      style={{ width: "100%" }}
                    />
                  ),
                },
                {
                  title: uiText("admin_ui.missing_77bc6"), width: 80,
                  render: (_: unknown, i) => (
                    <Typography.Text strong type={
                      i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0) > 0
                        ? "danger" : undefined
                    }>
                      {Math.max(0, i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0))}
                    </Typography.Text>
                  ),
                },
                {
                  title: uiText("admin_ui.reason_d3661"), width: 180,
                  render: (_: unknown, i) => {
                    const hasDifference = (damagedQty[i.id] ?? 0) > 0
                      || i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0) > 0;
                    return (
                      <Select
                        disabled={busy || !hasDifference}
                        value={discrepancyReason[i.id]}
                        placeholder={uiText("admin_ui.select_a_reason_a3246")}
                        style={{ width: "100%" }}
                        options={Object.entries(REASON_LABELS(uiText))
                          .filter(([value]) => value !== "LEGACY_SHORT_RECEIPT")
                          .map(([value, label]) => ({ value, label }))}
                        onChange={(value) => setDiscrepancyReason((prev) => ({ ...prev, [i.id]: value }))}
                      />
                    );
                  },
                },
                {
                  title: uiText("admin_ui.variance_note_15724"), width: 240,
                  render: (_: unknown, i) => {
                    const hasDifference = (damagedQty[i.id] ?? 0) > 0
                      || i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0) > 0;
                    return (
                      <Input
                        disabled={busy || !hasDifference}
                        value={discrepancyNote[i.id] ?? ""}
                        placeholder={hasDifference ? uiText("admin_ui.required_8d2ce") : uiText("admin_ui.no_variance_3bba7")}
                        onChange={(event) => setDiscrepancyNote((prev) => ({
                          ...prev, [i.id]: event.target.value,
                        }))}
                      />
                    );
                  },
                },
              ]}
            />
            <Input.TextArea
              disabled={busy}
              value={receivingNote}
              onChange={(event) => setReceivingNote(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={uiText("admin_ui.note_for_this_receipt_e_g_wet_box_4f79a")}
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}
