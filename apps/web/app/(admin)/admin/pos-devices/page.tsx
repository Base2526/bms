"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
// ตั้งค่าเครื่องขาย + PIN พนักงาน
// -------------------------------------------------------------
// สองอย่างนี้อยู่หน้าเดียวกันเพราะมันคือ "เตรียมจุดขายให้พร้อม" เรื่องเดียวกัน:
// ถ้าเครื่องไม่มี token จับคู่ไม่ได้ ถ้าพนักงานไม่มี PIN ขายไม่ได้
//
// token กับ PIN แสดงค่าจริงได้ครั้งเดียวตอนสร้างเท่านั้น — ฐานข้อมูลเก็บแต่ hash
// จึงไม่มีปุ่ม "ดูอีกครั้ง" ให้กด หายแล้วออกใหม่อย่างเดียว
import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, QRCode, Select, Space, Switch, Table, Tag,
  Typography, message,
} from "antd";
import { ReadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { LocalExtraDeviceNotice } from "@/components/retail-local/LocalCommercial";
import { buildPairingQr } from "@pos-core/pairingQr";
import {
  isPosPinValid,
  normalizePosPinInput,
  POS_PIN_MAX_LENGTH,
} from "@pos-core/posPin";

const Q = gql`
  query PosSetup($includeDevices: Boolean!, $includeLocations: Boolean!, $includeStaff: Boolean!, $includeDiagnostics: Boolean!, $diagnosticDeviceId: ID) {
    bmsLocations @include(if: $includeLocations) { id name branchCode isHeadOffice }
    bmsPosDevices @include(if: $includeDevices) {
      id locationId code name registeredPosNo receiptPrefix
      scannerMode scannerPrefixKey scannerSuffixKey scannerMaxGapMs active lastSeenAt
    }
    bmsPosStaff @include(if: $includeStaff) { id name email role isPharmacist hasPin posOnly }
    bmsPosDeviceDiagnostics(deviceId: $diagnosticDeviceId, limit: 50) @include(if: $includeDiagnostics) {
      id occurredAt receivedAt correlationId actorKind actorLabel actorRole deviceId locationId category action status message context
    }
  }
`;
const M_UPSERT = gql`
  mutation($input: BmsPosDeviceInput!) {
    bmsUpsertPosDevice(input: $input) { id code }
  }
`;
const M_TOKEN = gql`
  mutation($deviceId: ID!) { bmsIssuePosDeviceToken(deviceId: $deviceId) { token } }
`;
const M_PIN = gql`
  mutation($userId: ID!, $pin: String) { bmsSetCashierPin(userId: $userId, pin: $pin) }
`;
const M_MODE = gql`
  mutation($userId: ID!, $posOnly: Boolean!) { bmsSetCashierAccountMode(userId: $userId, posOnly: $posOnly) }
`;

type Device = {
  id: string; locationId: string; code: string; name: string | null;
  registeredPosNo: string | null; receiptPrefix: string | null; active: boolean;
  scannerMode: "FOCUS" | "PREFIX"; scannerPrefixKey: string;
  scannerSuffixKey: string; scannerMaxGapMs: number; lastSeenAt: string | null;
};

type DiagnosticEvent = {
  id: string; occurredAt: string; receivedAt: string; deviceId: string | null;
  correlationId: string | null; actorKind: "cashier" | "user" | "device" | "unknown";
  actorLabel: string | null; actorRole: string | null; locationId: string | null; category: string; action: string;
  status: string | null; message: string | null; context: Record<string, unknown>;
};

const DIAGNOSTIC_CONTEXT_LABELS = (uiText: UiTranslator = thaiUiText): Record<string, string> => ({
  route: "Route",
  previousRoute: uiText("admin_ui.previous_page_706f9"),
  errorName: uiText("admin_ui.error_type_92188"),
  errorCode: "Error code",
  httpStatus: "HTTP status",
  durationMs: uiText("admin_ui.duration_86b4c"),
  appVersion: uiText("admin_ui.app_version_44e7c"),
  platform: uiText("admin_ui.platform_7b3a6"),
  online: uiText("admin_ui.connection_75bea"),
  visibility: uiText("admin_ui.screen_state_ca156"),
  viewport: uiText("admin_ui.screen_size_8f7e2"),
  source: uiText("admin_ui.source_ae02e"),
  retry: uiText("admin_ui.retry_attempt_8eb9d"),
  sequence: uiText("admin_ui.sort_order_cb88e"),
  bundleVersion: uiText("admin_ui.diagnostics_version_67bb1"),
  digest: "Digest",
});

function formatDiagnosticValue(key: string, value: unknown, uiText: UiTranslator = thaiUiText): string {
  if (key === "durationMs" && typeof value === "number") {
    return value >= 1_000 ? uiText("admin_ui.seconds_a1554", { v0: (value / 1_000).toFixed(2) }) : `${value} ms`;
  }
  if (key === "online" && typeof value === "boolean") return value ? uiText("admin_ui.online_5a91b") : uiText("admin_ui.offline_d2a59");
  return String(value);
}

const SCANNER_PREFIX_OPTIONS = ["F9", ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`)
  .filter((key) => key !== "F9")].map((value) => ({ value, label: value }));

export default function PosDevicesPage() {
  const uiText = useUiText();
  const apollo = useApolloClient();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canDevices = can("pos.device.manage");
  const canPins = can("pos.pin.manage");
  const canStaff = can("pos.staff.manage");
  const canDiagnostics = can("support.logs.view");
  const canLocations = can("product.view");
  const [diagnosticDeviceId, setDiagnosticDeviceId] = useState<string | null>(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState("all");
  const { data, loading, refetch } = useQuery(Q, {
    fetchPolicy: "cache-and-network",
    variables: { includeDevices: canDevices, includeLocations: canLocations, includeStaff: canStaff, includeDiagnostics: canDiagnostics, diagnosticDeviceId },
    skip: !canDevices && !canPins && !canStaff,
  });

  const [deviceForm] = Form.useForm();
  const [editing, setEditing] = useState<Device | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [issued, setIssued] = useState<{ token: string; device: Device } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const issueInFlight = useRef(false);
  const mounted = useRef(true);
  const canIssue = useRef(canDevices);
  canIssue.current = canDevices;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (!canDevices) setIssued(null); }, [canDevices]);
  const issuedToken = issued?.token ?? null;
  const [pinFor, setPinFor] = useState<{ id: string; label: string } | null>(null);
  const [pinValue, setPinValue] = useState("");

  const [upsert, { loading: saving }] = useMutation(M_UPSERT);
  const [setPin, { loading: pinSaving }] = useMutation(M_PIN);
  const [setMode] = useMutation(M_MODE);

  if (!permsLoading && !canDevices && !canPins && !canStaff) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_this_7354b")} />;
  }

  const locations = data?.bmsLocations ?? [];
  const devices: Device[] = data?.bmsPosDevices ?? [];
  const cashiers = data?.bmsPosStaff ?? [];
  const diagnostics: DiagnosticEvent[] = data?.bmsPosDeviceDiagnostics ?? [];
  const visibleDiagnostics = diagnosticStatus === "all"
    ? diagnostics
    : diagnostics.filter((event) => (event.status ?? "info") === diagnosticStatus);
  const locationName = (id: string) => locations.find((l: any) => l.id === id)?.name ?? "—";
  const deviceLabel = (id: string | null | undefined) => {
    const device = devices.find((item) => item.id === id);
    return device ? `${device.code}${device.name ? ` · ${device.name}` : ""}` : "—";
  };
  const fmtDT = (value: string | null | undefined) => value ? new Date(value).toLocaleString(uiText.locale) : "—";
  // ลิงก์จับคู่: หน้าขายอ่าน ?t= แล้วเก็บลง localStorage และลบ query ออกจาก URL ทันที
  const pairUrl = issuedToken
    ? `${typeof window === "undefined" ? "" : window.location.origin}/pos?t=${encodeURIComponent(issuedToken)}`
    : "";
  const pairingQr = issuedToken && typeof window !== "undefined"
    ? buildPairingQr({ serverUrl: window.location.origin, token: issuedToken })
    : null;

  async function saveDevice() {
    try {
      const values = await deviceForm.validateFields();
      await upsert({ variables: { input: { ...values, id: editing?.id ?? null } } });
      message.success(uiText("admin_ui.pos_device_saved_6f443"));
      setDeviceOpen(false);
      setEditing(null);
      deviceForm.resetFields();
      await refetch();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation — antd แสดงเองแล้ว
      message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
    }
  }

  async function handleIssueToken(device: Device) {
    if (issueInFlight.current || !canIssue.current) return;
    issueInFlight.current = true;
    setIssuing(true);
    try {
      // Do not retain the raw credential in Apollo cache or a useMutation result state.
      const res = await apollo.mutate({ mutation: M_TOKEN, fetchPolicy: "no-cache", variables: { deviceId: device.id } });
      const token = res.data?.bmsIssuePosDeviceToken?.token;
      if (typeof token !== "string" || !/^pos_[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new Error(uiText("admin_ui.en_invalid_device_credential_response_a4f70"));
      }
      if (mounted.current && canIssue.current) setIssued({ token, device });
    } catch {
      if (mounted.current) message.error(uiText("admin_ui.no_valid_token_received_yet_check_the_connection_dc1a2"));
    } finally {
      issueInFlight.current = false;
      if (mounted.current) setIssuing(false);
    }
  }

  async function copyPairingValue(value: string, success: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(uiText("admin_ui.en_clipboard_unavailable_bec46"));
      await navigator.clipboard.writeText(value);
      if (mounted.current) message.success(success);
    } catch {
      if (mounted.current) message.warning(uiText("admin_ui.could_not_copy_select_the_text_and_copy_96d37"));
    }
  }

  async function toggleMode(userId: string, posOnly: boolean) {
    try {
      await setMode({ variables: { userId, posOnly } });
      message.success(posOnly ? uiText("admin_ui.back_office_access_disabled_14676") : uiText("admin_ui.back_office_access_enabled_0d43e"));
      await refetch();
    } catch (e: any) {
      message.error(e?.message ?? uiText("admin_ui.couldn_t_save_settings_473c9"));
    }
  }

  async function savePin(clear = false) {
    if (!pinFor) return;
    if (!clear && !isPosPinValid(pinValue)) {
      message.error(uiText("admin_ui.pin_must_contain_4_8_digits_24222"));
      return;
    }
    try {
      await setPin({ variables: { userId: pinFor.id, pin: clear ? null : pinValue } });
      message.success(clear ? uiText("admin_ui.pin_cleared_47036") : uiText("admin_ui.pin_set_297a4"));
      setPinFor(null);
      setPinValue("");
      await refetch();
    } catch (e: any) {
      message.error(e?.message ?? uiText("admin_ui.could_not_set_pin_5a625"));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.pos_devices_b3778")}>
        <Link href="/admin/pos-manual"><Button icon={<ReadOutlined />}>{uiText("admin_ui.cashier_manual_3e8eb")}</Button></Link>
      </AdminPageHeader>

      {canDevices && (
        <Card
          title={uiText("admin_ui.register_9c6a7")}
          extra={
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                deviceForm.resetFields();
                deviceForm.setFieldsValue({
                  active: true,
                  locationId: locations[0]?.id,
                  scannerMode: "FOCUS",
                  scannerPrefixKey: "F9",
                  scannerSuffixKey: "Enter",
                  scannerMaxGapMs: 80,
                });
                setDeviceOpen(true);
              }}
            >
              {uiText("admin_ui.add_device_000a9")}</Button>
          }
          loading={loading}
        >
          <LocalExtraDeviceNotice count={devices.length} />
          {devices.length === 0 ? (
            <Empty description={uiText("admin_ui.no_pos_devices_yet_56af3")} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={devices}
              pagination={false}
              columns={[
                { title: uiText("admin_ui.code_e5390"), dataIndex: "code", width: 130 },
                { title: uiText("admin_ui.name_0b1fc"), dataIndex: "name" },
                { title: uiText("admin_ui.branch_63a7c"), dataIndex: "locationId", render: locationName },
                {
                  title: uiText("admin_ui.registration_number_pos_7930c"),
                  dataIndex: "registeredPosNo",
                  render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span>,
                },
                {
                  title: uiText("admin_ui.receipt_prefix_d3a1b"),
                  dataIndex: "receiptPrefix",
                  width: 110,
                  render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span>,
                },
                {
                  title: uiText("admin_ui.en_scanner_hid_3f5b0"),
                  dataIndex: "scannerMode",
                  width: 130,
                  render: (v: Device["scannerMode"], row: Device) =>
                    v === "PREFIX" ? <Tag color="blue">{uiText("admin_ui.en_prefix_90ece")} {row.scannerPrefixKey}</Tag> : <Tag>{uiText("admin_ui.follow_focus_e682a")}</Tag>,
                },
                {
                  title: uiText("admin_ui.status_2e8c4"),
                  dataIndex: "active",
                  width: 90,
                  render: (v: boolean) => (v ? <Tag color="green">{uiText("admin_ui.active_3a6f5")}</Tag> : <Tag>{uiText("admin_ui.close_96d79")}</Tag>),
                },
                {
                  title: uiText("admin_ui.last_contact_with_server_fc025"),
                  dataIndex: "lastSeenAt",
                  width: 180,
                  render: (v: string | null) => v ? fmtDT(v) : <span style={{ color: "#999" }}>{uiText("admin_ui.never_seen_76c51")}</span>,
                },
                {
                  title: "",
                  width: 190,
                  render: (_: unknown, d: Device) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditing(d);
                          deviceForm.setFieldsValue(d);
                          setDeviceOpen(true);
                        }}
                      >
                        {uiText("admin_ui.edit_e7eca")}</Button>
                      <Popconfirm
                        title={uiText("admin_ui.issue_a_new_token_f27ed")}
                        description={uiText("admin_ui.any_device_using_the_old_token_will_disconnect_7ccd1")}
                        okText={uiText("admin_ui.reissue_1cb7d")}
                        cancelText={uiText("admin_ui.cancelled_fba6e")}
                        onConfirm={() => void handleIssueToken(d)}
                      >
                        <Button size="small" loading={issuing}>{uiText("admin_ui.issue_token_40693")}</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {uiText("admin_ui.issuing_a_new_token_immediately_invalidates_the_old_787e4")} <a href="/pos">/pos</a>  {uiText("admin_ui.or_a998c")} <a href="/pos/restaurant">/pos/restaurant</a>  {uiText("admin_ui.use_the_store_archetype_d4c61")}</Typography.Paragraph>
        </Card>
      )}

      {canDiagnostics && (
        <Card
          title={uiText("admin_ui.recent_pos_device_events_90903")}
          extra={
            <Space wrap>
              <Select
                allowClear
                placeholder={uiText("admin_ui.all_devices_1e63a")}
                style={{ width: 260 }}
                value={diagnosticDeviceId ?? undefined}
                onChange={(value) => setDiagnosticDeviceId(value ?? null)}
                options={devices.map((device) => ({
                  value: device.id,
                  label: deviceLabel(device.id),
                }))}
              />
              <Select
                aria-label={uiText("admin_ui.filter_pos_event_status_22049")}
                style={{ width: 150 }}
                value={diagnosticStatus}
                onChange={setDiagnosticStatus}
                options={[
                  { value: "all", label: uiText("admin_ui.all_statuses_8ca94") },
                  { value: "error", label: uiText("admin_ui.en_error_7f2f6") },
                  { value: "warning", label: uiText("admin_ui.en_warning_e9c45") },
                  { value: "success", label: uiText("admin_ui.en_success_42a8f") },
                  { value: "info", label: uiText("admin_ui.en_info_4b631") },
                ]}
              />
              <Button onClick={() => void refetch()}>{uiText("admin_ui.refresh_78a47")}</Button>
            </Space>
          }
          loading={loading}
        >
          <Alert closable
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={uiText("admin_ui.see_which_device_reported_each_event_and_the_08257")}
            description={uiText("admin_ui.these_entries_come_only_from_pos_device_bms_5bdde")}
          />
          <Table
            size="small"
            rowKey="id"
            dataSource={visibleDiagnostics}
            scroll={{ x: 900 }}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => uiText("admin_ui.latest_events_856fd", { v0: total }),
            }}
            expandable={{
              expandRowByClick: true,
              expandedRowRender: (row: DiagnosticEvent) => {
                const occurredAt = new Date(row.occurredAt).getTime();
                const receivedAt = new Date(row.receivedAt).getTime();
                const receiveDelay = Number.isFinite(occurredAt) && Number.isFinite(receivedAt)
                  ? receivedAt - occurredAt
                  : null;
                const contextItems = Object.entries(row.context ?? {})
                  .filter(([key, value]) => DIAGNOSTIC_CONTEXT_LABELS(uiText)[key] && value != null && value !== "")
                  .map(([key, value]) => ({
                    key: `context-${key}`,
                    label: DIAGNOSTIC_CONTEXT_LABELS(uiText)[key],
                    children: formatDiagnosticValue(key, value, uiText),
                  }));
                return (
                  <Descriptions
                    bordered
                    size="small"
                    column={{ xs: 1, sm: 2, lg: 3 }}
                    items={[
                      { key: "location", label: uiText("admin_ui.branch_63a7c"), children: row.locationId ? locationName(row.locationId) : "—" },
                      {
                        key: "actor",
                        label: row.actorKind === "cashier" ? uiText("admin_ui.selected_staff_member_bb086") : uiText("admin_ui.diagnostics_sender_02077"),
                        children: row.actorLabel
                          ? `${row.actorLabel}${row.actorRole ? ` · ${row.actorRole}` : ""}`
                          : row.actorKind === "device"
                            ? uiText("admin_ui.staff_not_identified_yet_pos_device_event_fa855")
                            : uiText("admin_ui.unknown_user_50474"),
                      },
                      { key: "category", label: uiText("admin_ui.category_f7bae"), children: row.category },
                      { key: "receivedAt", label: uiText("admin_ui.received_by_server_3b9f9"), children: fmtDT(row.receivedAt) },
                      {
                        key: "receiveDelay",
                        label: uiText("admin_ui.difference_from_device_time_2a876"),
                        children: receiveDelay == null ? "—" : `${receiveDelay >= 0 ? "+" : ""}${receiveDelay} ms`,
                      },
                      {
                        key: "correlationId",
                        label: uiText("admin_ui.en_correlation_id_805ca"),
                        children: row.correlationId
                          ? <Typography.Text copyable={{ text: row.correlationId }}>{row.correlationId}</Typography.Text>
                          : "—",
                      },
                      ...contextItems,
                    ]}
                  />
                );
              },
              rowExpandable: (row: DiagnosticEvent) => Boolean(
                row.locationId || row.correlationId || row.receivedAt || Object.keys(row.context ?? {}).length
              ),
            }}
            columns={[
              { title: uiText("admin_ui.time_7a229"), dataIndex: "occurredAt", width: 180, render: fmtDT },
              { title: uiText("admin_ui.register_b16e9"), dataIndex: "deviceId", width: 180, render: deviceLabel },
              {
                title: uiText("admin_ui.events_309c2"),
                dataIndex: "action",
                width: 220,
                render: (value: string, row: DiagnosticEvent) => (
                  <Space size={6} wrap>
                    <Tag color={row.status === "success" ? "green" : row.status === "warning" ? "gold" : row.status === "error" ? "red" : "default"}>
                      {row.status ?? "info"}
                    </Tag>
                    <span>{value}</span>
                  </Space>
                ),
              },
              {
                title: uiText("admin_ui.reason_message_e471e"),
                dataIndex: "message",
                render: (value: string | null, row: DiagnosticEvent) => {
                  const errorCode = row.context?.errorCode;
                  const httpStatus = row.context?.httpStatus;
                  return (
                    <Space direction="vertical" size={0}>
                      <span>{value || "—"}</span>
                      {errorCode != null && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {uiText("admin_ui.en_code_4fc19")} {String(errorCode)}
                          {httpStatus != null ? ` · HTTP ${String(httpStatus)}` : ""}
                        </Typography.Text>
                      )}
                    </Space>
                  );
                },
              },
            ]}
          />
        </Card>
      )}

      {canPins && (
        <Card title={uiText("admin_ui.pos_staff_pins_64a9b")} loading={loading}>
          <Alert closable
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={uiText("admin_ui.staff_without_a_pin_cannot_be_selected_on_6d14b")}
            description={
              <>
                {uiText("admin_ui.pins_identify_staff_at_the_register_only_and_d6af0")}<br />
                <b>{uiText("admin_ui.pos_only_d16c0")}</b>  {uiText("admin_ui.blocks_access_to_04174")} <code>/admin</code>  {uiText("admin_ui.for_that_entire_account_even_with_the_correct_07e8a")} <b>Cashier</b>  {uiText("admin_ui.to_hide_stock_costs_and_reports_4933d")}</>
            }
          />
          <Table
            size="small"
            rowKey="id"
            dataSource={cashiers}
            pagination={false}
            columns={[
              {
                title: uiText("admin_ui.staff_e82d8"),
                render: (_: unknown, c: any) => (
                  <>
                    {c.name || c.email}
                    {c.isPharmacist && <Tag color="blue" style={{ marginLeft: 6 }}>{uiText("admin_ui.pharmacist_87230")}</Tag>}
                  </>
                ),
              },
              {
                title: uiText("admin_ui.en_role_8dca4"),
                dataIndex: "role",
                width: 130,
                render: (v: string | null) => <Tag color={v === "Cashier" ? "gold" : "default"}>{v ?? "—"}</Tag>,
              },
              {
                title: "PIN",
                dataIndex: "hasPin",
                width: 110,
                render: (v: boolean) => (v ? <Tag color="green">{uiText("admin_ui.configured_320aa")}</Tag> : <Tag color="red">{uiText("admin_ui.not_configured_00436")}</Tag>),
              },
              {
                title: uiText("admin_ui.pos_only_d16c0"),
                dataIndex: "posOnly",
                width: 150,
                render: (v: boolean, c: any) =>
                  canStaff ? (
                    <Switch
                      checked={v}
                      disabled={c.role === "Administrator"}
                      onChange={(checked) => void toggleMode(c.id, checked)}
                      checkedChildren={uiText("admin_ui.block_admin_9bdc9")}
                      unCheckedChildren={uiText("admin_ui.allowed_00dd1")}
                    />
                  ) : v ? (
                    <Tag color="green">{uiText("admin_ui.block_admin_9bdc9")}</Tag>
                  ) : (
                    <Tag>{uiText("admin_ui.allowed_00dd1")}</Tag>
                  ),
              },
              {
                title: "",
                width: 200,
                render: (_: unknown, c: any) => (
                  <Space>
                    <Button size="small" onClick={() => { setPinFor({ id: c.id, label: c.name || c.email }); setPinValue(""); }}>
                      {c.hasPin ? uiText("admin_ui.change_pin_ecd74") : uiText("admin_ui.set_pin_23abc")}
                    </Button>
                    {c.hasPin && (
                      <Button
                        size="small"
                        danger
                        onClick={() => { setPinFor({ id: c.id, label: c.name || c.email }); setPinValue(""); void savePin(true); }}
                      >
                        {uiText("admin_ui.clear_6dacc")}</Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={deviceOpen}
        title={editing ? uiText("admin_ui.edit_28072", { v0: editing.code }) : uiText("admin_ui.add_pos_device_6b564")}
        onCancel={() => { setDeviceOpen(false); setEditing(null); }}
        onOk={() => void saveDevice()}
        confirmLoading={saving}
        okText={uiText("admin_ui.save_f658a")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
      >
        {!editing && <LocalExtraDeviceNotice count={devices.length} adding />}
        <Form form={deviceForm} layout="vertical">
          <Form.Item name="code" label={uiText("admin_ui.device_code_dd2d0")} rules={[{ required: true, message: uiText("admin_ui.enter_a_code_ef870") }]}>
            <Input placeholder="POS-01" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label={uiText("admin_ui.device_name_a4393")}>
            <Input placeholder={uiText("admin_ui.front_counter_cashier_3dc0e")} />
          </Form.Item>
          <Form.Item name="locationId" label={uiText("admin_ui.branch_63a7c")} rules={[{ required: true, message: uiText("admin_ui.select_a_branch_7f17c") }]}>
            <Select
              options={locations.map((l: any) => ({
                value: l.id,
                label: `${l.name} (${l.branchCode})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="registeredPosNo"
            label={uiText("admin_ui.device_registration_number_pos_00bd5")}
            extra={uiText("admin_ui.number_printed_on_tax_invoices_obtain_it_from_9649f")}
          >
            <Input placeholder="E030280002A1249" />
          </Form.Item>
          <Form.Item
            name="receiptPrefix"
            label={uiText("admin_ui.receipt_number_prefix_61a25")}
            extra={uiText("admin_ui.prefix_for_this_device_s_receipt_numbers_e_cd6ae")}
          >
            <Input placeholder="T" maxLength={8} />
          </Form.Item>
          <Form.Item
            name="scannerMode"
            label={uiText("admin_ui.bluetooth_hid_scanner_mode_fa9dc")}
            extra={uiText("admin_ui.prefix_mode_is_safer_configure_the_scanner_to_58e5c")}
          >
            <Select
              options={[
                { value: "FOCUS", label: uiText("admin_ui.follow_focus_supports_older_scanners_but_data_may_35d43") },
                { value: "PREFIX", label: uiText("admin_ui.prefix_mode_recommended_f1bca") },
              ]}
            />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item name="scannerPrefixKey" label={uiText("admin_ui.en_prefix_key_0c585")} rules={[{ required: true }]}>
              <Select options={SCANNER_PREFIX_OPTIONS} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="scannerSuffixKey" label={uiText("admin_ui.en_suffix_key_e6363")} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: uiText("admin_ui.en_enter_2b9ec"), label: uiText("admin_ui.en_enter_2b9ec") },
                  { value: "Tab", label: "Tab" },
                ]}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="scannerMaxGapMs" label={uiText("admin_ui.timeout_between_keys_ms_3df59")} rules={[{ required: true }]}>
              <InputNumber min={20} max={1000} step={10} style={{ width: 170 }} />
            </Form.Item>
          </Space>
          <Alert closable
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={uiText("admin_ui.configure_the_same_prefix_on_the_scanner_50d30")}
            description={uiText("admin_ui.the_system_does_not_infer_scans_from_typing_21e47")}
          />
          <Form.Item name="active" label={uiText("admin_ui.active_79476")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(issuedToken)}
        title={uiText("admin_ui.pair_device_2c853", { v0: issued?.device.code ?? "" })}
        onCancel={() => setIssued(null)}
        destroyOnClose
        footer={<Button onClick={() => setIssued(null)}>{uiText("admin_ui.close_96d79")}</Button>}
      >
        <Alert closable
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={uiText("admin_ui.shown_only_once_37b34")}
          description={uiText("admin_ui.the_qr_code_and_token_are_pairing_secrets_abd5a")}
        />
        {issued && <>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            {uiText("admin_ui.android_ios_scan_to_add_the_token_automatically_c9450")}</Typography.Paragraph>
          <Typography.Paragraph>
            {issued.device.name || issued.device.code}  {uiText("admin_ui.branch_3fda4")} {locationName(issued.device.locationId)}
          </Typography.Paragraph>
          {pairingQr ? <>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <QRCode value={pairingQr} size={256} type="svg" bgColor="#ffffff" color="#000000" bordered={false} style={{ padding: 24 }} />
            </div>
            <Typography.Paragraph>
              {uiText("admin_ui.open_the_app_device_settings_scan_pairing_qr_b74c8")}</Typography.Paragraph>
          </> : <Alert closable type="warning" showIcon style={{ marginBottom: 12 }}
            message={uiText("admin_ui.cannot_generate_a_mobile_pairing_qr_yet_e5090")}
            description={uiText("admin_ui.open_the_back_office_over_https_reachable_from_0feac")} />}
        </>}
        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          {uiText("admin_ui.or_open_this_link_on_the_register_paste_e76fb")}</Typography.Paragraph>
        {/* Fixed rows avoid rc-textarea's shared autosize measurement element retaining a secret after close. */}
        <Input.TextArea value={pairUrl} readOnly rows={3} />
        <Button
          type="primary"
          style={{ marginTop: 8 }}
          onClick={() => void copyPairingValue(pairUrl, uiText("admin_ui.link_copied_open_it_on_the_register_a4797"))}
        >
          {uiText("admin_ui.copy_pairing_link_018c2")}</Button>

        <Typography.Paragraph strong style={{ marginTop: 20, marginBottom: 4 }}>
          {uiText("admin_ui.or_copy_only_the_token_into_the_field_1e833")}</Typography.Paragraph>
        <Input.TextArea value={issuedToken ?? ""} readOnly rows={2} />
        <Button
          style={{ marginTop: 8 }}
          onClick={() => void copyPairingValue(issuedToken ?? "", uiText("admin_ui.copied_07bf1"))}
        >
          {uiText("admin_ui.copy_token_3ddbb")}</Button>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {uiText("admin_ui.a_token_is_not_a_web_address_pasting_ccb04")}</Typography.Paragraph>
      </Modal>

      <Modal
        open={Boolean(pinFor) && pinValue !== null}
        title={uiText("admin_ui.set_pin_4e160", { v0: pinFor?.label ?? "" })}
        onCancel={() => { setPinFor(null); setPinValue(""); }}
        onOk={() => void savePin(false)}
        confirmLoading={pinSaving}
        okText={uiText("admin_ui.save_f658a")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
        okButtonProps={{ disabled: !isPosPinValid(pinValue) }}
      >
        <Input.Password
          value={pinValue}
          onChange={(event) => setPinValue(normalizePosPinInput(event.target.value))}
          placeholder={uiText("admin_ui.label_4_8_digits_00c1c")}
          style={{ width: "100%" }}
          inputMode="numeric"
          maxLength={POS_PIN_MAX_LENGTH}
          autoComplete="new-password"
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {uiText("admin_ui.give_the_pin_directly_to_the_staff_member_dd375")}</Typography.Paragraph>
      </Modal>
    </Space>
  );
}
