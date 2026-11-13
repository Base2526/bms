"use client";

import { useUiText } from "@/lib/useUiText";
// หน่วยขาย + บาร์โค้ดต่อไซซ์
// -------------------------------------------------------------
// หลังจาก 7.93 บาร์โค้ดผูกกับ "หน่วยขาย" ไม่ใช่ "สินค้า" — แผง 10 เม็ดกับ
// กล่อง 100 เม็ดคนละเลข คนละราคา ตามที่ร้านค้าปลีกทำกันจริง
//
// หน้านี้คือที่ที่ตั้งค่านั้น และที่สำคัญกว่าคือ "รายการที่ยังตั้งไม่ครบ" —
// ไซซ์ที่ไม่มีบาร์โค้ดของตัวเองจะยิงไม่เจอ ต้องค้นชื่อแล้วกดเลือกไซซ์เอง
// ซึ่งช้าและพลาดง่ายตอนมีคิวหน้าร้าน
import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select,
  Space, Switch, Table, Tag, Typography, message,
} from "antd";
import { ReadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q_AUDIT = gql`
  query PacksNeedingBarcodes {
    bmsProductsNeedingBarcodes(limit: 200) { sku name sizes packs sizesWithoutBarcode }
  }
`;
const Q_PACKS = gql`
  query ProductPacks($productSku: String!) {
    bmsProductPacks(productSku: $productSku) {
      sizes
      packs { id productSku size packCode unitName unitCode baseQty barcode price isBase active }
    }
    bmsMasterUnits { code nameTh nameEn kind active }
  }
`;
const M_UPSERT = gql`
  mutation($input: BmsProductPackInput!) { bmsUpsertProductPack(input: $input) { id } }
`;
const M_DELETE = gql`
  mutation($id: ID!) { bmsDeleteProductPack(id: $id) }
`;

type Pack = {
  id: string; productSku: string; size: string | null; packCode: string;
  unitName: string; unitCode: string | null; baseQty: number; barcode: string | null;
  price: number | null; isBase: boolean; active: boolean;
};

export default function ProductPacksPage() {
  const uiText = useUiText();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canView = can("product.view");
  const canEdit = can("product.edit");

  const [sku, setSku] = useState("");
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Pack | null>(null);
  const [open, setOpen] = useState(false);

  const audit = useQuery(Q_AUDIT, { fetchPolicy: "cache-and-network", skip: !canView });
  const [loadPacks, packsQuery] = useLazyQuery(Q_PACKS, { fetchPolicy: "network-only" });
  const [upsert, { loading: saving }] = useMutation(M_UPSERT);
  const [remove] = useMutation(M_DELETE);

  if (!permsLoading && !canView) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_this_17b55")} />;
  }

  const packs: Pack[] = packsQuery.data?.bmsProductPacks?.packs ?? [];
  const sizes: string[] = packsQuery.data?.bmsProductPacks?.sizes ?? [];
  const masterUnits: Array<{ code: string; nameTh: string; nameEn: string; kind: string; active: boolean }> = packsQuery.data?.bmsMasterUnits ?? [];
  const auditRows = audit.data?.bmsProductsNeedingBarcodes ?? [];
  const loadedSku = packsQuery.variables?.productSku as string | undefined;

  function openFor(sizeValue: string | null, pack?: Pack) {
    if (!loadedSku) return;
    setEditing(pack ?? null);
    form.setFieldsValue(
      pack ?? {
        size: sizeValue,
        packCode: "BASE",
        unitName: "ชิ้น",
        unitCode: null,
        baseQty: 1,
        barcode: "",
        price: null,
        isBase: true,
        active: true,
      }
    );
    setOpen(true);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      await upsert({
        variables: {
          input: {
            ...values,
            id: editing?.id ?? null,
            productSku: loadedSku,
            barcode: values.barcode?.trim() || null,
            price: values.price ?? null,
          },
        },
      });
      message.success(uiText("admin_ui.sales_unit_saved_18ce6"));
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await packsQuery.refetch?.();
      await audit.refetch();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.units_and_barcodes_6a81a")}>
        <Link href="/admin/pos-manual"><Button icon={<ReadOutlined />}>{uiText("admin_ui.cashier_manual_3e8eb")}</Button></Link>
      </AdminPageHeader>

      <Alert closable
        type="info"
        showIcon
        message={uiText("admin_ui.one_barcode_one_sales_unit_efad6")}
        description={uiText("admin_ui.a_strip_of_10_tablets_and_a_box_96aaa")}
      />

      <Card title={uiText("admin_ui.open_a_product_to_configure_sales_units_60953")}>
        <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
          <Input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onPressEnter={() => sku.trim() && loadPacks({ variables: { productSku: sku.trim() } })}
            placeholder={uiText("admin_ui.enter_a_sku_and_press_enter_28069")}
          />
          <Button
            type="primary"
            onClick={() => sku.trim() && loadPacks({ variables: { productSku: sku.trim() } })}
          >
            {uiText("admin_ui.open_22aad")}</Button>
        </Space.Compact>

        {loadedSku && (
          <div style={{ marginTop: 16 }}>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <b>{loadedSku}</b>  {uiText("admin_ui.sizes_with_stock_c4536")} {sizes.length === 0 ? "—" : sizes.join(" / ")}
            </Typography.Paragraph>

            {sizes.map((sz) => {
              const rows = packs.filter((p) => p.size === sz);
              const noBarcode = rows.every((r) => !r.barcode);
              return (
                <Card
                  key={sz}
                  size="small"
                  style={{ marginBottom: 10 }}
                  title={
                    <Space>
                      <span>{uiText("admin_ui.size_ff4b6")} {sz}</span>
                      {noBarcode && <Tag color="red">{uiText("admin_ui.no_barcode_yet_be4ed")}</Tag>}
                    </Space>
                  }
                  extra={canEdit && <Button size="small" onClick={() => openFor(sz)}>{uiText("admin_ui.add_sales_unit_d5956")}</Button>}
                >
                  {rows.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("admin_ui.no_sales_units_for_this_size_c6f6d")} />
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={rows}
                      pagination={false}
                      columns={[
                        {
                          title: uiText("admin_ui.unit_92540"),
                          render: (_: unknown, p: Pack) => (
                            <Space>
                              <b>{p.unitName}</b>
                              <Tag>{p.packCode}</Tag>
                              {p.unitCode ? <Tag color="green">UN/ECE {p.unitCode}</Tag> : <Tag color="orange">{uiText("admin_ui.e_tax_unit_not_mapped_4ba44")}</Tag>}
                              {p.isBase && <Tag color="blue">{uiText("admin_ui.base_unit_e09e7")}</Tag>}
                              {!p.active && <Tag>{uiText("admin_ui.close_96d79")}</Tag>}
                            </Space>
                          ),
                        },
                        { title: uiText("admin_ui.base_units_86609"), dataIndex: "baseQty", width: 120 },
                        {
                          title: uiText("admin_ui.barcodes_75bc4"),
                          dataIndex: "barcode",
                          width: 190,
                          render: (v: string | null) =>
                            v ? <code>{v}</code> : <Tag color="red">{uiText("admin_ui.not_configured_00436")}</Tag>,
                        },
                        {
                          title: uiText("admin_ui.price_90f83"),
                          dataIndex: "price",
                          width: 130,
                          render: (v: number | null) =>
                            v == null ? <span style={{ color: "#999" }}>{uiText("admin_ui.use_product_price_2d224")}</span> : `฿${v.toLocaleString()}`,
                        },
                        ...(canEdit
                          ? [
                              {
                                title: "",
                                width: 140,
                                render: (_: unknown, p: Pack) => (
                                  <Space>
                                    <Button size="small" onClick={() => openFor(p.size, p)}>{uiText("admin_ui.edit_e7eca")}</Button>
                                    <Popconfirm
                                      title={uiText("admin_ui.delete_this_sales_unit_f8f58")}
                                      description={uiText("admin_ui.this_unit_s_barcode_will_no_longer_be_63c41")}
                                      okText={uiText("admin_ui.remove_f535f")}
                                      cancelText={uiText("admin_ui.cancelled_fba6e")}
                                      onConfirm={async () => {
                                        await remove({ variables: { id: p.id } });
                                        await packsQuery.refetch?.();
                                        await audit.refetch();
                                      }}
                                    >
                                      <Button size="small" danger>{uiText("admin_ui.remove_f535f")}</Button>
                                    </Popconfirm>
                                  </Space>
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <Card title={uiText("admin_ui.multi_size_products_with_missing_barcodes_855f3")} loading={audit.loading}>
        {auditRows.length === 0 ? (
          <Empty description={uiText("admin_ui.all_sizes_have_barcodes_7f5f7")} />
        ) : (
          <Table
            size="small"
            rowKey="sku"
            dataSource={auditRows}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 170 },
              { title: uiText("admin_ui.product_name_c9863"), dataIndex: "name" },
              { title: uiText("admin_ui.size_ff4b6"), dataIndex: "sizes", width: 80 },
              {
                title: uiText("admin_ui.sizes_without_barcodes_0c103"),
                dataIndex: "sizesWithoutBarcode",
                render: (v: string[]) => (
                  <Space wrap>
                    {v.map((s) => <Tag color="red" key={s}>{s}</Tag>)}
                  </Space>
                ),
              },
              {
                title: "",
                width: 90,
                render: (_: unknown, r: any) => (
                  <Button
                    size="small"
                    onClick={() => { setSku(r.sku); loadPacks({ variables: { productSku: r.sku } }); }}
                  >
                    {uiText("admin_ui.open_22aad")}</Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? uiText("admin_ui.edit_sales_unit_9fdee", { v0: editing.unitName }) : uiText("admin_ui.add_sales_unit_d5956")}
        onCancel={() => { setOpen(false); setEditing(null); }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText={uiText("admin_ui.save_f658a")}
        cancelText={uiText("admin_ui.cancelled_fba6e")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="size" label={uiText("admin_ui.size_ff4b6")} rules={[{ required: true, message: uiText("admin_ui.select_a_size_0f0f2") }]}>
            <Select options={sizes.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item
            name="packCode"
            label={uiText("admin_ui.sales_unit_code_c69bb")}
            extra={uiText("admin_ui.internal_abbreviation_e_g_base_base_unit_strip_d4338")}
            rules={[{ required: true, message: uiText("admin_ui.enter_a_code_ef870") }]}
          >
            <Input placeholder="BOX" />
          </Form.Item>
          <Form.Item name="unitName" label={uiText("admin_ui.unit_name_printed_on_receipts_2c04e")} rules={[{ required: true, message: uiText("admin_ui.enter_a_unit_name_ff08a") }]}>
            <Input placeholder={uiText("admin_ui.box_817e4")} />
          </Form.Item>
          <Form.Item
            name="unitCode"
            label={uiText("admin_ui.un_ece_standard_unit_code_12707")}
            extra={uiText("admin_ui.used_in_e_tax_xml_leave_blank_to_c11f8")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={masterUnits.filter((unit) => unit.active || unit.code === editing?.unitCode).map((unit) => ({
                value: unit.code,
                label: `${unit.code} · ${unit.nameTh} / ${unit.nameEn}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="baseQty"
            label={uiText("admin_ui.base_units_in_one_of_these_units_7f06c")}
            extra={uiText("admin_ui.a_box_containing_10_strips_enter_10_selling_a3dc0")}
            rules={[{ required: true, message: uiText("admin_ui.enter_a_quantity_10971") }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="barcode"
            label={uiText("admin_ui.barcodes_75bc4")}
            extra={uiText("admin_ui.must_be_unique_among_this_store_s_sales_4fe10")}
          >
            <Input placeholder="8850000000123" />
          </Form.Item>
          <Form.Item
            name="price"
            label={uiText("admin_ui.price_per_unit_52501")}
            extra={uiText("admin_ui.blank_product_price_base_unit_quantity_no_bulk_c880c")}
          >
            <InputNumber min={0} style={{ width: "100%" }} placeholder="230" />
          </Form.Item>
          <Form.Item
            name="isBase"
            label={uiText("admin_ui.base_unit_for_this_size_0ae56")}
            valuePropName="checked"
            extra={uiText("admin_ui.the_unit_used_to_count_stock_only_one_fcba9")}
          >
            <Switch />
          </Form.Item>
          <Form.Item name="active" label={uiText("admin_ui.active_79476")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
