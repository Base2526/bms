'use client';
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Typography, Alert, Button, Space, Input, Tooltip } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

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

// ชื่ออ่านง่ายของแต่ละ action — ไม่มีในนี้ = โชว์ raw key เดิม (กันตกหล่นตอนมี action ใหม่)
const ACTION_LABEL: Record<string, string> = {
  "order.pay": "ออเดอร์ · ชำระเงินแล้ว", "order.pack": "ออเดอร์ · แพ็คสินค้า",
  "order.ship": "ออเดอร์ · จัดส่งแล้ว", "order.complete": "ออเดอร์ · ปิดสำเร็จ",
  "order.cancel": "ออเดอร์ · ยกเลิก", "order.return": "ออเดอร์ · รับคืนสินค้า",
  "product.upsert": "สินค้า · บันทึก", "product.active": "สินค้า · เปิด/ปิดขาย",
  "stock.adjust": "สต็อก · ปรับยอด", "channel.upsert": "ช่องทาง · ตั้งค่า",
  "plan.change": "แพ็กเกจ · เปลี่ยน", "rbac.set": "สิทธิ์ · ตั้งค่า role",
  "inbox.assign": "แชท · เปลี่ยนผู้รับผิดชอบหลัก", "inbox.helper_add": "แชท · เพิ่มผู้ช่วยตอบ",
  "inbox.helper_remove": "แชท · ถอดผู้ช่วยตอบ", "inbox.status": "แชท · เปลี่ยนสถานะ",
  "inbox.tags": "แชท · แก้แท็ก", "inbox.reply": "แชท · ตอบลูกค้า", "inbox.note": "แชท · เพิ่มโน้ต",
};

// key ของ meta → ป้ายอ่านง่าย (key ที่ไม่รู้จักโชว์ raw key ไปเลย ไม่ตกหล่น)
const META_KEY_LABEL: Record<string, string> = {
  fromUserId: "จากผู้ใช้", toUserId: "ไปยังผู้ใช้", userId: "ผู้ใช้", status: "สถานะ",
  auto: "อัตโนมัติ", count: "จำนวน", assignedTo: "มอบหมายให้", reason: "เหตุผล",
};

function MetaView({ meta }: { meta: any }) {
  if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  }
  return (
    <Space direction="vertical" size={2}>
      {Object.entries(meta).map(([k, v]) => (
        <span key={k} style={{ fontSize: 12 }}>
          <Text type="secondary">{META_KEY_LABEL[k] || k}:</Text>{" "}
          <Text>{typeof v === "boolean" ? (v ? "ใช่" : "ไม่") : String(v)}</Text>
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
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [q, setQ] = useState("");

  const rows = data?.bmsAuditLog || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r: any) => {
      const hay = [
        r.actor, r.action, ACTION_LABEL[r.action], r.target,
        r.meta ? JSON.stringify(r.meta) : "",
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q]);

  if (error) return <Alert type="error" message="โหลด audit log ไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Audit Log</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>
      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="บันทึกการกระทำของผู้ดูแล (เฉพาะร้านนี้) — ใครทำอะไร เมื่อไร · เฉพาะ Administrator ดูได้" />
      <Input.Search
        allowClear placeholder="ค้นหา: ผู้ทำ / การกระทำ / เป้าหมาย / รายละเอียด"
        prefix={<SearchOutlined />}
        style={{ maxWidth: 420, marginBottom: 16 }}
        value={q} onChange={(e) => setQ(e.target.value)}
      />
      <Table
        rowKey="id" loading={loading} dataSource={filtered}
        scroll={{ x: "max-content" }}
        columns={[
          { title: "เวลา", dataIndex: "created_at", width: 190, render: (d: string) => fmtDT(d) },
          { title: "ผู้ทำ", dataIndex: "actor", width: 200,
            render: (a: string) => a?.startsWith("system:") ? <Tag>{a}</Tag> : a || "—" },
          { title: "การกระทำ", dataIndex: "action", width: 220,
            render: (a: string) => <Tag color={ACTION_COLOR[a] || "default"}>{ACTION_LABEL[a] || a}</Tag> },
          { title: "เป้าหมาย", dataIndex: "target", width: 140, render: (t: string) => <TargetView target={t} /> },
          { title: "รายละเอียด", dataIndex: "meta", render: (m: any) => <MetaView meta={m} /> },
        ]}
        pagination={{ pageSize: 25, showTotal: (t) => `Total ${t} entries` }}
      />
    </div>
  );
}
