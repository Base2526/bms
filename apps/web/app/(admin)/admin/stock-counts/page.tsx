'use client';
// นับสต็อก / stock take (7.98)
// -------------------------------------------------------------
// สิ่งที่หน้านี้ต้องสื่อให้ชัดคือ "ส่วนต่าง" ไม่ใช่ "จำนวนที่นับได้"
//
// ระหว่างที่คนเดินนับ ร้านยังขายอยู่ ระบบจึงจับ snapshot ตอนกรอกรายการครั้งแรก
// แล้วตอนปิดใบคิดเป็นส่วนต่าง (นับได้ − snapshot) บวกเข้ากับยอดปัจจุบัน ไม่ใช่
// ทับค่า — ยอดขายระหว่างนับจึงไม่ถูกเสกกลับมา
//
// "ปิดใบนับ" ใช้สิทธิ์คนละตัวกับการกรอกตัวเลข (inventory.count.apply) เพราะมัน
// คือการตัดสินใจทางบัญชีว่าของหายไปเท่านั้นจริง ไม่ใช่งานเดินนับของ
//
// ใช้ REST (/api/bms/inventory/counts) ไม่ใช่ GraphQL — ดูเหตุผลใน
// docs/business/inventory.md § ทำไมโมดูลนี้เป็น REST
import {
  Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Select, Space, Statistic, Table, Tag, Typography, message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader, { ResponsiveStatusFilter } from "@/components/admin/AdminPageHeader";

type CountStatus = "DRAFT" | "APPLIED" | "CANCELLED";
type Filter = "ALL" | CountStatus;

type CountItem = {
  id: number;
  sku: string;
  productName: string | null;
  size: string;
  snapshotQty: number;
  countedQty: number;
  variance: number;
  note: string | null;
};

type StockCount = {
  id: string;
  countNo: string;
  locationId: string;
  locationName: string | null;
  status: CountStatus;
  note: string | null;
  createdByName: string | null;
  appliedAt: string | null;
  createdAt: string;
  items: CountItem[];
  varianceUnits: number;
};

type Location = { id: string; code: string; name: string; active: boolean };

const FILTERS: readonly Filter[] = ["ALL", "DRAFT", "APPLIED", "CANCELLED"];

const STATUS_LABEL: Record<CountStatus, string> = {
  DRAFT: "กำลังนับ",
  APPLIED: "ปิดใบแล้ว",
  CANCELLED: "ยกเลิก",
};

const STATUS_COLOR: Record<CountStatus, string> = {
  DRAFT: "processing",
  APPLIED: "success",
  CANCELLED: "error",
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—";

function explain(body: any): string {
  switch (body?.status) {
    case "INVALID":
      return body.reason ?? "ข้อมูลไม่ถูกต้อง";
    case "NOT_FOUND":
      return "ไม่พบใบนับนี้";
    case "WRONG_STATE":
      return `ใบนับอยู่สถานะ "${STATUS_LABEL[body.current as CountStatus] ?? body.current}" แล้ว ทำรายการนี้ไม่ได้`;
    case "WOULD_BREAK_RESERVED":
      return `${body.sku} ไซซ์ ${body.size}: ปิดใบแล้วสต็อกจะเหลือ ${body.wouldBe} แต่มีลูกค้าจองไว้ ${body.reserved} ชิ้น — ต้องเคลียร์ออร์เดอร์ที่จองไว้ หรือนับซ้ำก่อน`;
    default:
      return body?.error ?? "ทำรายการไม่สำเร็จ";
  }
}

/** ส่วนต่างติดลบ = ของหาย ซึ่งเป็นตัวเลขที่ต้องสะดุดตา ไม่ใช่ตัวเลขธรรมดา */
const varianceTag = (v: number) =>
  v === 0 ? <Tag>ตรง</Tag> : v < 0 ? <Tag color="red">{v}</Tag> : <Tag color="gold">+{v}</Tag>;

export default function StockCountsPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canUse = can("inventory.count");
  const canApply = can("inventory.count.apply");

  const [rows, setRows] = useState<StockCount[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const [openId, setOpenId] = useState<string | null>(null);
  const [itemForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/bms/inventory/counts${qs}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "ไม่มีสิทธิ์ดูใบนับ (ต้องมี inventory.count)" : "โหลดรายการไม่สำเร็จ");
      }
      const body = await res.json();
      setRows(body.counts ?? []);
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

  async function post(payload: Record<string, unknown>): Promise<any | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/bms/inventory/counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(explain(body));
        return null;
      }
      return body;
    } catch {
      message.error("เชื่อมต่อไม่ได้");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const values = await createForm.validateFields().catch(() => null);
    if (!values) return;
    const body = await post({
      action: "create",
      locationId: values.locationId,
      note: values.note?.trim() || null,
    });
    if (!body) return;
    message.success(`เปิดใบนับ ${body.countNo} แล้ว`);
    setCreateOpen(false);
    createForm.resetFields();
    // ใบที่เพิ่งเปิดเป็น DRAFT เสมอ — ถ้าตัวกรองค้างที่สถานะอื่น มันจะไม่อยู่ใน rows
    // แล้วหน้าต่างกรอกผลนับ (ที่ derive จาก rows) จะไม่เปิด เงียบ ๆ แล้วไปโผล่เองทีหลัง
    // ตอนผู้ใช้สลับตัวกรองกลับมา
    setFilter("ALL");
    setOpenId(body.countId);
    await load();
  }

  async function addItem() {
    if (!openId) return;
    const values = await itemForm.validateFields().catch(() => null);
    if (!values) return;
    const body = await post({
      action: "item",
      countId: openId,
      sku: values.sku.trim(),
      size: values.size.trim(),
      countedQty: values.countedQty,
      note: values.note?.trim() || null,
    });
    if (!body) return;
    message.success(
      body.variance === 0
        ? `${values.sku} ตรงกับระบบ`
        : `${values.sku}: ระบบมี ${body.snapshotQty} นับได้ ${values.countedQty} (ส่วนต่าง ${body.variance > 0 ? "+" : ""}${body.variance})`
    );
    itemForm.resetFields();
    itemForm.setFieldsValue({ countedQty: null });
    await load();
  }

  async function apply(c: StockCount) {
    const body = await post({ action: "apply", countId: c.id });
    if (!body) return;
    message.success(
      body.adjustedItems === 0
        ? `ปิดใบ ${c.countNo} แล้ว — ไม่มีส่วนต่างต้องปรับ`
        : `ปิดใบ ${c.countNo} แล้ว — ปรับ ${body.adjustedItems} รายการ รวม ${body.varianceUnits > 0 ? "+" : ""}${body.varianceUnits} ชิ้น`
    );
    setOpenId(null);
    await load();
  }

  async function cancel(c: StockCount) {
    if (await post({ action: "cancel", countId: c.id })) {
      message.success(`ยกเลิกใบนับ ${c.countNo} แล้ว`);
      setOpenId(null);
      await load();
    }
  }

  if (!permsLoading && !canUse) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี inventory.count)" />;
  }

  const activeLocations = locations.filter((l) => l.active);
  const open = rows.find((r) => r.id === openId) ?? null;
  const shortUnits = open ? open.items.reduce((s, i) => s + Math.min(i.variance, 0), 0) : 0;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="นับสต็อก">
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
          disabled={activeLocations.length === 0}
          onClick={() => {
            createForm.resetFields();
            if (activeLocations.length === 1) createForm.setFieldsValue({ locationId: activeLocations[0].id });
            setCreateOpen(true);
          }}
        >
          เปิดใบนับใหม่
        </Button>
      </AdminPageHeader>

      <Alert
        type="info"
        showIcon
        message="ระบบเทียบกับยอด ณ ตอนที่กรอกรายการ ไม่ใช่ตอนปิดใบ"
        description="ขายระหว่างนับได้ตามปกติ — ส่วนต่างที่บันทึกคือของที่หายจริงเท่านั้น · กรอกตัวเลขผิดแล้วกรอกซ้ำได้ ฐานเปรียบเทียบไม่ขยับ · สต็อกจะยังไม่เปลี่ยนจนกว่าจะกดปิดใบ"
      />

      {!canApply && (
        <Alert
          type="warning"
          showIcon
          message="คุณกรอกผลนับได้ แต่ปิดใบนับไม่ได้"
          description="การยอมรับส่วนต่างเข้าสต็อกจริงต้องมีสิทธิ์ inventory.count.apply (ปกติให้เฉพาะผู้จัดการ) — นับเสร็จแล้วแจ้งผู้จัดการมาปิดใบ"
        />
      )}

      <Card>
        <Table<StockCount>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: <Empty description="ยังไม่มีใบนับ" /> }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: "เลขที่", dataIndex: "countNo", width: 150 },
            { title: "สาขา", dataIndex: "locationName", render: (v: string | null) => v ?? "—" },
            {
              title: "สถานะ",
              dataIndex: "status",
              width: 130,
              render: (s: CountStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
            },
            { title: "รายการ", width: 100, render: (_: unknown, c) => `${c.items.length} รายการ` },
            {
              title: "ส่วนต่างรวม",
              dataIndex: "varianceUnits",
              width: 120,
              render: (v: number, c) => (c.items.length === 0 ? "—" : varianceTag(v)),
            },
            { title: "เปิดโดย", dataIndex: "createdByName", width: 140, render: (v: string | null) => v ?? "—" },
            { title: "เปิดเมื่อ", width: 150, render: (_: unknown, c) => fmtTime(c.createdAt) },
            {
              title: "",
              width: 110,
              render: (_: unknown, c) => (
                <Button size="small" onClick={() => setOpenId(c.id)}>
                  {c.status === "DRAFT" ? "กรอกผลนับ" : "ดูผล"}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="เปิดใบนับใหม่"
        onCancel={() => setCreateOpen(false)}
        onOk={() => void create()}
        confirmLoading={busy}
        okText="เปิดใบนับ"
        cancelText="ยกเลิก"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="locationId" label="สาขาที่นับ" rules={[{ required: true, message: "ต้องเลือกสาขา" }]}>
            <Select
              placeholder="เลือกสาขา"
              options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
            />
          </Form.Item>
          <Form.Item name="note" label="โน้ต" extra="เช่น นับชั้นวางหน้าร้าน / นับประจำเดือน">
            <Input placeholder="ไม่บังคับ" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!open}
        title={open ? `ใบนับ ${open.countNo} · ${open.locationName ?? ""}` : ""}
        onCancel={() => setOpenId(null)}
        width={860}
        footer={
          open && open.status === "DRAFT" ? (
            <Space>
              <Button onClick={() => setOpenId(null)}>ปิดหน้าต่าง</Button>
              <Popconfirm
                title={`ยกเลิกใบนับ ${open.countNo}?`}
                description="ผลนับที่กรอกไว้จะไม่ถูกนำไปปรับสต็อก"
                okText="ยกเลิกใบนับ"
                cancelText="ไม่"
                onConfirm={() => void cancel(open)}
              >
                <Button danger>ยกเลิกใบนับ</Button>
              </Popconfirm>
              <Popconfirm
                title={`ปิดใบ ${open.countNo} และปรับสต็อก?`}
                description={
                  shortUnits < 0
                    ? `ของขาด ${Math.abs(shortUnits)} ชิ้นจะถูกตัดออกจากสต็อกจริง — ย้อนกลับไม่ได้`
                    : "ส่วนต่างจะถูกปรับเข้าสต็อกจริง — ย้อนกลับไม่ได้"
                }
                okText="ปิดใบนับ"
                cancelText="ยังไม่ปิด"
                disabled={!canApply || open.items.length === 0}
                onConfirm={() => void apply(open)}
              >
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!canApply || open.items.length === 0}
                  title={!canApply ? "ต้องมีสิทธิ์ inventory.count.apply" : undefined}
                >
                  ปิดใบนับ + ปรับสต็อก
                </Button>
              </Popconfirm>
            </Space>
          ) : (
            <Button onClick={() => setOpenId(null)}>ปิดหน้าต่าง</Button>
          )
        }
      >
        {open && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="สถานะ">
                <Tag color={STATUS_COLOR[open.status]}>{STATUS_LABEL[open.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="เปิดโดย">{open.createdByName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="เปิดเมื่อ">{fmtTime(open.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="ปิดใบเมื่อ">{fmtTime(open.appliedAt)}</Descriptions.Item>
              {open.note && <Descriptions.Item label="โน้ต" span={2}>{open.note}</Descriptions.Item>}
            </Descriptions>

            <Space size="large" wrap>
              <Statistic title="รายการที่นับแล้ว" value={open.items.length} />
              <Statistic
                title="ของขาด (ชิ้น)"
                value={Math.abs(shortUnits)}
                valueStyle={{ color: shortUnits < 0 ? "#cf1322" : undefined }}
              />
              <Statistic
                title="ส่วนต่างสุทธิ"
                value={open.varianceUnits}
                valueStyle={{ color: open.varianceUnits < 0 ? "#cf1322" : open.varianceUnits > 0 ? "#d48806" : undefined }}
              />
            </Space>

            {open.status === "DRAFT" && (
              <Card size="small" title="กรอกผลนับ">
                <Form
                  form={itemForm}
                  layout="inline"
                  onFinish={() => void addItem()}
                  initialValues={{ countedQty: null }}
                >
                  <Form.Item name="sku" rules={[{ required: true, message: "ต้องระบุ SKU" }]}>
                    <Input placeholder="SKU (สแกนหรือพิมพ์)" style={{ width: 240 }} autoFocus />
                  </Form.Item>
                  <Form.Item name="size" rules={[{ required: true, message: "ต้องระบุไซซ์" }]}>
                    <Input placeholder="ไซซ์" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name="countedQty" rules={[{ required: true, message: "ต้องระบุจำนวนที่นับได้" }]}>
                    <InputNumber min={0} precision={0} placeholder="นับได้" style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item name="note">
                    <Input placeholder="โน้ต (ไม่บังคับ)" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>
                      บันทึก
                    </Button>
                  </Form.Item>
                </Form>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  กรอก SKU เดิมซ้ำได้ถ้าพิมพ์ผิด — ตัวเลขล่าสุดจะทับของเดิม โดยฐานที่ใช้เทียบไม่ขยับ
                </Typography.Text>
              </Card>
            )}

            <Table<CountItem>
              rowKey="id"
              size="small"
              dataSource={open.items}
              locale={{ emptyText: <Empty description="ยังไม่ได้กรอกผลนับ" /> }}
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              columns={[
                { title: "SKU", dataIndex: "sku", width: 170 },
                {
                  title: "สินค้า",
                  dataIndex: "productName",
                  render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                },
                { title: "ไซซ์", dataIndex: "size", width: 80 },
                { title: "ระบบมี", dataIndex: "snapshotQty", width: 90 },
                { title: "นับได้", dataIndex: "countedQty", width: 90 },
                {
                  title: "ส่วนต่าง",
                  dataIndex: "variance",
                  width: 100,
                  render: (v: number) => varianceTag(v),
                },
                {
                  title: "โน้ต",
                  dataIndex: "note",
                  render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                },
              ]}
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}
