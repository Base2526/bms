'use client';
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Alert, Typography, Tabs, Space, Select, Input } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
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
const TIME_OPTIONS = [
  { value: "", label: "ทุกช่วงเวลา" },
  { value: "24h", label: "24 ชั่วโมงล่าสุด" },
  { value: "7d", label: "7 วันล่าสุด" },
  { value: "30d", label: "30 วันล่าสุด" },
];
const CONFIRMATION_OPTIONS = [
  { value: "", label: "ทุกสถานะการยืนยัน" },
  { value: "PENDING", label: "รอลูกค้ายืนยันสรุป" },
  { value: "CONFIRMED", label: "ลูกค้ายืนยันแล้ว" },
  { value: "NOT_REQUESTED", label: "ยังไม่ถึงขั้นยืนยัน" },
];

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

function buildColumns() {
  function renderConfirmationStatus(row: any) {
    const confirmationStatus = normalizeConfirmationStatus(row);
    if (confirmationStatus === "CONFIRMED") {
      return (
        <Space direction="vertical" size={2}>
          <Tag color="green">ลูกค้ายืนยันแล้ว</Tag>
          <Text type="secondary">{row.customerConfirmedAt ? new Date(row.customerConfirmedAt).toLocaleString() : "—"}</Text>
        </Space>
      );
    }
    if (confirmationStatus === "PENDING") {
      return <Tag color="gold">รอลูกค้ายืนยันสรุป</Tag>;
    }
    return <Tag>ยังไม่ถึงขั้นยืนยัน</Tag>;
  }

  function renderSummaryPreview(row: any) {
    const lines = Array.isArray(row.customerConfirmationSummary?.lines) ? row.customerConfirmationSummary.lines : [];
    if (lines.length === 0) {
      if ((row.missingFields || []).length > 0) return <Text type="secondary">ยังเก็บข้อมูลไม่ครบ</Text>;
      if ((row.conflictingFields || []).length > 0) return <Text type="warning">มีข้อมูลขัดแย้ง รอแก้ไข</Text>;
      return <Text type="secondary">ยังไม่มี summary สำหรับยืนยัน</Text>;
    }
    const preview = lines
      .slice(0, 2)
      .map((line: any) => `${line.label}: ${line.valueText}`)
      .join(" | ");
    const remaining = lines.length - 2;
    return (
      <Space direction="vertical" size={2}>
        <Text>{preview}</Text>
        {remaining > 0 ? <Text type="secondary">+ อีก {remaining} รายการ</Text> : null}
      </Space>
    );
  }

  return [
    {
      title: "เคส",
      dataIndex: "id",
      key: "id",
      render: (id: string) => <Link href={`/admin/pharmacy-queue/${id}`}>{id.slice(0, 8)}</Link>,
    },
    { title: "ผู้ป่วย", dataIndex: "patientRelationship", key: "patientRelationship" },
    { title: "ช่องทาง", dataIndex: "channelId", key: "channelId", render: (v: string | null) => v || "—" },
    {
      title: "ความเสี่ยง",
      dataIndex: "riskLevel",
      key: "riskLevel",
      render: (v: string) => <Tag color={RISK_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: "สถานะ",
      dataIndex: "status",
      key: "status",
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: "การยืนยันข้อมูล",
      key: "confirmation",
      render: (_: unknown, row: any) => renderConfirmationStatus(row),
    },
    {
      title: "สรุปล่าสุด",
      key: "summaryPreview",
      render: (_: unknown, row: any) => renderSummaryPreview(row),
    },
    {
      title: "AI",
      dataIndex: "needsManualIntake",
      key: "needsManualIntake",
      render: (v: boolean) => (v ? <Tag color="red">ต้องกรอกเอง (AI ไม่พร้อม)</Tag> : <Tag color="default">AI ปกติ</Tag>),
    },
    { title: "อัปเดตล่าสุด", dataIndex: "updatedAt", key: "updatedAt", render: (v: string) => new Date(v).toLocaleString() },
  ];
}

export default function PharmacyQueuePage() {
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
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดคิว Pharmacy Intake ไม่ได้" description={error.message} />;

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
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>AI Pharmacy Intake — คิวเภสัชกร</Typography.Title>}>
        <Space>
          <a onClick={() => refetch()}><ReloadOutlined /> รีเฟรช</a>
        </Space>
      </AdminPageHeader>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="AI เป็นผู้ช่วยเก็บข้อมูลเท่านั้น ไม่วินิจฉัยหรือแนะนำยา — เภสัชกรที่มีใบประกอบวิชาชีพเท่านั้นที่อนุมัติได้จริง (ตรวจซ้ำที่ฝั่ง server เสมอ)"
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as any)}
        items={[
          { key: "emergency", label: "Emergency" },
          { key: "urgent", label: "Urgent" },
          { key: "normal", label: "Normal" },
          { key: "all", label: "ทั้งหมด" },
        ]}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Tag
          color={confirmationFilter === "PENDING" ? "processing" : "gold"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "PENDING" ? "" : "PENDING"))}
        >
          รอลูกค้ายืนยัน {confirmationCounts.PENDING}
        </Tag>
        <Tag
          color={confirmationFilter === "CONFIRMED" ? "processing" : "green"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "CONFIRMED" ? "" : "CONFIRMED"))}
        >
          ยืนยันแล้ว {confirmationCounts.CONFIRMED}
        </Tag>
        <Tag
          color={confirmationFilter === "NOT_REQUESTED" ? "processing" : "default"}
          style={{ cursor: "pointer" }}
          onClick={() => setConfirmationFilter((prev) => (prev === "NOT_REQUESTED" ? "" : "NOT_REQUESTED"))}
        >
          ยังไม่ถึงขั้นยืนยัน {confirmationCounts.NOT_REQUESTED}
        </Tag>
      </Space>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="กรองตามสถานะ"
          style={{ width: 220 }}
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
        />
        <Select
          style={{ width: 220 }}
          options={CONFIRMATION_OPTIONS}
          value={confirmationFilter}
          onChange={(v) => setConfirmationFilter(v)}
        />
        <Input
          placeholder="กรองตามช่องทาง (channel)"
          style={{ width: 200 }}
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        />
        <Select style={{ width: 160 }} options={TIME_OPTIONS} value={timeRange} onChange={(v) => setTimeRange(v)} />
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows} columns={buildColumns()} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />
    </div>
  );
}
