"use client";

import { useDeferredValue, useEffect, useState } from "react";
import Link from "next/link";
import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Divider,
  Drawer,
  Empty,
  Grid,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import {
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import styles from "./restock.module.css";
import { useI18n } from "@/lib/i18nContext";

const { Paragraph, Text, Title } = Typography;

const Q_SUBSCRIPTIONS = gql`
  query RestockSubscriptions($status: String, $search: String, $limit: Int, $offset: Int) {
    bmsRestockSubscriptions(status: $status, search: $search, limit: $limit, offset: $offset) {
      total
      items {
        id conversationId customerName channel customerRef productSku productName size requestedQty
        available status source consentedAt readyAt lastNotifiedAt orderedAt resolvedAt
        resolvedOrderId recoveredRevenue createdAt updatedAt
      }
    }
  }
`;

// ยอดรวมจริงต่อสถานะ (ไม่ผูก pagination) — ใช้ทำ tab แทน Statistic 4 กล่องเดิมที่นับจากแค่
// items ของหน้าปัจจุบัน (ผิด scope — กรอง status=READY_TO_NOTIFY แล้วเลขก็ยัง cap ที่ pageSize)
const Q_STATUS_COUNTS = gql`
  query RestockStatusCounts($search: String) {
    bmsRestockStatusCounts(search: $search) { total active readyToNotify notified }
  }
`;

const Q_METRICS = gql`
  query RestockMetrics($search: String) {
    bmsRestockMetrics(search: $search) {
      total
      readyToNotify
      notified
      ordered
      purchased
      sentDeliveries
      failedDeliveries
      recoveredSalesCount
      recoveredCustomersCount
      recoveredOrdersCount
      recoveredRevenue
      notifiedSubscriptions
      recoveredFromNotified
      recoveryRateFromNotified
      recoveryRateOverall
    }
  }
`;

const M_SEND_ALL = gql`
  mutation SendAllReadyRestockNotifications {
    bmsSendAllReadyRestockNotifications { attempted sent failed }
  }
`;

const Q_DELIVERIES = gql`
  query RestockDeliveries($id: ID!) {
    bmsRestockDeliveries(subscriptionId: $id) {
      id attemptNo channel body status inboxMessageId error triggeredBy createdAt completedAt
    }
  }
`;

const M_SEND = gql`
  mutation SendRestockNotification($id: ID!, $body: String!) {
    bmsSendRestockNotification(id: $id, body: $body) {
      status delivered message attemptId
    }
  }
`;

const M_CANCEL = gql`
  mutation CancelRestockSubscription($id: ID!) {
    bmsCancelRestockSubscription(id: $id)
  }
`;

type Subscription = {
  id: string;
  conversationId: string | null;
  customerName: string | null;
  channel: string;
  customerRef: string;
  productSku: string;
  productName: string;
  size: string;
  requestedQty: number;
  available: number;
  status: string;
  source: string;
  consentedAt: string;
  readyAt: string | null;
  lastNotifiedAt: string | null;
  orderedAt: string | null;
  resolvedAt: string | null;
  resolvedOrderId: string | null;
  recoveredRevenue: number | null;
  createdAt: string;
  updatedAt: string;
};

type Delivery = {
  id: string;
  attemptNo: number;
  channel: string;
  body: string;
  status: string;
  error: string | null;
  triggeredBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;
const statusMeta: Record<string, { labelKey: string; color: string }> = {
  ACTIVE: { labelKey: "status_active", color: "default" },
  READY_TO_NOTIFY: { labelKey: "status_ready", color: "orange" },
  NOTIFIED: { labelKey: "status_notified", color: "green" },
  ORDERED: { labelKey: "status_ordered", color: "cyan" },
  PURCHASED: { labelKey: "status_purchased", color: "blue" },
  CANCELLED: { labelKey: "status_cancelled", color: "red" },
  EXPIRED: { labelKey: "status_expired", color: "default" },
};
const statusLabel = (status: string, t: TFn) =>
  statusMeta[status] ? t(`admin_restock.${statusMeta[status].labelKey}`) : status;

const channelLabel: Record<string, string> = {
  line: "LINE",
  facebook: "Facebook",
  instagram: "Instagram",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

// ⚠️ ข้อความนี้ส่งถึง "ลูกค้า" ไม่ใช่ UI ของแอดมิน — คงภาษาไทย (และ ค่ะ) ไว้เสมอ ไม่ผูกกับ
// ภาษา UI ของแอดมิน ตามกฎเดียวกับ suggested reply/brand voice ที่อื่นในระบบ
function suggestedMessage(item: Subscription) {
  return `${item.productName} (${item.productSku}) ไซซ์ ${item.size} เข้ามาแล้วค่ะ ตอนนี้มีพร้อมขาย ${item.available} ชิ้น สนใจให้ทางร้านช่วยสั่งให้ไหมคะ`;
}

function formatRelativeNotified(value: string | null | undefined, t: TFn) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return null;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 1) {
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));
    return t("admin_restock.rel_minutes_ago", { n: diffMinutes });
  }
  if (diffHours < 24) return t("admin_restock.rel_hours_ago", { n: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t("admin_restock.rel_days_ago", { n: diffDays });
}

function formatPercent(value?: number | null) {
  return new Intl.NumberFormat("th-TH", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export default function RestockSubscriptionsPage() {
  const { t } = useI18n();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [status, setStatus] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pageSize = 20;

  useEffect(() => setPage(1), [status, deferredSearch]);

  const { data, loading, refetch } = useQuery(Q_SUBSCRIPTIONS, {
    variables: { status: status || null, search: deferredSearch || null, limit: pageSize, offset: (page - 1) * pageSize },
    fetchPolicy: "cache-and-network",
  });
  const { data: countsData, refetch: refetchCounts } = useQuery(Q_STATUS_COUNTS, {
    variables: { search: deferredSearch || null },
    fetchPolicy: "cache-and-network",
  });
  const [loadMetrics, { data: metricsData, loading: metricsLoading, refetch: refetchMetrics }] = useLazyQuery(Q_METRICS, {
    fetchPolicy: "cache-first",
  });
  const { data: deliveryData, loading: deliveriesLoading, refetch: refetchDeliveries } = useQuery(Q_DELIVERIES, {
    variables: { id: selected?.id || "" },
    skip: !selected,
    fetchPolicy: "cache-and-network",
  });
  const [sendNotification, { loading: sending }] = useMutation(M_SEND);
  const [cancelSubscription, { loading: cancelling }] = useMutation(M_CANCEL);
  const [sendAllReady, { loading: sendingAll }] = useMutation(M_SEND_ALL);

  const items: Subscription[] = data?.bmsRestockSubscriptions?.items ?? [];
  const total = data?.bmsRestockSubscriptions?.total ?? 0;
  const deliveries: Delivery[] = deliveryData?.bmsRestockDeliveries ?? [];
  const counts = countsData?.bmsRestockStatusCounts ?? { total: 0, active: 0, readyToNotify: 0, notified: 0 };
  const metrics = metricsData?.bmsRestockMetrics ?? {
    total: 0,
    readyToNotify: 0,
    notified: 0,
    ordered: 0,
    purchased: 0,
    sentDeliveries: 0,
    failedDeliveries: 0,
    recoveredSalesCount: 0,
    recoveredCustomersCount: 0,
    recoveredOrdersCount: 0,
    recoveredRevenue: 0,
    notifiedSubscriptions: 0,
    recoveredFromNotified: 0,
    recoveryRateFromNotified: 0,
    recoveryRateOverall: 0,
  };

  useEffect(() => {
    const variables = { search: deferredSearch || null };
    const schedule = typeof window !== "undefined" && "requestIdleCallback" in window
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 1200 })
      : (cb: () => void) => window.setTimeout(cb, 0);
    const cancel = typeof window !== "undefined" && "cancelIdleCallback" in window
      ? (id: number) => window.cancelIdleCallback(id)
      : (id: number) => window.clearTimeout(id);
    const id = schedule(() => void loadMetrics({ variables }));
    return () => cancel(id);
  }, [deferredSearch, loadMetrics]);

  const refreshMetrics = () => refetchMetrics
    ? refetchMetrics({ search: deferredSearch || null })
    : loadMetrics({ variables: { search: deferredSearch || null } });

  const statusTabs: Array<{ key: string | undefined; label: string; count: number }> = [
    { key: undefined, label: t("admin_restock.filter_all"), count: counts.total },
    { key: "ACTIVE", label: t("admin_restock.status_active"), count: counts.active },
    { key: "READY_TO_NOTIFY", label: t("admin_restock.status_ready"), count: counts.readyToNotify },
    { key: "NOTIFIED", label: t("admin_restock.status_notified"), count: counts.notified },
    { key: "ORDERED", label: t("admin_restock.status_ordered"), count: metrics.ordered },
  ];

  const onSendAll = async () => {
    try {
      const { data: resultData } = await sendAllReady();
      const result = resultData?.bmsSendAllReadyRestockNotifications;
      if (result) {
        const summary = t("admin_restock.notify_success", { sent: result.sent, attempted: result.attempted })
          + (result.failed ? t("admin_restock.notify_failed_suffix", { failed: result.failed }) : "");
        if (result.failed === 0) message.success(summary);
        else if (result.sent > 0) message.warning(summary);
        else message.error(summary);
      }
      await Promise.all([refetch(), refetchCounts(), refreshMetrics()]);
    } catch (error: any) {
      message.error(error?.message || t("admin_restock.notify_failed"));
    }
  };

  const openSend = (item: Subscription) => {
    setSelected(item);
    const previousBody = item.id === selected?.id ? deliveries[0]?.body : null;
    setDraft(previousBody || suggestedMessage(item));
    setSendOpen(true);
  };

  const onSend = async () => {
    if (!selected) return;
    try {
      const { data: resultData } = await sendNotification({ variables: { id: selected.id, body: draft } });
      const result = resultData?.bmsSendRestockNotification;
      if (result?.delivered) {
        message.success(result.message);
        setSendOpen(false);
      } else {
        message.error(result?.message || t("admin_restock.send_failed"));
      }
      await Promise.all([refetch(), refetchDeliveries(), refetchCounts(), refreshMetrics()]);
    } catch (error: any) {
      message.error(error?.message || t("admin_restock.send_failed"));
    }
  };

  const onCancel = async (item: Subscription) => {
    try {
      const { data: resultData } = await cancelSubscription({ variables: { id: item.id } });
      if (resultData?.bmsCancelRestockSubscription) {
        message.success(t("admin_restock.cancel_success"));
        if (selected?.id === item.id) setSelected(null);
        await Promise.all([refetch(), refetchCounts(), refreshMetrics()]);
      }
    } catch (error: any) {
      message.error(error?.message || t("admin_restock.cancel_failed"));
    }
  };

  const columns = [
    {
      title: t("admin_restock.col_customer"),
      key: "customer",
      render: (_: unknown, item: Subscription) => (
        <Space direction="vertical" size={1}>
          <Text strong>{item.customerName || item.customerRef}</Text>
          <Text type="secondary" className={styles.smallText}>{channelLabel[item.channel] || item.channel}</Text>
        </Space>
      ),
    },
    {
      title: t("admin_restock.col_product"),
      key: "product",
      render: (_: unknown, item: Subscription) => (
        <Space direction="vertical" size={1}>
          <Text strong>{item.productName}</Text>
          <Text type="secondary" className={styles.smallText}>{t("admin_restock.product_meta", { sku: item.productSku, size: item.size, qty: item.requestedQty })}</Text>
        </Space>
      ),
    },
    {
      title: t("admin_restock.col_available"),
      dataIndex: "available",
      width: 100,
      render: (available: number) => <Text strong className={available > 0 ? styles.available : undefined}>{available}</Text>,
    },
    {
      title: t("admin_restock.col_status"),
      dataIndex: "status",
      width: 130,
      render: (value: string) => <Tag color={statusMeta[value]?.color}>{statusLabel(value, t)}</Tag>,
    },
    {
      title: t("admin_restock.col_updated"),
      dataIndex: "updatedAt",
      width: 175,
      render: formatDate,
    },
    {
      title: "",
      key: "actions",
      width: 105,
      render: (_: unknown, item: Subscription) => (
        <Button type="link" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>{t("admin_restock.btn_detail")}</Button>
      ),
    },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.headRow}>
        <div>
          <Title level={3} className={styles.title}>{t("admin_restock.page_title")}</Title>
          <Text type="secondary" className={styles.subtitle}>{t("admin_restock.page_subtitle")}</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { refetch(); refetchCounts(); refreshMetrics(); }} loading={loading || metricsLoading}>{t("admin_restock.btn_refresh")}</Button>
      </div>

      <div className={styles.metricsGrid}>
        <Card className={styles.metricCard}>
          <Text type="secondary" className={styles.metricLabel}>{t("admin_restock.metric_recovered_revenue")}</Text>
          <Title level={3} className={`${styles.metricValue} ${styles.metricGood}`}>{metrics.recoveredRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{t("admin_restock.metric_baht_suffix")}</Title>
          <Text className={styles.metricHint}>{t("admin_restock.metric_recovered_revenue_hint")}</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary" className={styles.metricLabel}>{t("admin_restock.metric_recovered_sales")}</Text>
          <Title level={3} className={styles.metricValue}>{metrics.recoveredSalesCount.toLocaleString("th-TH")}{t("admin_restock.metric_items_suffix")}</Title>
          <Text className={styles.metricHint}>{t("admin_restock.metric_orders_traceable", { n: metrics.recoveredOrdersCount.toLocaleString("th-TH") })}</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary" className={styles.metricLabel}>{t("admin_restock.metric_recovered_customers")}</Text>
          <Title level={3} className={styles.metricValue}>{metrics.recoveredCustomersCount.toLocaleString("th-TH")}{t("admin_restock.metric_customers_suffix")}</Title>
          <Text className={styles.metricHint}>{t("admin_restock.metric_unique_customers_hint")}</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary" className={styles.metricLabel}>{t("admin_restock.metric_notified_to_purchase")}</Text>
          <Title level={3} className={`${styles.metricValue} ${styles.metricPrimary}`}>{formatPercent(metrics.recoveryRateFromNotified)}</Title>
          <Text className={styles.metricHint}>{t("admin_restock.metric_from_subscriptions", { recovered: metrics.recoveredFromNotified.toLocaleString("th-TH"), notified: metrics.notifiedSubscriptions.toLocaleString("th-TH") })}</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary" className={styles.metricLabel}>{t("admin_restock.metric_recovery_rate")}</Text>
          <Title level={3} className={`${styles.metricValue} ${styles.metricPrimary}`}>{formatPercent(metrics.recoveryRateOverall)}</Title>
          <Text className={styles.metricHint}>{t("admin_restock.metric_paid_of_total", { paid: metrics.recoveredSalesCount.toLocaleString("th-TH"), total: metrics.total.toLocaleString("th-TH") })}</Text>
        </Card>
      </div>

      <Alert
        type="success"
        showIcon
        className={styles.metricsAlert}
        message={t("admin_restock.summary_alert", { sent: metrics.sentDeliveries.toLocaleString("th-TH"), customers: metrics.recoveredCustomersCount.toLocaleString("th-TH") })}
        description={t("admin_restock.summary_alert_desc", { ready: metrics.readyToNotify.toLocaleString("th-TH"), failed: metrics.failedDeliveries.toLocaleString("th-TH") })}
      />

      <div className={styles.toolbar}>
        <Input.Search
          allowClear
          placeholder={t("admin_restock.search_placeholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={styles.search}
        />

        <div className={styles.tabs}>
          {statusTabs.map((tab) => (
            <button
              key={tab.key ?? "ALL"}
              type="button"
              className={`${styles.tab} ${status === tab.key ? styles.tabActive : ""}`}
              onClick={() => setStatus(tab.key)}
            >
              {tab.label} <span className={styles.tabCount}>{tab.count.toLocaleString("th-TH")}</span>
            </button>
          ))}
        </div>
      </div>

      {counts.readyToNotify > 0 && (
        <div className={styles.bulkBar}>
          <Text className={styles.bulkText}>{t("admin_restock.bulk_ready_text_1")} <b>{counts.readyToNotify.toLocaleString("th-TH")}</b> {t("admin_restock.bulk_ready_text_2")}</Text>
          <Popconfirm
            title={t("admin_restock.bulk_confirm_title", { count: counts.readyToNotify })}
            description={t("admin_restock.bulk_confirm_desc")}
            onConfirm={onSendAll}
            okText={t("admin_restock.btn_notify_all")}
            cancelText={t("admin_restock.cancel")}
          >
            <Button type="primary" icon={<SendOutlined />} loading={sendingAll}>{t("admin_restock.btn_notify_all")}</Button>
          </Popconfirm>
        </div>
      )}

      <Card className={styles.queueCard}>
        <div className={styles.resultMeta}>
          <Text type="secondary">{t("admin_restock.found_count", { n: total.toLocaleString("th-TH") })}</Text>
        </div>
        {isMobile ? (
          <div className={styles.mobileList}>
            {items.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_restock.empty")} />
            ) : (
              items.map((item) => (
                <button key={item.id} type="button" className={styles.mobileCard} onClick={() => setSelected(item)}>
                  <div className={styles.mobileCardHead}>
                    <div className={styles.mobileCustomerBlock}>
                      <div className={styles.mobileIdentityRow}>
                        <Text strong className={styles.mobileCustomerName}>{item.customerName || item.customerRef}</Text>
                        <Tag className={styles.mobileChannelTag}>{channelLabel[item.channel] || item.channel}</Tag>
                      </div>
                    </div>
                    <span className={`${styles.mobileStatusPill} ${styles[`status${item.status}`] || ""}`}>
                      {statusLabel(item.status, t)}
                    </span>
                  </div>
                  <div className={styles.mobileProductBlock}>
                    <Text strong className={styles.mobileProductName}>{t("admin_restock.mobile_product", { name: item.productName, size: item.size })}</Text>
                    <div className={styles.mobileSummary}>
                      <span>{t("admin_restock.mobile_requested", { qty: item.requestedQty })}</span>
                      <span>{t("admin_restock.mobile_available_1")} <b className={item.available > 0 ? styles.summaryAvailable : undefined}>{item.available}{t("admin_restock.mobile_pieces")}</b></span>
                      {item.status === "NOTIFIED" && item.lastNotifiedAt && (
                        <span>{t("admin_restock.mobile_notified_at", { when: formatRelativeNotified(item.lastNotifiedAt, t) || "" })}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.mobileMetaLine}>
                    <Text type="secondary" className={styles.smallText}>{t("admin_restock.mobile_updated", { when: formatDate(item.updatedAt) })}</Text>
                  </div>
                  <div className={styles.mobileActions}>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>
                      {t("admin_restock.btn_detail")}
                    </Button>
                    {(item.status === "READY_TO_NOTIFY" || item.status === "NOTIFIED") && (
                      <Button
                        type="primary"
                        size="small"
                        onClick={(event) => { event.stopPropagation(); openSend(item); }}
                        disabled={item.available <= 0}
                      >
                        {item.status === "NOTIFIED" ? t("admin_restock.btn_resend") : t("admin_restock.btn_send")}
                      </Button>
                    )}
                    {!(item.status === "READY_TO_NOTIFY" || item.status === "NOTIFIED") && (
                      <Button size="small" disabled>
                        {t("admin_restock.btn_send")}
                      </Button>
                    )}
                  </div>
                </button>
              ))
            )}
            <div className={styles.mobilePagination}>
              <Button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("admin_restock.btn_prev")}</Button>
              <Text className={styles.smallText}>{t("admin_restock.page_indicator", { page, total: Math.max(1, Math.ceil(total / pageSize)) })}</Text>
              <Button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((value) => value + 1)}>{t("admin_restock.btn_next")}</Button>
            </div>
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={loading}
            size="small"
            className={styles.table}
            scroll={{ x: 920 }}
            onRow={(item) => ({ onClick: () => setSelected(item), className: styles.clickableRow })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: setPage,
              showTotal: (value) => t("admin_restock.show_total", { n: value }),
            }}
          />
        )}
      </Card>

      <Drawer
        title={t("admin_restock.drawer_title")}
        width={isMobile ? undefined : 520}
        height={isMobile ? "88vh" : undefined}
        placement={isMobile ? "bottom" : "right"}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        className={styles.drawer}
      >
        {selected && (
          <Space direction="vertical" size={20} className={styles.drawerContent}>
            <div className={styles.detailLead}>
              <Tag color={statusMeta[selected.status]?.color}>{statusLabel(selected.status, t)}</Tag>
              <Title level={4}>{selected.productName}</Title>
              <Text>{t("admin_restock.detail_product_meta", { sku: selected.productSku, size: selected.size, available: selected.available })}</Text>
            </div>

            {selected.status === "READY_TO_NOTIFY" && (
              <Alert type="warning" showIcon message={t("admin_restock.in_stock_alert")} />
            )}

            <Card size="small" title={t("admin_restock.card_customer_consent")}>
              <Paragraph><Text strong>{selected.customerName || selected.customerRef}</Text><br />{channelLabel[selected.channel]}{t("admin_restock.consented_at", { when: formatDate(selected.consentedAt) })}</Paragraph>
              {selected.conversationId && <Link href={`/admin/inbox?c=${selected.conversationId}`}><Button icon={<MessageOutlined />}>{t("admin_restock.btn_open_conversation")}</Button></Link>}
            </Card>

            {selected.resolvedOrderId && (
              <Card size="small" title={t("admin_restock.card_restock_order")}>
                <Paragraph style={{ marginBottom: 8 }}>
                  <Text strong>Order {selected.resolvedOrderId.slice(0, 8)}</Text><br />
                  {t("admin_restock.ordered_at", { when: formatDate(selected.orderedAt) })}
                  {selected.status === "PURCHASED" ? <><br />{t("admin_restock.paid_confirmed_at", { when: formatDate(selected.resolvedAt) })}</> : null}
                </Paragraph>
                {selected.recoveredRevenue != null ? (
                  <Tag color="green">{t("admin_restock.recovered_amount", { amount: selected.recoveredRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2 }) })}</Tag>
                ) : <Tag color="cyan">{t("admin_restock.awaiting_payment")}</Tag>}
              </Card>
            )}

            <div>
              <Title level={5}>{t("admin_restock.delivery_history")}</Title>
              {deliveriesLoading ? <Text type="secondary">{t("admin_restock.loading")}</Text> : deliveries.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_restock.no_deliveries")} />
              ) : (
                <Timeline items={deliveries.map((delivery) => ({
                  color: delivery.status === "SENT" ? "green" : delivery.status === "FAILED" ? "red" : "gray",
                  children: (
                    <div className={styles.attempt}>
                      <Space><Text strong>{t("admin_restock.attempt_no", { n: delivery.attemptNo })}</Text><Tag color={delivery.status === "SENT" ? "green" : "red"}>{delivery.status}</Tag></Space>
                      <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: t("admin_restock.expand_symbol") }}>{delivery.body}</Paragraph>
                      <Text type="secondary" className={styles.smallText}>{formatDate(delivery.completedAt || delivery.createdAt)} · {delivery.triggeredBy || t("admin_restock.triggered_by_system")}</Text>
                      {delivery.error && <Alert className={styles.deliveryError} type="error" showIcon message={delivery.error} />}
                    </div>
                  ),
                }))} />
              )}
            </div>

            <div className={styles.drawerActions}>
              {(selected.status === "READY_TO_NOTIFY" || selected.status === "NOTIFIED") && (
                <Button block={isMobile} type="primary" icon={<SendOutlined />} onClick={() => openSend(selected)} disabled={selected.available <= 0}>
                  {selected.status === "NOTIFIED" ? t("admin_restock.btn_resend_review") : t("admin_restock.btn_review_send")}
                </Button>
              )}
              {!['ORDERED', 'PURCHASED', 'CANCELLED', 'EXPIRED'].includes(selected.status) && (
                <Popconfirm title={t("admin_restock.cancel_confirm_title")} description={t("admin_restock.cancel_confirm_desc")} onConfirm={() => onCancel(selected)}>
                  <Button block={isMobile} danger icon={<StopOutlined />} loading={cancelling}>{t("admin_restock.btn_stop_tracking")}</Button>
                </Popconfirm>
              )}
            </div>
          </Space>
        )}
      </Drawer>

      <Modal
        title={selected?.status === "NOTIFIED" ? t("admin_restock.modal_resend_title") : t("admin_restock.modal_review_title")}
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        okText={selected?.status === "NOTIFIED" ? t("admin_restock.modal_ok_resend") : t("admin_restock.modal_ok_send")}
        cancelText={t("admin_restock.modal_cancel")}
        confirmLoading={sending}
        onOk={onSend}
        width={isMobile ? "calc(100vw - 24px)" : 640}
        style={isMobile ? { top: 12 } : undefined}
        okButtonProps={{ disabled: !draft.trim() || draft.length > 2000 }}
      >
        <Alert
          className={styles.reviewAlert}
          type="info"
          showIcon
          message={t("admin_restock.modal_alert")}
        />
        <Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} maxLength={2000} showCount />
        {selected?.status === "NOTIFIED" && <Text type="warning">{t("admin_restock.resend_warning")}</Text>}
      </Modal>
    </main>
  );
}
