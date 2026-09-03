"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Segmented, Space, Spin, Tag, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import {
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenBoardStationFilters,
  kitchenElapsedSeconds,
  kitchenUrgency,
  slaForStationRef,
  ticketMatchesStation,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenSla,
  type KitchenStationFilter,
} from "@/lib/bms/kitchenBoard";
import styles from "./page.module.css";

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
type Ticket = { id: string; source: string; orderId: string | null; checkId: string | null; tableCode: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; stationId: string | null; station: string | null; status: string; modifierCodes: string[]; productSku: string; productName: string; size: string; packQty: number | null; qty: number; createdAt: string };
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
  const tickets = useQuery(Q_TICKETS, { variables: { status: null }, pollInterval: 10000, fetchPolicy: "cache-and-network" });
  const [move, moveState] = useMutation(M_STATUS);
  const slas = useQuery(Q_SLAS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  const stationsQuery = useQuery(Q_STATIONS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  // ตัวนับต้องเดินเอง ไม่ใช่ขยับตอน poll ทุก 10 วินาที
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
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
      <Button icon={<ReloadOutlined />} onClick={() => tickets.refetch()} loading={tickets.loading}>{t("admin_kitchen.refresh")}</Button>
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
  </main>;
}
