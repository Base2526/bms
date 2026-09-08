"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Segmented, Space, Spin, Tag, message } from "antd";
import { ReloadOutlined, SettingOutlined, SoundOutlined, AudioMutedOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import {
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenBoardStationFilters,
  kitchenElapsedSeconds,
  pickReferenceAt,
  kitchenUrgency,
  slaForStationRef,
  ticketMatchesStation,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenSla,
  type KitchenStationFilter,
} from "@/lib/bms/kitchenBoard";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import { useLiveRefresh, usePageVisible } from "@/app/hooks/useLiveRefresh";
import OrderAlertSettingsModal from "@/components/pos/OrderAlertSettingsModal";
import {
  alertPollIntervalMs,
  describeAgo,
  evaluateAlertRepeat,
  feedHealth,
  newAlertIds,
  IDLE_ALERT_REPEAT,
  type AlertKind,
  type AlertRepeatState,
} from "@/lib/pos/orderAlertSound";
import styles from "./page.module.css";

/** จอนี้ไม่มีคิว QR และไม่มีคิวคำขอจากแชท — ไม่ยื่นตัวเลือกที่ตั้งแล้วไม่มีผลบนหน้านี้ */
const KITCHEN_ALERT_KINDS: readonly AlertKind[] = ["ORDER_NEW", "FOOD_READY", "SLA_LATE"] as const;

const Q_TICKETS = gql`
  query KitchenBoard($status: String) {
    bmsKitchenTickets(status: $status, limit: 200) {
      id source orderId checkId tableCode tableName roundNo kitchenNote
      stationId station status modifierCodes productSku productName size packQty qty createdAt updatedAt
    }
  }
`;
const Q_SLAS = gql`
  query KitchenBoardSlas { bmsKitchenStationSlas { station stationId warnMinutes lateMinutes } }
`;
// ทะเบียนสถานี (9.54) — ตัวกรองต้องมาจากที่นี่ ไม่ใช่จาก "สถานีที่บังเอิญมีงานค้างอยู่"
// ครัวที่ว่างต้องยังมีปุ่มของตัวเอง ไม่งั้น "ครัวร้อนไม่มีงาน" อ่านไม่ต่างจาก "ระบบพัง"
// อ่านด้วย product.view ซึ่งบทบาทที่ดูแลแต่ครัวอาจไม่มี → ล้มแล้วตกกลับไปใช้สถานีจากตั๋ว
const Q_STATIONS = gql`
  query KitchenBoardStations { bmsKitchenStations { id name sortOrder } }
`;
// ใบเดียวถือหลายตั๋ว ปุ่มเดียวจึงต้องขยับทั้งชุดในทรานแซกชันเดียว (เหมือนจอครัวของเครื่องขาย)
const M_STATUS = gql`
  mutation MoveKitchenTickets($ids: [ID!]!, $status: String!) {
    bmsUpdateKitchenTicketsStatus(ids: $ids, status: $status) { id status updatedAt }
  }
`;
type Ticket = { id: string; source: string; orderId: string | null; checkId: string | null; tableCode: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; stationId: string | null; station: string | null; status: string; modifierCodes: string[]; productSku: string; productName: string; size: string; packQty: number | null; qty: number; createdAt: string; updatedAt?: string | null };
const LANES = [
  { status: "NEW", color: "#c65b35", next: "PREPARING" },
  { status: "PREPARING", color: "#d89b24", next: "READY" },
  { status: "READY", color: "#358866", next: "SERVED" },
  { status: "SERVED", color: "#60766d", next: null },
] as const;

export default function KitchenPage() {
  const { t, lang } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canView = can("order.view");
  const canMove = can("restaurant.kitchen.update");
  // เก็บ "คีย์" ไม่ใช่ชื่อ — ชื่อเปลี่ยนได้แล้ว (9.54) ถ้าผูกตัวกรองไว้กับชื่อ การแก้ชื่อ
  // สถานีระหว่างกะจะทำให้จอที่กรองอยู่กลายเป็นจอว่างโดยไม่มีใครกดอะไร
  const [stationKey, setStationKey] = useState("ALL");
  // ⚠️ ไม่ใช้ `pollInterval` ของ Apollo แล้ว — มันเป็น timer ธรรมดาที่โดนเบราว์เซอร์หรี่
  // ตอนแท็บถูกซ่อน (Chrome เหลือราว 1 ครั้ง/นาทีเมื่อซ่อนครบ 5 นาที) และไม่มีการโหลดทันที
  // ตอนกลับมามองเห็น · `useLiveRefresh` ทำทั้งสองอย่าง และให้ "เวลาที่โหลดสำเร็จครั้งล่าสุด"
  // มาใช้เป็นป้ายสถานะสายข้อมูลด้วย
  const tickets = useQuery(Q_TICKETS, { variables: { status: null }, fetchPolicy: "cache-and-network" });
  const [move, moveState] = useMutation(M_STATUS);
  const slas = useQuery(Q_SLAS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  const stationsQuery = useQuery(Q_STATIONS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  // ตัวนับต้องเดินเอง ไม่ใช่ขยับตอน poll ทุก 10 วินาที
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // เสียงเตือนของจอนี้ — จอครัวหลังบ้านเคย **ไม่มีเสียงเลย** ทั้งที่ทำงานเดียวกับจอครัว
  // ที่เครื่องขาย · ใช้โมดูลตัวเดียวกันเพื่อไม่ให้สองจอมีพฤติกรรมเสียงคนละชุด
  const alerts = useOrderAlerts();
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const knownNewIds = useRef<Set<string> | null>(null);
  const knownReadyIds = useRef<Set<string> | null>(null);
  const knownLateIds = useRef<Set<string> | null>(null);
  const repeatRef = useRef<AlertRepeatState>(IDLE_ALERT_REPEAT);
  const pageVisible = usePageVisible();
  const pollMs = alertPollIntervalMs({ focused: true, visible: pageVisible });
  const feed = useLiveRefresh({
    enabled: true,
    intervalMs: pollMs,
    // ตรวจของใหม่ **ในรอบ poll เอง** ไม่ใช่ใน useEffect ที่ผูกกับ tickets.data —
    // Apollo คืน object เดิมเมื่อข้อมูลไม่เปลี่ยน effect จึงไม่ทำงาน แล้วการย้ำเสียง
    // (ซึ่งต้องเดินต่อแม้ข้อมูลเท่าเดิม) จะไม่มีวันเกิดขึ้น
    // Apollo `refetch()` รับ AbortSignal ไม่ได้ — ยกเลิกคำขอจริงจึงทำไม่ได้ที่นี่
    // แต่ตัวจับเวลาใน useLiveRefresh ยังปลดด่านกันรอบซ้อนให้ จอจึงไม่ค้างถาวร
    onRefresh: async () => {
      const result = await tickets.refetch();
      const fresh: Ticket[] = result.data?.bmsKitchenTickets ?? [];
      const newIds = fresh.filter((row) => row.status === "NEW").map((row) => row.id);
      if (newAlertIds(knownNewIds.current, newIds).length > 0) alerts.notify("ORDER_NEW");
      knownNewIds.current = new Set(newIds);
      const readyIds = fresh.filter((row) => row.status === "READY").map((row) => row.id);
      if (newAlertIds(knownReadyIds.current, readyIds).length > 0) alerts.notify("FOOD_READY");
      knownReadyIds.current = new Set(readyIds);
      const repeat = evaluateAlertRepeat(repeatRef.current, {
        pending: newIds.length > 0,
        now: Date.now(),
        repeatSeconds: alerts.settings.repeatSeconds,
        maxRepeats: alerts.settings.maxRepeats,
      });
      repeatRef.current = repeat.state;
      if (repeat.play) alerts.notify("ORDER_NEW");
    },
  });
  // ตั๋วที่เพิ่งข้ามเส้นเวลาของสถานีตัวเอง — ดังครั้งเดียวต่อใบ ไม่ใช่ทุกวินาทีหลังจากนั้น
  useEffect(() => {
    const fresh: Ticket[] = tickets.data?.bmsKitchenTickets ?? [];
    const map: Record<string, KitchenSla> = {};
    for (const row of (slas.data?.bmsKitchenStationSlas ?? []) as Array<{ station: string; stationId: string | null; warnMinutes: number; lateMinutes: number }>) {
      const sla = { warnMinutes: row.warnMinutes, lateMinutes: row.lateMinutes };
      map[row.station] = sla;
      if (row.stationId) map[row.stationId] = sla;
    }
    const late = fresh
      .filter((row) => row.status === "NEW" || row.status === "PREPARING")
      .filter((row) => kitchenUrgency(
        kitchenElapsedSeconds(pickReferenceAt(row.status, row.createdAt, row.updatedAt), now),
        slaForStationRef(row, map)
      ) === "late")
      .map((row) => row.id);
    if (newAlertIds(knownLateIds.current, late).length > 0) alerts.notify("SLA_LATE");
    knownLateIds.current = new Set(late);
  }, [tickets.data, slas.data, now, alerts]);
  if (!permsLoading && !canView) return <Alert closable type="error" showIcon message={t("admin_kitchen.no_permission")} />;

  const rows: Ticket[] = tickets.data?.bmsKitchenTickets ?? [];
  const stationFilters = kitchenBoardStationFilters(rows, stationsQuery.data?.bmsKitchenStations ?? []);
  const filterKey = (filter: KitchenStationFilter) => filter.id ?? `name:${filter.name}`;
  const selected = stationFilters.find((filter) => filterKey(filter) === stationKey) ?? null;
  const unassignedTickets = rows.filter((row) => !row.stationId && !row.station);
  // สถานีที่เลือกไว้หายไป (ถูกปิดใช้งาน/งานหมด) = คืนตัวกรองเป็น "ทั้งหมด" ไม่ใช่ปล่อยให้จอ
  // ค้างว่างโดยที่ครัวไม่ได้กดอะไร
  const stationKeyExists = stationKey === "ALL"
    || Boolean(selected)
    || (stationKey === "UNASSIGNED" && unassignedTickets.length > 0);
  const activeKey = stationKeyExists ? stationKey : "ALL";
  const visible = activeKey === "ALL" ? rows
    : activeKey === "UNASSIGNED" ? unassignedTickets
    : rows.filter((row) => ticketMatchesStation(row, selected));

  // แมพเดียวคีย์ทั้งชื่อและ id (9.54): ใบเก่าถือชื่อ ณ เวลาที่ครัวเห็น ส่วนใบใหม่ถือ id
  const slaMap: Record<string, KitchenSla> = {};
  for (const row of (slas.data?.bmsKitchenStationSlas ?? []) as Array<{ station: string; stationId: string | null; warnMinutes: number; lateMinutes: number }>) {
    const sla = { warnMinutes: row.warnMinutes, lateMinutes: row.lateMinutes };
    slaMap[row.station] = sla;
    if (row.stationId) slaMap[row.stationId] = sla;
  }
  const dishesFor = (filter: KitchenStationFilter | null) =>
    rows.filter((row) => ticketMatchesStation(row, filter)).reduce((sum, row) => sum + (Number(row.qty) || 0), 0);

  const allGroups = groupKitchenTickets(visible);
  const health = feedHealth(feed.lastOkAt, now, pollMs);
  const ago = describeAgo(feed.lastOkAt, now);
  const agoLabel = ago === null ? ""
    : ago.unit === "seconds" ? t("pos_alerts.ago_seconds", { seconds: ago.value })
    : t("pos_alerts.ago_minutes", { minutes: ago.value });
  // คีย์เต็มทีละตัว ไม่ประกอบด้วย template — i18n-keys-contract ตรวจคีย์ที่ประกอบตอนรันไม่ได้
  const feedLabel = ago === null ? t("pos_alerts.feed_never")
    : health === "STALE" ? t("pos_alerts.feed_stale", { ago: agoLabel })
    : health === "SLOW" ? t("pos_alerts.feed_slow", { ago: agoLabel })
    : t("pos_alerts.feed_live", { ago: agoLabel });
  const feedTone = health === "STALE" ? "red" : health === "SLOW" ? "orange" : "green";

  async function update(ids: string[], status: string) {
    try {
      await move({ variables: { ids, status } });
      await tickets.refetch();
      message.success(t("admin_kitchen.updated"));
    } catch (error) { message.error(error instanceof Error ? error.message : t("admin_kitchen.update_failed")); }
  }

  return <main className={styles.page}>
    <section className={styles.hero}><h1>{t("admin_kitchen.title")}</h1><p>{t("admin_kitchen.subtitle")}</p></section>
    {!canMove && <Alert closable type="info" showIcon message={t("admin_kitchen.read_only")} />}
    {alerts.blocked && <Alert closable type="warning" showIcon message={t("pos_alerts.blocked_banner")}
      action={<Button size="small" onClick={() => alerts.preview(alerts.settings.tones.ORDER_NEW)}>{t("pos_alerts.blocked_action")}</Button>} />}
    <Space wrap style={{ justifyContent: "space-between" }}>
      <Segmented
        value={activeKey}
        onChange={(value) => setStationKey(String(value))}
        options={[
          { value: "ALL", label: `${t("admin_kitchen.all_stations")} (${rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)})` },
          ...stationFilters.map((filter) => ({
            value: filterKey(filter),
            label: `${filter.name} (${dishesFor(filter)})`,
          })),
          // ปุ่ม "ไม่ระบุสถานี" มีเฉพาะตอนมีของอยู่จริง — ปุ่มที่กดแล้วว่างเปล่าตลอดเวลา
          // สอนให้ครัวเลิกอ่านตัวเลขบนปุ่ม
          ...(unassignedTickets.length > 0
            ? [{
                value: "UNASSIGNED",
                label: `${t("admin_kitchen.unassigned")} (${unassignedTickets.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)})`,
              }]
            : []),
        ]}
      />
      <Space wrap>
        {/* ⚠️ ป้ายนี้อ่านจาก "เวลาที่โหลดสำเร็จครั้งล่าสุด" ไม่ใช่นาฬิกาของเครื่อง —
            จอครัวที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอครัวที่ไม่มีออร์เดอร์เลย */}
        <Tag color={feedTone}>{feedLabel}</Tag>
        <Button
          icon={alerts.settings.enabled ? <SoundOutlined /> : <AudioMutedOutlined />}
          type={alerts.settings.enabled ? "primary" : "default"}
          aria-pressed={alerts.settings.enabled}
          onClick={() => {
            const next = !alerts.settings.enabled;
            alerts.update({ enabled: next });
            // กดเปิดคือ user gesture — เป็นทั้งการทดสอบลำโพงและการปลดล็อกเสียงของเบราว์เซอร์
            if (next) alerts.preview(alerts.settings.tones.ORDER_NEW);
          }}
          title={t("pos_alerts.enabled")} aria-label={t("pos_alerts.enabled")} />
        <Button icon={<SettingOutlined />} onClick={() => setAlertSettingsOpen(true)}
          title={t("pos_alerts.settings")} aria-label={t("pos_alerts.settings")} />
        <Button icon={<ReloadOutlined />} onClick={() => feed.refreshNow()} loading={tickets.loading}>{t("admin_kitchen.refresh")}</Button>
      </Space>
    </Space>
    {tickets.error && <Alert closable type="error" showIcon message={tickets.error.message} />}
    <Spin spinning={tickets.loading || moveState.loading}>
      <div className={styles.board}>
        {LANES.map((lane) => {
          const groups = allGroups.filter((group) => group.status === lane.status);
          const dishes = groups.reduce((sum, group) => sum + group.totalQty, 0);
          return <section className={styles.lane} style={{ "--lane-color": lane.color } as React.CSSProperties} key={lane.status}>
            <div className={styles.laneHead}><strong>{t(`admin_kitchen.status_${lane.status.toLowerCase()}`)}</strong><Tag>{dishes}</Tag></div>
            {groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_kitchen.empty")} /> : groups.map((group) => {
              const elapsed = kitchenElapsedSeconds(group.referenceAt, now);
              const urgency = kitchenUrgency(elapsed, slaForStationRef(group, slaMap));
              const back = PREVIOUS_KITCHEN_STATUS[group.status];
              return <article className={styles.ticket} key={group.key}>
                <div className={styles.ticketMeta}>
                  <strong>{group.tableLabel ?? t("admin_kitchen.dine_in")}</strong>
                  {group.roundNo != null && ` · ${t("admin_kitchen.round")} ${group.roundNo}`}
                  {" · "}{group.station || t("admin_kitchen.unassigned")}
                  {" · "}<Tag color={urgency === "late" ? "red" : urgency === "warn" ? "orange" : undefined}>
                    {formatKitchenElapsed(elapsed)}
                  </Tag>
                </div>
                {group.items.map((item) => <div key={item.key} style={{ marginTop: 6 }}>
                  <span className={styles.ticketName}>{item.qty}× {item.productName}</span>
                  {item.size && item.size !== "-" ? ` · ${item.size}` : ""}
                  {item.modifierCodes.length > 0 && <Space wrap style={{ marginLeft: 8 }}>
                    {item.modifierCodes.map((code) => <Tag color="blue" key={code}>{code}</Tag>)}
                  </Space>}
                  {item.kitchenNote && <div className={styles.ticketMeta}>{t("admin_kitchen.note")}: {item.kitchenNote}</div>}
                </div>)}
                {canMove && <div className={styles.ticketActions}>
                  {lane.next && <Button type="primary" size="small" onClick={() => void update(group.ticketIds, lane.next!)}>
                    {t(`admin_kitchen.move_${lane.next.toLowerCase()}`)}{group.ticketIds.length > 1 ? ` (${group.totalQty})` : ""}
                  </Button>}
                  {back && <Button size="small" onClick={() => void update(group.ticketIds, back)}>{t("admin_kitchen.move_back")}</Button>}
                  {lane.status !== "SERVED" && <Button danger size="small" onClick={() => void update(group.ticketIds, "CANCELLED")}>{t("admin_kitchen.cancel")}</Button>}
                </div>}
              </article>;
            })}
          </section>;
        })}
      </div>
    </Spin>
    <OrderAlertSettingsModal open={alertSettingsOpen} onClose={() => setAlertSettingsOpen(false)}
      alerts={alerts} kinds={KITCHEN_ALERT_KINDS} />
  </main>;
}
