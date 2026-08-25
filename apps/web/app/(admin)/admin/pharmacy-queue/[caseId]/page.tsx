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
  MedicineBoxOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
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
  const { t } = useI18n();
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
  const onErr = (e: any) => message.error(e?.message || t("admin_pharmacy_case.action_failed"));

  const [startReview, { loading: starting }] = useMutation(M_START_REVIEW, { onCompleted: onDone(t("admin_pharmacy_case.started_review")), onError: onErr });
  const [requestMore, { loading: requestingMore }] = useMutation(M_REQUEST_MORE, { onCompleted: onDone(t("admin_pharmacy_case.requested_more")), onError: onErr });
  const [approve, { loading: approving }] = useMutation(M_APPROVE, { onCompleted: onDone(t("admin_pharmacy_case.approved")), onError: onErr });
  const [reject, { loading: rejecting }] = useMutation(M_REJECT, { onCompleted: onDone(t("admin_pharmacy_case.rejected")), onError: onErr });
  const [refer, { loading: referring }] = useMutation(M_REFER, { onCompleted: onDone(t("admin_pharmacy_case.referred")), onError: onErr });
  const [escalate, { loading: escalating }] = useMutation(M_EMERGENCY, {
    onCompleted: () => { message.success(t("admin_pharmacy_case.emergency_referred")); setEmergencyReason(""); refetch(); },
    onError: onErr,
  });
  const [editSummary, { loading: editingSummary }] = useMutation(M_EDIT_SUMMARY, {
    onCompleted: () => { message.success(t("admin_pharmacy_case.summary_edit_saved")); setSummaryDraft(null); refetch(); },
    onError: onErr,
  });
  const [editPharmacistSummary, { loading: editingPharmacistSummary }] = useMutation(M_EDIT_PHARMACIST_SUMMARY, {
    onCompleted: () => { message.success(t("admin_pharmacy_case.pharmacist_draft_saved")); refetch(); },
    onError: onErr,
  });
  const [manualFill, { loading: manualFilling }] = useMutation(M_MANUAL_FILL, {
    onCompleted: () => { message.success(t("admin_pharmacy_case.manual_saved")); setManualFieldValues({}); refetch(); },
    onError: onErr,
  });
  const [suggestMedication, { loading: suggestingMedication }] = useMutation(M_SUGGEST_MEDICATION, {
    onCompleted: () => { message.success(t("admin_pharmacy_case.ai_meds_ready")); refetch(); },
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
    { fieldKey: "patient_relationship", label: t("admin_pharmacy_case.f_relationship"), valueText: formatCustomerConfirmationValue(c?.patientRelationship) },
    { fieldKey: "patient_age_years", label: t("admin_pharmacy_case.f_age"), valueText: c?.patientAgeYears == null ? t("admin_pharmacy_case.f_age_unknown") : t("admin_pharmacy_case.f_age_years", { n: c.patientAgeYears }) },
    { fieldKey: "biological_sex", label: t("admin_pharmacy_case.f_sex"), valueText: formatCustomerConfirmationValue(c?.biologicalSex) },
    { fieldKey: "allergies", label: t("admin_pharmacy_case.f_allergies"), valueText: formatCustomerConfirmationValue(c?.structuredAnswers?.allergies) },
    { fieldKey: "current_medications", label: t("admin_pharmacy_case.f_current_meds"), valueText: formatCustomerConfirmationValue(c?.structuredAnswers?.current_medications) },
    { fieldKey: "pregnancy_status", label: t("admin_pharmacy_case.f_pregnancy"), valueText: formatCustomerConfirmationValue(c?.pregnancyStatus) },
    { fieldKey: "breastfeeding_status", label: t("admin_pharmacy_case.f_breastfeeding"), valueText: formatCustomerConfirmationValue(c?.breastfeedingStatus) },
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
    message.success(t("admin_pharmacy_case.removed_from_plan", { name: row.drugName || row.catalogMatches?.[0]?.name || t("admin_pharmacy_case.fallback_med_name") }));
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
          rationale: t("admin_pharmacy_case.pharmacist_added_rationale"),
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
    message.success(t("admin_pharmacy_case.added_to_plan", { name: product.name }));
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
      message.success(t("admin_pharmacy_case.copied"));
    } catch {
      message.error(t("admin_pharmacy_case.copy_failed"));
    }
  };

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert closable type="warning" showIcon message={t("admin_pharmacy_case.no_permission")} />;
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_pharmacy_case.load_error")} description={error.message} />;
  if (loading && !c) return <Alert closable type="info" showIcon message={t("admin_pharmacy_case.loading")} />;
  if (!c) return <Alert closable type="warning" showIcon message={t("admin_pharmacy_case.not_found")} />;

  const riskTone = c.riskLevel === "EMERGENCY" ? "bad" : c.riskLevel === "URGENT" ? "warn" : "ok";
  const riskColor = riskTone === "bad" ? "#b3261e" : riskTone === "warn" ? "#92620a" : "#0f7a4d";
  const riskBg = riskTone === "bad" ? "#fdecea" : riskTone === "warn" ? "#fff4e0" : "#e7f7ef";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 20 }} wrap align="start">
        <div>
          <Space align="center" wrap size={10}>
            <Title level={2} style={{ margin: 0 }}>{t("admin_pharmacy_case.case_title", { id: c.id.slice(0, 8) })}</Title>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                padding: "4px 10px", borderRadius: 999, color: riskColor, background: riskBg,
                border: `1px solid ${riskColor}45`,
              }}
            >
              Risk: {c.riskLevel}
            </span>
          </Space>
          <Text type="secondary">{t("admin_pharmacy_case.status_line", { status: c.status })}{history?.customerName || history?.customerRef ? t("admin_pharmacy_case.customer_line", { name: history.customerName || history.customerRef }) : ""}</Text>
        </div>
        <Button onClick={() => router.push("/admin/pharmacy-queue")}>{t("admin_pharmacy_case.btn_back_queue")}</Button>
      </Space>

      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_pharmacy_case.ai_disclaimer")}
      />

      {redFlags.length > 0 && (
        <Alert closable
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("admin_pharmacy_case.red_flag_found")}
          description={redFlags.map((f: any, i: number) => (
            <div key={i}>{f.label} ({f.severity})</div>
          ))}
        />
      )}

      {(missing.length > 0 || conflicting.length > 0 || anomalies.length > 0) && (
        <Alert closable
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <>
              {missing.length > 0 && <div>{t("admin_pharmacy_case.missing_data", { items: missing.join(", ") })}</div>}
              {conflicting.length > 0 && <div>{t("admin_pharmacy_case.conflicting_answers", { items: conflicting.join(", ") })}</div>}
              {anomalies.length > 0 && (
                <div>{t("admin_pharmacy_case.anomalies", { items: anomalies.map((item: any) => item?.label || item?.fieldKey || t("admin_pharmacy_case.unknown")).join(", ") })}</div>
              )}
            </>
          }
        />
      )}

      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
        <Space wrap size={12}>
          <Tag color={completenessMeta.color}>Completeness: {completenessMeta.text}</Tag>
          <Tag color={confirmationMeta.color}>Confirmation: {confirmationMeta.text}</Tag>
          <Tag color={c.needsManualIntake ? "red" : "blue"}>{c.needsManualIntake ? "AI degraded path" : "AI normal path"}</Tag>
          <Tag color="purple">AI summary v{c.aiSummaryVersion}</Tag>
          <Tag color="gold">Medication candidates: {medicationSuggestions.length}</Tag>
          <Tag color={c.conversationId ? "green" : "default"}>
            {c.conversationId
              ? `Linked to conversation${history?.channel ? ` (${history.channel})` : ""}`
              : "No customer conversation"}
          </Tag>
        </Space>
      </Card>

      {!c.conversationId ? (
        <Alert closable
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("admin_pharmacy_case.no_conversation_title")}
          description={t("admin_pharmacy_case.no_conversation_desc")}
        />
      ) : null}

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
                {t("admin_pharmacy_case.btn_copy")}
              </Button>
            }
            style={{ marginBottom: 12, borderRadius: 10 }}
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
                  <Tag color={completenessMeta.color}>{t("admin_pharmacy_case.tag_completeness", { text: completenessMeta.text })}</Tag>
                  <Tag color={confirmationMeta.color}>{t("admin_pharmacy_case.tag_confirmation", { text: confirmationMeta.text })}</Tag>
                  {events.some((event: any) => event.action === "assessment.manual_answer_recorded") ? (
                    <Tag color="blue">{t("admin_pharmacy_case.tag_manual_data")}</Tag>
                  ) : null}
                </Space>
                <Text type="secondary">
                  {c.customerConfirmedAt
                    ? t("admin_pharmacy_case.confirmed_at", { when: new Date(c.customerConfirmedAt).toLocaleString("th-TH") })
                    : t("admin_pharmacy_case.no_confirm_time")}
                </Text>
              </div>

              {(missing.length > 0 || conflicting.length > 0 || anomalies.length > 0) ? (
                <Alert closable
                  type={conflicting.length > 0 || anomalies.length > 0 ? "error" : "warning"}
                  showIcon
                  message={t("admin_pharmacy_case.not_ready_approve")}
                  description={[
                    missing.length > 0 ? t("admin_pharmacy_case.missing_list", { items: missing.join(", ") }) : null,
                    conflicting.length > 0 ? t("admin_pharmacy_case.conflicting_list", { items: conflicting.join(", ") }) : null,
                    anomalies.length > 0 ? t("admin_pharmacy_case.anomalies_list", { items: anomalies.map((item: any) => item?.label || item?.fieldKey || t("admin_pharmacy_case.unknown")).join(", ") }) : null,
                  ].filter(Boolean).join(" · ")}
                />
              ) : null}

              <div>
                <Text strong>{t("admin_pharmacy_case.section_patient_safety")}</Text>
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
                <Text strong>{t("admin_pharmacy_case.section_verified_symptoms")}</Text>
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
                  <Alert closable style={{ marginTop: 8 }} type="info" showIcon message={t("admin_pharmacy_case.no_verified_symptoms")} />
                )}
              </div>
            </Space>
          </Card>

          <Card size="small" title="Structured Intake + Patient Memory" style={{ marginBottom: 12, borderRadius: 10 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t("admin_pharmacy_case.d_fever")}>{String(structuredAnswers.has_fever ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_case.d_temp")}>{String(structuredAnswers.fever_temp ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_case.d_duration")}>{String(structuredAnswers.duration_days ?? structuredAnswers.duration_hours ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_case.d_severity")}>{String(structuredAnswers.severity ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_case.d_sputum")}>{String(structuredAnswers.sputum ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_case.d_comorbidities")}>{String(structuredAnswers.comorbidities ?? "UNKNOWN")}</Descriptions.Item>
              <Descriptions.Item label="patient memory / prior context" span={2}>
                {String(structuredAnswers.patient_memory ?? t("admin_pharmacy_case.no_patient_memory"))}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {missing.length > 0 && can("pharmacy.assessment.review") && (
            <Card
              size="small"
              title={t("admin_pharmacy_case.manual_entry_title")}
              style={{ marginBottom: 12, borderRadius: 10 }}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                {missing.map((key) => (
                  <Space key={key} style={{ width: "100%" }}>
                    <Text style={{ width: 200, display: "inline-block" }}>{key}</Text>
                    {key === "patient_relationship" ? (
                      <Select
                        style={{ width: 320 }}
                        value={manualFieldValues[key] || undefined}
                        placeholder={t("admin_pharmacy_case.manual_rel_placeholder")}
                        options={[
                          { value: "SELF", label: t("admin_pharmacy_case.rel_self") },
                          { value: "CHILD", label: t("admin_pharmacy_case.rel_child") },
                          { value: "PARENT", label: t("admin_pharmacy_case.rel_parent") },
                          { value: "OTHER", label: t("admin_pharmacy_case.rel_other") },
                        ]}
                        onChange={(value) => setManualFieldValues((prev) => ({ ...prev, [key]: value }))}
                      />
                    ) : (
                      <Input
                        style={{ width: 320 }}
                        value={manualFieldValues[key] ?? ""}
                        onChange={(e) => setManualFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={t("admin_pharmacy_case.manual_value_placeholder")}
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
                  {t("admin_pharmacy_case.btn_save_manual")}
                </Button>
                <Text type="secondary">
                  {t("admin_pharmacy_case.manual_rule_note")}
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
            style={{ marginBottom: 12, borderRadius: 10 }}
            extra={
              canDecide && can("pharmacy.assessment.review") && summaryDraft === null ? (
                <a onClick={() => setSummaryDraft(c.aiSummary || "")}>{t("admin_pharmacy_case.btn_edit_summary")}</a>
              ) : undefined
            }
          >
            {summaryDraft !== null ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                <TextArea value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} rows={5} />
                <Space>
                  <Button type="primary" loading={editingSummary} onClick={() => editSummary({ variables: { id: c.id, text: summaryDraft } })}>
                    {t("admin_pharmacy_case.btn_save_edit")}
                  </Button>
                  <Button onClick={() => setSummaryDraft(null)}>{t("admin_pharmacy_case.btn_cancel")}</Button>
                </Space>
              </Space>
            ) : (
              <Paragraph style={{ whiteSpace: "pre-wrap" }}>{c.aiSummary || t("admin_pharmacy_case.no_summary")}</Paragraph>
            )}

            {c.needsManualIntake && (
              <Tag color="red">{t("admin_pharmacy_case.ai_unavailable_tag")}</Tag>
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
            style={{ marginBottom: 12, borderColor: "#d48806", borderRadius: 10 }}
            extra={
              can("pharmacy.assessment.review") && c.status === "PHARMACIST_REVIEWING" ? (
                <Space>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => setProductPickerOpen(true)}>
                    {t("admin_pharmacy_case.btn_add_med")}
                  </Button>
                  {c.protocolId ? (
                    <Button size="small" loading={suggestingMedication} onClick={() => suggestMedication({ variables: { id: c.id } })}>
                      {t("admin_pharmacy_case.btn_ai_suggest")}
                    </Button>
                  ) : null}
                </Space>
              ) : undefined
            }
          >
            <Alert closable
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("admin_pharmacy_case.ai_catalog_notice")}
              description={t("admin_pharmacy_case.ai_catalog_desc")}
            />

            {unmatchedAiCount > 0 ? (
              <Alert closable
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={t("admin_pharmacy_case.filtered_unmatched", { n: unmatchedAiCount })}
                description={t("admin_pharmacy_case.filtered_unmatched_desc")}
              />
            ) : null}

            {allMedicationRows.length === 0 ? (
              <Text type="secondary">{t("admin_pharmacy_case.no_usable_products")}</Text>
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
                                    {primaryMatch?.name || row.drugName || t("admin_pharmacy_case.unknown_product")}
                                  </Text>
                                  <Tag color={row.manual ? "cyan" : "purple"}>{row.manual ? "manual" : "ai"}</Tag>
                                  {row.excluded ? <Tag color="red">{t("admin_pharmacy_case.tag_excluded")}</Tag> : null}
                                </Space>
                                <Text type="secondary">
                                  {primaryMatch?.sku || "-"}{primaryMatch ? t("admin_pharmacy_case.remaining_suffix", { n: primaryMatch.availableTotal }) : ""}
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
                                {t("admin_pharmacy_case.btn_add_to_draft")}
                              </Button>
                              <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => removeMedicationRow(row)}
                              >
                                {t("admin_pharmacy_case.btn_remove")}
                              </Button>
                            </Space>
                          </div>

                          <Descriptions size="small" column={2} bordered>
                            <Descriptions.Item label="AI suggestion" span={2}>
                              {row.drugName} {row.strength}
                            </Descriptions.Item>
                            <Descriptions.Item label="AI draft dosage" span={2}>
                              {row.dosageInstruction || <Text type="secondary">{t("admin_pharmacy_case.no_dosage")}</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_product_to_dispense")} span={2}>
                              <Select
                                style={{ width: "100%" }}
                                value={draft.selectedSku || undefined}
                                placeholder={t("admin_pharmacy_case.select_real_product")}
                                options={getCatalogMatches(row).map((item: any) => ({
                                  value: item.sku,
                                  label: `${item.name} · ${item.sku} · ฿${Number(item.price).toLocaleString()}${t("admin_pharmacy_case.remaining_suffix", { n: item.availableTotal })}`,
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
                            <Descriptions.Item label={t("admin_pharmacy_case.label_size")} span={2}>
                              <Select
                                style={{ width: "100%" }}
                                value={draft.selectedSize || undefined}
                                placeholder={t("admin_pharmacy_case.select_size")}
                                options={availableSizes.map((item: any) => ({
                                  value: item.size,
                                  label: `${item.size || "default"}${t("admin_pharmacy_case.remaining_suffix", { n: item.available })}`,
                                }))}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { selectedSize: String(value || "") })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_qty")}>
                              <InputNumber
                                min={1}
                                value={draft.qty}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { qty: Number(value || 1) })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_unit_price")}>
                              <InputNumber
                                min={0}
                                value={draft.unitPrice}
                                onChange={(value) => patchMedicationDraft(row.rowKey, { unitPrice: Number(value || 0) })}
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_reason")} span={2}>
                              {row.rationale || <Text type="secondary">{t("admin_pharmacy_case.no_ai_reason")}</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_warning")} span={2}>
                              {(row.warnings || []).length > 0 ? (
                                <Text type="warning">{(row.warnings as string[]).join("; ")}</Text>
                              ) : (
                                <Text type="secondary">{t("admin_pharmacy_case.no_extra_warning")}</Text>
                              )}
                              {row.exclusionReason ? (
                                <>
                                  <br />
                                  <Text type="danger">{row.exclusionReason}</Text>
                                </>
                              ) : null}
                            </Descriptions.Item>
                            <Descriptions.Item label={t("admin_pharmacy_case.label_pharmacist_note")} span={2}>
                              <Input
                                value={draft.pharmacistNote}
                                onChange={(event) => patchMedicationDraft(row.rowKey, { pharmacistNote: event.target.value })}
                                placeholder={t("admin_pharmacy_case.note_placeholder")}
                              />
                            </Descriptions.Item>
                          </Descriptions>

                          {(row.catalogMatches || []).length > 1 ? (
                            <div>
                              <Text strong>{t("admin_pharmacy_case.more_matches")}</Text>
                              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {(row.catalogMatches as any[]).slice(1).map((item) => (
                                  <Tag key={item.sku} color="blue">
                                    {item.name} · {item.sku} · ฿{Number(item.price).toLocaleString()}{t("admin_pharmacy_case.remaining_suffix", { n: item.availableTotal })}
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
            style={{ marginBottom: 12, borderRadius: 10 }}
          >
            <TextArea
              placeholder={t("admin_pharmacy_case.draft_placeholder")}
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
                {t("admin_pharmacy_case.btn_save_draft")}
              </Button>
              <Button
                disabled={!canDecide || !pharmacistSummaryDraft.trim()}
                onClick={() => setPharmacistResponse(pharmacistSummaryDraft)}
              >
                {t("admin_pharmacy_case.btn_use_as_reply")}
              </Button>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                {t("admin_pharmacy_case.draft_note")}
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="Conversation" style={{ marginBottom: 12, borderRadius: 10 }}>
            {history ? (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Text type="secondary">
                  {t("admin_pharmacy_case.conv_header", { name: history.customerName || history.customerRef || t("admin_pharmacy_case.conv_unknown"), id: history.conversationId.slice(0, 8), channel: history.channel })}
                </Text>
                <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                  <List
                    size="small"
                    dataSource={history.messages || []}
                    locale={{ emptyText: t("admin_pharmacy_case.no_messages") }}
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
              <Alert closable
                type="info"
                showIcon
                message={t("admin_pharmacy_case.no_real_conversation")}
                description={t("admin_pharmacy_case.intake_snapshot_desc")}
              />
            )}

            {history && (c.rawMessages || []).length > 0 ? (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <Space>
                  <Switch checked={showRawConversation} onChange={setShowRawConversation} />
                  <Text>{t("admin_pharmacy_case.show_intake_snapshot")}</Text>
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

          <Card size="small" title="Action workspace" style={{ marginBottom: 12, borderRadius: 10 }}>
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label={t("admin_pharmacy_case.label_selected_count")}>{t("admin_pharmacy_case.count_items", { n: selectedMedicationSummary.count })}</Descriptions.Item>
                <Descriptions.Item label={t("admin_pharmacy_case.label_estimated_value")}>฿{selectedMedicationSummary.total.toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label={t("admin_pharmacy_case.label_missing")}>{missing.length}</Descriptions.Item>
              </Descriptions>

              {checkoutOrderDraft?.status ? (
                <Alert closable
                  type="info"
                  showIcon
                  message={t("admin_pharmacy_case.checkout_draft_status", { status: checkoutOrderDraft.status })}
                  description={
                    checkoutOrderDraft.createdOrderId
                      ? t("admin_pharmacy_case.order_created", { id: checkoutOrderDraft.createdOrderId })
                      : (
                        <div>
                          <div>{t("admin_pharmacy_case.awaiting_customer_confirm")}</div>
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
                <Alert closable
                  type="warning"
                  showIcon
                  message={t("admin_pharmacy_case.meds_need_selection")}
                />
              ) : null}

              {canReview && can("pharmacy.assessment.review") && (
                <Button type="primary" loading={starting} onClick={() => startReview({ variables: { id: c.id } })}>
                  {t("admin_pharmacy_case.btn_start_review")}
                </Button>
              )}

              {canDecide && can("pharmacy.assessment.request_more_information") && (
                <Button
                  loading={requestingMore}
                  onClick={() =>
                    requestMore({ variables: { id: c.id, v: c.version, fields: missing.length ? missing : ["additional_info"], note: reason || null } })
                  }
                >
                  {t("admin_pharmacy_case.btn_request_more")}
                </Button>
              )}

              <TextArea
                placeholder={t("admin_pharmacy_case.advice_placeholder")}
                value={pharmacistResponse}
                onChange={(e) => setPharmacistResponse(e.target.value)}
                rows={5}
                disabled={!canDecide}
              />
              <Input placeholder={t("admin_pharmacy_case.reason_placeholder")} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canDecide} />

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
                {t("admin_pharmacy_case.approve_hint_1")}
                {t("admin_pharmacy_case.approve_hint_2")}
              </Text>

              {c.status !== "CLOSED" && c.status !== "EMERGENCY_REFERRAL" && can("pharmacy.assessment.review") && (
                <>
                  <Divider style={{ margin: "8px 0" }} />
                  <Text strong type="danger">Emergency referral</Text>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      placeholder={t("admin_pharmacy_case.emergency_reason_placeholder")}
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

          <Card size="small" title="Audit Timeline" style={{ borderRadius: 10 }}>
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
        title={t("admin_pharmacy_case.modal_add_med_title")}
        open={productPickerOpen}
        onCancel={() => setProductPickerOpen(false)}
        footer={null}
        width={760}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Alert closable
            type="info"
            showIcon
            message={t("admin_pharmacy_case.search_this_shop_only")}
            description={t("admin_pharmacy_case.search_this_shop_desc")}
          />
          <Input
            placeholder={t("admin_pharmacy_case.search_placeholder")}
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          {productSearchError ? (
            <Alert closable type="error" showIcon message={t("admin_pharmacy_case.catalog_load_error")} description={productSearchError.message} />
          ) : null}
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <List
              loading={productSearchLoading}
              dataSource={productSearchItems}
              locale={{ emptyText: t("admin_pharmacy_case.no_matching_products") }}
              renderItem={(product: any) => {
                const availableTotal = Array.isArray(product.variants)
                  ? product.variants.reduce((sum: number, variant: any) => sum + Math.max(0, Number(variant.available) || 0), 0)
                  : 0;
                return (
                  <List.Item
                    actions={[
                      <Button key="add" type="primary" size="small" disabled={!isPolicyEligibleForPharmacistDraft(product)} onClick={() => addManualProduct(product)}>
                        {t("admin_pharmacy_case.btn_add_to_plan")}
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      <Text strong>{product.name}</Text>
                      <Text type="secondary">
                        {product.sku} · ฿{Number(product.price || 0).toLocaleString()}{t("admin_pharmacy_case.remaining_suffix", { n: availableTotal })}
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
