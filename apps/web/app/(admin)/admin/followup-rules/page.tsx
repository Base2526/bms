'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table, Tag, Button, Space, Alert, message, Modal, Form, Input, InputNumber,
  Select, Switch, Popconfirm, Typography,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";

const { Text } = Typography;

const INTENT_OPTIONS = [
  "ASK_PRICE", "PRODUCT_INFORMATION", "ORDER", "BOOKING", "SUPPORT",
  "COMPLAINT", "PAYMENT", "DELIVERY", "GENERAL_QUESTION", "OTHER",
];
const GOAL_OPTIONS = [
  { value: "CLOSE_SALE", label: "ปิดการขาย" },
  { value: "COLLECT_MISSING_INFO", label: "เก็บข้อมูลที่ขาด" },
  { value: "CONTINUE_CONVERSATION", label: "ต่อบทสนทนา" },
  { value: "CONFIRM_BOOKING", label: "ยืนยันการจอง" },
  { value: "CUSTOMER_SATISFACTION", label: "ความพึงพอใจลูกค้า" },
  { value: "PAYMENT_REMINDER", label: "เตือนชำระเงิน" },
  { value: "RECOVER_ABANDONED_CART", label: "ตามตะกร้าที่ทิ้งไว้" },
  { value: "SUPPORT_FOLLOWUP", label: "ติดตามเคส support" },
];
const STOP_CONDITION_OPTIONS = [
  { value: "customer_replied", label: "ลูกค้าตอบแล้ว" },
  { value: "staff_replied", label: "แอดมินตอบแล้ว" },
  { value: "conversation_closed", label: "แชทปิดแล้ว" },
  { value: "max_retry_exceeded", label: "ครบจำนวนครั้งที่ลองแล้ว" },
  { value: "opted_out", label: "ลูกค้าปฏิเสธรับข้อความ" },
  { value: "rule_disabled", label: "กฎถูกปิดใช้งาน" },
];

const Q = gql`
  query {
    bmsFollowupRules {
      id intent enabled priority delayMinutes maxRetry stopConditions
      messageGoal businessHoursOnly template createdAt
    }
  }
`;
const M_UPSERT = gql`
  mutation ($input: BmsFollowupRuleInput!) {
    bmsUpsertFollowupRule(input: $input) { id }
  }
`;
const M_DELETE = gql`mutation ($id: ID!) { bmsDeleteFollowupRule(id: $id) }`;

const goalLabel = (v: string) => GOAL_OPTIONS.find((g) => g.value === v)?.label ?? v;

export default function FollowupRulesPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const isMobile = useIsMobile();
  const canManage = can("followup.manage");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("followup.view"),
    fetchPolicy: "cache-and-network",
  });
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const [saveRule, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success("บันทึกกฎ follow-up แล้ว"); setModalOpen(false); refetch(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
  });
  const [deleteRule] = useMutation(M_DELETE, {
    onCompleted: () => { message.success("ลบกฎแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "ลบไม่สำเร็จ"),
  });

  if (!permsLoading && !can("followup.view")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดรายการกฎไม่ได้" description={error.message} />;

  const rows = data?.bmsFollowupRules || [];

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true, priority: 0, maxRetry: 1, businessHoursOnly: false, stopConditions: [] });
    setModalOpen(true);
  };
  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ ...r });
    setModalOpen(true);
  };

  const onFinish = async (v: any) => {
    await saveRule({
      variables: {
        input: {
          id: editing?.id ?? null,
          intent: v.intent,
          enabled: v.enabled ?? true,
          priority: v.priority ?? 0,
          delayMinutes: v.delayMinutes,
          maxRetry: v.maxRetry ?? 1,
          stopConditions: v.stopConditions ?? [],
          messageGoal: v.messageGoal,
          businessHoursOnly: v.businessHoursOnly ?? false,
          template: v.template ?? null,
        },
      },
    });
  };

  const columns = [
    { title: "Intent", dataIndex: "intent", key: "intent", render: (v: string) => <Text strong>{v}</Text> },
    { title: "เป้าหมาย", dataIndex: "messageGoal", key: "messageGoal", render: goalLabel },
    { title: "รอ (นาที)", dataIndex: "delayMinutes", key: "delayMinutes", align: "right" as const },
    { title: "ลองซ้ำสูงสุด", dataIndex: "maxRetry", key: "maxRetry", align: "right" as const },
    { title: "priority", dataIndex: "priority", key: "priority", align: "right" as const },
    {
      title: "เฉพาะเวลาทำการ", dataIndex: "businessHoursOnly", key: "businessHoursOnly",
      render: (v: boolean) => (v ? <Tag color="blue">ใช่</Tag> : <Tag>ไม่</Tag>),
    },
    {
      title: "สถานะ", dataIndex: "enabled", key: "enabled",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "เปิดใช้งาน" : "ปิดใช้งาน"}</Tag>,
    },
    ...(canManage ? [{
      title: "", key: "actions", width: 100,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="ลบกฎนี้?" onConfirm={() => deleteRule({ variables: { id: r.id } })}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>Follow-up Rules</Typography.Title>}>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>สร้างกฎใหม่</Button>}
      </AdminPageHeader>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="เฉพาะ intent ที่มีกฎ enabled อยู่เท่านั้นที่จะถูก follow-up อัตโนมัติ — ไม่มี intent ตรง = ไม่ทำอะไรเลย"
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={rows as any[]}
          rowKey={(r) => r.id}
          totalText={(t) => `ทั้งหมด ${t} กฎ`}
          emptyText="ยังไม่มีกฎ follow-up"
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={<Text strong>{r.intent}</Text>}
              extra={<Tag color={r.enabled ? "green" : "default"}>{r.enabled ? "เปิดใช้งาน" : "ปิดใช้งาน"}</Tag>}
              fields={[
                { label: "เป้าหมาย", value: goalLabel(r.messageGoal) },
                { label: "รอ", value: `${r.delayMinutes} นาที` },
                { label: "ลองซ้ำสูงสุด", value: r.maxRetry },
                { label: "priority", value: r.priority },
              ]}
              actions={canManage && (
                <Space size={4} style={{ marginLeft: "auto" }}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                  <Popconfirm title="ลบกฎนี้?" onConfirm={() => deleteRule({ variables: { id: r.id } })}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              )}
            />
          )}
        />
      ) : (
        <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />
      )}

      <Modal
        title={editing ? "แก้ไขกฎ Follow-up" : "สร้างกฎ Follow-up"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={panelWidth(isMobile, 560)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="intent" label="Intent" rules={[{ required: true, message: "เลือก intent" }]}>
            <Select options={INTENT_OPTIONS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="messageGoal" label="เป้าหมายของข้อความ" rules={[{ required: true, message: "เลือกเป้าหมาย" }]}>
            <Select options={GOAL_OPTIONS} />
          </Form.Item>
          <Form.Item name="delayMinutes" label="รอกี่นาทีก่อน follow-up" rules={[{ required: true, message: "ระบุจำนวนนาที" }]}>
            <InputNumber min={1} style={{ width: "100%" }} placeholder="เช่น 30" />
          </Form.Item>
          <Form.Item name="maxRetry" label="ลองซ้ำได้สูงสุดกี่ครั้ง" initialValue={1}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="priority" label="Priority (สูงกว่า = ถูกเลือกก่อนถ้า intent ชนกัน)" initialValue={0}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="stopConditions"
            label="Stop conditions (เก็บไว้อ้างอิง)"
            extra="6 เงื่อนไขนี้ระบบบังคับใช้เสมอโดยไม่ต้องเลือก — ช่องนี้เผื่อไว้สำหรับ workflow engine ในอนาคต"
          >
            <Select mode="multiple" options={STOP_CONDITION_OPTIONS} />
          </Form.Item>
          <Form.Item name="businessHoursOnly" label="ส่งเฉพาะเวลาทำการ (09:00–18:00 โดยประมาณ)" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item
            name="template"
            label="Template ข้อความสำรอง (ไม่บังคับ)"
            extra="ใช้เมื่อไม่มี AI credentials/quota — ถ้าไม่กรอกจะใช้ข้อความเริ่มต้นตามเป้าหมาย"
          >
            <Input.TextArea rows={2} placeholder="เช่น สวัสดีค่ะ รบกวนสอบถามเพิ่มเติม..." />
          </Form.Item>
          <Form.Item name="enabled" label="เปิดใช้งาน" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
