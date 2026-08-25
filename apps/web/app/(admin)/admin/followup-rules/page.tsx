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
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";

const { Text } = Typography;

const INTENT_OPTIONS = [
  "ASK_PRICE", "PRODUCT_INFORMATION", "ORDER", "BOOKING", "SUPPORT",
  "COMPLAINT", "PAYMENT", "DELIVERY", "GENERAL_QUESTION", "OTHER",
];

function goalOptions(t: (key: string) => string) {
  return [
    { value: "CLOSE_SALE", label: t("admin_followup_rules.goal_close_sale") },
    { value: "COLLECT_MISSING_INFO", label: t("admin_followup_rules.goal_collect_missing_info") },
    { value: "CONTINUE_CONVERSATION", label: t("admin_followup_rules.goal_continue_conversation") },
    { value: "CONFIRM_BOOKING", label: t("admin_followup_rules.goal_confirm_booking") },
    { value: "CUSTOMER_SATISFACTION", label: t("admin_followup_rules.goal_customer_satisfaction") },
    { value: "PAYMENT_REMINDER", label: t("admin_followup_rules.goal_payment_reminder") },
    { value: "RECOVER_ABANDONED_CART", label: t("admin_followup_rules.goal_recover_abandoned_cart") },
    { value: "SUPPORT_FOLLOWUP", label: t("admin_followup_rules.goal_support_followup") },
  ];
}
function stopConditionOptions(t: (key: string) => string) {
  return [
    { value: "customer_replied", label: t("admin_followup_rules.stop_customer_replied") },
    { value: "staff_replied", label: t("admin_followup_rules.stop_staff_replied") },
    { value: "conversation_closed", label: t("admin_followup_rules.stop_conversation_closed") },
    { value: "max_retry_exceeded", label: t("admin_followup_rules.stop_max_retry_exceeded") },
    { value: "opted_out", label: t("admin_followup_rules.stop_opted_out") },
    { value: "rule_disabled", label: t("admin_followup_rules.stop_rule_disabled") },
  ];
}

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

export default function FollowupRulesPage() {
  const { t } = useI18n();
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

  const GOAL_OPTIONS = goalOptions(t);
  const STOP_CONDITION_OPTIONS = stopConditionOptions(t);
  const goalLabel = (v: string) => GOAL_OPTIONS.find((g) => g.value === v)?.label ?? v;

  const [saveRule, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success(t("admin_followup_rules.create_success")); setModalOpen(false); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_followup_rules.save_error")),
  });
  const [deleteRule] = useMutation(M_DELETE, {
    onCompleted: () => { message.success(t("admin_followup_rules.delete_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_followup_rules.delete_error")),
  });

  if (!permsLoading && !can("followup.view")) {
    return <Alert closable type="warning" showIcon message={t("admin_followup_rules.no_permission")} />;
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_followup_rules.load_error")} description={error.message} />;

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
    { title: t("admin_followup_rules.col_goal"), dataIndex: "messageGoal", key: "messageGoal", render: goalLabel },
    { title: t("admin_followup_rules.col_delay"), dataIndex: "delayMinutes", key: "delayMinutes", align: "right" as const },
    { title: t("admin_followup_rules.col_max_retry"), dataIndex: "maxRetry", key: "maxRetry", align: "right" as const },
    { title: t("admin_followup_rules.col_priority"), dataIndex: "priority", key: "priority", align: "right" as const },
    {
      title: t("admin_followup_rules.col_business_hours"), dataIndex: "businessHoursOnly", key: "businessHoursOnly",
      render: (v: boolean) => (v ? <Tag color="blue">{t("admin_followup_rules.bool_yes")}</Tag> : <Tag>{t("admin_followup_rules.bool_no")}</Tag>),
    },
    {
      title: t("admin_followup_rules.col_status"), dataIndex: "enabled", key: "enabled",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? t("admin_followup_rules.status_enabled") : t("admin_followup_rules.status_disabled")}</Tag>,
    },
    ...(canManage ? [{
      title: "", key: "actions", width: 100,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title={t("admin_followup_rules.delete_confirm")} onConfirm={() => deleteRule({ variables: { id: r.id } })}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_followup_rules.title")}</Typography.Title>}>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("admin_followup_rules.create")}</Button>}
      </AdminPageHeader>
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_followup_rules.intro")}
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={rows as any[]}
          rowKey={(r) => r.id}
          totalText={(total) => t("admin_followup_rules.total_rules", { total })}
          emptyText={t("admin_followup_rules.empty_rules")}
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={<Text strong>{r.intent}</Text>}
              extra={<Tag color={r.enabled ? "green" : "default"}>{r.enabled ? t("admin_followup_rules.status_enabled") : t("admin_followup_rules.status_disabled")}</Tag>}
              fields={[
                { label: t("admin_followup_rules.col_goal"), value: goalLabel(r.messageGoal) },
                { label: t("admin_followup_rules.col_delay"), value: t("admin_followup_rules.minutes_suffix", { n: r.delayMinutes }) },
                { label: t("admin_followup_rules.col_max_retry"), value: r.maxRetry },
                { label: t("admin_followup_rules.col_priority"), value: r.priority },
              ]}
              actions={canManage && (
                <Space size={4} style={{ marginLeft: "auto" }}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                  <Popconfirm title={t("admin_followup_rules.delete_confirm")} onConfirm={() => deleteRule({ variables: { id: r.id } })}>
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
        title={editing ? t("admin_followup_rules.modal_edit_title") : t("admin_followup_rules.modal_create_title")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={panelWidth(isMobile, 560)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="intent" label={t("admin_followup_rules.field_intent")} rules={[{ required: true, message: t("admin_followup_rules.field_intent_required") }]}>
            <Select options={INTENT_OPTIONS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="messageGoal" label={t("admin_followup_rules.field_goal")} rules={[{ required: true, message: t("admin_followup_rules.field_goal_required") }]}>
            <Select options={GOAL_OPTIONS} />
          </Form.Item>
          <Form.Item name="delayMinutes" label={t("admin_followup_rules.field_delay")} rules={[{ required: true, message: t("admin_followup_rules.field_delay_required") }]}>
            <InputNumber min={1} style={{ width: "100%" }} placeholder={t("admin_followup_rules.field_delay_placeholder")} />
          </Form.Item>
          <Form.Item name="maxRetry" label={t("admin_followup_rules.field_max_retry")} initialValue={1}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="priority" label={t("admin_followup_rules.field_priority")} initialValue={0}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="stopConditions"
            label={t("admin_followup_rules.field_stop_conditions")}
            extra={t("admin_followup_rules.field_stop_conditions_extra")}
          >
            <Select mode="multiple" options={STOP_CONDITION_OPTIONS} />
          </Form.Item>
          <Form.Item name="businessHoursOnly" label={t("admin_followup_rules.field_business_hours")} valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item
            name="template"
            label={t("admin_followup_rules.field_template")}
            extra={t("admin_followup_rules.field_template_extra")}
          >
            <Input.TextArea rows={2} placeholder={t("admin_followup_rules.field_template_placeholder")} />
          </Form.Item>
          <Form.Item name="enabled" label={t("admin_followup_rules.field_enabled")} valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
