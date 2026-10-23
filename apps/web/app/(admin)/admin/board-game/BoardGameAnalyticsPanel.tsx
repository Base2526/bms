"use client";

import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Collapse, Empty, Input, Select, Space, Spin, Switch, Table, Tooltip, Typography, message } from "antd";
import { DownloadOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

const ANALYTICS = gql`
  query BoardGameAnalytics($input: BmsBoardGameAnalyticsInput!) {
    bmsBoardGameAnalytics(input: $input) {
      status code report {
      range { from to granularity } timezone complete truncated
      issues { code message count }
      dataQuality { backfilledBefore hoursConfigured tablesWithoutHours }
      totals {
        availableTableHours occupiedTableHours utilizationPct seatUtilizationPct sessions paidSessions cancelledSessions guests
        avgPlayMinutes turnoverPerTablePerDay grossPlay offerDiscount passCoverage playReturns netPlay tabRevenue tabCost tabGrossProfit
        passSalesRevenue passMinutesUsed revPATH depositsForfeited
        waitlist { entries seated avgWaitMinutes noShow cancelled noShowRatePct }
      }
      byTable { tableId code name areaName locationName seats availableTableHours occupiedTableHours utilizationPct revenue revPATH netPlay tabRevenue tabCost tabGrossProfit }
      byArea { areaId locationId name availableTableHours occupiedTableHours utilizationPct revenue revPATH }
      heatmap { weekday hour occupiedTableHours availableTableHours utilizationPct revenue }
      topOffers { offerId name uses discount }
      library { titlesPlayed { titleId name plays minutes } copiesNeedingAttention purchaseCostTotal }
      }
    }
  }
`;

const BRANCH_HOURS = gql`query BoardGameBranchHours($locationId: ID!) {
  bmsBoardGameBranchHours(locationId: $locationId) { status code hours { weekday opensAt closesAt closed effectiveFrom } }
}`;
const SAVE_HOURS = gql`mutation SaveBoardGameBranchHours($input: BmsUpsertBoardGameBranchHoursInput!) {
  bmsUpsertBoardGameBranchHours(input: $input) { status code locationId effectiveFrom hours { weekday opensAt closesAt closed effectiveFrom } }
}`;
const EXPORT = gql`mutation ExportBoardGameAnalytics($input: BmsGenerateReportInput!) {
  bmsGenerateReport(input: $input) { fileUrl reportType format }
}`;

type Location = { id: string; name: string };
type Area = { id: string; name: string };
type Issue = { code: string; message: string; count: number };
type Analytics = {
  complete: boolean; truncated: boolean; timezone: string; issues: Issue[];
  dataQuality: { backfilledBefore: string | null; hoursConfigured: boolean; tablesWithoutHours: number };
  totals: Record<string, any> & { waitlist: Record<string, any> };
  byTable: Array<Record<string, any>>; byArea: Array<Record<string, any>>;
  heatmap: Array<{ weekday: number; hour: number; occupiedTableHours: number; availableTableHours: number; utilizationPct: number | null; revenue: string }>;
  topOffers: Array<{ offerId: string; name: string; uses: number; discount: string }>;
  library: { titlesPlayed: Array<{ titleId: string; name: string; plays: number; minutes: number }>; copiesNeedingAttention: number; purchaseCostTotal: string | null };
};
type HoursRow = { weekday: number; opensAt: string | null; closesAt: string | null; closed: boolean; effectiveFrom?: string };

const isoDate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const initialTo = isoDate(new Date());
const initialFrom = isoDate(new Date(Date.now() - 29 * 86_400_000));
const defaultHours = (): HoursRow[] => Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "10:00", closesAt: "22:00", closed: false }));

export default function BoardGameAnalyticsPanel(props: {
  locations: Location[]; currentLocationId: string; areas: Area[]; canManageFloor: boolean;
}) {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [locationId, setLocationId] = useState<string>(props.currentLocationId || "ALL");
  const [areaId, setAreaId] = useState<string>("ALL");
  const [effectiveFrom, setEffectiveFrom] = useState(initialTo);
  const [hoursRows, setHoursRows] = useState<HoursRow[]>(defaultHours);
  const [run, { loading, error }] = useLazyQuery<{ bmsBoardGameAnalytics: { status: string; code?: string; report: Analytics | null } }>(ANALYTICS, { fetchPolicy: "network-only" });
  const [snapshot, setSnapshot] = useState<{ key: string; report: Analytics } | null>(null);
  const [hoursLocation, setHoursLocation] = useState<string | null>(null);
  const hoursQuery = useQuery(BRANCH_HOURS, { variables: { locationId }, skip: locationId === "ALL", fetchPolicy: "network-only" });
  const [saveHours, saveState] = useMutation(SAVE_HOURS);
  const [exportReport, exportState] = useMutation(EXPORT);
  useEffect(() => {
    if (hoursQuery.loading || hoursQuery.error || hoursQuery.data?.bmsBoardGameBranchHours?.status !== "OK") return;
    const historical: HoursRow[] = hoursQuery.data.bmsBoardGameBranchHours.hours;
    const latest = new Map<number, HoursRow>();
    for (const row of historical) if (row.effectiveFrom && row.effectiveFrom <= effectiveFrom && !latest.has(row.weekday)) latest.set(row.weekday, row);
    setHoursRows(Array.from({ length: 7 }, (_, weekday) => {
      const row = latest.get(weekday) ?? defaultHours()[weekday];
      return { ...row, opensAt: row.opensAt?.slice(0, 5) ?? null, closesAt: row.closesAt?.slice(0, 5) ?? null };
    }));
    setHoursLocation(locationId);
  }, [hoursQuery.data, hoursQuery.loading, hoursQuery.error, locationId, effectiveFrom]);

  const input = useMemo(() => ({ from, to, locationId: locationId === "ALL" ? null : locationId, areaId: areaId === "ALL" ? null : areaId, granularity: "WEEKDAY_HOUR" }), [from, to, locationId, areaId]);
  const inputKey = JSON.stringify(input);
  const report = snapshot?.key === inputKey && !loading ? snapshot.report : null;
  const load = async () => {
    try {
      const result = (await run({ variables: { input } })).data?.bmsBoardGameAnalytics;
      if (result?.status !== "OK" || !result.report) throw new Error(result?.code ?? t("admin_board_game.analytics_unknown_error"));
      setSnapshot({ key: inputKey, report: result.report });
    } catch (cause) { setSnapshot(null); message.error(cause instanceof Error ? cause.message : t("admin_board_game.analytics_unknown_error")); }
  };
  useEffect(() => { if (props.locations.length) void load(); }, [props.locations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const unavailableReason = report?.issues.map((row) => t(`admin_board_game.analytics_issue_${row.code.toLowerCase()}`, { count: row.count })).join(" · ") || t("admin_board_game.analytics_no_data");
  const number = (value: number | null | undefined, suffix = "") => value == null ? <Tooltip title={unavailableReason}>—</Tooltip> : `${value.toLocaleString(lang, { maximumFractionDigits: 2 })}${suffix}`;
  const money = (value: string | null | undefined) => value == null ? <Tooltip title={unavailableReason}>—</Tooltip> : `฿${Number(value).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const weekday = (value: number) => t(`admin_board_game.analytics_weekday_${value}`);
  const heatHours = [...new Set(report?.heatmap.map((row) => row.hour) ?? [])].sort((a, b) => a - b);
  const heat = new Map(report?.heatmap.map((row) => [`${row.weekday}:${row.hour}`, row]) ?? []);
  const updateHour = (day: number, patch: Partial<HoursRow>) => setHoursRows((rows) => rows.map((row) => row.weekday === day ? { ...row, ...patch } : row));

  const save = async () => {
    try {
      if (hoursQuery.loading || hoursLocation !== locationId) return;
      const saved = await saveHours({ variables: { input: { locationId, effectiveFrom, hours: hoursRows.map(({ weekday, opensAt, closesAt, closed }) => ({ weekday, opensAt: closed ? null : opensAt, closesAt: closed ? null : closesAt, closed })) } } });
      if (saved.data?.bmsUpsertBoardGameBranchHours?.status !== "OK") throw new Error(saved.data?.bmsUpsertBoardGameBranchHours?.code ?? t("admin_board_game.analytics_unknown_error"));
      message.success(t("common.saved")); await hoursQuery.refetch(); await load();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : t("admin_board_game.analytics_unknown_error")); }
  };
  const exportXlsx = async () => {
    try {
      if (!report) return;
      const result = await exportReport({ variables: { input: { reportType: "BOARD_GAME_ANALYTICS", dateFrom: input.from, dateTo: input.to, locationId: input.locationId, areaId: input.areaId, format: "XLSX", includeSummary: false } } });
      const url = result.data?.bmsGenerateReport?.fileUrl; if (url) window.location.assign(url);
    } catch (cause) { message.error(cause instanceof Error ? cause.message : t("admin_board_game.analytics_unknown_error")); }
  };

  const tableColumns = [
    { title: t("admin_board_game.analytics_table"), key: "table", render: (_: unknown, row: any) => `${row.code} · ${row.name}`, sorter: (a: any, b: any) => a.code.localeCompare(b.code) },
    { title: t("admin_board_game.analytics_branch"), dataIndex: "locationName", sorter: (a: any, b: any) => a.locationName.localeCompare(b.locationName) },
    { title: t("admin_board_game.analytics_area"), dataIndex: "areaName", sorter: (a: any, b: any) => a.areaName.localeCompare(b.areaName) },
    { title: t("admin_board_game.analytics_utilization"), render: (_: unknown, row: any) => number(row.utilizationPct, "%"), sorter: (a: any, b: any) => (a.utilizationPct ?? -1) - (b.utilizationPct ?? -1) },
    { title: t("admin_board_game.analytics_occupied_hours"), render: (_: unknown, row: any) => number(row.occupiedTableHours), sorter: (a: any, b: any) => a.occupiedTableHours - b.occupiedTableHours },
    { title: t("admin_board_game.analytics_revenue"), render: (_: unknown, row: any) => money(row.revenue), sorter: (a: any, b: any) => Number(a.revenue) - Number(b.revenue) },
    { title: "RevPATH", render: (_: unknown, row: any) => money(row.revPATH), sorter: (a: any, b: any) => Number(a.revPATH ?? -1) - Number(b.revPATH ?? -1) },
  ];

  return <div className={styles.analytics}>
    <div className={styles.analyticsFilters}>
      <label>{t("admin_board_game.analytics_from")}<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>{t("admin_board_game.analytics_to")}<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>{t("admin_board_game.analytics_branch")}<Select value={locationId} onChange={(value) => { setLocationId(value); setAreaId("ALL"); }} options={[{ value: "ALL", label: t("admin_board_game.analytics_all_branches") }, ...props.locations.map((row) => ({ value: row.id, label: row.name }))]} /></label>
      <label>{t("admin_board_game.analytics_area")}<Select value={areaId} disabled={locationId === "ALL" || locationId !== props.currentLocationId} onChange={setAreaId} options={[{ value: "ALL", label: t("admin_board_game.analytics_all_areas") }, ...props.areas.map((row) => ({ value: row.id, label: row.name }))]} /></label>
      <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{t("admin_board_game.analytics_run")}</Button>
      <Button icon={<DownloadOutlined />} disabled={!report} loading={exportState.loading} onClick={() => void exportXlsx()}>{t("admin_board_game.analytics_export")}</Button>
    </div>

    {error && <Alert closable showIcon type="error" message={error.message} />}
    {loading && !report ? <div className={styles.center}><Spin /></div> : report ? <>
      <Alert closable showIcon type="info" message={t("admin_board_game.analytics_scope_hint")} />
      {report.issues.map((row) => <Alert key={row.code} closable showIcon type={row.code === "COST_HIDDEN" ? "info" : "warning"}
        message={t(`admin_board_game.analytics_issue_${row.code.toLowerCase()}`, { count: row.count, date: report.dataQuality.backfilledBefore ?? "—" })} />)}
      <div className={styles.analyticsKpis}>
        {[
          [t("admin_board_game.analytics_utilization"), number(report.totals.utilizationPct, "%")], ["RevPATH", money(report.totals.revPATH)],
          [t("admin_board_game.analytics_net_play"), money(report.totals.netPlay)], [t("admin_board_game.analytics_tab_revenue"), money(report.totals.tabRevenue)],
          [t("admin_board_game.analytics_tab_profit"), money(report.totals.tabGrossProfit)], [t("admin_board_game.analytics_avg_minutes"), number(report.totals.avgPlayMinutes)],
          [t("admin_board_game.analytics_no_show"), number(report.totals.waitlist.noShowRatePct, "%")],
        ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
      </div>

      <Collapse items={[{ key: "summary", label: t("admin_board_game.analytics_more_metrics"), children: <Table
        size="small" pagination={false} showHeader={false} rowKey="key"
        columns={[{ dataIndex: "label" }, { dataIndex: "value" }]}
        dataSource={[
          ["analytics_available_hours", number(report.totals.availableTableHours)],
          ["analytics_occupied_hours", number(report.totals.occupiedTableHours)],
          ["analytics_seat_utilization", number(report.totals.seatUtilizationPct, "%")],
          ["analytics_sessions", number(report.totals.sessions)],
          ["analytics_guests", number(report.totals.guests)],
          ["analytics_turnover", number(report.totals.turnoverPerTablePerDay)],
          ["analytics_pass_receipts", money(report.totals.passSalesRevenue)],
          ["analytics_pass_minutes", number(report.totals.passMinutesUsed)],
          ["analytics_wait_minutes", number(report.totals.waitlist.avgWaitMinutes)],
          ["analytics_forfeited", money(report.totals.depositsForfeited)],
          ["analytics_library_attention", number(report.library.copiesNeedingAttention)],
          ["analytics_library_cost", money(report.library.purchaseCostTotal)],
        ].map(([key, value]) => ({ key: String(key), label: t(`admin_board_game.${key}`), value }))}
      /> }]} />

      <section className={styles.analyticsSection}>
        <Typography.Title level={4}>{t("admin_board_game.analytics_heatmap")}</Typography.Title>
        <div className={styles.heatmapScroll}><div className={styles.heatmap} style={{ gridTemplateColumns: `90px repeat(${heatHours.length}, minmax(52px, 1fr))` }}>
          <div />{heatHours.map((hour) => <b key={hour}>{String(hour).padStart(2, "0")}:00</b>)}
          {Array.from({ length: 7 }, (_, day) => <div className={styles.heatmapRow} key={day} style={{ gridColumn: `1 / span ${heatHours.length + 1}`, gridTemplateColumns: `90px repeat(${heatHours.length}, minmax(52px, 1fr))` }}>
            <strong>{weekday(day)}</strong>{heatHours.map((hour) => { const cell = heat.get(`${day}:${hour}`); const value = cell?.utilizationPct; return <Tooltip key={hour} title={value == null ? unavailableReason : `${value.toFixed(2)}% · ${cell?.occupiedTableHours.toFixed(2)}h / ${cell?.availableTableHours.toFixed(2)}h`}><div className={styles.heatCell} style={{ backgroundColor: value == null ? "var(--bms-surface-muted, #eef1ef)" : `color-mix(in srgb, #237a57 ${Math.max(8, Math.min(100, value))}%, transparent)` }}>{value == null ? "—" : `${Math.round(value)}%`}</div></Tooltip>; })}
          </div>)}
        </div></div>
      </section>

      <section className={styles.analyticsSection}>
        <Typography.Title level={4}>{t("admin_board_game.analytics_waterfall")}</Typography.Title>
        <div className={styles.waterfall}>
          {[["analytics_gross_play", report.totals.grossPlay], ["analytics_offer_discount", `-${report.totals.offerDiscount}`], ["analytics_pass_coverage", `-${report.totals.passCoverage}`], ["analytics_play_returns", `-${report.totals.playReturns}`], ["analytics_net_play", report.totals.netPlay], ["analytics_tab_revenue", report.totals.tabRevenue], ["analytics_tab_cost", report.totals.tabCost == null ? null : `-${report.totals.tabCost}`]].map(([label, value]) => <div key={label}><span>{t(`admin_board_game.${label}`)}</span><b>{money(value)}</b></div>)}
        </div>
      </section>

      <section className={styles.analyticsSection}><Typography.Title level={4}>{t("admin_board_game.analytics_by_table")}</Typography.Title>
        <div className={styles.tableScroll}><Table rowKey="tableId" size="small" dataSource={report.byTable} columns={tableColumns} pagination={{ pageSize: 20 }} /></div>
      </section>
      <section className={styles.analyticsSection}><Typography.Title level={4}>{t("admin_board_game.analytics_area")}</Typography.Title>
        <Table rowKey={(row) => `${row.locationId}:${row.areaId}`} size="small" dataSource={report.byArea} pagination={{ pageSize: 20 }} columns={[
          { title: t("admin_board_game.analytics_area"), dataIndex: "name" },
          { title: t("admin_board_game.analytics_utilization"), render: (_: unknown, row: any) => number(row.utilizationPct, "%") },
          { title: t("admin_board_game.analytics_revenue"), render: (_: unknown, row: any) => money(row.revenue) },
          { title: "RevPATH", render: (_: unknown, row: any) => money(row.revPATH) },
        ]} />
      </section>
      <div className={styles.analyticsTwoColumns}>
        <section className={styles.analyticsSection}><Typography.Title level={4}>{t("admin_board_game.analytics_top_offers")}</Typography.Title>
          {report.topOffers.length ? <Table rowKey="offerId" size="small" pagination={false} dataSource={report.topOffers} columns={[{ title: t("admin_board_game.offer_name"), dataIndex: "name" }, { title: t("admin_board_game.analytics_uses"), dataIndex: "uses" }, { title: t("admin_board_game.analytics_discount"), render: (_: unknown, row: any) => money(row.discount) }]} /> : <Empty />}
        </section>
        <section className={styles.analyticsSection}><Typography.Title level={4}>{t("admin_board_game.analytics_games")}</Typography.Title>
          {report.library.titlesPlayed.length ? <Table rowKey="titleId" size="small" pagination={false} dataSource={report.library.titlesPlayed.slice(0, 10)} columns={[{ title: t("admin_board_game.game_title"), dataIndex: "name" }, { title: t("admin_board_game.analytics_plays"), dataIndex: "plays" }, { title: t("admin_board_game.analytics_minutes"), dataIndex: "minutes" }]} /> : <Empty />}
        </section>
      </div>
    </> : <Empty description={t("admin_board_game.analytics_no_data")} />}

    {props.canManageFloor && locationId !== "ALL" && <Collapse className={styles.hoursEditor} items={[{ key: "hours", label: t("admin_board_game.analytics_hours_title"), children: <>
      <Alert closable showIcon type="info" message={t("admin_board_game.analytics_hours_hint")} />
      <label className={styles.effectiveDate}>{t("admin_board_game.analytics_effective_from")}<Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
      <div className={styles.hoursGrid}>{hoursRows.map((row) => <div key={row.weekday} className={styles.hoursRow}>
        <strong>{weekday(row.weekday)}</strong><Switch checked={row.closed} onChange={(closed) => updateHour(row.weekday, { closed })} checkedChildren={t("admin_board_game.analytics_closed")} unCheckedChildren={t("admin_board_game.analytics_open")} />
        <Input type="time" disabled={row.closed} value={row.opensAt ?? ""} onChange={(event) => updateHour(row.weekday, { opensAt: event.target.value })} />
        <span>–</span><Input type="time" disabled={row.closed} value={row.closesAt ?? ""} onChange={(event) => updateHour(row.weekday, { closesAt: event.target.value })} />
      </div>)}</div>
      {hoursQuery.error && <Alert closable type="error" message={hoursQuery.error.message} />}
      <Button type="primary" icon={<SaveOutlined />} disabled={hoursQuery.loading || Boolean(hoursQuery.error) || hoursLocation !== locationId} loading={saveState.loading} onClick={() => void save()}>{t("admin_board_game.analytics_save_hours")}</Button>
    </> }]} />}
  </div>;
}
