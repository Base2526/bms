'use client';
import { gql, useQuery, useMutation, useLazyQuery } from "@apollo/client";
import {
  Table, Button, Space, Tag, message, Alert, Popconfirm,
  Typography, Modal, Form, Input, Select, Descriptions,
} from "antd";
import { useState, useMemo, useEffect } from "react";
import {
  ReloadOutlined, PlusOutlined, PrinterOutlined,
  CloseCircleOutlined, EditOutlined, SyncOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader, { ResponsiveStatusFilter } from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";
import { CARRIER_CODES, CARRIER_LABELS, type Carrier as CarrierCode } from "@/lib/bms/carriers/constants";
import { useI18n } from "@/lib/i18nContext";

// ---- Types --------------------------------------------------
type ShipStatus = "PENDING" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "CANCELLED";
type Carrier = CarrierCode;
type Shipment = {
  id: string; orderId: string; carrier: Carrier; trackingNo: string | null;
  externalShipmentId: string | null; carrierLastSyncedAt: string | null;
  carrierTrackingSource: "manual" | "live" | "mock" | null;
  carrierBookingStatus: string; carrierBookingError: string | null;
  carrierBookingAttemptedAt: string | null;
  marketplaceManaged: boolean;
  status: ShipStatus; note: string | null; createdAt: string; updatedAt: string;
};

// ---- GraphQL ------------------------------------------------
const Q_SHIPMENTS = gql`
  query BmsShipments($search: String, $status: BmsShipmentStatus, $limit: Int) {
    bmsShipments(search: $search, status: $status, limit: $limit) {
      id orderId carrier trackingNo externalShipmentId carrierLastSyncedAt carrierTrackingSource
      carrierBookingStatus carrierBookingError carrierBookingAttemptedAt
      marketplaceManaged
      status note createdAt updatedAt
    }
  }
`;
const Q_PACKING_ORDERS = gql`
  query { bmsOrders(status: PACKING, limit: 200) { id customer_ref total_amount shipping_fee amount_due preferred_carrier } }
`;
const Q_LABEL = gql`
  query ($id: ID!) {
    bmsShipmentLabel(id: $id) {
      shipmentId orderId carrier trackingNo labelUrl createdAt
      shipTo { name phone address }
      items { sku size qty }
    }
    bmsShipmentTrackingEvents(shipmentId: $id, limit: 20) {
      id carrierStatus description occurredAt source
    }
  }
`;
const M_CREATE = gql`
  mutation ($orderId: ID!, $carrier: BmsCarrier!, $trackingNo: String, $note: String) {
    bmsCreateShipment(orderId: $orderId, carrier: $carrier, trackingNo: $trackingNo, note: $note) {
      status shipmentId message carrierIntegration carrierBookingStatus
    }
  }
`;
const M_UPDATE_TRACKING = gql`
  mutation ($id: ID!, $trackingNo: String, $carrier: BmsCarrier) {
    bmsUpdateTracking(id: $id, trackingNo: $trackingNo, carrier: $carrier)
  }
`;
const M_SET_STATUS = gql`mutation ($id: ID!, $status: BmsShipmentStatus!) { bmsSetShipmentStatus(id: $id, status: $status) }`;
const M_CANCEL = gql`mutation ($id: ID!) { bmsCancelShipment(id: $id) }`;
const M_SYNC_LIVE = gql`
  mutation ($id: ID!) {
    bmsSyncShipmentLive(id: $id) {
      status shipmentId trackingNo shipmentStatus source eventCount completedOrder detail
    }
  }
`;
const M_BOOK_LIVE = gql`
  mutation ($id: ID!) {
    bmsBookShipmentLive(id: $id) {
      status shipmentId trackingNo externalShipmentId labelUrl source detail
    }
  }
`;

const STATUS_COLOR: Record<ShipStatus, string> = {
  PENDING: "orange", SHIPPED: "geekblue", IN_TRANSIT: "cyan", DELIVERED: "green", RETURNED: "red", CANCELLED: "default",
};
const STATUS_LABEL_KEY: Record<ShipStatus, string> = {
  PENDING: "status_pending", SHIPPED: "status_shipped", IN_TRANSIT: "status_in_transit",
  DELIVERED: "status_delivered", RETURNED: "status_returned", CANCELLED: "status_cancelled",
};
type TFn = (key: string, vars?: Record<string, string | number>) => string;
const statusLabel = (s: ShipStatus, t: TFn) => t(`admin_shipment.${STATUS_LABEL_KEY[s]}`);
const statusLabels = (t: TFn) =>
  Object.fromEntries(
    (Object.keys(STATUS_LABEL_KEY) as ShipStatus[]).map((k) => [k, statusLabel(k, t)])
  ) as Record<ShipStatus, string>;
const CARRIERS: readonly Carrier[] = CARRIER_CODES;
const CARRIER_LABEL = CARRIER_LABELS;
const SYNCABLE_CARRIERS: readonly Carrier[] = ["FLASH", "KERRY"];
const NEXT_STATUS: ShipStatus[] = ["IN_TRANSIT", "DELIVERED", "RETURNED"];
const FILTERS = ["ALL", "PENDING", "SHIPPED", "IN_TRANSIT", "DELIVERED", "RETURNED", "CANCELLED"] as const;

function ShipmentManagement() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [editShip, setEditShip] = useState<Shipment | null>(null);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, refetch } = useQuery(Q_SHIPMENTS, {
    variables: { search: search || null, status: filter === "ALL" ? null : filter, limit: 200 },
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || t("admin_shipment.action_failed"));
  const shipments: Shipment[] = data?.bmsShipments || [];

  const boolOpts = (ok: string) => ({
    onCompleted: (d: any) => Object.values(d || {})[0] ? (message.success(ok), refetch()) : onErr({ message: t("admin_shipment.action_not_allowed") }),
    onError: onErr,
  });
  const [setStatus, { loading: l1 }] = useMutation(M_SET_STATUS, boolOpts(t("admin_shipment.status_updated")));
  const [cancel, { loading: l2 }] = useMutation(M_CANCEL, boolOpts(t("admin_shipment.shipment_cancelled")));
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [syncLive] = useMutation(M_SYNC_LIVE, {
    onCompleted: (d: any) => {
      const result = d?.bmsSyncShipmentLive;
      if (result?.status === "SYNCED") {
        message.success(t("admin_shipment.sync_success", { status: result.shipmentStatus, events: result.eventCount ?? 0, source: result.source }));
        refetch();
      } else {
        const errors: Record<string, string> = {
          SHIPMENT_NOT_FOUND: t("admin_shipment.sync_err_not_found"),
          TRACKING_REQUIRED: t("admin_shipment.sync_err_tracking_required"),
          NO_CARRIER_CLIENT: t("admin_shipment.sync_err_no_client"),
          UNCONFIGURED: t("admin_shipment.sync_err_unconfigured"),
          NOT_IMPLEMENTED: t("admin_shipment.sync_err_not_implemented"),
          CARRIER_ERROR: t("admin_shipment.sync_err_carrier"),
          STALE_SHIPMENT: t("admin_shipment.sync_err_stale"),
        };
        message.error(result?.detail || errors[result?.status] || t("admin_shipment.sync_failed"));
      }
      setSyncingId(null);
    },
    onError: (e: any) => {
      setSyncingId(null);
      onErr(e);
    },
  });
  const [bookLive] = useMutation(M_BOOK_LIVE, {
    onCompleted: (d: any) => {
      const result = d?.bmsBookShipmentLive;
      if (result?.status === "BOOKED" || result?.status === "ALREADY_BOOKED") {
        message.success(t("admin_shipment.book_success", { tracking: result.trackingNo || result.externalShipmentId, source: result.source }));
        refetch();
      } else {
        const errors: Record<string, string> = {
          SHIPMENT_NOT_FOUND: t("admin_shipment.sync_err_not_found"),
          TRACKING_ALREADY_SET: t("admin_shipment.book_err_tracking_set"),
          IN_PROGRESS: t("admin_shipment.book_err_in_progress"),
          TERMINAL_SHIPMENT: t("admin_shipment.book_err_terminal"),
          MARKETPLACE_MANAGED: t("admin_shipment.book_err_marketplace"),
          NO_CARRIER_CLIENT: t("admin_shipment.book_err_no_client"),
          UNCONFIGURED: t("admin_shipment.book_err_unconfigured"),
          NOT_IMPLEMENTED: t("admin_shipment.book_err_not_implemented"),
          CARRIER_ERROR: t("admin_shipment.sync_err_carrier"),
          STALE_SHIPMENT: t("admin_shipment.book_err_stale"),
        };
        message.error(result?.detail || errors[result?.status] || t("admin_shipment.book_failed"));
        refetch();
      }
      setBookingId(null);
    },
    onError: (e: any) => {
      setBookingId(null);
      onErr(e);
    },
  });
  const busy = l1 || l2 || syncingId !== null || bookingId !== null;

  const runSync = (shipmentId: string) => {
    setSyncingId(shipmentId);
    syncLive({ variables: { id: shipmentId } });
  };

  const runBooking = (shipmentId: string) => {
    setBookingId(shipmentId);
    bookLive({ variables: { id: shipmentId } });
  };

  const actionsFor = (r: Shipment) => {
    const btns: any[] = [];
    const done = r.status === "DELIVERED" || r.status === "CANCELLED" || r.status === "RETURNED";
    if (can("shipping.view")) {
      btns.push(<Button key="label" type="link" size="small" icon={<PrinterOutlined />} onClick={() => setLabelId(r.id)}>Label</Button>);
    }
    if (can("shipping.update") && r.trackingNo && SYNCABLE_CARRIERS.includes(r.carrier)) {
      btns.push(
        <Button key="sync" type="link" size="small" icon={<SyncOutlined spin={syncingId === r.id} />}
          disabled={busy && syncingId !== r.id} loading={syncingId === r.id} onClick={() => runSync(r.id)}>
          Sync carrier
        </Button>
      );
    }
    if (!done && !r.marketplaceManaged && can("shipping.update") && !r.trackingNo && SYNCABLE_CARRIERS.includes(r.carrier)) {
      btns.push(
        <Button key="book" type="link" size="small" icon={<SyncOutlined spin={bookingId === r.id} />}
          disabled={busy && bookingId !== r.id} loading={bookingId === r.id} onClick={() => runBooking(r.id)}>
          Book carrier
        </Button>
      );
    }
    if (!done && can("shipping.update")) {
      btns.push(<Button key="edit" type="link" size="small" icon={<EditOutlined />} disabled={busy} onClick={() => setEditShip(r)}>tracking</Button>);
      NEXT_STATUS.forEach((s) => {
        btns.push(
          <Button key={s} type="link" size="small" disabled={busy}
            onClick={() => setStatus({ variables: { id: r.id, status: s } })}>
            {statusLabel(s, t)}
          </Button>
        );
      });
      btns.push(
        <Popconfirm key="cancel" title={t("admin_shipment.cancel_confirm_title")} description={t("admin_shipment.cancel_confirm_desc")}
          okText={t("admin_shipment.btn_cancel")} okButtonProps={{ danger: true }} cancelText={t("admin_shipment.cancel_no")} disabled={busy}
          onConfirm={() => cancel({ variables: { id: r.id } })}>
          <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={busy}>{t("admin_shipment.btn_cancel")}</Button>
        </Popconfirm>
      );
    }
    return btns.length ? btns : [<span key="none" style={{ color: "#999" }}>—</span>];
  };

  const columns = useMemo(
    () => [
      { title: "Shipment", dataIndex: "id", key: "id", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: "Order", dataIndex: "orderId", key: "orderId", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: t("admin_shipment.col_carrier"), dataIndex: "carrier", key: "carrier", width: 130,
        render: (c: Carrier) => CARRIER_LABEL[c] || c },
      { title: t("admin_shipment.col_tracking"), dataIndex: "trackingNo", key: "trackingNo",
        render: (t: string | null) => t ? <Typography.Text copyable>{t}</Typography.Text> : <span style={{ color: "#999" }}>—</span> },
      { title: t("admin_shipment.col_status"), dataIndex: "status", key: "status", width: 140,
        render: (s: ShipStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {statusLabel(s, t)}</Tag> },
      { title: "Carrier sync", key: "carrierSync", width: 170,
        render: (_: any, r: Shipment) => r.carrierLastSyncedAt ? (
          <Space direction="vertical" size={0}>
            <Tag color={r.carrierTrackingSource === "live" ? "green" : "blue"}>{r.carrierTrackingSource || "carrier"}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(r.carrierLastSyncedAt).toLocaleString()}</Typography.Text>
          </Space>
        ) : (
          <Space direction="vertical" size={0}>
            <Tag color={["failed", "unconfigured", "not_implemented"].includes(r.carrierBookingStatus) ? "red" : "default"}>
              {r.carrierBookingStatus}
            </Tag>
            {r.carrierBookingError && <Typography.Text type="danger" ellipsis={{ tooltip: r.carrierBookingError }} style={{ maxWidth: 150, fontSize: 12 }}>{r.carrierBookingError}</Typography.Text>}
          </Space>
        ) },
      { title: t("admin_shipment.col_created"), dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 320,
        render: (_: any, r: Shipment) => <Space size={0} wrap>{actionsFor(r)}</Space> },
    ],
    [busy, can]
  );

  if (error) return <Alert type="error" message={t("admin_shipment.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <AdminPageHeader title="BMS Shipping">
        <Input.Search
          placeholder={t("admin_shipment.search_placeholder")}
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ResponsiveStatusFilter
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: t("admin_shipment.status_all"), ...statusLabels(t) }}
        />
        {can("shipping.create") && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t("admin_shipment.btn_create")}</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_shipment.info_banner")}
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={shipments}
          rowKey={(s) => s.id}
          totalText={(n) => t("admin_shipment.mobile_total", { n })}
          emptyText={t("admin_shipment.mobile_empty")}
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={
                <Space size={6} wrap>
                  <Typography.Text code>{r.id.slice(0, 8)}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {CARRIER_LABEL[r.carrier] || r.carrier}
                  </Typography.Text>
                </Space>
              }
              extra={<Tag color={STATUS_COLOR[r.status]} style={{ marginInlineEnd: 0 }}>{statusLabel(r.status, t)}</Tag>}
              fields={[
                { label: t("admin_shipment.field_order"), value: <Typography.Text code>{r.orderId.slice(0, 8)}</Typography.Text> },
                {
                  label: t("admin_shipment.col_tracking"),
                  value: r.trackingNo
                    ? <Typography.Text copyable>{r.trackingNo}</Typography.Text>
                    : <span style={{ color: "#999" }}>—</span>,
                },
                {
                  label: "Carrier sync",
                  value: r.carrierLastSyncedAt
                    ? `${r.carrierTrackingSource || "carrier"} · ${new Date(r.carrierLastSyncedAt).toLocaleString()}`
                    : `${r.carrierBookingStatus}${r.carrierBookingError ? ` · ${r.carrierBookingError}` : ""}`,
                },
                { label: t("admin_shipment.col_created"), value: new Date(r.createdAt).toLocaleString() },
              ]}
              actions={actionsFor(r)}
            />
          )}
        />
      ) : (
        <Table rowKey="id" loading={loading} dataSource={shipments} columns={columns}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `Total ${t} shipment(s)` }}
        />
      )}

      <CreateShipmentModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); refetch(); }} />
      <EditTrackingModal shipment={editShip} onClose={() => setEditShip(null)} onDone={() => { setEditShip(null); refetch(); }} />
      <LabelModal shipmentId={labelId} onClose={() => setLabelId(null)} />
    </div>
  );
}

// ---- Create shipment modal ----------------------------------
function CreateShipmentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const { data } = useQuery(Q_PACKING_ORDERS, { fetchPolicy: "cache-and-network", skip: !open });
  const orders: { id: string; customer_ref: string | null; total_amount: number; shipping_fee: number; amount_due: number; preferred_carrier: Carrier | null }[] =
    data?.bmsOrders || [];

  // The carrier the customer asked for is only a preference — pre-fill it to save typing,
  // but staff stay free to change it (what actually ships is whatever they submit here).
  const selectedOrderId = Form.useWatch("orderId", form);
  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;
  const requestedCarrier = selectedOrder?.preferred_carrier ?? null;
  const carrierValue = Form.useWatch("carrier", form);

  const onOrderChange = (orderId: string) => {
    const next = orders.find((o) => o.id === orderId)?.preferred_carrier ?? null;
    // Only fill an empty field — never silently overwrite a carrier staff already picked.
    if (next && !form.getFieldValue("carrier")) form.setFieldsValue({ carrier: next });
  };

  const [create, { loading }] = useMutation(M_CREATE, {
    onCompleted: (d: any) => {
      const r = d?.bmsCreateShipment;
      if (r?.status === "CREATED") {
        const bookingFailed = ["UNCONFIGURED", "NOT_IMPLEMENTED", "CARRIER_ERROR", "STALE_SHIPMENT"].includes(r.carrierBookingStatus);
        (bookingFailed ? message.warning : message.success)(r.message || t("admin_shipment.created_ok"));
        form.resetFields();
        onDone();
      }
      else message.error(r?.message || t("admin_shipment.create_failed"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_shipment.create_failed")),
  });

  const submit = async () => {
    const v = await form.validateFields();
    create({ variables: { orderId: v.orderId, carrier: v.carrier, trackingNo: v.trackingNo || null, note: v.note || null } });
  };

  return (
    <Modal title={t("admin_shipment.modal_create_title")} open={open} onCancel={onClose} onOk={submit} width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText={t("admin_shipment.btn_create_ok")} cancelText={t("admin_shipment.btn_cancel")} destroyOnClose>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        message={t("admin_shipment.create_alert")} />
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label={t("admin_shipment.form_order")} rules={[{ required: true, message: t("admin_shipment.form_order_required") }]}>
          <Select showSearch placeholder={t("admin_shipment.form_order_placeholder")}
            onChange={onOrderChange}
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.id.slice(0, 8)} · ${o.customer_ref ?? "-"} · ${Number(o.amount_due).toLocaleString()} ฿`
                + (o.preferred_carrier ? t("admin_shipment.order_requested_carrier", { carrier: CARRIER_LABEL[o.preferred_carrier] }) : ""),
            }))}
            filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
          />
        </Form.Item>
        <Form.Item
          name="carrier"
          label={t("admin_shipment.form_carrier")}
          rules={[{ required: true, message: t("admin_shipment.form_carrier_required") }]}
          extra={
            requestedCarrier
              ? carrierValue && carrierValue !== requestedCarrier
                ? t("admin_shipment.carrier_mismatch", { carrier: CARRIER_LABEL[requestedCarrier] })
                : t("admin_shipment.carrier_requested", { carrier: CARRIER_LABEL[requestedCarrier] })
              : undefined
          }
        >
          <Select options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))} />
        </Form.Item>
        <Form.Item name="trackingNo" label={t("admin_shipment.form_tracking_optional")}>
          <Input placeholder={t("admin_shipment.form_tracking_placeholder")} />
        </Form.Item>
        <Form.Item name="note" label={t("admin_shipment.form_note")}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Edit tracking modal ------------------------------------
function EditTrackingModal({ shipment, onClose, onDone }: { shipment: Shipment | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  useEffect(() => {
    if (shipment) form.setFieldsValue({ trackingNo: shipment.trackingNo, carrier: shipment.carrier });
  }, [shipment, form]);

  const [update, { loading }] = useMutation(M_UPDATE_TRACKING, {
    onCompleted: (d: any) => d?.bmsUpdateTracking ? (message.success(t("admin_shipment.tracking_updated")), onDone()) : message.error(t("admin_shipment.tracking_update_failed")),
    onError: (e: any) => message.error(e?.message || t("admin_shipment.tracking_update_failed")),
  });

  const submit = async () => {
    if (!shipment) return;
    const v = await form.validateFields();
    update({ variables: { id: shipment.id, trackingNo: v.trackingNo || null, carrier: v.carrier || null } });
  };

  return (
    <Modal title={t("admin_shipment.modal_tracking_title", { id: shipment?.id.slice(0, 8) ?? "" })} open={!!shipment} onCancel={onClose} onOk={submit}
      width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText={t("admin_shipment.btn_save")} cancelText={t("admin_shipment.btn_close")} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="carrier" label={t("admin_shipment.form_carrier")}>
          <Select options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))} />
        </Form.Item>
        <Form.Item name="trackingNo" label={t("admin_shipment.form_tracking")}>
          <Input placeholder={t("admin_shipment.form_tracking_placeholder")} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Label modal --------------------------------------------
function LabelModal({ shipmentId, onClose }: { shipmentId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [load, { data, loading }] = useLazyQuery(Q_LABEL, { fetchPolicy: "network-only" });
  useEffect(() => { if (shipmentId) load({ variables: { id: shipmentId } }); }, [shipmentId, load]);

  const label = data?.bmsShipmentLabel;
  const trackingEvents = data?.bmsShipmentTrackingEvents || [];
  return (
    <Modal title={t("admin_shipment.modal_label_title")} open={!!shipmentId} onCancel={onClose} footer={null}
      width={panelWidth(isMobile, 520)} destroyOnClose>
      {loading && <Typography.Text type="secondary">{t("admin_shipment.loading")}</Typography.Text>}
      {label && (
        <>
          {label.labelUrl && (
            <Button type="primary" href={label.labelUrl} target="_blank" rel="noreferrer" icon={<PrinterOutlined />} style={{ marginBottom: 16 }}>
              {t("admin_shipment.open_carrier_label")}
            </Button>
          )}
          {/* มือถือใช้ layout แนวตั้งเพื่อให้ที่อยู่ยังอ่านได้ */}
          <Descriptions bordered column={1} size="small" layout={isMobile ? "vertical" : "horizontal"}>
            <Descriptions.Item label={t("admin_shipment.col_carrier")}>{CARRIER_LABEL[label.carrier as Carrier] || label.carrier}</Descriptions.Item>
            <Descriptions.Item label={t("admin_shipment.col_tracking")}>{label.trackingNo || "—"}</Descriptions.Item>
            <Descriptions.Item label="Order">{label.orderId.slice(0, 8)}</Descriptions.Item>
            <Descriptions.Item label={t("admin_shipment.label_recipient")}>{label.shipTo?.name || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("admin_shipment.label_phone")}>{label.shipTo?.phone || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("admin_shipment.label_address")}>{label.shipTo?.address || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("admin_shipment.label_items")}>
              {(label.items || []).map((it: any) => `${it.sku} ${it.size} ×${it.qty}`).join(", ") || "—"}
            </Descriptions.Item>
            {trackingEvents.length > 0 && (
              <Descriptions.Item label="Tracking timeline">
                <Space direction="vertical" size={4}>
                  {trackingEvents.map((event: any) => (
                    <Typography.Text key={event.id} style={{ fontSize: 12 }}>
                      {new Date(event.occurredAt).toLocaleString()} · {event.carrierStatus} · {event.description}
                      {event.source === "mock" ? " (mock)" : ""}
                    </Typography.Text>
                  ))}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        </>
      )}
      <Alert type="info" showIcon style={{ marginTop: 16 }}
        message={t("admin_shipment.label_footer")} />
    </Modal>
  );
}

export default function Page() {
  return <ShipmentManagement />;
}
