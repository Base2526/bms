'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, Switch, message, Alert, Typography, Divider, Form, Steps, Table } from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, LinkOutlined, CopyOutlined, KeyOutlined, SaveOutlined, PoweroffOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsChannels { channel active has_token has_secret access_token_masked channel_secret_masked }
  }
`;
const M = gql`
  mutation ($channel: String!, $accessToken: String, $channelSecret: String, $active: Boolean) {
    bmsUpsertChannel(channel: $channel, accessToken: $accessToken, channelSecret: $channelSecret, active: $active)
  }
`;

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

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (error) return <Alert type="error" message="โหลด settings ไม่ได้" description={error.message} showIcon />;

  const tenant = data?.bmsMyTenant;
  const channels: any[] = data?.bmsChannels || [];
  const cfgOf = (k: string) => channels.find((c) => c.channel === k);

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginBottom: 16, alignItems: "stretch" }}>
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
            columns={[
              { title: "ช่องทาง", dataIndex: "label", render: (_: string, r: any) => <Tag color={r.color}>{r.label}</Tag> },
              { title: "ไปเอา Token/Secret จาก", dataIndex: "needs" },
              { title: "สถานะ", dataIndex: "status",
                render: (s: string) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].text}</Tag> },
            ]}
          />
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
        {CHANNELS.map((ch) => (
          <ChannelCard key={ch.key} ch={ch} cfg={cfgOf(ch.key)} tenantId={tenant?.id} origin={origin} onSaved={refetch} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
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

function ChannelCard({ ch, cfg, tenantId, origin, onSaved }: any) {
  const [form] = Form.useForm();
  const [saveChannel, { loading: saving }] = useMutation(M, {
    onCompleted: () => { message.success(`บันทึก ${ch.label} แล้ว`); form.setFieldsValue({ accessToken: "", channelSecret: "" }); onSaved(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
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

  return (
    <Card
      title={<Space><Tag color={ch.color}>{ch.label}</Tag>{cfg?.active ? <Tag color="green">เปิด</Tag> : <Tag>ปิด</Tag>}{cfg?.has_token && <Tag color="blue">เชื่อมแล้ว</Tag>}</Space>}
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>{ch.hint}</Paragraph>

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
    </Card>
  );
}
