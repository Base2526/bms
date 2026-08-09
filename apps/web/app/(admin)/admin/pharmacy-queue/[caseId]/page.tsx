'use client';

import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Alert,
  Typography,
  Tag,
  Card,
  Button,
  Space,
  Input,
  List,
  Timeline,
  message,
  Divider,
  Row,
  Col,
  Descriptions,
  InputNumber,
  Switch,
  Modal,
  Select,
} from "antd";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MedicineBoxOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import {
  getCompletenessTagMeta,
  getCustomerConfirmationTagMeta,
  formatCustomerConfirmationClipboardText,
  formatCustomerConfirmationValue,
  normalizeCustomerConfirmationLines,
} from "@/lib/bms/pharmacy/customerConfirmation";

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

const Q = gql`
  query PharmacyCase($id: ID!) {
    bmsPharmacyAssessment(id: $id) {
      id status riskLevel version patientRelationship consentStatus conversationId
      biologicalSex pregnancyStatus breastfeedingStatus patientAgeYears
      missingFields conflictingFields anomalies completenessStatus detectedRedFlags
      customerConfirmationStatus customerConfirmationSummary customerConfirmedAt
      structuredAnswers rawMessages aiSummary aiSummaryVersion
      pharmacistDecisionNotes needsManualIntake protocolId medicationSuggestions checkoutOrderDraft
      createdAt updatedAt expiresAt
    }
    bmsPharmacyAssessmentConversationHistory(assessmentId: $id, limit: 100) {
      conversationId channel customerName customerRef status
      messages { id direction body sender createdAt status }
    }
    bmsPharmacyAssessmentEvents(assessmentId: $id, limit: 100) {
      id actor action previousState nextState createdAt
    }
  }
`;

const M_START_REVIEW = gql`mutation($id: ID!) { bmsStartPharmacistReview(assessmentId: $id) { id status version } }`;
const M_REQUEST_MORE = gql`
  mutation($id: ID!, $v: Int!, $fields: [String!]!, $note: String) {
    bmsRequestMoreInformation(assessmentId: $id, expectedVersion: $v, fields: $fields, note: $note) { id status version }
  }
`;
const M_APPROVE = gql`
  mutation($id: ID!, $v: Int!, $resp: String!, $orderDraft: JSON) {
    bmsApproveAssessment(assessmentId: $id, expectedVersion: $v, pharmacistResponse: $resp, orderDraft: $orderDraft) { id status version checkoutOrderDraft }
  }
`;
const M_REJECT = gql`
  mutation($id: ID!, $v: Int!, $reason: String!) {
    bmsRejectAssessment(assessmentId: $id, expectedVersion: $v, reason: $reason) { id status version }
  }
`;
const M_REFER = gql`
  mutation($id: ID!, $v: Int!, $reason: String!) {
    bmsReferAssessmentToDoctor(assessmentId: $id, expectedVersion: $v, reason: $reason) { id status version }
  }
`;
const M_EMERGENCY = gql`
  mutation($id: ID!, $reason: String!) {
    bmsEscalateAssessmentToEmergency(assessmentId: $id, reason: $reason) { id status version }
  }
`;
const M_EDIT_SUMMARY = gql`
  mutation($id: ID!, $text: String!) {
    bmsEditAssessmentSummary(assessmentId: $id, summaryText: $text) { id aiSummary aiSummaryVersion version }
  }
`;
const M_EDIT_PHARMACIST_SUMMARY = gql`
  mutation($id: ID!, $v: Int!, $text: String!) {
    bmsEditPharmacistDecisionNotes(assessmentId: $id, expectedVersion: $v, decisionNotes: $text) {
      id pharmacistDecisionNotes version updatedAt
    }
  }
`;
const M_MANUAL_FILL = gql`
  mutation($id: ID!, $fields: JSON!) {
    bmsManualFillAssessmentFields(assessmentId: $id, fields: $fields) { id status missingFields conflictingFields version }
  }
`;
const M_SUGGEST_MEDICATION = gql`
  mutation($id: ID!) {
    bmsGenerateMedicationSuggestions(assessmentId: $id) { id medicationSuggestions }
  }
`;
const Q_PRODUCTS = gql`
  query PharmacyCaseProducts($search: String, $limit: Int) {
    bmsPharmacyCatalog(search: $search, limit: $limit) {
      sku
      name
      price
      category
      brand
      availableTotal
      productType
      salePolicy
      policyStatus
      variants {
        size
        available
      }
    }
  }
`;

type MedicationDraftState = {
  enabled: boolean;
  qty: number;
  unitPrice: number;
  pharmacistNote: string;
  selectedSku: string;
  selectedSize: string;
};
type ManualMedicationRow = {
  rowKey: string;
  manual: true;
  drugName: string;
  strength: string;
  dosageInstruction: string;
  rationale: string;
  warnings: string[];
  excluded: boolean;
  exclusionReason?: string;
  catalogMatches: Array<{
    sku: string;
    name: string;
    price: number;
    availableTotal: number;
    availableSizes: Array<{ size: string; available: number }>;
    productType?: string;
    salePolicy?: string;
    policyStatus?: string;
  }>;
};

export default function PharmacyCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const router = useRouter();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [pharmacistResponse, setPharmacistResponse] = useState("");
  const [reason, setReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [pharmacistSummaryDraft, setPharmacistSummaryDraft] = useState("");
  const [manualFieldValues, setManualFieldValues] = useState<Record<string, string>>({});
  const [showRawConversation, setShowRawConversation] = useState(false);
  const [medicationDrafts, setMedicationDrafts] = useState<Record<string, MedicationDraftState>>({});
  const [manualMedicationRows, setManualMedicationRows] = useState<ManualMedicationRow[]>([]);
  const [removedMedicationRowKeys, setRemovedMedicationRowKeys] = useState<string[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const { data, loading, error, refetch } = useQuery(Q, {
    variables: { id: params.caseId },
    skip: permsLoading || !can("pharmacy.assessment.read"),
    fetchPolicy: "cache-and-network",
  });
  const { data: productSearchData, loading: productSearchLoading, error: productSearchError } = useQuery(Q_PRODUCTS, {
    variables: { search: productSearch || undefined, limit: 12 },
    skip: !productPickerOpen,
    fetchPolicy: "cache-and-network",
  });

  const onDone = (label: string) => () => {
    message.success(label);
    refetch();
  };
  const onErr = (e: any) => message.error(e?.message || "ดำเนินการไม่สำเร็จ");

  const [startReview, { loading: starting }] = useMutation(M_START_REVIEW, { onCompleted: onDone("รับเคสแล้ว"), onError: onErr });
  const [requestMore, { loading: requestingMore }] = useMutation(M_REQUEST_MORE, { onCompleted: onDone("ขอข้อมูลเพิ่มแล้ว"), onError: onErr });
  const [approve, { loading: approving }] = useMutation(M_APPROVE, { onCompleted: onDone("อนุมัติแล้ว"), onError: onErr });
  const [reject, { loading: rejecting }] = useMutation(M_REJECT, { onCompleted: onDone("ปฏิเสธแล้ว"), onError: onErr });
  const [refer, { loading: referring }] = useMutation(M_REFER, { onCompleted: onDone("ส่งต่อแพทย์แล้ว"), onError: onErr });
  const [escalate, { loading: escalating }] = useMutation(M_EMERGENCY, {
    onCompleted: () => { message.success("ส่งต่อฉุกเฉินแล้ว"); setEmergencyReason(""); refetch(); },
    onError: onErr,
  });
  const [editSummary, { loading: editingSummary }] = useMutation(M_EDIT_SUMMARY, {
    onCompleted: () => { message.success("บันทึกการแก้ไขสรุปแล้ว"); setSummaryDraft(null); refetch(); },
    onError: onErr,
  });
  const [editPharmacistSummary, { loading: editingPharmacistSummary }] = useMutation(M_EDIT_PHARMACIST_SUMMARY, {
    onCompleted: () => { message.success("บันทึก Pharmacist Summary Draft แล้ว"); refetch(); },
    onError: onErr,
  });
  const [manualFill, { loading: manualFilling }] = useMutation(M_MANUAL_FILL, {
    onCompleted: () => { message.success("บันทึกข้อมูลที่กรอกเองแล้ว"); setManualFieldValues({}); refetch(); },
    onError: onErr,
  });
  const [suggestMedication, { loading: suggestingMedication }] = useMutation(M_SUGGEST_MEDICATION, {
    onCompleted: () => { message.success("ได้คำแนะนำยาจาก AI แล้ว — ตรวจสอบก่อนใช้เสมอ"); refetch(); },
    onError: onErr,
  });

  const c = data?.bmsPharmacyAssessment;
  const history = data?.bmsPharmacyAssessmentConversationHistory;
  const events = data?.bmsPharmacyAssessmentEvents || [];
  const missing: string[] = c?.missingFields || [];
  const conflicting: string[] = c?.conflictingFields || [];
  const anomalies: any[] = c?.anomalies || [];
  const confirmationLines = normalizeCustomerConfirmationLines(c?.customerConfirmationSummary?.lines);
  const confirmationSafetyKeys = new Set([
    "patient_relationship",
    "patient_age_years",
    "biological_sex",
    "pregnancy_status",
    "breastfeeding_status",
    "allergies",
    "current_medications",
    "chronic_diseases",
  ]);
  const symptomConfirmationLines = confirmationLines
    .filter((line) => !confirmationSafetyKeys.has(line.fieldKey))
    .map((line) => ({ ...line, valueText: formatCustomerConfirmationValue(line.valueText) }));
  const patientConfirmationLines = [
    { fieldKey: "patient_relationship", label: "ผู้มีอาการ", valueText: formatCustomerConfirmationValue(c?.patientRelationship) },
    { fieldKey: "patient_age_years", label: "อายุ", valueText: c?.patientAgeYears == null ? "ไม่ทราบ" : `${c.patientAgeYears} ปี` },
    { fieldKey: "biological_sex", label: "เพศกำเนิด", valueText: formatCustomerConfirmationValue(c?.biologicalSex) },
    { fieldKey: "allergies", label: "ประวัติแพ้ยา", valueText: formatCustomerConfirmationValue(c?.structuredAnswers?.allergies) },
    { fieldKey: "current_medications", label: "ยาที่ใช้อยู่", valueText: formatCustomerConfirmationValue(c?.structuredAnswers?.current_medications) },
    { fieldKey: "pregnancy_status", label: "ตั้งครรภ์", valueText: formatCustomerConfirmationValue(c?.pregnancyStatus) },
    { fieldKey: "breastfeeding_status", label: "ให้นมบุตร", valueText: formatCustomerConfirmationValue(c?.breastfeedingStatus) },
  ];
  const redFlags: any[] = c?.detectedRedFlags || [];
  const completenessMeta = getCompletenessTagMeta(c?.completenessStatus);
  const confirmationMeta = getCustomerConfirmationTagMeta(c?.customerConfirmationStatus);
  const canDecide = c?.status === "PHARMACIST_REVIEWING";
  const canReview = c?.status === "WAITING_FOR_PHARMACIST";
  const structuredAnswers = c?.structuredAnswers || {};
  const medicationSuggestions = c?.medicationSuggestions || [];
  const productSearchItems = productSearchData?.bmsPharmacyCatalog || [];
  const checkoutOrderDraft = c?.checkoutOrderDraft || null;

  useEffect(() => {
    if (!c?.id) return;
    const savedDraft = String(c.pharmacistDecisionNotes || "");
    setPharmacistSummaryDraft(savedDraft);
    setPharmacistResponse((current) => current || savedDraft);
  }, [c?.id, c?.pharmacistDecisionNotes]);

  const isPolicyEligibleForPharmacistDraft = (item: any) =>
    item?.policyStatus === "APPROVED" &&
    !["PRESCRIPTION_REQUIRED", "ONLINE_SALE_PROHIBITED"].includes(String(item?.salePolicy || ""));

  const normalizedAiMedicationRows = useMemo(
    () =>
      medicationSuggestions.map((item: any, index: number) => ({
        ...item,
        rowKey: `${item.drugName || "drug"}-${item.strength || "strength"}-${index}`,
      })),
    [medicationSuggestions]
  );
  const matchedAiMedicationRows = useMemo(
    () =>
      normalizedAiMedicationRows.filter(
        (item: any) => Array.isArray(item.catalogMatches) && item.catalogMatches.some(isPolicyEligibleForPharmacistDraft)
      ),
    [normalizedAiMedicationRows]
  );
  const unmatchedAiCount = normalizedAiMedicationRows.length - matchedAiMedicationRows.length;
  const allMedicationRows = useMemo(
    () =>
      [...matchedAiMedicationRows, ...manualMedicationRows].filter(
        (item: any) => !removedMedicationRowKeys.includes(item.rowKey)
      ),
    [manualMedicationRows, matchedAiMedicationRows, removedMedicationRowKeys]
  );

  const getCatalogMatches = (row: any) =>
    (Array.isArray(row?.catalogMatches) ? row.catalogMatches : []).filter(isPolicyEligibleForPharmacistDraft);

  const findSelectedMatch = (row: any, draft?: MedicationDraftState | null) => {
    const matches = getCatalogMatches(row);
    if (matches.length === 0) return null;
    return matches.find((item: any) => item.sku === draft?.selectedSku) || matches[0] || null;
  };

  const availableSizesForRow = (row: any, draft?: MedicationDraftState | null) => {
    const selectedMatch = findSelectedMatch(row, draft);
    return Array.isArray(selectedMatch?.availableSizes)
      ? selectedMatch.availableSizes.filter((item: any) => Number(item.available) > 0)
      : [];
  };

  useEffect(() => {
    setMedicationDrafts((prev) => {
      const next = { ...prev };
      for (const item of allMedicationRows as any[]) {
        const key = item.rowKey;
        if (!next[key]) {
          const firstMatch = getCatalogMatches(item)[0] || null;
          const firstSize = Array.isArray(firstMatch?.availableSizes) ? firstMatch.availableSizes[0]?.size || "" : "";
          next[key] = {
            enabled: !item.excluded,
            qty: 1,
            unitPrice: Number(firstMatch?.price ?? 0),
            pharmacistNote: "",
            selectedSku: String(firstMatch?.sku || ""),
            selectedSize: String(firstSize || ""),
          };
        }
      }
      return next;
    });
  }, [allMedicationRows]);

  const hasIncompleteMedicationSelection = useMemo(
    () =>
      allMedicationRows.some((row: any) => {
        const draft = medicationDrafts[row.rowKey];
        if (!draft?.enabled) return false;
        return !draft.selectedSku || !draft.selectedSize;
      }),
    [allMedicationRows, medicationDrafts]
  );

  const selectedOrderDraft = useMemo(() => {
    const items = allMedicationRows.flatMap((row: any) => {
      const draft = medicationDrafts[row.rowKey];
      if (!draft?.enabled) return [];
      const selectedMatch = findSelectedMatch(row, draft);
      if (!selectedMatch || !draft.selectedSku || !draft.selectedSize) return [];
      return [
        {
          sku: selectedMatch.sku,
          size: draft.selectedSize,
          qty: draft.qty,
          unitPrice: draft.unitPrice,
          productName: selectedMatch.name,
          drugName: row.drugName || selectedMatch.name,
          dosageInstruction: row.dosageInstruction || "",
          pharmacistNote: draft.pharmacistNote || "",
        },
      ];
    });
    if (items.length === 0) {
      return checkoutOrderDraft?.status === "AWAITING_CUSTOMER_CONFIRMATION"
        ? checkoutOrderDraft
        : null;
    }
    return {
      status: "AWAITING_CUSTOMER_CONFIRMATION",
      items,
      estimatedTotal: items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0),
      createdOrderId: null,
      approvedAt: null,
    };
  }, [allMedicationRows, checkoutOrderDraft, medicationDrafts]);

  const canApprove =
    c?.status === "PHARMACIST_REVIEWING" &&
    c?.completenessStatus === "COMPLETE" &&
    missing.length === 0 &&
    conflicting.length === 0 &&
    anomalies.length === 0 &&
    (c?.customerConfirmationStatus === "CONFIRMED" || events.some((event: any) => event.action === "assessment.manual_answer_recorded")) &&
    Boolean(pharmacistResponse.trim()) &&
    !hasIncompleteMedicationSelection;

  const selectedMedicationSummary = useMemo(() => {
    const selected = allMedicationRows.reduce(
      (acc: { count: number; total: number }, item: any) => {
        const key = item.rowKey;
        const draft = medicationDrafts[key];
        if (!draft?.enabled) return acc;
        return {
          count: acc.count + 1,
          total: acc.total + draft.qty * draft.unitPrice,
        };
      },
      { count: 0, total: 0 }
    );
    if (selected.count === 0 && Array.isArray(checkoutOrderDraft?.items)) {
      return {
        count: checkoutOrderDraft.items.length,
        total: Number(checkoutOrderDraft.estimatedTotal || 0),
      };
    }
    return selected;
  }, [allMedicationRows, checkoutOrderDraft, medicationDrafts]);

  const patchMedicationDraft = (key: string, patch: Partial<MedicationDraftState>) => {
    setMedicationDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {
          enabled: true,
          qty: 1,
          unitPrice: 0,
          pharmacistNote: "",
          selectedSku: "",
          selectedSize: "",
        }),
        ...patch,
      },
    }));
  };

  const appendMedicationToDraft = (text: string) => {
    setPharmacistResponse((prev) => [prev, text].filter(Boolean).join("\n"));
  };

  const removeMedicationRow = (row: any) => {
    if (row.manual) {
      setManualMedicationRows((prev) => prev.filter((item) => item.rowKey !== row.rowKey));
    } else {
      setRemovedMedicationRowKeys((prev) =>
        prev.includes(row.rowKey) ? prev : [...prev, row.rowKey]
      );
    }
    setMedicationDrafts((prev) => {
      const next = { ...prev };
      delete next[row.rowKey];
      return next;
    });
    message.success(`ลบ ${row.drugName || row.catalogMatches?.[0]?.name || "รายการยา"} ออกจากแผนแล้ว`);
  };

  const addManualProduct = (product: any) => {
    const availableTotal = Array.isArray(product.variants)
      ? product.variants.reduce((sum: number, variant: any) => sum + Math.max(0, Number(variant.available) || 0), 0)
      : 0;
    const availableSizes = Array.isArray(product.variants)
      ? product.variants
          .filter((variant: any) => (Number(variant.available) || 0) > 0)
          .map((variant: any) => ({
            size: String(variant.size || ""),
            available: Number(variant.available) || 0,
          }))
      : [];
    const rowKey = `manual-${product.sku}`;
    setManualMedicationRows((prev) => {
      if (prev.some((item) => item.rowKey === rowKey)) return prev;
      return [
        ...prev,
        {
          rowKey,
          manual: true,
          drugName: product.name,
          strength: "",
          dosageInstruction: "",
          rationale: "เภสัชเพิ่มเองจาก catalog ร้านนี้",
          warnings: [],
          excluded: false,
          catalogMatches: [
            {
              sku: product.sku,
              name: product.name,
              price: Number(product.price) || 0,
              availableTotal,
              availableSizes,
              productType: product.productType,
              salePolicy: product.salePolicy,
              policyStatus: product.policyStatus,
            },
          ],
        },
      ];
    });
    setMedicationDrafts((prev) => ({
      ...prev,
      [rowKey]: prev[rowKey] || {
        enabled: true,
        qty: 1,
        unitPrice: Number(product.price) || 0,
        pharmacistNote: "",
        selectedSku: product.sku,
        selectedSize: availableSizes[0]?.size || "",
      },
    }));
    message.success(`เพิ่ม ${product.name} เข้า medication plan แล้ว`);
    setProductPickerOpen(false);
  };

  const copyCustomerConfirmation = async () => {
    try {
      await navigator.clipboard.writeText(
        formatCustomerConfirmationClipboardText(
          [...patientConfirmationLines, ...symptomConfirmationLines],
          {
            protocolKey: c?.customerConfirmationSummary?.protocolKey ?? null,
            completenessStatus: c?.completenessStatus ?? null,
            confirmationStatus: c?.customerConfirmationStatus ?? null,
          }
        )
      );
      message.success("คัดลอกข้อมูลยืนยันแล้ว");
    } catch {
      message.error("คัดลอกข้อมูลยืนยันไม่สำเร็จ");
    }
  };

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดเคสไม่ได้" description={error.message} />;
  if (loading && !c) return <Alert type="info" showIcon message="กำลังโหลด..." />;
  if (!c) return <Alert type="warning" showIcon message="ไม่พบเคสนี้" />;

  return (
    <div>
      <AdminPageHeader
        title={
          <Space wrap>
            <Title level={4} style={{ margin: 0 }}>เคส {c.id.slice(0, 8)}</Title>
            <Tag>{c.status}</Tag>
            <Tag color={c.riskLevel === "EMERGENCY" ? "red" : c.riskLevel === "URGENT" ? "orange" : "green"}>
              Risk: {c.riskLevel}
            </Tag>
          </Space>
        }
      >
        <Button onClick={() => router.push("/admin/pharmacy-queue")}>กลับไปคิว</Button>
      </AdminPageHeader>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="AI เป็นเพียงผู้ช่วยเก็บข้อมูลและ draft การวิเคราะห์/ยาที่เกี่ยวข้อง — เภสัชกรต้องเป็นผู้ตัดสินใจสุดท้าย"
      />

      {redFlags.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="พบ Red Flag"
          description={redFlags.map((f: any, i: number) => (
            <div key={i}>{f.label} ({f.severity})</div>
          ))}
        />
      )}

      {(missing.length > 0 || conflicting.length > 0 || anomalies.length > 0) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <>
              {missing.length > 0 && <div>ข้อมูลที่ยังขาด: {missing.join(", ")}</div>}
              {conflicting.length > 0 && <div>คำตอบที่ขัดแย้งกัน: {conflicting.join(", ")}</div>}
              {anomalies.length > 0 && (
                <div>ค่าที่ผิดปกติ: {anomalies.map((item: any) => item?.label || item?.fieldKey || "unknown").join(", ")}</div>
              )}
            </>
          }
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Tag color={completenessMeta.color}>Completeness: {completenessMeta.text}</Tag>
          <Tag color={confirmationMeta.color}>Confirmation: {confirmationMeta.text}</Tag>
          <Tag color={c.needsManualIntake ? "red" : "blue"}>{c.needsManualIntake ? "AI degraded path" : "AI normal path"}</Tag>
          <Tag color="purple">AI summary v{c.aiSummaryVersion}</Tag>
          <Tag color="gold">Medication candidates: {medicationSuggestions.length}</Tag>
          <Tag color={c.conversationId ? "green" : "default"}>
            {c.conversationId ? "Linked to conversation" : "No customer conversation"}
          </Tag>
        </Space>
      </Card>

      <Alert
        type={c.conversationId ? "success" : "warning"}
        showIcon
        style={{ marginBottom: 12 }}
        message={
          c.conversationId
            ? "เคสนี้ผูกกับ customer conversation แล้ว"
            : "เคสนี้ยังไม่ได้ผูกกับ customer conversation"
        }
        description={
          c.conversationId
            ? `Approve and send จะบันทึกข้อความกลับเข้า conversation เดิม${
                history?.channel ? ` (channel: ${history.channel})` : ""
              } และถ้า channel รองรับก็จะพยายาม push ออกจริงด้วย`
            : "Approve จะเปลี่ยนสถานะเคสได้ แต่จะยังไม่มีปลายทางให้ส่งข้อความกลับลูกค้าอัตโนมัติ"
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            size="small"
            title={
              <Space>
                <UserOutlined />
                <span>Customer Confirmation Snapshot</span>
              </Space>
            }
            extra={
              <Button size="small" icon={<CopyOutlined />} onClick={copyCustomerConfirmation}>
                คัดลอก
              </Button>
            }
            style={{ marginBottom: 12 }}
          >
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--app-surface-2)",
                  border: "1px solid var(--app-border)",
                }}
              >
                <Space wrap>
                  <Tag color={completenessMeta.color}>ข้อมูล: {completenessMeta.text}</Tag>
                  <Tag color={confirmationMeta.color}>ลูกค้ายืนยัน: {confirmationMeta.text}</Tag>
                  {events.some((event: any) => event.action === "assessment.manual_answer_recorded") ? (
                    <Tag color="blue">มีข้อมูลที่เภสัชกรกรอกเอง</Tag>
                  ) : null}
                </Space>
                <Text type="secondary">
                  {c.customerConfirmedAt
                    ? `ยืนยันเมื่อ ${new Date(c.customerConfirmedAt).toLocaleString("th-TH")}`
                    : "ยังไม่มีเวลายืนยันจากลูกค้า"}
                </Text>
              </div>

              {(missing.length > 0 || conflicting.length > 0 || anomalies.length > 0) ? (
                <Alert
                  type={conflicting.length > 0 || anomalies.length > 0 ? "error" : "warning"}
                  showIcon
                  message="ยังไม่พร้อมอนุมัติ"
                  description={[
                    missing.length > 0 ? `ข้อมูลที่ขาด: ${missing.join(", ")}` : null,
                    conflicting.length > 0 ? `ข้อมูลขัดแย้ง: ${conflicting.join(", ")}` : null,
                    anomalies.length > 0 ? `ค่าที่ต้องตรวจ: ${anomalies.map((item: any) => item?.label || item?.fieldKey || "unknown").join(", ")}` : null,
                  ].filter(Boolean).join(" · ")}
                />
              ) : null}

              <div>
                <Text strong>ข้อมูลผู้ป่วยและความปลอดภัย</Text>
                <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                  {patientConfirmationLines.map((line) => (
                    <Col key={line.fieldKey} xs={24} sm={12} lg={8}>
                      <div style={{ minHeight: 66, padding: "9px 11px", border: "1px solid var(--app-border)", borderRadius: 8 }}>
                        <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{line.label}</Text>
                        <Text strong style={{ display: "block", marginTop: 4, overflowWrap: "anywhere" }}>{line.valueText}</Text>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>

              <div>
                <Text strong>ข้อมูลอาการที่ลูกค้าตรวจสอบ</Text>
                {symptomConfirmationLines.length > 0 ? (
                  <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                    {symptomConfirmationLines.map((line) => (
                      <Col key={line.fieldKey} xs={24} sm={12} lg={8}>
                        <div style={{ minHeight: 66, padding: "9px 11px", border: "1px solid var(--app-border)", borderRadius: 8, background: "var(--app-surface-2)" }}>
                          <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{line.label}</Text>
                          <Text strong style={{ display: "block", marginTop: 4, overflowWrap: "anywhere" }}>{line.valueText}</Text>
                        </div>
                      </Col>
                    ))}
                  </Row>
                ) : (
                  <Alert style={{ marginTop: 8 }} type="info" showIcon message="ยังไม่มีข้อมูลอาการที่ลูกค้าตรวจสอบ" />
                )}
              </div>
            </Space>
          </Card>

          <Card size="small" title="Structured Intake + Patient Memory" style={{ marginBottom: 12 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="ไข้">{String(structuredAnswers.has_fever ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="อุณหภูมิ">{String(structuredAnswers.fever_temp ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="ระยะเวลาอาการ">{String(structuredAnswers.duration_days ?? structuredAnswers.duration_hours ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="ความรุนแรง">{String(structuredAnswers.severity ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="เสมหะ">{String(structuredAnswers.sputum ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="โรคประจำตัว">{String(structuredAnswers.comorbidities ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="patient memory / prior context" span={2}>
                {String(structuredAnswers.patient_memory ?? "ยังไม่มี patient memory ที่ดึงมาแสดงในเคสนี้")}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {missing.length > 0 && can("pharmacy.assessment.review") && (
            <Card
              size="small"
              title="กรอกข้อมูลที่ขาดเอง (ใช้เมื่อ AI ไม่พร้อมใช้งานหรือลูกค้าไม่ตอบต่อ)"
              style={{ marginBottom: 12 }}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                {missing.map((key) => (
                  <Space key={key} style={{ width: "100%" }}>
                    <Text style={{ width: 200, display: "inline-block" }}>{key}</Text>
                    {key === "patient_relationship" ? (
                      <Select
                        style={{ width: 320 }}
                        value={manualFieldValues[key] || undefined}
                        placeholder="เลือกผู้ที่มีอาการจากข้อมูลในบทสนทนา"
                        options={[
                          { value: "SELF", label: "ตัวเอง" },
                          { value: "CHILD", label: "ลูก" },
                          { value: "PARENT", label: "พ่อแม่" },
                          { value: "OTHER", label: "บุคคลอื่น" },
                        ]}
                        onChange={(value) => setManualFieldValues((prev) => ({ ...prev, [key]: value }))}
                      />
                    ) : (
                      <Input
                        style={{ width: 320 }}
                        value={manualFieldValues[key] ?? ""}
                        onChange={(e) => setManualFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="กรอกค่าจากบทสนทนาต้นฉบับ"
                      />
                    )}
                  </Space>
                ))}
                <Button
                  type="primary"
                  loading={manualFilling}
                  disabled={missing.every((k) => !manualFieldValues[k]?.trim())}
                  onClick={() =>
                    manualFill({
                      variables: {
                        id: c.id,
                        fields: Object.fromEntries(Object.entries(manualFieldValues).filter(([, v]) => v.trim())),
                      },
                    })
                  }
                >
                  บันทึกข้อมูลที่กรอกเอง
                </Button>
                <Text type="secondary">
                  ข้อมูลที่กรอกจะถูกตรวจด้วย rule engine เดียวกับที่ AI ใช้ (Red Flag/ข้อมูลขัดแย้งยังตรวจอยู่เหมือนเดิม)
                </Text>
              </Space>
            </Card>
          )}

          <Card
            size="small"
            title={
              <Space>
                <RobotOutlined />
                <span>AI Analysis Summary</span>
              </Space>
            }
            style={{ marginBottom: 12 }}
            extra={
              canDecide && can("pharmacy.assessment.review") && summaryDraft === null ? (
                <a onClick={() => setSummaryDraft(c.aiSummary || "")}>แก้ไขสรุป</a>
              ) : undefined
            }
          >
            {summaryDraft !== null ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                <TextArea value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} rows={5} />
                <Space>
                  <Button type="primary" loading={editingSummary} onClick={() => editSummary({ variables: { id: c.id, text: summaryDraft } })}>
                    บันทึกการแก้ไข
                  </Button>
                  <Button onClick={() => setSummaryDraft(null)}>ยกเลิก</Button>
                </Space>
              </Space>
            ) : (
              <Paragraph style={{ whiteSpace: "pre-wrap" }}>{c.aiSummary || "ยังไม่มีสรุป"}</Paragraph>
            )}

            {c.needsManualIntake && (
              <Tag color="red">เคสนี้ AI ไม่พร้อมใช้งานบางช่วง — ต้องดูบทสนทนาต้นฉบับโดยตรง</Tag>
            )}
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <MedicineBoxOutlined />
                <span>AI Draft Medication Plan</span>
              </Space>
            }
            style={{ marginBottom: 12, borderColor: "#d48806" }}
            extra={
              can("pharmacy.assessment.review") && c.status === "PHARMACIST_REVIEWING" ? (
                <Space>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => setProductPickerOpen(true)}>
                    เพิ่มยาเอง
                  </Button>
                  {c.protocolId ? (
                    <Button size="small" loading={suggestingMedication} onClick={() => suggestMedication({ variables: { id: c.id } })}>
                      ขอคำแนะนำยาจาก AI (จากสินค้าในร้านนี้)
                    </Button>
                  ) : null}
                </Space>
              ) : undefined
            }
          >
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="AI จะ draft เฉพาะรายการยาที่อ้างอิงจากร้านยานี้เท่านั้น และเภสัชกรต้องเป็นคน final"
              description="ระบบจะค้นจาก catalog ของ tenant ร้านนี้แบบ active + in-stock เพื่อช่วยจับคู่ SKU, ราคา และสต็อก ไม่ดึงข้อมูลจากร้านอื่น และไม่ควรส่งต่อให้ลูกค้าแบบอัตโนมัติ"
            />

            {unmatchedAiCount > 0 ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`ตัดข้อเสนอ AI ที่ไม่พบสินค้าจริงในร้านออกแล้ว ${unmatchedAiCount} รายการ`}
                description="ตารางด้านล่างจะแสดงเฉพาะรายการที่มีสินค้าจริงในร้าน match หรือรายการที่เภสัชเพิ่มเองเท่านั้น"
              />
            ) : null}

            {allMedicationRows.length === 0 ? (
              <Text type="secondary">ยังไม่มีสินค้าจริงที่ใช้ได้ในร้านสำหรับเคสนี้ — กด "เพิ่มยาเอง" เพื่อเลือกจาก catalog ร้าน หรือให้ AI ลองจับคู่ใหม่</Text>
            ) : (
              <List
                dataSource={allMedicationRows}
                renderItem={(row: any) => {
                  const draft = medicationDrafts[row.rowKey] || {
                    enabled: true,
                    qty: 1,
                    unitPrice: 0,
                    pharmacistNote: "",
                    selectedSku: "",
                    selectedSize: "",
                  };
                  const primaryMatch = findSelectedMatch(row, draft);
                  const availableSizes = availableSizesForRow(row, draft);
                  return (
                    <List.Item style={{ padding: 0, border: "none", marginBottom: 12 }}>
                      <Card size="small" style={{ width: "100%", background: "var(--app-surface-1)" }}>
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                            <Space align="start">
                              <Switch
                                checked={draft.enabled}
                                onChange={(checked) => patchMedicationDraft(row.rowKey, { enabled: checked })}
                              />
                              <Space direction="vertical" size={2}>
                                <Space wrap size={6}>
                                  <Text strong style={{ fontSize: 16 }}>
                                    {primaryMatch?.name || row.drugName || "ไม่ทราบชื่อสินค้า"}
                                  </Text>
                                  <Tag color={row.manual ? "cyan" : "purple"}>{row.manual ? "manual" : "ai"}</Tag>
                                  {row.excluded ? <Tag color="red">ถูกกรองออก</Tag> : null}
                                </Space>
                                <Text type="secondary">
                                  {primaryMatch?.sku || "-"}{primaryMatch ? ` · เหลือ ${primaryMatch.availableTotal}` : ""}
                                </Text>
                              </Space>
                            </Space>

                            <Space wrap>
                              <Button
                                size="small"
                                onClick={() =>
                                  appendMedicationToDraft(`${row.drugName} ${row.strength} — ${row.dosageInstruction}`)
                                }
                              >
                                เพิ่มในร่างข้อความ
                              </Button>
                              <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => removeMedicationRow(row)}
                              >
                                ลบ
                              </Button>
                            </Space>
                          </div>

                          <Descriptions size="small" column={2} bordered>
                            <Descriptions.Item label="AI suggestion" span={2}>
                              {row.drugName} {row.strength}
                            </Descriptions.Item>
                            <Descriptions.Item label="AI draft dosage" span={2}>
                              {row.dosageInstruction || <Text type="secondary">ยังไม่มี dosage</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label="สินค้าที่จะจ่าย" span={2}>
                              <Select
                                style={{ width: "100%" }}
                                value={draft.selectedSku || undefined}
                                placeholder="เลือกสินค้าจริงในร้าน"
                                options={getCatalogMatches(row).map((item: any) => ({
                                  value: item.sku,
                                  label: `${item.name} · ${item.sku} · ฿${Number(item.price).toLocaleString()} · เหลือ ${item.availableTotal}`,
                                }))}
                                onChange={(value) => {
                                  const nextMatch = getCatalogMatches(row).find((item: any) => item.sku === value);
                                  patchMedicationDraft(row.rowKey, {
                                    selectedSku: String(value || ""),
                                    selectedSize: String(nextMatch?.availableSizes?.[0]?.size || ""),
                                    unitPrice: Number(nextMatch?.price ?? draft.unitPrice ?? 0),
                                  });
                                }}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="ขนาด / size" span={2}>
                              <Select
                                style={{ width: "100%" }}
                                value={draft.selectedSize || undefined}
                                placeholder="เลือก size ที่จะจ่าย"
                                options={availableSizes.map((item: any) => ({
                                  value: item.size,
                                  label: `${item.size || "default"} · เหลือ ${item.available}`,
                                }))}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { selectedSize: String(value || "") })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="จำนวน">
                              <InputNumber
                                min={1}
                                value={draft.qty}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { qty: Number(value || 1) })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="ราคา/หน่วย">
                              <InputNumber
                                min={0}
                                value={draft.unitPrice}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { unitPrice: Number(value || 0) })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="เหตุผล" span={2}>
                              {row.rationale || <Text type="secondary">ไม่มีเหตุผลจาก AI</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label="คำเตือน" span={2}>
                              {(row.warnings || []).length > 0 ? (
                                <Text type="warning">{(row.warnings as string[]).join("; ")}</Text>
                              ) : (
                                <Text type="secondary">ไม่มี warning เพิ่มเติม</Text>
                              )}
                              {row.exclusionReason ? (
                                <>
                                  <br />
                                  <Text type="danger">{row.exclusionReason}</Text>
                                </>
                              ) : null}
                            </Descriptions.Item>
                            <Descriptions.Item label="หมายเหตุเภสัช" span={2}>
                              <Input
                                value={draft.pharmacistNote}
                                onChange={(event) => patchMedicationDraft(row.rowKey, { pharmacistNote: event.target.value })}
                                placeholder="เพิ่มโน้ตสั้น ๆ"
                              />
                            </Descriptions.Item>
                          </Descriptions>

                          {(row.catalogMatches || []).length > 1 ? (
                            <div>
                              <Text strong>ตัวเลือกสินค้าที่ match เพิ่มเติม</Text>
                              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {(row.catalogMatches as any[]).slice(1).map((item) => (
                                  <Tag key={item.sku} color="blue">
                                    {item.name} · {item.sku} · ฿{Number(item.price).toLocaleString()} · เหลือ {item.availableTotal}
                                  </Tag>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </Space>
                      </Card>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <EditOutlined />
                <span>Pharmacist Summary Draft</span>
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            <TextArea
              placeholder="สรุป clinical summary / rationale หรือร่างข้อความก่อนตัดสินใจ"
              value={pharmacistSummaryDraft}
              onChange={(event) => setPharmacistSummaryDraft(event.target.value)}
              rows={4}
              maxLength={10_000}
              showCount
              disabled={!canDecide || !can("pharmacy.assessment.review")}
            />
            <Space wrap style={{ marginTop: 10 }}>
              <Button
                type="primary"
                loading={editingPharmacistSummary}
                disabled={
                  !canDecide ||
                  !can("pharmacy.assessment.review") ||
                  !pharmacistSummaryDraft.trim() ||
                  pharmacistSummaryDraft.trim() === String(c.pharmacistDecisionNotes || "").trim()
                }
                onClick={() =>
                  editPharmacistSummary({
                    variables: { id: c.id, v: c.version, text: pharmacistSummaryDraft },
                  })
                }
              >
                บันทึกร่าง
              </Button>
              <Button
                disabled={!canDecide || !pharmacistSummaryDraft.trim()}
                onClick={() => setPharmacistResponse(pharmacistSummaryDraft)}
              >
                ใช้เป็นข้อความตอบลูกค้า
              </Button>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                ร่างนี้บันทึกลง backend และ Audit Timeline แต่จะยังไม่ส่งให้ลูกค้าจนกด Approve and send
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="Conversation" style={{ marginBottom: 12 }}>
            {history ? (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Text type="secondary">
                  ลูกค้า: {history.customerName || history.customerRef || "ไม่ทราบ"} · conversation {history.conversationId.slice(0, 8)} · {history.channel}
                </Text>
                <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                  <List
                    size="small"
                    dataSource={history.messages || []}
                    locale={{ emptyText: "ยังไม่มีข้อความใน conversation นี้" }}
                    renderItem={(m: any) => (
                      <List.Item>
                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                          <Space wrap size={8}>
                            <Tag color={m.direction === "IN" ? "blue" : "green"}>{m.direction === "IN" ? "customer" : "staff/outbound"}</Tag>
                            {m.sender ? <Text type="secondary">{m.sender}</Text> : null}
                            {m.status ? <Tag>{m.status}</Tag> : null}
                            <Text type="secondary">{new Date(m.createdAt).toLocaleString()}</Text>
                          </Space>
                          <div style={{ background: m.direction === "IN" ? "#f0f5ff" : "#f6ffed", borderRadius: 12, padding: 12 }}>
                            <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{m.body || "(empty message)"}</Paragraph>
                          </div>
                        </Space>
                      </List.Item>
                    )}
                  />
                </div>
              </Space>
            ) : (
              <Alert
                type="info"
                showIcon
                message="เคสนี้ยังไม่ได้ผูกกับ customer conversation จริง"
                description="ด้านล่างเป็น intake snapshot ที่ถูกเก็บไว้กับเคส"
              />
            )}

            {history && (c.rawMessages || []).length > 0 ? (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <Space>
                  <Switch checked={showRawConversation} onChange={setShowRawConversation} />
                  <Text>แสดง intake snapshot สำหรับตรวจสอบ</Text>
                </Space>
              </>
            ) : null}

            {(!history || showRawConversation) && (c.rawMessages || []).length > 0 ? (
              <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
                <Divider orientation="left" plain>Intake snapshot</Divider>
                <List
                  size="small"
                  dataSource={c.rawMessages || []}
                  renderItem={(m: any) => (
                    <List.Item>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Tag color={m.role === "user" ? "blue" : "purple"}>{m.role}</Tag>
                        <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{m.text}</Paragraph>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            ) : null}
          </Card>

          <Card size="small" title="Action workspace" style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="จำนวนสินค้าที่เลือก">{selectedMedicationSummary.count} รายการ</Descriptions.Item>
                <Descriptions.Item label="มูลค่าประมาณการ">฿{selectedMedicationSummary.total.toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="ข้อมูลขาด">{missing.length}</Descriptions.Item>
              </Descriptions>

              {checkoutOrderDraft?.status ? (
                <Alert
                  type="info"
                  showIcon
                  message={`checkout draft ปัจจุบัน: ${checkoutOrderDraft.status}`}
                  description={
                    checkoutOrderDraft.createdOrderId
                      ? `สร้าง order แล้ว: ${checkoutOrderDraft.createdOrderId}`
                      : (
                        <div>
                          <div>ยังรอลูกค้ายืนยันสั่งซื้อในแชท</div>
                          {(checkoutOrderDraft.items || []).map((item: any) => (
                            <div key={`${item.sku}-${item.size}`}>
                              • {item.productName} ({item.sku}) / {item.size} × {item.qty}
                            </div>
                          ))}
                        </div>
                      )
                  }
                />
              ) : null}

              {hasIncompleteMedicationSelection ? (
                <Alert
                  type="warning"
                  showIcon
                  message="รายการยาที่ยังเปิดใช้งานอยู่ต้องเลือกสินค้าและ size ให้ครบก่อน approve"
                />
              ) : null}

              {canReview && can("pharmacy.assessment.review") && (
                <Button type="primary" loading={starting} onClick={() => startReview({ variables: { id: c.id } })}>
                  รับเคส (Start Review)
                </Button>
              )}

              {canDecide && can("pharmacy.assessment.request_more_information") && (
                <Button
                  loading={requestingMore}
                  onClick={() =>
                    requestMore({ variables: { id: c.id, v: c.version, fields: missing.length ? missing : ["additional_info"], note: reason || null } })
                  }
                >
                  ขอข้อมูลเพิ่มจากช่องที่ยังขาด
                </Button>
              )}

              <TextArea
                placeholder="คำแนะนำของเภสัชกร (ข้อความนี้จะถูกส่งให้ลูกค้าโดยตรง เมื่อกดอนุมัติ)"
                value={pharmacistResponse}
                onChange={(e) => setPharmacistResponse(e.target.value)}
                rows={5}
                disabled={!canDecide}
              />
              <Input placeholder="เหตุผล (สำหรับปฏิเสธ/ส่งต่อแพทย์)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canDecide} />

              <Space wrap>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  disabled={!canApprove}
                  loading={approving}
                  onClick={() =>
                    approve({
                      variables: {
                        id: c.id,
                        v: c.version,
                        resp: pharmacistResponse,
                        orderDraft: selectedOrderDraft,
                      },
                    })
                  }
                >
                  Approve and send
                </Button>
                <Button danger disabled={!canDecide || !reason.trim()} loading={rejecting} onClick={() => reject({ variables: { id: c.id, v: c.version, reason } })}>
                  Reject
                </Button>
                <Button disabled={!canDecide || !reason.trim()} loading={referring} onClick={() => refer({ variables: { id: c.id, v: c.version, reason } })}>
                  Refer to doctor
                </Button>
              </Space>

              <Text type="secondary">
                ปุ่ม Approve จะเปิดได้เมื่อเคสอยู่สถานะ review + rule engine ยืนยันว่าข้อมูลครบและไม่ขัดแย้ง + ลูกค้ายืนยันสรุป
                หรือเภสัชกรกรอกข้อมูลที่ขาดเอง + มีข้อความตอบกลับ + รายการยาที่เลือกมีสินค้า/size ครบ
              </Text>

              {c.status !== "CLOSED" && c.status !== "EMERGENCY_REFERRAL" && can("pharmacy.assessment.review") && (
                <>
                  <Divider style={{ margin: "8px 0" }} />
                  <Text strong type="danger">Emergency referral</Text>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      placeholder="เหตุผลที่ส่งฉุกเฉิน"
                      value={emergencyReason}
                      onChange={(e) => setEmergencyReason(e.target.value)}
                    />
                    <Button danger loading={escalating} disabled={!emergencyReason.trim()} onClick={() => escalate({ variables: { id: c.id, reason: emergencyReason } })}>
                      Emergency referral
                    </Button>
                  </Space.Compact>
                </>
              )}
            </Space>
          </Card>

          <Card size="small" title="What this layout reduces" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={10}>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: "#faad14", marginRight: 8 }} />
                ลดเวลาที่เภสัชต้องไล่อ่านแชทย้อนหลังเองทั้งหมด
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: "#faad14", marginRight: 8 }} />
                ลดการจับคู่ยาในร้านแบบ manual ทีละตัว
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: "#faad14", marginRight: 8 }} />
                ลดการสลับหลาย section ก่อนจะ approve/send
              </Paragraph>
            </Space>
          </Card>

          <Card size="small" title="Audit Timeline">
            <div style={{ maxHeight: 420, overflowY: "auto", padding: "4px 8px 0 4px" }}>
              <Timeline
                items={events.map((e: any) => ({
                  dot: e.action?.includes("approve") ? <CheckCircleOutlined /> : <ClockCircleOutlined />,
                  children: (
                    <div>
                      <Text strong>{e.action}</Text> — {e.actor}
                      {e.previousState && e.nextState ? ` (${e.previousState} → ${e.nextState})` : ""}
                      <br />
                      <Text type="secondary">{new Date(e.createdAt).toLocaleString()}</Text>
                    </div>
                  ),
                }))}
              />
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title="เพิ่มยาเองจากสินค้าในร้านนี้"
        open={productPickerOpen}
        onCancel={() => setProductPickerOpen(false)}
        footer={null}
        width={760}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Alert
            type="info"
            showIcon
            message="ค้นหาเฉพาะสินค้าในร้านนี้"
            description="ใช้เมื่อเภสัชต้องการเติมรายการยาเองนอกเหนือจากที่ AI draft มา"
          />
          <Input
            placeholder="ค้นหาชื่อยา / SKU"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          {productSearchError ? (
            <Alert type="error" showIcon message="โหลด catalog ร้านไม่สำเร็จ" description={productSearchError.message} />
          ) : null}
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <List
              loading={productSearchLoading}
              dataSource={productSearchItems}
              locale={{ emptyText: "ไม่พบสินค้าที่ตรงคำค้น" }}
              renderItem={(product: any) => {
                const availableTotal = Array.isArray(product.variants)
                  ? product.variants.reduce((sum: number, variant: any) => sum + Math.max(0, Number(variant.available) || 0), 0)
                  : 0;
                return (
                  <List.Item
                    actions={[
                      <Button key="add" type="primary" size="small" disabled={!isPolicyEligibleForPharmacistDraft(product)} onClick={() => addManualProduct(product)}>
                        เพิ่มเข้าแผน
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      <Text strong>{product.name}</Text>
                      <Text type="secondary">
                        {product.sku} · ฿{Number(product.price || 0).toLocaleString()} · เหลือ {availableTotal}
                      </Text>
                      <Space wrap size={4}>
                        <Tag color={product.policyStatus === "APPROVED" ? "green" : "red"}>Policy: {product.policyStatus}</Tag>
                        <Tag color="orange">{product.salePolicy}</Tag>
                        {product.category ? <Tag>{product.category}</Tag> : null}
                        {product.brand ? <Tag color="blue">{product.brand}</Tag> : null}
                        {Array.isArray(product.variants)
                          ? product.variants
                              .filter((variant: any) => (Number(variant.available) || 0) > 0)
                              .slice(0, 5)
                              .map((variant: any) => (
                                <Tag key={`${product.sku}-${variant.size}`} color="green">
                                  {variant.size || "default"}: {variant.available}
                                </Tag>
                              ))
                          : null}
                      </Space>
                    </Space>
                  </List.Item>
                );
              }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
