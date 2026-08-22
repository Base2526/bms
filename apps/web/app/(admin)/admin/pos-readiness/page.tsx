'use client';
// หน้าเช็คความพร้อมก่อนเปิดขายหน้าร้าน
// -------------------------------------------------------------
// ร้านยาเลือกแนวทาง "รีวิว policy ให้ครบทุกสินค้าก่อนเปิดร้าน" → openPosShift()
// จะบล็อกจนกว่าจะครบ หน้านี้คือที่ที่ตอบว่า "เหลืออีกกี่ตัว" ก่อนจะไปเจอ
// PHARMACY_POLICY_UNKNOWN ตอนมีลูกค้ายืนรออยู่หน้าเคาน์เตอร์
//
// การแก้ policy รายตัวยังอยู่ที่ /admin/pharmacy-protocols (มี editor ครบอยู่แล้ว)
// หน้านี้ตั้งใจไม่ทำซ้ำ — ทำหน้าที่เป็นตัวนับถอยหลังกับรายการงานที่เหลือ
import { useEffect, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Empty, Form, InputNumber, Popconfirm, Progress, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
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

const POLICY_LABEL: Record<string, { text: string; color: string }> = {
  MISSING: { text: "ยังไม่เริ่ม", color: "red" },
  DRAFT: { text: "ร่าง", color: "orange" },
  PENDING_REVIEW: { text: "รอเภสัชกรตรวจ", color: "blue" },
  RETIRED: { text: "เลิกใช้", color: "default" },
};

/**
 * ตั้งประเภท VAT ให้สินค้าที่ยังไม่ระบุ
 *
 * โผล่เฉพาะตอนมีของค้างจริง และเฉพาะร้านที่จด VAT (readiness นับ blocker นี้ให้
 * เฉพาะร้านที่จด) · ปุ่มนี้แตะเฉพาะสินค้าที่ยังเป็น "ยังไม่ระบุ" — ร้านที่แยก V/N
 * ไว้ถูกต้องแล้วต้องไม่พังทั้งร้านเพราะมีคนกดปุ่มนี้ครั้งเดียว
 */
function VatCategoryFixCard({ count, onDone }: { count: number; onDone: () => void }) {
  const { t } = useI18n();
  const [category, setCategory] = useState<"V" | "N">("V");
  const [apply, { loading }] = useMutation(M_SET_VAT_UNKNOWN);

  return (
    <Card title={t("admin_products.vat_bulk_title")}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message={`สินค้าที่เปิดขายยังไม่ระบุประเภท VAT ${count} รายการ`}
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
            description={`ตั้งให้สินค้า ${count} รายการเป็น ${category === "V" ? t("admin_products.vat_v") : t("admin_products.vat_n")}`}
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
                message.error(e?.message || "ตั้งค่าไม่สำเร็จ");
              }
            }}
          >
            <Button type="primary" loading={loading}>{t("admin_products.vat_bulk_apply")}</Button>
          </Popconfirm>
          <Typography.Text type="secondary">
            แก้รายตัวได้ที่ <a href="/admin/products">สินค้า</a>
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
function TaxSettingsCard({ onSaved }: { onSaved: () => void }) {
  const [form] = Form.useForm();
  const { data, loading } = useQuery(Q_TAX_SETTINGS, { fetchPolicy: "cache-and-network" });
  const [save, { loading: saving }] = useMutation(M_TAX_SETTINGS);
  const settings = data?.bmsTaxSettings;

  useEffect(() => {
    if (settings) form.setFieldsValue(settings);
  }, [settings, form]);

  return (
    <Card title="ค่าตั้งภาษีของร้าน" loading={loading && !settings}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="มีผลกับบิลใหม่เท่านั้น"
        description="เอกสารที่ออกไปแล้วเก็บอัตราและยอดของตัวเองไว้ในเอกสารนั้น การแก้ตรงนี้ไม่ย้อนแก้ของเก่า · ค่าที่ถูกต้องให้ยืนยันกับผู้ทำบัญชีของร้านก่อนเปิดขาย"
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            await save({ variables: { input: { ...values, vatRate: Number(values.vatRate) } } });
            message.success("บันทึกค่าตั้งภาษีแล้ว");
            onSaved();
          } catch (e: any) {
            message.error(e?.message ?? "บันทึกไม่สำเร็จ");
          }
        }}
      >
        <Space size="large" wrap align="start">
          <Form.Item name="vatRegistered" label="ร้านจด VAT" valuePropName="checked">
            <Switch checkedChildren="จด" unCheckedChildren="ไม่จด" />
          </Form.Item>
          <Form.Item
            name="abbreviatedApproved"
            label="ได้รับอนุมัติให้ออกใบกำกับอย่างย่อ"
            valuePropName="checked"
            tooltip="ติ๊กเมื่อร้านได้รับอนุมัติจากสรรพากรแล้ว — ไม่ติ๊กจะยังขายได้แต่หน้าความพร้อมจะเตือนค้างไว้"
          >
            <Switch checkedChildren="อนุมัติแล้ว" unCheckedChildren="ยังไม่" />
          </Form.Item>
          <Form.Item name="vatRate" label="อัตรา VAT (%)">
            <InputNumber min={0} max={100} step={0.5} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="priceIncludesVat" label="ราคาสินค้าที่ตั้งไว้">
            <Select
              style={{ width: 200 }}
              options={[
                { value: true, label: "รวม VAT แล้ว" },
                { value: false, label: "ยังไม่รวม VAT" },
              ]}
            />
          </Form.Item>
          <Form.Item name="vatRounding" label="วิธีปัดเศษ VAT">
            <Select
              style={{ width: 220 }}
              options={[
                { value: "BASE_FIRST", label: "ปัดฐานก่อน (ค่าเริ่มต้น)" },
                { value: "VAT_FIRST_TRUNCATE", label: "ตัดเศษ VAT ทิ้ง" },
                { value: "VAT_FIRST_ROUND", label: "ปัด VAT ตามปกติ" },
              ]}
            />
          </Form.Item>
          <Form.Item name="calendarEra" label="ปีบนเอกสาร">
            <Select
              style={{ width: 140 }}
              options={[
                { value: "BE", label: "พ.ศ." },
                { value: "CE", label: "ค.ศ." },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="cashRounding"
            label="ปัดเศษเงินสด"
            tooltip="ใช้เฉพาะบิลที่จ่ายเงินสดล้วน · ยอดปัดเป็นบรรทัดแยกบนใบเสร็จ ไม่ใช่ส่วนลด และไม่แตะฐาน VAT"
          >
            <Select
              style={{ width: 160 }}
              options={[
                { value: "NONE", label: "ไม่ปัด" },
                { value: "0.25", label: "ปัดที่ 0.25" },
                { value: "0.50", label: "ปัดที่ 0.50" },
                { value: "1.00", label: "ปัดที่ 1 บาท" },
              ]}
            />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          บันทึกค่าตั้งภาษี
        </Button>
      </Form>
    </Card>
  );
}

export default function PosReadinessPage() {
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
        <AdminPageHeader title="ความพร้อมก่อนเปิดขายหน้าร้าน" />
        <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูความพร้อม POS, สินค้า, lot หรือนโยบายร้านยาอย่างใดอย่างหนึ่ง" />
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
      <AdminPageHeader title="ความพร้อมก่อนเปิดขายหน้าร้าน" />

      <Card title="ความพร้อม POS หลัก" loading={loading}>
        {operational && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type={operational.ready ? "success" : "error"}
              showIcon
              message={operational.ready ? "ข้อมูลหลักพร้อมสำหรับเปิดกะ" : `ยังมี blocker ${operational.blockers.length} รายการ`}
              description={operational.ready ? "ยังต้องทดสอบเครื่องสแกน เครื่องพิมพ์ ช่องทางรับเงิน และแผนเมื่อระบบออฟไลน์บนเครื่องจริง" : operational.blockers.join(" · ")}
            />
            {operational.warnings.length > 0 && (
              <Alert type="warning" showIcon message="รายการที่ควรตรวจ" description={operational.warnings.join(" · ")} />
            )}
            <Space size="large" wrap>
              <Statistic title="สาขาที่เปิด" value={operational.activeLocations} />
              <Statistic title="เครื่องพร้อมใช้" value={operational.pairedDevices} suffix={`/ ${operational.activeDevices}`} />
              <Statistic title="พนักงานพร้อมขาย" value={operational.cashiersReady} suffix={`/ ${operational.cashiersWithPin}`} />
              <Statistic title="สินค้าที่เปิดขาย" value={operational.sellableProducts} />
              <Statistic title="สต็อกพร้อมขาย" value={operational.stockedVariants} />
              <Statistic title="refund ค้าง" value={operational.pendingRefundCount} valueStyle={operational.pendingRefundCount ? { color: "#cf1322" } : undefined} />
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
        <Alert
          type="info"
          showIcon
          message="ร้านนี้ไม่ได้ตั้งเป็นร้านยา"
          description="กฎการขายยาไม่ถูกบังคับใช้ และไม่มีการบล็อกการเปิดกะจากเรื่อง policy สินค้า"
        />
      )}

      {readiness?.pharmacyArchetype && (
        <Card>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {readiness.ready ? (
              <Alert type="success" showIcon message="รีวิวครบแล้ว เปิดกะขายได้" />
            ) : (
              <Alert
                type="warning"
                showIcon
                message={`ยังเปิดกะไม่ได้ — เหลืออีก ${total - approved} รายการ`}
                description="เภสัชกรต้องอนุมัตินโยบายการขายให้ครบทุกสินค้าที่ยังใช้งานอยู่ก่อน มิฉะนั้นสินค้าที่ยังไม่ผ่านจะขายไม่ได้กลางคิวลูกค้า"
              />
            )}
            <Progress percent={percent} status={readiness.ready ? "success" : "active"} />
            <Space size="large" wrap>
              <Statistic title="สินค้าทั้งหมด" value={total} />
              <Statistic title="อนุมัติแล้ว" value={approved} valueStyle={{ color: "#3f8600" }} />
              <Statistic title="ยังไม่เริ่ม" value={readiness.missing} valueStyle={{ color: "#cf1322" }} />
              <Statistic title="ร่าง" value={readiness.draft} />
              <Statistic title="รอตรวจ" value={readiness.pendingReview} />
            </Space>
          </Space>
        </Card>
      )}

      {readiness?.pharmacyArchetype && (
      <Card title="สินค้าที่ยังรอเภสัชกร" loading={loading}>
        {pending.length === 0 ? (
          <Empty description="ไม่มีรายการค้าง" />
        ) : (
          <Table
            size="small"
            rowKey="sku"
            dataSource={pending}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 160 },
              { title: "ชื่อสินค้า", dataIndex: "name" },
              {
                title: "สถานะ",
                dataIndex: "policyStatus",
                width: 160,
                render: (v: string) => {
                  const meta = POLICY_LABEL[v] ?? { text: v, color: "default" };
                  return <Tag color={meta.color}>{meta.text}</Tag>;
                },
              },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          แก้ไขและอนุมัติได้ที่ <a href="/admin/pharmacy-protocols">นโยบายการขายรายสินค้า</a>
        </Typography.Paragraph>
      </Card>
      )}

      <Card title="lot ที่หมดอายุแล้ว / จะหมดใน 90 วัน" loading={loading}>
        {expiring.length === 0 ? (
          <Empty description="ไม่มี lot ใกล้หมดอายุ" />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={expiring}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "productSku", width: 160 },
              { title: "ไซซ์", dataIndex: "size", width: 80 },
              { title: "lot", dataIndex: "lotNo", width: 140 },
              {
                title: "วันหมดอายุ",
                dataIndex: "expiryDate",
                width: 140,
                render: (v: string) =>
                  v && v < today ? <Tag color="red">{v} (หมดแล้ว)</Tag> : <Tag color="orange">{v}</Tag>,
              },
              { title: "คงเหลือ", dataIndex: "qty", width: 100 },
            ]}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          lot ที่หมดอายุแล้วจะถูกข้ามอัตโนมัติตอนขาย (FEFO) — แต่ยังนับอยู่ในสต็อกรวมจนกว่าจะตัดออก
        </Typography.Paragraph>
      </Card>

      <Card title="ยอด lot ไม่ตรงกับสต็อกรวม" loading={loading}>
        {mismatches.length === 0 ? (
          <Empty description="ตรงกันทุกแถว" />
        ) : (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="สินค้าที่ยังไม่ได้บันทึก lot จะขึ้นที่นี่"
              description="ถ้ายังไม่เคย backfill lot ให้ของเดิม รายการนี้จะยาวเป็นปกติ · หลัง backfill ครบแล้วรายการนี้ควรว่าง ถ้ายังมีแปลว่ามีที่ไหนเขียนสต็อกโดยไม่ผ่าน lot"
            />
            <Table
              size="small"
              rowKey={(r: any) => `${r.productSku}__${r.size}`}
              dataSource={mismatches}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: "SKU", dataIndex: "productSku", width: 160 },
                { title: "ไซซ์", dataIndex: "size", width: 80 },
                { title: "สต็อกรวม", dataIndex: "currentStock", width: 120 },
                { title: "รวมจาก lot", dataIndex: "lotTotal", width: 120 },
                {
                  title: "ต่าง",
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
