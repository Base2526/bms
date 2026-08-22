'use client';
import { Segmented, Select } from "antd";
import type { ReactNode } from "react";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

/**
 * หัวหน้า admin แบบ responsive — desktop: ชื่อหน้าซ้าย / เครื่องมือขวา,
 * มือถือ: ชื่อหน้าบน แล้วแถบเครื่องมือเต็มความกว้างด้านล่าง (ไม่ล้นจอ)
 *
 * เดิมทุกหน้าใช้ `<Space style={{width:"100%",justifyContent:"space-between"}} wrap>` ซึ่ง
 * `Space` เป็น inline-flex + ห่อลูกทุกตัวด้วย `.ant-space-item` ทำให้คุมความกว้างลูกไม่ได้
 * บนจอแคบ (control ที่ตั้ง width คงที่จะดันกันจนล้น)
 */
export default function AdminPageHeader({
  title,
  children,
}: {
  title: ReactNode;
  /** control ต่าง ๆ (search / filter / ปุ่ม) — เรียงต่อกันและ wrap เองได้ */
  children?: ReactNode;
}) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        marginBottom: 16,
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "space-between",
        gap: isMobile ? 10 : 16,
      }}
    >
      {typeof title === "string" ? (
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : undefined }}>{title}</h2>
      ) : (
        title
      )}
      {children ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: isMobile ? "flex-start" : "flex-end",
            gap: 8,
            width: isMobile ? "100%" : undefined,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ตัวกรองสถานะ — desktop เป็น `Segmented` เหมือนเดิม, มือถือเปลี่ยนเป็น `Select`
 * เพราะ Segmented 5–8 ตัวเลือกกว้างเกินจอและตัวที่เลือกอาจหลุดออกนอกพื้นที่มองเห็น
 * state/ค่าเหมือนกันทั้งสองโหมด — เปลี่ยนแค่วิธีแสดง
 */
export function ResponsiveStatusFilter<T extends string>({
  options,
  value,
  onChange,
  labels,
  minWidth = 130,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /**
   * ป้ายอ่านง่ายต่อค่า — ใช้กับ `Select` บนมือถือเท่านั้น
   * desktop คง `Segmented` ค่าดิบไว้เหมือนเดิม (ป้ายไทยยาวกว่า จะทำให้ Segmented ล้นบนจอ desktop ด้วย)
   */
  labels?: Partial<Record<T, string>>;
  minWidth?: number;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div style={{ flex: `1 1 ${minWidth}px`, minWidth }}>
        <Select<T>
          value={value}
          onChange={onChange}
          style={{ width: "100%" }}
          options={options.map((o) => ({ value: o, label: labels?.[o] ?? o }))}
        />
      </div>
    );
  }

  return (
    <Segmented
      options={options as unknown as string[]}
      value={value}
      onChange={(v) => onChange(v as T)}
    />
  );
}
