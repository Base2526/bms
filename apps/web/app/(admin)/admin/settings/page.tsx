'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, Switch, message, Alert, Typography, Divider, Form, Steps, Table } from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, LinkOutlined, CopyOutlined, KeyOutlined, SaveOutlined, PoweroffOutlined, WarningOutlined, ClockCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsChannels { channel active has_token has_secret access_token_masked channel_secret_masked }
    bmsChannelHealth {
      channel active status status_detail
      last_error_at last_inbound_event_at last_outbound_success_at last_checked_at
    }
  }
`;
const M = gql`
  mutation ($channel: String!, $accessToken: String, $channelSecret: String, $active: Boolean) {
    bmsUpsertChannel(channel: $channel, accessToken: $accessToken, channelSecret: $channelSecret, active: $active)
  }
`;
const M_TEST = gql`
  mutation ($channel: String!) {
    bmsTestChannel(channel: $channel) { ok message }
  }
`;

// เฉพาะช่องทางที่มี API ตรวจสอบ token โดยไม่ต้องส่งข้อความหาลูกค้าจริง (ดู channelHealth.ts)
const TESTABLE_CHANNELS = new Set(["line", "facebook", "instagram"]);

const CHANNELS = [
  { key: "line", label: "LINE Official Account", color: "green",
    hint: "เอา Channel access token + Channel secret จาก LINE Developers Console → Messaging API",
    needs: "LINE Developers Console → Messaging API", status: "ready" },
  { key: "tiktok", label: "TikTok", color: "magenta",
    hint: "เอา Access token + Secret จาก TikTok for Business",
    needs: "TikTok for Business", status: "ready" },
  { key: "facebook", label: "Facebook Messenger", color: "blue",
    hint: "Access token = Page Access Token · Channel Secret = App Secret (ใช้ทั้ง verify token ตอนตั้ง webhook และ verify signature)",
    needs: "Page Access Token + App Secret", status: "ready" },
  { key: "instagram", label: "Instagram DM", color: "purple",
    hint: "IG DM ผ่าน Messenger Platform · Access token = Page Access Token (ผูก IG) · Channel Secret = App Secret",
    needs: "Page Access Token (ผูก IG) + App Secret", status: "ready" },
  { key: "web", label: "Website Live Chat", color: "geekblue",
    hint: "ฝังวิดเจ็ตหน้าเว็บให้ POST ไปที่ URL ด้านล่าง (ไม่ต้องใช้ token) — เปิด/ปิดด้วยสวิตช์",
    needs: "ไม่ต้องมี Token — ฝัง widget ชี้ Webhook URL", status: "no-token" },
  { key: "shopee", label: "Shopee (beta)", color: "orange",
    hint: "⚠️ โครงยังไม่ยืนยันกับเอกสาร Shopee Open Platform จริง — เชื่อมได้แต่ยังไม่รองรับตอบกลับอัตโนมัติ (send API = roadmap)",
    needs: "Shopee Open Platform", status: "beta" },
  { key: "lazada", label: "Lazada (beta)", color: "purple",
    hint: "⚠️ โครงยังไม่ยืนยันกับเอกสาร Lazada Open Platform จริง — เชื่อมได้แต่ยังไม่รองรับตอบกลับอัตโนมัติ (send API = roadmap)",
    needs: "Lazada Open Platform", status: "beta" },
];

const STATUS_META: Record<string, { color: string; text: string }> = {
  ready: { color: "green", text: "ใช้งานจริง" },
  "no-token": { color: "default", text: "ไม่ใช้ Token" },
  beta: { color: "orange", text: "Beta — ยังไม่ตอบกลับอัตโนมัติ" },
};

// สถานะ "สุขภาพ" การเชื่อมต่อจริง (bmsChannelHealth.status) — คนละมิติกับ active (สวิตช์เปิด/ปิด)
const HEALTH_META: Record<string, { color: string; text: string; action: string }> = {
  connected: { color: "green", text: "เชื่อมต่อสำเร็จ", action: "" },
  token_expired: { color: "red", text: "Token หมดอายุ/ถูก revoke", action: "ต่ออายุ Token ในการ์ดด้านล่าง แล้วบันทึกใหม่" },
  webhook_failed: { color: "red", text: "Webhook verify ไม่ผ่าน", action: "ตรวจสอบ Channel Secret ให้ตรงกับ console ของแพลตฟอร์ม" },
  rate_limited: { color: "gold", text: "โดน Rate Limit", action: "แพลตฟอร์มจำกัดอัตราการส่งชั่วคราว รอสักครู่แล้วลองใหม่" },
  no_events: { color: "gold", text: "ไม่มีข้อความเข้านานผิดปกติ", action: "ตรวจสอบว่า Webhook URL ตั้งถูกฝั่ง console ของแพลตฟอร์มหรือไม่" },
  send_failed: { color: "red", text: "รับข้อความได้ แต่ตอบกลับไม่ได้", action: "ตรวจสอบ Access Token ฝั่งส่งข้อความ" },
};

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (error) return <Alert type="error" message="โหลด settings ไม่ได้" description={error.message} showIcon />;

  const tenant = data?.bmsMyTenant;
  const channels: any[] = data?.bmsChannels || [];
  const health: any[] = data?.bmsChannelHealth || [];
  const cfgOf = (k: string) => channels.find((c) => c.channel === k);
  const healthOf = (k: string) => health.find((h) => h.channel === k);

  return (
    <div style={{ maxWidth: 1600 }}>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Settings — เชื่อมช่องทาง</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {tenant && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={<>ร้าน: <b>{tenant.name}</b> <Text code>{tenant.slug}</Text> · tenant id: <Text code>{tenant.id}</Text></>}
          description="เชื่อม LINE / TikTok / Facebook / Instagram ของร้านคุณ แล้วเอา Webhook URL ด้านล่างไปตั้งใน console ของแต่ละแพลตฟอร์ม · Website Live Chat ให้ฝังวิดเจ็ตชี้มาที่ URL · Shopee/Lazada เป็น beta — เชื่อม webhook ได้แต่ยังไม่ตอบกลับอัตโนมัติ"
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 16, marginBottom: 16, alignItems: "stretch" }}>
        <Card size="small" title="4 ขั้นตอน (ทำเหมือนกันทุกช่องทาง)">
          <Steps
            size="small"
            direction="vertical"
            items={[
              { title: "ไปเอา Token", icon: <KeyOutlined />,
                description: "คัดลอก Access Token + Channel Secret จาก console ของแพลตฟอร์มนั้น" },
              { title: "วางแล้วบันทึก", icon: <SaveOutlined />,
                description: "วางในการ์ดช่องทางด้านล่าง กด บันทึก — เข้ารหัสก่อนเก็บทันที" },
              { title: "คัดลอก Webhook URL", icon: <LinkOutlined />,
                description: "เอาไปวางกลับใน console เดิมของแพลตฟอร์มนั้น" },
              { title: "เปิดสวิตช์", icon: <PoweroffOutlined />,
                description: "เปิด เปิดใช้งาน ให้เป็นสีเขียว — ข้อความลูกค้าจะเริ่มไหลเข้า Inbox" },
            ]}
          />
        </Card>

        <Card size="small" title="แต่ละช่องทางต้องใช้อะไร (สรุปเปรียบเทียบ)">
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={CHANNELS}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "ช่องทาง", dataIndex: "label", render: (_: string, r: any) => <Tag color={r.color}>{r.label}</Tag> },
              { title: "ไปเอา Token/Secret จาก", dataIndex: "needs" },
              { title: "สถานะ", dataIndex: "status",
                render: (s: string) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].text}</Tag> },
            ]}
          />
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
        {CHANNELS.map((ch) => (
          <ChannelCard key={ch.key} ch={ch} cfg={cfgOf(ch.key)} health={healthOf(ch.key)} tenantId={tenant?.id} origin={origin} onSaved={refetch} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12 }}>
        <Alert type="info" showIcon message="ความปลอดภัย"
          description="Token/Secret เข้ารหัส AES-256-GCM ก่อนเก็บ · ทุก Webhook ตรวจ signature ก่อนรับข้อความเสมอ" />
        <Alert type="warning" showIcon message="ข้อควรระวัง"
          description="Shopee/Lazada เชื่อม Webhook ได้ แต่ AI ยังตอบกลับอัตโนมัติไม่ได้ (ส่ง API ยังอยู่ใน roadmap)" />
        <Alert type="success" showIcon message="แก้ไขทีหลัง"
          description="เว้นช่อง Access Token/Secret ว่างไว้ = ไม่เปลี่ยนของเดิม ระบบโชว์ค่าปัจจุบันแบบ mask ให้ดูก่อน" />
      </div>
    </div>
  );
}

function ChannelCard({ ch, cfg, health, tenantId, origin, onSaved }: any) {
  const [form] = Form.useForm();
  const [saveChannel, { loading: saving }] = useMutation(M, {
    onCompleted: () => { message.success(`บันทึก ${ch.label} แล้ว`); form.setFieldsValue({ accessToken: "", channelSecret: "" }); onSaved(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
  });
  const [testChannel, { loading: testing }] = useMutation(M_TEST, {
    onCompleted: (d) => {
      const r = d?.bmsTestChannel;
      if (r?.ok) message.success(r.message); else message.error(r?.message || "ทดสอบไม่สำเร็จ");
      onSaved();
    },
    onError: (e) => message.error(e?.message || "ทดสอบไม่สำเร็จ"),
  });

  const webhookUrl = tenantId ? `${origin}/api/bms/${ch.key}/webhook/${tenantId}` : "";
  const copy = () => { navigator.clipboard?.writeText(webhookUrl); message.success("คัดลอก Webhook URL แล้ว"); };

  const submit = async () => {
    const v = await form.validateFields();
    await saveChannel({ variables: {
      channel: ch.key,
      accessToken: v.accessToken || null,
      channelSecret: v.channelSecret || null,
      active: v.active,
    }});
  };

  // ลำดับความสำคัญ: ยังไม่ตั้งค่า > ปิดใช้งานเอง > สุขภาพจริง (bmsChannelHealth.status)
  // ตอนยังไม่กรอก token เลย status บน DB ยังเป็นค่า default ('connected') อยู่ ไม่มีความหมาย
  // จึงต้องเช็ค has_token/active ก่อนเสมอ ไม่ใช้ health.status ตรง ๆ
  const healthBadge = !cfg?.has_token
    ? { color: "default", text: "ยังไม่ตั้งค่า", action: "" }
    : cfg?.active === false
    ? { color: "default", text: "ปิดใช้งานเอง", action: "" }
    : HEALTH_META[health?.status as string] || HEALTH_META.connected;

  const canTest = TESTABLE_CHANNELS.has(ch.key) && cfg?.has_token && cfg?.active && healthBadge.text === "เชื่อมต่อสำเร็จ";

  return (
    <Card
      title={<Space wrap><Tag color={ch.color}>{ch.label}</Tag><Tag color={healthBadge.color}>{healthBadge.text}</Tag></Space>}
      extra={canTest && (
        <Button size="small" icon={<PlayCircleOutlined />} loading={testing} onClick={() => testChannel({ variables: { channel: ch.key } })}>
          ทดสอบ
        </Button>
      )}
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>{ch.hint}</Paragraph>

      {healthBadge.action && (
        <Alert
          type={healthBadge.color === "red" ? "error" : "warning"}
          showIcon
          icon={healthBadge.color === "gold" ? <ClockCircleOutlined /> : <WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={health?.status_detail || healthBadge.text}
          description={
            <>
              {healthBadge.action}
              {health?.last_error_at && <div>เจอครั้งล่าสุด: {fmtDT(health.last_error_at)}</div>}
            </>
          }
        />
      )}

      <Text strong><LinkOutlined /> Webhook URL (เอาไปใส่ใน console):</Text>
      <div style={{ display: "flex", gap: 8, margin: "6px 0 16px" }}>
        <Input readOnly value={webhookUrl} />
        <Button icon={<CopyOutlined />} onClick={copy}>คัดลอก</Button>
      </div>

      <Form form={form} layout="vertical" initialValues={{ active: cfg?.active ?? true }}>
        <Form.Item label={`Access Token ${cfg?.has_token ? `(ปัจจุบัน: ${cfg.access_token_masked} — เว้นว่างถ้าไม่เปลี่ยน)` : ""}`} name="accessToken">
          <Input.Password placeholder={cfg?.has_token ? "•••• (ไม่เปลี่ยน)" : "วาง access token"} autoComplete="off" />
        </Form.Item>
        <Form.Item label={`Channel Secret ${cfg?.has_secret ? `(ปัจจุบัน: ${cfg.channel_secret_masked} — เว้นว่างถ้าไม่เปลี่ยน)` : ""} — ใช้ verify signature`} name="channelSecret">
          <Input.Password placeholder={cfg?.has_secret ? "•••• (ไม่เปลี่ยน)" : "วาง channel secret"} autoComplete="off" />
        </Form.Item>
        <Form.Item label="เปิดใช้งาน" name="active" valuePropName="checked">
          <Switch checkedChildren="เปิด" unCheckedChildren="ปิด" />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={submit}>บันทึก {ch.label}</Button>
      </Form>

      <Divider style={{ margin: "16px 0 0" }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        token/secret ถูกเข้ารหัส (AES-256-GCM) ก่อนเก็บ · signature ตรวจสอบทุก webhook
      </Text>
      {cfg?.has_token && (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            ข้อความเข้าล่าสุด: {fmtDT(health?.last_inbound_event_at)}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            ส่งออกสำเร็จล่าสุด: {fmtDT(health?.last_outbound_success_at)}
          </Text>
        </div>
      )}
    </Card>
  );
}
