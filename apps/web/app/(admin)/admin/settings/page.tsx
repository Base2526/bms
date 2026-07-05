'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, Switch, message, Alert, Typography, Divider, Form } from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, LinkOutlined, CopyOutlined } from "@ant-design/icons";

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
    hint: "เอา Channel access token + Channel secret จาก LINE Developers Console → Messaging API" },
  { key: "tiktok", label: "TikTok", color: "magenta",
    hint: "เอา Access token + Secret จาก TikTok for Business" },
];

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (error) return <Alert type="error" message="โหลด settings ไม่ได้" description={error.message} showIcon />;

  const tenant = data?.bmsMyTenant;
  const channels: any[] = data?.bmsChannels || [];
  const cfgOf = (k: string) => channels.find((c) => c.channel === k);

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Settings — เชื่อมช่องทาง</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {tenant && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={<>ร้าน: <b>{tenant.name}</b> <Text code>{tenant.slug}</Text> · tenant id: <Text code>{tenant.id}</Text></>}
          description="เชื่อม LINE/TikTok ของร้านคุณ แล้วเอา Webhook URL ด้านล่างไปตั้งใน console ของแต่ละแพลตฟอร์ม"
        />
      )}

      {CHANNELS.map((ch) => (
        <ChannelCard key={ch.key} ch={ch} cfg={cfgOf(ch.key)} tenantId={tenant?.id} origin={origin} onSaved={refetch} />
      ))}
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
      style={{ marginBottom: 16 }}
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
