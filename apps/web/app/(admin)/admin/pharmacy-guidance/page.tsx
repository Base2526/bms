'use client';
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Empty, Input, Modal, Popconfirm, Space, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";
import {
  PHARMACY_GUIDANCE_CODES,
  pharmacyGuidanceWarnings,
  renderPharmacyGuidance,
  type PharmacyGuidanceCode,
  type PharmacyGuidanceLocale,
} from "@/lib/bms/pharmacy/guidanceTemplates";

const Q_GUIDANCE = gql`
  query PharmacyGuidance {
    bmsPharmacyGuidanceTemplates {
      id code locale body status version approvedByName approvedAt approvedLicenseNo updatedAt warnings
    }
    bmsPharmacyGuidanceDefaults { code locale body warnings }
    bmsPharmacyGuidanceEditorContext { licensedPharmacist shopPhone businessHours shopAddress }
  }
`;
const M_SAVE = gql`
  mutation SavePharmacyGuidance($code: String!, $locale: String!, $body: String!) {
    bmsSavePharmacyGuidanceDraft(code: $code, locale: $locale, body: $body) { id status version }
  }
`;
const M_SEED = gql`mutation SeedPharmacyGuidance { bmsSeedPharmacyGuidanceDrafts }`;
const M_APPROVE = gql`
  mutation ApprovePharmacyGuidance($id: ID!, $version: Int!) {
    bmsApprovePharmacyGuidance(id: $id, version: $version) { id status version }
  }
`;
const M_RETIRE = gql`
  mutation RetirePharmacyGuidance($id: ID!) { bmsRetirePharmacyGuidance(id: $id) { id status } }
`;

type Template = {
  id: string; code: PharmacyGuidanceCode; locale: PharmacyGuidanceLocale; body: string;
  status: "DRAFT" | "APPROVED" | "RETIRED"; version: number; approvedByName: string | null;
  approvedAt: string | null; approvedLicenseNo: string | null; updatedAt: string; warnings: string[];
};
type DefaultDraft = { code: PharmacyGuidanceCode; locale: PharmacyGuidanceLocale; body: string; warnings: string[] };

const LOCALES: PharmacyGuidanceLocale[] = ["th", "en"];
const STATUS_COLOR: Record<Template["status"], string> = { DRAFT: "gold", APPROVED: "green", RETIRED: "default" };

export default function PharmacyGuidancePage() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const canManage = can("pharmacy.protocol.manage");
  const { data, loading, error, refetch } = useQuery(Q_GUIDANCE, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M_SAVE);
  const [seed, { loading: seeding }] = useMutation(M_SEED);
  const [approve] = useMutation(M_APPROVE);
  const [retire] = useMutation(M_RETIRE);
  const [editing, setEditing] = useState<{ code: PharmacyGuidanceCode; locale: PharmacyGuidanceLocale; body: string } | null>(null);

  const rows: Template[] = data?.bmsPharmacyGuidanceTemplates ?? [];
  const defaults: DefaultDraft[] = data?.bmsPharmacyGuidanceDefaults ?? [];
  const byKey = useMemo(() => new Map(rows.map((row) => [`${row.code}:${row.locale}`, row])), [rows]);
  const defaultByKey = useMemo(() => new Map(defaults.map((row) => [`${row.code}:${row.locale}`, row])), [defaults]);
  const approvedCount = rows.filter((row) => row.status === "APPROVED").length;
  const editorContext = data?.bmsPharmacyGuidanceEditorContext;
  const canApprove = canManage && editorContext?.licensedPharmacist === true;
  const previewValues = { shop_phone: editorContext?.shopPhone, business_hours: editorContext?.businessHours,
    shop_address: editorContext?.shopAddress };

  const run = async (work: () => Promise<unknown>, ok: string) => {
    try {
      await work();
      message.success(ok);
      await refetch();
    } catch (err: any) {
      message.error(err?.message || t("admin_pharmacy_guidance.failed"));
    }
  };

  const editorWarnings = editing ? pharmacyGuidanceWarnings(editing.body) : [];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_pharmacy_guidance.title")}</Typography.Title>}>
        {canManage ? (
          <Button loading={seeding} onClick={() => run(() => seed(), t("admin_pharmacy_guidance.seeded"))}>
            {t("admin_pharmacy_guidance.seed")}
          </Button>
        ) : null}
      </AdminPageHeader>
      <Alert closable type="info" showIcon style={{ marginBottom: 12 }}
        message={t("admin_pharmacy_guidance.intro")}
        description={t("admin_pharmacy_guidance.intro_rules")} />
      <Alert closable type={approvedCount ? "success" : "warning"} showIcon style={{ marginBottom: 16 }}
        message={t("admin_pharmacy_guidance.approved_count", { count: approvedCount, total: PHARMACY_GUIDANCE_CODES.length * LOCALES.length })}
        description={t("admin_pharmacy_guidance.fallback_note")} />
      {error ? <Alert closable type="error" showIcon style={{ marginBottom: 16 }} message={error.message} /> : null}

      {PHARMACY_GUIDANCE_CODES.map((code) => (
        <Card key={code} size="small" loading={loading && !data} style={{ marginBottom: 12 }}
          title={<Space wrap><Typography.Text strong>{t(`admin_pharmacy_guidance.code_${code}`)}</Typography.Text>
            <Typography.Text type="secondary">{t(`admin_pharmacy_guidance.example_${code}`)}</Typography.Text></Space>}>
          {LOCALES.map((locale) => {
            const row = byKey.get(`${code}:${locale}`);
            const fallback = defaultByKey.get(`${code}:${locale}`);
            return (
              <div key={locale} style={{ marginBottom: 12 }}>
                <Space wrap style={{ marginBottom: 6 }}>
                  <Tag>{locale.toUpperCase()}</Tag>
                  {row ? <Tag color={STATUS_COLOR[row.status]}>{t(`admin_pharmacy_guidance.status_${row.status}`)}</Tag>
                    : <Tag>{t("admin_pharmacy_guidance.status_none")}</Tag>}
                  {row ? <Typography.Text type="secondary">v{row.version}</Typography.Text> : null}
                  {row?.status === "APPROVED" ? (
                    <Typography.Text type="secondary">
                      {t("admin_pharmacy_guidance.approved_by", {
                        name: row.approvedByName ?? "—",
                        license: row.approvedLicenseNo ?? "—",
                        at: row.approvedAt ? new Date(row.approvedAt).toLocaleString() : "—",
                      })}
                    </Typography.Text>
                  ) : null}
                </Space>
                {row ? (
                  <>
                    {row.warnings.length ? (
                      <Alert closable type="warning" showIcon style={{ marginBottom: 6 }}
                        message={row.warnings.map((w) => t(`admin_pharmacy_guidance.warning_${w}`)).join(" · ")} />
                    ) : null}
                    <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{row.body}</Typography.Paragraph>
                  </>
                ) : (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 6 }}>{t("admin_pharmacy_guidance.no_row")}</Typography.Paragraph>
                )}
                {canManage ? (
                  <Space wrap>
                    <Button size="small" onClick={() => setEditing({ code, locale, body: row?.body ?? fallback?.body ?? "" })}>
                      {row ? t("admin_pharmacy_guidance.edit") : t("admin_pharmacy_guidance.create")}
                    </Button>
                    {canApprove && row?.status === "DRAFT" ? (
                      <Popconfirm title={t("admin_pharmacy_guidance.approve_confirm")}
                        onConfirm={() => run(() => approve({ variables: { id: row.id, version: row.version } }), t("admin_pharmacy_guidance.approved"))}>
                        <Button size="small" type="primary">{t("admin_pharmacy_guidance.approve")}</Button>
                      </Popconfirm>
                    ) : null}
                    {row && row.status !== "RETIRED" ? (
                      <Popconfirm title={t("admin_pharmacy_guidance.retire_confirm")}
                        onConfirm={() => run(() => retire({ variables: { id: row.id } }), t("admin_pharmacy_guidance.retired"))}>
                        <Button size="small" danger>{t("admin_pharmacy_guidance.retire")}</Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                ) : null}
              </div>
            );
          })}
        </Card>
      ))}
      {!loading && !rows.length && !defaults.length ? <Empty /> : null}

      <Modal open={!!editing} width={720} destroyOnClose
        title={editing ? `${t(`admin_pharmacy_guidance.code_${editing.code}`)} · ${editing.locale.toUpperCase()}` : ""}
        okText={t("admin_pharmacy_guidance.save_draft")} confirmLoading={saving}
        onCancel={() => setEditing(null)}
        onOk={() => editing && run(async () => {
          await save({ variables: editing });
          setEditing(null);
        }, t("admin_pharmacy_guidance.saved"))}>
        {editing ? (
          <>
            <Alert closable type="info" showIcon style={{ marginBottom: 8 }} message={t("admin_pharmacy_guidance.placeholders")} />
            <Input.TextArea rows={10} maxLength={2000} showCount value={editing.body}
              onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
            {editorWarnings.length ? (
              <Alert closable type="warning" showIcon style={{ marginTop: 8 }}
                message={editorWarnings.map((w) => t(`admin_pharmacy_guidance.warning_${w}`)).join(" · ")} />
            ) : null}
            <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{t("admin_pharmacy_guidance.preview")}</Typography.Text>
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap", background: "var(--ant-color-fill-tertiary, #f5f5f5)", padding: 8, borderRadius: 6 }}>
              {editorContext ? renderPharmacyGuidance(editing.body, previewValues, editing.locale)
                : t("admin_pharmacy_guidance.preview_unavailable")}
            </Typography.Paragraph>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
