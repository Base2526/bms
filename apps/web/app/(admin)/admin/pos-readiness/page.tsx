"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
// หน้าเช็คความพร้อมก่อนเปิดขายหน้าร้าน
// -------------------------------------------------------------
// ร้านยาเลือกแนวทาง "รีวิว policy ให้ครบทุกสินค้าก่อนเปิดร้าน" ได้ (สวิตช์ในหน้านี้)
// แต่ค่าปริยายตั้งแต่ 9.29 คือเปิดกะได้เลย เพราะสินค้าที่ยังไม่รีวิวไม่ใช่ทางตันแล้ว —
// เภสัชกรกด PIN อนุมัติที่เครื่องได้ · หน้านี้ยังเป็นที่ตอบว่า "เหลืออีกกี่ตัว"
//
// การแก้ policy รายตัวยังอยู่ที่ /admin/pharmacy-protocols (มี editor ครบอยู่แล้ว)
// หน้านี้ตั้งใจไม่ทำซ้ำ — ทำหน้าที่เป็นตัวนับถอยหลังกับรายการงานที่เหลือ
import { useEffect, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Empty, Form, InputNumber, Popconfirm, Progress, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
import { ReadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q_READINESS = gql`
  query PosReadiness {
    bmsPosOperationalReadiness {
      ready blockers warnings activeLocations activeDevices pairedDevices cashiersWithPin cashiersReady
      sellableProducts unknownVatProducts stockedVariants openShifts pendingRefundCount pendingRefundAmount
    }
    bmsPharmacyPolicyReadiness {
      pharmacyArchetype
      totalProducts
      approved
      pendingReview
      draft
      missing
      ready
      counterAuthorization
      blockShiftOnUnreviewed
    }
    bmsProductsNeedingPolicyReview(limit: 200) {
      sku
      name
      policyStatus
    }
    bmsExpiringLots(withinDays: 90) {
      id
      productSku
      size
      lotNo
      expiryDate
      qty
    }
    bmsLotReconcile {
      productSku
      size
      currentStock
      lotTotal
    }
  }
`;

const M_PHARMACY_COUNTER_SETTINGS = gql`
  mutation SetPharmacyCounterSettings($counter: Boolean, $blockShift: Boolean) {
    bmsSetPharmacyCounterSettings(counterAuthorization: $counter, blockShiftOnUnreviewed: $blockShift) {
      counterAuthorization
      blockShiftOnUnreviewed
    }
  }
`;

const Q_TAX_SETTINGS = gql`
  query PosTaxSettings {
    bmsTaxSettings {
      vatRegistered priceIncludesVat vatRate vatRounding calendarEra abbreviatedApproved cashRounding
    }
  }
`;

const M_TAX_SETTINGS = gql`
  mutation UpdateTaxSettings($input: BmsTaxSettingsInput!) {
    bmsUpdateTaxSettings(input: $input) {
      vatRegistered priceIncludesVat vatRate vatRounding calendarEra abbreviatedApproved cashRounding
    }
  }
`;

const M_SET_VAT_UNKNOWN = gql`
  mutation SetVatCategoryForUnknown($vatCategory: String!) {
    bmsSetVatCategoryForUnknown(vatCategory: $vatCategory)
  }
`;

const POLICY_LABEL = (uiText: UiTranslator = thaiUiText): Record<string, { text: string; color: string }> => ({
  MISSING: { text: uiText("admin_ui.not_started_05265"), color: "red" },
  DRAFT: { text: uiText("admin_ui.draft_d1f1d"), color: "orange" },
  PENDING_REVIEW: { text: uiText("admin_ui.awaiting_pharmacist_review_c686e"), color: "blue" },
  RETIRED: { text: uiText("admin_ui.retire_e8bac"), color: "default" },
});

/**
 * ตั้งประเภท VAT ให้สินค้าที่ยังไม่ระบุ
 *
 * โผล่เฉพาะตอนมีของค้างจริง และเฉพาะร้านที่จด VAT (readiness นับ blocker นี้ให้
 * เฉพาะร้านที่จด) · ปุ่มนี้แตะเฉพาะสินค้าที่ยังเป็น "ยังไม่ระบุ" — ร้านที่แยก V/N
 * ไว้ถูกต้องแล้วต้องไม่พังทั้งร้านเพราะมีคนกดปุ่มนี้ครั้งเดียว
 */
function VatCategoryFixCard({ count, onDone }: { count: number; onDone: () => void }) {
  const uiText = useUiText();
  const { t } = useI18n();
  const [category, setCategory] = useState<"V" | "N">("V");
  const [apply, { loading }] = useMutation(M_SET_VAT_UNKNOWN);

  return (
    <Card title={t("admin_products.vat_bulk_title")}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert closable
          type="warning"
          showIcon
          message={uiText("admin_ui.active_products_have_no_vat_category_442bf", { v0: count })}
          description={t("admin_products.vat_bulk_hint")}
        />
        <Space wrap>
          <Select
            value={category}
            onChange={(v) => setCategory(v)}
            style={{ width: 200 }}
            options={[
              { value: "V", label: t("admin_products.vat_v") },
              { value: "N", label: t("admin_products.vat_n") },
            ]}
          />
          <Popconfirm
            title={t("admin_products.vat_bulk_title")}
            description={uiText("admin_ui.set_products_to_ea575", { v0: count, v1: category === "V" ? t("admin_products.vat_v") : t("admin_products.vat_n") })}
            onConfirm={async () => {
              try {
                const res = await apply({ variables: { vatCategory: category } });
                message.success(
                  t("admin_products.vat_bulk_done").replace(
                    "{count}",
                    String(res.data?.bmsSetVatCategoryForUnknown ?? 0)
                  )
                );
                onDone();
              } catch (e: any) {
                message.error(e?.message || uiText("admin_ui.couldn_t_save_settings_473c9"));
              }
            }}
          >
            <Button type="primary" loading={loading}>{t("admin_products.vat_bulk_apply")}</Button>
          </Popconfirm>
          <Typography.Text type="secondary">
            {uiText("admin_ui.edit_individual_products_at_cffcb")} <a href="/admin/products">{uiText("admin_ui.product_8432c")}</a>
          </Typography.Text>
        </Space>
      </Space>
    </Card>
  );
}

/**
 * ค่าตั้งภาษี — เดิมอยู่ในตาราง bms_store_profile แต่ไม่มีที่แก้ในแอปเลย
 * ร้านต้องรัน SQL เอง · วางไว้หน้านี้เพราะเป็นหน้าที่ใช้ก่อนเปิดขายจริง
 * และ readiness ด้านบนก็เตือนเรื่องใบกำกับอย่างย่อจากค่าชุดเดียวกันนี้
 */
/**
 * สองสวิตช์ของ "ใครปล่อยยาออกจากร้านได้" (9.29)
 *
 * บันทึกทันทีที่สับสวิตช์ ไม่มีปุ่มบันทึกรวม — สองค่านี้ไม่ขึ้นแก่กันและเป็นค่าที่คน
 * มาสับตอนกำลังยืนแก้ปัญหาหน้าร้าน ไม่ใช่ฟอร์มที่กรอกทีเดียวจบเหมือนค่าตั้งภาษี
 */
function PharmacyCounterSettingsCard({
  counterAuthorization,
  blockShiftOnUnreviewed,
  onSaved,
}: {
  counterAuthorization: boolean;
  blockShiftOnUnreviewed: boolean;
  onSaved: () => void;
}) {
  const uiText = useUiText();
  const [save, { loading: saving }] = useMutation(M_PHARMACY_COUNTER_SETTINGS);

  const set = async (variables: { counter?: boolean; blockShift?: boolean }) => {
    try {
      await save({ variables });
      message.success(uiText("admin_ui.saved_75237"));
      onSaved();
    } catch (e: any) {
      message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
    }
  };

  return (
    <Card title={uiText("admin_ui.pharmacist_approval_at_the_counter_b2974")}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space align="start" size="middle">
          <Switch
            checked={counterAuthorization}
            loading={saving}
            onChange={(checked) => void set({ counter: checked })}
          />
          <div>
            <Typography.Text strong>{uiText("admin_ui.allow_pharmacists_to_approve_dispensing_with_a_pin_a265f")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {uiText("admin_ui.enabled_a_pharmacist_at_the_counter_can_approve_690cc")}</Typography.Paragraph>
          </div>
        </Space>
        <Space align="start" size="middle">
          <Switch
            checked={blockShiftOnUnreviewed}
            loading={saving}
            onChange={(checked) => void set({ blockShift: checked })}
          />
          <div>
            <Typography.Text strong>{uiText("admin_ui.block_shift_opening_until_all_product_policies_are_39843")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {uiText("admin_ui.disabled_default_the_store_can_open_with_pharmacist_ab8d4")}</Typography.Paragraph>
          </div>
        </Space>
      </Space>
    </Card>
  );
}

function TaxSettingsCard({ onSaved }: { onSaved: () => void }) {
  const uiText = useUiText();
  const { t } = useI18n();
  const [form] = Form.useForm();
  const { data, loading } = useQuery(Q_TAX_SETTINGS, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M_TAX_SETTINGS);
  const settings = data?.bmsTaxSettings;

  useEffect(() => {
    if (settings) form.setFieldsValue(settings);
  }, [settings, form]);

  return (
    <Card title={uiText("admin_ui.store_tax_settings_4e7ff")} loading={loading && !settings}>
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={uiText("admin_ui.applies_only_to_new_bills_d18a1")}
        description={uiText("admin_ui.issued_documents_retain_their_own_rates_and_amounts_f4742")}
      />
      {settings?.priceIncludesVat === false && (
        <Alert
          closable
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("admin_pos_readiness.vat_exclusive_blocker_title")}
          description={t("admin_pos_readiness.vat_exclusive_blocker_description")}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            await save({ variables: { input: { ...values, vatRate: Number(values.vatRate) } } });
            message.success(uiText("admin_ui.tax_settings_saved_78555"));
            onSaved();
          } catch (e: any) {
            message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
          }
        }}
      >
        <Space size="large" wrap align="start">
          <Form.Item name="vatRegistered" label={uiText("admin_ui.store_is_vat_registered_ce9b7")} valuePropName="checked">
            <Switch checkedChildren={uiText("admin_ui.registered_15804")} unCheckedChildren={uiText("admin_ui.not_registered_e3a8c")} />
          </Form.Item>
          <Form.Item
            name="abbreviatedApproved"
            label={uiText("admin_ui.authorized_to_issue_abbreviated_tax_invoices_66870")}
            valuePropName="checked"
            tooltip={uiText("admin_ui.select_only_after_revenue_department_approval_selling_remains_a4352")}
          >
            <Switch checkedChildren={uiText("admin_ui.approved_8f71e")} unCheckedChildren={uiText("admin_ui.not_yet_baa0a")} />
          </Form.Item>
          <Form.Item name="vatRate" label={uiText("admin_ui.vat_rate_a129c")}>
            <InputNumber min={0} max={100} step={0.5} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item
            name="priceIncludesVat"
            label={uiText("admin_ui.configured_product_prices_7c712")}
            help={t("admin_pos_readiness.vat_included_only_reason")}
          >
            <Select
              style={{ width: 200 }}
              options={[
                { value: true, label: t("admin_pos_readiness.vat_included") },
                { value: false, label: t("admin_pos_readiness.vat_excluded_disabled"), disabled: true },
              ]}
            />
          </Form.Item>
          <Form.Item name="vatRounding" label={uiText("admin_ui.vat_rounding_method_3185b")}>
            <Select
              style={{ width: 220 }}
              options={[
                { value: "BASE_FIRST", label: uiText("admin_ui.round_tax_base_first_default_46774") },
                { value: "VAT_FIRST_TRUNCATE", label: uiText("admin_ui.truncate_vat_362df") },
                { value: "VAT_FIRST_ROUND", label: uiText("admin_ui.round_vat_normally_654c9") },
              ]}
            />
          </Form.Item>
          <Form.Item name="calendarEra" label={uiText("admin_ui.year_format_on_documents_967c4")}>
            <Select
              style={{ width: 140 }}
              options={[
                { value: "BE", label: uiText("admin_ui.buddhist_era_1d3e9") },
                { value: "CE", label: uiText("admin_ui.common_era_087aa") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="cashRounding"
            label={uiText("admin_ui.cash_rounding_72bf0")}
            tooltip={uiText("admin_ui.applies_only_to_cash_only_bills_rounding_appears_74d15")}
          >
            <Select
              style={{ width: 160 }}
              options={[
                { value: "NONE", label: uiText("admin_ui.no_rounding_34563") },
                { value: "0.25", label: uiText("admin_ui.round_to_0_25_99fc7") },
                { value: "0.50", label: uiText("admin_ui.round_to_0_50_a70f7") },
                { value: "1.00", label: uiText("admin_ui.round_to_1_baht_2bb65") },
              ]}
            />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          {uiText("admin_ui.save_tax_settings_5d741")}</Button>
      </Form>
    </Card>
  );
}

export default function PosReadinessPage() {
  const uiText = useUiText();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canRead = can("pos.device.manage") && can("pharmacy.policy.read") && can("product.view") && can("stock.adjust");
  const { data, loading, refetch } = useQuery(Q_READINESS, {
    fetchPolicy: "cache-and-network",
    skip: !canRead,
  });

  if (!permsLoading && !canRead) {
    // ค่าตั้งภาษีมีสิทธิ์ของตัวเอง (tax.setting.manage) — ไม่ควรถูกล็อกเพราะบัญชีนี้
    // ไม่มีสิทธิ์ดู lot หรือนโยบายร้านยา ซึ่งเป็นคนละเรื่องกัน
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <AdminPageHeader title={uiText("admin_ui.pos_readiness_before_opening_59633")} />
        <Alert closable type="error" showIcon message={uiText("admin_ui.you_lack_permission_for_one_or_more_of_fe7f7")} />
        {can("tax.setting.manage") && <TaxSettingsCard onSaved={() => {}} />}
      </Space>
    );
  }

  const operational = data?.bmsPosOperationalReadiness;
  const readiness = data?.bmsPharmacyPolicyReadiness;
  const pending = data?.bmsProductsNeedingPolicyReview ?? [];
  const expiring = data?.bmsExpiringLots ?? [];
  const mismatches = data?.bmsLotReconcile ?? [];

  const total = readiness?.totalProducts ?? 0;
  const approved = readiness?.approved ?? 0;
  const percent = total === 0 ? 100 : Math.round((approved / total) * 100);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.pos_readiness_before_opening_59633")}>
        <Link href="/admin/pos-manual"><Button icon={<ReadOutlined />}>{uiText("admin_ui.cashier_manual_3e8eb")}</Button></Link>
      </AdminPageHeader>

      <Card title={uiText("admin_ui.core_pos_readiness_dc724")} loading={loading}>
        {operational && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert closable
              type={operational.ready ? "success" : "error"}
              showIcon
              message={operational.ready ? uiText("admin_ui.master_data_is_ready_for_shift_opening_73cdd") : uiText("admin_ui.blockers_remain_b9369", { v0: operational.blockers.length })}
              description={operational.ready ? uiText("admin_ui.scanners_printers_payment_methods_and_offline_procedures_still_0b019") : operational.blockers.join(" · ")}
            />
            {operational.warnings.length > 0 && (
              <Alert closable type="warning" showIcon message={uiText("admin_ui.items_to_review_84841")} description={operational.warnings.join(" · ")} />
            )}
            <Space size="large" wrap>
              <Statistic title={uiText("admin_ui.active_branches_58307")} value={operational.activeLocations} />
              <Statistic title={uiText("admin_ui.ready_devices_44917")} value={operational.pairedDevices} suffix={`/ ${operational.activeDevices}`} />
              <Statistic title={uiText("admin_ui.staff_ready_to_sell_a44b9")} value={operational.cashiersReady} suffix={`/ ${operational.cashiersWithPin}`} />
              <Statistic title={uiText("admin_ui.active_products_bda3b")} value={operational.sellableProducts} />
              <Statistic title={uiText("admin_ui.sellable_stock_78318")} value={operational.stockedVariants} />
              <Statistic title={uiText("admin_ui.pending_refunds_e9a03")} value={operational.pendingRefundCount} valueStyle={operational.pendingRefundCount ? { color: "#cf1322" } : undefined} />
            </Space>
          </Space>
        )}
      </Card>

      {can("tax.setting.manage") && <TaxSettingsCard onSaved={() => void refetch()} />}

      {/* blocker "ยังไม่ระบุประเภท VAT" เดิมแก้ไม่ได้เลย — คอลัมน์ vat_category มีมา
          ตั้งแต่ 7.88 แต่ไม่มีที่ไหนเขียน · ตอนนี้แก้รายตัวได้ที่หน้าสินค้า และตั้ง
          ทีเดียวทั้งร้านได้จากที่นี่ เพราะร้านที่มีสินค้าหลายร้อยตัวไล่กดไม่ไหว */}
      {can("tax.setting.manage") && (operational?.unknownVatProducts ?? 0) > 0 && (
        <VatCategoryFixCard
          count={operational!.unknownVatProducts}
          onDone={() => void refetch()}
        />
      )}

      {readiness && !readiness.pharmacyArchetype && (
        <Alert closable
          type="info"
          showIcon
          message={uiText("admin_ui.this_store_is_not_configured_as_a_pharmacy_551f8")}
          description={uiText("admin_ui.pharmacy_sales_rules_are_not_enforced_and_product_686d5")}
        />
      )}

      {readiness?.pharmacyArchetype && can("pharmacy.policy.review") && (
        <PharmacyCounterSettingsCard
          counterAuthorization={readiness.counterAuthorization}
          blockShiftOnUnreviewed={readiness.blockShiftOnUnreviewed}
          onSaved={() => void refetch()}
        />
      )}

      {readiness?.pharmacyArchetype && (
        <Card>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {readiness.ready ? (
              <Alert closable type="success" showIcon message={uiText("admin_ui.all_reviews_complete_shifts_can_open_723e3")} />
            ) : (
              <Alert closable
                type="warning"
                showIcon
                message={
                  readiness.blockShiftOnUnreviewed
                    ? uiText("admin_ui.cannot_open_a_shift_yet_items_remain_544c3", { v0: total - approved })
                    : uiText("admin_ui.shifts_can_open_but_products_still_need_review_85b85", { v0: total - approved })
                }
                description={
                  readiness.blockShiftOnUnreviewed
                    ? uiText("admin_ui.a_pharmacist_must_approve_sales_policies_for_every_2b0a5")
                    : uiText("admin_ui.unreviewed_products_can_be_sold_with_pharmacist_pin_ba1f0")
                }
              />
            )}
            <Progress percent={percent} status={readiness.ready ? "success" : "active"} />
            <Space size="large" wrap>
              <Statistic title={uiText("admin_ui.all_products_19b99")} value={total} />
              <Statistic title={uiText("admin_ui.approved_8f71e")} value={approved} valueStyle={{ color: "#3f8600" }} />
              <Statistic title={uiText("admin_ui.not_started_05265")} value={readiness.missing} valueStyle={{ color: "#cf1322" }} />
              <Statistic title={uiText("admin_ui.draft_d1f1d")} value={readiness.draft} />
              <Statistic title={uiText("admin_ui.awaiting_review_7d229")} value={readiness.pendingReview} />
            </Space>
          </Space>
        </Card>
      )}

      {readiness?.pharmacyArchetype && (
      <Card title={uiText("admin_ui.products_awaiting_pharmacist_review_fde1a")} loading={loading}>
        {pending.length === 0 ? (
          <Empty description={uiText("admin_ui.no_pending_items_c67af")} />
        ) : (
          <Table
            size="small"
            rowKey="sku"
            dataSource={pending}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 160 },
              { title: uiText("admin_ui.product_name_c9863"), dataIndex: "name" },
              {
                title: uiText("admin_ui.status_2e8c4"),
                dataIndex: "policyStatus",
                width: 160,
                render: (v: string) => {
                  const meta = POLICY_LABEL(uiText)[v] ?? { text: v, color: "default" };
                  return <Tag color={meta.color}>{meta.text}</Tag>;
                },
              },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {uiText("admin_ui.edit_and_approve_at_7be7f")} <a href="/admin/pharmacy-protocols">{uiText("admin_ui.product_sales_policies_30fe0")}</a>
        </Typography.Paragraph>
      </Card>
      )}

      <Card title={uiText("admin_ui.lots_expired_expiring_within_90_days_1c241")} loading={loading}>
        {expiring.length === 0 ? (
          <Empty description={uiText("admin_ui.no_lots_nearing_expiry_b6300")} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={expiring}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "productSku", width: 160 },
              { title: uiText("admin_ui.size_ff4b6"), dataIndex: "size", width: 80 },
              { title: uiText("admin_ui.en_lot_dcf6a"), dataIndex: "lotNo", width: 140 },
              {
                title: uiText("admin_ui.expiry_date_73dd6"),
                dataIndex: "expiryDate",
                width: 140,
                render: (v: string) =>
                  v && v < today ? <Tag color="red">{v}  {uiText("admin_ui.expired_e0a95")}</Tag> : <Tag color="orange">{v}</Tag>,
              },
              { title: uiText("admin_ui.available_dd579"), dataIndex: "qty", width: 100 },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {uiText("admin_ui.expired_lots_are_automatically_skipped_during_sales_fefo_cc469")}</Typography.Paragraph>
      </Card>

      <Card title={uiText("admin_ui.lot_balances_do_not_match_total_stock_224b7")} loading={loading}>
        {mismatches.length === 0 ? (
          <Empty description={uiText("admin_ui.all_rows_match_ee352")} />
        ) : (
          <>
            <Alert closable
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={uiText("admin_ui.products_without_recorded_lots_appear_here_b3af4")}
              description={uiText("admin_ui.this_list_may_be_long_if_existing_stock_fa117")}
            />
            <Table
              size="small"
              rowKey={(r: any) => `${r.productSku}__${r.size}`}
              dataSource={mismatches}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: "SKU", dataIndex: "productSku", width: 160 },
                { title: uiText("admin_ui.size_ff4b6"), dataIndex: "size", width: 80 },
                { title: uiText("admin_ui.total_stock_b47e3"), dataIndex: "currentStock", width: 120 },
                { title: uiText("admin_ui.lot_total_aee11"), dataIndex: "lotTotal", width: 120 },
                {
                  title: uiText("admin_ui.difference_d5059"),
                  width: 100,
                  render: (_: unknown, r: any) => (
                    <Tag color="red">{r.currentStock - r.lotTotal}</Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </Space>
  );
}
