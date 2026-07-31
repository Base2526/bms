'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, message, Form, Divider, Typography, Select, Switch, InputNumber, List, Alert, Modal } from "antd";
import { MailOutlined, SaveOutlined, SendOutlined, FileSearchOutlined, CopyOutlined, DownloadOutlined, ExportOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { parseRecipientList, invalidEmails, invalidSlackWebhookUrls, invalidLineUserIds } from "@/lib/bms/reportRecipients";

const { Text } = Typography;

const Q = gql`
  query {
    bmsReportSubscription {
      frequency sendHour sendWeekday sendDayOfMonth
      emailEnabled recipientEmail
      slackEnabled hasSlackWebhook
      lineEnabled lineUserId
      enabled lastSentAt lastStatus lastPeriodKey
    }
    bmsReportDeliveries(limit: 5) {
      id frequency channel status error payloadSnapshot createdAt
    }
  }
`;
const M_SAVE = gql`
  mutation ($input: BmsUpsertReportSubscriptionInput!) {
    bmsUpsertReportSubscription(input: $input) { enabled lastStatus }
  }
`;
const M_TEST = gql`
  mutation { bmsSendTestReportNow { overallStatus results { channel ok error } } }
`;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, "0")}:00 น.` }));
const WEEKDAY_OPTIONS = [
  { value: 1, label: "วันจันทร์" }, { value: 2, label: "วันอังคาร" }, { value: 3, label: "วันพุธ" },
  { value: 4, label: "วันพฤหัสบดี" }, { value: 5, label: "วันศุกร์" }, { value: 6, label: "วันเสาร์" }, { value: 0, label: "วันอาทิตย์" },
];
const STATUS_COLOR: Record<string, string> = { SUCCESS: "green", PARTIAL: "orange", FAILED: "red" };
const CHANNEL_LABEL: Record<string, string> = { EMAIL: "อีเมล", SLACK: "Slack", LINE: "LINE" };

// รายละเอียดต่อผู้รับถูก join ด้วย " | " จาก reportDigest.ts (sendEmailChannel/sendSlackChannel/sendLineChannel)
function detailLines(errorText: string | null | undefined): string[] {
  return (errorText || "").split(" | ").filter(Boolean);
}

// แต่ละบรรทัดมีรูปแบบ "<recipient>: <ข้อความ>" — ใช้แยกอีเมลผู้รับออกมาประกอบไฟล์ .eml เท่านั้น
function recipientFromLine(line: string): string {
  return line.split(": ")[0]?.trim() || "";
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildEml(to: string[], subject: string, html: string): string {
  return [
    `From: report-digest@bms.local`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join("\r\n");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "20px 0 12px" }}>
      <span style={{ width: 4, height: 16, background: "#1677ff", borderRadius: 2, display: "inline-block" }} />
      <span style={{ fontWeight: 600, fontSize: 14 }}>{children}</span>
    </div>
  );
}

export default function ReportSubscriptionCard() {
  const [form] = Form.useForm();
  const { data, loading, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M_SAVE, {
    onCompleted: () => { message.success("บันทึกการตั้งค่ารายงานแล้ว"); refetch(); },
    onError: (e) => message.error(e.message || "บันทึกไม่สำเร็จ"),
  });
  const [sendTest, { loading: testing }] = useMutation(M_TEST, {
    onCompleted: (d) => {
      const r = d?.bmsSendTestReportNow;
      const failed = (r?.results || []).filter((x: any) => !x.ok);
      if (r?.overallStatus === "SUCCESS") message.success("ส่งทดสอบสำเร็จทุกช่องทาง");
      else if (failed.length) message.warning(`บางช่องทางส่งไม่สำเร็จ: ${failed.map((f: any) => `${f.channel} (${f.error})`).join(", ")}`);
      refetch();
    },
    onError: (e) => message.error(e.message || "ส่งทดสอบไม่สำเร็จ"),
  });

  const [detailDelivery, setDetailDelivery] = useState<any | null>(null);

  const [frequency, setFrequency] = useState("DAILY");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [lineEnabled, setLineEnabled] = useState(false);

  const sub = data?.bmsReportSubscription;
  const deliveries = data?.bmsReportDeliveries || [];

  useEffect(() => {
    if (!sub) return;
    form.setFieldsValue({
      frequency: sub.frequency, sendHour: sub.sendHour,
      sendWeekday: sub.sendWeekday ?? 1, sendDayOfMonth: sub.sendDayOfMonth ?? 1,
      enabled: sub.enabled,
      emailEnabled: sub.emailEnabled, recipientEmail: sub.recipientEmail || "",
      slackEnabled: sub.slackEnabled, slackWebhookUrl: "",
      lineEnabled: sub.lineEnabled, lineUserId: sub.lineUserId || "",
    });
    setFrequency(sub.frequency);
    setEmailEnabled(sub.emailEnabled);
    setSlackEnabled(sub.slackEnabled);
    setLineEnabled(sub.lineEnabled);
  }, [sub, form]);

  const onFinish = (values: any) => {
    save({
      variables: {
        input: {
          frequency: values.frequency,
          sendHour: values.sendHour,
          sendWeekday: values.frequency === "WEEKLY" ? values.sendWeekday : null,
          sendDayOfMonth: values.frequency === "MONTHLY" ? values.sendDayOfMonth : null,
          enabled: values.enabled,
          emailEnabled: values.emailEnabled,
          recipientEmail: values.recipientEmail || null,
          slackEnabled: values.slackEnabled,
          slackWebhookUrl: values.slackWebhookUrl?.trim() ? values.slackWebhookUrl.trim() : undefined,
          lineEnabled: values.lineEnabled,
          lineUserId: values.lineUserId || null,
        },
      },
    });
  };

  return (
    <Card title={<Space><MailOutlined /> รายงานสรุปยอดขาย</Space>} loading={loading} style={{ marginTop: 16 }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="ส่งสรุปยอดขาย/ออเดอร์/สินค้าขายดีอัตโนมัติตามความถี่ที่ตั้งไว้ ผ่านอีเมล/Slack/LINE"
        description="LINE ใช้ access token ของ LINE OA ร้านนี้เอง (การ์ดช่องทาง LINE ด้านบน) ส่งหา 'LINE user id' ที่ระบุ — ต้องเชื่อม LINE OA ไว้ก่อน"
      />
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <SectionTitle>ความถี่และเวลาส่ง</SectionTitle>
        <Space wrap align="start">
          <Form.Item name="frequency" label="ความถี่" style={{ marginBottom: 8 }}>
            <Select
              style={{ width: 160 }}
              onChange={(v) => setFrequency(v)}
              options={[{ value: "DAILY", label: "รายวัน" }, { value: "WEEKLY", label: "รายสัปดาห์" }, { value: "MONTHLY", label: "รายเดือน" }]}
            />
          </Form.Item>
          <Form.Item name="sendHour" label="เวลาส่ง" style={{ marginBottom: 8 }}>
            <Select style={{ width: 130 }} options={HOUR_OPTIONS} />
          </Form.Item>
          {frequency === "WEEKLY" && (
            <Form.Item name="sendWeekday" label="วันในสัปดาห์" style={{ marginBottom: 8 }}>
              <Select style={{ width: 160 }} options={WEEKDAY_OPTIONS} />
            </Form.Item>
          )}
          {frequency === "MONTHLY" && (
            <Form.Item name="sendDayOfMonth" label="วันที่ของเดือน" style={{ marginBottom: 8 }}>
              <InputNumber min={1} max={28} style={{ width: 130 }} />
            </Form.Item>
          )}
          <Form.Item name="enabled" label="เปิดใช้งาน" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Switch />
          </Form.Item>
        </Space>

        <SectionTitle>ช่องทางที่ส่ง</SectionTitle>
        <Space direction="vertical" style={{ width: "100%", maxWidth: 480 }}>
          <Space align="center">
            <Form.Item name="emailEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setEmailEnabled} />
            </Form.Item>
            <Text strong>อีเมล</Text>
          </Space>
          {emailEnabled && (
            <Form.Item
              name="recipientEmail"
              style={{ marginBottom: 0 }}
              extra="ใส่ได้หลายอีเมล คั่นด้วย , (comma)"
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidEmails(parseRecipientList(value));
                    if (bad.length) throw new Error(`อีเมลไม่ถูกต้อง: ${bad.join(", ")}`);
                  },
                },
              ]}
            >
              <Input placeholder="อีเมลผู้รับ เช่น owner@shop.com, sales@shop.com" />
            </Form.Item>
          )}

          <Space align="center" style={{ marginTop: 12 }}>
            <Form.Item name="slackEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setSlackEnabled} />
            </Form.Item>
            <Text strong>Slack</Text>
            {sub?.hasSlackWebhook && <Tag color="blue">ตั้งค่าไว้แล้ว</Tag>}
          </Space>
          {slackEnabled && (
            <Form.Item
              name="slackWebhookUrl"
              style={{ marginBottom: 0 }}
              extra="ใส่ได้หลาย webhook คั่นด้วย , (comma) — กรอกใหม่ทั้งหมดเฉพาะถ้าต้องการเปลี่ยน (เว้นว่าง = คงค่าเดิม)"
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidSlackWebhookUrls(parseRecipientList(value));
                    if (bad.length) throw new Error(`Slack webhook URL ไม่ถูกต้อง (ต้องเป็น https://): ${bad.join(", ")}`);
                  },
                },
              ]}
            >
              <Input placeholder={sub?.hasSlackWebhook ? "กรอกใหม่เฉพาะถ้าต้องการเปลี่ยน webhook URL" : "Slack Incoming Webhook URL"} />
            </Form.Item>
          )}

          <Space align="center" style={{ marginTop: 12 }}>
            <Form.Item name="lineEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setLineEnabled} />
            </Form.Item>
            <Text strong>LINE</Text>
          </Space>
          {lineEnabled && (
            <Form.Item
              name="lineUserId"
              style={{ marginBottom: 0 }}
              extra="ใส่ได้หลาย LINE user id คั่นด้วย , (comma)"
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidLineUserIds(parseRecipientList(value));
                    if (bad.length) throw new Error(`LINE user id ไม่ถูกต้อง (ต้องขึ้นต้นด้วย U ตามด้วยรหัส 32 ตัวอักษร): ${bad.join(", ")}`);
                  },
                },
              ]}
            >
              <Input placeholder="LINE user id ของผู้รับ เช่น U4af4980629..., U9bc1234567..." />
            </Form.Item>
          )}
        </Space>

        <Divider />
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>บันทึก</Button>
          <Button icon={<SendOutlined />} loading={testing} onClick={() => sendTest()}>ส่งทดสอบตอนนี้ (24 ชม. ล่าสุด)</Button>
        </Space>
      </Form>

      {sub?.lastSentAt && (
        <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12.5 }}>
          ส่งล่าสุด: {new Date(sub.lastSentAt).toLocaleString("th-TH")} ·{" "}
          <Tag color={STATUS_COLOR[sub.lastStatus] || "default"} style={{ marginLeft: 4 }}>{sub.lastStatus}</Tag>
        </Text>
      )}

      {deliveries.length > 0 && (
        <>
          <SectionTitle>ประวัติการส่งล่าสุด</SectionTitle>
          <List
            size="small"
            dataSource={deliveries}
            renderItem={(d: any) => (
              <List.Item>
                <div style={{ width: "100%" }}>
                  <Space>
                    <Tag color={STATUS_COLOR[d.status] || "default"}>{d.status}</Tag>
                    <Text>{CHANNEL_LABEL[d.channel] || d.channel}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString("th-TH")}</Text>
                  </Space>
                  {/* รายละเอียด response ต่อผู้รับ — FAILED โชว์ error เต็มไม่ตัดทอน, SUCCESS โชว์ preview
                      ของสิ่งที่ส่งจริง (payloadSnapshot) — ซ่อนไว้หลังปุ่มกันรายการยาวเกิน */}
                  {(d.error || d.payloadSnapshot) && (
                    <div style={{ marginTop: 4 }}>
                      <Button
                        type="link"
                        size="small"
                        icon={<FileSearchOutlined />}
                        style={{ padding: 0, height: "auto", fontSize: 12, color: d.status === "FAILED" ? "#ff4d4f" : undefined }}
                        onClick={() => setDetailDelivery(d)}
                      >
                        ดูรายละเอียด
                      </Button>
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />
        </>
      )}

      <Modal
        open={!!detailDelivery}
        onCancel={() => setDetailDelivery(null)}
        footer={null}
        width={detailDelivery?.status === "SUCCESS" && detailDelivery?.channel === "EMAIL" ? 640 : 520}
        title={
          detailDelivery
            ? `${CHANNEL_LABEL[detailDelivery.channel] || detailDelivery.channel} · ${detailDelivery.status} · ${new Date(detailDelivery.createdAt).toLocaleString("th-TH")}`
            : ""
        }
      >
        {detailDelivery?.status === "FAILED" && (
          <>
            <List
              size="small"
              dataSource={detailLines(detailDelivery.error)}
              renderItem={(line) => (
                <List.Item
                  style={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  actions={[
                    <Button
                      key="copy"
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => { navigator.clipboard.writeText(line); message.success("คัดลอกแล้ว"); }}
                    />,
                  ]}
                >
                  {line}
                </List.Item>
              )}
            />
            <Button
              size="small"
              icon={<CopyOutlined />}
              style={{ marginTop: 8 }}
              onClick={() => { navigator.clipboard.writeText(detailLines(detailDelivery.error).join("\n")); message.success("คัดลอกทั้งหมดแล้ว"); }}
            >
              คัดลอกทั้งหมด
            </Button>
          </>
        )}

        {detailDelivery?.status === "SUCCESS" && detailDelivery?.channel === "EMAIL" && (() => {
          const snap = detailDelivery.payloadSnapshot || {};
          const to = detailLines(detailDelivery.error).map(recipientFromLine).filter(Boolean);
          return (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 12.5 }}>
                <div><Text type="secondary">ถึง </Text>{to.join(", ") || "-"}</div>
                <div><Text type="secondary">หัวข้อ </Text>{snap.subject || "-"}</div>
              </div>
              {snap.html ? (
                <iframe
                  title="email-preview"
                  srcDoc={snap.html}
                  sandbox=""
                  style={{ width: "100%", height: 360, border: "0.5px solid #d9d9d9", borderRadius: 6 }}
                />
              ) : (
                <Text type="secondary">ไม่มี preview เนื้อหา (ส่งก่อนอัปเดตฟีเจอร์นี้)</Text>
              )}
              {snap.html && (
                <Space style={{ marginTop: 12 }}>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadBlob(`report-${detailDelivery.id}.eml`, buildEml(to, snap.subject || "", snap.html), "message/rfc822")}
                  >
                    ดาวน์โหลด .eml
                  </Button>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => {
                      const blob = new Blob([snap.html], { type: "text/html" });
                      window.open(URL.createObjectURL(blob), "_blank");
                    }}
                  >
                    เปิดดูแบบเต็ม
                  </Button>
                </Space>
              )}
            </>
          );
        })()}

        {detailDelivery?.status === "SUCCESS" && detailDelivery?.channel === "SLACK" && (() => {
          const snap = detailDelivery.payloadSnapshot || {};
          const json = snap.payload ? JSON.stringify(snap.payload, null, 2) : "";
          return json ? (
            <>
              <pre style={{ fontSize: 12, background: "#f5f5f5", padding: 12, borderRadius: 6, maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {json}
              </pre>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => downloadBlob(`report-${detailDelivery.id}.json`, json, "application/json")}
              >
                ดาวน์โหลด .json
              </Button>
            </>
          ) : (
            <Text type="secondary">ไม่มี preview เนื้อหา (ส่งก่อนอัปเดตฟีเจอร์นี้)</Text>
          );
        })()}

        {detailDelivery?.status === "SUCCESS" && detailDelivery?.channel === "LINE" && (() => {
          const snap = detailDelivery.payloadSnapshot || {};
          return snap.text ? (
            <>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f5f5f5", padding: 12, borderRadius: 6 }}>
                {snap.text}
              </div>
              <Button
                size="small"
                icon={<CopyOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => { navigator.clipboard.writeText(snap.text); message.success("คัดลอกแล้ว"); }}
              >
                คัดลอกข้อความ
              </Button>
            </>
          ) : (
            <Text type="secondary">ไม่มี preview เนื้อหา (ส่งก่อนอัปเดตฟีเจอร์นี้)</Text>
          );
        })()}
      </Modal>
    </Card>
  );
}
