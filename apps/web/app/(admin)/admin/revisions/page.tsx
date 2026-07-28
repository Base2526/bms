'use client';
import { gql, useLazyQuery, useQuery } from "@apollo/client";
import { Alert, Button, Card, Checkbox, Drawer, Input, Modal, Select, Space, Table, Tag, Typography, message, Descriptions } from "antd";
import { useMemo, useState } from "react";
import { ReloadOutlined, DiffOutlined, FileTextOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";

const KIND_OPTIONS = [
  { value: "products", label: "Products" },
  { value: "orders", label: "Orders" },
  { value: "payments", label: "Payments" },
  { value: "shipments", label: "Shipments" },
  { value: "purchase", label: "Purchase Orders" },
  { value: "purchaseItems", label: "Purchase Order Items" },
  { value: "coupons", label: "Coupons" },
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

// ป้ายชื่อกลุ่ม (entity) แบบอ่านรู้เรื่อง — derive จาก snapshot ล่าสุดของกลุ่มนั้น
// ไม่ต้อง join ตารางจริง (สถานะปัจจุบันดูได้ที่หน้าของ kind นั้นเอง)
function entityLabel(kind: string, snapshot: any): string {
  if (!snapshot || typeof snapshot !== "object") return "—";
  const pick = (...fields: string[]) => {
    for (const f of fields) {
      const v = snapshot[f];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };
  switch (kind) {
    case "coupons": return pick("code") || "—";
    case "products": return pick("name", "sku") || "—";
    case "purchaseItems": return pick("product_sku", "po_id") || "—";
    default: return pick("id") || "—";
  }
}

export default function Page() {
  const { can } = useBmsPermissions();
  const isMobile = useIsMobile();
  const [kind, setKind] = useState<"products" | "orders" | "payments" | "shipments" | "purchase" | "purchaseItems" | "coupons">("products");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const { data, loading, error, refetch } = useQuery(Q_HISTORY, {
    variables: { kind, entityId: search, limit: 50 },
    fetchPolicy: "cache-and-network",
  });

  const [loadDetail] = useLazyQuery(Q_DETAIL, {
    fetchPolicy: "network-only",
    onError: (e: any) => message.error(e?.message || "โหลด detail ไม่ได้"),
  });
  const [loadCompare, { data: compareData, loading: compareLoading }] = useLazyQuery(Q_COMPARE, {
    fetchPolicy: "network-only",
    onError: (e: any) => message.error(e?.message || "compare ไม่ได้"),
  });

  const rows = data?.bmsRevisionHistory || [];
  const compareReady = selectedIds.length === 2;

  // จัดกลุ่ม revision เป็นราย entity (id นิ่ง) — rows มาเรียง created_at DESC อยู่แล้ว
  // กลุ่มบนสุด = แก้ล่าสุดสุด, ในกลุ่มก็ใหม่→เก่า · เป็น tree ให้ antd render แบบกางได้
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const key = String(r.entityId ?? r.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([entityId, revs]) => {
      const newest = revs[0];
      return {
        id: `group:${entityId}`,
        isGroup: true,
        entityId,
        label: entityLabel(kind, newest?.snapshot),
        count: revs.length,
        created_at: newest?.created_at,
        editorLabel: newest?.editorLabel ?? null,
        children: revs,
      };
    });
  }, [rows, kind]);
  const groupKeys = useMemo(() => grouped.map((g) => g.id), [grouped]);

  const openDetail = async (row: any) => {
    setDetail(row); // เปิดทันทีด้วยข้อมูลแถวที่มีอยู่แล้ว (list ส่ง snapshot ครบ)
    const res = await loadDetail({ variables: { kind, revisionId: row.id } } as any);
    if (res?.data?.bmsRevisionDetail) setDetail(res.data.bmsRevisionDetail); // อัปเดตด้วยข้อมูลสด
  };

  // เลือก compare ได้เฉพาะ 2 เวอร์ชันของ entity เดียวกัน (diff ข้ามรายการไม่มีความหมาย)
  // และเลือกได้ไม่เกิน 2 — เดิมกดตัวที่ 3 ได้แต่ระบบทิ้งเงียบ ๆ (slice(0,2)) ตอนนี้ปิด checkbox ให้เห็นเลย
  const canSelectRevision = (row: any) => {
    const id = String(row.id);
    if (selectedIds.includes(id)) return true;
    if (selectedIds.length >= 2) return false;
    if (selectedIds.length === 0) return true;
    const anchor = rows.find((r: any) => String(r.id) === selectedIds[0]);
    return !!anchor && String(anchor.entityId ?? "") === String(row.entityId ?? "");
  };
  const toggleSelectRevision = (row: any) => {
    const id = String(row.id);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? prev : [...prev, id]
    );
  };

  const onCompare = async () => {
    if (selectedIds.length !== 2) return;
    // เทียบได้เฉพาะ 2 เวอร์ชันของ "รายการเดียวกัน" (entity เดียวกัน) เท่านั้น —
    // เทียบข้ามรายการ (เช่นคูปองคนละโค้ด) จะได้ diff ที่ไม่มีความหมาย
    const picked = rows.filter((r: any) => selectedIds.includes(String(r.id)));
    const entities = new Set(picked.map((r: any) => String(r.entityId ?? "")));
    if (picked.length === 2 && entities.size > 1) {
      message.warning("เปรียบเทียบได้เฉพาะเวอร์ชันของรายการเดียวกัน — โปรดเลือก 2 เวอร์ชันที่มาจากรายการ (id) เดียวกัน");
      return;
    }
    await loadCompare({ variables: { kind, fromRevisionId: selectedIds[0], toRevisionId: selectedIds[1] } } as any);
    setCompareOpen(true);
  };

  const columns = useMemo(() => [
    {
      title: "Revision / รายการ", dataIndex: "id", width: 260,
      render: (v: string, row: any) => row.isGroup
        ? <Space size={8}><Typography.Text strong>{row.label}</Typography.Text><Tag>{row.count} เวอร์ชัน</Tag><Typography.Text type="secondary" code style={{ fontSize: 11 }}>{String(row.entityId).slice(0, 8)}</Typography.Text></Space>
        : <Typography.Text code>{v.slice(0, 8)}</Typography.Text>,
    },
    { title: "เมื่อ", dataIndex: "created_at", width: 180, render: (v: string, row: any) => row.isGroup ? <Typography.Text type="secondary">แก้ล่าสุด {fmtDT(v)}</Typography.Text> : fmtDT(v) },
    { title: "Editor", dataIndex: "editorLabel", width: 200, render: (v: string | null) => v ? <Typography.Text>{v}</Typography.Text> : <Tag>system</Tag> },
    { title: "Revision ID", dataIndex: "revision_id", width: 200, render: (v: string | null, row: any) => row.isGroup ? null : (v ? <Typography.Text code>{v.slice(0, 8)}</Typography.Text> : <span style={{ color: "#999" }}>—</span>) },
    { title: "Snapshot", dataIndex: "snapshot", render: (v: any, row: any) => row.isGroup ? null : <span>{summarizeSnapshot(v)}</span> },
    { title: "Action", width: 110, render: (_: any, row: any) => row.isGroup ? null : <Button size="small" icon={<FileTextOutlined />} onClick={() => openDetail(row)}>Detail</Button> },
  ], [kind]);

  if (!can("product.view") && !can("order.view") && !can("payment.view") && !can("shipping.view") && !can("purchase.view") && !can("coupon.view")) {
    return <Alert type="error" message="ไม่มีสิทธิ์ดู revision" showIcon />;
  }

  // detail state เป็น source of truth เดียว — ปุ่มปิด setDetail(null) แล้วต้องปิดได้จริง
  // (เดิม fallback ไป detailData ของ Apollo lazy query ที่ค้าง ทำให้ drawer ไม่ปิด)
  const detailRow = detail;
  const compare = compareData?.bmsRevisionCompare;

  return (
    <div>
      <AdminPageHeader title="Revision History">
        <Select
          value={kind}
          options={KIND_OPTIONS}
          onChange={(v) => { setKind(v); setSelectedIds([]); setDetail(null); setSearchInput(""); setSearch(""); }}
          style={{ width: isMobile ? "100%" : 200 }}
        />
        <Input
          placeholder={
            kind === "products" ? "ค้นหา SKU / ชื่อ / barcode"
            : kind === "purchaseItems" ? "ค้นหา PO id / SKU / ไซซ์"
            : kind === "purchase" ? "ค้นหา PO id / status"
            : kind === "coupons" ? "ค้นหาโค้ด / โน้ต"
            : "ค้นหา ID / status / reference"
          }
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={() => setSearch(searchInput.trim())}
        />
        <Button type="primary" onClick={() => setSearch(searchInput.trim())} loading={loading}>Search</Button>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

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

      {isMobile ? (
        // มือถือ: 1 การ์ด = 1 entity, ในการ์ดคือเวอร์ชันของ entity นั้น (ใหม่→เก่า)
        // โครงเดียวกับ tree ของตาราง แต่ไม่ต้องเลื่อนแนวนอน 6 คอลัมน์
        <AdminMobileList
          key={`${kind}:${search}`}
          loading={loading}
          dataSource={grouped}
          rowKey={(g) => g.id}
          totalText={() => `${grouped.length} รายการ · ${rows.length} เวอร์ชัน`}
          emptyText="ไม่มีประวัติการแก้ไข"
          renderItem={(g) => (
            <AdminRecordCard
              key={g.id}
              title={
                <Space size={6} wrap>
                  <Typography.Text strong>{g.label}</Typography.Text>
                  <Typography.Text type="secondary" code style={{ fontSize: 11 }}>
                    {String(g.entityId).slice(0, 8)}
                  </Typography.Text>
                </Space>
              }
              extra={<Tag style={{ marginInlineEnd: 0 }}>{g.count} เวอร์ชัน</Tag>}
              footer={
                <div style={{ marginTop: 8 }}>
                  {g.children.map((rev: any) => (
                    <div
                      key={rev.id}
                      style={{
                        display: "flex", gap: 8, alignItems: "flex-start",
                        padding: "8px 0", borderTop: "1px solid var(--app-border, #f0f0f0)",
                      }}
                    >
                      <Checkbox
                        checked={selectedIds.includes(String(rev.id))}
                        disabled={!canSelectRevision(rev)}
                        onChange={() => toggleSelectRevision(rev)}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <Typography.Text style={{ fontSize: 12 }}>{fmtDT(rev.created_at)}</Typography.Text>
                          {rev.editorLabel
                            ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{rev.editorLabel}</Typography.Text>
                            : <Tag style={{ marginInlineEnd: 0 }}>system</Tag>}
                        </div>
                        <Typography.Paragraph
                          type="secondary"
                          style={{ fontSize: 11.5, margin: "4px 0 6px" }}
                          ellipsis={{ rows: 2 }}
                        >
                          {summarizeSnapshot(rev.snapshot)}
                        </Typography.Paragraph>
                        <Button size="small" icon={<FileTextOutlined />} onClick={() => openDetail(rev)}>Detail</Button>
                      </div>
                    </div>
                  ))}
                </div>
              }
            />
          )}
        />
      ) : (
        <Table
          key={`${kind}:${search}`}
          rowKey="id"
          loading={loading}
          dataSource={grouped}
          columns={columns as any}
          expandable={{ defaultExpandAllRows: true, rowExpandable: (row: any) => !!row.isGroup }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            checkStrictly: true, // เลือกกลุ่มไม่ลามไป children — เลือกได้เฉพาะแถว revision
            onChange: (keys) => setSelectedIds(keys.map(String).filter((k) => !k.startsWith("group:")).slice(0, 2)),
            // group row เลือกไม่ได้ · revision row ใช้เงื่อนไขเดียวกับฝั่งมือถือ (entity เดียวกัน, ไม่เกิน 2)
            getCheckboxProps: (row: any) =>
              row.isGroup ? { disabled: true } : { disabled: !canSelectRevision(row) },
          }}
          onRow={(row) => ({
            onClick: () => { if (!row.isGroup) openDetail(row); },
          })}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 20, showTotal: () => `${grouped.length} รายการ · ${rows.length} เวอร์ชัน` }}
        />
      )}

      <Drawer
        title="Revision detail"
        width={panelWidth(isMobile, 760)}
        open={!!detailRow}
        onClose={() => setDetail(null)}
      >
        {detailRow ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1} layout={isMobile ? "vertical" : "horizontal"}>
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
        width={panelWidth(isMobile, 1100)}
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
              // มือถือ: ยุบ 3 คอลัมน์เป็นคอลัมน์เดียว (field + ก่อน/หลัง ซ้อนกัน) — 3 คอลัมน์ที่มี JSON
              // ข้างในบีบจนอ่านไม่ได้บนจอแคบ
              columns={isMobile ? [
                {
                  title: "การเปลี่ยนแปลง", dataIndex: "path",
                  render: (path: any, r: any) => (
                    <div>
                      <Typography.Text strong style={{ fontSize: 12 }}>{path}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>ก่อน</Typography.Text>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(r.before, null, 2)}</pre>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>หลัง</Typography.Text>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(r.after, null, 2)}</pre>
                    </div>
                  ),
                },
              ] : [
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
