'use client';
import { gql, useLazyQuery, useQuery, useMutation } from "@apollo/client";
import { Alert, Button, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Switch, message } from "antd";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

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

const PRODUCT_TYPE_OPTIONS = [
  { value: "UNKNOWN", label: "ยังไม่ทราบ (UNKNOWN)" },
  { value: "GENERAL_PRODUCT", label: "สินค้าทั่วไป (GENERAL_PRODUCT)" },
  { value: "MEDICAL_SUPPLY", label: "วัสดุการแพทย์ (MEDICAL_SUPPLY)" },
  { value: "MEDICAL_DEVICE", label: "เครื่องมือแพทย์ (MEDICAL_DEVICE)" },
  { value: "HOUSEHOLD_REMEDY", label: "ยาสามัญประจำบ้าน (HOUSEHOLD_REMEDY)" },
  { value: "DRUG", label: "ยา (DRUG)" },
];
const SALE_POLICY_OPTIONS = [
  { value: "DIRECT_SALE", label: "ขายตรงได้ (DIRECT_SALE)" },
  { value: "SHORT_SAFETY_CHECK", label: "ตรวจความปลอดภัยแบบสั้นก่อนขาย" },
  { value: "PHARMACIST_APPROVAL", label: "เภสัชกรต้องอนุมัติก่อนขาย" },
  { value: "PRESCRIPTION_REQUIRED", label: "ต้องมีใบสั่งยา" },
  { value: "ONLINE_SALE_PROHIBITED", label: "ห้ามขายออนไลน์" },
];
const REGULATORY_FRAMEWORK_OPTIONS = [
  { value: "UNKNOWN", label: "ยังไม่ทราบ — รอตรวจเอกสาร" },
  { value: "NOT_REGULATED", label: "ไม่อยู่ในกลุ่มยา/เครื่องมือแพทย์" },
  { value: "DRUG", label: "ยา" },
  { value: "MEDICAL_DEVICE", label: "เครื่องมือแพทย์" },
];
const REGULATORY_CLASS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  UNKNOWN: [{ value: "UNKNOWN", label: "ยังไม่ทราบ (UNKNOWN)" }],
  NOT_REGULATED: [{ value: "NOT_APPLICABLE", label: "ไม่เกี่ยวข้อง (NOT_APPLICABLE)" }],
  DRUG: [
    { value: "UNKNOWN", label: "ยังไม่ทราบ" },
    { value: "HOUSEHOLD_REMEDY", label: "ยาสามัญประจำบ้าน" },
    { value: "DANGEROUS_DRUG", label: "ยาอันตราย" },
    { value: "SPECIALLY_CONTROLLED_DRUG", label: "ยาควบคุมพิเศษ" },
    { value: "OTHER_DRUG", label: "ยาประเภทอื่นตามเอกสารกำกับ" },
  ],
  MEDICAL_DEVICE: [
    { value: "UNKNOWN", label: "ยังไม่ทราบ" },
    { value: "MEDICAL_DEVICE_CLASS_1", label: "เครื่องมือแพทย์ Class 1" },
    { value: "MEDICAL_DEVICE_CLASS_2", label: "เครื่องมือแพทย์ Class 2" },
    { value: "MEDICAL_DEVICE_CLASS_3", label: "เครื่องมือแพทย์ Class 3" },
    { value: "MEDICAL_DEVICE_CLASS_4", label: "เครื่องมือแพทย์ Class 4" },
  ],
};
const REGULATORY_EVIDENCE_OPTIONS = [
  { value: "UNKNOWN", label: "ยังไม่มีหลักฐาน" },
  { value: "PRODUCT_LABEL", label: "ฉลาก/เอกสารกำกับผลิตภัณฑ์" },
  { value: "FDA_REGISTRATION", label: "ข้อมูลทะเบียน อย." },
  { value: "FDA_ANNOUNCEMENT", label: "ประกาศหรือหลักเกณฑ์ของ อย." },
  { value: "SUPPLIER_DOCUMENT", label: "เอกสารจากผู้ผลิต/ผู้จำหน่าย" },
  { value: "PHARMACIST_REVIEW", label: "บันทึกการตรวจโดยเภสัชกร" },
];

export default function PharmacyProtocolsPage() {
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
    onCompleted: () => { message.success("บันทึกแล้ว"); refetchProtocols(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
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
      message.success("บันทึก Product Policy เป็น Draft แล้ว");
      setPolicyEditorOpen(false);
      refetchProductPolicies();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || "บันทึก Product Policy ไม่สำเร็จ");
    }
  };

  const transitionProductPolicy = async (row: any, decision?: "APPROVE" | "REJECT") => {
    try {
      if (decision) {
        await reviewProductPolicy({ variables: { productSku: row.productSku, decision } });
      } else {
        await submitProductPolicy({ variables: { productSku: row.productSku } });
      }
      message.success(decision === "APPROVE" ? "เภสัชกรอนุมัติ Product Policy แล้ว" : decision === "REJECT" ? "ส่งกลับเป็น Draft แล้ว" : "ส่งให้เภสัชกรตรวจแล้ว");
      refetchProductPolicies();
    } catch (error: any) {
      message.error(error?.message || "ดำเนินการไม่สำเร็จ");
    }
  };

  const openEditor = async (row?: any) => {
    let value = row || null;
    if (row?.id) {
      try {
        const result = await loadProtocolDetail({ variables: { id: row.id } });
        value = result.data?.bmsPharmacyProtocol;
        if (!value) throw new Error("ไม่พบรายละเอียด Protocol");
      } catch (error: any) {
        message.error(error?.message || "โหลดรายละเอียด Protocol ไม่สำเร็จ — กรุณา deploy backend รุ่นใหม่");
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
        try { return JSON.parse(values[key]); } catch { throw new Error(`${key} ต้องเป็น JSON ที่ถูกต้อง`); }
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
      message.success("บันทึก Draft แล้ว");
      setEditorOpen(false);
      refetchProtocols();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || "บันทึกไม่สำเร็จ");
    }
  };

  const transition = async (row: any, decision?: "APPROVE" | "REJECT") => {
    try {
      if (decision) await review({ variables: { id: row.id, decision } });
      else await submitReview({ variables: { id: row.id } });
      message.success(decision === "APPROVE" ? "อนุมัติทางคลินิกแล้ว — ยังไม่ได้เปิดใช้งาน" : decision === "REJECT" ? "ส่งกลับเป็น Draft แล้ว" : "ส่งให้เภสัชกรตรวจแล้ว");
      refetchProtocols();
    } catch (error: any) {
      message.error(error?.message || "ดำเนินการไม่สำเร็จ");
    }
  };

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }

  const rows = protocolData?.bmsPharmacyProtocols || [];
  const columns = [
    { title: "Protocol", dataIndex: "name", key: "name" },
    { title: "Key", dataIndex: "protocolKey", key: "protocolKey" },
    { title: "Version", dataIndex: "version", key: "version" },
    { title: "Symptom group", dataIndex: "supportedSymptomGroup", key: "supportedSymptomGroup" },
    {
      title: "การรับรองทางคลินิก",
      dataIndex: "clinicallyApproved",
      key: "clinicallyApproved",
      render: (v: boolean) => (v ? <Tag color="green">ผ่านการรับรองแล้ว</Tag> : <Tag color="red">DRAFT — ยังไม่ผ่านการรับรอง</Tag>),
    },
    {
      title: "Platform allowlist",
      dataIndex: "platformAllowed",
      key: "platformAllowed",
      render: (v: boolean) => v ? <Tag color="green">อนุญาต</Tag> : <Tag color="orange">ยังไม่อยู่ใน ENV</Tag>,
    },
    {
      title: "เปิดใช้งาน",
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
    { title: "ผู้ตรวจล่าสุด", dataIndex: "reviewedBy", key: "reviewedBy", render: (v: string | null) => v || "—" },
    {
      title: "จัดการ",
      key: "actions",
      render: (_: unknown, row: any) => (
        <Space wrap>
          {row.status === "DRAFT" && <Button size="small" disabled={!canManage} onClick={() => void openEditor(row)}>แก้ไข</Button>}
          {row.status === "DRAFT" && <Popconfirm title="ส่ง Protocol ให้เภสัชกรตรวจ?" onConfirm={() => transition(row)}><Button size="small" disabled={!canManage}>ส่งตรวจ</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Popconfirm title="ยืนยันว่าได้ตรวจ clinical rules ครบแล้ว?" onConfirm={() => transition(row, "APPROVE")}><Button size="small" type="primary" disabled={!canManage}>Clinical approve</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Button size="small" danger disabled={!canManage} onClick={() => transition(row, "REJECT")}>ส่งกลับ Draft</Button>}
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
    { title: "สินค้า", dataIndex: "productName", key: "productName" },
    { title: "SKU", dataIndex: "productSku", key: "productSku" },
    { title: "ประเภท", dataIndex: "productType", key: "productType" },
    { title: "กรอบกำกับ", dataIndex: "regulatoryFramework", key: "regulatoryFramework" },
    { title: "Regulatory class", dataIndex: "regulatoryClass", key: "regulatoryClass" },
    { title: "Sale policy", dataIndex: "salePolicy", key: "salePolicy", render: (value: string) => <Tag color={value === "DIRECT_SALE" ? "green" : value === "ONLINE_SALE_PROHIBITED" ? "red" : "orange"}>{value}</Tag> },
    { title: "จำนวนสูงสุด", dataIndex: "maxQuantity", key: "maxQuantity", render: (value: number | null) => value ?? "—" },
    { title: "สถานะ", dataIndex: "status", key: "status", render: (value: string) => <Tag color={value === "APPROVED" ? "green" : value === "PENDING_REVIEW" ? "blue" : "default"}>{value}</Tag> },
    {
      title: "จัดการ",
      key: "actions",
      render: (_: unknown, row: any) => (
        <Space wrap>
          {row.status !== "PENDING_REVIEW" && <Button size="small" disabled={!canManage} onClick={() => openPolicyEditor(row)}>{row.status === "MISSING" ? "ตั้งค่า" : "แก้ไข"}</Button>}
          {row.status === "DRAFT" && <Popconfirm title="ส่ง Product Policy ให้เภสัชกรตรวจ?" onConfirm={() => transitionProductPolicy(row)}><Button size="small" disabled={!canManage}>ส่งตรวจ</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Popconfirm title="ยืนยันว่าได้ตรวจประเภทผลิตภัณฑ์และเงื่อนไขการขายแล้ว?" onConfirm={() => transitionProductPolicy(row, "APPROVE")}><Button size="small" type="primary" disabled={!canManage}>เภสัชกรอนุมัติ</Button></Popconfirm>}
          {row.status === "PENDING_REVIEW" && <Button size="small" danger disabled={!canManage} onClick={() => transitionProductPolicy(row, "REJECT")}>ส่งกลับ Draft</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>AI Pharmacy Intake — Protocols</Typography.Title>} />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Protocol ใหม่เริ่มเป็น Draft เสมอ ต้องผ่านการตรวจและ Clinical approve โดยเภสัชกรที่มีใบอนุญาตก่อนจึงเปิดใช้งานได้"
      />
      <Button type="primary" disabled={!canManage} onClick={() => void openEditor()} style={{ marginBottom: 12 }}>สร้าง Protocol Draft</Button>
      {protocolsError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="โหลด Protocol ไม่ได้"
          description={protocolsError.message}
          action={<Button size="small" onClick={() => refetchProtocols()}>ลองใหม่</Button>}
        />
      )}
      <Table rowKey="id" loading={protocolsLoading} dataSource={rows} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
      <Divider />
      <Typography.Title level={4}>Pharmacy Product Policy</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="SKU ของร้านยาต้องมี Product Policy ที่เภสัชกรอนุมัติก่อนสร้างออร์เดอร์จากช่องทางลูกค้า"
        description="ห้ามจำแนกจากชื่อสินค้าหรือ category อย่างเดียว หากยังไม่ทราบให้เลือก UNKNOWN / PHARMACIST_APPROVAL แล้วส่งตรวจ"
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="ค้นหา SKU หรือชื่อสินค้า"
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
          ทั้งหมด {policyTotal.toLocaleString()} SKU
        </Typography.Text>
      </Space>
      {productPoliciesError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="โหลด Product Policy ไม่ได้"
          description={
            <Space direction="vertical" size={2}>
              <span>{productPoliciesError.message}</span>
              <span>ตรวจว่า backend GraphQL รุ่นใหม่ถูก deploy และ apply migration ถึง 7.73__bms_pharmacy_product_framework_consistency.sql แล้ว</span>
            </Space>
          }
          action={<Button size="small" onClick={() => refetchProductPolicies()}>ลองใหม่</Button>}
        />
      )}
      <Button
        type="primary"
        disabled={!canManage || Boolean(productPoliciesError) || unconfiguredProductOptions.length === 0}
        title={unconfiguredProductOptions.length === 0 ? "ค้นหา SKU ที่ยัง MISSING แล้วกดตั้งค่าจากแถวในตาราง" : undefined}
        onClick={() => openPolicyEditor()}
        style={{ marginBottom: 12 }}
      >
        สร้าง Product Policy Draft
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
      <Modal title={editing ? "แก้ไข Protocol Draft" : "สร้าง Protocol Draft"} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={saveProtocol} confirmLoading={saving} width={920}>
        <Alert
          type="info"
          showIcon
          message="การบันทึกจะสร้าง Draft เท่านั้น ต้องส่งตรวจและให้เภสัชกรที่มีใบอนุญาต Clinical approve ก่อนจึงเปิดใช้ได้"
          description={'Compound red flag ใช้ condition เช่น {"allOf":[{"field":"patient_age_years","lessThan":0.25},{"field":"fever_temp","greaterThanOrEqual":38}]} และ escalationRules.bySeverity แยก EMERGENCY/HIGH/MODERATE/LOW'}
          style={{ marginBottom: 12 }}
        />
        <Form form={form} layout="vertical">
          <Space align="start" wrap>
            <Form.Item name="protocolKey" label="Protocol key" rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="fever" /></Form.Item>
            <Form.Item name="version" label="Version" rules={[{ required: true }]}><InputNumber min={1} disabled={Boolean(editing)} /></Form.Item>
            <Form.Item name="displayLabel" label="ชื่อที่ลูกค้าเห็น" rules={[{ required: true }]}><Input placeholder="ไข้" /></Form.Item>
          </Space>
          <Form.Item name="name" label="ชื่อ Protocol" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="supportedSymptomGroup" label="Symptom group" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="triggerTerms" label="Trigger terms (คั่นด้วย comma)" rules={[{ required: true }]}><Input placeholder="ไข้, ตัวร้อน, fever" /></Form.Item>
          {[
            ["requiredFields", "Required fields JSON"], ["conditionalQuestions", "Conditional questions JSON"],
            ["redFlagRules", "Red flag rules JSON"], ["completionRules", "Completion rules JSON"],
            ["escalationRules", "Escalation rules JSON"],
          ].map(([name, label]) => <Form.Item key={name} name={name} label={label} rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} style={{ fontFamily: "monospace" }} /></Form.Item>)}
        </Form>
      </Modal>
      <Modal title={policyEditing && policyEditing.status !== "MISSING" ? "แก้ไข Product Policy" : "สร้าง Product Policy Draft"} open={policyEditorOpen} onCancel={() => setPolicyEditorOpen(false)} onOk={saveProductPolicy} confirmLoading={savingPolicy} width={720}>
        {policyEditing?.status === "APPROVED" && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="การแก้ไข Policy ที่อนุมัติแล้วจะกลับเป็น Draft และหยุดขายอัตโนมัติจนกว่าเภสัชกรจะอนุมัติใหม่" />}
        {(!policyEditing || policyEditing.status === "MISSING") && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="เลือกสินค้าจาก Catalog แล้วกำหนดเงื่อนไขการขาย การบันทึกครั้งแรกจะเป็น Draft เสมอ" />}
        <Form form={policyForm} layout="vertical">
          <Form.Item
            name="productSku"
            label="สินค้า / Product SKU"
            rules={[{ required: true, message: "กรุณาเลือกสินค้า" }]}
          >
            <Select
              showSearch
              disabled={Boolean(policyEditing)}
              placeholder={unconfiguredProductOptions.length ? "เลือกสินค้าที่ยังไม่มี Product Policy" : "สินค้าทุก SKU มี Product Policy แล้ว"}
              optionFilterProp="label"
              options={policyEditing
                ? [{ value: policyEditing.productSku, label: `${policyEditing.productName || policyEditing.productSku} (${policyEditing.productSku})` }]
                : unconfiguredProductOptions}
            />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item name="productType" label="ประเภทผลิตภัณฑ์" rules={[{ required: true }]}>
              <Select
                style={{ width: 300 }}
                options={PRODUCT_TYPE_OPTIONS}
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
            <Form.Item name="salePolicy" label="นโยบายการขาย" rules={[{ required: true }]}>
              <Select style={{ width: 330 }} options={SALE_POLICY_OPTIONS} />
            </Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="regulatoryFramework" label="กรอบข้อกำกับ" rules={[{ required: true }]}>
              <Select
                style={{ width: 300 }}
                options={allowedFrameworkOptions}
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
            <Form.Item name="regulatoryClass" label="ประเภทตามข้อกำกับ" extra="เลือกจากเอกสาร ไม่ให้ระบบเดาจากชื่อสินค้า" rules={[{ required: true }]}>
              <Select style={{ width: 330 }} options={REGULATORY_CLASS_OPTIONS[selectedRegulatoryFramework] || REGULATORY_CLASS_OPTIONS.UNKNOWN} />
            </Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="regulatoryEvidenceSource" label="แหล่งอ้างอิง" rules={[{ required: true }]}>
              <Select style={{ width: 300 }} options={allowedEvidenceOptions} />
            </Form.Item>
            <Form.Item
              name="regulatoryEvidenceRef"
              label="รายละเอียด/เลขอ้างอิง"
              rules={[{
                required: ["FDA_ANNOUNCEMENT", "SUPPLIER_DOCUMENT", "PHARMACIST_REVIEW"].includes(selectedEvidenceSource),
                message: "กรุณาระบุรายละเอียดหรือเลขอ้างอิง",
              }]}
            >
              <Input style={{ width: 330 }} placeholder="เช่น URL, ชื่อประกาศ หรือเลขเอกสาร" />
            </Form.Item>
          </Space>
          {["DRUG", "MEDICAL_DEVICE"].includes(selectedRegulatoryFramework) && (
            <Form.Item
              name="registrationNo"
              label="เลขทะเบียน/เลขใบรับแจ้ง อย."
              extra={selectedEvidenceSource === "FDA_REGISTRATION" ? "จำเป็นเมื่อเลือกแหล่งอ้างอิงเป็นข้อมูลทะเบียน อย." : "กรอกเมื่อมีข้อมูลบนฉลากหรือเอกสารทางการ"}
              rules={[{ required: selectedEvidenceSource === "FDA_REGISTRATION", message: "กรุณาระบุเลขทะเบียน/เลขใบรับแจ้ง อย." }]}
            >
              <Input placeholder="กรอกตามฉลากหรือฐานข้อมูล อย. โดยไม่เดาเลข" />
            </Form.Item>
          )}
          <Form.Item name="maxQuantity" label="จำนวนสูงสุดต่อออร์เดอร์"><InputNumber min={1} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
