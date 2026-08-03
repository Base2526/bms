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
import { useEffect, useState } from "react";
import {
  UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ShoppingOutlined,
  PlusOutlined, MinusCircleOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import panelStyles from "./customer360.module.css";

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

const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", lazada: "gold", test: "default",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const PANEL_COLLAPSE_KEY = "bms_inbox_customer360_collapsed";
const money = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;
const dateOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const orderSubtotal = (order: any) =>
  (order?.items || []).reduce((sum: number, it: any) => sum + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0);
const discountLabel = (order: any) =>
  Number(order?.discountAmount || 0) > 0
    ? `ส่วนลด${order?.couponCode ? ` (${order.couponCode})` : ""}: -${money(order.discountAmount)}`
    : null;
const couponStateColor: Record<string, string> = {
  ASSIGNED: "default",
  RESERVED: "gold",
  REDEEMED: "green",
  EXPIRED: "red",
  REVOKED: "volcano",
};
const couponStateLabel: Record<string, string> = {
  ASSIGNED: "แจกแล้ว",
  RESERVED: "จองกับออเดอร์",
  REDEEMED: "ใช้แล้ว",
  EXPIRED: "หมดอายุ",
  REVOKED: "ยกเลิกสิทธิ์",
};

function SectionLoading() {
  return <Skeleton active paragraph={{ rows: 3 }} />;
}

// ---- Section 1 — Customer Summary ------------------------------
function SummarySection({ c, conv }: { c: any; conv: any }) {
  if (!c) return <Empty description="ไม่มีข้อมูลลูกค้า" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const tagBadges: { label: string; color: string }[] = [
    ...(c.tags || []).includes("VIP") ? [{ label: "VIP", color: "gold" }] : [],
    ...(c.tags || []).includes("Fraud Risk") ? [{ label: "Fraud Risk", color: "red" }] : [],
    c.isNewCustomer ? { label: "ลูกค้าใหม่", color: "blue" } : { label: "ลูกค้าประจำ", color: "cyan" },
  ];
  return (
    <div>
      <Space align="start">
        <Avatar size={48} icon={<UserOutlined />} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>ID: {c.id}</Text>
        </div>
      </Space>
      <div style={{ margin: "8px 0" }}>
        <Space size={4} wrap>
          {tagBadges.map((t) => <Tag key={t.label} color={t.color}>{t.label}</Tag>)}
          {(c.tags || []).filter((t: string) => t !== "VIP" && t !== "Fraud Risk").map((t: string) => <Tag key={t}>{t}</Tag>)}
        </Space>
      </div>
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label="ลูกค้าตั้งแต่">{dateOnly(c.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="ภาษาที่ใช้">{c.preferredLanguage || "—"}</Descriptions.Item>
        <Descriptions.Item label="เขตเวลา">{c.timezone || "—"}</Descriptions.Item>
        <Descriptions.Item label="ช่องทางปัจจุบัน">
          <Tag color={CHANNEL_COLOR[conv?.channel] || "default"}>{conv?.channel}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="ผู้รับผิดชอบ">{conv?.assignedStaff?.name || conv?.assignedStaff?.email || "ยังไม่มอบหมาย"}</Descriptions.Item>
        <Descriptions.Item label="สถานะแชท">{conv?.status}</Descriptions.Item>
      </Descriptions>
    </div>
  );
}

// ---- Section 2 — Contact Information ---------------------------
function ContactSection({ c, identities, addresses }: { c: any; identities: any[]; addresses: any[] }) {
  if (!c) return <Empty description="ไม่มีข้อมูลติดต่อ" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const shipping = addresses.filter((a) => a.addressType === "shipping");
  const billing = addresses.filter((a) => a.addressType === "billing");
  return (
    <div>
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label="โทรศัพท์">{c.phone || "—"}</Descriptions.Item>
        <Descriptions.Item label="อีเมล">{c.email || "—"}</Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: "8px 0" }} />
      <Text strong style={{ fontSize: 12 }}>ที่อยู่จัดส่ง</Text>
      {shipping.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>ยังไม่มีที่อยู่</Text></div> : (
        <List size="small" dataSource={shipping} renderItem={(a: any) => (
          <List.Item>{a.label ? `${a.label}: ` : ""}{a.address}{a.isDefault ? <Tag color="blue" style={{ marginLeft: 6 }}>ค่าเริ่มต้น</Tag> : null}</List.Item>
        )} />
      )}
      <Text strong style={{ fontSize: 12 }}>ที่อยู่ออกใบเสร็จ</Text>
      {billing.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>ยังไม่มีที่อยู่</Text></div> : (
        <List size="small" dataSource={billing} renderItem={(a: any) => (
          <List.Item>{a.label ? `${a.label}: ` : ""}{a.address}</List.Item>
        )} />
      )}
      <Divider style={{ margin: "8px 0" }} />
      <Text strong style={{ fontSize: 12 }}>บัญชีที่เชื่อมต่อ</Text>
      {identities.length === 0 ? <div><Text type="secondary" style={{ fontSize: 12 }}>ไม่มีบัญชีเชื่อมต่อ</Text></div> : (
        <Space size={4} wrap style={{ marginTop: 4 }}>
          {identities.map((i) => (
            <Tag key={`${i.channel}-${i.externalRef}`} color={CHANNEL_COLOR[i.channel] || "default"}>
              {i.channel}: {i.externalRef.slice(0, 10)}
            </Tag>
          ))}
        </Space>
      )}
    </div>
  );
}

// ---- Section 3 — Statistics --------------------------------------
function StatsSection({ s }: { s: any }) {
  if (!s) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text><Text style={{ fontSize: 12 }}>{value}</Text>
    </div>
  );
  return (
    <div>
      {row("มูลค่าตลอดอายุลูกค้า", money(s.lifetimeValue))}
      {row("ออเดอร์ทั้งหมด", s.totalOrders)}
      {row("มูลค่าเฉลี่ยต่อออเดอร์", money(s.avgOrderValue))}
      {row("ออเดอร์สำเร็จ", s.completedOrders)}
      {row("ออเดอร์ยกเลิก", s.cancelledOrders)}
      {row("คืนเงิน", s.refundCount)}
      {row("ออเดอร์ล่าสุด", dateOnly(s.lastOrderDate))}
      {row("แชทล่าสุด", dateTime(s.lastConversationAt))}
      {row("เวลาตอบกลับเฉลี่ย", s.avgResponseTimeSeconds != null ? `${Math.round(s.avgResponseTimeSeconds / 60)} นาที` : "—")}
    </div>
  );
}

// ---- Section 4 — Recent Orders (all channels) --------------------
function RecentOrdersSection({
  orders, selectedOrderId, onOpenPreview,
}: { orders: any[]; selectedOrderId: string | null; onOpenPreview: (orderId: string) => void }) {
  if (!orders?.length) return <Empty description="ยังไม่มีออเดอร์" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List
      size="small" dataSource={orders}
      renderItem={(o: any) => (
        <List.Item
          style={{
            display: "block",
            padding: 10,
            marginBottom: 8,
            borderRadius: 12,
            border: selectedOrderId === o.id ? "1px solid rgba(22,119,255,0.35)" : "1px solid rgba(15,23,42,0.08)",
            background: selectedOrderId === o.id ? "rgba(22,119,255,0.06)" : "#fff",
          }}
        >
          <Space size={4} wrap style={{ marginBottom: 2 }}>
            <Tag color={CHANNEL_COLOR[o.channel] || "default"}>{o.channel}</Tag>
            <Text strong style={{ fontSize: 12 }}>#{String(o.id).slice(0, 8)}</Text>
            <Tag color={STATUS_COLOR[o.status] || "default"}>{o.status}</Tag>
            {o.paymentStatus && <Tag color="blue">ชำระ: {o.paymentStatus}</Tag>}
            {o.shipmentStatus && <Tag color="purple">จัดส่ง: {o.shipmentStatus}</Tag>}
          </Space>
          <div style={{ fontSize: 12 }}>
            {dateOnly(o.createdAt)} · {money(o.totalAmount)}
            {o.trackingNo && <> · เลขพัสดุ {o.trackingNo}</>}
          </div>
          {discountLabel(o) && (
            <div style={{ fontSize: 12, color: "var(--app-danger, #cf1322)" }}>{discountLabel(o)}</div>
          )}
          <div style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>
            {(o.items || []).map((it: any) => `${it.sku}×${it.qty}`).join(", ")}
          </div>
          <Space size={8} style={{ marginTop: 4 }}>
            <Button size="small" type={selectedOrderId === o.id ? "primary" : "default"} onClick={() => onOpenPreview(o.id)}>
              เปิดออเดอร์
            </Button>
            {o.channel !== "web" && o.channel !== "test" && (
              <Tooltip title="เปิดหน้าออเดอร์ในช่องทางต้นทาง (ยังไม่รองรับทุกช่องทาง)">
                <Button size="small" disabled>เปิด Marketplace</Button>
              </Tooltip>
            )}
          </Space>
        </List.Item>
      )}
    />
  );
}

function OrderPreviewDrawer({
  open, order, onClose,
}: { open: boolean; order: any | null; onClose: () => void }) {
  return (
    <Drawer
      title={
        <Space size={8} wrap>
          <Text strong>ดูออเดอร์แบบในแชท</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>(ไม่ออกจากหน้าแชท)</Text>
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
            <Button size="small" type="primary">เปิดหน้า Orders เต็มจอ</Button>
          </Link>
        ) : null
      }
    >
      {!order ? (
        <Empty description="เลือกออเดอร์เพื่อดูรายละเอียด" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={6} wrap>
            <Tag color={CHANNEL_COLOR[order.channel] || "default"}>{order.channel}</Tag>
            <Text strong style={{ fontSize: 18 }}>#{String(order.id).slice(0, 8)}</Text>
            <Tag color={STATUS_COLOR[order.status] || "default"}>{order.status}</Tag>
          </Space>

          <Descriptions size="small" column={1} colon={false}>
            <Descriptions.Item label="วันที่">{dateTime(order.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="ยอดสินค้า">{money(orderSubtotal(order))}</Descriptions.Item>
            {Number(order.discountAmount || 0) > 0 && (
              <Descriptions.Item label={`ส่วนลด${order.couponCode ? ` (${order.couponCode})` : ""}`}>
                <Text type="danger">-{money(order.discountAmount)}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="ยอดรวมสุทธิ">{money(order.totalAmount)}</Descriptions.Item>
            <Descriptions.Item label="การชำระเงิน">{order.paymentStatus || "—"}{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}</Descriptions.Item>
            <Descriptions.Item label="การจัดส่ง">
              {order.shipmentStatus || "—"}{order.carrier ? ` · ${order.carrier}` : ""}{order.trackingNo ? ` · ${order.trackingNo}` : ""}
            </Descriptions.Item>
          </Descriptions>

          <div>
            <Text strong style={{ fontSize: 12 }}>สินค้า</Text>
            <List
              size="small"
              dataSource={order.items || []}
              locale={{ emptyText: "ไม่มีสินค้า" }}
              renderItem={(it: any) => (
                <List.Item>
                  <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <Text style={{ fontSize: 12 }}>{it.sku}</Text>
                      <div><Text type="secondary" style={{ fontSize: 11 }}>ไซซ์ {it.size || "—"} · จำนวน {it.qty}</Text></div>
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
            message="ดูแบบเร็วจากหน้า Inbox"
            description="ถ้าต้องแก้ไขลึกหรือทำงานต่อในหน้า Orders ให้ใช้ปุ่ม เปิดหน้า Orders เต็มจอ ซึ่งจะเปิดแท็บใหม่และไม่ทำให้หลุดจากแชทนี้"
          />
        </Space>
      )}
    </Drawer>
  );
}

// ---- Section 5 — Products purchased ------------------------------
function ProductStatList({ rows }: { rows: any[] }) {
  if (!rows?.length) return <Text type="secondary" style={{ fontSize: 12 }}>ไม่มีข้อมูล</Text>;
  return (
    <List size="small" dataSource={rows} renderItem={(p: any) => (
      <List.Item>
        <Text style={{ fontSize: 12 }}>{p.name} × {p.qty} ({money(p.revenue)})</Text>
      </List.Item>
    )} />
  );
}
function ProductsSection({ products }: { products: any }) {
  if (!products) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const has = products.topPurchased?.length || products.recentlyPurchased?.length;
  if (!has) return <Empty description="ยังไม่มีสินค้าที่ซื้อ" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      <Text strong style={{ fontSize: 12 }}>ซื้อมากที่สุด</Text>
      <ProductStatList rows={products.topPurchased} />
      <Text strong style={{ fontSize: 12 }}>ซื้อล่าสุด</Text>
      <ProductStatList rows={products.recentlyPurchased} />
      <Text strong style={{ fontSize: 12 }}>ซื้อบ่อย</Text>
      <ProductStatList rows={products.frequentlyPurchased} />
      {products.favoriteCategories?.length > 0 && (
        <>
          <Text strong style={{ fontSize: 12 }}>หมวดหมู่โปรด</Text>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {products.favoriteCategories.map((cat: any) => <Tag key={cat.category}>{cat.category} ({cat.qty})</Tag>)}
          </Space>
        </>
      )}
    </div>
  );
}

// ---- Section 6 — Current shopping cart ----------------------------
// ไม่มีสถานะ DRAFT แยกในสคีมา — ใช้ order PENDING ล่าสุดที่ยังไม่มี payment แทน
function CartSection({ draftOrder }: { draftOrder: any }) {
  if (!draftOrder) return <Empty description="ไม่มีตะกร้าค้างอยู่" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const subtotal = orderSubtotal(draftOrder);
  return (
    <div>
      <List size="small" dataSource={draftOrder.items} renderItem={(it: any) => (
        <List.Item>
          <Text style={{ fontSize: 12 }}>{it.sku} ({it.size}) × {it.qty} · {money(it.unitPrice * it.qty)}</Text>
        </List.Item>
      )} />
      {Number(draftOrder.discountAmount || 0) > 0 && (
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>ยอดสินค้า {money(subtotal)}</Text>
          <Text type="danger" style={{ fontSize: 12 }}>
            ส่วนลด{draftOrder.couponCode ? ` (${draftOrder.couponCode})` : ""} -{money(draftOrder.discountAmount)}
          </Text>
        </div>
      )}
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text strong style={{ fontSize: 12 }}>รวมสุทธิ {money(draftOrder.totalAmount)}</Text>
        <Link href={`/admin/orders?highlight=${draftOrder.id}`}><Button size="small" icon={<ShoppingOutlined />}>เปิด Draft Order</Button></Link>
      </div>
    </div>
  );
}

// ---- Section 7 — Notes (internal, staff only) ---------------------
function NotesSection({ notes }: { notes: any[] }) {
  if (!notes?.length) return <Empty description="ยังไม่มีโน้ต" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
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
  if (!coupons?.length) return <Empty description="ยังไม่มีคูปองที่ผูกกับลูกค้าคนนี้" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List
      size="small"
      dataSource={coupons}
      renderItem={(coupon: any) => (
        <List.Item style={{ display: "block", padding: 10 }}>
          <Space size={6} wrap style={{ marginBottom: 4 }}>
            <Text strong>{coupon.code}</Text>
            <Tag color={couponStateColor[coupon.state] || "default"}>{couponStateLabel[coupon.state] || coupon.state}</Tag>
            {coupon.available ? <Tag color="green">พร้อมใช้</Tag> : <Tag color="default">ยังใช้ไม่ได้</Tag>}
          </Space>

          <div style={{ fontSize: 12, marginBottom: 2 }}>
            {coupon.type === "PERCENT" ? `ลด ${coupon.value}%` : `ลด ${money(coupon.value)}`}
            {coupon.minOrderAmount != null ? ` · ขั้นต่ำ ${money(coupon.minOrderAmount)}` : ""}
            {coupon.discountPreview != null ? ` · คาดว่าจะลด ${money(coupon.discountPreview)}` : ""}
          </div>

          <div style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>
            แจกเมื่อ {dateTime(coupon.assignedAt)}
            {coupon.expiresAt ? ` · หมดอายุ ${dateTime(coupon.expiresAt)}` : " · ไม่กำหนดวันหมดอายุ"}
          </div>

          {(coupon.state === "RESERVED" || coupon.state === "REDEEMED") && (coupon.reservedOrderId || coupon.redeemedOrderId) && (
            <div style={{ fontSize: 12, marginTop: 2 }}>
              <Text type="secondary">
                {coupon.state === "REDEEMED" ? "ผูกกับออเดอร์ที่ใช้จริง" : "กำลังจองกับออเดอร์"}{" "}
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
            ใช้ไปแล้ว {coupon.customerUsedCount} ครั้ง
            {coupon.remainingRedemptions != null ? ` · สิทธิ์รวมเหลือ ${coupon.remainingRedemptions}` : ""}
            {coupon.source ? ` · ที่มา ${coupon.source}` : ""}
          </div>
        </List.Item>
      )}
    />
  );
}

function AssignCouponModal({
  open, customerId, channel, customerRef, conversationId, canManage, onClose, onDone,
}: { open: boolean; customerId: string | null; channel?: string | null; customerRef?: string | null; conversationId?: string | null; canManage: boolean; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm();
  const { data, loading } = useQuery(Q_COUPONS_PICKER, {
    skip: !open || !canManage,
    fetchPolicy: "cache-and-network",
  });
  const couponOptions = (data?.bmsCoupons || [])
    .filter((coupon: any) => coupon.active)
    .map((coupon: any) => ({
      value: coupon.code,
      label: `${coupon.code} · ${coupon.type === "PERCENT" ? `${coupon.value}%` : money(coupon.value)}${coupon.expiresAt ? ` · หมดอายุ ${dateOnly(coupon.expiresAt)}` : ""}`,
    }));

  const [assignCoupon, { loading: saving }] = useMutation(M_ASSIGN_CUSTOMER_COUPON, {
    onCompleted: () => {
      message.success("แจกคูปองให้ลูกค้าแล้ว");
      form.resetFields();
      onDone();
    },
    onError: (e: any) => message.error(e?.message || "แจกคูปองไม่สำเร็จ"),
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
      title="แจกคูปองให้ลูกค้าคนนี้"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="แจกคูปอง"
      cancelText="ยกเลิก"
      confirmLoading={saving}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="คูปองจะถูกเพิ่มเข้า wallet ของลูกค้าทันที"
        description="หลังแจกแล้ว ลูกค้าคนนี้จะเห็น/ถูกเช็กสิทธิ์ผ่าน AI flow ได้ แม้ยังไม่ได้ส่งข้อความคูปองในแชท"
      />
      <Form form={form} layout="vertical">
        <Form.Item name="code" label="เลือกคูปอง" rules={[{ required: true, message: "กรุณาเลือกคูปอง" }]}>
          <Select
            showSearch
            placeholder="เลือกโค้ดส่วนลด"
            loading={loading}
            options={couponOptions}
            filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="note" label="โน้ต (ไม่บังคับ)">
          <Input placeholder="เช่น แจกชดเชย / แคมเปญเดือนนี้" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Section 8 — Timeline (lazy) -----------------------------------
function TimelineSection({ customerId }: { customerId: string }) {
  const [load, { data, loading, called }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });
  useEffect(() => { if (customerId) load({ variables: { customerId } }); }, [customerId]); // eslint-disable-line
  if (!called || loading) return <SectionLoading />;
  const entries = data?.bmsCustomerTimeline || [];
  if (!entries.length) return <Empty description="ไม่มีเหตุการณ์" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
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
  const [load, { data, loading, called }] = useLazyQuery(Q_INSIGHTS, { fetchPolicy: "cache-first" });
  useEffect(() => { if (customerId) load({ variables: { customerId } }); }, [customerId]); // eslint-disable-line
  if (!called || loading) return <SectionLoading />;
  const insights = data?.bmsCustomerInsights;
  if (!insights) return <Empty description="ยังไม่มีข้อมูลพอสรุป" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 12, marginBottom: 4 }}>{insights.summary}</Paragraph>
      <Text type="secondary" style={{ fontSize: 11 }}>
        สรุปจากข้อมูลจริงในระบบเท่านั้น · {insights.cached ? "จากแคช" : "สร้างใหม่"} · {dateTime(insights.generatedAt)}
      </Text>
    </div>
  );
}

// ---- Create Order modal (staff manually creates an order for this customer) ----
type ProductOpt = { sku: string; name: string; variants: { size: string; available: number }[] };

function CreateOrderModal({
  open, conv, selectedCouponCode, onClose, onDone,
}: { open: boolean; conv: any; selectedCouponCode?: string | null; onClose: () => void; onDone: () => void }) {
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
      if (res?.status === "CREATED") { message.success(res.message || "สร้างออร์เดอร์แล้ว"); form.resetFields(); onDone(); }
      else message.error(res?.message || "สร้างออร์เดอร์ไม่สำเร็จ");
    },
    onError: (e: any) => message.error(e?.message || "สร้างออร์เดอร์ไม่สำเร็จ"),
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
      title="สร้างออเดอร์ให้ลูกค้า" open={open} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText="สร้างออเดอร์" cancelText="ยกเลิก" width={640} destroyOnClose
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message={`ออเดอร์จะผูกกับลูกค้าคนนี้ผ่านช่องทาง ${conv?.channel || "web"} · ราคาตัดตามราคาปัจจุบันของสินค้า · จองสต็อกทันที (สถานะเริ่มต้น PENDING)`}
      />
      {selectedCouponCode && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={`พบคูปองล่าสุดในแชท: ${selectedCouponCode}`}
          description="ระบบใส่โค้ดให้ในฟอร์มแล้ว แต่ backend จะตรวจเงื่อนไขจริงอีกครั้งตอนสร้างออเดอร์"
        />
      )}
      <Form form={form} layout="vertical" initialValues={{ items: [{ qty: 1 }] }}>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item
                    {...rest} name={[name, "sku"]} rules={[{ required: true, message: "เลือกสินค้า" }]}
                  >
                    <Select
                      showSearch style={{ width: 220 }} placeholder="สินค้า" loading={prodLoading}
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
                        <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true, message: "เลือกไซซ์" }]} style={{ marginBottom: 0 }}>
                          <Select
                            style={{ width: 170 }} placeholder="ไซซ์" disabled={!prod}
                            options={(prod?.variants || []).map((v) => ({
                              value: v.size, label: `${v.size} (เหลือ ${v.available})`, disabled: v.available <= 0,
                            }))}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "qty"]} rules={[{ required: true, message: "จำนวน" }]}>
                    <InputNumber placeholder="จำนวน" min={1} style={{ width: 90 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(name)} />}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ qty: 1 })} icon={<PlusOutlined />} block>เพิ่มรายการ</Button>
            </>
          )}
        </Form.List>
        <Form.Item name="couponCode" label="โค้ดส่วนลด (ไม่บังคับ)" style={{ marginTop: 16, marginBottom: 0 }}>
          <Input placeholder="เช่น SAVE10" style={{ width: 220 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Invoice modal (ใบแจ้งหนี้จากออร์เดอร์จริง — คำนวณสด ไม่ persist) ----
function InvoiceModal({
  open, orders, onClose,
}: { open: boolean; orders: any[]; onClose: () => void }) {
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
      title="ใบแจ้งหนี้" open={open} onCancel={onClose} width={640} destroyOnClose
      footer={[
        <Button key="close" onClick={onClose}>ปิด</Button>,
        <Button key="print" type="primary" disabled={!doc} onClick={() => window.print()}>พิมพ์</Button>,
      ]}
    >
      <Select
        style={{ width: "100%", marginBottom: 16 }}
        placeholder="เลือกออร์เดอร์" value={orderId ?? undefined}
        options={(orders || []).map((o: any) => ({
          value: o.id, label: `#${String(o.id).slice(0, 8)} · ${o.channel} · ${money(o.totalAmount)}`,
        }))}
        onChange={pick}
      />
      {loading ? <SectionLoading /> : !doc ? (
        <Empty description="เลือกออร์เดอร์เพื่อออกใบแจ้งหนี้" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <Text strong style={{ fontSize: 16 }}>{doc.store.name || "—"}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>{doc.store.address || ""}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {doc.store.phone ? `โทร ${doc.store.phone}` : ""}{doc.store.taxId ? ` · เลขผู้เสียภาษี ${doc.store.taxId}` : ""}
              </Text>
            </div>
            <div style={{ textAlign: "right" }}>
              <Text strong>ใบแจ้งหนี้ #{doc.number}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>{dateOnly(doc.date)}</Text>
            </div>
          </div>
          <Descriptions size="small" column={2} colon={false} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="ลูกค้า">{doc.customerRef || "—"}</Descriptions.Item>
            <Descriptions.Item label="ช่องทาง">{doc.channel || "—"}</Descriptions.Item>
            {doc.paymentStatus && <Descriptions.Item label="สถานะออร์เดอร์">{doc.paymentStatus}</Descriptions.Item>}
          </Descriptions>
          <Table
            size="small" pagination={false} rowKey={(r: any) => `${r.sku}-${r.size}`}
            dataSource={doc.lines}
            columns={[
              { title: "สินค้า", dataIndex: "name" },
              { title: "ไซซ์", dataIndex: "size", width: 60 },
              { title: "จำนวน", dataIndex: "qty", width: 70, align: "right" as const },
              { title: "ราคา/หน่วย", dataIndex: "unitPrice", width: 100, align: "right" as const, render: money },
              { title: "รวม", dataIndex: "amount", width: 100, align: "right" as const, render: money },
            ]}
          />
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <div><Text type="secondary">ยอดสินค้า: </Text><Text>{money(doc.subtotal)}</Text></div>
            {doc.discount > 0 && (
              <div><Text type="secondary">ส่วนลด{doc.couponCode ? ` (${doc.couponCode})` : ""}: </Text><Text type="danger">-{money(doc.discount)}</Text></div>
            )}
            {doc.shippingFee != null && <div><Text type="secondary">ค่าส่ง: </Text><Text>{money(doc.shippingFee)}</Text></div>}
            <div><Text strong style={{ fontSize: 15 }}>รวมทั้งหมด: {money(doc.total)}</Text></div>
          </div>
          <Divider style={{ margin: "12px 0" }} />
          <Text type="secondary" style={{ fontSize: 11 }}>{doc.note}</Text>
        </div>
      )}
    </Modal>
  );
}

// ---- Section 10 — Quick Actions ------------------------------------
function QuickActionsSection({ can, conv, orders, onCreateOrder, onInvoice }: { can: (p: string) => boolean; conv: any; orders: any[]; onCreateOrder: () => void; onInvoice: () => void }) {
  const hasRefundable = orders?.some((o) => o.paymentStatus === "CONFIRMED");
  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {can("order.create") ? (
        <Button block onClick={onCreateOrder}>สร้างออเดอร์</Button>
      ) : (
        <Tooltip title="ไม่มีสิทธิ์ order.create"><Button block disabled>สร้างออเดอร์</Button></Tooltip>
      )}
      <Link href="/admin/products"><Button block>ตรวจสอบสต็อก</Button></Link>
      {can("payment.refund") ? (
        <Link href="/admin/payment"><Button block disabled={!hasRefundable}>คืนเงิน</Button></Link>
      ) : (
        <Tooltip title="ไม่มีสิทธิ์ payment.refund"><Button block disabled>คืนเงิน</Button></Tooltip>
      )}
      {can("order.view") ? (
        <Button block disabled={!orders?.length} onClick={onInvoice}>ออกใบแจ้งหนี้</Button>
      ) : (
        <Tooltip title="ไม่มีสิทธิ์ order.view"><Button block disabled>ออกใบแจ้งหนี้</Button></Tooltip>
      )}
      <Link href="/admin/customers"><Button block>เปิดหน้าลูกค้า</Button></Link>
    </Space>
  );
}

// ---- Main panel ------------------------------------------------
export default function Customer360Panel({ conv, can, selectedCouponCode }: { conv: any; can: (p: string) => boolean; selectedCouponCode?: string | null }) {
  const customerId: string | null = conv?.customerId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(window.localStorage.getItem(PANEL_COLLAPSE_KEY) === "1"); }, []);
  const toggle = () => setCollapsed((v) => { const n = !v; window.localStorage.setItem(PANEL_COLLAPSE_KEY, n ? "1" : "0"); return n; });

  const { data, loading, error, refetch } = useQuery(Q_CUSTOMER_360, {
    variables: { customerId, channel: conv?.channel ?? null, customerRef: conv?.customerRef ?? null, conversationId: conv?.id ?? null },
    skip: !conv?.id,
    fetchPolicy: "cache-and-network",
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
        <Tooltip title="ขยายข้อมูลลูกค้า" placement="left">
          <Button type="text" size="small" icon={<MenuUnfoldOutlined />} onClick={toggle} />
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={panelStyles.panel} style={{
      width: 292, maxWidth: "30vw", flexShrink: 0, minHeight: 0, minWidth: 260, overflowY: "auto", overflowX: "hidden",
      border: "1px solid var(--app-border, #eee)", borderRadius: 10, padding: 8,
      position: "sticky", top: 0, height: "100%",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <Text strong style={{ fontSize: 12 }}>ข้อมูลลูกค้า (Customer 360)</Text>
        <Space size={4}>
          {conv?.id && can("coupon.manage") && (
            <Button size="small" onClick={() => setAssignCouponOpen(true)}>แจกคูปอง</Button>
          )}
          <Tooltip title="ย่อแผงข้อมูลลูกค้า">
            <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={toggle} />
          </Tooltip>
        </Space>
      </div>

      {!conv?.id ? (
        <Empty description="ไม่พบบทสนทนานี้" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : loading && !c360 ? (
        <SectionLoading />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="โหลดข้อมูลลูกค้าไม่สำเร็จ"
          description="กรุณาลองโหลดข้อมูลใหม่ หากยังไม่สำเร็จระบบจะแสดง error จริงแทนการแสดงว่าไม่มีข้อมูล"
          action={<Button size="small" onClick={() => refetch()}>ลองใหม่</Button>}
        />
      ) : (
        <Collapse
          size="small"
          defaultActiveKey={["summary", "cart", "orders", "actions"]}
          items={[
            { key: "summary", label: "สรุปลูกค้า", children: <SummarySection c={c360?.customer} conv={conv} /> },
            { key: "coupons", label: `คูปองของลูกค้า${c360?.coupons?.length ? ` (${c360.coupons.length})` : ""}`, children: <CouponWalletSection coupons={c360?.coupons || []} /> },
            { key: "cart", label: "ตะกร้าปัจจุบัน", children: <CartSection draftOrder={c360?.draftOrder} /> },
            {
              key: "orders",
              label: "ออเดอร์ล่าสุด (ทุกช่องทาง)",
              children: <RecentOrdersSection orders={recentOrders} selectedOrderId={previewOrderId} onOpenPreview={setPreviewOrderId} />,
            },
            { key: "actions", label: "Quick Actions", children: <QuickActionsSection can={can} conv={conv} orders={recentOrders} onCreateOrder={() => setCreateOrderOpen(true)} onInvoice={() => setInvoiceOpen(true)} /> },
            { key: "contact", label: "ข้อมูลติดต่อ", children: <ContactSection c={c360?.customer} identities={c360?.identities || []} addresses={c360?.addresses || []} /> },
            { key: "stats", label: "สถิติลูกค้า", children: <StatsSection s={c360?.stats} /> },
            { key: "products", label: "สินค้าที่ซื้อ", children: <ProductsSection products={c360?.products} /> },
            { key: "notes", label: "โน้ตภายใน (เฉพาะ staff)", children: <NotesSection notes={c360?.notes || []} /> },
            { key: "timeline", label: "Timeline", children: resolvedCustomerId ? <TimelineSection customerId={resolvedCustomerId} /> : null },
            { key: "insights", label: "AI Insights", children: resolvedCustomerId ? <InsightsSection customerId={resolvedCustomerId} /> : null },
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
