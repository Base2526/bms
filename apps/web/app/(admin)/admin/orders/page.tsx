'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Button,
  Space,
  Tag,
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
  EnvironmentOutlined,
  DownOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader, { ResponsiveStatusFilter } from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";
import { useI18n } from "@/lib/i18nContext";

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
  discount_amount: number;
  shipping_fee: number;
  amount_due: number;
  coupon_code: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  hasShippingAddress: boolean;
};

// ---- GraphQL ------------------------------------------------
const Q_ORDERS = gql`
  query BmsOrders($search: String, $status: BmsOrderStatus, $limit: Int, $offset: Int) {
    bmsOrders(search: $search, status: $status, limit: $limit, offset: $offset) {
      id channel customer_ref status total_amount discount_amount shipping_fee amount_due coupon_code created_at updated_at hasShippingAddress
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
function getStatusLabel(t: (key: string) => string): Record<OrderStatus, string> {
  return {
    PENDING: t("admin_orders.status_pending"),
    PAID: t("admin_orders.status_paid"),
    PACKING: t("admin_orders.status_packing"),
    SHIPPED: t("admin_orders.status_shipped"),
    COMPLETED: t("admin_orders.status_completed"),
    CANCELLED: t("admin_orders.status_cancelled"),
    RETURNED: t("admin_orders.status_returned"),
  };
}
const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue",
  shopee: "orange", lazada: "purple", test: "default",
};

const FILTERS = ["ALL", "PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"] as const;
const money = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;
const orderSubtotal = (order: Order) =>
  order.items.reduce((sum, it) => sum + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);

function OrdersManagement() {
  const { t } = useI18n();
  const STATUS_LABEL = useMemo(() => getStatusLabel(t), [t]);
  const { can } = useBmsPermissions();
  const isMobile = useIsMobile();
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

  const onErr = (e: any) => message.error(e?.message || t("admin_orders.action_failed"));
  // handler ร่วม: mutation คืน Boolean — false = สถานะไม่ถูกต้อง
  const opts = (ok: string) => ({
    onCompleted: (d: any) => {
      Object.values(d || {})[0]
        ? (message.success(ok), refetch())
        : onErr({ message: t("admin_orders.invalid_status") });
    },
    onError: onErr,
  });

  const [pay, { loading: l1 }] = useMutation(M_PAY, opts(t("admin_orders.paid_success")));
  const [pack, { loading: l2 }] = useMutation(M_PACK, opts(t("admin_orders.packing_success")));
  const [ship, { loading: l3 }] = useMutation(M_SHIP, opts(t("admin_orders.shipped_success")));
  const [complete, { loading: l4 }] = useMutation(M_COMPLETE, opts(t("admin_orders.completed_success")));
  const [cancel, { loading: l5 }] = useMutation(M_CANCEL, opts(t("admin_orders.cancelled_success")));
  const [ret, { loading: l6 }] = useMutation(M_RETURN, opts(t("admin_orders.returned_success")));
  const busy = l1 || l2 || l3 || l4 || l5 || l6;

  const orders: Order[] = data?.bmsOrders || [];

  const actionsFor = (r: Order) => {
    const v = { variables: { id: r.id } };
    const btns: any[] = [];
    const payBtn = <Button key="pay" type="link" size="small" icon={<DollarOutlined />} disabled={busy} onClick={() => pay(v)}>{t("admin_orders.btn_pay")}</Button>;
    const packBtn = <Button key="pack" type="link" size="small" icon={<InboxOutlined />} disabled={busy} onClick={() => pack(v)}>{t("admin_orders.btn_pack")}</Button>;
    const shipBtn = r.hasShippingAddress ? (
      <Popconfirm key="ship" title={t("admin_orders.ship_confirm_title")} description={t("admin_orders.ship_confirm_desc")} okText={t("admin_orders.ship_ok_text")} cancelText={t("admin_orders.cancel_text")} disabled={busy} onConfirm={() => ship(v)}>
        <Button type="link" size="small" icon={<CarOutlined />} disabled={busy}>{t("admin_orders.btn_ship")}</Button>
      </Popconfirm>
    ) : (
      <Space key="ship" size={4}>
        <Tooltip title={t("admin_orders.no_shipping_address_tooltip")}>
          <Button type="link" size="small" icon={<CarOutlined />} disabled>{t("admin_orders.btn_ship")}</Button>
        </Tooltip>
        <Link href="/admin/customers"><Button type="link" size="small" icon={<EnvironmentOutlined />}>{t("admin_orders.btn_add_address")}</Button></Link>
      </Space>
    );
    const doneBtn = <Button key="done" type="link" size="small" icon={<CheckCircleOutlined />} disabled={busy} onClick={() => complete(v)}>{t("admin_orders.btn_done")}</Button>;
    const cancelBtn = <CancelBtn key="c" onOk={() => cancel(v)} disabled={busy} t={t} />;
    const returnBtn = <ReturnBtn key="r" onOk={() => ret(v)} disabled={busy} t={t} />;

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
        render: (_: any, r: Order) => <span>{t("admin_orders.col_items", { qty: r.items.reduce((n, it) => n + it.qty, 0), count: r.items.length })}</span> },
      { title: t("admin_orders.col_amount_due"), dataIndex: "amount_due", key: "amount_due", width: 130, align: "right" as const,
        render: (v: number, r: Order) => (
          <Space direction="vertical" size={0} style={{ textAlign: "right" }}>
            <Typography.Text>{money(v)}</Typography.Text>
            {Number(r.shipping_fee || 0) > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t("admin_orders.incl_shipping", { value: money(r.shipping_fee) })}
              </Typography.Text>
            )}
            {Number(r.discount_amount || 0) > 0 && (
              <Typography.Text type="danger" style={{ fontSize: 11 }}>
                -{money(r.discount_amount)} {r.coupon_code ? `(${r.coupon_code})` : ""}
              </Typography.Text>
            )}
          </Space>
        ) },
      { title: "Status", dataIndex: "status", key: "status", width: 130,
        render: (s: OrderStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: t("admin_orders.col_updated"), dataIndex: "updated_at", key: "updated_at", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: t("admin_orders.col_actions"), key: "actions", width: 220,
        render: (_: any, r: Order) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [busy, can, t, STATUS_LABEL]
  );

  if (error) return <Alert type="error" message={t("admin_orders.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <AdminPageHeader title={t("admin_orders.page_title")}>
        <Input.Search
          placeholder={t("admin_orders.search_placeholder")}
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ResponsiveStatusFilter
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: t("admin_orders.status_all"), ...STATUS_LABEL }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_orders.refresh")}</Button>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_orders.workflow_hint")}
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={orders}
          rowKey={(o) => o.id}
          totalText={(n) => t("admin_orders.total_orders", { n })}
          renderItem={(r) => <MobileOrderCard key={r.id} order={r} actions={actionsFor(r)} />}
          emptyText={t("admin_orders.empty_no_orders")}
        />
      ) : (
        <Table
          rowKey="id" loading={loading} dataSource={orders} columns={columns}
          scroll={{ x: "max-content" }}
          expandable={{ expandedRowRender: (r: Order) => <OrderDetails order={r} /> }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `Total ${t} order(s)` }}
        />
      )}
    </div>
  );
}

const ITEM_COLUMNS = [
  { title: "SKU", dataIndex: "product_sku", key: "sku" },
  { title: "Size", dataIndex: "size", key: "size", width: 80 },
  { title: "Qty", dataIndex: "qty", key: "qty", width: 80, align: "right" as const },
  { title: "Unit Price", dataIndex: "unit_price", key: "up", width: 120, align: "right" as const,
    render: (v: number) => money(v) },
  { title: "Line Total", key: "lt", width: 120, align: "right" as const,
    render: (_: any, it: OrderItem) => money(it.qty * it.unit_price) },
];

/** เส้นทางออร์เดอร์ + รายการสินค้า + สรุปยอด — ใช้ทั้งแถวขยายของตาราง (desktop) และการ์ด (มือถือ) */
function OrderDetails({ order: r }: { order: Order }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OrderJourney orderId={r.id} />
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_orders.items_label")}</Typography.Text>
        <Table style={{ marginTop: 6 }} rowKey={(it) => `${it.product_sku}-${it.size}`} dataSource={r.items} columns={ITEM_COLUMNS} pagination={false} size="small" scroll={{ x: "max-content" }} />
        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
          <Space direction="vertical" size={2} style={{ minWidth: 0, width: "100%", maxWidth: 320 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <Typography.Text type="secondary">{t("admin_orders.subtotal")}</Typography.Text>
              <Typography.Text>{money(orderSubtotal(r))}</Typography.Text>
            </div>
            {Number(r.discount_amount || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <Typography.Text type="secondary">{t("admin_orders.discount")}{r.coupon_code ? ` (${r.coupon_code})` : ""}</Typography.Text>
                <Typography.Text type="danger">-{money(r.discount_amount)}</Typography.Text>
              </div>
            )}
            {Number(r.shipping_fee || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <Typography.Text type="secondary">{t("admin_orders.shipping_fee")}</Typography.Text>
                <Typography.Text>{money(r.shipping_fee)}</Typography.Text>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: "1px solid var(--app-border, #eee)", paddingTop: 6 }}>
              <Typography.Text strong>{t("admin_orders.net_total")}</Typography.Text>
              <Typography.Text strong>{money(r.amount_due)}</Typography.Text>
            </div>
          </Space>
        </div>
      </div>
    </div>
  );
}

/** 1 ออร์เดอร์ = 1 การ์ดบนมือถือ — รายละเอียด (journey/รายการ) กางในการ์ดเดียวกัน */
function MobileOrderCard({ order: r, actions }: { order: Order; actions: React.ReactNode }) {
  const { t } = useI18n();
  const STATUS_LABEL = useMemo(() => getStatusLabel(t), [t]);
  const [open, setOpen] = useState(false);
  return (
    <AdminRecordCard
      title={
        <Space size={6} wrap>
          <Typography.Text code>{r.id.slice(0, 8)}</Typography.Text>
          <Tag color={CHANNEL_COLOR[r.channel] || "default"} style={{ marginInlineEnd: 0 }}>{r.channel}</Tag>
        </Space>
      }
      extra={<Tag color={STATUS_COLOR[r.status]} style={{ marginInlineEnd: 0 }}>{STATUS_LABEL[r.status]}</Tag>}
      fields={[
        { label: t("admin_orders.customer_label"), value: r.customer_ref || <span style={{ color: "#999" }}>—</span> },
        { label: t("admin_orders.items_short_label"), value: t("admin_orders.col_items", { qty: r.items.reduce((n, it) => n + it.qty, 0), count: r.items.length }) },
        {
          label: t("admin_orders.col_amount_due"),
          value: (
            <>
              <Typography.Text strong>{money(r.amount_due)}</Typography.Text>
              {Number(r.shipping_fee || 0) > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                  {t("admin_orders.incl_shipping", { value: money(r.shipping_fee) })}
                </Typography.Text>
              )}
              {Number(r.discount_amount || 0) > 0 && (
                <Typography.Text type="danger" style={{ fontSize: 11, display: "block" }}>
                  -{money(r.discount_amount)} {r.coupon_code ? `(${r.coupon_code})` : ""}
                </Typography.Text>
              )}
            </>
          ),
        },
        { label: t("admin_orders.updated_label"), value: fmtDT(r.updated_at) },
      ]}
      footer={open ? <div style={{ marginTop: 12 }}><OrderDetails order={r} /></div> : null}
      actions={
        <>
          {actions}
          <Button
            type="link" size="small" style={{ marginLeft: "auto" }}
            icon={open ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("admin_orders.collapse") : t("admin_orders.details")}
          </Button>
        </>
      }
    />
  );
}

function CancelBtn({ onOk, disabled, t }: { onOk: () => void; disabled: boolean; t: (key: string) => string }) {
  return (
    <Popconfirm title={t("admin_orders.cancel_confirm_title")} description={t("admin_orders.cancel_confirm_desc")} okText={t("admin_orders.cancel_ok_text")} okButtonProps={{ danger: true }} cancelText={t("admin_orders.no_text")} disabled={disabled} onConfirm={onOk}>
      <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={disabled}>{t("admin_orders.btn_cancel")}</Button>
    </Popconfirm>
  );
}
function ReturnBtn({ onOk, disabled, t }: { onOk: () => void; disabled: boolean; t: (key: string) => string }) {
  return (
    <Popconfirm title={t("admin_orders.return_confirm_title")} description={t("admin_orders.return_confirm_desc")} okText={t("admin_orders.return_ok_text")} cancelText={t("admin_orders.no_text")} disabled={disabled} onConfirm={onOk}>
      <Button type="link" size="small" icon={<RollbackOutlined />} disabled={disabled}>{t("admin_orders.btn_return")}</Button>
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
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { data, loading } = useQuery(Q_JOURNEY, { variables: { orderId }, fetchPolicy: "cache-and-network" });
  const j = data?.bmsOrderJourney;
  if (loading && !j) return <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>;
  if (!j) return <Empty description={t("admin_orders.no_journey")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;

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
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_orders.origin_label")}</Typography.Text>
          <Tag color={CHANNEL_COLOR_O[j.channel] || "default"}>{j.channel}</Tag>
          {j.conversationId
            ? <Link href={`/admin/inbox?c=${j.conversationId}`} style={{ fontSize: 12 }}>{t("admin_orders.open_chat")}</Link>
            : <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_orders.no_origin_chat")}</Typography.Text>}
        </Space>
        {(j.assignedStaff || helpers.length > 0) && (
          <Space size={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_orders.assigned_staff_label")}</Typography.Text>
            {j.assignedStaff && <StaffChip s={j.assignedStaff} />}
            {helpers.map((h) => <StaffChip key={h.id} s={h} size={18} />)}
          </Space>
        )}
      </div>

      {/* stepper หลัก — 7 ขั้นเรียงนอนกว้างเกินจอมือถือ จึงพลิกเป็นแนวตั้ง */}
      <Steps
        size="small"
        direction={isMobile ? "vertical" : "horizontal"}
        labelPlacement={isMobile ? "horizontal" : "vertical"}
        items={stepItems}
        style={{ marginTop: 4 }}
      />

      {/* timeline ละเอียด */}
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_orders.detailed_timeline")}</Typography.Text>
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
