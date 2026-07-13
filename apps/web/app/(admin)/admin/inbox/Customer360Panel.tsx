'use client';
// =============================================================
// Customer 360 Panel — right-hand column ของหน้า Inbox
// -------------------------------------------------------------
// โหลดอัตโนมัติตอนเลือกแชท (Section 1–7, เบา) ส่วน Timeline/AI Insights
// (Section 8–9, หนักกว่า) โหลดแบบ lazy ตอนกาง panel เท่านั้น
// backend: lib/bms/customer360.ts · graphql/bmsCustomer360.ts
// =============================================================
import { gql, useQuery, useLazyQuery } from "@apollo/client";
import {
  Collapse, Skeleton, Empty, Tag, Typography, Avatar, Space, Table,
  Descriptions, Button, Tooltip, List, Divider,
} from "antd";
import { useEffect, useState } from "react";
import {
  UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ShoppingOutlined,
} from "@ant-design/icons";
import Link from "next/link";

const { Text, Paragraph } = Typography;

// ---- GraphQL --------------------------------------------------
const Q_CUSTOMER_360 = gql`
  query ($customerId: ID!) {
    bmsCustomer360(customerId: $customerId) {
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
        id channel status createdAt totalAmount paymentStatus paymentMethod
        shipmentStatus carrier trackingNo items { sku size qty unitPrice }
      }
      products {
        topPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        recentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        frequentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
        favoriteCategories { category qty }
      }
      draftOrder { id channel createdAt totalAmount items { sku size qty unitPrice } }
      notes { id conversationId author body createdAt }
    }
  }
`;
const Q_TIMELINE = gql`
  query ($customerId: ID!) { bmsCustomerTimeline(customerId: $customerId) { type at text ref } }
`;
const Q_INSIGHTS = gql`
  query ($customerId: ID!) { bmsCustomerInsights(customerId: $customerId) { summary generatedAt cached } }
`;

const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", lazada: "gold", test: "default",
};
const PANEL_COLLAPSE_KEY = "bms_inbox_customer360_collapsed";
const money = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;
const dateOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

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
function RecentOrdersSection({ orders }: { orders: any[] }) {
  if (!orders?.length) return <Empty description="ยังไม่มีออเดอร์" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <List
      size="small" dataSource={orders}
      renderItem={(o: any) => (
        <List.Item style={{ display: "block" }}>
          <Space size={4} wrap style={{ marginBottom: 2 }}>
            <Tag color={CHANNEL_COLOR[o.channel] || "default"}>{o.channel}</Tag>
            <Text strong style={{ fontSize: 12 }}>#{String(o.id).slice(0, 8)}</Text>
            <Tag>{o.status}</Tag>
            {o.paymentStatus && <Tag color="blue">ชำระ: {o.paymentStatus}</Tag>}
            {o.shipmentStatus && <Tag color="purple">จัดส่ง: {o.shipmentStatus}</Tag>}
          </Space>
          <div style={{ fontSize: 12 }}>
            {dateOnly(o.createdAt)} · {money(o.totalAmount)}
            {o.trackingNo && <> · เลขพัสดุ {o.trackingNo}</>}
          </div>
          <div style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>
            {(o.items || []).map((it: any) => `${it.sku}×${it.qty}`).join(", ")}
          </div>
          <Space size={8} style={{ marginTop: 4 }}>
            <Link href={`/admin/orders?highlight=${o.id}`}><Button size="small">เปิดออเดอร์</Button></Link>
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
  return (
    <div>
      <List size="small" dataSource={draftOrder.items} renderItem={(it: any) => (
        <List.Item>
          <Text style={{ fontSize: 12 }}>{it.sku} ({it.size}) × {it.qty} · {money(it.unitPrice * it.qty)}</Text>
        </List.Item>
      )} />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text strong style={{ fontSize: 12 }}>รวม {money(draftOrder.totalAmount)}</Text>
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

// ---- Section 10 — Quick Actions ------------------------------------
function QuickActionsSection({ can, conv, orders }: { can: (p: string) => boolean; conv: any; orders: any[] }) {
  const hasRefundable = orders?.some((o) => o.paymentStatus === "CONFIRMED");
  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      <Tooltip title="ยังไม่มีระบบสร้างออเดอร์จากหน้าแอดมิน (สร้างผ่านแชทลูกค้าเท่านั้นตอนนี้)">
        <Button block disabled>สร้างออเดอร์</Button>
      </Tooltip>
      <Link href="/admin/products"><Button block>ตรวจสอบสต็อก</Button></Link>
      {can("payment.refund") ? (
        <Link href="/admin/payment"><Button block disabled={!hasRefundable}>คืนเงิน</Button></Link>
      ) : (
        <Tooltip title="ไม่มีสิทธิ์ payment.refund"><Button block disabled>คืนเงิน</Button></Tooltip>
      )}
      <Tooltip title="ยังไม่รองรับ (roadmap)"><Button block disabled>ออกใบแจ้งหนี้</Button></Tooltip>
      <Tooltip title="ยังไม่รองรับ (roadmap)"><Button block disabled>ส่งลิงก์ชำระเงิน</Button></Tooltip>
      <Link href="/admin/customers"><Button block>เปิดหน้าลูกค้า</Button></Link>
      <Tooltip title="เลือก staff หลักได้ที่หัวแชทด้านบน">
        <Button block disabled>มอบหมาย staff</Button>
      </Tooltip>
      <Tooltip title="ยังไม่มีระบบ Support Ticket (roadmap)"><Button block disabled>สร้าง Ticket</Button></Tooltip>
    </Space>
  );
}

// ---- Main panel ------------------------------------------------
export default function Customer360Panel({ conv, can }: { conv: any; can: (p: string) => boolean }) {
  const customerId: string | null = conv?.customerId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(window.localStorage.getItem(PANEL_COLLAPSE_KEY) === "1"); }, []);
  const toggle = () => setCollapsed((v) => { const n = !v; window.localStorage.setItem(PANEL_COLLAPSE_KEY, n ? "1" : "0"); return n; });

  const { data, loading } = useQuery(Q_CUSTOMER_360, {
    variables: { customerId },
    skip: !customerId,
    fetchPolicy: "cache-and-network",
  });
  const c360 = data?.bmsCustomer360;

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
    <div style={{
      width: 340, flexShrink: 0, minHeight: 0, overflowY: "auto",
      border: "1px solid var(--app-border, #eee)", borderRadius: 8, padding: 10,
      position: "sticky", top: 0, height: "100%",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text strong style={{ fontSize: 13 }}>ข้อมูลลูกค้า (Customer 360)</Text>
        <Tooltip title="ย่อแผงข้อมูลลูกค้า">
          <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={toggle} />
        </Tooltip>
      </div>

      {!customerId ? (
        <Empty description="แชทนี้ยังไม่ผูกกับลูกค้าในระบบ CRM" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : loading && !c360 ? (
        <SectionLoading />
      ) : (
        <Collapse
          size="small"
          defaultActiveKey={["summary", "contact", "stats", "orders"]}
          items={[
            { key: "summary", label: "สรุปลูกค้า", children: <SummarySection c={c360?.customer} conv={conv} /> },
            { key: "contact", label: "ข้อมูลติดต่อ", children: <ContactSection c={c360?.customer} identities={c360?.identities || []} addresses={c360?.addresses || []} /> },
            { key: "stats", label: "สถิติลูกค้า", children: <StatsSection s={c360?.stats} /> },
            { key: "orders", label: "ออเดอร์ล่าสุด (ทุกช่องทาง)", children: <RecentOrdersSection orders={c360?.recentOrders || []} /> },
            { key: "products", label: "สินค้าที่ซื้อ", children: <ProductsSection products={c360?.products} /> },
            { key: "cart", label: "ตะกร้าปัจจุบัน", children: <CartSection draftOrder={c360?.draftOrder} /> },
            { key: "notes", label: "โน้ตภายใน (เฉพาะ staff)", children: <NotesSection notes={c360?.notes || []} /> },
            { key: "timeline", label: "Timeline", children: customerId ? <TimelineSection customerId={customerId} /> : null },
            { key: "insights", label: "AI Insights", children: customerId ? <InsightsSection customerId={customerId} /> : null },
            { key: "actions", label: "Quick Actions", children: <QuickActionsSection can={can} conv={conv} orders={c360?.recentOrders || []} /> },
          ]}
        />
      )}
    </div>
  );
}
