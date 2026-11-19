"use client";

import { useUiText } from "@/lib/useUiText";

import React, { useMemo, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Checkbox, Radio, Space, Table, Tag, Typography, Input } from "antd";
import { PlayCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const Q_CONSOLE_CAPABILITIES = gql`
  query {
    bmsSqlConsoleWriteEnabled
    bmsJsConsoleEnabled
  }
`;
const M_RUN_READONLY = gql`
  mutation RunReadOnlySql($sql: String!) {
    bmsRunReadOnlySql(sql: $sql) { ok columns rows rowCount durationMs error }
  }
`;
const M_RUN_WRITE = gql`
  mutation RunSql($sql: String!) {
    bmsRunSql(sql: $sql) { ok columns rows rowCount durationMs error }
  }
`;
const M_RUN_JS = gql`
  mutation RunSandboxedJs($code: String!) {
    bmsRunSandboxedJs(code: $code) {
      ok
      logs { level text }
      result
      durationMs
      error
    }
  }
`;
const M_SEND_TEST_EMAIL = gql`
  mutation SendTestEmail($to: String!, $html: String) {
    bmsSendTestEmail(to: $to, html: $html) {
      ok
      message
      sent
      details
    }
  }
`;

type SqlResult = {
  ok: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  error: string | null;
};

type JsResult = {
  ok: boolean;
  logs: Array<{ level: "log" | "info" | "warn" | "error"; text: string }>;
  result: string | null;
  durationMs: number;
  error: string | null;
};

type TestEmailResult = {
  ok: boolean;
  message: string;
  sent: number;
  details: string[];
};

export default function SqlConsoleClient() {
  const uiText = useUiText();
  const { t } = useI18n();
  const [mode, setMode] = useState<"read" | "write">("read");
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [sql, setSql] = useState("SELECT tenant_id, name FROM bms_tenants ORDER BY created_at DESC LIMIT 20");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [jsCode, setJsCode] = useState(`function add(a, b) {
  console.log("add()", { a, b });
  return a + b;
}

add(2, 3)`);
  const [jsResult, setJsResult] = useState<JsResult | null>(null);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailHtml, setTestEmailHtml] = useState(`<div style="font-family:Arial,sans-serif;line-height:1.6">
  <h2 style="margin:0 0 12px">BMS test email</h2>
  <p>This is a test email from <code>/admin/dev/sql-console</code>.</p>
</div>`);
  const [testEmailResult, setTestEmailResult] = useState<TestEmailResult | null>(null);

  const { data: capabilitiesData } = useQuery(Q_CONSOLE_CAPABILITIES);
  const writeEnabled = capabilitiesData?.bmsSqlConsoleWriteEnabled === true;
  const jsEnabled = capabilitiesData?.bmsJsConsoleEnabled === true;

  const [runReadOnly, { loading: runningRead }] = useMutation(M_RUN_READONLY, {
    onCompleted: (d) => setResult(d?.bmsRunReadOnlySql ?? null),
    onError: (e) => setResult({ ok: false, columns: [], rows: [], rowCount: 0, durationMs: 0, error: e.message }),
  });
  const [runWrite, { loading: runningWrite }] = useMutation(M_RUN_WRITE, {
    onCompleted: (d) => setResult(d?.bmsRunSql ?? null),
    onError: (e) => setResult({ ok: false, columns: [], rows: [], rowCount: 0, durationMs: 0, error: e.message }),
  });
  const [runJs, { loading: runningJs }] = useMutation(M_RUN_JS, {
    onCompleted: (d) => setJsResult(d?.bmsRunSandboxedJs ?? null),
    onError: (e) => setJsResult({ ok: false, logs: [], result: null, durationMs: 0, error: e.message }),
  });
  const [sendTestEmail, { loading: sendingTestEmail }] = useMutation(M_SEND_TEST_EMAIL, {
    onCompleted: (d) => setTestEmailResult(d?.bmsSendTestEmail ?? null),
    onError: (e) => setTestEmailResult({ ok: false, message: e.message, sent: 0, details: [] }),
  });

  const running = runningRead || runningWrite;

  const columns = useMemo(
    () => (result?.columns ?? []).map((c) => ({ title: c, dataIndex: c, key: c, ellipsis: true })),
    [result]
  );
  const dataSource = useMemo(
    () => (result?.rows ?? []).map((row, i) => ({ ...row, __key: i })),
    [result]
  );

  function handleRun() {
    setResult(null);
    if (mode === "read") {
      runReadOnly({ variables: { sql } });
    } else {
      runWrite({ variables: { sql } });
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert closable
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={t("admin_sql_console.warning_banner")}
        />

        <Card title={uiText("admin_ui.en_sql_console_24fbc")} bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Radio.Group
              value={mode}
              onChange={(e) => { setMode(e.target.value); setConfirmWrite(false); setResult(null); }}
              options={[
                { label: uiText("admin_ui.en_read_only_select_with_57324"), value: "read" },
                { label: uiText("admin_ui.en_write_mode_787ff", { v0: writeEnabled ? "" : t("admin_sql_console.mode_write_disabled_suffix") }), value: "write", disabled: !writeEnabled },
              ]}
              optionType="button"
            />

            <TextArea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 16 }}
              style={{ fontFamily: "monospace" }}
              placeholder={mode === "read" ? t("admin_sql_console.sql_placeholder_read") : t("admin_sql_console.sql_placeholder_write")}
            />

            {mode === "write" && (
              <Checkbox checked={confirmWrite} onChange={(e) => setConfirmWrite(e.target.checked)}>
                {t("admin_sql_console.confirm_write")}
              </Checkbox>
            )}

            <Button
              type="primary"
              danger={mode === "write"}
              icon={<PlayCircleOutlined />}
              loading={running}
              disabled={!sql.trim() || (mode === "write" && !confirmWrite)}
              onClick={handleRun}
            >
              {mode === "read" ? uiText("admin_ui.en_run_read_only_2d473") : uiText("admin_ui.en_run_write_a8e58")}
            </Button>
          </Space>
        </Card>

        {result && (
          <Card
            title={t("admin_sql_console.result_title")}
            extra={
              result.ok ? (
                <Space>
                  <Tag color="green">OK</Tag>
                  <Tag>{result.rowCount}  {uiText("admin_ui.en_rows_6c30d")}</Tag>
                  <Tag>{result.durationMs} ms</Tag>
                </Space>
              ) : (
                <Tag color="red">{uiText("admin_ui.en_error_0b99c")}</Tag>
              )
            }
          >
            {!result.ok && <Alert closable type="error" showIcon message={result.error || t("admin_sql_console.failed")} />}
            {result.ok && result.columns.length > 0 && (
              <Table
                rowKey="__key"
                columns={columns}
                dataSource={dataSource}
                pagination={{ pageSize: 50 }}
                scroll={{ x: true }}
                size="small"
              />
            )}
            {result.ok && result.columns.length === 0 && (
              <Paragraph type="secondary" style={{ margin: 0 }}>
                {t("admin_sql_console.no_rows_returned")}
              </Paragraph>
            )}
          </Card>
        )}

        <Card
          title={uiText("admin_ui.en_javascript_function_console_8d266")}
          extra={jsEnabled ? <Tag color="orange">{uiText("admin_ui.en_non_production_58c81")}</Tag> : <Tag>{uiText("admin_ui.en_disabled_bb2d0")}</Tag>}
          bordered
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert closable
              type="info"
              showIcon
              message={t("admin_sql_console.js_alert_title")}
              description={t("admin_sql_console.js_alert_desc")}
            />
            <TextArea
              value={jsCode}
              onChange={(e) => setJsCode(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 20 }}
              style={{ fontFamily: "monospace" }}
              placeholder={'function add(a, b) { console.log(a, b); return a + b; }\nadd(2, 3)'}
              disabled={!jsEnabled}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={runningJs}
              disabled={!jsEnabled || !jsCode.trim()}
              onClick={() => {
                setJsResult(null);
                runJs({ variables: { code: jsCode } });
              }}
            >
              {uiText("admin_ui.en_run_javascript_b0469")}</Button>
          </Space>
        </Card>

        <Card title={uiText("admin_ui.en_test_email_ce48b")} bordered>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert closable
              type="info"
              showIcon
              message={t("admin_sql_console.email_alert_title")}
              description={t("admin_sql_console.email_alert_desc")}
            />
            <TextArea
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={"name@example.com\nanother@example.com"}
            />
            <TextArea
              value={testEmailHtml}
              onChange={(e) => setTestEmailHtml(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 16 }}
              style={{ fontFamily: "monospace" }}
              placeholder="<div>Hello from BMS</div>"
            />
            <Button
              type="primary"
              loading={sendingTestEmail}
              disabled={!testEmailTo.trim()}
              onClick={() => {
                setTestEmailResult(null);
                sendTestEmail({ variables: { to: testEmailTo, html: testEmailHtml } });
              }}
            >
              {uiText("admin_ui.en_send_test_email_fc552")}</Button>
          </Space>
        </Card>

        {testEmailResult && (
          <Card
            title={uiText("admin_ui.en_test_email_result_6b14c")}
            extra={testEmailResult.ok ? <Tag color="green">OK</Tag> : <Tag color="red">{uiText("admin_ui.en_error_0b99c")}</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert closable
                type={testEmailResult.ok ? "success" : "error"}
                showIcon
                message={testEmailResult.message}
                description={t("admin_sql_console.email_sent_count", { count: testEmailResult.sent })}
              />
              {testEmailResult.details.length > 0 && (
                <div
                  style={{
                    background: "#f5f5f5",
                    borderRadius: 6,
                    fontFamily: "monospace",
                    padding: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {testEmailResult.details.join("\n")}
                </div>
              )}
            </Space>
          </Card>
        )}

        {jsResult && (
          <Card
            title={uiText("admin_ui.en_javascript_output_eaf9e")}
            extra={
              jsResult.ok ? (
                <Space>
                  <Tag color="green">OK</Tag>
                  <Tag>{jsResult.durationMs} ms</Tag>
                </Space>
              ) : (
                <Tag color="red">{uiText("admin_ui.en_error_0b99c")}</Tag>
              )
            }
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {!jsResult.ok && <Alert closable type="error" showIcon message={jsResult.error || t("admin_sql_console.failed")} />}
              {jsResult.logs.length > 0 && (
                <div
                  style={{
                    background: "#111827",
                    borderRadius: 6,
                    color: "#e5e7eb",
                    fontFamily: "monospace",
                    maxHeight: 360,
                    overflow: "auto",
                    padding: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {jsResult.logs.map((entry, index) => (
                    <div
                      key={`${entry.level}-${index}`}
                      style={{
                        color:
                          entry.level === "error" ? "#fca5a5"
                            : entry.level === "warn" ? "#fde68a"
                              : entry.level === "info" ? "#93c5fd"
                                : "#e5e7eb",
                      }}
                    >
                      [{entry.level}] {entry.text}
                    </div>
                  ))}
                </div>
              )}
              {jsResult.ok && (
                <div>
                  <Text type="secondary">{uiText("admin_ui.en_return_value_232f3")}</Text>
                  <pre
                    style={{
                      background: "#f5f5f5",
                      borderRadius: 6,
                      margin: "6px 0 0",
                      overflow: "auto",
                      padding: 12,
                    }}
                  >
                    {jsResult.result ?? "undefined"}
                  </pre>
                </div>
              )}
            </Space>
          </Card>
        )}

        <Card size="small" title={t("admin_sql_console.limits_title")}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>{t("admin_sql_console.limit_read_only_1")} <Text code>{uiText("admin_ui.en_read_only_9af25")}</Text> {t("admin_sql_console.limit_read_only_2")}</li>
            <li>{t("admin_sql_console.limit_single_statement")}</li>
            <li>{t("admin_sql_console.limit_timeout")}</li>
            <li>{t("admin_sql_console.limit_write_prod")}</li>
            <li>{t("admin_sql_console.limit_audit_1")} <Text code>dev.sql_console.read</Text>/<Text code>dev.sql_console.write</Text>)</li>
            <li>{t("admin_sql_console.limit_js")}</li>
            <li>{t("admin_sql_console.limit_js_audit_1")} <Text code>dev.js_console.run</Text>{t("admin_sql_console.limit_js_audit_2")}</li>
          </ul>
        </Card>
      </Space>
    </div>
  );
}
