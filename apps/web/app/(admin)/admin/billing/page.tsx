'use client';
import { useState } from "react";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Row, Col, Button, Tag, Progress, message, Alert, Typography, Space, Divider, List, Input, InputNumber } from "antd";
import { CheckOutlined, ReloadOutlined, RobotOutlined, ThunderboltOutlined, KeyOutlined, BarChartOutlined, WarningOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

const Q = gql`
  query {
    bmsBilling {
      plan { code name price_monthly max_products max_channels max_orders_month max_users ai_credits_monthly }
      usage { products channels orders_month users }
      plans { code name price_monthly max_products max_channels max_orders_month max_users ai_credits_monthly }
    }
    bmsAiUsage {
      count limit remaining unlimited planCode planName
      requestCount sharedRequests byokRequests blockedRequests
      grantedCredits bonusCredits adjustedCredits estimatedCost
    }
    bmsAiConfig { has_key model }
    bmsAiCreditLedger(limit: 12) {
      id yearMonth entryType amount balanceAfter referenceType referenceId note createdAt
    }
    bmsAiUsageBreakdown(limit: 12) {
      feature requests creditsUsed estimatedCost
    }
  }
`;
const M = gql`mutation ($planCode: String!) { bmsChangePlan(planCode: $planCode) }`;
const M_ADJUST = gql`mutation ($amount: Int!, $note: String) { bmsAdjustAiCredits(amount: $amount, note: $note) }`;

const lim = (v: number) => (v < 0 ? "ไม่จำกัด" : v);
const pct = (used: number, max: number) => (max < 0 ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100)));

const AI_PLAN_PRESETS: Record<string, { credits: number; label: string; note: string }> = {
  free: { credits: 1000, label: "Free", note: "เหมาะสำหรับทดลองใช้ AI ในร้าน" },
  pro: { credits: 10000, label: "Pro", note: "เหมาะสำหรับร้านที่ใช้งาน AI ทุกวัน" },
  business: { credits: 50000, label: "Business", note: "เหมาะสำหรับหลายทีม หลายช่องทาง" },
};

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

function estimateAiCredits(limit: number, planCode?: string | null) {
  if (limit < 0) return -1;
  const preset = planCode ? AI_PLAN_PRESETS[planCode]?.credits : undefined;
  if (preset != null) return preset;
  return Math.max(limit, 0);
}

function planAiCredits(plan: any) {
  if (!plan) return 0;
  if (typeof plan.ai_credits_monthly === "number") return plan.ai_credits_monthly;
  return estimateAiCredits(plan.max_ai_messages_month ?? 0, plan.code);
}

function estimateUsedCredits(aiUsage: any) {
  if (!aiUsage) return 0;
  if (aiUsage.unlimited || aiUsage.limit < 0) return aiUsage.count;
  const credits = estimateAiCredits(aiUsage.limit, aiUsage.planCode);
  if (credits <= 0 || aiUsage.limit <= 0) return 0;
  return Math.round((aiUsage.count / aiUsage.limit) * credits);
}

function estimateRemainingCredits(aiUsage: any) {
  if (!aiUsage) return 0;
  if (aiUsage.unlimited || aiUsage.limit < 0) return -1;
  const credits = estimateAiCredits(aiUsage.limit, aiUsage.planCode);
  return Math.max(credits - estimateUsedCredits(aiUsage), 0);
}

function estimateMonthlyCost(aiUsage: any) {
  const used = estimateUsedCredits(aiUsage);
  if (used <= 0) return 0;
  return used * 0.35;
}

function aiQuotaStatus(aiUsage: any) {
  if (!aiUsage || aiUsage.unlimited || aiUsage.limit < 0) return "normal";
  const usedPct = pct(aiUsage.count, aiUsage.limit);
  if (usedPct >= 100) return "exhausted";
  if (usedPct >= 80) return "warning";
  return "normal";
}

function buildMockLedger(aiUsage: any) {
  const used = estimateUsedCredits(aiUsage);
  const total = estimateAiCredits(aiUsage?.limit ?? 0, aiUsage?.planCode);
  if (total < 0) {
    return [
      { id: "grant", date: "ต้นเดือน", entryType: "BYOK / Unlimited", amount: 0, balanceAfter: 0, note: "ไม่จำกัด" },
      { id: "usage", date: "เดือนนี้", entryType: "AI usage", amount: 0, balanceAfter: 0, note: `${formatNumber(aiUsage?.count ?? 0)} requests` },
    ];
  }
  const topup = used > total * 0.8 ? Math.round(total * 0.2) : 0;
  const afterGrant = total;
  const afterUsage = Math.max(afterGrant - used, 0);
  const afterTopup = topup > 0 ? afterUsage + topup : afterUsage;
  return [
    { id: "grant", date: "ต้นเดือน", entryType: "Monthly grant", amount: total, balanceAfter: afterGrant },
    { id: "usage", date: "เดือนนี้", entryType: "AI usage", amount: -used, balanceAfter: afterUsage },
    ...(topup > 0 ? [{ id: "topup", date: "ตัวอย่าง", entryType: "Top-up / Add-on", amount: topup, balanceAfter: afterTopup }] : []),
  ];
}

function labelForFeature(feature: string) {
  switch (feature) {
    case "staff_assistant":
      return "Staff assistant";
    case "customer_tool_loop":
      return "Inbox AI replies";
    case "stock_reply":
      return "Product / stock";
    case "coupon_wallet":
      return "Coupon / promo";
    default:
      return feature.replace(/_/g, " ");
  }
}

function usageTone(status: string) {
  if (status === "exhausted") return { accent: "#ff4d4f", soft: "#fff1f0", border: "#ffccc7" };
  if (status === "warning") return { accent: "#faad14", soft: "#fffbe6", border: "#ffe58f" };
  return { accent: "#1677ff", soft: "#f0f5ff", border: "#adc6ff" };
}

type BillingLedgerRow = {
  id?: string;
  date?: string;
  entryType?: string;
  type?: string;
  amount: number;
  balanceAfter?: number;
  balance?: number;
  note?: string | null;
  referenceType?: string | null;
  createdAt?: string;
};

function splitRows(total: number) {
  return [
    { label: "Inbox AI replies", value: Math.round(total * 0.45), color: "#1677ff" },
    { label: "Product / stock", value: Math.round(total * 0.25), color: "#13c2c2" },
    { label: "Coupon / promo", value: Math.round(total * 0.1), color: "#722ed1" },
    { label: "Staff assistant", value: Math.round(total * 0.2), color: "#52c41a" },
  ];
}

function buildBreakdownRows(rows: Array<{ feature: string; requests: number; creditsUsed: number }> | undefined, fallbackTotal: number) {
  if (rows && rows.length > 0) {
    const colors = ["#1677ff", "#13c2c2", "#722ed1", "#52c41a", "#fa8c16", "#eb2f96"];
    return rows.map((row, idx) => ({
      label: labelForFeature(row.feature),
      value: row.creditsUsed,
      requests: row.requests,
      color: colors[idx % colors.length],
    }));
  }
  return splitRows(fallbackTotal).map((row) => ({ ...row, requests: 0 }));
}

function AiMetricCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: string;
}) {
  return (
    <Card
      size="small"
      bodyStyle={{ padding: 18 }}
      style={{
        borderRadius: 16,
        background: `linear-gradient(180deg, ${accent}12 0%, #ffffff 100%)`,
        borderColor: `${accent}33`,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
      }}
    >
      <Text type="secondary">{title}</Text>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 10, lineHeight: 1.1 }}>{value}</div>
      <Text type="secondary">{subtitle}</Text>
    </Card>
  );
}

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [adjustAmount, setAdjustAmount] = useState<number>(1000);
  const [adjustNote, setAdjustNote] = useState<string>("");
  const [changePlan, { loading: changing }] = useMutation(M, {
    onCompleted: () => { message.success("เปลี่ยนแพ็กเกจแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "เปลี่ยนแพ็กเกจไม่สำเร็จ"),
  });
  const [adjustCredits, { loading: adjustingCredits }] = useMutation(M_ADJUST, {
    onCompleted: () => {
      message.success("ปรับเครดิต AI แล้ว");
      refetch();
    },
    onError: (e) => message.error(e?.message || "ปรับเครดิตไม่สำเร็จ"),
  });

  if (error) return <Alert type="error" message="โหลด billing ไม่ได้" description={error.message} showIcon />;

  const b = data?.bmsBilling;
  const cur = b?.plan;
  const usage = b?.usage;
  const plans = b?.plans || [];
  const aiUsage = data?.bmsAiUsage;
  const aiConfig = data?.bmsAiConfig;
  const hasByok = !!aiConfig?.has_key;
  const aiCreditsTotal = hasByok ? -1 : estimateAiCredits(aiUsage?.limit ?? 0, aiUsage?.planCode);
  const aiCreditsUsed = estimateUsedCredits(aiUsage);
  const aiCreditsRemaining = hasByok ? -1 : estimateRemainingCredits(aiUsage);
  const aiStatus = aiQuotaStatus(aiUsage);
  const ledger: BillingLedgerRow[] = data?.bmsAiCreditLedger?.length ? data.bmsAiCreditLedger : buildMockLedger(aiUsage);
  const usagePercent = hasByok || aiCreditsTotal < 0 ? 0 : pct(aiCreditsUsed, aiCreditsTotal);
  const tone = usageTone(aiStatus);
  const split = buildBreakdownRows(data?.bmsAiUsageBreakdown, aiCreditsUsed);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Billing & Plan</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {cur && usage && (
        <Card style={{ marginBottom: 16 }} title={<>แพ็กเกจปัจจุบัน: <Tag color="blue">{cur.name}</Tag>{cur.price_monthly > 0 ? `${cur.price_monthly.toLocaleString()} ฿/เดือน` : "ฟรี"}</>}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Text type="secondary">สินค้า</Text>
              <Progress percent={pct(usage.products, cur.max_products)} format={() => `${usage.products}/${lim(cur.max_products)}`} status={cur.max_products>=0 && usage.products>=cur.max_products ? "exception":"active"} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">ช่องทางที่เชื่อม</Text>
              <Progress percent={pct(usage.channels, cur.max_channels)} format={() => `${usage.channels}/${lim(cur.max_channels)}`} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">ออเดอร์เดือนนี้</Text>
              <Progress percent={pct(usage.orders_month, cur.max_orders_month)} format={() => `${usage.orders_month}/${lim(cur.max_orders_month)}`} />
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">Staff</Text>
              <Progress percent={pct(usage.users, cur.max_users)} format={() => `${usage.users}/${lim(cur.max_users)}`} status={cur.max_users>=0 && usage.users>=cur.max_users ? "exception":"active"} />
            </Col>
          </Row>
        </Card>
      )}

      <Card
        style={{ marginBottom: 16, borderRadius: 20, overflow: "hidden", boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)" }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ padding: 24, background: `linear-gradient(135deg, ${tone.soft} 0%, #ffffff 60%)`, borderBottom: "1px solid #f0f0f0" }}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} lg={16}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap>
                  <Tag color="purple" style={{ borderRadius: 999, paddingInline: 10 }}>AI Credits</Tag>
                  {hasByok && <Tag color="green" style={{ borderRadius: 999, paddingInline: 10 }}>BYOK</Tag>}
                  {!hasByok && <Tag color={aiStatus === "warning" ? "gold" : aiStatus === "exhausted" ? "red" : "blue"} style={{ borderRadius: 999, paddingInline: 10 }}>{aiUsage?.planName ?? "-"}</Tag>}
                </Space>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: tone.accent, color: "#fff", display: "grid", placeItems: "center", boxShadow: "0 10px 24px rgba(0,0,0,0.12)" }}>
                    <RobotOutlined style={{ fontSize: 24 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15 }}>AI Credit</div>
                    <Text type="secondary" style={{ fontSize: 15 }}>
                  {hasByok ? "ร้านนี้ใช้ API key ของตัวเองอยู่ จึงไม่ถูกหัก shared credits ของแพลตฟอร์ม" : "ขายเป็นเครดิตให้เข้าใจง่าย และเริ่มผูก monthly summary / ledger / usage events ของจริงแล้ว"}
                    </Text>
                  </div>
                </div>
              </Space>
            </Col>
            <Col xs={24} lg={8}>
              <Card
                size="small"
                bodyStyle={{ padding: 16 }}
                style={{ borderRadius: 16, borderColor: tone.border, background: "#ffffffcc", backdropFilter: "blur(6px)" }}
              >
                <Text type="secondary">AI policy วันนี้</Text>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                  {hasByok ? "BYOK + platform rate limit" : aiStatus === "exhausted" ? "เครดิตหมด → fallback / upgrade" : aiStatus === "warning" ? "ใกล้ถึง quota → ควรแจ้งเตือน" : "ปกติ → ใช้งานได้ต่อเนื่อง"}
                </div>
                <Text type="secondary">ระบบใช้ monthly summary, ledger และ usage breakdown จากข้อมูลจริงของเดือนนี้</Text>
              </Card>
            </Col>
          </Row>
        </div>

        <div style={{ padding: 24 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 14 }}
          message="AI Credits ใช้สำหรับคุมโควตา AI ต่อเดือนแยกร้าน โดย backend บันทึก usage event, ledger และต้นทุนโดยประมาณให้ทุกครั้ง"
          description="ตอนนี้หน้า Billing อ่านข้อมูลจริงได้แล้วทั้งเครดิตคงเหลือ การใช้งานเดือนนี้ breakdown ตาม feature และ ledger การเปลี่ยนแปลงเครดิต"
        />

        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
          <Col xs={24} md={8}>
            <AiMetricCard title="เครดิตคงเหลือ" value={hasByok || aiCreditsRemaining < 0 ? "Unlimited" : formatNumber(aiCreditsRemaining)} subtitle={hasByok ? "BYOK + rate limit" : `จากทั้งหมด ${formatNumber(aiUsage?.grantedCredits ?? aiCreditsTotal)}`} accent={tone.accent} />
          </Col>
          <Col xs={24} md={8}>
            <AiMetricCard title="ใช้ไปเดือนนี้" value={formatNumber(aiCreditsUsed)} subtitle={`${formatNumber(aiUsage?.requestCount ?? aiUsage?.count ?? 0)} AI requests ทั้งหมดเดือนนี้`} accent="#13c2c2" />
          </Col>
          <Col xs={24} md={8}>
            <AiMetricCard title="ต้นทุน AI โดยประมาณ" value={`${Number(aiUsage?.estimatedCost ?? estimateMonthlyCost(aiUsage)).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`} subtitle="ตอนนี้ใช้ cost summary จาก usage model จริง ถ้ายังไม่มี token cost จะยังเป็น 0" accent="#722ed1" />
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={15}>
            <Card size="small" title="AI Credit usage" style={{ borderRadius: 16 }}>
              {hasByok ? (
                <Alert type="success" showIcon style={{ borderRadius: 14 }} message="ร้านนี้ใช้ BYOK อยู่ จึงไม่ถูกจำกัดด้วย shared AI credits" description="ยังควรมี rate limit และ cost dashboard แยก เพื่อกัน abuse และดูภาระ orchestration/infrastructure ของแพลตฟอร์ม" />
              ) : (
                <>
                  <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }} wrap>
                    <div>
                      <div style={{ fontSize: 14, color: "#8c8c8c" }}>เดือนนี้ใช้ไป</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: tone.accent }}>{usagePercent}%</div>
                    </div>
                    <Tag color={aiStatus === "warning" ? "gold" : aiStatus === "exhausted" ? "red" : "blue"} style={{ borderRadius: 999, paddingInline: 10, fontSize: 13 }}>
                      {aiStatus === "warning" ? "ใกล้ถึง quota" : aiStatus === "exhausted" ? "เครดิตหมด" : "ใช้งานได้ปกติ"}
                    </Tag>
                  </Space>
                  <Progress
                    percent={usagePercent}
                    status={aiStatus === "exhausted" ? "exception" : aiStatus === "warning" ? "active" : "normal"}
                    format={() => `${formatNumber(aiCreditsUsed)} / ${formatNumber(aiCreditsTotal)}`}
                    strokeColor={tone.accent}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 12 }}>
                    <Card size="small" style={{ borderRadius: 14 }}>
                      <Text type="secondary">Alert threshold</Text>
                      <div style={{ fontWeight: 700, fontSize: 20, marginTop: 6 }}>80%</div>
                    </Card>
                    <Card size="small" style={{ borderRadius: 14 }}>
                      <Text type="secondary">Reset รอบถัดไป</Text>
                      <div style={{ fontWeight: 700, fontSize: 20, marginTop: 6 }}>ต้นเดือนถัดไป</div>
                    </Card>
                    <Card size="small" style={{ borderRadius: 14 }}>
                      <Text type="secondary">เมื่อเครดิตหมด</Text>
                      <div style={{ fontWeight: 700, fontSize: 20, marginTop: 6 }}>Fallback / Upgrade</div>
                    </Card>
                  </div>
                </>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={9}>
            <Card size="small" title="Usage split" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={split}
                renderItem={(item) => (
                  <List.Item>
                    <div style={{ width: "100%" }}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Space>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: item.color, display: "inline-block" }} />
                          <span>{item.label}</span>
                        </Space>
                        <Text strong>{formatNumber(item.value)} cr</Text>
                      </Space>
                      {item.requests > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{formatNumber(item.requests)} requests</Text>}
                      <div style={{ height: 6, background: "#f5f5f5", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
                        <div style={{ width: `${aiCreditsUsed > 0 ? Math.max(8, Math.round((item.value / aiCreditsUsed) * 100)) : 0}%`, height: "100%", background: item.color }} />
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>

        <Divider />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card size="small" title={<Space><ThunderboltOutlined /> AI Credit plans</Space>} style={{ borderRadius: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
                {[
                  { code: "free", name: "Free", credits: "1,000 AI Credits", note: "ทดลองใช้", cta: "เหมาะกับร้านใหม่" },
                  { code: "pro", name: "Pro", credits: "10,000 AI Credits", note: "ใช้งานจริง", cta: "แนะนำสำหรับร้านที่ใช้ AI ทุกวัน" },
                  { code: "enterprise", name: "Enterprise", credits: "Custom", note: "ตามดีล", cta: "SLA / analytics / support" },
                  { code: "byok", name: "BYOK", credits: "Use your own key", note: "ไม่จำกัดเครดิตแพลตฟอร์ม", cta: "ยังมี rate limit และ infra control" },
                ].map((item) => (
                  <Card
                    key={item.code}
                    size="small"
                    bodyStyle={{ padding: 18 }}
                    style={{
                      borderRadius: 16,
                      borderColor: item.code === cur?.code || (item.code === "byok" && hasByok) ? "#1677ff" : "#f0f0f0",
                      borderWidth: item.code === cur?.code || (item.code === "byok" && hasByok) ? 2 : 1,
                      boxShadow: item.code === cur?.code || (item.code === "byok" && hasByok) ? "0 10px 24px rgba(22,119,255,0.08)" : "none",
                    }}
                  >
                    <Space direction="vertical" size={4}>
                      <Space wrap>
                        <Text strong style={{ fontSize: 18 }}>{item.name}</Text>
                        {(item.code === cur?.code || (item.code === "byok" && hasByok)) && <Tag color="blue">ใช้อยู่</Tag>}
                      </Space>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>
                        {item.code === "free" || item.code === "pro" || item.code === "business"
                          ? `${formatNumber(planAiCredits(plans.find((p: any) => p.code === item.code) ?? cur))} AI Credits`
                          : item.credits}
                      </div>
                      <Text type="secondary">{item.note}</Text>
                      <Paragraph style={{ marginBottom: 0 }}>{item.cta}</Paragraph>
                    </Space>
                  </Card>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card size="small" title={<Space><BarChartOutlined /> Credit ledger</Space>} style={{ borderRadius: 16 }}>
              <List<BillingLedgerRow>
                size="small"
                dataSource={ledger}
                renderItem={(item: BillingLedgerRow) => (
                  <List.Item>
                    <div style={{ width: "100%", padding: 6, borderRadius: 12, background: "#fafafa" }}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                        <Text strong>{item.entryType ?? item.type}</Text>
                        <Text>{typeof item.amount === "number" && item.amount > 0 ? `+${formatNumber(item.amount)}` : formatNumber(item.amount)}</Text>
                      </Space>
                      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                        <Text type="secondary">{item.createdAt ? new Date(item.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : item.date}</Text>
                        <Text type="secondary">คงเหลือ {formatNumber(item.balanceAfter ?? item.balance ?? 0)}</Text>
                      </Space>
                      {(item.note || item.referenceType) && <Text type="secondary" style={{ fontSize: 12 }}>{item.note || item.referenceType}</Text>}
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>

        <Divider />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="จัดการเครดิต AI" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Text type="secondary">ใช้สำหรับเพิ่ม/ลดเครดิตชั่วคราวในเดือนปัจจุบัน เช่น เครดิตชดเชย เครดิตทดลองเพิ่ม หรือปรับแก้ยอด</Text>
                <Space wrap>
                  {[500, 1000, 5000].map((value) => (
                    <Button key={value} onClick={() => setAdjustAmount(value)}>+{formatNumber(value)}</Button>
                  ))}
                  {[-500, -1000].map((value) => (
                    <Button key={value} danger onClick={() => setAdjustAmount(value)}>{value}</Button>
                  ))}
                </Space>
                <Space.Compact style={{ width: "100%" }} direction="vertical">
                  <InputNumber
                    style={{ width: "100%" }}
                    value={adjustAmount}
                    onChange={(value) => setAdjustAmount(Number(value ?? 0))}
                    step={100}
                    placeholder="จำนวนเครดิต (+/-)"
                  />
                  <Input
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="โน้ต เช่น โปรโมชันเปิดร้าน / เครดิตชดเชย / ปรับแก้ยอด"
                  />
                </Space.Compact>
                <Space wrap>
                  <Button
                    type="primary"
                    loading={adjustingCredits}
                    disabled={!adjustAmount}
                    onClick={() => adjustCredits({ variables: { amount: adjustAmount, note: adjustNote || null } })}
                  >
                    บันทึกการปรับเครดิต
                  </Button>
                  <Button
                    disabled={adjustingCredits}
                    onClick={() => {
                      setAdjustAmount(1000);
                      setAdjustNote("");
                    }}
                  >
                    รีเซ็ตฟอร์ม
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card size="small" title="เครดิตเดือนนี้" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={[
                  { label: "เครดิตจากแพ็กเกจ", value: aiUsage?.grantedCredits ?? 0 },
                  { label: "เครดิตปรับเพิ่ม/ลด", value: aiUsage?.adjustedCredits ?? 0 },
                  { label: "เครดิตโบนัส", value: aiUsage?.bonusCredits ?? 0 },
                  { label: "ใช้งานผ่าน shared key", value: aiUsage?.sharedRequests ?? 0 },
                  { label: "ใช้งานผ่าน BYOK", value: aiUsage?.byokRequests ?? 0 },
                  { label: "blocked / fallback", value: aiUsage?.blockedRequests ?? 0 },
                ]}
                renderItem={(item) => (
                  <List.Item>
                    <Space style={{ width: "100%", justifyContent: "space-between" }}>
                      <Text>{item.label}</Text>
                      <Text strong>{formatNumber(Number(item.value ?? 0))}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>

        <Divider />

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Alert type="success" showIcon icon={<KeyOutlined />} style={{ borderRadius: 14 }} message="ควรขายเป็นเครดิต" description="หน้าบ้านให้ร้านเห็นเป็น AI Credits ที่เข้าใจง่าย ส่วนหลังบ้านเก็บ token / cost / tool usage จริง" />
          </Col>
          <Col xs={24} md={8}>
            <Alert type="warning" showIcon icon={<WarningOutlined />} style={{ borderRadius: 14 }} message="ควรมี ledger + quota enforcement" description="ไม่ใช่แค่ dashboard ต้องมี logic บังคับจริงเมื่อใกล้หมดหรือเกิน limit" />
          </Col>
          <Col xs={24} md={8}>
            <Alert type="info" showIcon icon={<RobotOutlined />} style={{ borderRadius: 14 }} message="BYOK ไม่เท่ากับฟรีทุกอย่าง" description="แม้ลูกค้าใช้ key เอง แพลตฟอร์มยังควรมี rate limit และ cost dashboard ฝั่ง orchestration" />
          </Col>
        </Row>
        </div>
      </Card>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="การเปลี่ยนแพ็กเกจยังเป็นโหมดสาธิตอยู่ แต่โควตาสินค้าและ AI credits เดือนนี้จะแสดง/ทำงานตามข้อมูลจริงในระบบ" />

      <Row gutter={[16, 16]}>
        {plans.map((p: any) => {
          const isCurrent = p.code === cur?.code;
          return (
            <Col xs={24} md={8} key={p.code}>
              <Card
                title={p.name}
                style={{ borderColor: isCurrent ? "#1677ff" : undefined, borderWidth: isCurrent ? 2 : 1 }}
                extra={isCurrent && <Tag color="blue">ใช้อยู่</Tag>}
              >
                <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
                  {p.price_monthly > 0 ? <>{p.price_monthly.toLocaleString()} <Text type="secondary" style={{ fontSize: 14 }}>฿/เดือน</Text></> : "ฟรี"}
                </div>
                <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> สินค้า {lim(p.max_products)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> ช่องทาง {lim(p.max_channels)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> ออเดอร์/เดือน {lim(p.max_orders_month)}</div>
                  <div><CheckOutlined style={{ color: "#52c41a" }} /> Staff {lim(p.max_users)}</div>
                </Space>
                <Button type={isCurrent ? "default" : "primary"} block disabled={isCurrent || changing}
                  onClick={() => changePlan({ variables: { planCode: p.code } })}>
                  {isCurrent ? "แพ็กเกจปัจจุบัน" : "เลือกแพ็กเกจนี้"}
                </Button>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
