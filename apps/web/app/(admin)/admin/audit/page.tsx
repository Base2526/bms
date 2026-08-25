'use client';
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Typography, Alert, Button, Space, Input, Tooltip } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

const Q = gql`
  query { bmsAuditLog(limit: 200) { id actor action target meta created_at } }
`;

const ACTION_COLOR: Record<string, string> = {
  "order.pay": "blue", "order.pack": "cyan", "order.ship": "geekblue",
  "order.complete": "green", "order.cancel": "default", "order.return": "red",
  "order.reorder": "lime",
  "product.upsert": "orange", "product.active": "gold", "stock.adjust": "volcano",
  "channel.upsert": "purple", "plan.change": "magenta", "rbac.set": "red",
  "inbox.assign": "blue", "inbox.helper_add": "cyan", "inbox.helper_remove": "default",
  "inbox.status": "geekblue", "inbox.tags": "purple", "inbox.reply": "green", "inbox.note": "default",
  "customer.merge": "gold",
};

// ชื่ออ่านง่ายของแต่ละ action (ผ่าน t()) — ไม่มีในนี้ = โชว์ raw key เดิม (กันตกหล่นตอนมี action ใหม่)
function actionLabels(t: (key: string) => string): Record<string, string> {
  return {
    "order.pay": t("admin_audit.action_order_pay"), "order.pack": t("admin_audit.action_order_pack"),
    "order.ship": t("admin_audit.action_order_ship"), "order.complete": t("admin_audit.action_order_complete"),
    "order.cancel": t("admin_audit.action_order_cancel"), "order.return": t("admin_audit.action_order_return"),
    "product.upsert": t("admin_audit.action_product_upsert"), "product.active": t("admin_audit.action_product_active"),
    "stock.adjust": t("admin_audit.action_stock_adjust"), "channel.upsert": t("admin_audit.action_channel_upsert"),
    "plan.change": t("admin_audit.action_plan_change"), "rbac.set": t("admin_audit.action_rbac_set"),
    "inbox.assign": t("admin_audit.action_inbox_assign"), "inbox.helper_add": t("admin_audit.action_inbox_helper_add"),
    "inbox.helper_remove": t("admin_audit.action_inbox_helper_remove"), "inbox.status": t("admin_audit.action_inbox_status"),
    "inbox.tags": t("admin_audit.action_inbox_tags"), "inbox.reply": t("admin_audit.action_inbox_reply"),
    "inbox.note": t("admin_audit.action_inbox_note"),
  };
}

// key ของ meta → ป้ายอ่านง่าย (key ที่ไม่รู้จักโชว์ raw key ไปเลย ไม่ตกหล่น)
function metaKeyLabels(t: (key: string) => string): Record<string, string> {
  return {
    fromUserId: t("admin_audit.meta_from_user_id"), toUserId: t("admin_audit.meta_to_user_id"),
    userId: t("admin_audit.meta_user_id"), status: t("admin_audit.meta_status"),
    auto: t("admin_audit.meta_auto"), count: t("admin_audit.meta_count"),
    assignedTo: t("admin_audit.meta_assigned_to"), reason: t("admin_audit.meta_reason"),
  };
}

function MetaView({ meta, metaKeyLabel, t }: { meta: any; metaKeyLabel: Record<string, string>; t: (key: string) => string }) {
  if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  }
  return (
    <Space direction="vertical" size={2}>
      {Object.entries(meta).map(([k, v]) => (
        <span key={k} style={{ fontSize: 12 }}>
          <Text type="secondary">{metaKeyLabel[k] || k}:</Text>{" "}
          <Text>{typeof v === "boolean" ? (v ? t("admin_audit.bool_yes") : t("admin_audit.bool_no")) : String(v)}</Text>
        </span>
      ))}
    </Space>
  );
}

function TargetView({ target }: { target: string | null }) {
  if (!target) return <Text type="secondary">—</Text>;
  const short = target.length > 12 ? `${target.slice(0, 8)}…` : target;
  return (
    <Tooltip title={target}>
      <Text code style={{ fontSize: 12 }}>{short}</Text>
    </Tooltip>
  );
}

// พ.ศ./เวลาไทย ชัดเจน — ของเดิม new Date(d).toLocaleString() พังเป็น "Invalid Date"
// เพราะ resolver ส่ง created_at มาไม่ถูกฟอร์แมต (แก้ที่ BmsAuditEntry.created_at ใน bmsDashboard.ts แล้ว)
const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "medium" }) : "—";

export default function Page() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [q, setQ] = useState("");
  const actionLabel = useMemo(() => actionLabels(t), [t]);
  const metaKeyLabel = useMemo(() => metaKeyLabels(t), [t]);

  const rows = data?.bmsAuditLog || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r: any) => {
      const hay = [
        r.actor, r.action, actionLabel[r.action], r.target,
        r.meta ? JSON.stringify(r.meta) : "",
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, actionLabel]);

  if (error) return <Alert closable type="error" message={t("admin_audit.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>{t("admin_audit.title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_audit.refresh")}</Button>
        </Space>
      </div>
      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_audit.intro")} />
      <Input.Search
        allowClear placeholder={t("admin_audit.search_placeholder")}
        prefix={<SearchOutlined />}
        style={{ maxWidth: 420, marginBottom: 16 }}
        value={q} onChange={(e) => setQ(e.target.value)}
      />
      <Table
        rowKey="id" loading={loading} dataSource={filtered}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("admin_audit.col_time"), dataIndex: "created_at", width: 190, render: (d: string) => fmtDT(d) },
          { title: t("admin_audit.col_actor"), dataIndex: "actor", width: 200,
            render: (a: string) => a?.startsWith("system:") ? <Tag>{a}</Tag> : a || "—" },
          { title: t("admin_audit.col_action"), dataIndex: "action", width: 220,
            render: (a: string) => <Tag color={ACTION_COLOR[a] || "default"}>{actionLabel[a] || a}</Tag> },
          { title: t("admin_audit.col_target"), dataIndex: "target", width: 140, render: (v: string) => <TargetView target={v} /> },
          { title: t("admin_audit.col_meta"), dataIndex: "meta", render: (m: any) => <MetaView meta={m} metaKeyLabel={metaKeyLabel} t={t} /> },
        ]}
        pagination={{ pageSize: 25, showTotal: (total) => t("admin_audit.total_entries", { total }) }}
      />
    </div>
  );
}
