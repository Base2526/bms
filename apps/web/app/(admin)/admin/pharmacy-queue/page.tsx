'use client';
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Alert, Typography, Tabs, Space, Select, Input, Button, Card } from "antd";
import { ReadOutlined, ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const Q = gql`
  query PharmacyQueue($status: String, $riskLevel: String, $channelId: String, $createdAfter: String) {
    bmsPharmacyAssessments(status: $status, riskLevel: $riskLevel, channelId: $channelId, createdAfter: $createdAfter, limit: 200) {
      id status riskLevel patientRelationship needsManualIntake assignedPharmacistId
      channelId createdAt updatedAt currentQuestionKey
      completenessStatus customerConfirmationStatus customerConfirmedAt
      missingFields conflictingFields
      customerConfirmationSummary
    }
  }
`;

/**
 * บันทึกการจ่ายยาที่เคาน์เตอร์ (9.29)
 *
 * ตารางหลักฐานถูกเขียนพร้อมบิลตั้งแต่ 9.29 แต่ไม่มีที่ไหนอ่าน — หลักฐานที่ต้องเปิด psql
 * เพื่อดู เท่ากับตอบคำถามของคนไม่ได้ · วางไว้หน้าคิวเพราะนี่คือหน้าที่เภสัชกรอยู่จริง
 * · สิทธิ์ pharmacy.audit.read (Pharmacist + Manager) เกณฑ์เดียวกับ audit ของเคส
 */
const Q_COUNTER_LOG = gql`
  query PharmacyCounterLog($from: String) {
    bmsPharmacistCounterAuthorizations(from: $from, limit: 100) {
      total
      items {
        id orderId orderCode taxDocNo productSku productName size qty
        salePolicy policyStatus pharmacistName cashierName note createdAt
      }
    }
  }
`;

/** ป้ายนโยบายที่ถูกปลด — สีเดียวกับความหมายที่หน้า POS ใช้ */
const POLICY_COLOR: Record<string, string> = {
  PRESCRIPTION_REQUIRED: "volcano",
  ONLINE_SALE_PROHIBITED: "magenta",
  PHARMACIST_APPROVAL: "orange",
  SHORT_SAFETY_CHECK: "gold",
  UNKNOWN: "default",
};

function CounterAuthorizationLog({ timeRange }: { timeRange: string }) {
  const { t } = useI18n();
  const { data, loading } = useQuery(Q_COUNTER_LOG, {
    variables: { from: createdAfterFor(timeRange) },
    fetchPolicy: "cache-and-network",
  });
  const page = data?.bmsPharmacistCounterAuthorizations;
  const rows = page?.items ?? [];

  return (
    <Card
      size="small"
      style={{ marginTop: 16 }}
      title={t("admin_pharmacy_queue.counter_log_title")}
      extra={
        <Text type="secondary">
          {t("admin_pharmacy_queue.counter_log_total", { count: page?.total ?? 0 })}
        </Text>
      }
    >
      <Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
        {t("admin_pharmacy_queue.counter_log_hint")}
      </Text>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: t("admin_pharmacy_queue.counter_log_empty") }}
        columns={[
          {
            title: t("admin_pharmacy_queue.counter_col_time"),
            dataIndex: "createdAt",
            key: "createdAt",
            render: (v: string) => new Date(v).toLocaleString(),
          },
          {
            title: t("admin_pharmacy_queue.counter_col_bill"),
            key: "bill",
            render: (_: unknown, row: any) => (
              <Space direction="vertical" size={0}>
                <Text code>{row.orderCode}</Text>
                {row.taxDocNo ? <Text type="secondary">{row.taxDocNo}</Text> : null}
              </Space>
            ),
          },
          {
            title: t("admin_pharmacy_queue.counter_col_drug"),
            key: "product",
            render: (_: unknown, row: any) => (
              <Space direction="vertical" size={0}>
                <Text>{row.productName || row.productSku}</Text>
                <Text type="secondary">{row.productSku} · {row.size}</Text>
              </Space>
            ),
          },
          { title: t("admin_pharmacy_queue.counter_col_qty"), dataIndex: "qty", key: "qty" },
          {
            title: t("admin_pharmacy_queue.counter_col_policy"),
            key: "salePolicy",
            render: (_: unknown, row: any) => (
              <Space direction="vertical" size={0}>
                <Tag color={POLICY_COLOR[row.salePolicy] ?? "default"}>{row.salePolicy}</Tag>
                <Text type="secondary">{row.policyStatus}</Text>
              </Space>
            ),
          },
          {
            title: t("admin_pharmacy_queue.counter_col_pharmacist"),
            dataIndex: "pharmacistName",
            key: "pharmacistName",
            render: (v: string | null) => v || "—",
          },
          {
            title: t("admin_pharmacy_queue.counter_col_cashier"),
            dataIndex: "cashierName",
            key: "cashierName",
            render: (v: string | null) => v || "—",
          },
          {
            title: t("admin_pharmacy_queue.counter_col_note"),
            dataIndex: "note",
            key: "note",
            render: (v: string | null) => v || "—",
          },
        ]}
      />
    </Card>
  );
}

const RISK_COLOR: Record<string, string> = {
  EMERGENCY: "red",
  HIGH: "orange",
  MODERATE: "gold",
  LOW: "green",
  UNKNOWN: "default",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  COLLECTING_INFORMATION: "blue",
  PENDING_CONFIRMATION: "gold",
  WAITING_FOR_PHARMACIST: "orange",
  PHARMACIST_REVIEWING: "purple",
  NEED_MORE_INFORMATION: "gold",
  APPROVED: "green",
  REJECTED: "red",
  REFER_TO_DOCTOR: "cyan",
  EMERGENCY_REFERRAL: "red",
  CLOSED: "default",
};
const STATUS_OPTIONS = Object.keys(STATUS_COLOR).map((v) => ({ value: v, label: v }));

function timeOptions(t: (key: string) => string) {
  return [
    { value: "", label: t("admin_pharmacy_queue.time_all") },
    { value: "24h", label: t("admin_pharmacy_queue.time_24h") },
    { value: "7d", label: t("admin_pharmacy_queue.time_7d") },
    { value: "30d", label: t("admin_pharmacy_queue.time_30d") },
  ];
}
function confirmationOptions(t: (key: string) => string) {
  return [
    { value: "", label: t("admin_pharmacy_queue.confirm_all") },
    { value: "PENDING", label: t("admin_pharmacy_queue.confirm_pending") },
    { value: "CONFIRMED", label: t("admin_pharmacy_queue.confirm_confirmed") },
    { value: "NOT_REQUESTED", label: t("admin_pharmacy_queue.confirm_not_requested") },
  ];
}

function createdAfterFor(range: string): string | undefined {
  if (!range) return undefined;
  const ms = range === "24h" ? 24 * 3600_000 : range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function normalizeConfirmationStatus(row: any): "PENDING" | "CONFIRMED" | "NOT_REQUESTED" {
  if (row.customerConfirmationStatus === "PENDING" || row.status === "PENDING_CONFIRMATION") return "PENDING";
  if (row.customerConfirmationStatus === "CONFIRMED") return "CONFIRMED";
  return "NOT_REQUESTED";
}

function priorityForRow(row: any): number {
  if (row.status === "PENDING_CONFIRMATION") return 0;
  if (normalizeConfirmationStatus(row) === "PENDING") return 1;
  if (row.riskLevel === "EMERGENCY") return 2;
  if (row.riskLevel === "HIGH") return 3;
  if (row.status === "WAITING_FOR_PHARMACIST") return 4;
  if (row.status === "PHARMACIST_REVIEWING") return 5;
  return 6;
}

function buildColumns(t: (key: string, vars?: Record<string, any>) => string) {
  function renderConfirmationStatus(row: any) {
    const confirmationStatus = normalizeConfirmationStatus(row);
    if (confirmationStatus === "CONFIRMED") {
      return (
        <Space direction="vertical" size={2}>
          <Tag color="green">{t("admin_pharmacy_queue.confirm_confirmed")}</Tag>
          <Text type="secondary">{row.customerConfirmedAt ? new Date(row.customerConfirmedAt).toLocaleString() : "—"}</Text>
        </Space>
      );
    }
    if (confirmationStatus === "PENDING") {
      return <Tag color="gold">{t("admin_pharmacy_queue.confirm_pending")}</Tag>;
    }
    return <Tag>{t("admin_pharmacy_queue.confirm_not_requested")}</Tag>;
  }

  function renderSummaryPreview(row: any) {
    const lines = Array.isArray(row.customerConfirmationSummary?.lines) ? row.customerConfirmationSummary.lines : [];
    if (lines.length === 0) {
      if ((row.missingFields || []).length > 0) return <Text type="secondary">{t("admin_pharmacy_queue.summary_incomplete")}</Text>;
      if ((row.conflictingFields || []).length > 0) return <Text type="warning">{t("admin_pharmacy_queue.summary_conflict")}</Text>;
      return <Text type="secondary">{t("admin_pharmacy_queue.summary_none")}</Text>;
    }
    const preview = lines
      .slice(0, 2)
      .map((line: any) => `${line.label}: ${line.valueText}`)
      .join(" | ");
    const remaining = lines.length - 2;
    return (
      <Space direction="vertical" size={2}>
        <Text>{preview}</Text>
        {remaining > 0 ? <Text type="secondary">{t("admin_pharmacy_queue.summary_more", { count: remaining })}</Text> : null}
      </Space>
    );
  }

  return [
    {
      title: t("admin_pharmacy_queue.col_case"),
      dataIndex: "id",
      key: "id",
      render: (id: string) => <Link href={`/admin/pharmacy-queue/${id}`}>{id.slice(0, 8)}</Link>,
    },
    { title: t("admin_pharmacy_queue.col_patient"), dataIndex: "patientRelationship", key: "patientRelationship" },
    { title: t("admin_pharmacy_queue.col_channel"), dataIndex: "channelId", key: "channelId", render: (v: string | null) => v || "—" },
    {
      title: t("admin_pharmacy_queue.col_risk"),
      dataIndex: "riskLevel",
      key: "riskLevel",
      render: (v: string) => <Tag color={RISK_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: t("admin_pharmacy_queue.col_status"),
      dataIndex: "status",
      key: "status",
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: t("admin_pharmacy_queue.col_confirmation"),
      key: "confirmation",
      render: (_: unknown, row: any) => renderConfirmationStatus(row),
    },
    {
      title: t("admin_pharmacy_queue.col_summary"),
      key: "summaryPreview",
      render: (_: unknown, row: any) => renderSummaryPreview(row),
    },
    {
      title: t("admin_pharmacy_queue.col_ai"),
      dataIndex: "needsManualIntake",
      key: "needsManualIntake",
      render: (v: boolean) => (v ? <Tag color="red">{t("admin_pharmacy_queue.ai_manual_required")}</Tag> : <Tag color="default">{t("admin_pharmacy_queue.ai_normal")}</Tag>),
    },
    { title: t("admin_pharmacy_queue.col_updated_at"), dataIndex: "updatedAt", key: "updatedAt", render: (v: string) => new Date(v).toLocaleString() },
  ];
}

export default function PharmacyQueuePage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [tab, setTab] = useState<"emergency" | "urgent" | "normal" | "all">("emergency");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [confirmationFilter, setConfirmationFilter] = useState<string>("");
  const [channelFilter, setChannelFilter] = useState("");
  const [timeRange, setTimeRange] = useState("");

  // "ร้าน" (store) — the whole admin app is already scoped to the shop the
  // staff is logged into (or drilled into as a platform admin); there is no
  // separate cross-store selector anywhere else in the BMS admin UI, so no
  // fake one is added here either.
  const variables = useMemo(
    () => ({
      riskLevel: tab === "emergency" ? "EMERGENCY" : tab === "urgent" ? "HIGH" : undefined,
      status: statusFilter,
      channelId: channelFilter.trim() || undefined,
      createdAfter: createdAfterFor(timeRange),
    }),
    [tab, statusFilter, channelFilter, timeRange]
  );

  const { data, loading, error, refetch } = useQuery(Q, {
    variables,
    skip: permsLoading || !can("pharmacy.assessment.read"),
    fetchPolicy: "cache-and-network",
    pollInterval: 20000,
  });

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert closable type="warning" showIcon message={t("admin_pharmacy_queue.no_permission")} />;
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_pharmacy_queue.load_error")} description={error.message} />;

  const baseRows = data?.bmsPharmacyAssessments || [];
  const confirmationCounts = baseRows.reduce(
    (acc: Record<string, number>, row: any) => {
      const key = normalizeConfirmationStatus(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { PENDING: 0, CONFIRMED: 0, NOT_REQUESTED: 0 }
  );
  const rows = baseRows
    .filter((r: any) => {
    const matchesRisk = tab === "normal" ? !["EMERGENCY", "HIGH"].includes(r.riskLevel) : true;
    const normalizedConfirmation = normalizeConfirmationStatus(r);
    const matchesConfirmation = !confirmationFilter || normalizedConfirmation === confirmationFilter;
    return matchesRisk && matchesConfirmation;
    })
    .sort((a: any, b: any) => {
      const priorityDiff = priorityForRow(a) - priorityForRow(b);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_pharmacy_queue.title")}</Typography.Title>}>
        <Space>
          <Link href="/admin/pharmacy-manual"><Button icon={<ReadOutlined />}>{t("admin_pharmacy_queue.manual_link")}</Button></Link>
          <a onClick={() => refetch()}><ReloadOutlined /> {t("admin_pharmacy_queue.refresh")}</a>
        </Space>
      </AdminPageHeader>
      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacy_queue.ai_disclaimer")}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as any)}
        items={[
          { key: "emergency", label: t("admin_pharmacy_queue.tab_emergency") },
          { key: "urgent", label: t("admin_pharmacy_queue.tab_urgent") },
          { key: "normal", label: t("admin_pharmacy_queue.tab_normal") },
          { key: "all", label: t("admin_pharmacy_queue.tab_all") },
        ]}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Tag
          color={confirmationFilter === "PENDING" ? "processing" : "gold"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "PENDING" ? "" : "PENDING"))}
        >
          {t("admin_pharmacy_queue.confirmation_pending_tag", { count: confirmationCounts.PENDING })}
        </Tag>
        <Tag
          color={confirmationFilter === "CONFIRMED" ? "processing" : "green"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "CONFIRMED" ? "" : "CONFIRMED"))}
        >
          {t("admin_pharmacy_queue.confirmation_confirmed_tag", { count: confirmationCounts.CONFIRMED })}
        </Tag>
        <Tag
          color={confirmationFilter === "NOT_REQUESTED" ? "processing" : "default"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "NOT_REQUESTED" ? "" : "NOT_REQUESTED"))}
        >
          {t("admin_pharmacy_queue.confirmation_not_requested_tag", { count: confirmationCounts.NOT_REQUESTED })}
        </Tag>
      </Space>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder={t("admin_pharmacy_queue.filter_status_placeholder")}
          style={{ width: 220 }}
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
        />
        <Select
          style={{ width: 220 }}
          options={confirmationOptions(t)}
          value={confirmationFilter}
          onChange={(v) => setConfirmationFilter(v)}
        />
        <Input
          placeholder={t("admin_pharmacy_queue.filter_channel_placeholder")}
          style={{ width: 200 }}
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        />
        <Select style={{ width: 160 }} options={timeOptions(t)} value={timeRange} onChange={(v) => setTimeRange(v)} />
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows} columns={buildColumns(t)} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />
      {/* ตัวกรองช่วงเวลาเดียวกับคิว — คนที่ถามว่า "วันนี้จ่ายอะไรออกไป" ไม่ต้องตั้งค่าสองที่ */}
      {can("pharmacy.audit.read") && <CounterAuthorizationLog timeRange={timeRange} />}
    </div>
  );
}
