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

function createdAfterFor(range: string): string | undefined {
  if (!range) return undefined;
  const ms = range === "24h" ? 24 * 3600_000 : range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function buildColumns() {
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

  const rows = (data?.bmsPharmacyAssessments || []).filter((r: any) =>
    tab === "normal" ? !["EMERGENCY", "HIGH"].includes(r.riskLevel) : true
  );

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
        <Select
          allowClear
          placeholder="กรองตามสถานะ"
          style={{ width: 220 }}
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
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
