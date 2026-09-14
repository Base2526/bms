"use client";

import {
  Alert, Button, Descriptions, Empty, Form, Input, InputNumber, List, Modal,
  Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, message,
} from "antd";
import {
  ClockCircleOutlined, DollarOutlined, EditOutlined, PlusOutlined,
  EnvironmentOutlined, ReloadOutlined, StopOutlined, SwapOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

type Location = { id: string; code: string; name: string; active: boolean };
type Rate = {
  id: string; code: string; name: string; customerType: string; pricePerHour: number;
  minimumMinutes: number; roundingMinutes: number; graceMinutes: number; active: boolean; sortOrder: number;
};
type OpenSession = {
  id: string; status: "OPEN" | "CLOSING"; billingMode: "OPEN_ENDED" | "FIXED_DURATION";
  guestCount: number; startedAt: string; expectedEndAt: string | null;
  alertStatus: "NORMAL" | "ENDING_SOON" | "OVERDUE"; amountDue: number;
};
type FloorArea = { id: string; name: string; sortOrder: number };
type FloorTable = {
  id: string; areaId: string; code: string; name: string; seats: number; sortOrder: number;
  blocked: boolean; openSession: OpenSession | null;
};
type Floor = { areas: FloorArea[]; tables: FloorTable[]; openCounts: Record<string, number> };
type Participant = {
  id: string; displayName: string | null; participantType: string; billable: boolean;
  hourlyRate: number; billingGroupNo: number; joinedAt: string; leftAt: string | null;
};
type SessionDetail = OpenSession & {
  tableId: string; locationId: string; endedAt: string | null; currentOrderId: string | null;
  participants: Participant[];
  games: Array<{ id: string; copyId: string; copyCode: string; title: string; status: string; checkedOutAt: string }>;
};
type GameTitle = {
  id: string; title: string; minPlayers: number | null; maxPlayers: number | null;
  typicalMinutes: number | null; difficulty: string | null; language: string | null;
  publicVisible: boolean;
  copies: Array<{ id: string; locationId: string; copyCode: string; status: string; conditionNote: string | null }>;
};
type PublicProfile = {
  locationId: string; publicVisible: boolean; displayName: string; summary: string | null;
  publicAddress: string | null; publicPhone: string | null; openingHours: string | null;
  latitude: number | null; longitude: number | null; publishRates: boolean; publishAvailability: boolean;
};
type MemberOption = { customerId: string; name: string; memberNo: string | null };

const emptyFloor: Floor = { areas: [], tables: [], openCounts: {} };
const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body as T;
}

export default function BoardGamePage() {
  const { t, lang } = useI18n();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canManageSession = can("board_game.session.manage");
  const canManageFloor = can("board_game.floor.manage");
  const canManageRate = can("board_game.rate.manage");
  const canManageLibrary = can("board_game.library.manage");
  const canCancel = can("board_game.session.cancel");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [floor, setFloor] = useState<Floor>(emptyFloor);
  const [rates, setRates] = useState<Rate[]>([]);
  const [library, setLibrary] = useState<GameTitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [openTable, setOpenTable] = useState<FloorTable | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rateModal, setRateModal] = useState<Rate | "new" | null>(null);
  const [areaModal, setAreaModal] = useState(false);
  const [tableModal, setTableModal] = useState(false);
  const [titleModal, setTitleModal] = useState(false);
  const [copyTitle, setCopyTitle] = useState<GameTitle | null>(null);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const notifiedAlerts = useRef(new Set<string>());
  const memberSearchSequence = useRef(0);
  const [openForm] = Form.useForm();
  const [participantForm] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [areaForm] = Form.useForm();
  const [tableForm] = Form.useForm();
  const [titleForm] = Form.useForm();
  const [copyForm] = Form.useForm();
  const [discoveryForm] = Form.useForm();

  const activeRates = useMemo(() => rates.filter((rate) => rate.active), [rates]);
  const availableCopies = useMemo(() => library.flatMap((title) =>
    title.copies.filter((copy) => copy.status === "AVAILABLE").map((copy) => ({
      value: copy.id, label: `${title.title} · ${copy.copyCode}`,
    }))
  ), [library]);

  const refreshBase = useCallback(async () => {
    if (!canManageSession) return;
    const [locationData, rateData] = await Promise.all([
      api<{ locations: Location[] }>("/api/bms/board-game/locations"),
      api<{ rates: Rate[] }>("/api/bms/board-game/rates"),
    ]);
    const activeLocations = locationData.locations.filter((location) => location.active);
    setLocations(activeLocations);
    setRates(rateData.rates);
    setLocationId((current) => activeLocations.some((row) => row.id === current) ? current : activeLocations[0]?.id ?? "");
  }, [canManageSession]);

  const refreshLocation = useCallback(async (selectedLocationId = locationId) => {
    if (!selectedLocationId) return;
    setLoading(true);
    try {
      const [floorData, libraryData] = await Promise.all([
        api<{ floor: Floor }>(`/api/bms/board-game/floor?locationId=${encodeURIComponent(selectedLocationId)}`),
        api<{ titles: GameTitle[] }>(`/api/bms/board-game/library?locationId=${encodeURIComponent(selectedLocationId)}`),
      ]);
      setFloor(floorData.floor);
      setLibrary(libraryData.titles);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_board_game.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [locationId, t]);

  const refreshDiscovery = useCallback(async (selectedLocationId = locationId) => {
    if (!selectedLocationId || !canManageFloor) return;
    const data = await api<{ profile: PublicProfile }>(
      `/api/bms/board-game/discovery?locationId=${encodeURIComponent(selectedLocationId)}`
    );
    discoveryForm.setFieldsValue(data.profile);
  }, [canManageFloor, discoveryForm, locationId]);

  useEffect(() => { void refreshBase().catch((error) => message.error(String(error?.message ?? error))); }, [refreshBase]);
  useEffect(() => { if (locationId) void refreshLocation(locationId); }, [locationId, refreshLocation]);
  useEffect(() => {
    if (locationId && canManageFloor) {
      void refreshDiscovery(locationId).catch((error) => message.error(String(error?.message ?? error)));
    }
  }, [canManageFloor, locationId, refreshDiscovery]);
  useEffect(() => {
    if (!locationId) return;
    const timer = window.setInterval(() => void refreshLocation(locationId), 15_000);
    return () => window.clearInterval(timer);
  }, [locationId, refreshLocation]);
  useEffect(() => {
    const active = new Set<string>();
    for (const table of floor.tables) {
      const session = table.openSession;
      if (!session || session.status !== "OPEN" || session.alertStatus === "NORMAL") continue;
      const signature = `${session.id}:${session.alertStatus}`;
      active.add(signature);
      if (!notifiedAlerts.current.has(signature)) {
        message.warning(
          t("admin_board_game.alert_popup", {
            table: table.name,
            status: t(`admin_board_game.alert_${session.alertStatus.toLowerCase()}`),
          }),
          8
        );
      }
    }
    notifiedAlerts.current = active;
  }, [floor.tables, t]);

  async function refreshDetail(sessionId: string) {
    setDetailLoading(true);
    try {
      const data = await api<{ session: SessionDetail }>(`/api/bms/board-game/sessions/${sessionId}`);
      setDetail(data.session);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_board_game.load_failed"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function searchMemberOptions(rawSearch: string) {
    const search = rawSearch.trim();
    const sequence = ++memberSearchSequence.current;
    if (search.length < 2) {
      setMemberSearching(false);
      return;
    }
    setMemberSearching(true);
    try {
      const data = await api<{ members: MemberOption[] }>(
        `/api/bms/board-game/members?q=${encodeURIComponent(search)}`
      );
      if (sequence !== memberSearchSequence.current) return;
      setMemberOptions((current) => {
        const merged = new Map(current.map((member) => [member.customerId, member]));
        for (const member of data.members) merged.set(member.customerId, member);
        return [...merged.values()];
      });
    } catch (error) {
      if (sequence === memberSearchSequence.current) {
        message.error(error instanceof Error ? error.message : t("admin_board_game.member_search_failed"));
      }
    } finally {
      if (sequence === memberSearchSequence.current) setMemberSearching(false);
    }
  }

  const memberSelectOptions = memberOptions.map((member) => ({
    value: member.customerId,
    label: `${member.memberNo ?? "-"} · ${member.name}`,
  }));

  function showOpen(table: FloorTable) {
    const firstRate = activeRates[0];
    openForm.setFieldsValue({
      billingMode: "OPEN_ENDED", expectedDurationMinutes: 120, alertBeforeMinutes: 15,
      participants: [{ rateId: firstRate?.id, billingGroupNo: 1 }],
    });
    setOpenTable(table);
  }

  async function submitOpen() {
    if (!openTable || !locationId) return;
    const values = await openForm.validateFields();
    await api("/api/bms/board-game/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...values,
        expectedDurationMinutes: values.billingMode === "FIXED_DURATION" ? values.expectedDurationMinutes : null,
        locationId, tableId: openTable.id, idempotencyKey: key("open"),
      }),
    });
    message.success(t("admin_board_game.open_success"));
    setOpenTable(null);
    await refreshLocation();
  }

  async function sessionAction(action: string, body: Record<string, unknown> = {}) {
    if (!detail) return null;
    const data = await api<any>(`/api/bms/board-game/sessions/${detail.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, idempotencyKey: key(action), ...body }),
    });
    await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    return data;
  }

  async function closeForBilling() {
    if (!detail) return;
    const data = await sessionAction("close_for_billing");
    message.success(t("admin_board_game.close_success", { amount: Number(data.billing.amountDue).toFixed(2) }));
  }

  function cancelSession() {
    if (!detail) return;
    let reason = "";
    Modal.confirm({
      title: t("admin_board_game.cancel_title"),
      content: <Input.TextArea autoFocus rows={3} placeholder={t("admin_board_game.cancel_reason")} onChange={(event) => { reason = event.target.value; }} />,
      okText: t("admin_board_game.cancel_confirm"), cancelText: t("common.cancel"), okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) throw new Error(t("admin_board_game.cancel_reason_required"));
        await sessionAction("cancel", { reason });
        setDetail(null);
        message.success(t("admin_board_game.cancel_success"));
      },
    });
  }

  async function addParticipant() {
    const values = await participantForm.validateFields();
    await sessionAction("add_participant", values);
    participantForm.resetFields();
    message.success(t("admin_board_game.participant_added"));
  }

  async function leaveParticipant(participantId: string) {
    await sessionAction("leave_participant", { participantId });
    message.success(t("admin_board_game.participant_left"));
  }

  async function checkoutGame(copyId: string) {
    if (!detail) return;
    await api("/api/bms/board-game/library/loans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkout", sessionId: detail.id, copyId, idempotencyKey: key("checkout") }),
    });
    await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    message.success(t("admin_board_game.game_checked_out"));
  }

  async function returnGame(loanId: string) {
    await api("/api/bms/board-game/library/loans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "return", loanId, idempotencyKey: key("return") }),
    });
    if (detail) await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    message.success(t("admin_board_game.game_returned"));
  }

  async function saveRate() {
    const values = await rateForm.validateFields();
    await api("/api/bms/board-game/rates", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, id: rateModal === "new" ? null : rateModal?.id }),
    });
    setRateModal(null);
    await refreshBase();
    message.success(t("admin_board_game.saved"));
  }

  async function saveFloor(target: "area" | "table") {
    const form = target === "area" ? areaForm : tableForm;
    const values = await form.validateFields();
    await api("/api/bms/board-game/floor", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, locationId, ...values }),
    });
    target === "area" ? setAreaModal(false) : setTableModal(false);
    form.resetFields();
    await refreshLocation();
    message.success(t("admin_board_game.saved"));
  }

  async function saveTitle() {
    const values = await titleForm.validateFields();
    await api("/api/bms/board-game/library", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "title", ...values }),
    });
    setTitleModal(false); titleForm.resetFields(); await refreshLocation(); message.success(t("admin_board_game.saved"));
  }

  async function saveCopy() {
    if (!copyTitle) return;
    const values = await copyForm.validateFields();
    await api("/api/bms/board-game/library", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "copy", titleId: copyTitle.id, locationId, ...values }),
    });
    setCopyTitle(null); copyForm.resetFields(); await refreshLocation(); message.success(t("admin_board_game.saved"));
  }

  async function saveDiscovery() {
    if (!locationId) return;
    const values = await discoveryForm.validateFields();
    const data = await api<{ profile: PublicProfile }>("/api/bms/board-game/discovery", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, locationId }),
    });
    discoveryForm.setFieldsValue(data.profile);
    message.success(t("admin_board_game.discovery_saved"));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      message.error(t("admin_board_game.location_unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        discoveryForm.setFieldsValue({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        message.success(t("admin_board_game.location_set"));
      },
      () => message.error(t("admin_board_game.location_unavailable")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  }

  const locale = lang === "en" ? "en-GB" : "th-TH";
  const time = (value: string | null) => value ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "-";
  const elapsed = (startedAt: string) => Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  const tableStatus = (table: FloorTable) => table.blocked ? "BLOCKED" : table.openSession?.status ?? "AVAILABLE";

  if (permissionsLoading) return <div className={styles.center}><Spin /></div>;
  if (!canManageSession) return <Alert type="error" showIcon closable message={t("common.no_permission")} />;

  return (
    <div className={styles.page}>
      <AdminPageHeader title={t("admin_board_game.title")}>
        <Space wrap>
          <Select value={locationId || undefined} className={styles.locationSelect} placeholder={t("admin_board_game.select_location")}
            options={locations.map((location) => ({ value: location.id, label: location.name }))} onChange={setLocationId} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshLocation()}>{t("common.refresh")}</Button>
        </Space>
      </AdminPageHeader>

      {!locations.length ? <Empty description={t("admin_board_game.no_locations")} /> : (
        <Tabs items={[
          { key: "floor", label: t("admin_board_game.tab_floor"), children: (
            <>
              <div className={styles.metrics}>
                <div><span>{t("admin_board_game.metric_available")}</span><strong>{floor.tables.filter((row) => tableStatus(row) === "AVAILABLE").length}</strong></div>
                <div><span>{t("admin_board_game.metric_playing")}</span><strong>{floor.openCounts.OPEN ?? 0}</strong></div>
                <div><span>{t("admin_board_game.metric_billing")}</span><strong>{floor.openCounts.CLOSING ?? 0}</strong></div>
                <div><span>{t("admin_board_game.metric_alerts")}</span><strong>{floor.tables.filter((row) => ["ENDING_SOON", "OVERDUE"].includes(row.openSession?.alertStatus ?? "")).length}</strong></div>
              </div>
              {floor.areas.map((area) => (
                <section key={area.id} className={styles.area}>
                  <Typography.Title level={4}>{area.name}</Typography.Title>
                  <div className={styles.tableGrid}>
                    {floor.tables.filter((table) => table.areaId === area.id).map((table) => {
                      const session = table.openSession;
                      const status = tableStatus(table);
                      return (
                        <button key={table.id} type="button" className={`${styles.tableCard} ${styles[`status_${status}`]}`}
                          onClick={() => session ? void refreshDetail(session.id) : !table.blocked && showOpen(table)}>
                          <div className={styles.tableTop}><strong>{table.name}</strong><Tag>{table.seats} {t("admin_board_game.seats")}</Tag></div>
                          {!session ? <span>{table.blocked ? t("admin_board_game.blocked") : t("admin_board_game.available")}</span> : (
                            <>
                              <span><ClockCircleOutlined /> {elapsed(session.startedAt)} {t("admin_board_game.minutes")}</span>
                              <span>{session.guestCount} {t("admin_board_game.people")}{session.expectedEndAt ? ` · ${t("admin_board_game.ends_at")} ${time(session.expectedEndAt)}` : ""}</span>
                              {session.alertStatus !== "NORMAL" && <b>{t(`admin_board_game.alert_${session.alertStatus.toLowerCase()}`)}</b>}
                              {session.status === "CLOSING" && <b>฿{session.amountDue.toFixed(2)}</b>}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!floor.areas.length && <Empty description={t("admin_board_game.no_floor")} />}
            </>
          ) },
          { key: "library", label: t("admin_board_game.tab_library"), children: (
            <section className={styles.panel}>
              <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.library_title")}</Typography.Title>
                {canManageLibrary && <Button icon={<PlusOutlined />} type="primary" onClick={() => setTitleModal(true)}>{t("admin_board_game.add_title")}</Button>}
              </div>
              <List dataSource={library} locale={{ emptyText: t("admin_board_game.no_games") }} renderItem={(title) => (
                <List.Item actions={canManageLibrary ? [<Button key="copy" icon={<PlusOutlined />} onClick={() => setCopyTitle(title)}>{t("admin_board_game.add_copy")}</Button>] : []}>
                  <List.Item.Meta title={title.title} description={`${title.minPlayers ?? "-"}-${title.maxPlayers ?? "-"} ${t("admin_board_game.players")} · ${title.typicalMinutes ?? "-"} ${t("admin_board_game.minutes")}`} />
                  <Space wrap>{title.copies.map((copy) => <Tag key={copy.id} color={copy.status === "AVAILABLE" ? "green" : copy.status === "IN_USE" ? "blue" : "orange"}>{copy.copyCode} · {t(`admin_board_game.copy_${copy.status.toLowerCase()}`)}</Tag>)}</Space>
                </List.Item>
              )} />
            </section>
          ) },
          { key: "settings", label: t("admin_board_game.tab_settings"), forceRender: true, children: (
            <div className={styles.settingsGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.rates_title")}</Typography.Title>
                  {canManageRate && <Button icon={<PlusOutlined />} onClick={() => { rateForm.resetFields(); setRateModal("new"); }}>{t("admin_board_game.add_rate")}</Button>}
                </div>
                <Table rowKey="id" size="small" pagination={false} dataSource={rates} columns={[
                  { title: t("admin_board_game.rate_name"), dataIndex: "name" },
                  { title: t("admin_board_game.price_hour"), render: (_, row) => `฿${row.pricePerHour.toFixed(2)}` },
                  { title: t("admin_board_game.rounding"), render: (_, row) => `${row.roundingMinutes} ${t("admin_board_game.minutes")}` },
                  { title: "", render: (_, row) => canManageRate ? <Button aria-label={t("common.edit")} icon={<EditOutlined />} onClick={() => { rateForm.setFieldsValue(row); setRateModal(row); }} /> : null },
                ]} />
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.floor_setup")}</Typography.Title></div>
                <Space wrap>
                  <Button disabled={!canManageFloor} icon={<PlusOutlined />} onClick={() => setAreaModal(true)}>{t("admin_board_game.add_area")}</Button>
                  <Button disabled={!canManageFloor || !floor.areas.length} icon={<PlusOutlined />} onClick={() => setTableModal(true)}>{t("admin_board_game.add_table")}</Button>
                </Space>
              </section>
              {canManageFloor && <section className={`${styles.panel} ${styles.discoveryPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <Typography.Title level={4}>{t("admin_board_game.discovery_title")}</Typography.Title>
                    <Typography.Text type="secondary">{t("admin_board_game.discovery_description")}</Typography.Text>
                  </div>
                  <Button type="link" href="/board-game" target="_blank">{t("admin_board_game.discovery_preview")}</Button>
                </div>
                <Form form={discoveryForm} layout="vertical">
                  <div className={styles.formGrid}>
                    <Form.Item name="displayName" label={t("admin_board_game.discovery_name")}><Input maxLength={120} /></Form.Item>
                    <Form.Item name="publicPhone" label={t("admin_board_game.discovery_phone")}><Input maxLength={40} /></Form.Item>
                    <Form.Item name="openingHours" label={t("admin_board_game.discovery_hours")}><Input maxLength={300} /></Form.Item>
                  </div>
                  <Form.Item name="summary" label={t("admin_board_game.discovery_summary")}><Input.TextArea rows={2} maxLength={500} showCount /></Form.Item>
                  <Form.Item name="publicAddress" label={t("admin_board_game.discovery_address")}><Input maxLength={300} /></Form.Item>
                  <div className={styles.coordinateRow}>
                    <Form.Item name="latitude" label={t("admin_board_game.latitude")}><InputNumber min={-90} max={90} precision={6} /></Form.Item>
                    <Form.Item name="longitude" label={t("admin_board_game.longitude")}><InputNumber min={-180} max={180} precision={6} /></Form.Item>
                    <Button icon={<EnvironmentOutlined />} onClick={useCurrentLocation}>{t("admin_board_game.use_current_location")}</Button>
                  </div>
                  <Space wrap size="large">
                    <Form.Item name="publishRates" valuePropName="checked" label={t("admin_board_game.publish_rates")}><Switch /></Form.Item>
                    <Form.Item name="publishAvailability" valuePropName="checked" label={t("admin_board_game.publish_availability")}><Switch /></Form.Item>
                    <Form.Item name="publicVisible" valuePropName="checked" label={t("admin_board_game.public_visible_location")}><Switch /></Form.Item>
                  </Space>
                  <Alert type="info" showIcon closable message={t("admin_board_game.discovery_privacy")} className={styles.discoveryNotice} />
                  <Button type="primary" onClick={() => void saveDiscovery()}>{t("admin_board_game.save_discovery")}</Button>
                </Form>
              </section>}
            </div>
          ) },
        ]} />
      )}

      <Modal open={Boolean(openTable)} title={t("admin_board_game.open_table", { table: openTable?.name ?? "" })} onCancel={() => setOpenTable(null)} onOk={() => void submitOpen()} okText={t("admin_board_game.open_now")} width={720}>
        <Form form={openForm} layout="vertical">
          <div className={styles.formGrid}>
            <Form.Item name="billingMode" label={t("admin_board_game.billing_mode")} rules={[{ required: true }]}><Select options={[{ value: "OPEN_ENDED", label: t("admin_board_game.open_ended") }, { value: "FIXED_DURATION", label: t("admin_board_game.fixed_duration") }]} /></Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.billingMode !== b.billingMode}>{({ getFieldValue }) => getFieldValue("billingMode") === "FIXED_DURATION" ? <Form.Item name="expectedDurationMinutes" label={t("admin_board_game.duration_minutes")} rules={[{ required: true }]}><InputNumber min={1} max={1440} /></Form.Item> : <div />}</Form.Item>
            <Form.Item name="alertBeforeMinutes" label={t("admin_board_game.alert_before")}><InputNumber min={0} max={120} /></Form.Item>
          </div>
          <Typography.Title level={5}>{t("admin_board_game.participants")}</Typography.Title>
          <Form.List name="participants">{(fields, { add, remove }) => <Space direction="vertical" className={styles.full}>
            {fields.map((field) => <div className={styles.participantRow} key={field.key}>
              <Form.Item {...field} name={[field.name, "displayName"]}><Input placeholder={t("admin_board_game.display_name")} /></Form.Item>
              <Form.Item {...field} name={[field.name, "rateId"]} rules={[{ required: true }]}><Select placeholder={t("admin_board_game.rate_name")} options={activeRates.map((rate) => ({ value: rate.id, label: `${rate.name} · ฿${rate.pricePerHour}` }))} /></Form.Item>
              <Form.Item noStyle shouldUpdate={(previous, current) =>
                previous.participants?.[field.name]?.rateId !== current.participants?.[field.name]?.rateId
              }>{({ getFieldValue }) => activeRates.find((rate) =>
                rate.id === getFieldValue(["participants", field.name, "rateId"])
              )?.customerType === "MEMBER" ? <Form.Item {...field} name={[field.name, "customerId"]}
                rules={[{ required: true, message: t("admin_board_game.member_required") }]}>
                <Select showSearch allowClear filterOption={false} loading={memberSearching}
                  placeholder={t("admin_board_game.member_search")} onSearch={(value) => void searchMemberOptions(value)}
                  options={memberSelectOptions} notFoundContent={t("admin_board_game.member_search_hint")} />
              </Form.Item> : <div />}</Form.Item>
              <Form.Item {...field} name={[field.name, "billingGroupNo"]} initialValue={1}><InputNumber min={1} max={20} addonBefore={t("admin_board_game.bill_group")} /></Form.Item>
              <Button danger disabled={fields.length === 1} onClick={() => remove(field.name)}>{t("common.delete")}</Button>
            </div>)}
            <Button icon={<PlusOutlined />} onClick={() => add({ rateId: activeRates[0]?.id, billingGroupNo: 1 })}>{t("admin_board_game.add_participant")}</Button>
          </Space>}</Form.List>
        </Form>
      </Modal>

      <Modal open={Boolean(detail)} title={detail ? t("admin_board_game.session_title", { table: floor.tables.find((row) => row.id === detail.tableId)?.name ?? "" }) : ""} footer={null} onCancel={() => setDetail(null)} width={820}>
        {detailLoading || !detail ? <Spin /> : <Space direction="vertical" size="large" className={styles.full}>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
            { key: "status", label: t("common.status"), children: <Tag>{t(`admin_board_game.session_${detail.status.toLowerCase()}`)}</Tag> },
            { key: "start", label: t("admin_board_game.started_at"), children: time(detail.startedAt) },
            { key: "end", label: t("admin_board_game.ends_at"), children: time(detail.expectedEndAt) },
            { key: "amount", label: t("admin_board_game.amount_due"), children: `฿${detail.amountDue.toFixed(2)}` },
          ]} />
          <div>
            <Typography.Title level={5}>{t("admin_board_game.participants")}</Typography.Title>
            <List size="small" dataSource={detail.participants} renderItem={(row) => <List.Item actions={detail.status === "OPEN" && !row.leftAt ? [<Button key="leave" onClick={() => void leaveParticipant(row.id)}>{t("admin_board_game.mark_left")}</Button>] : []}>
              <span>{row.displayName || t(`admin_board_game.type_${row.participantType.toLowerCase()}`)} · ฿{row.hourlyRate}/{t("admin_board_game.hour_short")} · {t("admin_board_game.bill_group")} {row.billingGroupNo}</span>
            </List.Item>} />
            {detail.status === "OPEN" && <Form form={participantForm} layout="inline" className={styles.inlineForm} onFinish={() => void addParticipant()}>
              <Form.Item name="displayName"><Input placeholder={t("admin_board_game.display_name")} /></Form.Item>
              <Form.Item name="rateId" rules={[{ required: true }]}><Select className={styles.rateSelect} placeholder={t("admin_board_game.rate_name")} options={activeRates.map((rate) => ({ value: rate.id, label: rate.name }))} /></Form.Item>
              <Form.Item noStyle shouldUpdate={(previous, current) => previous.rateId !== current.rateId}>
                {({ getFieldValue }) => activeRates.find((rate) => rate.id === getFieldValue("rateId"))?.customerType === "MEMBER"
                  ? <Form.Item name="customerId" rules={[{ required: true, message: t("admin_board_game.member_required") }]}>
                    <Select showSearch allowClear filterOption={false} loading={memberSearching}
                      className={styles.memberSelect} placeholder={t("admin_board_game.member_search")}
                      onSearch={(value) => void searchMemberOptions(value)} options={memberSelectOptions}
                      notFoundContent={t("admin_board_game.member_search_hint")} />
                  </Form.Item>
                  : null}
              </Form.Item>
              <Form.Item name="billingGroupNo" initialValue={1}><InputNumber min={1} max={20} /></Form.Item>
              <Button htmlType="submit" icon={<PlusOutlined />}>{t("admin_board_game.add_participant")}</Button>
            </Form>}
          </div>
          <div>
            <Typography.Title level={5}>{t("admin_board_game.games_at_table")}</Typography.Title>
            <List size="small" locale={{ emptyText: t("admin_board_game.no_games_at_table") }} dataSource={detail.games} renderItem={(game) => <List.Item actions={game.status === "CHECKED_OUT" ? [<Button key="return" icon={<SwapOutlined />} onClick={() => void returnGame(game.id)}>{t("admin_board_game.return_game")}</Button>] : []}>{game.title} · {game.copyCode} · {t(`admin_board_game.loan_${game.status.toLowerCase()}`)}</List.Item>} />
            {detail.status === "OPEN" && <Select showSearch optionFilterProp="label" className={styles.gameSelect} placeholder={t("admin_board_game.checkout_game")} options={availableCopies} onSelect={(copyId) => void checkoutGame(copyId)} />}
          </div>
          <Space wrap>
            {detail.status === "OPEN" && <Button type="primary" icon={<DollarOutlined />} onClick={() => void closeForBilling()}>{t("admin_board_game.close_for_billing")}</Button>}
            {detail.status === "CLOSING" && <Button type="primary" icon={<DollarOutlined />} href={`/pos?boardGameSessionId=${encodeURIComponent(detail.id)}`}>{t("admin_board_game.open_pos")}</Button>}
            {canCancel && <Button danger icon={<StopOutlined />} onClick={cancelSession}>{t("admin_board_game.cancel_session")}</Button>}
          </Space>
        </Space>}
      </Modal>

      <Modal open={Boolean(rateModal)} title={t("admin_board_game.rate_editor")} onCancel={() => setRateModal(null)} onOk={() => void saveRate()}>
        <Form form={rateForm} layout="vertical" initialValues={{ customerType: "GENERAL", pricePerHour: 50, minimumMinutes: 60, roundingMinutes: 30, graceMinutes: 0, active: true, sortOrder: 0 }}>
          <Form.Item name="name" label={t("admin_board_game.rate_name")} rules={[{ required: true }]}><Input /></Form.Item>
          <div className={styles.formGrid}><Form.Item name="customerType" label={t("admin_board_game.customer_type")}><Select options={["GENERAL", "STUDENT", "MEMBER", "CHILD", "CUSTOM"].map((value) => ({ value, label: t(`admin_board_game.type_${value.toLowerCase()}`) }))} /></Form.Item><Form.Item name="pricePerHour" label={t("admin_board_game.price_hour")} rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></div>
          <div className={styles.formGrid}><Form.Item name="minimumMinutes" label={t("admin_board_game.minimum_minutes")}><InputNumber min={0} /></Form.Item><Form.Item name="roundingMinutes" label={t("admin_board_game.rounding")}><InputNumber min={1} /></Form.Item><Form.Item name="graceMinutes" label={t("admin_board_game.grace_minutes")}><InputNumber min={0} /></Form.Item></div>
          <Form.Item name="active" label={t("common.active")} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal open={areaModal} title={t("admin_board_game.add_area")} onCancel={() => setAreaModal(false)} onOk={() => void saveFloor("area")}><Form form={areaForm} layout="vertical"><Form.Item name="name" label={t("admin_board_game.area_name")} rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
      <Modal open={tableModal} title={t("admin_board_game.add_table")} onCancel={() => setTableModal(false)} onOk={() => void saveFloor("table")}><Form form={tableForm} layout="vertical" initialValues={{ seats: 4 }}><Form.Item name="areaId" label={t("admin_board_game.area_name")} rules={[{ required: true }]}><Select options={floor.areas.map((area) => ({ value: area.id, label: area.name }))} /></Form.Item><Form.Item name="code" label={t("admin_board_game.table_code")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label={t("admin_board_game.table_name")}><Input /></Form.Item><Form.Item name="seats" label={t("admin_board_game.seats")}><InputNumber min={1} max={100} /></Form.Item></Form></Modal>
      <Modal open={titleModal} title={t("admin_board_game.add_title")} onCancel={() => setTitleModal(false)} onOk={() => void saveTitle()}><Form form={titleForm} layout="vertical"><Form.Item name="title" label={t("admin_board_game.game_title")} rules={[{ required: true }]}><Input /></Form.Item><div className={styles.formGrid}><Form.Item name="minPlayers" label={t("admin_board_game.min_players")}><InputNumber min={1} /></Form.Item><Form.Item name="maxPlayers" label={t("admin_board_game.max_players")}><InputNumber min={1} /></Form.Item><Form.Item name="typicalMinutes" label={t("admin_board_game.typical_minutes")}><InputNumber min={1} /></Form.Item></div><Form.Item name="difficulty" label={t("admin_board_game.difficulty")}><Select allowClear options={["LIGHT", "MEDIUM", "HEAVY", "CUSTOM"].map((value) => ({ value, label: t(`admin_board_game.difficulty_${value.toLowerCase()}`) }))} /></Form.Item><Form.Item name="publicVisible" label={t("admin_board_game.public_visible")} valuePropName="checked"><Switch /></Form.Item></Form></Modal>
      <Modal open={Boolean(copyTitle)} title={t("admin_board_game.add_copy_for", { title: copyTitle?.title ?? "" })} onCancel={() => setCopyTitle(null)} onOk={() => void saveCopy()}><Form form={copyForm} layout="vertical"><Form.Item name="copyCode" label={t("admin_board_game.copy_code")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="purchaseCost" label={t("admin_board_game.purchase_cost")}><InputNumber min={0} /></Form.Item></Form></Modal>
    </div>
  );
}
