"use client";

import { useEffect, useRef, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Drawer, Empty, Space, Spin, Tabs, Tag, Tooltip } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import styles from "./DashboardActions.module.css";

export const Q_ACTION_LIST = gql`
  query DashboardActionList($group: String!, $limit: Int!, $offset: Int!) {
    bmsActions(group: $group, limit: $limit, offset: $offset) {
      id priority title titleEn evidence expectedImpact expectedImpactEn confidence
      ownerName dueAt deepLink status statusReason measuredOutcome
    }
  }
`;
const Q_METRICS = gql`query DashboardActionMetrics { bmsActionMetrics { acceptanceRate completionRate avgTimeToActionMinutes measuredOutcomeCount } }`;
const M_REFRESH = gql`mutation { bmsRefreshActions }`;
const M_TRANSITION = gql`mutation($id: ID!, $status: String!, $reason: String, $measuredOutcome: JSON) {
  bmsTransitionAction(id: $id, status: $status, reason: $reason, measuredOutcome: $measuredOutcome) { id status }
}`;
type Action = {
  id: string; priority: string; title: string; titleEn: string; evidence: unknown;
  expectedImpact: string; expectedImpactEn: string; confidence: number; ownerName: string | null;
  dueAt: string | null; deepLink: string; status: string; statusReason: string | null; measuredOutcome: unknown;
};
const ACTIVE = ["NEW", "ACCEPTED"];
const PRIORITY: Record<string, string> = { CRITICAL: "red", HIGH: "orange", MEDIUM: "blue", LOW: "default" };

export default function DashboardActions({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const { t, lang } = useI18n();
  const label = (key: string) => t(`admin_dashboard.${key}`);
  const [tab, setTab] = useState("NEW");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("ALL");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Action | null>(null);
  const [operationError, setOperationError] = useState(false);
  const preview = useQuery<{ bmsActions: Action[] }>(Q_ACTION_LIST, {
    variables: { group: tab, limit: 3, offset: 0 }, skip: !enabled, notifyOnNetworkStatusChange: true,
  });
  const all = useQuery<{ bmsActions: Action[] }>(Q_ACTION_LIST, {
    variables: { group, limit: 21, offset: page * 20 }, skip: !enabled || !open,
    notifyOnNetworkStatusChange: true, fetchPolicy: "cache-and-network",
  });
  const metrics = useQuery(Q_METRICS, { skip: !enabled || !open, fetchPolicy: "cache-and-network" });
  const [refresh, { loading: refreshing }] = useMutation(M_REFRESH);
  const [transition, { loading: transitioning }] = useMutation(M_TRANSITION);
  const initialized = useRef(false);
  const reload = async () => {
    await preview.refetch();
    if (open) { await all.refetch(); await metrics.refetch(); }
  };
  const refreshSignals = async () => {
    setOperationError(false);
    try { await refresh(); await reload(); } catch { setOperationError(true); }
  };
  useEffect(() => {
    if (!enabled || !canManage || initialized.current) return;
    initialized.current = true;
    void refreshSignals();
  }, [enabled, canManage]);

  const changeAction = async (action: Action, status: string) => {
    if (!canManage || transitioning) return;
    const reason = status === "DISMISSED" ? window.prompt(label("action_reason_prompt")) : null;
    if (status === "DISMISSED" && !reason?.trim()) return;
    const note = status === "COMPLETED" ? window.prompt(label("action_outcome_prompt")) : null;
    if (status === "COMPLETED" && note === null) return;
    setOperationError(false);
    try {
      await transition({ variables: { id: action.id, status, reason,
        measuredOutcome: note?.trim() ? { note: note.trim() } : null } });
      setSelected(null);
      await reload();
    } catch { setOperationError(true); }
  };
  const openList = (next = "ALL") => { setGroup(next); setPage(0); setSelected(null); setOpen(true); };
  const title = (a: Action) => lang === "en" ? a.titleEn : a.title;
  const statusLabel = (status: string) => label(`action_status_${status.toLowerCase()}`);
  const due = (a: Action) => {
    const overdue = ACTIVE.includes(a.status) && a.dueAt && Date.parse(a.dueAt) < Date.now();
    return <span className={overdue ? styles.overdue : undefined}>
      {overdue ? `${label("action_overdue")} · ` : ""}
      {a.dueAt ? new Date(a.dueAt).toLocaleString(lang === "en" ? "en-GB" : "th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : label("action_no_due")}
    </span>;
  };
  const controls = (a: Action) => canManage && ACTIVE.includes(a.status) ? <Space wrap>
    <Button size="small" loading={transitioning} disabled={refreshing}
      onClick={() => void changeAction(a, a.status === "NEW" ? "ACCEPTED" : "COMPLETED")}>
      {label(a.status === "NEW" ? "action_accept" : "action_complete")}
    </Button>
    {selected?.id === a.id ? <Button size="small" danger disabled={transitioning || refreshing}
      onClick={() => void changeAction(a, "DISMISSED")}>{label("action_dismiss")}</Button> : null}
  </Space> : null;
  const details = (a: Action) => { setSelected(a); setOpen(true); };
  const rows = (items: Action[]) => <div className={styles.rows}>
    {items.map(a => <article key={a.id} className={styles.row}>
      <Tag color={PRIORITY[a.priority]}>{label(`action_priority_${a.priority.toLowerCase()}`)}</Tag>
      <button className={styles.taskTitle} onClick={() => details(a)}>{title(a)}</button>
      <div className={styles.owner}><span>{a.ownerName || label("action_unassigned")}</span><small>{due(a)}</small></div>
      <div className={styles.controls}>{!ACTIVE.includes(a.status) ? <Tag>{statusLabel(a.status)}</Tag> : controls(a)}
        <Tooltip title={label("action_details")}><Button size="small" type="text" icon={<RightOutlined />}
          aria-label={`${label("action_details")}: ${title(a)}`} onClick={() => details(a)} /></Tooltip>
      </div>
    </article>)}
  </div>;
  const retryRead = (read: () => Promise<unknown>) => { void read().catch(() => undefined); };
  const failure = (retry: () => void) => <Alert type="error" showIcon closable message={label("action_load_failed")}
    action={<Button size="small" onClick={retry}>{label("action_retry")}</Button>} />;
  const data = metrics.data?.bmsActionMetrics;

  return <section className={styles.section} aria-label={label("action_today")}>
    <div className={styles.heading}><h2>{label("action_today")}</h2><Space>
      {canManage ? <Tooltip title={label("action_refresh")}><Button type="text" icon={<ReloadOutlined />} aria-label={label("action_refresh")}
        loading={refreshing} disabled={transitioning} onClick={() => void refreshSignals()} /></Tooltip> : null}
      <Button type="link" icon={<ArrowRightOutlined />} aria-label={label("action_view_all")} onClick={() => openList()}>{label("action_view_all")}</Button>
    </Space></div>
    <Tabs activeKey={tab} onChange={key => key === "HISTORY" ? openList("HISTORY") : setTab(key)} items={[
      { key: "NEW", label: statusLabel("NEW") }, { key: "ACCEPTED", label: statusLabel("ACCEPTED") },
      { key: "HISTORY", label: label("action_history") },
    ]} />
    {operationError && !open ? failure(() => void refreshSignals()) : null}
    <Spin spinning={preview.loading}>
      {preview.error ? failure(() => retryRead(() => preview.refetch())) : preview.data?.bmsActions.length ? rows(preview.data.bmsActions)
        : !preview.loading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={label("action_none_active")} /> : <div className={styles.loadingSpace} />}
    </Spin>
    <Drawer open={open} onClose={() => { setOpen(false); setSelected(null); }} width={880}
      styles={{ wrapper: { maxWidth: "100vw" } }} title={selected ? label("action_details") : label("action_view_all")}>
      {operationError ? failure(() => { setOperationError(false); void reload().catch(() => setOperationError(true)); }) : null}
      {selected ? <div className={styles.details}>
        <Button type="text" icon={<ArrowLeftOutlined />} aria-label={label("action_back")} onClick={() => setSelected(null)}>{label("action_back")}</Button>
        <h3>{title(selected)}</h3><Tag>{statusLabel(selected.status)}</Tag>
        <p>{selected.ownerName || label("action_unassigned")} · {due(selected)}</p>
        <p>{lang === "en" ? selected.expectedImpactEn : selected.expectedImpact}</p>
        <p>{label("action_confidence")}: {Math.round(selected.confidence * 100)}%</p>
        {selected.statusReason ? <p>{label("action_reason")}: {selected.statusReason}</p> : null}
        <h4>{label("action_evidence")}</h4><pre>{JSON.stringify(selected.evidence, null, 2)}</pre>
        {selected.measuredOutcome ? <><h4>{label("action_result")}</h4><pre>{JSON.stringify(selected.measuredOutcome, null, 2)}</pre></> : null}
        <Space wrap>{controls(selected)}<Link href={selected.deepLink}>{label("action_open_source")} <ArrowRightOutlined /></Link></Space>
      </div> : <>
        <details className={styles.metrics}><summary>{label("action_metrics_30")}</summary>
          {metrics.error ? failure(() => retryRead(() => metrics.refetch())) : metrics.loading ? <Spin /> : data ? <dl>
            <div><dt>{label("metric_acceptance")}</dt><dd>{Math.round(data.acceptanceRate * 100)}%</dd></div>
            <div><dt>{label("metric_completion")}</dt><dd>{Math.round(data.completionRate * 100)}%</dd></div>
            <div><dt>{label("metric_time")}</dt><dd>{Math.round(data.avgTimeToActionMinutes)} {label("action_minutes")}</dd></div>
            <div><dt>{label("metric_outcomes")}</dt><dd>{data.measuredOutcomeCount}</dd></div>
          </dl> : null}
        </details>
        <Tabs activeKey={group} onChange={key => { setGroup(key); setPage(0); }} items={[
          { key: "ALL", label: label("action_all") }, { key: "NEW", label: statusLabel("NEW") },
          { key: "ACCEPTED", label: statusLabel("ACCEPTED") }, { key: "HISTORY", label: label("action_history") },
        ]} />
        <Spin spinning={all.loading}>{all.error ? failure(() => retryRead(() => all.refetch()))
          : all.data?.bmsActions.length ? rows(all.data.bmsActions.slice(0, 20))
            : !all.loading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={label("action_no_results")} /> : null}</Spin>
        <div className={styles.pagination}>
          <Button icon={<ArrowLeftOutlined />} aria-label={label("action_previous")} disabled={page === 0 || all.loading} onClick={() => setPage(value => value - 1)} />
          <span>{label("action_page")} {page + 1}</span>
          <Button icon={<ArrowRightOutlined />} aria-label={label("action_next")} disabled={all.loading || !!all.error || (all.data?.bmsActions.length ?? 0) <= 20} onClick={() => setPage(value => value + 1)} />
        </div>
      </>}
    </Drawer>
  </section>;
}
