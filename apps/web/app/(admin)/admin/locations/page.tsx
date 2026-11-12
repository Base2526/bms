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
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";
import type { LocationParking } from "@/lib/bms/locationParking";
import ThaiAddressFields from "@/components/ThaiAddressFields";
import QueueBoardMediaEditor from "@/components/pos-desktop/QueueBoardMediaEditor";

const Q = gql`
  query Locations {
    bmsManageableLocations {
      id
      code
      name
      branchCode
      isHeadOffice
      address
      provinceCode districtCode subdistrictCode province district subdistrict postcode
      phone
      active
      parking { status published carSpaces motorcycleSpaces details mapUrl }
      pickupQueue {
        enabled autoHideMinutes showPreparing boardMessage prefix startNo spotlightSeconds
        voiceMode voiceLanguage voiceRepeat voiceVolume
      }
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
  provinceCode:string|null;districtCode:string|null;subdistrictCode:string|null;postcode:string|null;
  phone: string | null;
  active: boolean;
  parking: LocationParking | null;
  pickupQueue: {
    enabled: boolean; autoHideMinutes: number; showPreparing: boolean; boardMessage: string | null;
    prefix: string; startNo: number; spotlightSeconds: number;
    voiceMode: "AI_STUDIO" | "VOICE_CHIME" | "CHIME" | "OFF";
    voiceLanguage: "th" | "en"; voiceRepeat: number; voiceVolume: number;
  };
};

export default function LocationsPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("location.manage");
  const { data, loading, refetch } = useQuery(Q, {
    fetchPolicy: "cache-and-network",
    skip: !canManage,
  });

  const [form] = Form.useForm();
  const parkingStatus = Form.useWatch(["parking", "status"], form);
  const emptyParking: LocationParking = { status: "UNKNOWN", published: false, carSpaces: null, motorcycleSpaces: null, details: null, mapUrl: null };
  const [editing, setEditing] = useState<Location | null>(null);
  const [mediaLocation, setMediaLocation] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [upsert, { loading: saving }] = useMutation(M_UPSERT);

  if (!permsLoading && !canManage) {
    return <Alert closable type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี location.manage)" />;
  }

  const locations: Location[] = data?.bmsManageableLocations ?? [];

  async function save() {
    try {
      const values = await form.validateFields();
      // Do not send Apollo's __typename or other read-only fields as mutation input.
      const parking = values.parking ?? emptyParking;
      await upsert({ variables: { input: { ...values, id: editing?.id ?? null, parking: {
        status: parking.status, published: parking.published,
        carSpaces: parking.carSpaces ?? null, motorcycleSpaces: parking.motorcycleSpaces ?? null,
        details: parking.details ?? null, mapUrl: parking.mapUrl ?? null,
      }, pickupQueue: {
        enabled: values.pickupQueue?.enabled === true,
        autoHideMinutes: Number(values.pickupQueue?.autoHideMinutes ?? 30),
        showPreparing: values.pickupQueue?.showPreparing !== false,
        boardMessage: values.pickupQueue?.boardMessage?.trim() || null,
        prefix: values.pickupQueue?.prefix?.trim().toUpperCase() || "",
        startNo: Number(values.pickupQueue?.startNo ?? 1),
        spotlightSeconds: Number(values.pickupQueue?.spotlightSeconds ?? 12),
        voiceMode: values.pickupQueue?.voiceMode ?? "AI_STUDIO",
        voiceLanguage: values.pickupQueue?.voiceLanguage ?? "th",
        voiceRepeat: Number(values.pickupQueue?.voiceRepeat ?? 1),
        voiceVolume: Number(values.pickupQueue?.voiceVolume ?? 80),
      } } } });
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
              form.setFieldsValue({ active: true, parking: emptyParking, pickupQueue: {
                enabled: false, autoHideMinutes: 30, showPreparing: true, boardMessage: null,
                prefix: "", startNo: 1, spotlightSeconds: 12,
                voiceMode: "AI_STUDIO", voiceLanguage: "th", voiceRepeat: 1, voiceVolume: 80,
              } });
              setOpen(true);
            }}
          >
            เพิ่มสาขา
          </Button>
        }
        loading={loading}
      >
        <Alert closable
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
            scroll={{ x: 800 }}
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
                title: t("branch_parking.title"),
                render: (_: unknown, l: Location) => (
                  <Space direction="vertical" size={0}>
                    <span>{t(`branch_parking.status_${l.parking?.status ?? "UNKNOWN"}`)}</span>
                    <Typography.Text type="secondary">{t(l.parking?.published ? "branch_parking.published" : "branch_parking.private")}</Typography.Text>
                  </Space>
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
                width: 190,
                render: (_: unknown, l: Location) => (
                  <Space><Button
                    size="small"
                    onClick={() => {
                      setEditing(l);
                      form.resetFields();
                      form.setFieldsValue({ ...l, parking: l.parking ?? emptyParking });
                      setOpen(true);
                    }}
                  >
                    แก้ไข
                  </Button><Button size="small" onClick={() => setMediaLocation({ id: l.id, name: l.name })}>
                    {t("queue_board_media.title")}
                  </Button></Space>
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
          <ThaiAddressFields form={form} />
          <Form.Item name="phone" label="เบอร์โทร">
            <Input placeholder="02-xxx-xxxx" />
          </Form.Item>
          <Typography.Title level={5}>{t("branch_parking.title")}</Typography.Title>
          <Typography.Paragraph type="secondary">{t("branch_parking.help")}</Typography.Paragraph>
          <Form.Item name={["parking", "status"]} label={t("branch_parking.status")} rules={[{ required: true }]}>
            <Select options={[
              { value: "UNKNOWN", label: t("branch_parking.status_UNKNOWN") },
              { value: "AVAILABLE", label: t("branch_parking.status_AVAILABLE") },
              { value: "NONE", label: t("branch_parking.status_NONE") },
            ]} onChange={value => {
              if (value !== "AVAILABLE") form.setFieldsValue({ parking: { carSpaces: null, motorcycleSpaces: null } });
            }} />
          </Form.Item>
          <Form.Item name={["parking", "carSpaces"]} label={t("branch_parking.car_spaces")} extra={t("branch_parking.capacity_help")}>
            <InputNumber min={0} max={10000} precision={0} disabled={parkingStatus !== "AVAILABLE"} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["parking", "motorcycleSpaces"]} label={t("branch_parking.motorcycle_spaces")}>
            <InputNumber min={0} max={10000} precision={0} disabled={parkingStatus !== "AVAILABLE"} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["parking", "details"]} label={t("branch_parking.details")} extra={t("branch_parking.details_help")}>
            <Input.TextArea rows={4} maxLength={1500} showCount />
          </Form.Item>
          <Form.Item name={["parking", "mapUrl"]} label={t("branch_parking.map_url")} rules={[{
            validator: async (_rule, value) => {
              if (!value?.trim()) return;
              try { const url = new URL(value.trim()); if (url.protocol === "https:" && !url.username && !url.password) return; } catch {}
              throw new Error(t("branch_parking.map_error"));
            },
          }]}>
            <Input maxLength={1000} placeholder="https://..." />
          </Form.Item>
          <Form.Item name={["parking", "published"]} label={t("branch_parking.publish")} valuePropName="checked" extra={t("branch_parking.publish_help")}>
            <Switch aria-label={t("branch_parking.publish")} />
          </Form.Item>
          <Typography.Title level={5}>เลขคิวรับของ</Typography.Title>
          <Typography.Paragraph type="secondary">
            ใช้กับเครื่องขายทุกเครื่องในสาขานี้ เลขที่เกินเวลาจะหายจากจอลูกค้าเท่านั้น
            แต่ยังอยู่ในประวัติพนักงานและไม่ถูกลบ
          </Typography.Paragraph>
          <Form.Item name={["pickupQueue", "enabled"]} label="ออกเลขคิวทุกเครื่องในสาขานี้"
            valuePropName="checked"
            extra="บิลขายออนไลน์และบิลกลับบ้านที่ชำระแล้วจะได้เลข แม้เครื่องนั้นไม่ได้เปิดสวิตช์รายเครื่อง">
            <Switch aria-label="ออกเลขคิวทุกเครื่องในสาขานี้" />
          </Form.Item>
          <Form.Item name={["pickupQueue", "autoHideMinutes"]} label="ซ่อนเลขพร้อมรับจากจอลูกค้าหลัง (นาที)"
            extra="ใส่ 0 เพื่อให้ค้างจนพนักงานกด รับแล้ว · ช่วง 0-1440 นาที"
            rules={[{ required: true, message: "ระบุจำนวนนาที" }]}>
            <InputNumber min={0} max={1440} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "showPreparing"]} label="แสดงคิวกำลังเตรียมบนจอลูกค้า" valuePropName="checked">
            <Switch aria-label="แสดงคิวกำลังเตรียมบนจอลูกค้า" />
          </Form.Item>
          <Form.Item name={["pickupQueue", "boardMessage"]} label="ข้อความบนจอเรียกคิว"
            extra="เช่น กรุณารอรับสินค้าที่เคาน์เตอร์ · สูงสุด 120 ตัวอักษร">
            <Input maxLength={120} showCount />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name={["pickupQueue", "prefix"]} label="คำนำหน้า" style={{ width: "35%" }}
              normalize={(value) => String(value ?? "").trim().toUpperCase()}
              rules={[{ pattern: /^[A-Z]?$/, message: "A-Z ได้ 1 ตัว" }]}
              extra="เช่น A → A001">
              <Input maxLength={1} placeholder="A" />
            </Form.Item>
            <Form.Item name={["pickupQueue", "startNo"]} label="เริ่มที่" style={{ width: "65%" }}
              rules={[{ required: true, message: "ระบุเลขเริ่ม" }]} extra="มีผลกับวันบริการใหม่">
              <InputNumber min={1} max={9999} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name={["pickupQueue", "spotlightSeconds"]} label="ไฮไลต์เลขที่เรียก (วินาที)" rules={[{ required: true }]}>
            <InputNumber min={5} max={60} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "voiceMode"]} label="เสียงเรียกคิว"
            extra="AI Studio ใช้ไฟล์เสียงที่อนุมัติแล้ว; ถ้า voice-pack ยังไม่พร้อมจะใช้เสียงพูดของเครื่องก่อน และใช้กริ่งเมื่อเครื่องพูดไม่ได้">
            <Select options={[
              { value: "AI_STUDIO", label: "AI Studio (หลัก) + กริ่งสำรอง" },
              { value: "VOICE_CHIME", label: "AI Studio แล้วกริ่ง" },
              { value: "CHIME", label: "กริ่งอย่างเดียว" },
              { value: "OFF", label: "ปิดเสียง" },
            ]} />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name={["pickupQueue", "voiceLanguage"]} label="ภาษา" style={{ width: "34%" }}>
              <Select options={[{ value: "th", label: "ไทย" }, { value: "en", label: "English" }]} />
            </Form.Item>
            <Form.Item name={["pickupQueue", "voiceRepeat"]} label="เรียกซ้ำ" style={{ width: "33%" }}>
              <InputNumber min={1} max={3} precision={0} addonAfter="ครั้ง" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name={["pickupQueue", "voiceVolume"]} label="ระดับเสียง" style={{ width: "33%" }}>
              <InputNumber min={0} max={100} precision={0} addonAfter="%" style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
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
      <QueueBoardMediaEditor key={mediaLocation?.id ?? "closed"} location={mediaLocation}
        onClose={() => setMediaLocation(null)} />
    </Space>
  );
}
