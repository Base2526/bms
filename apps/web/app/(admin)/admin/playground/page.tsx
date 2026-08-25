'use client';
import { gql, useQuery } from "@apollo/client";
import {
  Card, Input, Button, Space, Tag, Select, Segmented, Typography, Divider, Empty, Alert, message,
} from "antd";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { SendOutlined, ReloadOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];

// สต็อกสด (ไว้ดูเปลี่ยนแปลงหลังสั่ง)
const Q_PRODUCTS = gql`
  query { bmsProducts { sku name variants { size available reserved_stock } } }
`;

type Bubble = {
  from: "customer" | "bot";
  text: string;
  trace?: any;
};

const EXAMPLES = [
  "Nike XL มีไหม",
  "Nike มีไซซ์อะไรบ้าง",
  "สั่ง Nike XL 2 ชิ้น",
  "สั่ง Nike XL 1 ชิ้น กับ Adidas M 1 ชิ้น",
  "สั่ง Nike XL 999 ชิ้น",
];

const INTENT_COLOR: Record<string, string> = {
  CHECK_STOCK: "blue",
  CONFIRM_ORDER: "green",
  GREETING: "purple",
  UNKNOWN: "default",
};

export default function Page() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { can } = useBmsPermissions();
  const [channel, setChannel] = useState("line");
  const [customerRef, setCustomerRef] = useState("Ucustomer_001");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const { data: stockData, refetch: refetchStock } = useQuery(Q_PRODUCTS, {
    fetchPolicy: "cache-and-network",
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  const send = async (msg?: string) => {
    const message_ = (msg ?? text).trim();
    if (!message_) return;
    setSending(true);
    setChat((c) => [...c, { from: "customer", text: message_ }]);
    setText("");
    try {
      const res = await fetch("/api/bms/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message_, channel, customerRef }),
      });
      const data = await res.json();
      setChat((c) => [...c, { from: "bot", text: data.reply || t("admin_playground.no_reply"), trace: data }]);
      if (data?.order?.status === "CREATED") {
        setLastOrderId(data.order.orderId);
        message.success(t("admin_playground.order_created", { id: data.order.orderId.slice(0, 8) }));
      }
      refetchStock();
    } catch (e: any) {
      message.error(e?.message || t("admin_playground.send_error"));
    } finally {
      setSending(false);
    }
  };

  const products = stockData?.bmsProducts || [];

  // เดิมหน้านี้ไม่มี permission gate เลย (Sales/Warehouse เข้าตรง URL แล้วยิง AI chat จริงได้
  // โดยไม่มีใครเห็น) — ใช้ ai_quality.view (Manager/Administrator) เพราะเป็นคนกลุ่มเดียวกันที่
  // ควรมีสิทธิ์เข้าไปจิ้ม AI pipeline โดยตรงและรับผิดชอบโควตาที่ใช้ไป
  if (!can("ai_quality.view")) {
    return <Alert closable type="error" message={t("admin_playground.no_permission")} showIcon />;
  }

  return (
    <div>
      <AdminPageHeader title={t("admin_playground.title")}>
        <Link href="/admin/orders"><Button icon={<ShoppingCartOutlined />}>{t("admin_playground.go_to_orders")}</Button></Link>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_playground.intro")}
      />

      {/* minWidth ต้องเป็น 0 บนมือถือ — 360px + padding ของ Content ทำให้ล้นจอ 360px */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ---- Chat simulator ---- */}
        <Card title={t("admin_playground.chat_simulator_title")} style={{ flex: "1 1 480px", minWidth: isMobile ? 0 : 360, width: isMobile ? "100%" : undefined }}
          extra={
            // Segmented 8 ช่องทางกว้างเกินหัวการ์ดบนมือถือ → ใช้ Select แทน
            isMobile ? (
              <Select
                size="small" value={channel} onChange={setChannel} style={{ width: 120 }}
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            ) : (
              <Segmented size="small" value={channel} onChange={(v) => setChannel(v as string)} options={CHANNELS} />
            )
          }
        >
          <Space style={{ marginBottom: 8 }} wrap>
            <Text type="secondary">{t("admin_playground.customer_ref_label")}</Text>
            <Input size="small" value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} style={{ width: 180 }} />
          </Space>

          <div
            ref={logRef}
            style={{ height: isMobile ? 300 : 340, overflowY: "auto", background: "var(--app-surface, #0000000a)", borderRadius: 8, padding: 12, marginBottom: 12 }}
          >
            {chat.length === 0 && <Empty description={t("admin_playground.empty_chat")} />}
            {chat.map((b, i) => (
              <div key={i} style={{ display: "flex", justifyContent: b.from === "customer" ? "flex-end" : "flex-start", marginBottom: 8 }}>
                <div style={{ maxWidth: "80%" }}>
                  <div style={{
                    background: b.from === "customer" ? "#1677ff" : "#f0f0f0",
                    color: b.from === "customer" ? "#fff" : "#000",
                    padding: "8px 12px", borderRadius: 12, whiteSpace: "pre-wrap",
                  }}>
                    {b.text}
                  </div>
                  {b.trace && <TraceLine trace={b.trace} />}
                </div>
              </div>
            ))}
          </div>

          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder={t("admin_playground.input_placeholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPressEnter={() => send()}
              disabled={sending}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()}>{t("admin_playground.send")}</Button>
          </Space.Compact>

          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_playground.examples_label")}</Text>
            <div style={{ marginTop: 6 }}>
              <Space wrap>
                {EXAMPLES.map((ex) => (
                  <Tag key={ex} color="blue" style={{ cursor: "pointer" }} onClick={() => send(ex)}>{ex}</Tag>
                ))}
              </Space>
            </div>
          </div>

          {lastOrderId && (
            <Alert closable
              style={{ marginTop: 12 }} type="success" showIcon
              message={<>{t("admin_playground.last_order_prefix")} <Text code>{lastOrderId.slice(0, 8)}</Text> — <Link href="/admin/orders">{t("admin_playground.manage_at_orders")}</Link></>}
            />
          )}
        </Card>

        {/* ---- Live stock ---- */}
        <Card title={t("admin_playground.live_stock_title")} style={{ flex: "1 1 320px", minWidth: isMobile ? 0 : 280, width: isMobile ? "100%" : undefined }}
          extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => refetchStock()}>{t("admin_playground.refresh")}</Button>}
        >
          {products.length === 0 && <Empty />}
          {products.map((p: any) => (
            <div key={p.sku} style={{ marginBottom: 12 }}>
              <Text strong>{p.name}</Text> <Text type="secondary" code>{p.sku}</Text>
              <div style={{ marginTop: 6 }}>
                <Space wrap size={4}>
                  {p.variants.map((v: any) => (
                    <Tag key={v.size} color={v.available > 0 ? "green" : "default"}>
                      {v.size}: {v.available}{v.reserved_stock > 0 ? t("admin_playground.reserved_suffix", { count: v.reserved_stock }) : ""}
                    </Tag>
                  ))}
                </Space>
              </div>
              <Divider style={{ margin: "10px 0" }} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// แสดง trace ย่อใต้บับเบิลบอท
function TraceLine({ trace }: { trace: any }) {
  const intent = trace?.understanding?.intent;
  const order = trace?.order;
  const data = trace?.data;
  return (
    <div style={{ marginTop: 4, fontSize: 12 }}>
      <Space wrap size={4}>
        {intent && <Tag color={INTENT_COLOR[intent] || "default"}>{intent}</Tag>}
        {trace?.tool && trace.tool !== "none" && <Tag>tool: {trace.tool}</Tag>}
        {data?.status && data.status !== "NOT_FOUND" && <Tag color="cyan">stock: {data.status}</Tag>}
        {order?.status && (
          <Tag color={order.status === "CREATED" ? "green" : "red"}>
            order: {order.status}{order.total ? ` · ${order.total.toLocaleString()}฿` : ""}
          </Tag>
        )}
      </Space>
    </div>
  );
}
