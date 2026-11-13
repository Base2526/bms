"use client";

import { useUiText } from "@/lib/useUiText";
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
  const uiText = useUiText();
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
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_this_1c0cf")} />;
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
      message.success(uiText("admin_ui.branch_saved_3874d"));
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await refetch();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation — antd แสดงเองแล้ว
      message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.branch_63a7c")} />

      <Card
        title={uiText("admin_ui.all_branches_eb658")}
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
            {uiText("admin_ui.add_branch_c281d")}</Button>
        }
        loading={loading}
      >
        <Alert closable
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={uiText("admin_ui.new_branches_start_with_no_stock_09038")}
          description={uiText("admin_ui.transfer_stock_here_or_receive_purchases_before_selling_830fc")}
        />
        {locations.length === 0 ? (
          <Empty description={uiText("admin_ui.no_branches_yet_7c9a5")} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={locations}
            pagination={false}
            scroll={{ x: 800 }}
            columns={[
              { title: uiText("admin_ui.code_e5390"), dataIndex: "code", width: 110 },
              { title: uiText("admin_ui.branch_name_06112"), dataIndex: "name" },
              { title: uiText("admin_ui.branch_number_3e807"), dataIndex: "branchCode", width: 110 },
              {
                title: uiText("admin_ui.head_office_2cf0a"),
                dataIndex: "isHeadOffice",
                width: 130,
                render: (v: boolean) => (v ? <Tag color="blue">{uiText("admin_ui.head_office_2cf0a")}</Tag> : <Tag>{uiText("admin_ui.branch_office_2da0f")}</Tag>),
              },
              {
                title: uiText("admin_ui.address_phone_509aa"),
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
                title: uiText("admin_ui.status_2e8c4"),
                dataIndex: "active",
                width: 90,
                render: (v: boolean) => (v ? <Tag color="green">{uiText("admin_ui.active_3a6f5")}</Tag> : <Tag>{uiText("admin_ui.close_96d79")}</Tag>),
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
                    {uiText("admin_ui.edit_e7eca")}</Button><Button size="small" onClick={() => setMediaLocation({ id: l.id, name: l.name })}>
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
        title={editing ? uiText("admin_ui.edit_28072", { v0: editing.name }) : uiText("admin_ui.add_branch_c281d")}
        onCancel={() => { setOpen(false); setEditing(null); }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText={uiText("admin_ui.save_f658a")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label={uiText("admin_ui.branch_code_internal_174a3")} rules={[{ required: true, message: uiText("admin_ui.enter_a_code_ef870") }]}>
            <Input placeholder="BR02" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label={uiText("admin_ui.branch_name_06112")} rules={[{ required: true, message: uiText("admin_ui.enter_a_branch_name_afa20") }]}>
            <Input placeholder={uiText("admin_ui.centralworld_branch_e2d8d")} />
          </Form.Item>
          <Form.Item
            name="branchCode"
            label={uiText("admin_ui.branch_number_vat_registration_b5ec0")}
            rules={[{ required: true, message: uiText("admin_ui.enter_a_branch_number_3d40a") }]}
            extra={
              editing?.isHeadOffice
                ? uiText("admin_ui.head_office_uses_00000_as_required_by_the_72a48")
                : uiText("admin_ui.obtain_this_number_from_the_revenue_department_when_5003e")
            }
          >
            <Input placeholder="00001" maxLength={16} />
          </Form.Item>
          <Form.Item name="address" label={uiText("admin_ui.addresses_9e206")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <ThaiAddressFields form={form} />
          <Form.Item name="phone" label={uiText("admin_ui.phone_12260")}>
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
          <Typography.Title level={5}>{uiText("admin_ui.pickup_number_7d395")}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {uiText("admin_ui.applies_to_every_register_in_this_branch_expired_a34ad")}</Typography.Paragraph>
          <Form.Item name={["pickupQueue", "enabled"]} label={uiText("admin_ui.issue_pickup_numbers_on_every_register_in_this_55a9a")}
            valuePropName="checked"
            extra={uiText("admin_ui.paid_online_and_takeaway_orders_receive_a_number_1329b")}>
            <Switch aria-label={uiText("admin_ui.issue_pickup_numbers_on_every_register_in_this_55a9a")} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "autoHideMinutes"]} label={uiText("admin_ui.hide_ready_numbers_from_the_customer_display_after_31e6e")}
            extra={uiText("admin_ui.enter_0_to_keep_numbers_until_staff_mark_05a12")}
            rules={[{ required: true, message: uiText("admin_ui.enter_a_number_of_minutes_e7251") }]}>
            <InputNumber min={0} max={1440} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "showPreparing"]} label={uiText("admin_ui.show_preparing_orders_on_the_customer_display_b5d9a")} valuePropName="checked">
            <Switch aria-label={uiText("admin_ui.show_preparing_orders_on_the_customer_display_b5d9a")} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "boardMessage"]} label={uiText("admin_ui.queue_display_message_18f59")}
            extra={uiText("admin_ui.e_g_please_collect_your_order_at_the_adb8d")}>
            <Input maxLength={120} showCount />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name={["pickupQueue", "prefix"]} label={uiText("admin_ui.prefix_9e3ac")} style={{ width: "35%" }}
              normalize={(value) => String(value ?? "").trim().toUpperCase()}
              rules={[{ pattern: /^[A-Z]?$/, message: uiText("admin_ui.one_letter_a_z_48273") }]}
              extra={uiText("admin_ui.e_g_a_a001_d79e5")}>
              <Input maxLength={1} placeholder="A" />
            </Form.Item>
            <Form.Item name={["pickupQueue", "startNo"]} label={uiText("admin_ui.start_at_4df46")} style={{ width: "65%" }}
              rules={[{ required: true, message: uiText("admin_ui.enter_a_starting_number_ad786") }]} extra={uiText("admin_ui.applies_from_the_next_service_day_eb480")}>
              <InputNumber min={1} max={9999} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name={["pickupQueue", "spotlightSeconds"]} label={uiText("admin_ui.highlight_called_numbers_for_seconds_3f849")} rules={[{ required: true }]}>
            <InputNumber min={5} max={60} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["pickupQueue", "voiceMode"]} label={uiText("admin_ui.queue_announcement_sound_6db24")}
            extra={uiText("admin_ui.ai_studio_uses_approved_audio_files_if_the_abc25")}>
            <Select options={[
              { value: "AI_STUDIO", label: uiText("admin_ui.ai_studio_primary_fallback_chime_bfbef") },
              { value: "VOICE_CHIME", label: uiText("admin_ui.ai_studio_then_chime_ff441") },
              { value: "CHIME", label: uiText("admin_ui.chime_only_63200") },
              { value: "OFF", label: uiText("admin_ui.mute_fb638") },
            ]} />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name={["pickupQueue", "voiceLanguage"]} label={uiText("admin_ui.language_485e6")} style={{ width: "34%" }}>
              <Select options={[{ value: "th", label: uiText("admin_ui.thai_7160c") }, { value: "en", label: "English" }]} />
            </Form.Item>
            <Form.Item name={["pickupQueue", "voiceRepeat"]} label={uiText("admin_ui.call_again_1cad5")} style={{ width: "33%" }}>
              <InputNumber min={1} max={3} precision={0} addonAfter={uiText("admin_ui.times_e39c7")} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name={["pickupQueue", "voiceVolume"]} label={uiText("admin_ui.volume_7d9f3")} style={{ width: "33%" }}>
              <InputNumber min={0} max={100} precision={0} addonAfter="%" style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="active" label={uiText("admin_ui.active_79476")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        {!editing && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
            {uiText("admin_ui.a_new_branch_is_not_the_head_office_e4e64")}</Typography.Paragraph>
        )}
      </Modal>
      <QueueBoardMediaEditor key={mediaLocation?.id ?? "closed"} location={mediaLocation}
        onClose={() => setMediaLocation(null)} />
    </Space>
  );
}
