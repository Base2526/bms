"use client";

import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Space, Spin, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { useVisibleQueryRefresh } from "@/lib/useVisibleQueryRefresh";

const QUERY = gql`
  query CustomerPurchaseDetail($customerId: ID!, $orderId: ID!) {
    bmsCustomerOrderDetail(customerId: $customerId, orderId: $orderId) {
      id lines { kind label sku size qty } points { kind points }
    }
  }
`;
type Line = { kind: string; label: string; sku: string | null; size: string | null; qty: number };
type Detail = { id: string; lines: Line[]; points: { kind: string; points: number }[] };

export default function CustomerOrderDetail({ customerId, orderId }: { customerId: string; orderId: string }) {
  const { t } = useI18n();
  const result = useQuery<{ bmsCustomerOrderDetail: Detail | null }>(QUERY, {
    variables: { customerId, orderId }, fetchPolicy: "cache-and-network",
  });
  useVisibleQueryRefresh(result);
  const detail = result.data?.bmsCustomerOrderDetail;
  if (result.error) return <Alert closable type="error" message={t("admin_customers.detail_failed")}
    action={<Button icon={<ReloadOutlined />} onClick={() => { void result.refetch().catch(() => {}); }}>{t("admin_customers.detail_retry")}</Button>} />;
  if (!detail) return result.loading ? <Spin /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_customers.detail_missing")} />;
  return <section aria-label={t("admin_customers.purchase_detail")} style={{ minWidth: 0, maxWidth: "min(720px, calc(100vw - 96px))" }}>
    <Table size="small" tableLayout="fixed" pagination={false} dataSource={detail.lines.map((line, index) => ({ ...line, key: index }))}
      locale={{ emptyText: t("admin_customers.detail_no_lines") }}
      columns={[
        { title: t("admin_customers.detail_type"), dataIndex: "kind", width: 80, render: (kind: string) => t(kind === "PRODUCT" ? "admin_customers.detail_product" : "admin_customers.detail_service") },
        { title: t("admin_customers.purchase_detail"), key: "label", render: (_: unknown, line: Line) => <>
          <div style={{ overflowWrap: "anywhere" }}>{line.label}</div>
          {line.sku ? <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{line.sku}{line.size ? ` · ${line.size}` : ""}</Typography.Text> : null}
        </> },
        { title: t("admin_customers.detail_qty"), dataIndex: "qty", width: 60, align: "right" as const },
      ]} />
    <Space wrap style={{ marginTop: 8 }}>
      <Typography.Text type="secondary">{t("admin_customers.detail_points")}</Typography.Text>
      {detail.points.length ? detail.points.map((entry, index) => <Tag key={index} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
        {t(`admin_customers.detail_points_${entry.kind.toLowerCase()}`)}: {entry.points > 0 ? "+" : ""}{entry.points.toLocaleString()}
      </Tag>) : <Typography.Text type="secondary">{t("admin_customers.detail_no_points")}</Typography.Text>}
    </Space>
  </section>;
}
