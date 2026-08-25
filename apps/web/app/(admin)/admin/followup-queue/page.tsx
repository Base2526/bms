'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Button, Space, Alert, message, Typography, Tabs, Row, Col, Card, Statistic, Progress } from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const Q = gql`
  query {
    bmsFollowupQueue(limit: 100) {
      id status nextRunAt retryCount lastResult conversationId ruleId intent messageGoal
      priority maxRetry businessHoursOnly customerName lastMessageAt idleMinutes
      customerLifetimeValue totalOrders score scoreLabel scoreReasons updatedAt
    }
    bmsFollowupHistory(limit: 100) {
      id conversationId ruleId outcome reason messageBody goal createdAt
    }
    bmsFollowupAnalytics(windowDays: 30) {
      windowDays activeJobs pendingJobs sentJobs stoppedJobs failedJobs
      totalHistory sentHistory skippedHistory failedHistory
      repliedAfterFollowup orderedAfterFollowup replyRate orderRate
      avgRetryCount avgIdleMinutesAtSend
      byGoal { key sent replied ordered failed skipped }
      byIntent { key sent replied ordered failed skipped }
      daily { day sent replied ordered failed skipped }
    }
  }
`;
const Q_RETENTION=gql`query { bmsRetentionCases(limit:100){id customerId customerName cohort status rfmSegment recencyDays frequency monetary expectedReturnAt riskScore recommendedChannel recommendedMessageTh recommendedMessageEn recommendedOffer recommendedProductSku reasonTh reasonEn convertedRevenue} bmsRetentionAnalytics{treatmentTotal holdoutTotal treatmentConverted holdoutConverted treatmentRate holdoutRate incrementalLift retentionRevenue} }`;
const M_RUN_NOW = gql`mutation { bmsRunFollowupsNow { scanned sent skipped failed } }`;
const M_REFRESH_RETENTION = gql`mutation { bmsRefreshRetention }`;
const M_RETENTION_STATUS = gql`mutation($id:ID!,$status:BmsRetentionStatus!,$reason:String){bmsTransitionRetentionCase(id:$id,status:$status,reason:$reason){id status}}`;

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", SENT: "green", STOPPED: "default", FAILED: "red",
};
const HISTORY_OUTCOME_COLOR: Record<string, string> = {
  SENT: "green", SKIPPED: "default", FAILED: "red",
};

export default function FollowupQueuePage() {
  const { t, lang } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("followup.manage");
  const canViewRetention=can("retention.view");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("followup.view"),
    fetchPolicy: "cache-and-network",
    pollInterval: 15000,
  });
  const [runNow, { loading: running }] = useMutation(M_RUN_NOW, {
    onCompleted: (d) => {
      const r = d?.bmsRunFollowupsNow;
      message.success(t("admin_followup_queue.run_result", {
        scanned: r?.scanned ?? 0, sent: r?.sent ?? 0, skipped: r?.skipped ?? 0, failed: r?.failed ?? 0,
      }));
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_followup_queue.run_error")),
  });
  const {data:retentionData,loading:retentionLoading,refetch:refetchRetention}=useQuery(Q_RETENTION,{skip:permsLoading||!canViewRetention,fetchPolicy:"cache-and-network",pollInterval:30000});
  const [refreshRetention,{loading:refreshingRetention}]=useMutation(M_REFRESH_RETENTION,{onCompleted:()=>refetchRetention(),onError:(e)=>message.error(e.message)});
  const [setRetentionStatus,{loading:changingRetention}]=useMutation(M_RETENTION_STATUS,{onCompleted:()=>refetchRetention(),onError:(e)=>message.error(e.message)});

  const canViewFollowups = can("followup.view");
  if (!permsLoading && !canViewFollowups && !canViewRetention) {
    return <Alert closable type="warning" showIcon message={t("admin_followup_queue.no_permission")} />;
  }
  if (canViewFollowups && error) return <Alert closable type="error" showIcon message={t("admin_followup_queue.load_error")} description={error.message} />;

  const jobs = data?.bmsFollowupQueue || [];
  const history = data?.bmsFollowupHistory || [];
  const analytics = data?.bmsFollowupAnalytics;
  const topGoals = (analytics?.byGoal || []).slice(0, 4);
  const topIntents = (analytics?.byIntent || []).slice(0, 4);
  const latestDaily = (analytics?.daily || []).slice(-7);
  const retention=retentionData?.bmsRetentionCases||[];
  const retentionAnalytics=retentionData?.bmsRetentionAnalytics;

  const conversationLink = (id: string) => (
    <Link href={`/admin/inbox?c=${id}`} target="_blank">{id.slice(0, 8)}</Link>
  );

  const scoreColor = (label: string) => {
    if (label === "HOT") return "red";
    if (label === "WARM") return "gold";
    return "default";
  };

  const jobColumns = [
    {
      title: t("admin_followup_queue.col_conversation"), dataIndex: "conversationId", key: "conversationId",
      render: (_: string, row: any) => (
        <Space direction="vertical" size={0}>
          {conversationLink(row.conversationId)}
          <Text type="secondary">{row.customerName || t("admin_followup_queue.col_customer_unknown")}</Text>
        </Space>
      ),
    },
    { title: t("admin_followup_queue.col_intent"), dataIndex: "intent", key: "intent" },
    { title: t("admin_followup_queue.col_goal"), dataIndex: "messageGoal", key: "messageGoal" },
    {
      title: "Score", dataIndex: "score", key: "score",
      render: (v: number, row: any) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Tag color={scoreColor(row.scoreLabel)}>{row.scoreLabel}</Tag>
            <Text strong>{v}</Text>
          </Space>
          <Text type="secondary" style={{ maxWidth: 240 }} ellipsis={{ tooltip: (row.scoreReasons || []).join(" · ") }}>
            {(row.scoreReasons || []).join(" · ") || "—"}
          </Text>
        </Space>
      ),
    },
    {
      title: t("admin_followup_queue.col_status"), dataIndex: "status", key: "status",
      render: (v: string) => <Tag color={JOB_STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: t("admin_followup_queue.col_idle"), dataIndex: "idleMinutes", key: "idleMinutes",
      render: (v: number | null) => v == null ? "—" : `${v} ${t("admin_followup_queue.idle_minutes_suffix")}`,
    },
    { title: t("admin_followup_queue.col_next_run"), dataIndex: "nextRunAt", key: "nextRunAt", render: (v: string) => new Date(v).toLocaleString() },
    { title: t("admin_followup_queue.col_retry_count"), dataIndex: "retryCount", key: "retryCount", align: "right" as const },
    { title: t("admin_followup_queue.col_last_result"), dataIndex: "lastResult", key: "lastResult", render: (v: string | null) => v || "—" },
  ];

  const historyColumns = [
    { title: t("admin_followup_queue.col_conversation"), dataIndex: "conversationId", key: "conversationId", render: conversationLink },
    {
      title: t("admin_followup_queue.col_outcome"), dataIndex: "outcome", key: "outcome",
      render: (v: string) => <Tag color={HISTORY_OUTCOME_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: t("admin_followup_queue.col_goal"), dataIndex: "goal", key: "goal" },
    { title: t("admin_followup_queue.col_reason"), dataIndex: "reason", key: "reason", render: (v: string | null) => v || "—" },
    {
      title: t("admin_followup_queue.col_message_body"), dataIndex: "messageBody", key: "messageBody",
      render: (v: string | null) => v ? <Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: v }}>{v}</Text> : "—",
    },
    { title: t("admin_followup_queue.col_created_at"), dataIndex: "createdAt", key: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
  ];
  const retentionColumns=[
    {title:t("admin_followup_queue.retention_customer"),render:(_:any,r:any)=><Space direction="vertical" size={0}><Text strong>{r.customerName}</Text><Text type="secondary">{r.recommendedChannel||"—"} · {r.cohort}</Text></Space>},
    {title:"RFM",render:(_:any,r:any)=><Space direction="vertical" size={0}><Tag color={r.rfmSegment==="AT_RISK"?"red":r.rfmSegment==="CHAMPION"?"gold":"blue"}>{r.rfmSegment}</Tag><Text type="secondary">R {r.recencyDays} · F {r.frequency} · M {Number(r.monetary).toLocaleString()}</Text></Space>},
    {title:t("admin_followup_queue.retention_risk"),dataIndex:"riskScore",render:(v:number)=><Progress percent={v} size="small" status={v>=70?"exception":"normal"}/>},
    {title:t("admin_followup_queue.retention_next_action"),render:(_:any,r:any)=><Space direction="vertical" size={0}><Text>{lang==="en"?r.reasonEn:r.reasonTh}</Text><Text type="secondary">{t("admin_followup_queue.retention_expected_return")}: {r.expectedReturnAt||"—"}</Text><Text type="secondary">{t("admin_followup_queue.retention_product")}: {r.recommendedProductSku||"—"} · {r.recommendedOffer}</Text><Text italic>{lang==="en"?r.recommendedMessageEn:r.recommendedMessageTh}</Text></Space>},
    {title:t("admin_followup_queue.col_status"),dataIndex:"status",render:(v:string)=><Tag>{v}</Tag>},
    {title:t("admin_followup_queue.retention_manage"),render:(_:any,r:any)=>r.cohort==="HOLDOUT"?<Tag>{t("admin_followup_queue.retention_holdout")}</Tag>:<Space>{r.status==="NEW"&&<Button size="small" loading={changingRetention} onClick={()=>setRetentionStatus({variables:{id:r.id,status:"ACCEPTED"}})}>{t("admin_followup_queue.retention_accept")}</Button>}{r.status==="ACCEPTED"&&<Button size="small" type="primary" loading={changingRetention} onClick={()=>setRetentionStatus({variables:{id:r.id,status:"CONTACTED"}})}>{t("admin_followup_queue.retention_contacted")}</Button>}{["NEW","ACCEPTED"].includes(r.status)&&<Button size="small" danger onClick={()=>{const reason=window.prompt(t("admin_followup_queue.retention_dismiss_prompt"));if(reason?.trim())setRetentionStatus({variables:{id:r.id,status:"DISMISSED",reason}})}}>{t("admin_followup_queue.retention_dismiss")}</Button>}</Space>}
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_followup_queue.title")}</Typography.Title>}>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>{t("admin_followup_queue.refresh")}</Button>
          {canManage && (
            <Button type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={() => runNow()}>
              {t("admin_followup_queue.run_now")}
            </Button>
          )}
        </Space>
      </AdminPageHeader>
      {canViewFollowups && <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_followup_queue.schedule_notice")}
      />}
      {canViewFollowups && analytics && (
        <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 16 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title={t("admin_followup_queue.stat_pending_jobs")} value={analytics.pendingJobs} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title={t("admin_followup_queue.stat_reply_rate")} value={analytics.replyRate * 100} suffix="%" precision={1} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title={t("admin_followup_queue.stat_order_rate")} value={analytics.orderRate * 100} suffix="%" precision={1} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title={t("admin_followup_queue.stat_avg_idle")} value={analytics.avgIdleMinutesAtSend ?? 0} suffix={t("admin_followup_queue.stat_minutes_suffix")} precision={0} /></Card>
            </Col>
          </Row>
          <Row gutter={[12, 12]}>
            <Col xs={24} lg={10}>
              <Card title={t("admin_followup_queue.summary_title", { days: analytics.windowDays })}>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Text>{t("admin_followup_queue.summary_counts", { sent: analytics.sentHistory, skipped: analytics.skippedHistory, failed: analytics.failedHistory })}</Text>
                  <Progress percent={Math.round((analytics.replyRate || 0) * 100)} status="active" format={(p) => t("admin_followup_queue.summary_progress_reply", { percent: p ?? 0 })} />
                  <Progress percent={Math.round((analytics.orderRate || 0) * 100)} strokeColor="#52c41a" format={(p) => t("admin_followup_queue.summary_progress_order", { percent: p ?? 0 })} />
                  <Text type="secondary">{t("admin_followup_queue.summary_outcomes", { replied: analytics.repliedAfterFollowup, ordered: analytics.orderedAfterFollowup })}</Text>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={7}>
              <Card title={t("admin_followup_queue.top_goals")}>
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {topGoals.length ? topGoals.map((row: any) => (
                    <div key={row.key}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Text>{row.key}</Text>
                        <Text type="secondary">{t("admin_followup_queue.breakdown_goal", { sent: row.sent, replied: row.replied })}</Text>
                      </Space>
                    </div>
                  )) : <Text type="secondary">{t("admin_followup_queue.no_data")}</Text>}
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={7}>
              <Card title={t("admin_followup_queue.top_intents")}>
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {topIntents.length ? topIntents.map((row: any) => (
                    <div key={row.key}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Text>{row.key}</Text>
                        <Text type="secondary">{t("admin_followup_queue.breakdown_intent", { sent: row.sent, ordered: row.ordered })}</Text>
                      </Space>
                    </div>
                  )) : <Text type="secondary">{t("admin_followup_queue.no_data")}</Text>}
                </Space>
              </Card>
            </Col>
          </Row>
          {!!latestDaily.length && (
            <Card title={t("admin_followup_queue.daily_title")}>
              <Table
                rowKey="day"
                size="small"
                pagination={false}
                dataSource={latestDaily}
                columns={[
                  { title: t("admin_followup_queue.daily_col_day"), dataIndex: "day", key: "day" },
                  { title: t("admin_followup_queue.daily_col_sent"), dataIndex: "sent", key: "sent", align: "right" as const },
                  { title: t("admin_followup_queue.daily_col_replied"), dataIndex: "replied", key: "replied", align: "right" as const },
                  { title: t("admin_followup_queue.daily_col_ordered"), dataIndex: "ordered", key: "ordered", align: "right" as const },
                  { title: t("admin_followup_queue.daily_col_failed"), dataIndex: "failed", key: "failed", align: "right" as const },
                ]}
              />
            </Card>
          )}
        </Space>
      )}
      <Tabs
        items={[
          ...(canViewRetention?[{key:"retention",label:t("admin_followup_queue.tab_retention",{count:retention.length}),children:<Space direction="vertical" size={12} style={{width:"100%"}}><Space><Button type="primary" loading={refreshingRetention} disabled={!can("retention.manage")} onClick={()=>refreshRetention()}>{t("admin_followup_queue.retention_refresh")}</Button></Space>{retentionAnalytics&&<Row gutter={[12,12]}><Col xs={12} lg={6}><Card><Statistic title={t("admin_followup_queue.retention_treatment_rate")} value={retentionAnalytics.treatmentRate*100} suffix="%" precision={1}/></Card></Col><Col xs={12} lg={6}><Card><Statistic title={t("admin_followup_queue.retention_holdout_rate")} value={retentionAnalytics.holdoutRate*100} suffix="%" precision={1}/></Card></Col><Col xs={12} lg={6}><Card><Statistic title={t("admin_followup_queue.retention_lift")} value={retentionAnalytics.incrementalLift*100} suffix=" pp" precision={1}/></Card></Col><Col xs={12} lg={6}><Card><Statistic title={t("admin_followup_queue.retention_revenue")} value={retentionAnalytics.retentionRevenue} suffix="฿" precision={0}/></Card></Col></Row>}<Table rowKey="id" loading={retentionLoading} dataSource={retention} columns={retentionColumns} pagination={{pageSize:20}} scroll={{x:"max-content"}}/></Space>}] : []),
          ...(canViewFollowups ? [{
            key: "queue",
            label: t("admin_followup_queue.tab_queue", { count: jobs.length }),
            children: <Table rowKey="id" loading={loading} dataSource={jobs} columns={jobColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          }, {
            key: "history",
            label: t("admin_followup_queue.tab_history", { count: history.length }),
            children: <Table rowKey="id" loading={loading} dataSource={history} columns={historyColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          }] : []),
        ]}
      />
    </div>
  );
}
