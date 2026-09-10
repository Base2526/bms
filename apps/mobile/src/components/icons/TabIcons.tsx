import React from 'react';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

// ไอคอนของแท็บล่าง — วาดเองด้วยรูปทรงพื้นฐาน (Rect/Circle/Line) ไม่ใช้ icon font
// (react-native-vector-icons ต้องลิงก์ฟอนต์เพิ่มทั้ง iOS/Android ซึ่งเป็นจุดพังบ่อยของ RN —
// react-native-svg วาดเองแล้วไม่มีปัญหานั้นเลย และไฟล์เล็กกว่ามาก)
// สไตล์เดียวกันทั้งชุด: เส้น 2pt, ปลายมน, พื้นโปร่ง — สีมาจากธีมเสมอ (ห้าม hardcode สี)

export interface TabIconProps {
  color: string;
  size?: number;
}

const STROKE_WIDTH = 2;

export function SellIcon({ color, size = 24 }: TabIconProps) {
  // เครื่องเก็บเงิน/POS terminal — ใช้แทนแท็บ "ขาย"
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={9}
        y={3}
        width={6}
        height={4}
        rx={1}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Rect
        x={3}
        y={7}
        width={18}
        height={13}
        rx={2}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Line
        x1={3}
        y1={12}
        x2={21}
        y2={12}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
    </Svg>
  );
}

export function FloorIcon({ color, size = 24 }: TabIconProps) {
  // ผังโต๊ะ = กริดสี่ช่อง แทนโต๊ะ/โซนบนพื้นร้าน
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={3}
        width={8}
        height={8}
        rx={1.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Rect
        x={13}
        y={3}
        width={8}
        height={8}
        rx={1.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Rect
        x={3}
        y={13}
        width={8}
        height={8}
        rx={1.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Rect
        x={13}
        y={13}
        width={8}
        height={8}
        rx={1.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
    </Svg>
  );
}

export function KitchenIcon({ color, size = 24 }: TabIconProps) {
  // หมวกเชฟแบบย่อ (วงกลม = ส่วนพอง + แถบล่าง) แทนจอครัว
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={9} r={6} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Rect
        x={6}
        y={13}
        width={12}
        height={7}
        rx={1.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
    </Svg>
  );
}

export function ShiftIcon({ color, size = 24 }: TabIconProps) {
  // นาฬิกา — กะคือช่วงเวลาทำงาน
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Line
        x1={12}
        y1={7}
        x2={12}
        y2={12.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={12.5}
        x2={15.5}
        y2={14.5}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
    </Svg>
  );
}
