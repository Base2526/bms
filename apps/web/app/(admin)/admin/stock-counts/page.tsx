"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
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

const STATUS_LABEL = (uiText: UiTranslator = thaiUiText): Record<CountStatus, string> => ({
  DRAFT: uiText("admin_ui.counting_f3213"),
  APPLIED: uiText("admin_ui.posted_9a7c8"),
  CANCELLED: uiText("admin_ui.cancelled_fba6e"),
});

const STATUS_COLOR: Record<CountStatus, string> = {
  DRAFT: "processing",
  APPLIED: "success",
  CANCELLED: "error",
};

const fmtTime = (iso: string | null, uiText: UiTranslator = thaiUiText) =>
  iso ? new Date(iso).toLocaleString(uiText.locale, { dateStyle: "short", timeStyle: "short" }) : "—";

function explain(body: any, uiText: UiTranslator = thaiUiText): string {
  switch (body?.status) {
    case "INVALID":
      return body.reason ?? uiText("admin_ui.invalid_data_9c4d0");
    case "NOT_FOUND":
      return uiText("admin_ui.stock_count_not_found_67e38");
    case "WRONG_STATE":
      return uiText("admin_ui.this_count_is_already_this_action_is_unavailable_dd9f9", { v0: STATUS_LABEL(uiText)[body.current as CountStatus] ?? body.current });
    case "WOULD_BREAK_RESERVED":
      return uiText("admin_ui.size_posting_would_leave_in_stock_but_customers_7f96b", { v0: body.sku, v1: body.size, v2: body.wouldBe, v3: body.reserved });
    default:
      return body?.error ?? uiText("admin_ui.could_not_complete_this_action_1af08");
  }
}

/** ส่วนต่างติดลบ = ของหาย ซึ่งเป็นตัวเลขที่ต้องสะดุดตา ไม่ใช่ตัวเลขธรรมดา */
const varianceTag = (v: number, uiText: UiTranslator = thaiUiText) =>
  v === 0 ? <Tag>{uiText("admin_ui.match_29801")}</Tag> : v < 0 ? <Tag color="red">{v}</Tag> : <Tag color="gold">+{v}</Tag>;

export default function StockCountsPage() {
  const uiText = useUiText();
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
        throw new Error(res.status === 403 ? uiText("admin_ui.you_do_not_have_permission_to_view_stock_dadb9") : uiText("admin_ui.could_not_load_the_list_56c99"));
      }
      const body = await res.json();
      setRows(body.counts ?? []);
      setLocations(body.locations ?? []);
    } catch (e: any) {
      message.error(e?.message ?? uiText("admin_ui.could_not_load_the_list_56c99"));
    } finally {
      setLoading(false);
    }
  }, [uiText, filter]);

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
        message.error(explain(body, uiText));
        return null;
      }
      return body;
    } catch {
      message.error(uiText("admin_ui.cannot_connect_97b30"));
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
    message.success(uiText("admin_ui.opened_stock_count_8b689", { v0: body.countNo }));
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
        ? uiText("admin_ui.matches_the_system_843da", { v0: values.sku })
        : uiText("admin_ui.system_counted_difference_5a82c", { v0: values.sku, v1: body.snapshotQty, v2: values.countedQty, v3: body.variance > 0 ? "+" : "", v4: body.variance })
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
        ? uiText("admin_ui.posted_no_adjustment_needed_9ae1a", { v0: c.countNo })
        : uiText("admin_ui.posted_adjusted_items_total_units_5319e", { v0: c.countNo, v1: body.adjustedItems, v2: body.varianceUnits > 0 ? "+" : "", v3: body.varianceUnits })
    );
    setOpenId(null);
    await load();
  }

  async function cancel(c: StockCount) {
    if (await post({ action: "cancel", countId: c.id })) {
      message.success(uiText("admin_ui.cancelled_stock_count_f5bc9", { v0: c.countNo }));
      setOpenId(null);
      await load();
    }
  }

  if (!permsLoading && !canUse) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_this_ec514")} />;
  }

  const activeLocations = locations.filter((l) => l.active);
  const open = rows.find((r) => r.id === openId) ?? null;
  const shortUnits = open ? open.items.reduce((s, i) => s + Math.min(i.variance, 0), 0) : 0;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.stock_counts_6810a")}>
        <ResponsiveStatusFilter<Filter>
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: uiText("admin_ui.all_56eff"), ...STATUS_LABEL(uiText) }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          {uiText("admin_ui.refresh_78a47")}</Button>
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
          {uiText("admin_ui.open_new_stock_count_a82da")}</Button>
      </AdminPageHeader>

      <Alert closable
        type="info"
        showIcon
        message={uiText("admin_ui.the_system_compares_against_the_balance_when_each_f26f7")}
        description={uiText("admin_ui.sales_can_continue_during_counting_only_the_actual_176be")}
      />

      {!canApply && (
        <Alert closable
          type="warning"
          showIcon
          message={uiText("admin_ui.you_can_enter_counts_but_cannot_post_them_707eb")}
          description={uiText("admin_ui.applying_variances_to_stock_requires_inventory_count_apply_5bcc2")}
        />
      )}

      <Card>
        <Table<StockCount>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: <Empty description={uiText("admin_ui.no_stock_counts_yet_caddc")} /> }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: uiText("admin_ui.document_no_7e315"), dataIndex: "countNo", width: 150 },
            { title: uiText("admin_ui.branch_63a7c"), dataIndex: "locationName", render: (v: string | null) => v ?? "—" },
            {
              title: uiText("admin_ui.status_2e8c4"),
              dataIndex: "status",
              width: 130,
              render: (s: CountStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL(uiText)[s]}</Tag>,
            },
            { title: uiText("admin_ui.item_51c19"), width: 100, render: (_: unknown, c) => uiText("admin_ui.items_d57ca", { v0: c.items.length }) },
            {
              title: uiText("admin_ui.total_difference_9f447"),
              dataIndex: "varianceUnits",
              width: 120,
              render: (v: number, c) => (c.items.length === 0 ? "—" : varianceTag(v, uiText)),
            },
            { title: uiText("admin_ui.opened_by_8d93c"), dataIndex: "createdByName", width: 140, render: (v: string | null) => v ?? "—" },
            { title: uiText("admin_ui.opened_at_d0d34"), width: 150, render: (_: unknown, c) => fmtTime(c.createdAt, uiText) },
            {
              title: "",
              width: 110,
              render: (_: unknown, c) => (
                <Button size="small" onClick={() => setOpenId(c.id)}>
                  {c.status === "DRAFT" ? uiText("admin_ui.enter_count_8298f") : uiText("admin_ui.view_results_c0aab")}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title={uiText("admin_ui.open_new_stock_count_a82da")}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void create()}
        confirmLoading={busy}
        okText={uiText("admin_ui.open_count_a31d8")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="locationId" label={uiText("admin_ui.branch_being_counted_46f5d")} rules={[{ required: true, message: uiText("admin_ui.select_a_branch_7f17c") }]}>
            <Select
              placeholder={uiText("admin_ui.select_branch_1bfe8")}
              options={activeLocations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
            />
          </Form.Item>
          <Form.Item name="note" label={uiText("admin_ui.note_06591")} extra={uiText("admin_ui.e_g_front_shelf_count_monthly_count_1fe52")}>
            <Input placeholder={uiText("admin_ui.optional_e39a0")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!open}
        title={open ? uiText("admin_ui.stock_count_f1777", { v0: open.countNo, v1: open.locationName ?? "" }) : ""}
        onCancel={() => setOpenId(null)}
        width={860}
        footer={
          open && open.status === "DRAFT" ? (
            <Space>
              <Button onClick={() => setOpenId(null)}>{uiText("admin_ui.close_window_434e4")}</Button>
              <Popconfirm
                title={uiText("admin_ui.cancel_stock_count_5229c", { v0: open.countNo })}
                description={uiText("admin_ui.entered_counts_will_not_be_applied_to_stock_4a07a")}
                okText={uiText("admin_ui.cancel_count_74e1b")}
                cancelText={uiText("admin_ui.no_d73fb")}
                onConfirm={() => void cancel(open)}
              >
                <Button danger>{uiText("admin_ui.cancel_count_74e1b")}</Button>
              </Popconfirm>
              <Popconfirm
                title={uiText("admin_ui.post_and_adjust_stock_56a22", { v0: open.countNo })}
                description={
                  shortUnits < 0
                    ? uiText("admin_ui.missing_units_will_be_deducted_from_actual_stock_39c6a", { v0: Math.abs(shortUnits) })
                    : uiText("admin_ui.the_variance_will_be_applied_to_actual_stock_d3638")
                }
                okText={uiText("admin_ui.post_stock_count_ef032")}
                cancelText={uiText("admin_ui.open_91e65")}
                disabled={!canApply || open.items.length === 0}
                onConfirm={() => void apply(open)}
              >
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!canApply || open.items.length === 0}
                  title={!canApply ? uiText("admin_ui.requires_inventory_count_apply_cb0e4") : undefined}
                >
                  {uiText("admin_ui.post_count_adjust_stock_20675")}</Button>
              </Popconfirm>
            </Space>
          ) : (
            <Button onClick={() => setOpenId(null)}>{uiText("admin_ui.close_window_434e4")}</Button>
          )
        }
      >
        {open && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={uiText("admin_ui.status_2e8c4")}>
                <Tag color={STATUS_COLOR[open.status]}>{STATUS_LABEL(uiText)[open.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.opened_by_8d93c")}>{open.createdByName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.opened_at_d0d34")}>{fmtTime(open.createdAt, uiText)}</Descriptions.Item>
              <Descriptions.Item label={uiText("admin_ui.posted_at_d8731")}>{fmtTime(open.appliedAt, uiText)}</Descriptions.Item>
              {open.note && <Descriptions.Item label={uiText("admin_ui.note_06591")} span={2}>{open.note}</Descriptions.Item>}
            </Descriptions>

            <Space size="large" wrap>
              <Statistic title={uiText("admin_ui.items_counted_410e3")} value={open.items.length} />
              <Statistic
                title={uiText("admin_ui.missing_units_87ed5")}
                value={Math.abs(shortUnits)}
                valueStyle={{ color: shortUnits < 0 ? "#cf1322" : undefined }}
              />
              <Statistic
                title={uiText("admin_ui.net_difference_4ec72")}
                value={open.varianceUnits}
                valueStyle={{ color: open.varianceUnits < 0 ? "#cf1322" : open.varianceUnits > 0 ? "#d48806" : undefined }}
              />
            </Space>

            {open.status === "DRAFT" && (
              <Card size="small" title={uiText("admin_ui.enter_count_8298f")}>
                <Form
                  form={itemForm}
                  layout="inline"
                  onFinish={() => void addItem()}
                  initialValues={{ countedQty: null }}
                >
                  <Form.Item name="sku" rules={[{ required: true, message: uiText("admin_ui.enter_a_sku_09104") }]}>
                    <Input placeholder={uiText("admin_ui.sku_scan_or_type_538c8")} style={{ width: 240 }} autoFocus />
                  </Form.Item>
                  <Form.Item name="size" rules={[{ required: true, message: uiText("admin_ui.enter_a_size_f6257") }]}>
                    <Input placeholder={uiText("admin_ui.size_ff4b6")} style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name="countedQty" rules={[{ required: true, message: uiText("admin_ui.enter_the_counted_quantity_c128a") }]}>
                    <InputNumber min={0} precision={0} placeholder={uiText("admin_ui.counted_f6d86")} style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item name="note">
                    <Input placeholder={uiText("admin_ui.note_optional_3f749")} style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>
                      {uiText("admin_ui.save_f658a")}</Button>
                  </Form.Item>
                </Form>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {uiText("admin_ui.re_enter_the_same_sku_to_correct_a_25ba8")}</Typography.Text>
              </Card>
            )}

            <Table<CountItem>
              rowKey="id"
              size="small"
              dataSource={open.items}
              locale={{ emptyText: <Empty description={uiText("admin_ui.no_counts_entered_yet_37515")} /> }}
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              columns={[
                { title: "SKU", dataIndex: "sku", width: 170 },
                {
                  title: uiText("admin_ui.product_8432c"),
                  dataIndex: "productName",
                  render: (v: string | null) => v ?? <span style={{ color: "#999" }}>—</span>,
                },
                { title: uiText("admin_ui.size_ff4b6"), dataIndex: "size", width: 80 },
                { title: uiText("admin_ui.system_quantity_632c3"), dataIndex: "snapshotQty", width: 90 },
                { title: uiText("admin_ui.counted_f6d86"), dataIndex: "countedQty", width: 90 },
                {
                  title: uiText("admin_ui.difference_0b7d5"),
                  dataIndex: "variance",
                  width: 100,
                  render: (v: number) => varianceTag(v, uiText),
                },
                {
                  title: uiText("admin_ui.note_06591"),
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
