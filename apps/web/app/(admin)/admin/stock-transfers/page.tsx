'use client';
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
import { useCallback, useEffect, useState } from "react";
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

const FILTERS: readonly Filter[] = ["ALL", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

const STATUS_LABEL: Record<TransferStatus, string> = {
  DRAFT: "ร่าง",
  IN_TRANSIT: "อยู่ระหว่างทาง",
  RECEIVED: "รับแล้ว",
  CANCELLED: "ยกเลิก",
};

const STATUS_COLOR: Record<TransferStatus, string> = {
  DRAFT: "default",
  IN_TRANSIT: "processing",
  RECEIVED: "success",
  CANCELLED: "error",
};

const REASON_LABELS: Record<string, string> = {
  LOST_IN_TRANSIT: "สูญหายระหว่างทาง",
  SOURCE_SHORT_SHIP: "ต้นทางส่งไม่ครบ",
  COUNT_ERROR: "จำนวนนับไม่ตรง",
  DAMAGED: "เสียหายระหว่างขนส่ง",
  OTHER: "อื่น ๆ",
  LEGACY_SHORT_RECEIPT: "รายการเก่าที่ไม่ได้เก็บสาเหตุ",
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—";

/** แปลผลลัพธ์จาก API เป็นประโยคที่คนหน้างานอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
function explain(body: any): string {
  switch (body?.status) {
    case "INVALID":
      return body.reason ?? "ข้อมูลไม่ถูกต้อง";
    case "NOT_FOUND":
      return "ไม่พบใบโอนนี้";
    case "WRONG_STATE":
      return `ใบโอนอยู่สถานะ "${STATUS_LABEL[body.current as TransferStatus] ?? body.current}" แล้ว ทำรายการนี้ไม่ได้`;
    case "INSUFFICIENT":
      return `${body.sku} ไซซ์ ${body.size} โอนได้แค่ ${body.available} ชิ้น (สั่งโอน ${body.requested}) — ของที่ลูกค้าจองไว้แล้วโอนออกไม่ได้`;
    default:
      return body?.error ?? "ทำรายการไม่สำเร็จ";
  }
}

export default function StockTransfersPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canUse = can("inventory.transfer");

  const [rows, setRows] = useState<Transfer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [receivedQty, setReceivedQty] = useState<Record<number, number>>({});
  const [damagedQty, setDamagedQty] = useState<Record<number, number>>({});
  const [discrepancyReason, setDiscrepancyReason] = useState<Record<number, string>>({});
  const [discrepancyNote, setDiscrepancyNote] = useState<Record<number, string>>({});
  const [receivingNote, setReceivingNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/bms/inventory/transfers${qs}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "ไม่มีสิทธิ์ดูใบโอน (ต้องมี inventory.transfer)" : "โหลดรายการไม่สำเร็จ");
      }
      const body = await res.json();
      setRows(body.transfers ?? []);
      setLocations(body.locations ?? []);
    } catch (e: any) {
      message.error(e?.message ?? "โหลดรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (canUse) void load();
  }, [canUse, load]);

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/bms/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(explain(body));
        return false;
      }
      return true;
    } catch {
      message.error("เชื่อมต่อไม่ได้");
      return false;
    } finally {
      setBusy(false);
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
    message.success("สร้างใบโอนแล้ว — ยังไม่ตัดสต็อกจนกว่าจะกดส่ง");
    setCreateOpen(false);
    form.resetFields();
    await load();
  }

  async function send(t: Transfer) {
    if (await post({ action: "send", transferId: t.id })) {
      message.success(`ส่ง ${t.transferNo} แล้ว — ตัดสต็อกจาก ${t.fromLocationName ?? "ต้นทาง"} เรียบร้อย`);
      await load();
    }
  }

  async function cancel(t: Transfer) {
    if (await post({ action: "cancel", transferId: t.id })) {
      message.success(`ยกเลิก ${t.transferNo} แล้ว`);
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
        ? `รับ ${receiving.transferNo} แล้ว — ไม่พบ ${missing} ชิ้น${damaged ? ` · กักกัน ${damaged} ชิ้น` : ""}`
        : damaged > 0
          ? `รับ ${receiving.transferNo} แล้ว — กักกันของเสียหาย ${damaged} ชิ้น`
        : `รับ ${receiving.transferNo} ครบตามที่ส่ง`
    );
    setReceiving(null);
    await load();
  }

  if (!permsLoading && !canUse) {
    return <Alert closable type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี inventory.transfer)" />;
  }

  const activeLocations = locations.filter((l) => l.active);
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
      <AdminPageHeader title="โอนย้ายสต็อกระหว่างสาขา">
        <ResponsiveStatusFilter<Filter>
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: "ทั้งหมด", ...STATUS_LABEL }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          รีเฟรช
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={activeLocations.length < 2}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ items: [{ sku: "", size: "", qty: 1 }] });
            setCreateOpen(true);
          }}
        >
          สร้างใบโอน
        </Button>
      </AdminPageHeader>

      {activeLocations.length < 2 && !loading && (
        <Alert closable
          type="warning"
          showIcon
          message="ยังมีสาขาที่เปิดใช้งานไม่ถึง 2 สาขา"
          description="การโอนย้ายต้องมีต้นทางกับปลายทางที่ต่างกัน — เพิ่มสาขาก่อนจึงจะสร้างใบโอนได้"
        />
      )}

      <Alert closable
        type="info"
        showIcon
        message="ของที่ส่งแล้วแต่ยังไม่ถึง ไม่ได้อยู่ในสต็อกของสาขาไหน"
        description="กด “ส่ง” = ตัดสต็อกต้นทางทันที · กด “รับ” = เพิ่มเข้าปลายทางตามจำนวนที่รับจริง · ยกเลิกได้เฉพาะใบที่ยังไม่ส่ง เพราะของที่ออกจากชั้นไปแล้วต้องเดินให้จบด้วยการรับ"
      />

      <Card>
        <Table<Transfer>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: <Empty description="ยังไม่มีใบโอน" /> }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          expandable={{
            expandedRowRender: (t) => (
              <Table<TransferItem>
                rowKey="id"
                size="small"
                dataSource={t.items}
                pagination={false}
                title={t.receivingNote ? () => (
                  <Typography.Text type="secondary">หมายเหตุการรับ: {t.receivingNote}</Typography.Text>
                ) : undefined}
                columns={[
                  { title: "SKU", dataIndex: "sku", width: 160 },
                  {
                    title: "สินค้า",
                    dataIndex: "productName",
                    render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                  },
                  { title: "ไซซ์", dataIndex: "size", width: 90 },
                  { title: "ส่ง", dataIndex: "qty", width: 80 },
                  {
                    title: "รับจริง",
                    dataIndex: "receivedQty",
                    width: 110,
                    render: (v: number | null, i) =>
                      v == null ? (
                        <span style={{ color: "#999" }}>—</span>
                      ) : v < i.qty ? (
                        <Tag color="red">{v} (ขาด {i.qty - v})</Tag>
                      ) : (
                        <Tag color="green">{v}</Tag>
                      ),
                  },
                  {
                    title: "เสียหาย", dataIndex: "damagedQty", width: 90,
                    render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : "0",
                  },
                  {
                    title: "ไม่พบ", dataIndex: "missingQty", width: 90,
                    render: (value: number | null) => value && value > 0 ? <Tag color="volcano">{value}</Tag> : value ?? "—",
                  },
                  {
                    title: "สาเหตุ / หมายเหตุ", width: 260,
                    render: (_: unknown, item) => item.discrepancyReason
                      ? `${REASON_LABELS[item.discrepancyReason] ?? item.discrepancyReason}${item.discrepancyNote ? ` · ${item.discrepancyNote}` : ""}`
                      : "—",
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: "เลขที่", dataIndex: "transferNo", width: 150 },
            {
              title: "จาก → ไป",
              render: (_: unknown, t) => (
                <span>
                  {t.fromLocationName ?? "—"} <b>→</b> {t.toLocationName ?? "—"}
                </span>
              ),
            },
            {
              title: "สถานะ",
              dataIndex: "status",
              width: 140,
              render: (s: TransferStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
            },
            {
              title: "รายการ",
              width: 110,
              render: (_: unknown, t) => `${t.items.length} รายการ`,
            },
            { title: "สร้างโดย", dataIndex: "createdByName", width: 150, render: (v: string | null) => v ?? "—" },
            { title: "สร้างเมื่อ", width: 150, render: (_: unknown, t) => fmtTime(t.createdAt) },
            {
              title: "",
              width: 190,
              render: (_: unknown, t) => (
                <Space>
                  {t.status === "DRAFT" && (
                    <Popconfirm
                      title={`ส่ง ${t.transferNo}?`}
                      description="สต็อกที่ต้นทางจะถูกตัดทันที และยกเลิกใบนี้ไม่ได้อีก"
                      okText="ส่ง"
                      cancelText="ยังไม่ส่ง"
                      onConfirm={() => void send(t)}
                    >
                      <Button size="small" type="primary" loading={busy}>ส่งของ</Button>
                    </Popconfirm>
                  )}
                  {t.status === "DRAFT" && (
                    <Popconfirm
                      title={`ยกเลิก ${t.transferNo}?`}
                      okText="ยกเลิกใบโอน"
                      cancelText="ไม่"
                      onConfirm={() => void cancel(t)}
                    >
                      <Button size="small" danger>ยกเลิก</Button>
                    </Popconfirm>
                  )}
                  {t.status === "IN_TRANSIT" && (
                    <Button size="small" type="primary" onClick={() => openReceive(t)}>
                      รับของ
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="สร้างใบโอน"
        onCancel={() => setCreateOpen(false)}
        onOk={() => void create()}
        confirmLoading={busy}
        okText="สร้าง (ยังไม่ตัดสต็อก)"
        cancelText="ยกเลิก"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Space style={{ width: "100%" }} size="middle">
            <Form.Item
              name="fromLocationId"
              label="สาขาต้นทาง"
              rules={[{ required: true, message: "ต้องเลือกต้นทาง" }]}
              style={{ minWidth: 260 }}
            >
              <Select
                placeholder="เลือกสาขา"
                options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
              />
            </Form.Item>
            <Form.Item
              name="toLocationId"
              label="สาขาปลายทาง"
              dependencies={["fromLocationId"]}
              rules={[
                { required: true, message: "ต้องเลือกปลายทาง" },
                ({ getFieldValue }) => ({
                  validator: (_, v) =>
                    v && v === getFieldValue("fromLocationId")
                      ? Promise.reject(new Error("ต้องต่างจากต้นทาง"))
                      : Promise.resolve(),
                }),
              ]}
              style={{ minWidth: 260 }}
            >
              <Select
                placeholder="เลือกสาขา"
                options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
              />
            </Form.Item>
          </Space>

          <Form.Item name="note" label="โน้ต" extra="เช่น รอบรถส่งของ หรือเหตุผลที่ต้องโอน">
            <Input placeholder="ไม่บังคับ" />
          </Form.Item>

          <Typography.Text strong>รายการที่โอน</Typography.Text>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 4 }}>
                    <Form.Item
                      name={[field.name, "sku"]}
                      rules={[{ required: true, message: "ต้องระบุ SKU" }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="SKU" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "size"]}
                      rules={[{ required: true, message: "ต้องระบุไซซ์" }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="ไซซ์" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "qty"]}
                      rules={[{ required: true, message: "ต้องระบุจำนวน" }]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} precision={0} placeholder="จำนวน" style={{ width: 110 }} />
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
                  เพิ่มรายการ
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={!!receiving}
        title={`รับของ · ${receiving?.transferNo ?? ""}`}
        onCancel={() => setReceiving(null)}
        onOk={() => void confirmReceive()}
        confirmLoading={busy}
        okButtonProps={{ disabled: invalidDiscrepancy }}
        okText="ยืนยันรับของ"
        cancelText="ยังไม่รับ"
        width={720}
      >
        {receiving && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="จาก">{receiving.fromLocationName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="ไป">{receiving.toLocationName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="ส่งเมื่อ">{fmtTime(receiving.sentAt)}</Descriptions.Item>
            </Descriptions>

            <Alert closable
              type={missingOnReceive > 0 || damagedOnReceive > 0 ? "warning" : "info"}
              showIcon
              message={
                missingOnReceive > 0 || damagedOnReceive > 0
                  ? `ไม่พบ ${missingOnReceive} ชิ้น · เสียหาย ${damagedOnReceive} ชิ้น`
                  : "นับของจริงก่อนกดยืนยัน"
              }
              description={
                missingOnReceive > 0 || damagedOnReceive > 0
                  ? "ของสภาพดีเข้าสต็อกขาย ของเสียหายเข้ากักกัน และของไม่พบถูกบันทึกเป็นส่วนต่าง — ต้องระบุเหตุผลและหมายเหตุก่อนยืนยัน"
                  : "ค่าเริ่มต้นคือรับสภาพดีครบ แก้จำนวนให้ตรงกับของที่ตรวจจริง"
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
                  title: "สินค้า",
                  dataIndex: "productName",
                  render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                },
                { title: "ไซซ์", dataIndex: "size", width: 80 },
                { title: "ส่งมา", dataIndex: "qty", width: 75 },
                {
                  title: "รับสภาพดี",
                  width: 120,
                  render: (_: unknown, i) => (
                    <InputNumber
                      min={0}
                      max={Math.max(0, i.qty - (damagedQty[i.id] ?? 0))}
                      precision={0}
                      value={receivedQty[i.id] ?? i.qty}
                      onChange={(v) => setReceivedQty((prev) => ({ ...prev, [i.id]: Number(v ?? 0) }))}
                      style={{ width: "100%" }}
                    />
                  ),
                },
                {
                  title: "เสียหาย/กักกัน", width: 130,
                  render: (_: unknown, i) => (
                    <InputNumber
                      min={0}
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
                  title: "ไม่พบ", width: 80,
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
                  title: "สาเหตุ", width: 180,
                  render: (_: unknown, i) => {
                    const hasDifference = (damagedQty[i.id] ?? 0) > 0
                      || i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0) > 0;
                    return (
                      <Select
                        disabled={!hasDifference}
                        value={discrepancyReason[i.id]}
                        placeholder="เลือกสาเหตุ"
                        style={{ width: "100%" }}
                        options={Object.entries(REASON_LABELS)
                          .filter(([value]) => value !== "LEGACY_SHORT_RECEIPT")
                          .map(([value, label]) => ({ value, label }))}
                        onChange={(value) => setDiscrepancyReason((prev) => ({ ...prev, [i.id]: value }))}
                      />
                    );
                  },
                },
                {
                  title: "หมายเหตุส่วนต่าง", width: 240,
                  render: (_: unknown, i) => {
                    const hasDifference = (damagedQty[i.id] ?? 0) > 0
                      || i.qty - (receivedQty[i.id] ?? i.qty) - (damagedQty[i.id] ?? 0) > 0;
                    return (
                      <Input
                        disabled={!hasDifference}
                        value={discrepancyNote[i.id] ?? ""}
                        placeholder={hasDifference ? "บังคับกรอก" : "ไม่มีส่วนต่าง"}
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
              value={receivingNote}
              onChange={(event) => setReceivingNote(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="หมายเหตุการรับของรอบนี้ เช่น กล่องเปียก ซีลขาด หรือเลขพัสดุอ้างอิง (ไม่บังคับ)"
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}
