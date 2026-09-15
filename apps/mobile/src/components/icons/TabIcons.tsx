import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

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

export function OrdersIcon({ color, size = 24 }: TabIconProps) {
  // กระดิ่ง — แท็บ "ออร์เดอร์เข้า" คือที่ที่ของจากข้างนอกมารอให้คนกดรับ
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={6}
        y={4}
        width={12}
        height={11}
        rx={6}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Line
        x1={4}
        y1={16}
        x2={20}
        y2={16}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
      <Circle
        cx={12}
        cy={19}
        r={1.6}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
    </Svg>
  );
}

export function MoreIcon({ color, size = 24 }: TabIconProps) {
  // สามจุด — แท็บ "เพิ่มเติม" ไม่ได้เป็นงานชนิดใดชนิดหนึ่ง มันคือที่เก็บงานที่ไม่ได้ทำทุกวัน
  // (กะ · สต็อกสาขา · เคาน์เตอร์ · สถานะระบบ) ไอคอนจึงต้องไม่สื่อว่าเป็นงานอะไรเป็นพิเศษ
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5.5} cy={12} r={1.7} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Circle cx={12} cy={12} r={1.7} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Circle cx={18.5} cy={12} r={1.7} stroke={color} strokeWidth={STROKE_WIDTH} />
    </Svg>
  );
}

export function InventoryIcon({ color, size = 24 }: TabIconProps) {
  // กล่อง — สต็อกสาขา (โอนของ/นับของ)
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.2 12 4.4l8 3.8v7.6L12 19.6 4 15.8Z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Line x1={4} y1={8.2} x2={12} y2={12} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Line x1={20} y1={8.2} x2={12} y2={12} stroke={color} strokeWidth={STROKE_WIDTH} />
      <Line x1={12} y1={12} x2={12} y2={19.6} stroke={color} strokeWidth={STROKE_WIDTH} />
    </Svg>
  );
}

export function CounterIcon({ color, size = 24 }: TabIconProps) {
  // สลิป — งานเคาน์เตอร์ที่ทิ้งหลักฐานเป็นใบ (No sale · คืนของ · เงินทดรอง · ลูกหนี้)
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3.6h12v16.8l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6-2.4-1.6Z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Line x1={9} y1={8.4} x2={15} y2={8.4} stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <Line x1={9} y1={12.2} x2={15} y2={12.2} stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </Svg>
  );
}

export function SupportIcon({ color, size = 24 }: TabIconProps) {
  // คลื่นชีพจร — สถานะเครื่องและการเชื่อมต่อ
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12h3.6l2.1-5.4 3.3 11.4 2.4-6h6.6"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
