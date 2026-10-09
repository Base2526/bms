"use client";

import { gql, useQuery } from "@apollo/client";
import { Fragment } from "react";
import { Alert, Button, Empty, Space, Spin, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { useVisibleQueryRefresh } from "@/lib/useVisibleQueryRefresh";
import { customerOrderDetailErrorKey } from "./customerOrderDetailError";

const QUERY = gql`
  query CustomerPurchaseDetail($customerId: ID!, $orderId: ID!) {
    bmsCustomerOrderDetail(customerId: $customerId, orderId: $orderId) {
      id orderAmount discountAmount shippingAmount vatAmount roundingAmount totalAmount
      lines { kind label sku size qty saleQty unitName unitAmount lineAmount } points { kind points }
    }
  }
`;
type Line = { kind: string; label: string; sku: string | null; size: string | null; qty: number;
  saleQty: number; unitName: string | null; unitAmount: number; lineAmount: number };
type Detail = { id: string; lines: Line[]; points: { kind: string; points: number }[];
  orderAmount: number; discountAmount: number; shippingAmount: number; vatAmount: number; roundingAmount: number; totalAmount: number };

const money = (amount: number) => `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;

export default function CustomerOrderDetail({ customerId, orderId }: { customerId: string; orderId: string }) {
  const { t } = useI18n();
  const result = useQuery<{ bmsCustomerOrderDetail: Detail | null }>(QUERY, {
    variables: { customerId, orderId }, fetchPolicy: "cache-and-network", notifyOnNetworkStatusChange: true,
  });
  useVisibleQueryRefresh(result);
  const detail = result.data?.bmsCustomerOrderDetail;
  if (result.error) return <Alert type="error" showIcon closable message={t(customerOrderDetailErrorKey(result.error))}
    action={<Button loading={result.loading} icon={<ReloadOutlined />} onClick={() => { void result.refetch().catch(() => {}); }}>{t("admin_customers.detail_retry")}</Button>} />;
  if (!detail) return result.loading ? <Spin /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_customers.detail_missing")} />;
  return <section aria-label={t("admin_customers.purchase_detail")} style={{ minWidth: 0, maxWidth: "min(720px, calc(100vw - 96px))" }}>
    <Typography.Paragraph style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
      <Typography.Text strong>{t("admin_customers.detail_bill")}: </Typography.Text>
      <Typography.Text copyable={{ text: detail.id }}>{detail.id}</Typography.Text>
    </Typography.Paragraph>
    <Table size="small" tableLayout="fixed" scroll={{ x: 580 }} pagination={false} dataSource={detail.lines.map((line, index) => ({ ...line, key: index }))}
      locale={{ emptyText: t("admin_customers.detail_no_lines") }}
      columns={[
        { title: t("admin_customers.detail_type"), dataIndex: "kind", width: 80, render: (kind: string) => t(kind === "PRODUCT" ? "admin_customers.detail_product" : "admin_customers.detail_service") },
        { title: t("admin_customers.purchase_detail"), key: "label", render: (_: unknown, line: Line) => <>
          <div style={{ overflowWrap: "anywhere" }}>{line.label}</div>
          {line.sku ? <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{line.sku}{line.size ? ` · ${line.size}` : ""}</Typography.Text> : null}
        </> },
        { title: t("admin_customers.detail_qty"), key: "qty", width: 90, align: "right" as const,
          render: (_: unknown, line: Line) => <span style={{ overflowWrap: "anywhere" }}>{line.saleQty}{line.unitName ? ` ${line.unitName}` : ""}</span> },
        { title: t("admin_customers.detail_unit_amount"), dataIndex: "unitAmount", width: 100, align: "right" as const, render: money },
        { title: t("admin_customers.detail_line_amount"), dataIndex: "lineAmount", width: 110, align: "right" as const, render: money },
      ]} />
    <dl style={{ margin: "12px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "6px 16px", overflowWrap: "anywhere" }}>
      {[
        ["detail_discount", detail.discountAmount],
        ["detail_vat", detail.vatAmount],
        ["detail_rounding", detail.roundingAmount],
        ["detail_order_amount", detail.orderAmount],
        ["detail_shipping", detail.shippingAmount],
        ["detail_total", detail.totalAmount],
      ].map(([key, amount]) => <Fragment key={String(key)}>
        <dt><Typography.Text strong={key === "detail_total"}>{t(`admin_customers.${key}`)}</Typography.Text></dt>
        <dd style={{ margin: 0, textAlign: "right" }}><Typography.Text strong={key === "detail_total"}>{money(Number(amount))}</Typography.Text></dd>
      </Fragment>)}
    </dl>
    <Space wrap style={{ marginTop: 8 }}>
      <Typography.Text type="secondary">{t("admin_customers.detail_points")}</Typography.Text>
      {detail.points.length ? detail.points.map((entry, index) => <Tag key={index} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
        {t(`admin_customers.detail_points_${entry.kind.toLowerCase()}`)}: {entry.points > 0 ? "+" : ""}{entry.points.toLocaleString()}
      </Tag>) : <Typography.Text type="secondary">{t("admin_customers.detail_no_points")}</Typography.Text>}
    </Space>
  </section>;
}
