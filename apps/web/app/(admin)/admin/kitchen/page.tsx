"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Segmented, Space, Spin, Tag, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

const Q_TICKETS = gql`
  query KitchenBoard($status: String) {
    bmsKitchenTickets(status: $status, limit: 200) {
      id source orderId checkId tableCode tableName roundNo kitchenNote
      station status modifierCodes productSku productName size packQty qty createdAt updatedAt
    }
  }
`;
const M_STATUS = gql`
  mutation MoveKitchenTicket($id: ID!, $status: String!) {
    bmsUpdateKitchenTicketStatus(id: $id, status: $status) { id status updatedAt }
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
  const canMove = can("order.ship");
  const [station, setStation] = useState("ALL");
  const tickets = useQuery(Q_TICKETS, { variables: { status: null }, pollInterval: 10000, fetchPolicy: "cache-and-network" });
  const [move, moveState] = useMutation(M_STATUS);
  if (!permsLoading && !canView) return <Alert type="error" showIcon message={t("admin_kitchen.no_permission")} />;

  const rows: Ticket[] = tickets.data?.bmsKitchenTickets ?? [];
  const stations = ["ALL", ...Array.from(new Set(rows.map((row) => row.station || "UNASSIGNED"))).sort()];
  const visible = station === "ALL" ? rows : rows.filter((row) => (row.station || "UNASSIGNED") === station);

  async function update(id: string, status: string) {
    try {
      await move({ variables: { id, status } });
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
          const laneRows = visible.filter((row) => row.status === lane.status);
          return <section className={styles.lane} style={{ "--lane-color": lane.color } as React.CSSProperties} key={lane.status}>
            <div className={styles.laneHead}><strong>{t(`admin_kitchen.status_${lane.status.toLowerCase()}`)}</strong><Tag>{laneRows.length}</Tag></div>
            {laneRows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_kitchen.empty")} /> : laneRows.map((ticket) => <article className={styles.ticket} key={ticket.id}>
              <div className={styles.ticketName}>{ticket.productName}</div>
              <div>{ticket.size !== "-" ? `${ticket.size} · ` : ""}× {ticket.packQty ?? ticket.qty}</div>
              <div className={styles.ticketMeta}>{ticket.station || t("admin_kitchen.unassigned")} · {ticket.orderId
                ? `#${ticket.orderId.slice(0, 8)}`
                : `${ticket.tableName || ticket.tableCode || t("admin_kitchen.dine_in")}${ticket.roundNo ? ` · ${t("admin_kitchen.round")} ${ticket.roundNo}` : ""}`} · {new Date(ticket.createdAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
              {ticket.kitchenNote && <div className={styles.ticketMeta}>{t("admin_kitchen.note")}: {ticket.kitchenNote}</div>}
              {ticket.modifierCodes.length > 0 && <Space wrap style={{ marginTop: 8 }}>{ticket.modifierCodes.map((code) => <Tag color="blue" key={code}>{code}</Tag>)}</Space>}
              {canMove && <div className={styles.ticketActions}>
                {lane.next && <Button type="primary" size="small" onClick={() => void update(ticket.id, lane.next!)}>{t(`admin_kitchen.move_${lane.next.toLowerCase()}`)}</Button>}
                {lane.status !== "SERVED" && <Button danger size="small" onClick={() => void update(ticket.id, "CANCELLED")}>{t("admin_kitchen.cancel")}</Button>}
              </div>}
            </article>)}
          </section>;
        })}
      </div>
    </Spin>
  </main>;
}
