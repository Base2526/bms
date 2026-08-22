'use client';
import { Card, Empty, Pagination, Skeleton, Typography } from "antd";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18nContext";

export type AdminCardField = {
  label: string;
  value: ReactNode;
  /** ซ่อนแถวนี้ (ใช้แทนการเขียน conditional ใน array) */
  hidden?: boolean;
};

/**
 * การ์ด 1 รายการสำหรับมุมมองมือถือ — ใช้แทน 1 แถวของ `Table`
 * บนจอ ~360px พื้นที่เนื้อหาเหลือแค่ ~340px ตารางที่มี 7–9 คอลัมน์จึงอ่านไม่ได้จริง
 */
export function AdminRecordCard({
  title,
  extra,
  fields,
  actions,
  footer,
  onClick,
}: {
  title: ReactNode;
  /** มุมขวาบน — ปกติคือ Tag สถานะ */
  extra?: ReactNode;
  fields?: AdminCardField[];
  /** แถวปุ่มด้านล่าง (คลิกไม่ทะลุไป onClick ของการ์ด) */
  actions?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
}) {
  const rows = (fields || []).filter((f) => !f.hidden);

  return (
    <Card
      size="small"
      hoverable={!!onClick}
      onClick={onClick}
      styles={{ body: { padding: 12 } }}
      style={{ marginBottom: 10 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>{title}</div>
        {extra != null && <div style={{ flexShrink: 0, textAlign: "right" }}>{extra}</div>}
      </div>

      {rows.length > 0 && (
        <div
          style={{
            marginTop: 8,
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            columnGap: 10,
            rowGap: 4,
            alignItems: "baseline",
          }}
        >
          {rows.map((f, i) => (
            <Fragment key={`${f.label}-${i}`}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {f.label}
              </Typography.Text>
              <div style={{ fontSize: 12.5, minWidth: 0, textAlign: "right", overflowWrap: "anywhere" }}>
                {f.value}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {footer}

      {actions && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid var(--app-border, #f0f0f0)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 4,
          }}
        >
          {actions}
        </div>
      )}
    </Card>
  );
}

/**
 * รายการการ์ดพร้อม pagination ฝั่ง client — ใช้กับ data ที่หน้านั้นโหลดมาแล้ว
 * (หน้าที่ใช้อยู่ query ทีละ 100–200 แถวและแบ่งหน้าใน `Table` อยู่แล้ว)
 */
export function AdminMobileList<T>({
  loading,
  dataSource,
  rowKey,
  renderItem,
  pageSize = 10,
  emptyText,
  totalText,
}: {
  loading?: boolean;
  dataSource: T[];
  rowKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  pageSize?: number;
  emptyText?: ReactNode;
  /** ข้อความสรุปท้ายรายการ (ไม่ส่ง = "ทั้งหมด N รายการ" / "N item(s) total") */
  totalText?: (total: number) => ReactNode;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const total = dataSource.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  // ข้อมูลหด (เปลี่ยน filter/ค้นหา) แล้วหน้าปัจจุบันเลยขอบ → ถอยมาหน้าสุดท้ายที่มีจริง
  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [page, maxPage]);

  if (loading && total === 0) {
    return (
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }
  if (total === 0) {
    return <Empty description={emptyText ?? t("admin.no_data")} style={{ padding: "32px 0" }} />;
  }

  const slice = dataSource.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      {slice.map((item, i) => (
        <Fragment key={rowKey(item, (page - 1) * pageSize + i)}>
          {renderItem(item, (page - 1) * pageSize + i)}
        </Fragment>
      ))}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {totalText ? totalText(total) : t("admin.total_items", { total })}
        </Typography.Text>
        {total > pageSize && (
          <Pagination
            simple
            size="small"
            current={Math.min(page, maxPage)}
            pageSize={pageSize}
            total={total}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
