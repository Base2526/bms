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

// ---- Types --------------------------------------------------
type ShipStatus = "PENDING" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "CANCELLED";
type Carrier = CarrierCode;
type Shipment = {
  id: string; orderId: string; carrier: Carrier; trackingNo: string | null;
  externalShipmentId: string | null; carrierLastSyncedAt: string | null;
  carrierTrackingSource: "manual" | "live" | "mock" | null;
  status: ShipStatus; note: string | null; createdAt: string; updatedAt: string;
};

// ---- GraphQL ------------------------------------------------
const Q_SHIPMENTS = gql`
  query BmsShipments($search: String, $status: BmsShipmentStatus, $limit: Int) {
    bmsShipments(search: $search, status: $status, limit: $limit) {
      id orderId carrier trackingNo externalShipmentId carrierLastSyncedAt carrierTrackingSource
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
  }
`;
const M_CREATE = gql`
  mutation ($orderId: ID!, $carrier: BmsCarrier!, $trackingNo: String, $note: String) {
    bmsCreateShipment(orderId: $orderId, carrier: $carrier, trackingNo: $trackingNo, note: $note) {
      status shipmentId message
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

const STATUS_COLOR: Record<ShipStatus, string> = {
  PENDING: "orange", SHIPPED: "geekblue", IN_TRANSIT: "cyan", DELIVERED: "green", RETURNED: "red", CANCELLED: "default",
};
const STATUS_LABEL: Record<ShipStatus, string> = {
  PENDING: "รอส่ง", SHIPPED: "ส่งแล้ว", IN_TRANSIT: "กำลังส่ง", DELIVERED: "ถึงแล้ว", RETURNED: "ตีกลับ", CANCELLED: "ยกเลิก",
};
const CARRIERS: readonly Carrier[] = CARRIER_CODES;
const CARRIER_LABEL = CARRIER_LABELS;
const SYNCABLE_CARRIERS: readonly Carrier[] = ["FLASH", "KERRY"];
const NEXT_STATUS: ShipStatus[] = ["IN_TRANSIT", "DELIVERED", "RETURNED"];
const FILTERS = ["ALL", "PENDING", "SHIPPED", "IN_TRANSIT", "DELIVERED", "RETURNED", "CANCELLED"] as const;

function ShipmentManagement() {
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

  const onErr = (e: any) => message.error(e?.message || "การทำรายการล้มเหลว");
  const shipments: Shipment[] = data?.bmsShipments || [];

  const boolOpts = (ok: string) => ({
    onCompleted: (d: any) => Object.values(d || {})[0] ? (message.success(ok), refetch()) : onErr({ message: "ทำรายการไม่ได้" }),
    onError: onErr,
  });
  const [setStatus, { loading: l1 }] = useMutation(M_SET_STATUS, boolOpts("อัปเดตสถานะแล้ว"));
  const [cancel, { loading: l2 }] = useMutation(M_CANCEL, boolOpts("ยกเลิกการจัดส่งแล้ว"));
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncLive] = useMutation(M_SYNC_LIVE, {
    onCompleted: (d: any) => {
      const result = d?.bmsSyncShipmentLive;
      if (result?.status === "SYNCED") {
        message.success(`Sync สำเร็จ · ${result.shipmentStatus} · ${result.eventCount ?? 0} event(s) · ${result.source}`);
        refetch();
      } else {
        const errors: Record<string, string> = {
          SHIPMENT_NOT_FOUND: "ไม่พบรายการจัดส่ง",
          TRACKING_REQUIRED: "กรุณาใส่เลขพัสดุก่อน sync",
          NO_CARRIER_CLIENT: "ขนส่งนี้ยังไม่รองรับ API sync",
          UNCONFIGURED: "ยังไม่ได้ตั้งค่า API key ของขนส่ง",
          NOT_IMPLEMENTED: "ตั้งค่า key แล้ว แต่ live endpoint ยังไม่พร้อมใช้งาน",
          CARRIER_ERROR: "Carrier API ตอบกลับผิดพลาด",
        };
        message.error(result?.detail || errors[result?.status] || "Sync สถานะไม่สำเร็จ");
      }
      setSyncingId(null);
    },
    onError: (e: any) => {
      setSyncingId(null);
      onErr(e);
    },
  });
  const busy = l1 || l2 || syncingId !== null;

  const runSync = (shipmentId: string) => {
    setSyncingId(shipmentId);
    syncLive({ variables: { id: shipmentId } });
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
    if (!done && can("shipping.update")) {
      btns.push(<Button key="edit" type="link" size="small" icon={<EditOutlined />} disabled={busy} onClick={() => setEditShip(r)}>tracking</Button>);
      NEXT_STATUS.forEach((s) => {
        btns.push(
          <Button key={s} type="link" size="small" disabled={busy}
            onClick={() => setStatus({ variables: { id: r.id, status: s } })}>
            {STATUS_LABEL[s]}
          </Button>
        );
      });
      btns.push(
        <Popconfirm key="cancel" title="ยกเลิกการจัดส่งนี้?" description="ไม่คืนสต็อก (ใช้ order return ถ้าต้องคืนของ)"
          okText="ยกเลิก" okButtonProps={{ danger: true }} cancelText="ไม่" disabled={busy}
          onConfirm={() => cancel({ variables: { id: r.id } })}>
          <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={busy}>ยกเลิก</Button>
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
      { title: "ขนส่ง", dataIndex: "carrier", key: "carrier", width: 130,
        render: (c: Carrier) => CARRIER_LABEL[c] || c },
      { title: "เลขพัสดุ", dataIndex: "trackingNo", key: "trackingNo",
        render: (t: string | null) => t ? <Typography.Text copyable>{t}</Typography.Text> : <span style={{ color: "#999" }}>—</span> },
      { title: "สถานะ", dataIndex: "status", key: "status", width: 140,
        render: (s: ShipStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: "Carrier sync", key: "carrierSync", width: 170,
        render: (_: any, r: Shipment) => r.carrierLastSyncedAt ? (
          <Space direction="vertical" size={0}>
            <Tag color={r.carrierTrackingSource === "live" ? "green" : "blue"}>{r.carrierTrackingSource || "carrier"}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(r.carrierLastSyncedAt).toLocaleString()}</Typography.Text>
          </Space>
        ) : <Typography.Text type="secondary">ยังไม่ sync</Typography.Text> },
      { title: "สร้างเมื่อ", dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 320,
        render: (_: any, r: Shipment) => <Space size={0} wrap>{actionsFor(r)}</Space> },
    ],
    [busy, can]
  );

  if (error) return <Alert type="error" message="โหลดรายการจัดส่งไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <AdminPageHeader title="BMS Shipping">
        <Input.Search
          placeholder="ค้นหา shipment / order / tracking"
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ResponsiveStatusFilter
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: "ทุกสถานะ", ...STATUS_LABEL }}
        />
        {can("shipping.create") && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>สร้างการจัดส่ง</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message="สร้างการจัดส่งจากออร์เดอร์ PACKING → ตัดสต็อก + ออร์เดอร์เป็น SHIPPED  |  SHIPPED → กำลังส่ง → ถึงแล้ว (ปิดออร์เดอร์เป็น COMPLETED)"
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={shipments}
          rowKey={(s) => s.id}
          totalText={(t) => `ทั้งหมด ${t} รายการ`}
          emptyText="ไม่มีรายการจัดส่ง"
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
              extra={<Tag color={STATUS_COLOR[r.status]} style={{ marginInlineEnd: 0 }}>{STATUS_LABEL[r.status]}</Tag>}
              fields={[
                { label: "ออร์เดอร์", value: <Typography.Text code>{r.orderId.slice(0, 8)}</Typography.Text> },
                {
                  label: "เลขพัสดุ",
                  value: r.trackingNo
                    ? <Typography.Text copyable>{r.trackingNo}</Typography.Text>
                    : <span style={{ color: "#999" }}>—</span>,
                },
                {
                  label: "Carrier sync",
                  value: r.carrierLastSyncedAt
                    ? `${r.carrierTrackingSource || "carrier"} · ${new Date(r.carrierLastSyncedAt).toLocaleString()}`
                    : "ยังไม่ sync",
                },
                { label: "สร้างเมื่อ", value: new Date(r.createdAt).toLocaleString() },
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
      if (r?.status === "CREATED") { message.success(r.message || "สร้างแล้ว"); form.resetFields(); onDone(); }
      else message.error(r?.message || "สร้างไม่สำเร็จ");
    },
    onError: (e: any) => message.error(e?.message || "สร้างไม่สำเร็จ"),
  });

  const submit = async () => {
    const v = await form.validateFields();
    create({ variables: { orderId: v.orderId, carrier: v.carrier, trackingNo: v.trackingNo || null, note: v.note || null } });
  };

  return (
    <Modal title="สร้างการจัดส่ง" open={open} onCancel={onClose} onOk={submit} width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText="สร้าง (ตัดสต็อก)" cancelText="ยกเลิก" destroyOnClose>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        message="สร้างจากออร์เดอร์ที่ PACKING — จะตัดสต็อกจริงและเปลี่ยนออร์เดอร์เป็น SHIPPED" />
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label="ออร์เดอร์ (PACKING)" rules={[{ required: true, message: "เลือกออร์เดอร์" }]}>
          <Select showSearch placeholder="เลือกออร์เดอร์"
            onChange={onOrderChange}
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.id.slice(0, 8)} · ${o.customer_ref ?? "-"} · ${Number(o.amount_due).toLocaleString()} ฿`
                + (o.preferred_carrier ? ` · ขอ ${CARRIER_LABEL[o.preferred_carrier]}` : ""),
            }))}
            filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
          />
        </Form.Item>
        <Form.Item
          name="carrier"
          label="ขนส่ง"
          rules={[{ required: true, message: "เลือกขนส่ง" }]}
          extra={
            requestedCarrier
              ? carrierValue && carrierValue !== requestedCarrier
                ? `ลูกค้าขอ ${CARRIER_LABEL[requestedCarrier]} — คุณกำลังเลือกเจ้าอื่น`
                : `ลูกค้าขอ ${CARRIER_LABEL[requestedCarrier]} (เปลี่ยนได้)`
              : undefined
          }
        >
          <Select options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))} />
        </Form.Item>
        <Form.Item name="trackingNo" label="เลขพัสดุ (ใส่ทีหลังได้)">
          <Input placeholder="เช่น TH1234567890" />
        </Form.Item>
        <Form.Item name="note" label="หมายเหตุ">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Edit tracking modal ------------------------------------
function EditTrackingModal({ shipment, onClose, onDone }: { shipment: Shipment | null; onClose: () => void; onDone: () => void }) {
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  useEffect(() => {
    if (shipment) form.setFieldsValue({ trackingNo: shipment.trackingNo, carrier: shipment.carrier });
  }, [shipment, form]);

  const [update, { loading }] = useMutation(M_UPDATE_TRACKING, {
    onCompleted: (d: any) => d?.bmsUpdateTracking ? (message.success("อัปเดตเลขพัสดุแล้ว"), onDone()) : message.error("อัปเดตไม่ได้"),
    onError: (e: any) => message.error(e?.message || "อัปเดตไม่ได้"),
  });

  const submit = async () => {
    if (!shipment) return;
    const v = await form.validateFields();
    update({ variables: { id: shipment.id, trackingNo: v.trackingNo || null, carrier: v.carrier || null } });
  };

  return (
    <Modal title={`แก้ tracking — ${shipment?.id.slice(0, 8) ?? ""}`} open={!!shipment} onCancel={onClose} onOk={submit}
      width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText="บันทึก" cancelText="ปิด" destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="carrier" label="ขนส่ง">
          <Select options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))} />
        </Form.Item>
        <Form.Item name="trackingNo" label="เลขพัสดุ">
          <Input placeholder="เช่น TH1234567890" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- Label modal --------------------------------------------
function LabelModal({ shipmentId, onClose }: { shipmentId: string | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [load, { data, loading }] = useLazyQuery(Q_LABEL, { fetchPolicy: "network-only" });
  useEffect(() => { if (shipmentId) load({ variables: { id: shipmentId } }); }, [shipmentId, load]);

  const label = data?.bmsShipmentLabel;
  return (
    <Modal title="ใบปะหน้าพัสดุ (Label)" open={!!shipmentId} onCancel={onClose} footer={null}
      width={panelWidth(isMobile, 520)} destroyOnClose>
      {loading && <Typography.Text type="secondary">กำลังโหลด...</Typography.Text>}
      {label && (
        <>
          {label.labelUrl && (
            <Button type="primary" href={label.labelUrl} target="_blank" rel="noreferrer" icon={<PrinterOutlined />} style={{ marginBottom: 16 }}>
              เปิด label จาก carrier
            </Button>
          )}
          {/* มือถือใช้ layout แนวตั้งเพื่อให้ที่อยู่ยังอ่านได้ */}
          <Descriptions bordered column={1} size="small" layout={isMobile ? "vertical" : "horizontal"}>
            <Descriptions.Item label="ขนส่ง">{CARRIER_LABEL[label.carrier as Carrier] || label.carrier}</Descriptions.Item>
            <Descriptions.Item label="เลขพัสดุ">{label.trackingNo || "—"}</Descriptions.Item>
            <Descriptions.Item label="Order">{label.orderId.slice(0, 8)}</Descriptions.Item>
            <Descriptions.Item label="ผู้รับ">{label.shipTo?.name || "—"}</Descriptions.Item>
            <Descriptions.Item label="โทร">{label.shipTo?.phone || "—"}</Descriptions.Item>
            <Descriptions.Item label="ที่อยู่">{label.shipTo?.address || "—"}</Descriptions.Item>
            <Descriptions.Item label="รายการ">
              {(label.items || []).map((it: any) => `${it.sku} ${it.size} ×${it.qty}`).join(", ") || "—"}
            </Descriptions.Item>
          </Descriptions>
        </>
      )}
      <Alert type="info" showIcon style={{ marginTop: 16 }}
        message="ระบบใช้ label จาก carrier เมื่อ API ส่งกลับมาได้ และยังใช้ข้อมูลนี้สำหรับพิมพ์/คัดลอกด้วยตนเองเป็น fallback" />
    </Modal>
  );
}

export default function Page() {
  return <ShipmentManagement />;
}
