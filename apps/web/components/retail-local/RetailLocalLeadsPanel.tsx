"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const STATUSES = ["NEW", "CONTACTED", "TRIAL_ISSUED", "PAID", "NOT_INTERESTED"] as const;
type LeadStatus = (typeof STATUSES)[number];

type LeadRow = {
  id: string;
  shop_name: string | null;
  contact_name: string | null;
  phone: string | null;
  line_id: string | null;
  business_type: string | null;
  platform: string;
  locale: string;
  consent_at: string;
  consent_text_version: string;
  status: LeadStatus;
  follow_up_at: string | null;
  note: string | null;
  created_at: string;
  erased_at: string | null;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body as T;
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function RetailLocalLeadsPanel() {
  const { lang } = useI18n();
  const th = lang === "th";
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const result = await jsonRequest<{ leads: LeadRow[] }>(`/api/admin/retail-local/leads${query}`);
      setRows(result.leads);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";

  const statusOptions = useMemo(() => [
    { value: "", label: th ? "ทุกสถานะ" : "All statuses" },
    ...STATUSES.map((status) => ({ value: status, label: status })),
  ], [th]);

  const openEdit = (row: LeadRow) => {
    setEditing(row);
    form.setFieldsValue({
      status: row.status,
      note: row.note || "",
      followUpAt: toLocalDateTime(row.follow_up_at),
    });
  };

  const save = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      await jsonRequest(`/api/admin/retail-local/leads/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: values.status,
          note: values.note || null,
          followUpAt: values.followUpAt ? new Date(values.followUpAt).toISOString() : null,
        }),
      });
      message.success(th ? "บันทึก Lead แล้ว" : "Lead saved");
      setEditing(null);
      form.resetFields();
      await load();
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  // PDPA erasure on request (10.106). Irreversible: contact details and their history
  // snapshots are cleared; the row stays with status and consent time only.
  const erase = async (row: LeadRow) => {
    try {
      await jsonRequest(`/api/admin/retail-local/leads/${row.id}`, { method: "DELETE" });
      message.success(th ? "ลบข้อมูลส่วนบุคคลของ Lead นี้แล้ว" : "Personal data for this lead was erased");
      await load();
    } catch (eraseError) {
      message.error(eraseError instanceof Error ? eraseError.message : String(eraseError));
    }
  };

  return (
    <div style={{ minWidth: 0 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{th ? "Lead จากหน้าดาวน์โหลด" : "Download-page leads"}</Typography.Title>
          <Typography.Text type="secondary">
            {th ? "ข้อมูลติดต่อที่ผู้สนใจยินยอมส่งให้ทีมขาย" : "Contact details submitted with explicit consent for sales follow-up"}
          </Typography.Text>
        </div>
        <Space wrap>
          <Select value={statusFilter} options={statusOptions} onChange={setStatusFilter} style={{ width: 180 }} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{th ? "รีเฟรช" : "Refresh"}</Button>
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        closable
        message={th
          ? "ข้อมูลนี้เป็นข้อมูลส่วนบุคคล ใช้เฉพาะการติดตามที่ยินยอม และห้ามคัดลอกลง URL หรือ log"
          : "This is personal data. Use it only for consented follow-up and never copy it into URLs or logs."}
        style={{ marginBottom: 16 }}
      />
      {error && <Alert type="error" showIcon closable message={error} style={{ marginBottom: 16 }} />}

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: 1280 }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: th ? "ร้าน/ผู้ติดต่อ" : "Shop/contact", width: 220, render: (_: unknown, row: LeadRow) => row.erased_at
            ? <Tag>{th ? `ลบข้อมูลแล้ว ${formatDate(row.erased_at)}` : `Erased ${formatDate(row.erased_at)}`}</Tag>
            : <div><b>{row.shop_name || "—"}</b><br /><Typography.Text type="secondary">{row.contact_name || "—"}</Typography.Text></div> },
          { title: th ? "ช่องทาง" : "Contact", width: 180, render: (_: unknown, row: LeadRow) => <div>{row.phone || "—"}<br />{row.line_id ? `LINE: ${row.line_id}` : "—"}</div> },
          { title: th ? "ประเภทร้าน" : "Business", dataIndex: "business_type", width: 150, render: (value: string | null) => value || "—" },
          { title: "Platform", dataIndex: "platform", width: 110, render: (value: string) => <Tag>{value}</Tag> },
          { title: th ? "สถานะ" : "Status", dataIndex: "status", width: 140, render: (value: string) => <Tag color={value === "PAID" ? "green" : value === "NEW" ? "blue" : "default"}>{value}</Tag> },
          { title: th ? "โทรตาม" : "Follow up", dataIndex: "follow_up_at", width: 190, render: formatDate },
          { title: th ? "ยินยอมเมื่อ" : "Consented", dataIndex: "consent_at", width: 190, render: formatDate },
          { title: "", fixed: "right", width: 190, render: (_: unknown, row: LeadRow) => row.erased_at ? null : <Space size={4}>
            <Button size="small" onClick={() => openEdit(row)}>{th ? "แก้ไข" : "Edit"}</Button>
            <Popconfirm
              title={th ? "ลบข้อมูลส่วนบุคคลของ Lead นี้?" : "Erase this lead's personal data?"}
              description={th
                ? "ชื่อร้าน ผู้ติดต่อ เบอร์ LINE ประเภทร้าน โน้ต และประวัติที่มีข้อมูลเหล่านี้จะถูกลบถาวร ย้อนกลับไม่ได้ ใช้เมื่อเจ้าของข้อมูลขอให้ลบ"
                : "Shop, contact, phone, LINE, business type, note and the history holding them are permanently erased. Use when the person asks to be deleted."}
              okText={th ? "ลบถาวร" : "Erase"}
              cancelText={th ? "ยกเลิก" : "Cancel"}
              okButtonProps={{ danger: true }}
              onConfirm={() => erase(row)}
            >
              <Button size="small" danger>{th ? "ลบข้อมูล" : "Erase"}</Button>
            </Popconfirm>
          </Space> },
        ]}
      />

      <Modal
        title={th ? "อัปเดต Lead" : "Update lead"}
        open={Boolean(editing)}
        onCancel={() => { setEditing(null); form.resetFields(); }}
        onOk={() => void save()}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="status" label={th ? "สถานะ" : "Status"} rules={[{ required: true }]}>
            <Select options={STATUSES.map((status) => ({ value: status, label: status }))} />
          </Form.Item>
          <Form.Item name="followUpAt" label={th ? "วันและเวลาที่ต้องติดตาม" : "Follow-up date and time"}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="note" label={th ? "โน้ตภายใน" : "Internal note"} rules={[{ max: 2000 }]}>
            <Input.TextArea rows={5} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
