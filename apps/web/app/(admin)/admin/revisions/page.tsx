'use client';
import { gql, useLazyQuery, useQuery } from "@apollo/client";
import { Alert, Button, Card, Drawer, Input, Modal, Select, Space, Table, Tag, Typography, message, Descriptions } from "antd";
import { useMemo, useState } from "react";
import { ReloadOutlined, DiffOutlined, FileTextOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const KIND_OPTIONS = [
  { value: "products", label: "Products" },
  { value: "orders", label: "Orders" },
  { value: "payments", label: "Payments" },
  { value: "shipments", label: "Shipments" },
  { value: "purchase", label: "Purchase Orders" },
  { value: "purchaseItems", label: "Purchase Order Items" },
];

const Q_HISTORY = gql`
  query ($kind: BmsRevisionKind!, $entityId: ID!, $limit: Int) {
    bmsRevisionHistory(kind: $kind, entityId: $entityId, limit: $limit) {
      id tenant_id editor_id editorLabel revision_id kind kindLabel entityId snapshot created_at
    }
  }
`;
const Q_DETAIL = gql`
  query ($kind: BmsRevisionKind!, $revisionId: ID!) {
    bmsRevisionDetail(kind: $kind, revisionId: $revisionId) {
      id tenant_id editor_id editorLabel revision_id kind kindLabel entityId snapshot created_at
    }
  }
`;
const Q_COMPARE = gql`
  query ($kind: BmsRevisionKind!, $fromRevisionId: ID!, $toRevisionId: ID!) {
    bmsRevisionCompare(kind: $kind, fromRevisionId: $fromRevisionId, toRevisionId: $toRevisionId) {
      kind kindLabel fromRevisionId toRevisionId fromSnapshot toSnapshot diff { path before after }
    }
  }
`;

const fmtDT = (v?: string | number | null) => {
  if (v == null || v === "") return "—";
  const date = typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))
    ? new Date(Number(v))
    : new Date(v);
  if (Number.isNaN(date.getTime())) return String(v);
  return date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
};

function summarizeSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return String(snapshot ?? "—");
  const keys = Object.keys(snapshot);
  const summary = keys.slice(0, 4).map((k) => `${k}: ${typeof snapshot[k] === "object" ? "[…]" : String(snapshot[k])}`);
  return summary.join(" · ") + (keys.length > 4 ? " · …" : "");
}

export default function Page() {
  const { can } = useBmsPermissions();
  const [kind, setKind] = useState<"products" | "orders" | "payments" | "shipments" | "purchase" | "purchaseItems">("products");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const { data, loading, error, refetch } = useQuery(Q_HISTORY, {
    variables: { kind, entityId: search, limit: 50 },
    fetchPolicy: "cache-and-network",
  });

  const [loadDetail, { data: detailData, loading: detailLoading }] = useLazyQuery(Q_DETAIL, {
    fetchPolicy: "network-only",
    onError: (e: any) => message.error(e?.message || "โหลด detail ไม่ได้"),
  });
  const [loadCompare, { data: compareData, loading: compareLoading }] = useLazyQuery(Q_COMPARE, {
    fetchPolicy: "network-only",
    onError: (e: any) => message.error(e?.message || "compare ไม่ได้"),
  });

  const rows = data?.bmsRevisionHistory || [];
  const compareReady = selectedIds.length === 2;

  const openDetail = async (row: any) => {
    const res = await loadDetail({ variables: { kind, revisionId: row.id } } as any);
    setDetail(res?.data?.bmsRevisionDetail ?? row);
  };

  const onCompare = async () => {
    if (selectedIds.length !== 2) return;
    await loadCompare({ variables: { kind, fromRevisionId: selectedIds[0], toRevisionId: selectedIds[1] } } as any);
    setCompareOpen(true);
  };

  const columns = useMemo(() => [
    { title: "Revision", dataIndex: "id", width: 120, render: (v: string) => <Typography.Text code>{v.slice(0, 8)}</Typography.Text> },
    { title: "เมื่อ", dataIndex: "created_at", width: 180, render: (v: string) => fmtDT(v) },
    { title: "Editor", dataIndex: "editorLabel", width: 220, render: (v: string | null) => v ? <Typography.Text>{v}</Typography.Text> : <Tag>system</Tag> },
    { title: "Revision ID", dataIndex: "revision_id", width: 200, render: (v: string | null) => v ? <Typography.Text code>{v.slice(0, 8)}</Typography.Text> : <span style={{ color: "#999" }}>—</span> },
    { title: "Snapshot", dataIndex: "snapshot", render: (v: any) => <span>{summarizeSnapshot(v)}</span> },
    { title: "Action", width: 110, render: (_: any, row: any) => <Button size="small" icon={<FileTextOutlined />} onClick={() => openDetail(row)}>Detail</Button> },
  ], [kind]);

  if (!can("product.view") && !can("order.view") && !can("payment.view") && !can("shipping.view") && !can("purchase.view")) {
    return <Alert type="error" message="ไม่มีสิทธิ์ดู revision" showIcon />;
  }

  const detailRow = detailData?.bmsRevisionDetail || detail;
  const compare = compareData?.bmsRevisionCompare;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Revision History</h2>
          <Space wrap>
            <Select value={kind} options={KIND_OPTIONS} onChange={(v) => { setKind(v); setSelectedIds([]); setDetail(null); setSearchInput(""); setSearch(""); }} style={{ width: 200 }} />
            <Input
              placeholder={
                kind === "products" ? "ค้นหา SKU / ชื่อ / barcode"
                : kind === "purchaseItems" ? "ค้นหา PO id / SKU / ไซซ์"
                : kind === "purchase" ? "ค้นหา PO id / status"
                : "ค้นหา ID / status / reference"
              }
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={() => setSearch(searchInput.trim())}
            />
            <Button type="primary" onClick={() => setSearch(searchInput.trim())} loading={loading}>Search</Button>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="เลือก 2 เวอร์ชันแล้วกด Compare เพื่อดู field ที่เปลี่ยน"
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button icon={<DiffOutlined />} disabled={!compareReady} onClick={onCompare}>Compare 2 version</Button>
          <span style={{ color: "#666" }}>
            Selected: {selectedIds.length}/2
          </span>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns as any}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.slice(0, 2).map(String)),
        }}
        onRow={(row) => ({
          onClick: () => openDetail(row),
        })}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showTotal: (t) => `Total ${t} revision(s)` }}
      />

      <Drawer
        title="Revision detail"
        width={760}
        open={!!detailRow}
        onClose={() => setDetail(null)}
      >
        {detailLoading ? (
          <div>Loading...</div>
        ) : detailRow ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Revision ID"><Typography.Text code>{String(detailRow.id)}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="Entity ID"><Typography.Text code>{String(detailRow.entityId ?? detailRow.snapshot?.id ?? detailRow.snapshot?.sku ?? "—")}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="Kind">{detailRow.kindLabel ?? kind}</Descriptions.Item>
              <Descriptions.Item label="Created at">{fmtDT(detailRow.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Editor">{detailRow.editorLabel ? <Typography.Text>{String(detailRow.editorLabel)}</Typography.Text> : <Tag>system</Tag>}</Descriptions.Item>
              <Descriptions.Item label="Revision ref">{detailRow.revision_id ? <Typography.Text code>{String(detailRow.revision_id)}</Typography.Text> : "—"}</Descriptions.Item>
            </Descriptions>
            <pre style={{ margin: 0, padding: 16, background: "#f6f7f9", borderRadius: 12, overflow: "auto" }}>
              {JSON.stringify(detailRow.snapshot, null, 2)}
            </pre>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="Compare 2 versions"
        open={compareOpen}
        onCancel={() => setCompareOpen(false)}
        onOk={() => setCompareOpen(false)}
        width={1100}
        footer={null}
      >
        {compareLoading ? (
          <div>Loading...</div>
        ) : compare ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert type="success" showIcon message={`${compare.kindLabel} compare`} />
            <Table
              size="small"
              pagination={false}
              rowKey="path"
              dataSource={compare.diff}
              columns={[
                { title: "Field", dataIndex: "path", width: 260 },
                { title: "Before", dataIndex: "before", render: (v: any) => <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 2)}</pre> },
                { title: "After", dataIndex: "after", render: (v: any) => <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 2)}</pre> },
              ]}
            />
          </Space>
        ) : (
          <Alert type="warning" showIcon message="เลือกเวอร์ชัน 2 ตัวก่อนแล้วค่อย compare" />
        )}
      </Modal>
    </div>
  );
}
