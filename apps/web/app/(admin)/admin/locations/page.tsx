'use client';
// จัดการสาขา (bms_locations, 7.84 — สร้าง/แก้จากแอปได้ตั้งแต่ 9.1)
// -------------------------------------------------------------
// สำนักงานใหญ่ (is_head_office = TRUE, branch_code '00000') สร้างมาจาก seed
// ตอน migration แล้วต่อร้าน หน้านี้แก้ชื่อ/ที่อยู่/เบอร์ของสำนักงานใหญ่ได้ แต่
// ตั้งสาขาใหม่ให้เป็นสำนักงานใหญ่ไม่ได้ — ธงนั้นเปลี่ยนได้ที่ฐานข้อมูลเท่านั้น
//
// รหัสสาขา (code) แก้ไม่ได้หลังสร้าง เหมือนกับรหัสเครื่องขายที่หน้า pos-devices
// เพราะเป็น key ที่ระบบผูก mutation ไว้แก้แถวเดิม เปลี่ยนกลางทาง = สร้างแถวใหม่แทน
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Empty, Form, Input, Modal, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q = gql`
  query Locations {
    bmsLocations {
      id
      code
      name
      branchCode
      isHeadOffice
      address
      phone
      active
    }
  }
`;
const M_UPSERT = gql`
  mutation($input: BmsLocationInput!) {
    bmsUpsertLocation(input: $input) { id code }
  }
`;

type Location = {
  id: string;
  code: string;
  name: string;
  branchCode: string;
  isHeadOffice: boolean;
  address: string | null;
  phone: string | null;
  active: boolean;
};

export default function LocationsPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("location.manage");
  const { data, loading, refetch } = useQuery(Q, {
    fetchPolicy: "cache-and-network",
    skip: !canManage,
  });

  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Location | null>(null);
  const [open, setOpen] = useState(false);
  const [upsert, { loading: saving }] = useMutation(M_UPSERT);

  if (!permsLoading && !canManage) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี location.manage)" />;
  }

  const locations: Location[] = data?.bmsLocations ?? [];

  async function save() {
    try {
      const values = await form.validateFields();
      await upsert({ variables: { input: { ...values, id: editing?.id ?? null } } });
      message.success("บันทึกสาขาแล้ว");
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await refetch();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation — antd แสดงเองแล้ว
      message.error(e?.message ?? "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="สาขา" />

      <Card
        title="สาขาทั้งหมด"
        extra={
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ active: true });
              setOpen(true);
            }}
          >
            เพิ่มสาขา
          </Button>
        }
        loading={loading}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="สาขาใหม่เริ่มด้วยสต็อกว่าง"
          description="สินค้าที่จะขายที่สาขานี้ต้องโอนย้ายเข้ามาหรือรับซื้อเข้าเองก่อน — ดูที่เมนู Stock Transfers"
        />
        {locations.length === 0 ? (
          <Empty description="ยังไม่มีสาขา" />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={locations}
            pagination={false}
            columns={[
              { title: "รหัส", dataIndex: "code", width: 110 },
              { title: "ชื่อสาขา", dataIndex: "name" },
              { title: "เลขที่สาขา", dataIndex: "branchCode", width: 110 },
              {
                title: "สำนักงานใหญ่",
                dataIndex: "isHeadOffice",
                width: 130,
                render: (v: boolean) => (v ? <Tag color="blue">สำนักงานใหญ่</Tag> : <Tag>สาขาย่อย</Tag>),
              },
              {
                title: "ที่อยู่ / เบอร์",
                render: (_: unknown, l: Location) => (
                  <span style={{ color: l.address || l.phone ? undefined : "#999" }}>
                    {[l.address, l.phone].filter(Boolean).join(" · ") || "—"}
                  </span>
                ),
              },
              {
                title: "สถานะ",
                dataIndex: "active",
                width: 90,
                render: (v: boolean) => (v ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>),
              },
              {
                title: "",
                width: 90,
                render: (_: unknown, l: Location) => (
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(l);
                      form.setFieldsValue(l);
                      setOpen(true);
                    }}
                  >
                    แก้ไข
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `แก้ไข ${editing.name}` : "เพิ่มสาขา"}
        onCancel={() => { setOpen(false); setEditing(null); }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="บันทึก"
        cancelText="ยกเลิก"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="รหัสสาขา (ใช้ภายในระบบ)" rules={[{ required: true, message: "ต้องระบุรหัส" }]}>
            <Input placeholder="BR02" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label="ชื่อสาขา" rules={[{ required: true, message: "ต้องระบุชื่อสาขา" }]}>
            <Input placeholder="สาขาเซ็นทรัลเวิลด์" />
          </Form.Item>
          <Form.Item
            name="branchCode"
            label="เลขที่สาขา (ภ.พ.20)"
            rules={[{ required: true, message: "ต้องระบุเลขที่สาขา" }]}
            extra={
              editing?.isHeadOffice
                ? "สำนักงานใหญ่ใช้ 00000 ตามที่สรรพากรกำหนด"
                : "ขอเลขนี้จากสรรพากรตอนจดทะเบียนสาขา — ห้ามใช้ 00000 (สงวนไว้ให้สำนักงานใหญ่)"
            }
          >
            <Input placeholder="00001" maxLength={16} />
          </Form.Item>
          <Form.Item name="address" label="ที่อยู่">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="phone" label="เบอร์โทร">
            <Input placeholder="02-xxx-xxxx" />
          </Form.Item>
          <Form.Item name="active" label="เปิดใช้งาน" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        {!editing && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
            สาขาใหม่จะไม่ใช่สำนักงานใหญ่ — ตั้งแต่คนขายที่เครื่อง POS ไปจนถึงสต็อกต้องผูกกับสาขานี้เอง
            (ไปที่หน้าเครื่องขายหน้าร้านเพื่อจับคู่เครื่องกับสาขานี้)
          </Typography.Paragraph>
        )}
      </Modal>
    </Space>
  );
}
