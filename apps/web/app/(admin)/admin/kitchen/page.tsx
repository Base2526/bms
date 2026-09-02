"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Segmented, Space, Spin, Tag, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import {
  countKitchenDishes,
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenElapsedSeconds,
  kitchenUrgency,
  slaForStation,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenSla,
} from "@/lib/bms/kitchenBoard";
import styles from "./page.module.css";

const Q_TICKETS = gql`
  query KitchenBoard($status: String) {
    bmsKitchenTickets(status: $status, limit: 200) {
      id source orderId checkId tableCode tableName roundNo kitchenNote
      station status modifierCodes productSku productName size packQty qty createdAt updatedAt
    }
  }
`;
const Q_SLAS = gql`
  query KitchenBoardSlas { bmsKitchenStationSlas { station warnMinutes lateMinutes } }
`;
// ใบเดียวถือหลายตั๋ว ปุ่มเดียวจึงต้องขยับทั้งชุดในทรานแซกชันเดียว (เหมือนจอครัวของเครื่องขาย)
const M_STATUS = gql`
  mutation MoveKitchenTickets($ids: [ID!]!, $status: String!) {
    bmsUpdateKitchenTicketsStatus(ids: $ids, status: $status) { id status updatedAt }
  }
`;
type Ticket = { id: string; source: string; orderId: string | null; checkId: string | null; tableCode: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; station: string | null; status: string; modifierCodes: string[]; productSku: string; productName: string; size: string; packQty: number | null; qty: number; createdAt: string };
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
  const [station, setStation] = useState("ALL");
  const tickets = useQuery(Q_TICKETS, { variables: { status: null }, pollInterval: 10000, fetchPolicy: "cache-and-network" });
  const [move, moveState] = useMutation(M_STATUS);
  const slas = useQuery(Q_SLAS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  // ตัวนับต้องเดินเอง ไม่ใช่ขยับตอน poll ทุก 10 วินาที
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!permsLoading && !canView) return <Alert type="error" showIcon message={t("admin_kitchen.no_permission")} />;

  const rows: Ticket[] = tickets.data?.bmsKitchenTickets ?? [];
  const stations = ["ALL", ...Array.from(new Set(rows.map((row) => row.station || "UNASSIGNED"))).sort()];
  const visible = station === "ALL" ? rows : rows.filter((row) => (row.station || "UNASSIGNED") === station);

  const slaMap: Record<string, KitchenSla> = Object.fromEntries(
    (slas.data?.bmsKitchenStationSlas ?? []).map((row: any) => [row.station, { warnMinutes: row.warnMinutes, lateMinutes: row.lateMinutes }])
  );

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
    {!canMove && <Alert type="info" showIcon message={t("admin_kitchen.read_only")} />}
    <Space wrap style={{ justifyContent: "space-between" }}>
      <Segmented value={station} onChange={(value) => setStation(String(value))} options={stations.map((value) => ({ value, label: value === "ALL" ? t("admin_kitchen.all_stations") : value }))} />
      <Button icon={<ReloadOutlined />} onClick={() => tickets.refetch()} loading={tickets.loading}>{t("admin_kitchen.refresh")}</Button>
    </Space>
    {tickets.error && <Alert type="error" showIcon message={tickets.error.message} />}
    <Spin spinning={tickets.loading || moveState.loading}>
      <div className={styles.board}>
        {LANES.map((lane) => {
          const groups = allGroups.filter((group) => group.status === lane.status);
          const dishes = groups.reduce((sum, group) => sum + group.totalQty, 0);
          return <section className={styles.lane} style={{ "--lane-color": lane.color } as React.CSSProperties} key={lane.status}>
            <div className={styles.laneHead}><strong>{t(`admin_kitchen.status_${lane.status.toLowerCase()}`)}</strong><Tag>{dishes}</Tag></div>
            {groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_kitchen.empty")} /> : groups.map((group) => {
              const elapsed = kitchenElapsedSeconds(group.referenceAt, now);
              const urgency = kitchenUrgency(elapsed, slaForStation(group.station, slaMap));
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
