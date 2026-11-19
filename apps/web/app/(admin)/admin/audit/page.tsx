"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Typography, Alert, Button, Space, Input, Tooltip, Modal, Timeline, Empty, Spin } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

const Q = gql`
  query AuditTimeline($filter: BmsAuditTimelineFilter, $platformGlobal: Boolean) {
    bmsIsPlatformAdmin
    bmsActingTenant { id }
    bmsAuditTimeline(filter: $filter, platformGlobal: $platformGlobal) {
      nodes { id source actor actorUserId action target meta outcome created_at }
      nextCursor
    }
  }
`;

const ACTOR_FLOW_Q = gql`
  query AuditActorFlow($filter: BmsAuditTimelineFilter, $platformGlobal: Boolean) {
    bmsAuditTimeline(filter: $filter, platformGlobal: $platformGlobal) {
      nodes { id source actor actorUserId action target meta outcome created_at }
      nextCursor
    }
  }
`;

type AuditEntry = {
  id: string;
  source: string;
  actor: string | null;
  actorUserId: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  outcome: string | null;
  created_at: string;
};

type SelectedActor = { id: string; label: string };

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
const fmtDT = (iso?: string | null, uiText: UiTranslator = thaiUiText) =>
  iso ? new Date(iso).toLocaleString(uiText.locale, { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "medium" }) : "—";

function ActorFlowDialog({ actor, platformGlobal, onClose, actionLabel, metaKeyLabel, t, uiText }: {
  actor: SelectedActor;
  platformGlobal: boolean;
  onClose: () => void;
  actionLabel: Record<string, string>;
  metaKeyLabel: Record<string, string>;
  t: (key: string) => string;
  uiText: UiTranslator;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const filter = { actorUserId: actor.id, cursor: cursors[cursors.length - 1], limit: 30 };
  const { data, loading, error } = useQuery(ACTOR_FLOW_Q, {
    variables: { filter, platformGlobal },
    fetchPolicy: "no-cache",
  });
  // Only the current page enters the DOM; older pages remain available by cursor.
  const rows = (loading ? [] : data?.bmsAuditTimeline?.nodes ?? []) as AuditEntry[];
  const nextCursor = data?.bmsAuditTimeline?.nextCursor as string | null;

  return <Modal open onCancel={onClose} footer={null} width={760}
    title={t("admin_audit.actor_flow_title").replace("{actor}", actor.label)}
    styles={{ body: { maxHeight: "min(70vh, 720px)", overflowY: "auto" } }}>
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Text code copyable style={{ overflowWrap: "anywhere" }}>{actor.id}</Text>
      <Alert type="info" showIcon closable message={t("admin_audit.actor_flow_notice")} />
      {error && <Alert type="error" showIcon closable message={t("admin_audit.load_error")} description={error.message} />}
      {loading && rows.length === 0 ? <Spin /> : rows.length === 0 && !error ? <Empty description={t("admin_audit.actor_flow_empty")} /> : null}
      {rows.length > 0 && <Timeline items={rows.map((entry) => ({
        key: entry.id,
        color: entry.outcome === "DENIED" || entry.outcome === "ERROR" ? "red"
          : entry.outcome === "SUCCESS" ? "green" : "blue",
        children: <div style={{ minWidth: 0, overflowWrap: "anywhere", paddingBottom: 8 }}>
          <Text type="secondary">{fmtDT(entry.created_at, uiText)}</Text>
          <div style={{ marginTop: 4 }}>
            <Tag color={ACTION_COLOR[entry.action] || "default"}>{actionLabel[entry.action] || entry.action}</Tag>
            <Tag>{entry.source}</Tag>
            {entry.outcome && <Tag color={entry.outcome === "SUCCESS" ? "green" : "red"}>{entry.outcome}</Tag>}
          </div>
          {entry.target && <div style={{ marginTop: 5 }}><Text type="secondary">{t("admin_audit.col_target")}: </Text><TargetView target={entry.target} /></div>}
          {entry.meta && Object.keys(entry.meta).length > 0 && <div style={{ marginTop: 5 }}>
            <MetaView meta={entry.meta} metaKeyLabel={metaKeyLabel} t={t} />
          </div>}
        </div>,
      }))} />}
      {(cursors.length > 1 || nextCursor) && <Space wrap>
        <Button disabled={loading || cursors.length === 1}
          onClick={() => setCursors((current) => current.slice(0, -1))}>{t("admin_audit.flow_previous")}</Button>
        <Text type="secondary">{t("admin_audit.flow_page")
          .replace("{page}", String(cursors.length)).replace("{count}", String(rows.length))}</Text>
        <Button disabled={loading || !nextCursor}
          onClick={() => { if (nextCursor) setCursors((current) => [...current, nextCursor]); }}>
          {t("admin_audit.flow_next")}
        </Button>
      </Space>}
    </Space>
  </Modal>;
}

export default function Page() {
  const uiText = useUiText();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [platformGlobal, setPlatformGlobal] = useState(false);
  const [selectedActor, setSelectedActor] = useState<SelectedActor | null>(null);
  const [applied, setApplied] = useState({ q: "", actorUserId: "", from: "", to: "" });
  const filter = {
    q: applied.q || null,
    actorUserId: applied.actorUserId || null,
    from: applied.from ? new Date(`${applied.from}T00:00:00+07:00`).toISOString() : null,
    to: applied.to ? new Date(new Date(`${applied.to}T00:00:00+07:00`).getTime() + 86_400_000).toISOString() : null,
    limit: 50,
  };
  const { data, loading, error, refetch, fetchMore } = useQuery(Q, {
    variables: { filter, platformGlobal }, fetchPolicy: "cache-and-network",
  });
  const actionLabel = useMemo(() => actionLabels(t), [t]);
  const metaKeyLabel = useMemo(() => metaKeyLabels(t), [t]);

  const rows = data?.bmsAuditTimeline?.nodes || [];
  const nextCursor = data?.bmsAuditTimeline?.nextCursor as string | null;
  const applyFilters = () => setApplied({ q: q.trim(), actorUserId: actorUserId.trim(), from, to });
  const loadMore = () => {
    if (!nextCursor) return;
    void fetchMore({
      variables: { filter: { ...filter, cursor: nextCursor }, platformGlobal },
      updateQuery: (previous: any, { fetchMoreResult }: any) => {
        if (!fetchMoreResult) return previous;
        return { ...previous, bmsAuditTimeline: {
          ...fetchMoreResult.bmsAuditTimeline,
          nodes: [...previous.bmsAuditTimeline.nodes, ...fetchMoreResult.bmsAuditTimeline.nodes],
        } };
      },
    });
  };

  if (error) return <Alert closable type="error" message={t("admin_audit.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>{t("admin_audit.title")}</h2>
          <Space>
            {data?.bmsIsPlatformAdmin && data?.bmsActingTenant && <Button onClick={() => { setSelectedActor(null); setPlatformGlobal(!platformGlobal); }}>
              {platformGlobal ? t("admin_audit.tenant_events") : t("admin_audit.platform_events")}
            </Button>}
            <Tag>{data?.bmsIsPlatformAdmin && (!data?.bmsActingTenant || platformGlobal)
              ? t("admin_audit.platform_events") : t("admin_audit.tenant_events")}</Tag>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_audit.refresh")}</Button>
          </Space>
        </Space>
      </div>
      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_audit.intro")} />
      <Input.Search
        allowClear placeholder={t("admin_audit.search_placeholder")}
        prefix={<SearchOutlined />}
        style={{ maxWidth: 420, marginBottom: 16 }}
        value={q} onChange={(e) => setQ(e.target.value)} onSearch={applyFilters}
      />
      <Space wrap style={{ marginBottom: 16, marginLeft: 8 }}>
        <Input aria-label={t("admin_audit.actor_id")} placeholder={t("admin_audit.actor_id")}
          style={{ width: 250 }} value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} />
        <label>{t("admin_audit.from_date")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{t("admin_audit.to_date")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button onClick={applyFilters}>{t("admin_audit.apply_filters")}</Button>
      </Space>
      <Table
        rowKey="id" loading={loading} dataSource={rows}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("admin_audit.col_time"), dataIndex: "created_at", width: 190, render: (d: string) => fmtDT(d, uiText) },
          { title: t("admin_audit.col_actor"), dataIndex: "actor", width: 200,
            render: (a: string | null, row: AuditEntry) => row.actorUserId
              ? <Button type="link" style={{ padding: 0, height: "auto", whiteSpace: "normal", textAlign: "left" }}
                  onClick={() => setSelectedActor({ id: row.actorUserId!, label: a || row.actorUserId! })}
                  aria-label={t("admin_audit.actor_flow_open").replace("{actor}", a || row.actorUserId!)}>
                  {a || row.actorUserId}
                </Button>
              : a?.startsWith("system:") ? <Tag>{a}</Tag>
                : a ? <Tooltip title={t("admin_audit.actor_unverified")}><Text>{a}</Text></Tooltip> : "—" },
          { title: t("admin_audit.col_source"), dataIndex: "source", width: 110,
            render: (v: string) => <Tag>{v}</Tag> },
          { title: t("admin_audit.col_action"), dataIndex: "action", width: 220,
            render: (a: string) => <Tag color={ACTION_COLOR[a] || "default"}>{actionLabel[a] || a}</Tag> },
          { title: t("admin_audit.col_outcome"), dataIndex: "outcome", width: 110,
            render: (v: string | null) => v ? <Tag>{v}</Tag> : "—" },
          { title: t("admin_audit.col_target"), dataIndex: "target", width: 140, render: (v: string) => <TargetView target={v} /> },
          { title: t("admin_audit.col_meta"), dataIndex: "meta", render: (m: any) => <MetaView meta={m} metaKeyLabel={metaKeyLabel} t={t} /> },
        ]}
        pagination={{ pageSize: 25, showTotal: (total) => t("admin_audit.loaded_entries", { total }) }}
      />
      {nextCursor && <Button onClick={loadMore} loading={loading}>{t("admin_audit.load_more")}</Button>}
      {selectedActor && <ActorFlowDialog actor={selectedActor} platformGlobal={platformGlobal}
        onClose={() => setSelectedActor(null)} actionLabel={actionLabel}
        metaKeyLabel={metaKeyLabel} t={t} uiText={uiText} />}
    </div>
  );
}
