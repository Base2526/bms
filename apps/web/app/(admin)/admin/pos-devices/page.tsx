'use client';
// ตั้งค่าเครื่องขาย + PIN พนักงาน
// -------------------------------------------------------------
// สองอย่างนี้อยู่หน้าเดียวกันเพราะมันคือ "เตรียมจุดขายให้พร้อม" เรื่องเดียวกัน:
// ถ้าเครื่องไม่มี token จับคู่ไม่ได้ ถ้าพนักงานไม่มี PIN ขายไม่ได้
//
// token กับ PIN แสดงค่าจริงได้ครั้งเดียวตอนสร้างเท่านั้น — ฐานข้อมูลเก็บแต่ hash
// จึงไม่มีปุ่ม "ดูอีกครั้ง" ให้กด หายแล้วออกใหม่อย่างเดียว
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag,
  Typography, message,
} from "antd";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q = gql`
  query PosSetup {
    bmsLocations { id name branchCode isHeadOffice }
    bmsPosDevices { id locationId code name registeredPosNo receiptPrefix active }
    bmsPosCashiers { id name email isPharmacist hasPin }
  }
`;
const M_UPSERT = gql`
  mutation($input: BmsPosDeviceInput!) {
    bmsUpsertPosDevice(input: $input) { id code }
  }
`;
const M_TOKEN = gql`
  mutation($deviceId: ID!) { bmsIssuePosDeviceToken(deviceId: $deviceId) { token } }
`;
const M_PIN = gql`
  mutation($userId: ID!, $pin: String) { bmsSetCashierPin(userId: $userId, pin: $pin) }
`;

type Device = {
  id: string; locationId: string; code: string; name: string | null;
  registeredPosNo: string | null; receiptPrefix: string | null; active: boolean;
};

export default function PosDevicesPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canDevices = can("pos.device.manage");
  const canPins = can("pos.pin.manage");
  const { data, loading, refetch } = useQuery(Q, {
    fetchPolicy: "cache-and-network",
    skip: !canDevices && !canPins,
  });

  const [deviceForm] = Form.useForm();
  const [editing, setEditing] = useState<Device | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ id: string; label: string } | null>(null);
  const [pinValue, setPinValue] = useState("");

  const [upsert, { loading: saving }] = useMutation(M_UPSERT);
  const [issueToken, { loading: issuing }] = useMutation(M_TOKEN);
  const [setPin, { loading: pinSaving }] = useMutation(M_PIN);

  if (!permsLoading && !canDevices && !canPins) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี pos.device.manage หรือ pos.pin.manage)" />;
  }

  const locations = data?.bmsLocations ?? [];
  const devices: Device[] = data?.bmsPosDevices ?? [];
  const cashiers = data?.bmsPosCashiers ?? [];
  const locationName = (id: string) => locations.find((l: any) => l.id === id)?.name ?? "—";
  // ลิงก์จับคู่: หน้าขายอ่าน ?t= แล้วเก็บลง localStorage และลบ query ออกจาก URL ทันที
  const pairUrl = issuedToken
    ? `${typeof window === "undefined" ? "" : window.location.origin}/pos?t=${encodeURIComponent(issuedToken)}`
    : "";

  async function saveDevice() {
    try {
      const values = await deviceForm.validateFields();
      await upsert({ variables: { input: { ...values, id: editing?.id ?? null } } });
      message.success("บันทึกเครื่องขายแล้ว");
      setDeviceOpen(false);
      setEditing(null);
      deviceForm.resetFields();
      await refetch();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation — antd แสดงเองแล้ว
      message.error(e?.message ?? "บันทึกไม่สำเร็จ");
    }
  }

  async function handleIssueToken(device: Device) {
    try {
      const res = await issueToken({ variables: { deviceId: device.id } });
      setIssuedToken(res.data?.bmsIssuePosDeviceToken?.token ?? null);
    } catch (e: any) {
      message.error(e?.message ?? "ออก token ไม่สำเร็จ");
    }
  }

  async function savePin(clear = false) {
    if (!pinFor) return;
    try {
      await setPin({ variables: { userId: pinFor.id, pin: clear ? null : pinValue } });
      message.success(clear ? "ล้าง PIN แล้ว" : "ตั้ง PIN แล้ว");
      setPinFor(null);
      setPinValue("");
      await refetch();
    } catch (e: any) {
      message.error(e?.message ?? "ตั้ง PIN ไม่สำเร็จ");
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="เครื่องขายหน้าร้าน" />

      {canDevices && (
        <Card
          title="เครื่องขาย"
          extra={
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                deviceForm.resetFields();
                deviceForm.setFieldsValue({ active: true, locationId: locations[0]?.id });
                setDeviceOpen(true);
              }}
            >
              เพิ่มเครื่อง
            </Button>
          }
          loading={loading}
        >
          {devices.length === 0 ? (
            <Empty description="ยังไม่มีเครื่องขาย" />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={devices}
              pagination={false}
              columns={[
                { title: "รหัส", dataIndex: "code", width: 130 },
                { title: "ชื่อ", dataIndex: "name" },
                { title: "สาขา", dataIndex: "locationId", render: locationName },
                {
                  title: "เลขทะเบียน (POS #)",
                  dataIndex: "registeredPosNo",
                  render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span>,
                },
                {
                  title: "prefix ใบเสร็จ",
                  dataIndex: "receiptPrefix",
                  width: 110,
                  render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span>,
                },
                {
                  title: "สถานะ",
                  dataIndex: "active",
                  width: 90,
                  render: (v: boolean) => (v ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>),
                },
                {
                  title: "",
                  width: 190,
                  render: (_: unknown, d: Device) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditing(d);
                          deviceForm.setFieldsValue(d);
                          setDeviceOpen(true);
                        }}
                      >
                        แก้ไข
                      </Button>
                      <Popconfirm
                        title="ออก token ใหม่?"
                        description="เครื่องที่กำลังใช้ token เดิมอยู่จะหลุดทันทีและต้องจับคู่ใหม่"
                        okText="ออกใหม่"
                        cancelText="ยกเลิก"
                        onConfirm={() => void handleIssueToken(d)}
                      >
                        <Button size="small" loading={issuing}>ออก token</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            ออก token ใหม่ = ตัวเดิมใช้ไม่ได้ทันที (ใช้ตอนเครื่องหาย) · เอา token ไปใส่ที่จอขาย <a href="/pos">/pos</a>
          </Typography.Paragraph>
        </Card>
      )}

      {canPins && (
        <Card title="PIN พนักงานหน้าร้าน" loading={loading}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="พนักงานที่ยังไม่ตั้ง PIN จะเลือกไม่ได้ที่จอขาย"
            description="PIN ใช้ยืนยันตัวตนที่หน้าร้านเท่านั้น เข้าระบบหลังบ้านด้วย PIN ไม่ได้ · ใส่ผิด 5 ครั้งจะถูกล็อก 15 นาที"
          />
          <Table
            size="small"
            rowKey="id"
            dataSource={cashiers}
            pagination={false}
            columns={[
              {
                title: "พนักงาน",
                render: (_: unknown, c: any) => (
                  <>
                    {c.name || c.email}
                    {c.isPharmacist && <Tag color="blue" style={{ marginLeft: 6 }}>เภสัชกร</Tag>}
                  </>
                ),
              },
              {
                title: "PIN",
                dataIndex: "hasPin",
                width: 140,
                render: (v: boolean) => (v ? <Tag color="green">ตั้งแล้ว</Tag> : <Tag color="red">ยังไม่ตั้ง</Tag>),
              },
              {
                title: "",
                width: 200,
                render: (_: unknown, c: any) => (
                  <Space>
                    <Button size="small" onClick={() => { setPinFor({ id: c.id, label: c.name || c.email }); setPinValue(""); }}>
                      {c.hasPin ? "เปลี่ยน PIN" : "ตั้ง PIN"}
                    </Button>
                    {c.hasPin && (
                      <Button
                        size="small"
                        danger
                        onClick={() => { setPinFor({ id: c.id, label: c.name || c.email }); setPinValue(""); void savePin(true); }}
                      >
                        ล้าง
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={deviceOpen}
        title={editing ? `แก้ไข ${editing.code}` : "เพิ่มเครื่องขาย"}
        onCancel={() => { setDeviceOpen(false); setEditing(null); }}
        onOk={() => void saveDevice()}
        confirmLoading={saving}
        okText="บันทึก"
        cancelText="ยกเลิก"
      >
        <Form form={deviceForm} layout="vertical">
          <Form.Item name="code" label="รหัสเครื่อง" rules={[{ required: true, message: "ต้องระบุรหัส" }]}>
            <Input placeholder="POS-01" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label="ชื่อเครื่อง">
            <Input placeholder="แคชเชียร์หน้าร้าน" />
          </Form.Item>
          <Form.Item name="locationId" label="สาขา" rules={[{ required: true, message: "ต้องเลือกสาขา" }]}>
            <Select
              options={locations.map((l: any) => ({
                value: l.id,
                label: `${l.name} (${l.branchCode})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="registeredPosNo"
            label="เลขทะเบียนเครื่อง (POS #)"
            extra="เลขที่พิมพ์บนใบกำกับภาษี — ขอจากกรมสรรพากร ปล่อยว่างได้ถ้ายังไม่มี"
          >
            <Input placeholder="E030280002A1249" />
          </Form.Item>
          <Form.Item
            name="receiptPrefix"
            label="prefix เลขใบเสร็จ"
            extra="นำหน้าเลขใบเสร็จของเครื่องนี้ เช่น T → T6908150001 · เลขรันแยกต่อเครื่อง"
          >
            <Input placeholder="T" maxLength={8} />
          </Form.Item>
          <Form.Item name="active" label="เปิดใช้งาน" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(issuedToken)}
        title="token ของเครื่องนี้"
        onCancel={() => setIssuedToken(null)}
        footer={<Button onClick={() => setIssuedToken(null)}>ปิด</Button>}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="แสดงครั้งเดียวเท่านั้น"
          description="ฐานข้อมูลเก็บแค่ hash — ปิดหน้านี้แล้วดูซ้ำไม่ได้ ถ้าหายต้องออกใหม่"
        />
        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          วิธีที่ง่ายที่สุด — เปิดลิงก์นี้บนเครื่องขาย
        </Typography.Paragraph>
        <Input.TextArea value={pairUrl} readOnly autoSize />
        <Button
          type="primary"
          style={{ marginTop: 8 }}
          onClick={() => {
            void navigator.clipboard?.writeText(pairUrl);
            message.success("คัดลอกลิงก์แล้ว — เปิดลิงก์นี้บนเครื่องขาย");
          }}
        >
          คัดลอกลิงก์จับคู่
        </Button>

        <Typography.Paragraph strong style={{ marginTop: 20, marginBottom: 4 }}>
          หรือคัดลอกเฉพาะ token ไปวางในช่องบนหน้าจอขาย
        </Typography.Paragraph>
        <Input.TextArea value={issuedToken ?? ""} readOnly autoSize />
        <Button
          style={{ marginTop: 8 }}
          onClick={() => {
            void navigator.clipboard?.writeText(issuedToken ?? "");
            message.success("คัดลอกแล้ว");
          }}
        >
          คัดลอก token
        </Button>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          token ไม่ใช่ที่อยู่เว็บ — วางในช่อง URL ของเบราว์เซอร์จะได้ 404 ให้ใช้ลิงก์ด้านบนแทน
        </Typography.Paragraph>
      </Modal>

      <Modal
        open={Boolean(pinFor) && pinValue !== null}
        title={`ตั้ง PIN — ${pinFor?.label ?? ""}`}
        onCancel={() => { setPinFor(null); setPinValue(""); }}
        onOk={() => void savePin(false)}
        confirmLoading={pinSaving}
        okText="บันทึก"
        cancelText="ยกเลิก"
      >
        <InputNumber
          value={pinValue === "" ? null : Number(pinValue)}
          onChange={(v) => setPinValue(v == null ? "" : String(v))}
          placeholder="ตัวเลข 4–8 หลัก"
          style={{ width: "100%" }}
          controls={false}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          บอก PIN กับพนักงานโดยตรง — ระบบไม่แสดงซ้ำและไม่บันทึกค่าจริงไว้ที่ไหน
        </Typography.Paragraph>
      </Modal>
    </Space>
  );
}
