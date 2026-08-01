"use client";

import { useDeferredValue, useEffect, useState } from "react";
import Link from "next/link";
import { gql, useMutation, useQuery } from "@apollo/client";
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

const statusMeta: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "รอสินค้าเข้า", color: "default" },
  READY_TO_NOTIFY: { label: "พร้อมแจ้ง", color: "orange" },
  NOTIFIED: { label: "แจ้งแล้ว", color: "green" },
  ORDERED: { label: "สร้างออเดอร์แล้ว", color: "cyan" },
  PURCHASED: { label: "ซื้อแล้ว", color: "blue" },
  CANCELLED: { label: "ยกเลิก", color: "red" },
  EXPIRED: { label: "หมดอายุ", color: "default" },
};

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

function suggestedMessage(item: Subscription) {
  return `${item.productName} (${item.productSku}) ไซซ์ ${item.size} เข้ามาแล้วค่ะ ตอนนี้มีพร้อมขาย ${item.available} ชิ้น สนใจให้ทางร้านช่วยสั่งให้ไหมคะ`;
}

function formatRelativeNotified(value?: string | null) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return null;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 1) {
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));
    return `${diffMinutes} นาทีที่แล้ว`;
  }
  if (diffHours < 24) return `${diffHours} ชม.ที่แล้ว`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} วันที่แล้ว`;
}

function formatPercent(value?: number | null) {
  return new Intl.NumberFormat("th-TH", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export default function RestockSubscriptionsPage() {
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
  const { data: metricsData, refetch: refetchMetrics } = useQuery(Q_METRICS, {
    variables: { search: deferredSearch || null },
    fetchPolicy: "cache-and-network",
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

  const statusTabs: Array<{ key: string | undefined; label: string; count: number }> = [
    { key: undefined, label: "ทั้งหมด", count: counts.total },
    { key: "ACTIVE", label: "รอสินค้าเข้า", count: counts.active },
    { key: "READY_TO_NOTIFY", label: "พร้อมแจ้ง", count: counts.readyToNotify },
    { key: "NOTIFIED", label: "แจ้งแล้ว", count: counts.notified },
    { key: "ORDERED", label: "สร้างออเดอร์แล้ว", count: metrics.ordered },
  ];

  const onSendAll = async () => {
    try {
      const { data: resultData } = await sendAllReady();
      const result = resultData?.bmsSendAllReadyRestockNotifications;
      if (result) {
        message.success(`แจ้งลูกค้าสำเร็จ ${result.sent} จาก ${result.attempted} รายการ${result.failed ? ` (ล้มเหลว ${result.failed})` : ""}`);
      }
      await Promise.all([refetch(), refetchCounts(), refetchMetrics()]);
    } catch (error: any) {
      message.error(error?.message || "แจ้งลูกค้าไม่สำเร็จ");
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
        message.error(result?.message || "ส่งข้อความไม่สำเร็จ");
      }
      await Promise.all([refetch(), refetchDeliveries(), refetchCounts(), refetchMetrics()]);
    } catch (error: any) {
      message.error(error?.message || "ส่งข้อความไม่สำเร็จ");
    }
  };

  const onCancel = async (item: Subscription) => {
    try {
      const { data: resultData } = await cancelSubscription({ variables: { id: item.id } });
      if (resultData?.bmsCancelRestockSubscription) {
        message.success("ยกเลิกรายการแจ้งเตือนแล้ว");
        if (selected?.id === item.id) setSelected(null);
        await Promise.all([refetch(), refetchCounts(), refetchMetrics()]);
      }
    } catch (error: any) {
      message.error(error?.message || "ยกเลิกไม่สำเร็จ");
    }
  };

  const columns = [
    {
      title: "ลูกค้า",
      key: "customer",
      render: (_: unknown, item: Subscription) => (
        <Space direction="vertical" size={1}>
          <Text strong>{item.customerName || item.customerRef}</Text>
          <Text type="secondary" className={styles.smallText}>{channelLabel[item.channel] || item.channel}</Text>
        </Space>
      ),
    },
    {
      title: "สินค้าที่รอ",
      key: "product",
      render: (_: unknown, item: Subscription) => (
        <Space direction="vertical" size={1}>
          <Text strong>{item.productName}</Text>
          <Text type="secondary" className={styles.smallText}>{item.productSku} · ไซซ์ {item.size} · ต้องการ {item.requestedQty}</Text>
        </Space>
      ),
    },
    {
      title: "พร้อมขาย",
      dataIndex: "available",
      width: 100,
      render: (available: number) => <Text strong className={available > 0 ? styles.available : undefined}>{available}</Text>,
    },
    {
      title: "สถานะ",
      dataIndex: "status",
      width: 130,
      render: (value: string) => <Tag color={statusMeta[value]?.color}>{statusMeta[value]?.label || value}</Tag>,
    },
    {
      title: "อัปเดตล่าสุด",
      dataIndex: "updatedAt",
      width: 175,
      render: formatDate,
    },
    {
      title: "",
      key: "actions",
      width: 105,
      render: (_: unknown, item: Subscription) => (
        <Button type="link" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>ดูรายละเอียด</Button>
      ),
    },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.headRow}>
        <div>
          <Title level={3} className={styles.title}>แจ้งลูกค้าเมื่อสินค้าเข้า</Title>
          <Text type="secondary" className={styles.subtitle}>ติดตามความต้องการที่ลูกค้ายืนยันไว้ แล้วแจ้งได้ทันทีที่พร้อมขาย</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { refetch(); refetchCounts(); refetchMetrics(); }} loading={loading}>รีเฟรช</Button>
      </div>

      <div className={styles.metricsGrid}>
        <Card className={styles.metricCard}>
          <Text type="secondary">มูลค่าที่กู้กลับมา</Text>
          <Title level={3} className={styles.metricValue}>{metrics.recoveredRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</Title>
          <Text className={styles.metricHint}>ยอดสินค้าในออเดอร์ที่ผูกกับ restock โดยตรง</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary">กู้ยอดขายกลับมาได้</Text>
          <Title level={3} className={styles.metricValue}>{metrics.recoveredSalesCount.toLocaleString("th-TH")} รายการ</Title>
          <Text className={styles.metricHint}>{metrics.recoveredOrdersCount.toLocaleString("th-TH")} ออเดอร์ที่ตรวจสอบย้อนกลับได้</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary">ลูกค้าที่ปิดการขายกลับมา</Text>
          <Title level={3} className={styles.metricValue}>{metrics.recoveredCustomersCount.toLocaleString("th-TH")} ราย</Title>
          <Text className={styles.metricHint}>นับลูกค้าไม่ซ้ำจาก queue นี้</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary">แจ้งแล้ว → ซื้อกลับมา</Text>
          <Title level={3} className={styles.metricValue}>{formatPercent(metrics.recoveryRateFromNotified)}</Title>
          <Text className={styles.metricHint}>{metrics.recoveredFromNotified.toLocaleString("th-TH")} จาก {metrics.notifiedSubscriptions.toLocaleString("th-TH")} subscription ที่ส่งแจ้งสำเร็จ</Text>
        </Card>
        <Card className={styles.metricCard}>
          <Text type="secondary">Recovery rate รวม</Text>
          <Title level={3} className={styles.metricValue}>{formatPercent(metrics.recoveryRateOverall)}</Title>
          <Text className={styles.metricHint}>ชำระสำเร็จ {metrics.recoveredSalesCount.toLocaleString("th-TH")} จากทั้งหมด {metrics.total.toLocaleString("th-TH")}</Text>
        </Card>
      </div>

      <Alert
        type="success"
        showIcon
        className={styles.metricsAlert}
        message={`Restock queue นี้ส่งแจ้งสำเร็จ ${metrics.sentDeliveries.toLocaleString("th-TH")} ครั้ง และกู้ลูกค้ากลับมาปิดการขายได้ ${metrics.recoveredCustomersCount.toLocaleString("th-TH")} ราย`}
        description={`ตอนนี้ยังมี ${metrics.readyToNotify.toLocaleString("th-TH")} รายการที่พร้อมแจ้งทันที และมี failed deliveries ${metrics.failedDeliveries.toLocaleString("th-TH")} ครั้งที่ควรตามแก้`}
      />

      <Input.Search
        allowClear
        placeholder="ค้นหาลูกค้า ชื่อสินค้า หรือ SKU"
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

      {counts.readyToNotify > 0 && (
        <div className={styles.bulkBar}>
          <Text className={styles.bulkText}>พร้อมแจ้งลูกค้า <b>{counts.readyToNotify.toLocaleString("th-TH")}</b> รายการ</Text>
          <Popconfirm
            title={`แจ้งลูกค้าที่พร้อมแจ้งทั้งหมด ${counts.readyToNotify} ราย?`}
            description="ระบบจะส่งข้อความ template ให้ทุกรายการที่พร้อมแจ้งในตอนนี้"
            onConfirm={onSendAll}
            okText="แจ้งทั้งหมด"
            cancelText="ยกเลิก"
          >
            <Button type="primary" icon={<SendOutlined />} loading={sendingAll}>แจ้งทั้งหมด</Button>
          </Popconfirm>
        </div>
      )}

      <Card className={styles.queueCard}>
        <div className={styles.resultMeta}>
          <Text type="secondary">พบ {total.toLocaleString("th-TH")} รายการ</Text>
        </div>
        {isMobile ? (
          <div className={styles.mobileList}>
            {items.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีรายการ" />
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
                      {statusMeta[item.status]?.label || item.status}
                    </span>
                  </div>
                  <div className={styles.mobileProductBlock}>
                    <Text strong className={styles.mobileProductName}>{item.productName} · ไซซ์ {item.size}</Text>
                    <div className={styles.mobileSummary}>
                      <span>ต้องการ {item.requestedQty} ชิ้น</span>
                      <span>พร้อมขาย <b className={item.available > 0 ? styles.summaryAvailable : undefined}>{item.available} ชิ้น</b></span>
                      {item.status === "NOTIFIED" && item.lastNotifiedAt && (
                        <span>แจ้งเมื่อ {formatRelativeNotified(item.lastNotifiedAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.mobileMetaLine}>
                    <Text type="secondary" className={styles.smallText}>อัปเดตล่าสุด {formatDate(item.updatedAt)}</Text>
                  </div>
                  <div className={styles.mobileActions}>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>
                      ดูรายละเอียด
                    </Button>
                    {(item.status === "READY_TO_NOTIFY" || item.status === "NOTIFIED") && (
                      <Button
                        type="primary"
                        size="small"
                        onClick={(event) => { event.stopPropagation(); openSend(item); }}
                        disabled={item.available <= 0}
                      >
                        {item.status === "NOTIFIED" ? "ส่งซ้ำ" : "ส่งข้อความ"}
                      </Button>
                    )}
                    {!(item.status === "READY_TO_NOTIFY" || item.status === "NOTIFIED") && (
                      <Button size="small" disabled>
                        ส่งข้อความ
                      </Button>
                    )}
                  </div>
                </button>
              ))
            )}
            <div className={styles.mobilePagination}>
              <Button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</Button>
              <Text className={styles.smallText}>หน้า {page} / {Math.max(1, Math.ceil(total / pageSize))}</Text>
              <Button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((value) => value + 1)}>ถัดไป</Button>
            </div>
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={loading}
            size="middle"
            scroll={{ x: 920 }}
            onRow={(item) => ({ onClick: () => setSelected(item), className: styles.clickableRow })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: setPage,
              showTotal: (value) => `${value} รายการ`,
            }}
          />
        )}
      </Card>

      <Drawer
        title="รายละเอียด Restock Subscription"
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
              <Tag color={statusMeta[selected.status]?.color}>{statusMeta[selected.status]?.label}</Tag>
              <Title level={4}>{selected.productName}</Title>
              <Text>{selected.productSku} · ไซซ์ {selected.size} · พร้อมขาย {selected.available} ชิ้น</Text>
            </div>

            {selected.status === "READY_TO_NOTIFY" && (
              <Alert type="warning" showIcon message="สินค้าเข้าแล้ว รายการนี้พร้อมให้ตรวจข้อความและแจ้งลูกค้า" />
            )}

            <Card size="small" title="ลูกค้าและความยินยอม">
              <Paragraph><Text strong>{selected.customerName || selected.customerRef}</Text><br />{channelLabel[selected.channel]} · ยืนยันเมื่อ {formatDate(selected.consentedAt)}</Paragraph>
              {selected.conversationId && <Link href={`/admin/inbox?c=${selected.conversationId}`}><Button icon={<MessageOutlined />}>เปิดประวัติการคุย</Button></Link>}
            </Card>

            {selected.resolvedOrderId && (
              <Card size="small" title="ออเดอร์ที่เกิดจาก Restock">
                <Paragraph style={{ marginBottom: 8 }}>
                  <Text strong>Order {selected.resolvedOrderId.slice(0, 8)}</Text><br />
                  สร้างออเดอร์เมื่อ {formatDate(selected.orderedAt)}
                  {selected.status === "PURCHASED" ? <><br />ยืนยันชำระเมื่อ {formatDate(selected.resolvedAt)}</> : null}
                </Paragraph>
                {selected.recoveredRevenue != null ? (
                  <Tag color="green">ยอดกู้กลับ {selected.recoveredRevenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</Tag>
                ) : <Tag color="cyan">รอยืนยันการชำระ</Tag>}
              </Card>
            )}

            <div>
              <Title level={5}>ประวัติการส่ง</Title>
              {deliveriesLoading ? <Text type="secondary">กำลังโหลด...</Text> : deliveries.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีการส่งข้อความ" />
              ) : (
                <Timeline items={deliveries.map((delivery) => ({
                  color: delivery.status === "SENT" ? "green" : delivery.status === "FAILED" ? "red" : "gray",
                  children: (
                    <div className={styles.attempt}>
                      <Space><Text strong>ครั้งที่ {delivery.attemptNo}</Text><Tag color={delivery.status === "SENT" ? "green" : "red"}>{delivery.status}</Tag></Space>
                      <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "ดูทั้งหมด" }}>{delivery.body}</Paragraph>
                      <Text type="secondary" className={styles.smallText}>{formatDate(delivery.completedAt || delivery.createdAt)} · {delivery.triggeredBy || "ระบบ"}</Text>
                      {delivery.error && <Alert className={styles.deliveryError} type="error" showIcon message={delivery.error} />}
                    </div>
                  ),
                }))} />
              )}
            </div>

            <div className={styles.drawerActions}>
              {(selected.status === "READY_TO_NOTIFY" || selected.status === "NOTIFIED") && (
                <Button block={isMobile} type="primary" icon={<SendOutlined />} onClick={() => openSend(selected)} disabled={selected.available <= 0}>
                  {selected.status === "NOTIFIED" ? "Resend พร้อมตรวจข้อความ" : "ตรวจข้อความและส่ง"}
                </Button>
              )}
              {!['ORDERED', 'PURCHASED', 'CANCELLED', 'EXPIRED'].includes(selected.status) && (
                <Popconfirm title="ยกเลิกรายการนี้?" description="ระบบจะหยุดรอและไม่แจ้งลูกค้า" onConfirm={() => onCancel(selected)}>
                  <Button block={isMobile} danger icon={<StopOutlined />} loading={cancelling}>ยกเลิกการติดตาม</Button>
                </Popconfirm>
              )}
            </div>
          </Space>
        )}
      </Drawer>

      <Modal
        title={selected?.status === "NOTIFIED" ? "Resend พร้อมตรวจข้อความ" : "ตรวจข้อความก่อนแจ้งลูกค้า"}
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        okText={selected?.status === "NOTIFIED" ? "ยืนยันส่งซ้ำ" : "ส่งข้อความ"}
        cancelText="ยังไม่ส่ง"
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
          message="ระบบเตรียมข้อความจากข้อมูลสต๊อกล่าสุด คุณสามารถแก้ไขหรือเพิ่มข้อความก่อนส่งได้"
        />
        <Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} maxLength={2000} showCount />
        {selected?.status === "NOTIFIED" && <Text type="warning">การส่งซ้ำอาจรบกวนลูกค้า ระบบจำกัดการส่งซ้ำหลังส่งสำเร็จไว้ 5 นาที</Text>}
      </Modal>
    </main>
  );
}
