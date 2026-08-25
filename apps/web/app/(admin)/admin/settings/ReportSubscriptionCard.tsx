'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, Button, Space, Tag, message, Form, Divider, Typography, Select, Switch, InputNumber, List, Alert, Modal } from "antd";
import { MailOutlined, SaveOutlined, SendOutlined, FileSearchOutlined, CopyOutlined, DownloadOutlined, ExportOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { parseRecipientList, invalidEmails, invalidSlackWebhookUrls, invalidLineUserIds } from "@/lib/bms/reportRecipients";
import { useI18n } from "@/lib/i18nContext";

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

const STATUS_COLOR: Record<string, string> = { SUCCESS: "green", PARTIAL: "orange", FAILED: "red" };

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
  const { t } = useI18n();
  const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: t("admin_report_subscription.hour_suffix", { h: String(h).padStart(2, "0") }) }));
  const WEEKDAY_OPTIONS = [
    { value: 1, label: t("admin_report_subscription.weekday_mon") }, { value: 2, label: t("admin_report_subscription.weekday_tue") },
    { value: 3, label: t("admin_report_subscription.weekday_wed") }, { value: 4, label: t("admin_report_subscription.weekday_thu") },
    { value: 5, label: t("admin_report_subscription.weekday_fri") }, { value: 6, label: t("admin_report_subscription.weekday_sat") },
    { value: 0, label: t("admin_report_subscription.weekday_sun") },
  ];
  const CHANNEL_LABEL: Record<string, string> = {
    EMAIL: t("admin_report_subscription.channel_email"),
    SLACK: t("admin_report_subscription.channel_slack"),
    LINE: t("admin_report_subscription.channel_line"),
  };

  const [form] = Form.useForm();
  const { data, loading, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M_SAVE, {
    onCompleted: () => { message.success(t("admin_report_subscription.save_success")); refetch(); },
    onError: (e) => message.error(e.message || t("admin_report_subscription.save_failed")),
  });
  const [sendTest, { loading: testing }] = useMutation(M_TEST, {
    onCompleted: (d) => {
      const r = d?.bmsSendTestReportNow;
      const failed = (r?.results || []).filter((x: any) => !x.ok);
      if (r?.overallStatus === "SUCCESS") message.success(t("admin_report_subscription.test_all_success"));
      else if (failed.length) message.warning(t("admin_report_subscription.test_partial_failed", { detail: failed.map((f: any) => `${f.channel} (${f.error})`).join(", ") }));
      refetch();
    },
    onError: (e) => message.error(e.message || t("admin_report_subscription.test_failed")),
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
    <Card title={<Space><MailOutlined /> {t("admin_report_subscription.card_title")}</Space>} loading={loading} style={{ marginTop: 16 }}>
      <Alert closable
        type="info" showIcon style={{ marginBottom: 16 }}
        message={t("admin_report_subscription.intro_alert")}
        description={t("admin_report_subscription.intro_alert_desc")}
      />
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <SectionTitle>{t("admin_report_subscription.section_frequency")}</SectionTitle>
        <Space wrap align="start">
          <Form.Item name="frequency" label={t("admin_report_subscription.frequency_label")} style={{ marginBottom: 8 }}>
            <Select
              style={{ width: 160 }}
              onChange={(v) => setFrequency(v)}
              options={[
                { value: "DAILY", label: t("admin_report_subscription.frequency_daily") },
                { value: "WEEKLY", label: t("admin_report_subscription.frequency_weekly") },
                { value: "MONTHLY", label: t("admin_report_subscription.frequency_monthly") },
              ]}
            />
          </Form.Item>
          <Form.Item name="sendHour" label={t("admin_report_subscription.send_hour_label")} style={{ marginBottom: 8 }}>
            <Select style={{ width: 130 }} options={HOUR_OPTIONS} />
          </Form.Item>
          {frequency === "WEEKLY" && (
            <Form.Item name="sendWeekday" label={t("admin_report_subscription.send_weekday_label")} style={{ marginBottom: 8 }}>
              <Select style={{ width: 160 }} options={WEEKDAY_OPTIONS} />
            </Form.Item>
          )}
          {frequency === "MONTHLY" && (
            <Form.Item name="sendDayOfMonth" label={t("admin_report_subscription.send_day_of_month_label")} style={{ marginBottom: 8 }}>
              <InputNumber min={1} max={28} style={{ width: 130 }} />
            </Form.Item>
          )}
          <Form.Item name="enabled" label={t("admin_report_subscription.enabled_label")} valuePropName="checked" style={{ marginBottom: 8 }}>
            <Switch />
          </Form.Item>
        </Space>

        <SectionTitle>{t("admin_report_subscription.section_channels")}</SectionTitle>
        <Space direction="vertical" style={{ width: "100%", maxWidth: 480 }}>
          <Space align="center">
            <Form.Item name="emailEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setEmailEnabled} />
            </Form.Item>
            <Text strong>{t("admin_report_subscription.channel_email")}</Text>
          </Space>
          {emailEnabled && (
            <Form.Item
              name="recipientEmail"
              style={{ marginBottom: 0 }}
              extra={t("admin_report_subscription.email_recipients_extra")}
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidEmails(parseRecipientList(value));
                    if (bad.length) throw new Error(t("admin_report_subscription.email_invalid", { list: bad.join(", ") }));
                  },
                },
              ]}
            >
              <Input placeholder={t("admin_report_subscription.email_placeholder")} />
            </Form.Item>
          )}

          <Space align="center" style={{ marginTop: 12 }}>
            <Form.Item name="slackEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setSlackEnabled} />
            </Form.Item>
            <Text strong>{t("admin_report_subscription.channel_slack")}</Text>
            {sub?.hasSlackWebhook && <Tag color="blue">{t("admin_report_subscription.slack_configured")}</Tag>}
          </Space>
          {slackEnabled && (
            <Form.Item
              name="slackWebhookUrl"
              style={{ marginBottom: 0 }}
              extra={t("admin_report_subscription.slack_webhook_extra")}
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidSlackWebhookUrls(parseRecipientList(value));
                    if (bad.length) throw new Error(t("admin_report_subscription.slack_webhook_invalid", { list: bad.join(", ") }));
                  },
                },
              ]}
            >
              <Input placeholder={sub?.hasSlackWebhook ? t("admin_report_subscription.slack_webhook_placeholder_set") : t("admin_report_subscription.slack_webhook_placeholder_empty")} />
            </Form.Item>
          )}

          <Space align="center" style={{ marginTop: 12 }}>
            <Form.Item name="lineEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch onChange={setLineEnabled} />
            </Form.Item>
            <Text strong>{t("admin_report_subscription.channel_line")}</Text>
          </Space>
          {lineEnabled && (
            <Form.Item
              name="lineUserId"
              style={{ marginBottom: 0 }}
              extra={t("admin_report_subscription.line_user_id_extra")}
              rules={[
                {
                  validator: async (_, value) => {
                    const bad = invalidLineUserIds(parseRecipientList(value));
                    if (bad.length) throw new Error(t("admin_report_subscription.line_user_id_invalid", { list: bad.join(", ") }));
                  },
                },
              ]}
            >
              <Input placeholder={t("admin_report_subscription.line_user_id_placeholder")} />
            </Form.Item>
          )}
        </Space>

        <Divider />
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>{t("admin_report_subscription.save_btn")}</Button>
          <Button icon={<SendOutlined />} loading={testing} onClick={() => sendTest()}>{t("admin_report_subscription.send_test_btn")}</Button>
        </Space>
      </Form>

      {sub?.lastSentAt && (
        <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12.5 }}>
          {t("admin_report_subscription.last_sent_prefix", { time: new Date(sub.lastSentAt).toLocaleString("th-TH") })}{" "}
          <Tag color={STATUS_COLOR[sub.lastStatus] || "default"} style={{ marginLeft: 4 }}>{sub.lastStatus}</Tag>
        </Text>
      )}

      {deliveries.length > 0 && (
        <>
          <SectionTitle>{t("admin_report_subscription.section_delivery_history")}</SectionTitle>
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
                        {t("admin_report_subscription.view_details")}
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
                      onClick={() => { navigator.clipboard.writeText(line); message.success(t("admin_report_subscription.copied")); }}
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
              onClick={() => { navigator.clipboard.writeText(detailLines(detailDelivery.error).join("\n")); message.success(t("admin_report_subscription.copy_all_success")); }}
            >
              {t("admin_report_subscription.copy_all_btn")}
            </Button>
          </>
        )}

        {detailDelivery?.status === "SUCCESS" && detailDelivery?.channel === "EMAIL" && (() => {
          const snap = detailDelivery.payloadSnapshot || {};
          const to = detailLines(detailDelivery.error).map(recipientFromLine).filter(Boolean);
          return (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 12.5 }}>
                <div><Text type="secondary">{t("admin_report_subscription.to_label")} </Text>{to.join(", ") || "-"}</div>
                <div><Text type="secondary">{t("admin_report_subscription.subject_label")} </Text>{snap.subject || "-"}</div>
              </div>
              {snap.html ? (
                <iframe
                  title="email-preview"
                  srcDoc={snap.html}
                  sandbox=""
                  style={{ width: "100%", height: 360, border: "0.5px solid #d9d9d9", borderRadius: 6 }}
                />
              ) : (
                <Text type="secondary">{t("admin_report_subscription.no_preview")}</Text>
              )}
              {snap.html && (
                <Space style={{ marginTop: 12 }}>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadBlob(`report-${detailDelivery.id}.eml`, buildEml(to, snap.subject || "", snap.html), "message/rfc822")}
                  >
                    {t("admin_report_subscription.download_eml")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => {
                      const blob = new Blob([snap.html], { type: "text/html" });
                      window.open(URL.createObjectURL(blob), "_blank");
                    }}
                  >
                    {t("admin_report_subscription.open_full")}
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
                {t("admin_report_subscription.download_json")}
              </Button>
            </>
          ) : (
            <Text type="secondary">{t("admin_report_subscription.no_preview")}</Text>
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
                onClick={() => { navigator.clipboard.writeText(snap.text); message.success(t("admin_report_subscription.copied")); }}
              >
                {t("admin_report_subscription.copy_message")}
              </Button>
            </>
          ) : (
            <Text type="secondary">{t("admin_report_subscription.no_preview")}</Text>
          );
        })()}
      </Modal>
    </Card>
  );
}
