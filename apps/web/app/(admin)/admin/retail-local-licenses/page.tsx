"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

type EffectiveStatus =
  | "TRIAL_ACTIVE" | "TRIAL_EXPIRING" | "TRIAL_EXPIRED"
  | "PAID_ACTIVE" | "PAYMENT_REVIEW" | "CANCELLED";

type LicenseRow = {
  id: string;
  license_code: string;
  customer_reference: string | null;
  status: string;
  license_type: "TRIAL" | "PAID";
  effective_commercial_status: EffectiveStatus;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  trial_days_remaining: number | null;
  max_active_installations: number;
  active_installation_count: number;
  open_review_count: number;
  last_seen_at: string | null;
};

type CommercialAction = "CONVERT_TO_PAID" | "EXTEND_TRIAL" | "MARK_PAYMENT_REVIEW" | "REACTIVATE" | "CANCEL";

const CONFIRMATIONS: Record<CommercialAction, string> = {
  CONVERT_TO_PAID: "CONVERT-RETAIL-LOCAL-TO-PAID",
  EXTEND_TRIAL: "EXTEND-RETAIL-LOCAL-TRIAL",
  MARK_PAYMENT_REVIEW: "MARK-RETAIL-LOCAL-PAYMENT-REVIEW",
  REACTIVATE: "REACTIVATE-RETAIL-LOCAL-LICENSE",
  CANCEL: "CANCEL-RETAIL-LOCAL-LICENSE",
};

const STATUS_COLOR: Record<EffectiveStatus, string> = {
  TRIAL_ACTIVE: "blue",
  TRIAL_EXPIRING: "gold",
  TRIAL_EXPIRED: "orange",
  PAID_ACTIVE: "green",
  PAYMENT_REVIEW: "purple",
  CANCELLED: "default",
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

export default function RetailLocalLicensesPage() {
  const { lang } = useI18n();
  const th = lang === "th";
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [issued, setIssued] = useState<any>(null);
  const [actionTarget, setActionTarget] = useState<LicenseRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [action, setAction] = useState<CommercialAction>("EXTEND_TRIAL");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();

  const copy = th ? {
    title: "License BMS Retail Local",
    subtitle: "ออก Trial 30 วันและจัดการสถานะเชิงพาณิชย์ โดยไม่ปิดกั้นการทำงานของร้าน",
    create: "ออก License",
    refresh: "รีเฟรช",
    customer: "ลูกค้า / เลขอ้างอิง",
    type: "ประเภท",
    status: "สถานะ",
    expiry: "วันหมด Trial",
    installs: "เครื่องใช้งาน",
    reviews: "เคสตรวจสอบ",
    lastSeen: "พบล่าสุด",
    actions: "จัดการ",
    details: "รายละเอียด",
    noExpiry: "ไม่มีวันหมดอายุ",
    issueTitle: "ออก License ใหม่",
    tokenTitle: "เก็บ Token นี้ทันที",
    tokenWarning: "Token แสดงครั้งเดียว ใช้ส่งผ่าน commercial bootstrap เท่านั้น ห้ามส่งใน log หรืออีเมล",
    failOpen: "Trial หมดอายุหรืออยู่ระหว่างตรวจสอบจะไม่หยุด POS, การชำระเงิน, สต็อก, รายงาน, backup, restore หรือการเข้าถึงข้อมูลของร้าน",
    saved: "บันทึกเรียบร้อย",
  } : {
    title: "BMS Retail Local licenses",
    subtitle: "Issue 30-day trials and manage commercial state without blocking store operations",
    create: "Issue license",
    refresh: "Refresh",
    customer: "Customer / reference",
    type: "Type",
    status: "Status",
    expiry: "Trial expiry",
    installs: "Active installs",
    reviews: "Review cases",
    lastSeen: "Last seen",
    actions: "Manage",
    details: "Details",
    noExpiry: "No expiry",
    issueTitle: "Issue a license",
    tokenTitle: "Save this token now",
    tokenWarning: "The token is shown once. Deliver it through the commercial bootstrap only; never put it in logs or email.",
    failOpen: "Trial expiry or review never interrupts POS, payments, stock, reports, backup, restore, or access to the shop's data.",
    saved: "Saved",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await jsonRequest<{ licenses: LicenseRow[] }>("/api/admin/retail-local/licenses");
      setRows(result.licenses);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    trials: rows.filter((row) => row.license_type === "TRIAL").length,
    expiring: rows.filter((row) => row.effective_commercial_status === "TRIAL_EXPIRING").length,
    expired: rows.filter((row) => row.effective_commercial_status === "TRIAL_EXPIRED").length,
    review: rows.reduce((sum, row) => sum + Number(row.open_review_count || 0), 0),
  }), [rows]);

  const issueLicense = async () => {
    const values = await createForm.validateFields();
    setCreateBusy(true);
    try {
      const result = await jsonRequest<any>("/api/admin/retail-local/licenses", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setIssued(result);
      setCreateOpen(false);
      createForm.resetFields();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  };

  const applyAction = async () => {
    if (!actionTarget) return;
    const values = await actionForm.validateFields();
    setActionBusy(true);
    try {
      await jsonRequest(`/api/admin/retail-local/licenses/${actionTarget.id}/commercial`, {
        method: "POST",
        body: JSON.stringify({
          action,
          extensionDays: action === "EXTEND_TRIAL" ? values.extensionDays : undefined,
          reason: values.reason,
          confirmation: CONFIRMATIONS[action],
        }),
      });
      message.success(copy.saved);
      setActionTarget(null);
      actionForm.resetFields();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  const openDetails = async (row: LicenseRow) => {
    setDetailOpen(true);
    setDetailBusy(true);
    setDetail(null);
    try {
      setDetail(await jsonRequest(`/api/admin/retail-local/licenses/${row.id}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailBusy(false);
    }
  };

  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";

  const columns = [
    {
      title: copy.customer,
      key: "customer",
      render: (_: unknown, row: LicenseRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.customer_reference || "—"}</Typography.Text>
          <Typography.Text code copyable>{row.license_code}</Typography.Text>
        </Space>
      ),
    },
    { title: copy.type, dataIndex: "license_type", width: 90, render: (value: string) => <Tag>{value}</Tag> },
    {
      title: copy.status,
      dataIndex: "effective_commercial_status",
      width: 165,
      render: (value: EffectiveStatus) => <Tag color={STATUS_COLOR[value]}>{value}</Tag>,
    },
    {
      title: copy.expiry,
      key: "expiry",
      width: 190,
      render: (_: unknown, row: LicenseRow) => row.license_type === "TRIAL" ? (
        <Space direction="vertical" size={0}>
          <span>{formatDate(row.trial_expires_at)}</span>
          <Typography.Text type="secondary">
            {th ? `เหลือ ${row.trial_days_remaining ?? 0} วัน` : `${row.trial_days_remaining ?? 0} day(s) left`}
          </Typography.Text>
        </Space>
      ) : copy.noExpiry,
    },
    { title: copy.installs, width: 110, render: (_: unknown, row: LicenseRow) => `${row.active_installation_count}/${row.max_active_installations}` },
    { title: copy.reviews, dataIndex: "open_review_count", width: 105 },
    { title: copy.lastSeen, dataIndex: "last_seen_at", width: 180, render: formatDate },
    {
      title: "",
      key: "actions",
      fixed: "right" as const,
      width: 190,
      render: (_: unknown, row: LicenseRow) => (
        <Space>
          <Button size="small" onClick={() => void openDetails(row)}>{copy.details}</Button>
          <Button size="small" icon={<SettingOutlined />} onClick={() => {
            setActionTarget(row);
            setAction(row.license_type === "TRIAL" ? "EXTEND_TRIAL" : "MARK_PAYMENT_REVIEW");
          }}>{copy.actions}</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}><SafetyCertificateOutlined /> {copy.title}</Typography.Title>
          <Typography.Text type="secondary">{copy.subtitle}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>{copy.refresh}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{copy.create}</Button>
        </Space>
      </Space>

      <Alert type="info" showIcon closable message={copy.failOpen} style={{ marginBottom: 16 }} />
      {loadError && <Alert type="error" showIcon closable message={loadError} style={{ marginBottom: 16 }} />}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={th ? "Trial ทั้งหมด" : "All trials"} value={stats.trials} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={th ? "ใกล้หมด" : "Expiring"} value={stats.expiring} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={th ? "หมด Trial" : "Expired"} value={stats.expired} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={th ? "รอตรวจสอบ" : "Open reviews"} value={stats.review} /></Card></Col>
      </Row>

      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} scroll={{ x: 1150 }} pagination={{ pageSize: 20 }} />

      <Modal title={copy.issueTitle} open={createOpen} onCancel={() => setCreateOpen(false)}
        onOk={() => void issueLicense()} confirmLoading={createBusy} destroyOnClose>
        <Form form={createForm} layout="vertical" initialValues={{ licenseType: "TRIAL", maxActiveInstallations: 1 }}>
          <Form.Item name="customerReference" label={copy.customer}
            rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ }]}>
            <Input placeholder="customer-001" />
          </Form.Item>
          <Form.Item name="licenseType" label={copy.type} rules={[{ required: true }]}>
            <Select options={[{ value: "TRIAL", label: "TRIAL · 30 days" }, { value: "PAID", label: "PAID" }]} />
          </Form.Item>
          <Form.Item name="maxActiveInstallations" label={th ? "จำนวนเครื่องสูงสุด" : "Maximum active installations"}
            rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={copy.tokenTitle} open={Boolean(issued)} onCancel={() => setIssued(null)}
        footer={<Button type="primary" onClick={() => setIssued(null)}>OK</Button>}>
        <Alert type="warning" showIcon closable message={copy.tokenWarning} style={{ marginBottom: 12 }} />
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="License"><Typography.Text copyable>{issued?.licenseCode}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="Token">
            <Typography.Paragraph code copyable={{ icon: <CopyOutlined /> }} style={{ wordBreak: "break-all", margin: 0 }}>
              {issued?.ingestionToken}
            </Typography.Paragraph>
          </Descriptions.Item>
          {issued?.trialExpiresAt && <Descriptions.Item label={copy.expiry}>{formatDate(issued.trialExpiresAt)}</Descriptions.Item>}
        </Descriptions>
      </Modal>

      <Modal title={`${copy.actions} · ${actionTarget?.license_code ?? ""}`} open={Boolean(actionTarget)}
        onCancel={() => setActionTarget(null)} onOk={() => void applyAction()} confirmLoading={actionBusy} destroyOnClose>
        <Form form={actionForm} layout="vertical" initialValues={{ extensionDays: 30 }}>
          <Form.Item label={th ? "การดำเนินการ" : "Action"} required>
            <Select value={action} onChange={setAction} options={[
              ...(actionTarget?.license_type === "TRIAL" ? [
                { value: "EXTEND_TRIAL", label: th ? "ต่อ Trial" : "Extend trial" },
                { value: "CONVERT_TO_PAID", label: th ? "แปลงเป็น Paid" : "Convert to paid" },
              ] : []),
              { value: "MARK_PAYMENT_REVIEW", label: th ? "รอตรวจสอบการชำระ" : "Mark payment review" },
              { value: "REACTIVATE", label: th ? "เปิดสถานะเชิงพาณิชย์อีกครั้ง" : "Reactivate commercial record" },
              { value: "CANCEL", label: th ? "ยกเลิกสถานะเชิงพาณิชย์" : "Cancel commercial record" },
            ]} />
          </Form.Item>
          {action === "EXTEND_TRIAL" && (
            <Form.Item name="extensionDays" label={th ? "จำนวนวันที่ต่อ" : "Extension days"}
              rules={[{ required: true }]}>
              <InputNumber min={1} max={90} style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Form.Item name="reason" label={th ? "เหตุผล (บันทึกใน audit)" : "Reason (recorded in audit)"}
            rules={[{ required: true, min: 3, max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
          <Typography.Text type="secondary">Confirmation: <Typography.Text code>{CONFIRMATIONS[action]}</Typography.Text></Typography.Text>
        </Form>
      </Modal>

      <Drawer title={copy.details} open={detailOpen} onClose={() => setDetailOpen(false)} width={720} loading={detailBusy}>
        {detail && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="License"><Typography.Text copyable>{detail.license.license_code}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label={copy.status}><Tag color={STATUS_COLOR[detail.license.effective_commercial_status as EffectiveStatus]}>{detail.license.effective_commercial_status}</Tag></Descriptions.Item>
              <Descriptions.Item label={copy.expiry}>{formatDate(detail.license.trial_expires_at)}</Descriptions.Item>
              <Descriptions.Item label={copy.installs}>{detail.installations.length}</Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>{th ? "ประวัติเชิงพาณิชย์" : "Commercial history"}</Typography.Title>
              <Timeline items={(detail.commercialEvents || []).map((event: any) => ({
                children: <div><b>{event.action}</b> · {event.previous_status || "—"} → {event.next_status}<br /><Typography.Text type="secondary">{formatDate(event.occurred_at)} · {event.reason}</Typography.Text></div>,
              }))} />
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
