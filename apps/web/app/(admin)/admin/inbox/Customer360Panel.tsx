'use client';
// =============================================================
// Customer 360 Panel — right-hand column ของหน้า Inbox
// -------------------------------------------------------------
// โหลดอัตโนมัติตอนเลือกแชท (Section 1–7, เบา) ส่วน Timeline/AI Insights
// (Section 8–9, หนักกว่า) โหลดแบบ lazy ตอนกาง panel เท่านั้น
// backend: lib/bms/customer360.ts · graphql/bmsCustomer360.ts
// =============================================================
import { gql, useQuery, useLazyQuery, useMutation } from "@apollo/client";
import {
  Collapse, Skeleton, Empty, Tag, Typography, Avatar, Space, Table,
  Descriptions, Button, Tooltip, List, Divider, Modal, Form, Select, InputNumber, Alert, message, Drawer, Input,
} from "antd";
import { memo, useEffect, useState } from "react";
import {
  UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ShoppingOutlined,
  PlusOutlined, MinusCircleOutlined, ContainerOutlined, RollbackOutlined,
  FileTextOutlined, RightOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import panelStyles from "./customer360.module.css";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph } = Typography;

// ---- GraphQL --------------------------------------------------
const Q_CUSTOMER_360 = gql`
  query ($customerId: ID, $channel: String, $customerRef: String, $conversationId: ID) {
    bmsCustomer360(customerId: $customerId, channel: $channel, customerRef: $customerRef, conversationId: $conversationId) {
      customer {
        id name phone email tags createdAt preferredLanguage timezone
        orderCount totalSpent isNewCustomer isReturningCustomer
      }
      identities { channel externalRef }
      addresses { id label address isDefault addressType }
      stats {
        lifetimeValue totalOrders avgOrderValue completedOrders cancelledOrders
        refundCount lastOrderDate lastConversationAt avgResponseTimeSeconds
      }
      recentOrders {
        id channel status createdAt totalAmount discountAmount couponCode paymentStatus paymentMethod
        shipmentStatus carrier trackingNo items { sku size qty unitPrice }
      }
      products {
        topPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        recentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        frequentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        favoriteCategories { category qty }
      }
      draftOrder { id channel createdAt totalAmount discountAmount couponCode items { sku size qty unitPrice } }
      notes { id conversationId author body createdAt }
      coupons {
        id walletId code type value minOrderAmount maxRedemptions redemptionsCount perCustomerLimit
        startsAt expiresAt active note available reason discountPreview assigned assignedAt source state
        reservedAt reservedOrderId redeemedAt redeemedOrderId expiredAt revokedAt
        remainingRedemptions customerUsedCount
      }
    }
  }
`;
const Q_TIMELINE = gql`
  query ($customerId: ID!) { bmsCustomerTimeline(customerId: $customerId) { type at text ref } }
`;
const Q_INSIGHTS = gql`
  query ($customerId: ID!) { bmsCustomerInsights(customerId: $customerId) { summary generatedAt cached } }
`;
const Q_COUPONS_PICKER = gql`
  query {
    bmsCoupons {
      id code type value minOrderAmount maxRedemptions redemptionsCount perCustomerLimit
      startsAt expiresAt active note
    }
  }
`;
const Q_PRODUCTS_FOR_ORDER = gql`
  query { bmsProducts(limit: 200) { items { sku name variants { size available } } } }
`;
const M_CREATE_ORDER = gql`
  mutation ($channel: String, $customerRef: String, $items: [BmsOrderItemInput!]!, $couponCode: String) {
    bmsCreateOrder(channel: $channel, customerRef: $customerRef, items: $items, couponCode: $couponCode) { status orderId total message }
  }
`;
const Q_INVOICE = gql`
  query ($orderId: ID!) {
    bmsGenerateInvoice(orderId: $orderId) {
      type number date customerRef channel subtotal discount couponCode shippingFee total paymentStatus note
      store { name address phone taxId }
      lines { sku name size qty unitPrice amount }
    }
  }
`;
const M_ASSIGN_CUSTOMER_COUPON = gql`
  mutation ($customerId: ID, $channel: String, $customerRef: String, $conversationId: ID, $code: String!, $note: String) {
    bmsAssignCouponToCustomer(customerId: $customerId, channel: $channel, customerRef: $customerRef, conversationId: $conversationId, code: $code, note: $note)
  }
`;

// pill สีจาง (rounded-999, พื้นทึบเบา) ชุดเดียวกับ CHANNEL_CHIP_STYLE/TOOL_CHIP_BASE ที่ใช้ในหัวแชท
// (page.tsx) — เดิมการ์ดออเดอร์ที่นี่ใช้ antd <Tag color="..."> preset (ขอบ 4px, พื้นอิ่มสีกว่า) ทำให้
// ชิปช่องทาง/สถานะในคอลัมน์เดียวกันหน้าตาไม่ตรงกัน จึงย้ายมาใช้ Pill ของตัวเองแทน
const CHANNEL_PILL: Record<string, { color: string; bg: string }> = {
  line: { color: "#059669", bg: "rgba(5,150,105,0.12)" },
  tiktok: { color: "#db2777", bg: "rgba(219,39,119,0.12)" },
  facebook: { color: "#1677ff", bg: "rgba(22,119,255,0.1)" },
  instagram: { color: "#7c3aed", bg: "rgba(124,58,237,0.12)" },
  web: { color: "#1677ff", bg: "rgba(22,119,255,0.1)" },
  shopee: { color: "#ea580c", bg: "rgba(234,88,12,0.12)" },
  lazada: { color: "#d97706", bg: "rgba(217,119,6,0.12)" },
  test: { color: "#64748b", bg: "rgba(100,116,139,0.12)" },
};
const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  PENDING: { color: "#d97706", bg: "rgba(217,119,6,0.12)" },
  PAID: { color: "#1677ff", bg: "rgba(22,119,255,0.1)" },
  PACKING: { color: "#0891b2", bg: "rgba(8,145,178,0.12)" },
  SHIPPED: { color: "#7c3aed", bg: "rgba(124,58,237,0.12)" },
  COMPLETED: { color: "#059669", bg: "rgba(5,150,105,0.12)" },
  CANCELLED: { color: "#64748b", bg: "rgba(100,116,139,0.12)" },
  RETURNED: { color: "#dc2626", bg: "rgba(220,38,38,0.12)" },
};
const DEFAULT_PILL = { color: "#64748b", bg: "rgba(100,116,139,0.12)" };
function Pill({ tone, children }: { tone: { color: string; bg: string }; children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700,
      borderRadius: 999, padding: "2px 7px", lineHeight: "15px", color: tone.color, background: tone.bg,
    }}>
      {children}
    </span>
  );
}
// ชิปรอง (ชำระ/จัดส่ง) เป็นเส้นขอบจางแบบ TOOL_CHIP_BASE — ไม่ติดสีเหมือน channel/status เพราะเป็น
// ข้อมูลเสริม ไม่ใช่สถานะหลักของออเดอร์
function OutlinePill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 600,
      borderRadius: 999, padding: "2px 7px", lineHeight: "15px", color: "var(--app-muted, #64748b)",
      border: "1px solid var(--app-border, rgba(15,23,42,0.12))",
    }}>
      {children}
    </span>
  );
}
const PANEL_COLLAPSE_KEY = "bms_inbox_customer360_collapsed";
const money = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;
const dateOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const orderSubtotal = (order: any) =>
  (order?.items || []).reduce((sum: number, it: any) => sum + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0);
const discountLabel = (order: any, t: (key: string, vars?: Record<string, any>) => string) =>
  Number(order?.discountAmount || 0) > 0
    ? t("admin_inbox_customer360.orders_discount_label", {
        coupon: order?.couponCode ? ` (${order.couponCode})` : "",
        amount: money(order.discountAmount),
      })
    : null;
const couponStateColor: Record<string, string> = {
  ASSIGNED: "default",
  RESERVED: "gold",
  REDEEMED: "green",
  EXPIRED: "red",
  REVOKED: "volcano",
};
const COUPON_STATE_KEY: Record<string, string> = {
  ASSIGNED: "coupon_state_assigned",
  RESERVED: "coupon_state_reserved",
  REDEEMED: "coupon_state_redeemed",
  EXPIRED: "coupon_state_expired",
  REVOKED: "coupon_state_revoked",
};
const couponStateLabelText = (state: string, t: (key: string, vars?: Record<string, any>) => string) =>
  COUPON_STATE_KEY[state] ? t(`admin_inbox_customer360.${COUPON_STATE_KEY[state]}`) : state;

function SectionLoading() {
  return <Skeleton active paragraph={{ rows: 3 }} />;
}

// ---- Section 1 — Customer Summary ------------------------------
function SummarySection({ c, conv }: { c: any; conv: any }) {
  const { t } = useI18n();
  if (!c) return <Empty description={t("admin_inbox_customer360.empty_no_customer_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const tagBadges: { label: string; color: string }[] = [
    ...(c.tags || []).includes("VIP") ? [{ label: "VIP", color: "gold" }] : [],
    ...(c.tags || []).includes("Fraud Risk") ? [{ label: "Fraud Risk", color: "red" }] : [],
    c.isNewCustomer
      ? { label: t("admin_inbox_customer360.customer_new"), color: "blue" }
      : { label: t("admin_inbox_customer360.customer_returning"), color: "cyan" },
  ];
  return (
    <div>
      {/* ขนาดพวกนี้ต้องกำหนดตรงนี้ ไม่ใช่ที่ customer360.module.css — inline style/prop
          ชนะ CSS module เสมอ (เคยพลาดตอนย่อ panel รอบแรก แล้วชื่อ/avatar ไม่เล็กลงจริง) */}
      <Space align="start" size={8}>
        <Avatar size={34} icon={<UserOutlined />} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.25 }}>{c.name}</div>
          <Text type="secondary" style={{ fontSize: 9.5 }}>{t("admin_inbox_customer360.id_label", { id: c.id })}</Text>
        </div>
      </Space>
      <div style={{ margin: "6px 0" }}>
        <Space size={4} wrap>
          {tagBadges.map((tb) => <Tag key={tb.label} color={tb.color}>{tb.label}</Tag>)}
          {(c.tags || []).filter((tag: string) => tag !== "VIP" && tag !== "Fraud Risk").map((tag: string) => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      </div>
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_customer_since")}>{dateOnly(c.createdAt)}</Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_language")}>{c.preferredLanguage || "—"}</Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_timezone")}>{c.timezone || "—"}</Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_current_channel")}>
          <Pill tone={CHANNEL_PILL[conv?.channel] || DEFAULT_PILL}>{conv?.channel}</Pill>
        </Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_assignee")}>{conv?.assignedStaff?.name || conv?.assignedStaff?.email || t("admin_inbox_customer360.summary_unassigned")}</Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.summary_conversation_status")}>{conv?.status}</Descriptions.Item>
      </Descriptions>
    </div>
  );
}

// ---- Section 2 — Contact Information ---------------------------
function ContactSection({ c, identities, addresses }: { c: any; identities: any[]; addresses: any[] }) {
  const { t } = useI18n();
  if (!c) return <Empty description={t("admin_inbox_customer360.contact_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const shipping = addresses.filter((a) => a.addressType === "shipping");
  const billing = addresses.filter((a) => a.addressType === "billing");
  return (
    <div>
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label={t("admin_inbox_customer360.contact_phone")}>{c.phone || "—"}</Descriptions.Item>
        <Descriptions.Item label={t("admin_inbox_customer360.contact_email")}>{c.email || "—"}</Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: "8px 0" }} />
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_shipping_address")}</Text>
      {shipping.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_no_address")}</Text></div> : (
        <List size="small" dataSource={shipping} renderItem={(a: any) => (
          <List.Item>{a.label ? `${a.label}: ` : ""}{a.address}{a.isDefault ? <Tag color="blue" style={{ marginLeft: 6 }}>{t("admin_inbox_customer360.contact_default_tag")}</Tag> : null}</List.Item>
        )} />
      )}
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_billing_address")}</Text>
      {billing.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_no_address")}</Text></div> : (
        <List size="small" dataSource={billing} renderItem={(a: any) => (
          <List.Item>{a.label ? `${a.label}: ` : ""}{a.address}</List.Item>
        )} />
      )}
      <Divider style={{ margin: "8px 0" }} />
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_connected_accounts")}</Text>
      {identities.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_customer360.contact_no_connected_accounts")}</Text></div> : (
        <Space size={4} wrap style={{ marginTop: 4 }}>
          {identities.map((i) => (
            <Pill key={`${i.channel}-${i.externalRef}`} tone={CHANNEL_PILL[i.channel] || DEFAULT_PILL}>
              {i.channel}: {i.externalRef.slice(0, 10)}
            </Pill>
          ))}
        </Space>
      )}
    </div>
  );
}

// ---- Section 3 — Statistics --------------------------------------
function StatsSection({ s }: { s: any }) {
  const { t } = useI18n();
  if (!s) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text><Text style={{ fontSize: 12 }}>{value}</Text>
    </div>
  );
  return (
    <div>
      {row(t("admin_inbox_customer360.stats_lifetime_value"), money(s.lifetimeValue))}
      {row(t("admin_inbox_customer360.stats_total_orders"), s.totalOrders)}
      {row(t("admin_inbox_customer360.stats_avg_order_value"), money(s.avgOrderValue))}
      {row(t("admin_inbox_customer360.stats_completed_orders"), s.completedOrders)}
      {row(t("admin_inbox_customer360.stats_cancelled_orders"), s.cancelledOrders)}
      {row(t("admin_inbox_customer360.stats_refund_count"), s.refundCount)}
      {row(t("admin_inbox_customer360.stats_last_order"), dateOnly(s.lastOrderDate))}
      {row(t("admin_inbox_customer360.stats_last_conversation"), dateTime(s.lastConversationAt))}
      {row(
        t("admin_inbox_customer360.stats_avg_response_time"),
        s.avgResponseTimeSeconds != null
          ? t("admin_inbox_customer360.stats_minutes", { minutes: Math.round(s.avgResponseTimeSeconds / 60) })
          : "—"
      )}
    </div>
  );
}

// ---- Section 4 — Recent Orders (all channels) --------------------
function RecentOrdersSection({
  orders, selectedOrderId, onOpenPreview,
}: { orders: any[]; selectedOrderId: string | null; onOpenPreview: (orderId: string) => void }) {
  const { t } = useI18n();
  if (!orders?.length) return <Empty description={t("admin_inbox_customer360.orders_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {orders.map((o: any) => {
        const selected = selectedOrderId === o.id;
        return (
          <div
            key={o.id}
            style={{
              padding: "9px 10px",
              borderRadius: 10,
              border: selected ? "1px solid rgba(22,119,255,0.35)" : "1px solid var(--app-border, rgba(15,23,42,0.12))",
              // พื้นการ์ดจมลงหนึ่งระดับจากพื้น panel (var(--app-surface-2)) แทนพื้นขาวตรง ๆ ให้เห็น
              // ขอบเขตการ์ดชัดโดยไม่ต้องมีเงา และตัดปัญหาสีชิปข้างในดูขัดกับพื้นการ์ดขาวจั๊วะ
              background: selected ? "rgba(22,119,255,0.06)" : "var(--app-surface-2, #f1f5f9)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
              <Pill tone={CHANNEL_PILL[o.channel] || DEFAULT_PILL}>{o.channel}</Pill>
              <Pill tone={STATUS_PILL[o.status] || DEFAULT_PILL}>{o.status}</Pill>
              <Text style={{ fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700, color: "var(--app-muted, #64748b)", marginInlineStart: "auto" }}>
                #{String(o.id).slice(0, 8)}
              </Text>
            </div>
            {(o.paymentStatus || o.shipmentStatus) && (
              <Space size={4} wrap style={{ marginBottom: 6 }}>
                {o.paymentStatus && <OutlinePill>{t("admin_inbox_customer360.orders_payment_label", { status: o.paymentStatus })}</OutlinePill>}
                {o.shipmentStatus && <OutlinePill>{t("admin_inbox_customer360.orders_shipment_label", { status: o.shipmentStatus })}</OutlinePill>}
              </Space>
            )}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
              <Text type="secondary" style={{ fontSize: 10.5 }}>{dateOnly(o.createdAt)}</Text>
              <Text strong style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{money(o.totalAmount)}</Text>
            </div>
            {o.trackingNo && (
              <div style={{ fontSize: 11, color: "var(--app-muted, #64748b)" }}>{t("admin_inbox_customer360.orders_tracking_no", { trackingNo: o.trackingNo })}</div>
            )}
            {discountLabel(o, t) && (
              <div style={{ fontSize: 11, color: "var(--app-danger, #dc2626)", marginTop: 2 }}>{discountLabel(o, t)}</div>
            )}
            <div style={{ fontSize: 11, color: "var(--app-muted, #64748b)", marginTop: 4, marginBottom: 8 }}>
              {(o.items || []).map((it: any) => `${it.sku}×${it.qty}`).join(", ")}
            </div>
            <Space size={6}>
              <Button size="small" type={selected ? "primary" : "default"} style={{ fontWeight: 600 }} onClick={() => onOpenPreview(o.id)}>
                {t("admin_inbox_customer360.orders_open_order")}
              </Button>
              {o.channel !== "web" && o.channel !== "test" && (
                <Tooltip title={t("admin_inbox_customer360.orders_open_marketplace_tooltip")}>
                  <Button size="small" disabled>{t("admin_inbox_customer360.orders_open_marketplace")}</Button>
                </Tooltip>
              )}
            </Space>
          </div>
        );
      })}
    </Space>
  );
}

function OrderPreviewDrawer({
  open, order, onClose,
}: { open: boolean; order: any | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Drawer
      title={
        <Space size={8} wrap>
          <Text strong>{t("admin_inbox_customer360.drawer_title")}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_customer360.drawer_subtitle")}</Text>
        </Space>
      }
      placement="right"
      width={380}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        order ? (
          <Link href={`/admin/orders?highlight=${order.id}`} target="_blank" rel="noreferrer">
            <Button size="small" type="primary">{t("admin_inbox_customer360.drawer_open_orders_full")}</Button>
          </Link>
        ) : null
      }
    >
      {!order ? (
        <Empty description={t("admin_inbox_customer360.drawer_select_order")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={6} wrap>
            <Pill tone={CHANNEL_PILL[order.channel] || DEFAULT_PILL}>{order.channel}</Pill>
            <Text strong style={{ fontSize: 18 }}>#{String(order.id).slice(0, 8)}</Text>
            <Pill tone={STATUS_PILL[order.status] || DEFAULT_PILL}>{order.status}</Pill>
          </Space>

          <Descriptions size="small" column={1} colon={false}>
            <Descriptions.Item label={t("admin_inbox_customer360.drawer_date")}>{dateTime(order.createdAt)}</Descriptions.Item>
            <Descriptions.Item label={t("admin_inbox_customer360.drawer_subtotal")}>{money(orderSubtotal(order))}</Descriptions.Item>
            {Number(order.discountAmount || 0) > 0 && (
              <Descriptions.Item label={t("admin_inbox_customer360.drawer_discount_label", { coupon: order.couponCode ? ` (${order.couponCode})` : "" })}>
                <Text type="danger">-{money(order.discountAmount)}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t("admin_inbox_customer360.drawer_total")}>{money(order.totalAmount)}</Descriptions.Item>
            <Descriptions.Item label={t("admin_inbox_customer360.drawer_payment")}>{order.paymentStatus || "—"}{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}</Descriptions.Item>
            <Descriptions.Item label={t("admin_inbox_customer360.drawer_shipment")}>
              {order.shipmentStatus || "—"}{order.carrier ? ` · ${order.carrier}` : ""}{order.trackingNo ? ` · ${order.trackingNo}` : ""}
            </Descriptions.Item>
          </Descriptions>

          <div>
            <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.drawer_items")}</Text>
            <List
              size="small"
              dataSource={order.items || []}
              locale={{ emptyText: t("admin_inbox_customer360.drawer_no_items") }}
              renderItem={(it: any) => (
                <List.Item>
                  <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <Text style={{ fontSize: 12 }}>{it.sku}</Text>
                      <div><Text type="secondary" style={{ fontSize: 11 }}>{t("admin_inbox_customer360.drawer_item_size_qty", { size: it.size || "—", qty: it.qty })}</Text></div>
                    </div>
                    <Text style={{ fontSize: 12 }}>{money((Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}</Text>
                  </div>
                </List.Item>
              )}
            />
          </div>

          <Alert
            type="info"
            showIcon
            message={t("admin_inbox_customer360.drawer_alert_title")}
            description={t("admin_inbox_customer360.drawer_alert_desc")}
          />
        </Space>
      )}
    </Drawer>
  );
}

// ---- Section 5 — Products purchased ------------------------------
function ProductStatList({ rows }: { rows: any[] }) {
  const { t } = useI18n();
  if (!rows?.length) return <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_no_data")}</Text>;
  return (
    <List size="small" dataSource={rows} renderItem={(p: any) => (
      <List.Item>
        <Text style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_row", { name: p.name, qty: p.qty, revenue: money(p.revenue) })}</Text>
      </List.Item>
    )} />
  );
}
function ProductsSection({ products }: { products: any }) {
  const { t } = useI18n();
  if (!products) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const has = products.topPurchased?.length || products.recentlyPurchased?.length;
  if (!has) return <Empty description={t("admin_inbox_customer360.products_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_top")}</Text>
      <ProductStatList rows={products.topPurchased} />
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_recent")}</Text>
      <ProductStatList rows={products.recentlyPurchased} />
      <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_frequent")}</Text>
      <ProductStatList rows={products.frequentlyPurchased} />
      {products.favoriteCategories?.length > 0 && (
        <>
          <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.products_favorite_categories")}</Text>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {products.favoriteCategories.map((cat: any) => <Tag key={cat.category}>{t("admin_inbox_customer360.products_category_tag", { category: cat.category, qty: cat.qty })}</Tag>)}
          </Space>
        </>
      )}
    </div>
  );
}

// ---- Section 6 — Current shopping cart ----------------------------
// ไม่มีสถานะ DRAFT แยกในสคีมา — ใช้ order PENDING ล่าสุดที่ยังไม่มี payment แทน
function CartSection({ draftOrder }: { draftOrder: any }) {
  const { t } = useI18n();
  if (!draftOrder) return <Empty description={t("admin_inbox_customer360.cart_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const subtotal = orderSubtotal(draftOrder);
  return (
    <div>
      {/* รายการ/ราคาเรียงเป็นคอลัมน์ (ชื่อซ้าย ราคาขวา) แทนบรรทัดเดียวคั่นด้วย · —
          กวาดตาหาราคาได้เร็วกว่าเวลามีหลายรายการ */}
      {draftOrder.items?.map((it: any) => (
        <div key={`${it.sku}-${it.size}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2px 0" }}>
          <Text style={{ fontSize: 11.5, minWidth: 0, flex: 1 }}>{it.sku} ({it.size}) × {it.qty}</Text>
          <Text style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{money(it.unitPrice * it.qty)}</Text>
        </div>
      ))}
      {Number(draftOrder.discountAmount || 0) > 0 && (
        <>
          <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 11, minWidth: 0, flex: 1 }}>{t("admin_inbox_customer360.cart_subtotal")}</Text>
            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{money(subtotal)}</Text>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 11, minWidth: 0, flex: 1 }}>
              {t("admin_inbox_customer360.cart_discount_label", { coupon: draftOrder.couponCode ? ` (${draftOrder.couponCode})` : "" })}
            </Text>
            <Text type="danger" style={{ fontSize: 11, flexShrink: 0 }}>-{money(draftOrder.discountAmount)}</Text>
          </div>
        </>
      )}
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: "1px solid var(--app-border, rgba(15,23,42,0.12))", display: "flex", alignItems: "baseline", gap: 8 }}>
        <Text strong style={{ fontSize: 12, minWidth: 0, flex: 1 }}>{t("admin_inbox_customer360.cart_total")}</Text>
        <Text strong style={{ fontSize: 13, flexShrink: 0 }}>{money(draftOrder.totalAmount)}</Text>
      </div>
      <Link href={`/admin/orders?highlight=${draftOrder.id}`} style={{ display: "block", marginTop: 7 }}>
        <Button size="small" block icon={<ShoppingOutlined />}>{t("admin_inbox_customer360.cart_open_draft")}</Button>
      </Link>
    </div>
  );
}

// ---- Section 7 — Notes (internal, staff only) ---------------------
function NotesSection({ notes }: { notes: any[] }) {
  const { t } = useI18n();
  if (!notes?.length) return <Empty description={t("admin_inbox_customer360.notes_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List size="small" dataSource={notes} renderItem={(n: any) => (
      <List.Item>
        <List.Item.Meta
          title={<Text type="secondary" style={{ fontSize: 11 }}>{n.author || "—"} · {dateTime(n.createdAt)}</Text>}
          description={<Text style={{ fontSize: 12 }}>{n.body}</Text>}
        />
      </List.Item>
    )} />
  );
}

function CouponWalletSection({ coupons }: { coupons: any[] }) {
  const { t } = useI18n();
  if (!coupons?.length) return <Empty description={t("admin_inbox_customer360.coupon_wallet_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List
      size="small"
      dataSource={coupons}
      renderItem={(coupon: any) => (
        <List.Item style={{ display: "block", padding: 7 }}>
          <Space size={5} wrap style={{ marginBottom: 3 }}>
            <Text strong style={{ fontSize: 12 }}>{coupon.code}</Text>
            <Tag color={couponStateColor[coupon.state] || "default"}>{couponStateLabelText(coupon.state, t)}</Tag>
            {coupon.available ? <Tag color="green">{t("admin_inbox_customer360.coupon_available")}</Tag> : <Tag color="default">{t("admin_inbox_customer360.coupon_unavailable")}</Tag>}
          </Space>

          <div style={{ fontSize: 12, marginBottom: 2 }}>
            {coupon.type === "PERCENT" ? t("admin_inbox_customer360.coupon_percent_off", { value: coupon.value }) : t("admin_inbox_customer360.coupon_amount_off", { value: money(coupon.value) })}
            {coupon.minOrderAmount != null ? t("admin_inbox_customer360.coupon_min_order", { amount: money(coupon.minOrderAmount) }) : ""}
            {coupon.discountPreview != null ? t("admin_inbox_customer360.coupon_discount_preview", { amount: money(coupon.discountPreview) }) : ""}
          </div>

          <div style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>
            {t("admin_inbox_customer360.coupon_assigned_at", { date: dateTime(coupon.assignedAt) })}
            {coupon.expiresAt ? t("admin_inbox_customer360.coupon_expires_at", { date: dateTime(coupon.expiresAt) }) : t("admin_inbox_customer360.coupon_no_expiry")}
          </div>

          {(coupon.state === "RESERVED" || coupon.state === "REDEEMED") && (coupon.reservedOrderId || coupon.redeemedOrderId) && (
            <div style={{ fontSize: 12, marginTop: 2 }}>
              <Text type="secondary">
                {coupon.state === "REDEEMED" ? t("admin_inbox_customer360.coupon_bound_redeemed") : t("admin_inbox_customer360.coupon_bound_reserved")}{" "}
              </Text>
              <Link href={`/admin/orders?highlight=${coupon.redeemedOrderId || coupon.reservedOrderId}`}>
                #{String(coupon.redeemedOrderId || coupon.reservedOrderId).slice(0, 8)}
              </Link>
            </div>
          )}

          {!coupon.available && coupon.reason && (
            <div style={{ fontSize: 12, color: "var(--app-danger, #cf1322)", marginTop: 2 }}>{coupon.reason}</div>
          )}

          <div style={{ fontSize: 11, color: "var(--app-muted, #888)", marginTop: 2 }}>
            {t("admin_inbox_customer360.coupon_used_count", { count: coupon.customerUsedCount })}
            {coupon.remainingRedemptions != null ? t("admin_inbox_customer360.coupon_remaining", { n: coupon.remainingRedemptions }) : ""}
            {coupon.source ? t("admin_inbox_customer360.coupon_source", { source: coupon.source }) : ""}
          </div>
        </List.Item>
      )}
    />
  );
}

function AssignCouponModal({
  open, customerId, channel, customerRef, conversationId, canManage, onClose, onDone,
}: { open: boolean; customerId: string | null; channel?: string | null; customerRef?: string | null; conversationId?: string | null; canManage: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const { data, loading } = useQuery(Q_COUPONS_PICKER, {
    skip: !open || !canManage,
    fetchPolicy: "cache-and-network",
  });
  const couponOptions = (data?.bmsCoupons || [])
    .filter((coupon: any) => coupon.active)
    .map((coupon: any) => ({
      value: coupon.code,
      label: `${coupon.code} · ${coupon.type === "PERCENT" ? `${coupon.value}%` : money(coupon.value)}${coupon.expiresAt ? t("admin_inbox_customer360.assign_coupon_option_expiry", { date: dateOnly(coupon.expiresAt) }) : ""}`,
    }));

  const [assignCoupon, { loading: saving }] = useMutation(M_ASSIGN_CUSTOMER_COUPON, {
    onCompleted: () => {
      message.success(t("admin_inbox_customer360.assign_coupon_success"));
      form.resetFields();
      onDone();
    },
    onError: (e: any) => message.error(e?.message || t("admin_inbox_customer360.assign_coupon_error")),
  });

  const submit = async () => {
    const values = await form.validateFields();
    await assignCoupon({
      variables: {
        customerId,
        channel: channel ?? null,
        customerRef: customerRef ?? null,
        conversationId: conversationId ?? null,
        code: String(values.code || "").trim(),
        note: values.note?.trim() || null,
      },
    });
  };

  return (
    <Modal
      title={t("admin_inbox_customer360.assign_coupon_modal_title")}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={t("admin_inbox_customer360.assign_coupon_ok_text")}
      cancelText={t("admin_inbox_customer360.cancel_text")}
      confirmLoading={saving}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("admin_inbox_customer360.assign_coupon_alert_title")}
        description={t("admin_inbox_customer360.assign_coupon_alert_desc")}
      />
      <Form form={form} layout="vertical">
        <Form.Item name="code" label={t("admin_inbox_customer360.assign_coupon_field_label")} rules={[{ required: true, message: t("admin_inbox_customer360.assign_coupon_field_required") }]}>
          <Select
            showSearch
            placeholder={t("admin_inbox_customer360.assign_coupon_placeholder")}
            loading={loading}
            options={couponOptions}
            filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="note" label={t("admin_inbox_customer360.assign_coupon_note_label")}>
          <Input placeholder={t("admin_inbox_customer360.assign_coupon_note_placeholder")} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Section 8 — Timeline (lazy) -----------------------------------
function TimelineSection({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const [load, { data, loading, called }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });
  useEffect(() => { if (customerId) load({ variables: { customerId } }); }, [customerId]); // eslint-disable-line
  if (!called || loading) return <SectionLoading />;
  const entries = data?.bmsCustomerTimeline || [];
  if (!entries.length) return <Empty description={t("admin_inbox_customer360.timeline_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List size="small" dataSource={entries} renderItem={(t: any) => (
      <List.Item>
        <List.Item.Meta
          title={<Space size={4}><Tag>{t.type}</Tag><Text type="secondary" style={{ fontSize: 11 }}>{dateTime(t.at)}</Text></Space>}
          description={<Text style={{ fontSize: 12 }}>{t.text}</Text>}
        />
      </List.Item>
    )} />
  );
}

// ---- Section 9 — AI Insights (lazy) --------------------------------
function InsightsSection({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const [load, { data, loading, called }] = useLazyQuery(Q_INSIGHTS, { fetchPolicy: "cache-first" });
  useEffect(() => { if (customerId) load({ variables: { customerId } }); }, [customerId]); // eslint-disable-line
  if (!called || loading) return <SectionLoading />;
  const insights = data?.bmsCustomerInsights;
  if (!insights) return <Empty description={t("admin_inbox_customer360.insights_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 12, marginBottom: 4 }}>{insights.summary}</Paragraph>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {t("admin_inbox_customer360.insights_footer", {
          source: insights.cached ? t("admin_inbox_customer360.insights_cached") : t("admin_inbox_customer360.insights_fresh"),
          date: dateTime(insights.generatedAt),
        })}
      </Text>
    </div>
  );
}

// ---- Create Order modal (staff manually creates an order for this customer) ----
type ProductOpt = { sku: string; name: string; variants: { size: string; available: number }[] };

function CreateOrderModal({
  open, conv, selectedCouponCode, onClose, onDone,
}: { open: boolean; conv: any; selectedCouponCode?: string | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const { data: prodData, loading: prodLoading } = useQuery(Q_PRODUCTS_FOR_ORDER, {
    skip: !open, fetchPolicy: "cache-and-network",
  });
  const products: ProductOpt[] = prodData?.bmsProducts?.items || [];

  useEffect(() => {
    if (open && selectedCouponCode) {
      form.setFieldValue("couponCode", selectedCouponCode);
    }
  }, [open, selectedCouponCode, form]);

  const [create, { loading }] = useMutation(M_CREATE_ORDER, {
    onCompleted: (d: any) => {
      const res = d?.bmsCreateOrder;
      if (res?.status === "CREATED") { message.success(res.message || t("admin_inbox_customer360.create_order_success_default")); form.resetFields(); onDone(); }
      else message.error(res?.message || t("admin_inbox_customer360.create_order_error_default"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_inbox_customer360.create_order_error_default")),
  });

  const submit = async () => {
    const v = await form.validateFields();
    const items = (v.items || []).map((it: any) => ({ sku: it.sku, size: it.size, qty: Number(it.qty) }));
    create({
      variables: {
        channel: conv?.channel || "web", customerRef: conv?.customerRef || null, items,
        couponCode: v.couponCode?.trim() || null,
      },
    });
  };

  return (
    <Modal
      title={t("admin_inbox_customer360.create_order_modal_title")} open={open} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText={t("admin_inbox_customer360.create_order_ok_text")} cancelText={t("admin_inbox_customer360.cancel_text")} width={640} destroyOnClose
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message={t("admin_inbox_customer360.create_order_alert", { channel: conv?.channel || "web" })}
      />
      {selectedCouponCode && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("admin_inbox_customer360.create_order_coupon_found_title", { code: selectedCouponCode })}
          description={t("admin_inbox_customer360.create_order_coupon_found_desc")}
        />
      )}
      <Form form={form} layout="vertical" initialValues={{ items: [{ qty: 1 }] }}>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item
                    {...rest} name={[name, "sku"]} rules={[{ required: true, message: t("admin_inbox_customer360.create_order_select_product_required") }]}
                  >
                    <Select
                      showSearch style={{ width: 220 }} placeholder={t("admin_inbox_customer360.create_order_product_placeholder")} loading={prodLoading}
                      options={products.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
                      filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                      onChange={() => form.setFieldValue(["items", name, "size"], undefined)}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.items?.[name]?.sku !== cur.items?.[name]?.sku}>
                    {() => {
                      const sku = form.getFieldValue(["items", name, "sku"]);
                      const prod = products.find((p) => p.sku === sku);
                      return (
                        <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true, message: t("admin_inbox_customer360.create_order_select_size_required") }]} style={{ marginBottom: 0 }}>
                          <Select
                            style={{ width: 170 }} placeholder={t("admin_inbox_customer360.create_order_size_placeholder")} disabled={!prod}
                            options={(prod?.variants || []).map((v) => ({
                              value: v.size, label: t("admin_inbox_customer360.create_order_size_available", { size: v.size, available: v.available }), disabled: v.available <= 0,
                            }))}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "qty"]} rules={[{ required: true, message: t("admin_inbox_customer360.create_order_qty_required") }]}>
                    <InputNumber placeholder={t("admin_inbox_customer360.create_order_qty_placeholder")} min={1} style={{ width: 90 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(name)} />}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ qty: 1 })} icon={<PlusOutlined />} block>{t("admin_inbox_customer360.create_order_add_item")}</Button>
            </>
          )}
        </Form.List>
        <Form.Item name="couponCode" label={t("admin_inbox_customer360.create_order_coupon_label")} style={{ marginTop: 16, marginBottom: 0 }}>
          <Input placeholder={t("admin_inbox_customer360.create_order_coupon_placeholder")} style={{ width: 220 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Invoice modal (ใบแจ้งหนี้จากออร์เดอร์จริง — คำนวณสด ไม่ persist) ----
function InvoiceModal({
  open, orders, onClose,
}: { open: boolean; orders: any[]; onClose: () => void }) {
  const { t } = useI18n();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [load, { data, loading }] = useLazyQuery(Q_INVOICE, { fetchPolicy: "network-only" });

  useEffect(() => {
    if (!open) { setOrderId(null); return; }
    const first = orders?.[0]?.id ?? null;
    setOrderId(first);
    if (first) load({ variables: { orderId: first } });
  }, [open]); // eslint-disable-line

  const pick = (id: string) => { setOrderId(id); load({ variables: { orderId: id } }); };
  const doc = data?.bmsGenerateInvoice;

  return (
    <Modal
      title={t("admin_inbox_customer360.invoice_modal_title")} open={open} onCancel={onClose} width={640} destroyOnClose
      footer={[
        <Button key="close" onClick={onClose}>{t("admin_inbox_customer360.invoice_close")}</Button>,
        <Button key="print" type="primary" disabled={!doc} onClick={() => window.print()}>{t("admin_inbox_customer360.invoice_print")}</Button>,
      ]}
    >
      <Select
        style={{ width: "100%", marginBottom: 16 }}
        placeholder={t("admin_inbox_customer360.invoice_select_order_placeholder")} value={orderId ?? undefined}
        options={(orders || []).map((o: any) => ({
          value: o.id, label: t("admin_inbox_customer360.invoice_select_option_label", { id: String(o.id).slice(0, 8), channel: o.channel, amount: money(o.totalAmount) }),
        }))}
        onChange={pick}
      />
      {loading ? <SectionLoading /> : !doc ? (
        <Empty description={t("admin_inbox_customer360.invoice_select_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <Text strong style={{ fontSize: 16 }}>{doc.store.name || "—"}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>{doc.store.address || ""}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {doc.store.phone ? t("admin_inbox_customer360.invoice_phone", { phone: doc.store.phone }) : ""}{doc.store.taxId ? t("admin_inbox_customer360.invoice_tax_id", { taxId: doc.store.taxId }) : ""}
              </Text>
            </div>
            <div style={{ textAlign: "right" }}>
              <Text strong>{t("admin_inbox_customer360.invoice_number", { number: doc.number })}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>{dateOnly(doc.date)}</Text>
            </div>
          </div>
          <Descriptions size="small" column={2} colon={false} style={{ marginBottom: 12 }}>
            <Descriptions.Item label={t("admin_inbox_customer360.invoice_customer")}>{doc.customerRef || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("admin_inbox_customer360.invoice_channel")}>{doc.channel || "—"}</Descriptions.Item>
            {doc.paymentStatus && <Descriptions.Item label={t("admin_inbox_customer360.invoice_order_status")}>{doc.paymentStatus}</Descriptions.Item>}
          </Descriptions>
          <Table
            size="small" pagination={false} rowKey={(r: any) => `${r.sku}-${r.size}`}
            dataSource={doc.lines}
            columns={[
              { title: t("admin_inbox_customer360.invoice_col_product"), dataIndex: "name" },
              { title: t("admin_inbox_customer360.invoice_col_size"), dataIndex: "size", width: 60 },
              { title: t("admin_inbox_customer360.invoice_col_qty"), dataIndex: "qty", width: 70, align: "right" as const },
              { title: t("admin_inbox_customer360.invoice_col_unit_price"), dataIndex: "unitPrice", width: 100, align: "right" as const, render: money },
              { title: t("admin_inbox_customer360.invoice_col_amount"), dataIndex: "amount", width: 100, align: "right" as const, render: money },
            ]}
          />
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <div><Text type="secondary">{t("admin_inbox_customer360.invoice_subtotal")}</Text><Text>{money(doc.subtotal)}</Text></div>
            {doc.discount > 0 && (
              <div><Text type="secondary">{t("admin_inbox_customer360.invoice_discount", { coupon: doc.couponCode ? ` (${doc.couponCode})` : "" })}</Text><Text type="danger">-{money(doc.discount)}</Text></div>
            )}
            {doc.shippingFee != null && <div><Text type="secondary">{t("admin_inbox_customer360.invoice_shipping")}</Text><Text>{money(doc.shippingFee)}</Text></div>}
            <div><Text strong style={{ fontSize: 15 }}>{t("admin_inbox_customer360.invoice_total", { total: money(doc.total) })}</Text></div>
          </div>
          <Divider style={{ margin: "12px 0" }} />
          <Text type="secondary" style={{ fontSize: 11 }}>{doc.note}</Text>
        </div>
      )}
    </Modal>
  );
}

// ---- Section 10 — Quick Actions ------------------------------------
// แถว icon+label+chevron แทน <Button block> 5 ปุ่มทรงเดียวกันเดิม — ปุ่มแรก (สร้างออเดอร์ = action
// ที่ใช้บ่อยสุด) ใส่ prop primary ให้พื้น/ตัวหนังสือเด่นกว่าที่เหลือ ส่วน logic สิทธิ์/disabled/Tooltip
// เดิมทั้งหมดยังอยู่ครบ แค่ย้าย Tooltip มาห่อ QaButton ตัวเดียวกันแทนการสร้าง Button disabled คู่ขนาน
function QaButton({
  icon, primary, disabled, tooltip, href, onClick, children,
}: { icon: React.ReactNode; primary?: boolean; disabled?: boolean; tooltip?: string; href?: string; onClick?: () => void; children: React.ReactNode }) {
  const iconWrap = (
    <span style={{
      width: 26, height: 26, borderRadius: 999, flexShrink: 0, display: "inline-flex",
      alignItems: "center", justifyContent: "center", fontSize: 12,
      background: primary && !disabled ? "rgba(22,119,255,0.16)" : "var(--app-surface-2, #f1f5f9)",
      color: primary && !disabled ? "#1677ff" : "var(--app-muted, #64748b)",
    }}>
      {icon}
    </span>
  );
  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 9, height: "auto", width: "100%",
    padding: "7px 8px", borderRadius: 8, textAlign: "start",
    background: primary && !disabled ? "rgba(22,119,255,0.08)" : "transparent",
    border: primary && !disabled ? "1px solid rgba(22,119,255,0.22)" : "1px solid transparent",
  };
  const btn = (
    <Button block type="text" disabled={disabled} onClick={onClick} style={rowStyle}>
      {iconWrap}
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: primary ? 700 : 600, color: primary && !disabled ? "#1677ff" : undefined }}>
        {children}
      </span>
      <RightOutlined style={{ fontSize: 9, color: "var(--app-muted, #64748b)", flexShrink: 0 }} />
    </Button>
  );
  const wrapped = href && !disabled ? <Link href={href}>{btn}</Link> : btn;
  return tooltip ? <Tooltip title={tooltip}>{wrapped}</Tooltip> : wrapped;
}

function QuickActionsSection({ can, conv, orders, onCreateOrder, onInvoice }: { can: (p: string) => boolean; conv: any; orders: any[]; onCreateOrder: () => void; onInvoice: () => void }) {
  const { t } = useI18n();
  const hasRefundable = orders?.some((o) => o.paymentStatus === "CONFIRMED");
  return (
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      <QaButton
        icon={<PlusOutlined />}
        primary
        disabled={!can("order.create")}
        tooltip={can("order.create") ? undefined : t("admin_inbox_customer360.qa_no_permission", { perm: "order.create" })}
        onClick={onCreateOrder}
      >
        {t("admin_inbox_customer360.qa_create_order")}
      </QaButton>
      <QaButton icon={<ContainerOutlined />} href="/admin/products">{t("admin_inbox_customer360.qa_check_stock")}</QaButton>
      <QaButton
        icon={<RollbackOutlined />}
        href="/admin/payment"
        disabled={!can("payment.refund") || !hasRefundable}
        tooltip={!can("payment.refund") ? t("admin_inbox_customer360.qa_no_permission", { perm: "payment.refund" }) : !hasRefundable ? t("admin_inbox_customer360.qa_refund_no_orders") : undefined}
      >
        {t("admin_inbox_customer360.qa_refund")}
      </QaButton>
      <QaButton
        icon={<FileTextOutlined />}
        disabled={!can("order.view") || !orders?.length}
        tooltip={!can("order.view") ? t("admin_inbox_customer360.qa_no_permission", { perm: "order.view" }) : !orders?.length ? t("admin_inbox_customer360.qa_invoice_no_orders") : undefined}
        onClick={onInvoice}
      >
        {t("admin_inbox_customer360.qa_invoice")}
      </QaButton>
      <QaButton icon={<UserOutlined />} href="/admin/customers">{t("admin_inbox_customer360.qa_open_customer_page")}</QaButton>
    </Space>
  );
}

// ---- Main panel ------------------------------------------------
function Customer360Panel({ conv, can, selectedCouponCode }: { conv: any; can: (p: string) => boolean; selectedCouponCode?: string | null }) {
  const { t } = useI18n();
  const customerId: string | null = conv?.customerId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(window.localStorage.getItem(PANEL_COLLAPSE_KEY) === "1"); }, []);
  const toggle = () => setCollapsed((v) => { const n = !v; window.localStorage.setItem(PANEL_COLLAPSE_KEY, n ? "1" : "0"); return n; });

  const { data, loading, error, refetch } = useQuery(Q_CUSTOMER_360, {
    variables: {
      customerId,
      channel: conv?.channel ?? null,
      customerRef: conv?.customerRef ?? null,
      // The resolver only needs to look the conversation up when no CRM
      // customer has been linked yet. Avoid that extra DB round trip normally.
      conversationId: customerId ? null : conv?.id ?? null,
    },
    skip: !conv?.id,
    fetchPolicy: "cache-first",
  });
  const c360 = data?.bmsCustomer360;
  const resolvedCustomerId: string | null = c360?.customer?.id ?? null;
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [assignCouponOpen, setAssignCouponOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [previewOrderId, setPreviewOrderId] = useState<string | null>(null);
  const recentOrders = c360?.recentOrders || [];
  const previewOrder = recentOrders.find((o: any) => o.id === previewOrderId) || null;

  useEffect(() => {
    setPreviewOrderId(null);
  }, [customerId]);

  if (collapsed) {
    return (
      <div style={{ width: 40, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <Tooltip title={t("admin_inbox_customer360.panel_expand_tooltip")} placement="left">
          <Button type="text" size="small" icon={<MenuUnfoldOutlined />} onClick={toggle} />
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={panelStyles.panel} style={{
      width: 292, maxWidth: "30vw", flexShrink: 0, minHeight: 0, minWidth: 260, overflowY: "auto", overflowX: "hidden",
      border: "1px solid var(--app-border, #eee)", borderRadius: 10, padding: 8,
      height: "100%",
      // panel เองไม่เคยมี background ของตัวเอง (พึ่งพื้นของ card/section ย่อยแต่ละอันเอาเอง) — ช่องว่าง
      // ระหว่าง section (เช่น margin ใต้ sticky header) จึงโปร่งใส เห็นสิ่งที่อยู่ข้างหลังทะลุมา ดูเหมือน
      // "พื้นหลังไม่เต็ม" ตอนเลื่อนเนื้อหาผ่านช่องว่างนั้น ใส่พื้นทึบให้ตัว panel เองไปเลย
      backgroundColor: "var(--app-surface, #ffffff)",
    }}>
      {/* ปักหัวข้อ + ปุ่มแจกคูปอง/ย่อแผงไว้บนสุดของกรอบสกรอลล์เดียวกับเนื้อหา (panel เดิม overflowY:"auto"
          อยู่แล้ว ไม่ต้องเพิ่ม scroll container ใหม่) — เดิมเลื่อนหายไปพร้อมเนื้อหาด้านล่าง ต้องเลื่อน
          กลับขึ้นบนสุดถึงจะกดแจกคูปอง/ย่อแผงได้อีกครั้ง
          ⚠️ panel เดิมมี position:"sticky" ของตัวเองด้วย (top:0) — แต่พาเรนต์ (`.columns` ใน page.tsx)
          เป็น overflow:"hidden" ไม่มี scroll ให้ panel นั้น sticky ต่อจริงเลย กลายเป็น sticky ที่ไม่มี
          ancestor ให้ยึด ซ้อนกับ sticky ของ header ข้างล่างที่ยึดกับ panel เอง (ตัวที่ scroll จริง) —
          สอง position:sticky ซ้อนกันแบบนี้ทำให้ browser คำนวณ compositing layer ผิด เกิดรอยฉีก/เงา
          ระหว่างเลื่อน (ตามที่เจอ) ลบ sticky ของ panel ออก เหลือแค่ sticky ของ header ตัวเดียวพอ */}
      <div style={{
        position: "sticky", top: -8, zIndex: 2,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        margin: "-8px -8px 5px", padding: "8px 8px 6px",
        backgroundColor: "var(--app-surface, #ffffff)",
        borderBottom: "1px solid var(--app-border, rgba(15,23,42,0.12))",
        borderRadius: "10px 10px 0 0",
        isolation: "isolate",
      }}>
        <Text strong style={{ fontSize: 12 }}>{t("admin_inbox_customer360.panel_title")}</Text>
        <Space size={4}>
          {conv?.id && can("coupon.manage") && (
            /* pill เส้นขอบจางตาม mockup — ปุ่มสี่เหลี่ยมเต็มใบเดิมแย่งน้ำหนักภาพกับหัวข้อแผงเอง */
            <Button
              size="small"
              onClick={() => setAssignCouponOpen(true)}
              style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 22, fontWeight: 600, color: "#1677ff", borderColor: "rgba(22,119,255,0.3)" }}
            >
              {t("admin_inbox_customer360.panel_assign_coupon_btn")}
            </Button>
          )}
          <Tooltip title={t("admin_inbox_customer360.panel_collapse_tooltip")}>
            <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={toggle} />
          </Tooltip>
        </Space>
      </div>

      {!conv?.id ? (
        <Empty description={t("admin_inbox_customer360.panel_no_conversation")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : loading && !c360 ? (
        <SectionLoading />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message={t("admin_inbox_customer360.panel_load_error_title")}
          description={t("admin_inbox_customer360.panel_load_error_desc")}
          action={<Button size="small" onClick={() => refetch()}>{t("admin_inbox_customer360.panel_retry")}</Button>}
        />
      ) : (
        <Collapse
          size="small"
          /* ลูกศรอยู่ท้ายหัวข้อ (mockup) — ชื่อ section เริ่มชิดซ้ายเสมอ กวาดตาอ่านเป็นคอลัมน์เดียวได้ */
          expandIconPosition="end"
          defaultActiveKey={["summary", "cart", "orders", "actions"]}
          items={[
            { key: "summary", label: t("admin_inbox_customer360.panel_section_summary"), children: <SummarySection c={c360?.customer} conv={conv} /> },
            { key: "coupons", label: t("admin_inbox_customer360.panel_section_coupons", { count: c360?.coupons?.length ? ` (${c360.coupons.length})` : "" }), children: <CouponWalletSection coupons={c360?.coupons || []} /> },
            { key: "cart", label: t("admin_inbox_customer360.panel_section_cart"), children: <CartSection draftOrder={c360?.draftOrder} /> },
            {
              key: "orders",
              label: t("admin_inbox_customer360.panel_section_orders"),
              children: <RecentOrdersSection orders={recentOrders} selectedOrderId={previewOrderId} onOpenPreview={setPreviewOrderId} />,
            },
            { key: "actions", label: t("admin_inbox_customer360.panel_section_actions"), children: <QuickActionsSection can={can} conv={conv} orders={recentOrders} onCreateOrder={() => setCreateOrderOpen(true)} onInvoice={() => setInvoiceOpen(true)} /> },
            { key: "contact", label: t("admin_inbox_customer360.panel_section_contact"), children: <ContactSection c={c360?.customer} identities={c360?.identities || []} addresses={c360?.addresses || []} /> },
            { key: "stats", label: t("admin_inbox_customer360.panel_section_stats"), children: <StatsSection s={c360?.stats} /> },
            { key: "products", label: t("admin_inbox_customer360.panel_section_products"), children: <ProductsSection products={c360?.products} /> },
            { key: "notes", label: t("admin_inbox_customer360.panel_section_notes"), children: <NotesSection notes={c360?.notes || []} /> },
            { key: "timeline", label: t("admin_inbox_customer360.panel_section_timeline"), children: resolvedCustomerId ? <TimelineSection customerId={resolvedCustomerId} /> : null },
            { key: "insights", label: t("admin_inbox_customer360.panel_section_insights"), children: resolvedCustomerId ? <InsightsSection customerId={resolvedCustomerId} /> : null },
          ]}
        />
      )}
      <CreateOrderModal
        open={createOrderOpen} conv={conv} selectedCouponCode={selectedCouponCode}
        onClose={() => setCreateOrderOpen(false)}
        onDone={() => { setCreateOrderOpen(false); refetch(); }}
      />
      {conv?.id && (
        <AssignCouponModal
          open={assignCouponOpen}
          customerId={resolvedCustomerId ?? customerId}
          channel={conv?.channel ?? null}
          customerRef={conv?.customerRef ?? null}
          conversationId={conv?.id ?? null}
          canManage={can("coupon.manage")}
          onClose={() => setAssignCouponOpen(false)}
          onDone={() => { setAssignCouponOpen(false); refetch(); }}
        />
      )}
      <InvoiceModal
        open={invoiceOpen} orders={recentOrders}
        onClose={() => setInvoiceOpen(false)}
      />
      <OrderPreviewDrawer
        open={!!previewOrderId}
        order={previewOrder}
        onClose={() => setPreviewOrderId(null)}
      />
    </div>
  );
}

export default memo(Customer360Panel);
