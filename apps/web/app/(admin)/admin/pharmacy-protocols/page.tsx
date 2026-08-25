'use client';
import { gql, useLazyQuery, useQuery, useMutation } from "@apollo/client";
import { Alert, Button, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Switch, message } from "antd";
import { ReadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const Q_PROTOCOLS = gql`
  query PharmacyProtocols {
    bmsPharmacyProtocols {
      id protocolKey name version supportedSymptomGroup
      status clinicallyApproved enabled platformAllowed reviewedBy reviewedAt
    }
  }
`;
const Q_PROTOCOL_DETAIL = gql`
  query PharmacyProtocolDetail($id: ID!) {
    bmsPharmacyProtocol(id: $id) {
      id protocolKey name version supportedSymptomGroup displayLabel triggerTerms
      requiredFields conditionalQuestions redFlagRules completionRules escalationRules
      status clinicallyApproved enabled platformAllowed reviewedBy reviewedAt
    }
  }
`;
const Q_PRODUCT_POLICIES = gql`
  query PharmacyProductPolicies($search: String, $limit: Int = 20, $offset: Int = 0) {
    bmsPharmacyProductPolicies(search: $search, limit: $limit, offset: $offset) {
      total
      limit
      offset
      items {
        id productSku productName productType regulatoryFramework regulatoryClass
        regulatoryEvidenceSource regulatoryEvidenceRef salePolicy registrationNo maxQuantity
        status reviewedBy reviewedAt updatedAt
      }
    }
  }
`;
const M_SET_ENABLED = gql`
  mutation($id: ID!, $enabled: Boolean!) { bmsSetPharmacyProtocolEnabled(id: $id, enabled: $enabled) { id enabled } }
`;
const M_UPSERT = gql`
  mutation($input: BmsPharmacyProtocolInput!) { bmsUpsertPharmacyProtocol(input: $input) { id } }
`;
const M_SUBMIT = gql`
  mutation($id: ID!) { bmsSubmitPharmacyProtocolForReview(id: $id) { id status } }
`;
const M_REVIEW = gql`
  mutation($id: ID!, $decision: String!) { bmsReviewPharmacyProtocol(id: $id, decision: $decision) { id status clinicallyApproved } }
`;
const M_UPSERT_PRODUCT_POLICY = gql`
  mutation($input: BmsPharmacyProductPolicyInput!) {
    bmsUpsertPharmacyProductPolicy(input: $input) { id productSku status }
  }
`;
const M_SUBMIT_PRODUCT_POLICY = gql`
  mutation($productSku: String!) {
    bmsSubmitPharmacyProductPolicyForReview(productSku: $productSku) { id productSku status }
  }
`;
const M_REVIEW_PRODUCT_POLICY = gql`
  mutation($productSku: String!, $decision: String!) {
    bmsReviewPharmacyProductPolicy(productSku: $productSku, decision: $decision) { id productSku status }
  }
`;

type TFn = (key: string, vars?: Record<string, string | number>) => string;
type Opt = { value: string; labelKey: string };
const withLabels = (opts: readonly Opt[], t: TFn) =>
  opts.map((o) => ({ value: o.value, label: t(`admin_pharmacy_protocols.${o.labelKey}`) }));

const PRODUCT_TYPE_OPTIONS: readonly Opt[] = [
  { value: "UNKNOWN", labelKey: "ptype_unknown" },
  { value: "GENERAL_PRODUCT", labelKey: "ptype_general" },
  { value: "MEDICAL_SUPPLY", labelKey: "ptype_supply" },
  { value: "MEDICAL_DEVICE", labelKey: "ptype_device" },
  { value: "HOUSEHOLD_REMEDY", labelKey: "ptype_household" },
  { value: "DRUG", labelKey: "ptype_drug" },
];
const SALE_POLICY_OPTIONS: readonly Opt[] = [
  { value: "DIRECT_SALE", labelKey: "sale_direct" },
  { value: "SHORT_SAFETY_CHECK", labelKey: "sale_short_check" },
  { value: "PHARMACIST_APPROVAL", labelKey: "sale_pharmacist" },
  { value: "PRESCRIPTION_REQUIRED", labelKey: "sale_prescription" },
  { value: "ONLINE_SALE_PROHIBITED", labelKey: "sale_online_prohibited" },
];
const REGULATORY_FRAMEWORK_OPTIONS: readonly Opt[] = [
  { value: "UNKNOWN", labelKey: "fw_unknown" },
  { value: "NOT_REGULATED", labelKey: "fw_not_regulated" },
  { value: "DRUG", labelKey: "fw_drug" },
  { value: "MEDICAL_DEVICE", labelKey: "fw_device" },
];
const REGULATORY_CLASS_OPTIONS: Record<string, readonly Opt[]> = {
  UNKNOWN: [{ value: "UNKNOWN", labelKey: "rc_unknown_paren" }],
  NOT_REGULATED: [{ value: "NOT_APPLICABLE", labelKey: "rc_not_applicable" }],
  DRUG: [
    { value: "UNKNOWN", labelKey: "rc_unknown" },
    { value: "HOUSEHOLD_REMEDY", labelKey: "rc_household" },
    { value: "DANGEROUS_DRUG", labelKey: "rc_dangerous" },
    { value: "SPECIALLY_CONTROLLED_DRUG", labelKey: "rc_special" },
    { value: "OTHER_DRUG", labelKey: "rc_other_drug" },
  ],
  MEDICAL_DEVICE: [
    { value: "UNKNOWN", labelKey: "rc_unknown" },
    { value: "MEDICAL_DEVICE_CLASS_1", labelKey: "rc_class1" },
    { value: "MEDICAL_DEVICE_CLASS_2", labelKey: "rc_class2" },
    { value: "MEDICAL_DEVICE_CLASS_3", labelKey: "rc_class3" },
    { value: "MEDICAL_DEVICE_CLASS_4", labelKey: "rc_class4" },
  ],
};
const REGULATORY_EVIDENCE_OPTIONS: readonly Opt[] = [
  { value: "UNKNOWN", labelKey: "ev_unknown" },
  { value: "PRODUCT_LABEL", labelKey: "ev_label" },
  { value: "FDA_REGISTRATION", labelKey: "ev_fda_reg" },
  { value: "FDA_ANNOUNCEMENT", labelKey: "ev_fda_ann" },
  { value: "SUPPLIER_DOCUMENT", labelKey: "ev_supplier" },
  { value: "PHARMACIST_REVIEW", labelKey: "ev_pharmacist" },
];

export default function PharmacyProtocolsPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<any | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [policyForm] = Form.useForm();
  const [policyEditing, setPolicyEditing] = useState<any | null>(null);
  const [policyEditorOpen, setPolicyEditorOpen] = useState(false);
  const [policySearchInput, setPolicySearchInput] = useState("");
  const [policySearch, setPolicySearch] = useState("");
  const [policyPage, setPolicyPage] = useState(1);
  const [policyPageSize, setPolicyPageSize] = useState(20);
  const canManage = can("pharmacy.protocol.manage");
  const selectedProductType = Form.useWatch("productType", policyForm) || "UNKNOWN";
  const selectedRegulatoryFramework = Form.useWatch("regulatoryFramework", policyForm) || "UNKNOWN";
  const selectedEvidenceSource = Form.useWatch("regulatoryEvidenceSource", policyForm) || "UNKNOWN";
  const queryOptions = {
    skip: permsLoading || !can("pharmacy.assessment.read"),
    fetchPolicy: "cache-and-network",
  } as const;
  const {
    data: protocolData,
    loading: protocolsLoading,
    error: protocolsError,
    refetch: refetchProtocols,
  } = useQuery(Q_PROTOCOLS, queryOptions);
  const {
    data: productPolicyData,
    loading: productPoliciesLoading,
    error: productPoliciesError,
    refetch: refetchProductPolicies,
  } = useQuery(Q_PRODUCT_POLICIES, {
    ...queryOptions,
    variables: {
      search: policySearch || null,
      limit: policyPageSize,
      offset: (policyPage - 1) * policyPageSize,
    },
  });
  const [setEnabled] = useMutation(M_SET_ENABLED, {
    onCompleted: () => { message.success(t("admin_pharmacy_protocols.saved")); refetchProtocols(); },
    onError: (e) => message.error(e?.message || t("admin_pharmacy_protocols.save_failed")),
  });
  const [upsert, { loading: saving }] = useMutation(M_UPSERT);
  const [submitReview] = useMutation(M_SUBMIT);
  const [review] = useMutation(M_REVIEW);
  const [loadProtocolDetail] = useLazyQuery(Q_PROTOCOL_DETAIL, { fetchPolicy: "network-only" });
  const [upsertProductPolicy, { loading: savingPolicy }] = useMutation(M_UPSERT_PRODUCT_POLICY);
  const [submitProductPolicy] = useMutation(M_SUBMIT_PRODUCT_POLICY);
  const [reviewProductPolicy] = useMutation(M_REVIEW_PRODUCT_POLICY);

  const openPolicyEditor = (row?: any) => {
    setPolicyEditing(row || null);
    policyForm.resetFields();
    policyForm.setFieldsValue({
      productSku: row?.productSku || "",
      productType: row?.productType || "UNKNOWN",
      regulatoryFramework: row?.regulatoryFramework || "UNKNOWN",
      regulatoryClass: row?.regulatoryClass || "UNKNOWN",
      regulatoryEvidenceSource: row?.regulatoryEvidenceSource || "UNKNOWN",
      regulatoryEvidenceRef: row?.regulatoryEvidenceRef || "",
      salePolicy: row?.salePolicy || "PHARMACIST_APPROVAL",
      registrationNo: row?.registrationNo || "",
      maxQuantity: row?.maxQuantity ?? null,
    });
    setPolicyEditorOpen(true);
  };

  const saveProductPolicy = async () => {
    try {
      const values = await policyForm.validateFields();
      await upsertProductPolicy({ variables: { input: values } });
      message.success(t("admin_pharmacy_protocols.policy_draft_saved"));
      setPolicyEditorOpen(false);
      refetchProductPolicies();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || t("admin_pharmacy_protocols.policy_save_failed"));
    }
  };

  const transitionProductPolicy = async (row: any, decision?: "APPROVE" | "REJECT") => {
    try {
      if (decision) {
        await reviewProductPolicy({ variables: { productSku: row.productSku, decision } });
      } else {
        await submitProductPolicy({ variables: { productSku: row.productSku } });
      }
      message.success(decision === "APPROVE" ? t("admin_pharmacy_protocols.policy_approved") : decision === "REJECT" ? t("admin_pharmacy_protocols.sent_back_draft") : t("admin_pharmacy_protocols.sent_for_review"));
      refetchProductPolicies();
    } catch (error: any) {
      message.error(error?.message || t("admin_pharmacy_protocols.action_failed"));
    }
  };

  const openEditor = async (row?: any) => {
    let value = row || null;
    if (row?.id) {
      try {
        const result = await loadProtocolDetail({ variables: { id: row.id } });
        value = result.data?.bmsPharmacyProtocol;
        if (!value) throw new Error(t("admin_pharmacy_protocols.protocol_detail_missing"));
      } catch (error: any) {
        message.error(error?.message || t("admin_pharmacy_protocols.protocol_detail_failed"));
        return;
      }
    }
    setEditing(value);
    form.setFieldsValue({
      protocolKey: value?.protocolKey || "",
      name: value?.name || "",
      version: value?.version || 1,
      supportedSymptomGroup: value?.supportedSymptomGroup || "",
      displayLabel: value?.displayLabel || "",
      triggerTerms: (value?.triggerTerms || []).join(", "),
      requiredFields: JSON.stringify(value?.requiredFields || [], null, 2),
      conditionalQuestions: JSON.stringify(value?.conditionalQuestions || [], null, 2),
      redFlagRules: JSON.stringify(value?.redFlagRules || [], null, 2),
      completionRules: JSON.stringify(value?.completionRules || { requireAllOf: [] }, null, 2),
      escalationRules: JSON.stringify(value?.escalationRules || {}, null, 2),
    });
    setEditorOpen(true);
  };

  const saveProtocol = async () => {
    try {
      const values = await form.validateFields();
      const parse = (key: string) => {
        try { return JSON.parse(values[key]); } catch { throw new Error(t("admin_pharmacy_protocols.json_invalid", { key })); }
      };
      await upsert({ variables: { input: {
        id: editing?.id,
        protocolKey: values.protocolKey,
        name: values.name,
        version: values.version,
        supportedSymptomGroup: values.supportedSymptomGroup,
        displayLabel: values.displayLabel,
        triggerTerms: String(values.triggerTerms || "").split(",").map((value) => value.trim()).filter(Boolean),
        requiredFields: parse("requiredFields"),
        conditionalQuestions: parse("conditionalQuestions"),
        redFlagRules: parse("redFlagRules"),
        completionRules: parse("completionRules"),
        escalationRules: parse("escalationRules"),
      } } });
      message.success(t("admin_pharmacy_protocols.draft_saved"));
      setEditorOpen(false);
      refetchProtocols();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || t("admin_pharmacy_protocols.save_failed"));
    }
  };

  const transition = async (row: any, decision?: "APPROVE" | "REJECT") => {
    try {
      if (decision) await review({ variables: { id: row.id, decision } });
      else await submitReview({ variables: { id: row.id } });
      message.success(decision === "APPROVE" ? t("admin_pharmacy_protocols.clinical_approved") : decision === "REJECT" ? t("admin_pharmacy_protocols.sent_back_draft") : t("admin_pharmacy_protocols.sent_for_review"));
      refetchProtocols();
    } catch (error: any) {
      message.error(error?.message || t("admin_pharmacy_protocols.action_failed"));
    }
  };

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert closable type="warning" showIcon message={t("admin_pharmacy_protocols.no_permission")} />;
  }

  const rows = protocolData?.bmsPharmacyProtocols || [];
  const columns = [
    { title: "Protocol", dataIndex: "name", key: "name" },
    { title: "Key", dataIndex: "protocolKey", key: "protocolKey" },
    { title: "Version", dataIndex: "version", key: "version" },
    { title: "Symptom group", dataIndex: "supportedSymptomGroup", key: "supportedSymptomGroup" },
    {
      title: t("admin_pharmacy_protocols.col_clinical_cert"),
      dataIndex: "clinicallyApproved",
      key: "clinicallyApproved",
      render: (v: boolean) => (v ? <Tag color="green">{t("admin_pharmacy_protocols.tag_certified")}</Tag> : <Tag color="red">{t("admin_pharmacy_protocols.tag_draft_uncertified")}</Tag>),
    },
    {
      title: "Platform allowlist",
      dataIndex: "platformAllowed",
      key: "platformAllowed",
      render: (v: boolean) => v ? <Tag color="green">{t("admin_pharmacy_protocols.tag_allowed")}</Tag> : <Tag color="orange">{t("admin_pharmacy_protocols.tag_not_in_env")}</Tag>,
    },
    {
      title: t("admin_pharmacy_protocols.col_enabled"),
      dataIndex: "enabled",
      key: "enabled",
      render: (v: boolean, row: any) => (
        <Switch
          checked={v}
          disabled={!canManage || (!v && (!row.clinicallyApproved || row.status !== "APPROVED"))}
          onChange={(checked) => setEnabled({ variables: { id: row.id, enabled: checked } })}
        />
      ),
    },
    { title: t("admin_pharmacy_protocols.col_last_reviewer"), dataIndex: "reviewedBy", key: "reviewedBy", render: (v: string | null) => v || "—" },
    {
      title: t("admin_pharmacy_protocols.col_actions"),
      key: "actions",
      render: (_: unknown, row: any) => (
        <Space wrap>
          {row.status === "DRAFT" && <Button size="small" disabled={!canManage} onClick={() => void openEditor(row)}>{t("admin_pharmacy_protocols.btn_edit")}</Button>}
          {row.status === "DRAFT" && <Popconfirm title={t("admin_pharmacy_protocols.confirm_send_protocol_review")} onConfirm={() => transition(row)}><Button size="small" disabled={!canManage}>{t("admin_pharmacy_protocols.btn_send_review")}</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Popconfirm title={t("admin_pharmacy_protocols.confirm_clinical_reviewed")} onConfirm={() => transition(row, "APPROVE")}><Button size="small" type="primary" disabled={!canManage}>Clinical approve</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Button size="small" danger disabled={!canManage} onClick={() => transition(row, "REJECT")}>{t("admin_pharmacy_protocols.btn_send_back_draft")}</Button>}
        </Space>
      ),
    },
  ];
  const policyRows = productPolicyData?.bmsPharmacyProductPolicies?.items || [];
  const policyTotal = productPolicyData?.bmsPharmacyProductPolicies?.total || 0;
  const unconfiguredProductOptions = policyRows
    .filter((row: any) => row.status === "MISSING")
    .map((row: any) => ({
      value: row.productSku,
      label: `${row.productName || row.productSku} (${row.productSku})`,
    }));
  const allowedFrameworkOptions = selectedProductType === "GENERAL_PRODUCT"
    ? REGULATORY_FRAMEWORK_OPTIONS.filter((option) => option.value === "NOT_REGULATED")
    : selectedProductType === "DRUG" || selectedProductType === "HOUSEHOLD_REMEDY"
      ? REGULATORY_FRAMEWORK_OPTIONS.filter((option) => option.value === "DRUG")
      : selectedProductType === "MEDICAL_DEVICE"
        ? REGULATORY_FRAMEWORK_OPTIONS.filter((option) => option.value === "MEDICAL_DEVICE")
        : selectedProductType === "MEDICAL_SUPPLY"
          ? REGULATORY_FRAMEWORK_OPTIONS.filter((option) => ["UNKNOWN", "NOT_REGULATED", "MEDICAL_DEVICE"].includes(option.value))
          : REGULATORY_FRAMEWORK_OPTIONS.filter((option) => option.value === "UNKNOWN");
  const allowedEvidenceOptions = selectedRegulatoryFramework === "UNKNOWN"
    ? REGULATORY_EVIDENCE_OPTIONS.filter((option) => option.value === "UNKNOWN")
    : ["DRUG", "MEDICAL_DEVICE"].includes(selectedRegulatoryFramework)
      ? REGULATORY_EVIDENCE_OPTIONS
      : REGULATORY_EVIDENCE_OPTIONS.filter((option) => option.value !== "FDA_REGISTRATION");
  const policyColumns = [
    { title: t("admin_pharmacy_protocols.col_product"), dataIndex: "productName", key: "productName" },
    { title: "SKU", dataIndex: "productSku", key: "productSku" },
    { title: t("admin_pharmacy_protocols.col_type"), dataIndex: "productType", key: "productType" },
    { title: t("admin_pharmacy_protocols.col_framework"), dataIndex: "regulatoryFramework", key: "regulatoryFramework" },
    { title: "Regulatory class", dataIndex: "regulatoryClass", key: "regulatoryClass" },
    { title: "Sale policy", dataIndex: "salePolicy", key: "salePolicy", render: (value: string) => <Tag color={value === "DIRECT_SALE" ? "green" : value === "ONLINE_SALE_PROHIBITED" ? "red" : "orange"}>{value}</Tag> },
    { title: t("admin_pharmacy_protocols.col_max_qty"), dataIndex: "maxQuantity", key: "maxQuantity", render: (value: number | null) => value ?? "—" },
    { title: t("admin_pharmacy_protocols.col_status"), dataIndex: "status", key: "status", render: (value: string) => <Tag color={value === "APPROVED" ? "green" : value === "PENDING_REVIEW" ? "blue" : "default"}>{value}</Tag> },
    {
      title: t("admin_pharmacy_protocols.col_actions"),
      key: "actions",
      render: (_: unknown, row: any) => (
        <Space wrap>
          {row.status !== "PENDING_REVIEW" && <Button size="small" disabled={!canManage} onClick={() => openPolicyEditor(row)}>{row.status === "MISSING" ? t("admin_pharmacy_protocols.btn_configure") : t("admin_pharmacy_protocols.btn_edit")}</Button>}
          {row.status === "DRAFT" && <Popconfirm title={t("admin_pharmacy_protocols.confirm_send_policy_review")} onConfirm={() => transitionProductPolicy(row)}><Button size="small" disabled={!canManage}>ส่งตรวจ</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Popconfirm title={t("admin_pharmacy_protocols.confirm_policy_reviewed")} onConfirm={() => transitionProductPolicy(row, "APPROVE")}><Button size="small" type="primary" disabled={!canManage}>เภสัชกรอนุมัติ</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Button size="small" danger disabled={!canManage} onClick={() => transitionProductPolicy(row, "REJECT")}>{t("admin_pharmacy_protocols.btn_send_back_draft")}</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>AI Pharmacy Intake — Protocols</Typography.Title>}>
        <Link href="/admin/pharmacy-manual"><Button icon={<ReadOutlined />}>Pharmacist manual</Button></Link>
      </AdminPageHeader>
      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacy_protocols.protocol_draft_notice")}
      />
      <Button type="primary" disabled={!canManage} onClick={() => void openEditor()} style={{ marginBottom: 12 }}>{t("admin_pharmacy_protocols.btn_create_protocol_draft")}</Button>
      {protocolsError && (
        <Alert closable
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("admin_pharmacy_protocols.protocol_load_error")}
          description={protocolsError.message}
          action={<Button size="small" onClick={() => refetchProtocols()}>{t("admin_pharmacy_protocols.btn_retry")}</Button>}
        />
      )}
      <Table rowKey="id" loading={protocolsLoading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
      <Divider />
      <Typography.Title level={4}>Pharmacy Product Policy</Typography.Title>
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacy_protocols.policy_required_notice")}
        description={t("admin_pharmacy_protocols.policy_required_desc")}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder={t("admin_pharmacy_protocols.search_placeholder")}
          allowClear
          style={{ width: 320 }}
          value={policySearchInput}
          onChange={(e) => {
            const next = e.target.value;
            setPolicySearchInput(next);
            if (!next.trim()) {
              setPolicyPage(1);
              setPolicySearch("");
            }
          }}
          onSearch={(value) => {
            setPolicyPage(1);
            setPolicySearch(value.trim());
          }}
        />
        <Typography.Text type="secondary">
          {t("admin_pharmacy_protocols.total_skus", { n: policyTotal.toLocaleString() })}
        </Typography.Text>
      </Space>
      {productPoliciesError && (
        <Alert closable
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("admin_pharmacy_protocols.policy_load_error")}
          description={
            <Space direction="vertical" size={2}>
              <span>{productPoliciesError.message}</span>
              <span>{t("admin_pharmacy_protocols.policy_load_error_hint")}</span>
            </Space>
          }
          action={<Button size="small" onClick={() => refetchProductPolicies()}>{t("admin_pharmacy_protocols.btn_retry")}</Button>}
        />
      )}
      <Button
        type="primary"
        disabled={!canManage || Boolean(productPoliciesError) || unconfiguredProductOptions.length === 0}
        title={unconfiguredProductOptions.length === 0 ? t("admin_pharmacy_protocols.all_configured_tooltip") : undefined}
        onClick={() => openPolicyEditor()}
        style={{ marginBottom: 12 }}
      >
        {t("admin_pharmacy_protocols.btn_create_policy_draft")}
      </Button>
      <Table
        rowKey="id"
        loading={productPoliciesLoading}
        dataSource={policyRows}
        columns={policyColumns}
        scroll={{ x: "max-content" }}
        pagination={{
          current: policyPage,
          pageSize: policyPageSize,
          total: policyTotal,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `Total ${total} SKU`,
          onChange: (page, pageSize) => {
            setPolicyPage(page);
            setPolicyPageSize(pageSize || 20);
          },
        }}
      />
      <Modal title={editing ? t("admin_pharmacy_protocols.modal_edit_protocol") : t("admin_pharmacy_protocols.modal_create_protocol")} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={saveProtocol} confirmLoading={saving} width={920}>
        <Alert closable
          type="info"
          showIcon
          message={t("admin_pharmacy_protocols.modal_protocol_notice")}
          description={t("admin_pharmacy_protocols.compound_redflag_hint")}
          style={{ marginBottom: 12 }}
        />
        <Form form={form} layout="vertical">
          <Space align="start" wrap>
            <Form.Item name="protocolKey" label="Protocol key" rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="fever" /></Form.Item>
            <Form.Item name="version" label="Version" rules={[{ required: true }]}><InputNumber min={1} disabled={Boolean(editing)} /></Form.Item>
            <Form.Item name="displayLabel" label={t("admin_pharmacy_protocols.form_display_label")} rules={[{ required: true }]}><Input placeholder="ไข้" /></Form.Item>{/* placeholder เป็นตัวอย่าง "รูปแบบข้อมูล" ที่ต้องกรอกเป็นไทย ไม่ใช่ UI copy — trigger term/label ถูก match กับข้อความไทยที่คนไข้พิมพ์ ถ้าแปลเป็นอังกฤษแอดมินจะกรอกคำอังกฤษแล้ว match ไม่เจอ */}
          </Space>
          <Form.Item name="name" label={t("admin_pharmacy_protocols.form_protocol_name")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="supportedSymptomGroup" label="Symptom group" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="triggerTerms" label={t("admin_pharmacy_protocols.form_trigger_terms")} rules={[{ required: true }]}><Input placeholder="ไข้, ตัวร้อน, fever" /></Form.Item>
          {[
            ["requiredFields", "Required fields JSON"], ["conditionalQuestions", "Conditional questions JSON"],
            ["redFlagRules", "Red flag rules JSON"], ["completionRules", "Completion rules JSON"],
            ["escalationRules", "Escalation rules JSON"],
          ].map(([name, label]) => <Form.Item key={name} name={name} label={label} rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} style={{ fontFamily: "monospace" }} /></Form.Item>)}
        </Form>
      </Modal>
      <Modal title={policyEditing && policyEditing.status !== "MISSING" ? t("admin_pharmacy_protocols.modal_edit_policy") : t("admin_pharmacy_protocols.modal_create_policy")} open={policyEditorOpen} onCancel={() => setPolicyEditorOpen(false)} onOk={saveProductPolicy} confirmLoading={savingPolicy} width={720}>
        {policyEditing?.status === "APPROVED" && <Alert closable type="warning" showIcon style={{ marginBottom: 12 }} message={t("admin_pharmacy_protocols.approved_edit_warning2")} />}
        {(!policyEditing || policyEditing.status === "MISSING") && <Alert closable type="info" showIcon style={{ marginBottom: 12 }} message={t("admin_pharmacy_protocols.pick_from_catalog2")} />}
        <Form form={policyForm} layout="vertical">
          <Form.Item
            name="productSku"
            label={t("admin_pharmacy_protocols.form_product_sku")}
            rules={[{ required: true, message: t("admin_pharmacy_protocols.form_product_required") }]}
          >
            <Select
              showSearch
              disabled={Boolean(policyEditing)}
              placeholder={unconfiguredProductOptions.length ? t("admin_pharmacy_protocols.form_product_placeholder_unconfigured") : t("admin_pharmacy_protocols.form_product_placeholder_all_done")}
              optionFilterProp="label"
              options={policyEditing
                ? [{ value: policyEditing.productSku, label: `${policyEditing.productName || policyEditing.productSku} (${policyEditing.productSku})` }]
                : unconfiguredProductOptions}
            />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item name="productType" label={t("admin_pharmacy_protocols.form_product_type")} rules={[{ required: true }]}>
              <Select
                style={{ width: 300 }}
                options={withLabels(PRODUCT_TYPE_OPTIONS, t)}
                onChange={(productType) => {
                  const next = productType === "DRUG"
                    ? { framework: "DRUG", regulatoryClass: "UNKNOWN" }
                    : productType === "HOUSEHOLD_REMEDY"
                      ? { framework: "DRUG", regulatoryClass: "HOUSEHOLD_REMEDY" }
                      : productType === "MEDICAL_DEVICE"
                        ? { framework: "MEDICAL_DEVICE", regulatoryClass: "UNKNOWN" }
                        : productType === "GENERAL_PRODUCT"
                          ? { framework: "NOT_REGULATED", regulatoryClass: "NOT_APPLICABLE" }
                          : { framework: "UNKNOWN", regulatoryClass: "UNKNOWN" };
                  policyForm.setFieldsValue({
                    regulatoryFramework: next.framework,
                    regulatoryClass: next.regulatoryClass,
                  });
                }}
              />
            </Form.Item>
            <Form.Item name="salePolicy" label={t("admin_pharmacy_protocols.form_sale_policy")} rules={[{ required: true }]}>
              <Select style={{ width: 330 }} options={withLabels(SALE_POLICY_OPTIONS, t)} />
            </Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="regulatoryFramework" label={t("admin_pharmacy_protocols.form_framework")} rules={[{ required: true }]}>
              <Select
                style={{ width: 300 }}
                options={withLabels(allowedFrameworkOptions, t)}
                onChange={(framework) => {
                  policyForm.setFieldsValue({
                    regulatoryClass: REGULATORY_CLASS_OPTIONS[framework]?.[0]?.value || "UNKNOWN",
                    regulatoryEvidenceSource: "UNKNOWN",
                    regulatoryEvidenceRef: "",
                  });
                  if (framework !== "DRUG" && framework !== "MEDICAL_DEVICE") policyForm.setFieldValue("registrationNo", "");
                }}
              />
            </Form.Item>
            <Form.Item name="regulatoryClass" label={t("admin_pharmacy_protocols.form_regulatory_class")} extra={t("admin_pharmacy_protocols.form_regulatory_class_extra")} rules={[{ required: true }]}>
              <Select style={{ width: 330 }} options={withLabels(REGULATORY_CLASS_OPTIONS[selectedRegulatoryFramework] || REGULATORY_CLASS_OPTIONS.UNKNOWN, t)} />
            </Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="regulatoryEvidenceSource" label={t("admin_pharmacy_protocols.form_evidence_source")} rules={[{ required: true }]}>
              <Select style={{ width: 300 }} options={withLabels(allowedEvidenceOptions, t)} />
            </Form.Item>
            <Form.Item
              name="regulatoryEvidenceRef"
              label={t("admin_pharmacy_protocols.form_evidence_detail")}
              rules={[{
                required: ["FDA_ANNOUNCEMENT", "SUPPLIER_DOCUMENT", "PHARMACIST_REVIEW"].includes(selectedEvidenceSource),
                message: t("admin_pharmacy_protocols.form_evidence_detail_required"),
              }]}
            >
              <Input style={{ width: 330 }} placeholder={t("admin_pharmacy_protocols.form_evidence_detail_placeholder")} />
            </Form.Item>
          </Space>
          {["DRUG", "MEDICAL_DEVICE"].includes(selectedRegulatoryFramework) && (
            <Form.Item
              name="registrationNo"
              label={t("admin_pharmacy_protocols.form_fda_number")}
              extra={selectedEvidenceSource === "FDA_REGISTRATION" ? t("admin_pharmacy_protocols.form_fda_extra_required") : t("admin_pharmacy_protocols.form_fda_extra_optional")}
              rules={[{ required: selectedEvidenceSource === "FDA_REGISTRATION", message: t("admin_pharmacy_protocols.form_fda_required_msg") }]}
            >
              <Input placeholder={t("admin_pharmacy_protocols.form_fda_placeholder")} />
            </Form.Item>
          )}
          <Form.Item name="maxQuantity" label={t("admin_pharmacy_protocols.form_max_qty")}><InputNumber min={1} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
