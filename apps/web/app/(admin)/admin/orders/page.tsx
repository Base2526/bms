'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Button,
  Space,
  Tag,
  Segmented,
  message,
  Alert,
  Popconfirm,
  Typography,
  Steps,
  Timeline,
  Avatar,
  Tooltip,
  Spin,
  Empty,
  Input,
} from "antd";
import Link from "next/link";
import { useState, useMemo, useEffect } from "react";
import {
  ReloadOutlined,
  DollarOutlined,
  InboxOutlined,
  CarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

// ---- Types --------------------------------------------------
type OrderStatus =
  | "PENDING" | "PAID" | "PACKING" | "SHIPPED" | "COMPLETED" | "CANCELLED" | "RETURNED";

type OrderItem = { product_sku: string; size: string; qty: number; unit_price: number };
type Order = {
  id: string;
  channel: string;
  customer_ref: string | null;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
};

// ---- GraphQL ------------------------------------------------
const Q_ORDERS = gql`
  query BmsOrders($search: String, $status: BmsOrderStatus, $limit: Int, $offset: Int) {
    bmsOrders(search: $search, status: $status, limit: $limit, offset: $offset) {
      id channel customer_ref status total_amount created_at updated_at
      items { product_sku size qty unit_price }
    }
  }
`;
const M_PAY = gql`mutation ($id: ID!) { bmsPayOrder(id: $id) }`;
const M_PACK = gql`mutation ($id: ID!) { bmsPackOrder(id: $id) }`;
const M_SHIP = gql`mutation ($id: ID!) { bmsShipOrder(id: $id) }`;
const M_COMPLETE = gql`mutation ($id: ID!) { bmsCompleteOrder(id: $id) }`;
const M_CANCEL = gql`mutation ($id: ID!) { bmsCancelOrder(id: $id) }`;
const M_RETURN = gql`mutation ($id: ID!) { bmsReturnOrder(id: $id) }`;
const STAFF_F = `id name avatar email`;
const Q_JOURNEY = gql`
  query ($orderId: ID!) {
    bmsOrderJourney(orderId: $orderId) {
      orderId channel status conversationId
      assignedStaff { ${STAFF_F} }
      helpers { ${STAFF_F} }
      steps { status at actorName reached branch }
      events { kind at text actorName }
    }
  }
`;

const STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING: "orange",
  PAID: "blue",
  PACKING: "cyan",
  SHIPPED: "geekblue",
  COMPLETED: "green",
  CANCELLED: "default",
  RETURNED: "red",
};
const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "รอชำระเงิน",
  PAID: "จ่ายแล้ว",
  PACKING: "กำลังแพ็ค",
  SHIPPED: "จัดส่งแล้ว",
  COMPLETED: "สำเร็จ",
  CANCELLED: "ยกเลิก",
  RETURNED: "คืนสินค้า",
};
const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue",
  shopee: "orange", lazada: "purple", test: "default",
};

const FILTERS = ["ALL", "PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"] as const;

function OrdersManagement() {
  const { can } = useBmsPermissions();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, refetch } = useQuery(Q_ORDERS, {
    variables: { search: search || null, status: filter === "ALL" ? null : filter, limit: 100, offset: 0 },
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || "การทำรายการล้มเหลว");
  // handler ร่วม: mutation คืน Boolean — false = สถานะไม่ถูกต้อง
  const opts = (ok: string) => ({
    onCompleted: (d: any) => {
      Object.values(d || {})[0]
        ? (message.success(ok), refetch())
        : onErr({ message: "ทำรายการไม่ได้ (สถานะไม่ถูกต้อง)" });
    },
    onError: onErr,
  });

  const [pay, { loading: l1 }] = useMutation(M_PAY, opts("บันทึกการจ่ายเงินแล้ว"));
  const [pack, { loading: l2 }] = useMutation(M_PACK, opts("เริ่มแพ็คของ"));
  const [ship, { loading: l3 }] = useMutation(M_SHIP, opts("จัดส่งแล้ว (ตัดสต็อก)"));
  const [complete, { loading: l4 }] = useMutation(M_COMPLETE, opts("ปิดออร์เดอร์สำเร็จ"));
  const [cancel, { loading: l5 }] = useMutation(M_CANCEL, opts("ยกเลิกแล้ว (คืนสต็อกที่จอง)"));
  const [ret, { loading: l6 }] = useMutation(M_RETURN, opts("รับคืนสินค้าแล้ว (คืนสต็อก)"));
  const busy = l1 || l2 || l3 || l4 || l5 || l6;

  const orders: Order[] = data?.bmsOrders || [];

  const actionsFor = (r: Order) => {
    const v = { variables: { id: r.id } };
    const btns: any[] = [];
    const payBtn = <Button key="pay" type="link" size="small" icon={<DollarOutlined />} disabled={busy} onClick={() => pay(v)}>จ่ายเงิน</Button>;
    const packBtn = <Button key="pack" type="link" size="small" icon={<InboxOutlined />} disabled={busy} onClick={() => pack(v)}>แพ็ค</Button>;
    const shipBtn = (
      <Popconfirm key="ship" title="จัดส่งออร์เดอร์นี้?" description="จะตัดสต็อกจริง" okText="จัดส่ง" cancelText="ยกเลิก" disabled={busy} onConfirm={() => ship(v)}>
        <Button type="link" size="small" icon={<CarOutlined />} disabled={busy}>จัดส่ง</Button>
      </Popconfirm>
    );
    const doneBtn = <Button key="done" type="link" size="small" icon={<CheckCircleOutlined />} disabled={busy} onClick={() => complete(v)}>สำเร็จ</Button>;
    const cancelBtn = <CancelBtn key="c" onOk={() => cancel(v)} disabled={busy} />;
    const returnBtn = <ReturnBtn key="r" onOk={() => ret(v)} disabled={busy} />;

    switch (r.status) {
      case "PENDING":
        if (can("order.pay")) btns.push(payBtn);
        if (can("order.cancel")) btns.push(cancelBtn);
        break;
      case "PAID":
        if (can("order.ship")) btns.push(packBtn);
        if (can("order.cancel")) btns.push(cancelBtn);
        break;
      case "PACKING":
        if (can("order.ship")) btns.push(shipBtn);
        if (can("order.cancel")) btns.push(cancelBtn);
        break;
      case "SHIPPED":
        if (can("order.pay")) btns.push(doneBtn);
        if (can("order.return")) btns.push(returnBtn);
        break;
      case "COMPLETED":
        if (can("order.return")) btns.push(returnBtn);
        break;
    }
    return btns.length ? btns : [<span key="none" style={{ color: "#999" }}>—</span>];
  };

  const columns = useMemo(
    () => [
      { title: "Order", dataIndex: "id", key: "id", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: "Channel", dataIndex: "channel", key: "channel", width: 90,
        render: (c: string) => <Tag color={CHANNEL_COLOR[c] || "default"}>{c}</Tag> },
      { title: "Customer", dataIndex: "customer_ref", key: "customer_ref",
        render: (c: string | null) => c || <span style={{ color: "#999" }}>—</span> },
      { title: "Items", key: "items",
        render: (_: any, r: Order) => <span>{r.items.reduce((n, it) => n + it.qty, 0)} ชิ้น / {r.items.length} รายการ</span> },
      { title: "Total", dataIndex: "total_amount", key: "total", width: 110, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      { title: "Status", dataIndex: "status", key: "status", width: 130,
        render: (s: OrderStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: "Updated", dataIndex: "updated_at", key: "updated_at", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 220,
        render: (_: any, r: Order) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [busy, can]
  );

  const itemColumns = [
    { title: "SKU", dataIndex: "product_sku", key: "sku" },
    { title: "Size", dataIndex: "size", key: "size", width: 80 },
    { title: "Qty", dataIndex: "qty", key: "qty", width: 80, align: "right" as const },
    { title: "Unit Price", dataIndex: "unit_price", key: "up", width: 120, align: "right" as const,
      render: (v: number) => `${Number(v).toLocaleString()} ฿` },
    { title: "Line Total", key: "lt", width: 120, align: "right" as const,
      render: (_: any, it: OrderItem) => `${(it.qty * it.unit_price).toLocaleString()} ฿` },
  ];

  if (error) return <Alert type="error" message="โหลดออร์เดอร์ไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>BMS Orders (OMS)</h2>
          <Space wrap>
            <Input.Search
              placeholder="ค้นหา order / customer / channel"
              allowClear
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Segmented options={FILTERS as unknown as string[]} value={filter} onChange={(v) => setFilter(v as any)} />
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message="PENDING → (จ่าย) PAID → (แพ็ค) PACKING → (ส่ง) SHIPPED → (ปิด) COMPLETED  |  Cancel คืน reserved (ก่อนส่ง) · Return คืนสต็อก (หลังส่ง)"
      />

      <Table
        rowKey="id" loading={loading} dataSource={orders} columns={columns}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (r: Order) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <OrderJourney orderId={r.id} />
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>รายการสินค้า</Typography.Text>
                <Table style={{ marginTop: 6 }} rowKey={(it) => `${it.product_sku}-${it.size}`} dataSource={r.items} columns={itemColumns} pagination={false} size="small" scroll={{ x: "max-content" }} />
              </div>
            </div>
          ),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `Total ${t} order(s)` }}
      />
    </div>
  );
}

function CancelBtn({ onOk, disabled }: { onOk: () => void; disabled: boolean }) {
  return (
    <Popconfirm title="ยกเลิกออร์เดอร์นี้?" description="จะคืนสต็อกที่จองไว้" okText="ยกเลิกออร์เดอร์" okButtonProps={{ danger: true }} cancelText="ไม่" disabled={disabled} onConfirm={onOk}>
      <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={disabled}>ยกเลิก</Button>
    </Popconfirm>
  );
}
function ReturnBtn({ onOk, disabled }: { onOk: () => void; disabled: boolean }) {
  return (
    <Popconfirm title="รับคืนสินค้า?" description="จะคืนสต็อกเข้าคลัง" okText="รับคืน" cancelText="ไม่" disabled={disabled} onConfirm={onOk}>
      <Button type="link" size="small" icon={<RollbackOutlined />} disabled={disabled}>คืนสินค้า</Button>
    </Popconfirm>
  );
}

// ---- Order journey (ต้นทางแชท + stepper + timeline) ----
type StaffRef = { id: string; name: string | null; avatar: string | null; email: string | null };
type JStep = { status: string; at: string | null; actorName: string | null; reached: boolean; branch: boolean };
type JEvent = { kind: string; at: string; text: string; actorName: string | null };

const CHANNEL_COLOR_O: Record<string, string> = { line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue" };
const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function StaffChip({ s, size = 22 }: { s: StaffRef; size?: number }) {
  return (
    <Tooltip title={s.name || s.email || s.id}>
      <Avatar size={size} src={s.avatar || undefined} style={{ fontSize: size <= 22 ? 10 : 12, backgroundColor: "#1677ff" }}>
        {(s.name || "?").slice(0, 1).toUpperCase()}
      </Avatar>
    </Tooltip>
  );
}

function OrderJourney({ orderId }: { orderId: string }) {
  const { data, loading } = useQuery(Q_JOURNEY, { variables: { orderId }, fetchPolicy: "cache-and-network" });
  const j = data?.bmsOrderJourney;
  if (loading && !j) return <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>;
  if (!j) return <Empty description="ไม่มีข้อมูลเส้นทาง" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const steps: JStep[] = j.steps || [];
  const events: JEvent[] = j.events || [];
  const helpers: StaffRef[] = j.helpers || [];

  const stepItems = steps.map((s) => ({
    title: <span style={{ fontSize: 12 }}>{s.status}</span>,
    description: (
      <span style={{ fontSize: 11, lineHeight: 1.3, display: "inline-block" }}>
        {fmtDT(s.at)}{s.actorName ? <><br />{s.actorName}</> : null}
      </span>
    ),
    status: s.branch ? ("error" as const) : s.reached ? ("finish" as const) : ("wait" as const),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* จุดเริ่มต้น */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", padding: "10px 12px", background: "var(--app-surface-2, rgba(148,163,184,0.08))", borderRadius: 8 }}>
        <Space size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>ต้นทาง:</Typography.Text>
          <Tag color={CHANNEL_COLOR_O[j.channel] || "default"}>{j.channel}</Tag>
          {j.conversationId
            ? <Link href={`/admin/inbox?c=${j.conversationId}`} style={{ fontSize: 12 }}>เปิดดูแชท →</Link>
            : <Typography.Text type="secondary" style={{ fontSize: 12 }}>ไม่มีแชทต้นทาง</Typography.Text>}
        </Space>
        {(j.assignedStaff || helpers.length > 0) && (
          <Space size={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>ผู้ดูแล:</Typography.Text>
            {j.assignedStaff && <StaffChip s={j.assignedStaff} />}
            {helpers.map((h) => <StaffChip key={h.id} s={h} size={18} />)}
          </Space>
        )}
      </div>

      {/* stepper หลัก */}
      <Steps size="small" labelPlacement="vertical" items={stepItems} style={{ marginTop: 4 }} />

      {/* timeline ละเอียด */}
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>ไทม์ไลน์ละเอียด</Typography.Text>
        <Timeline style={{ marginTop: 10 }} items={events.map((e) => ({
          children: (
            <span style={{ fontSize: 12 }}>
              {e.text}
              <span style={{ color: "var(--app-muted, #888)" }}>
                {" · "}{fmtDT(e.at)}{e.actorName ? ` · ${e.actorName}` : ""}
              </span>
            </span>
          ),
        }))} />
      </div>
    </div>
  );
}

export default function Page() {
  return <OrdersManagement />;
}
