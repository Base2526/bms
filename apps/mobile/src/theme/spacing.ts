// สเกลระยะห่าง — คูณ 4 ทั้งหมด ให้จับคู่กับ padding/margin ได้ง่ายบนจอสัมผัส
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type SpacingKey = keyof typeof spacing;

// เป้าแตะขั้นต่ำสำหรับปุ่มบนจอ POS (มือถือ/แท็บเล็ตหน้าร้าน ไม่ใช่ปุ่มบนเว็บ)
export const minTouchTarget = 44;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;
