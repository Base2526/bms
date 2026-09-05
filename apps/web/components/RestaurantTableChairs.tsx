"use client";

import type { CSSProperties } from "react";
import styles from "./RestaurantTableChairs.module.css";

type TableShape = "round" | "rect";

type ChairPosition = {
  left: number;
  top: number;
  rotate: number;
};

const TABLE_SIZE: Record<TableShape, { width: number; height: number }> = {
  round: { width: 96, height: 96 },
  rect: { width: 128, height: 76 },
};
const CHAIR_WIDTH = 18;
const CHAIR_HEIGHT = 10;
// จำนวนที่นั่งยังแสดงเป็นตัวเลขเต็มบนโต๊ะเสมอ แต่เก้าอี้มากเกินนี้จะอ่านเป็นก้อนเดียว
// บนพื้นที่ขนาด 96–128px จึงจำกัดเฉพาะภาพประกอบ ไม่ได้เปลี่ยนความจุจริงของโต๊ะ
const MAX_VISIBLE_CHAIRS = 12;

function roundChair(index: number, total: number): ChairPosition {
  const { width, height } = TABLE_SIZE.round;
  const angle = -90 + (360 * index) / total;
  const radians = (angle * Math.PI) / 180;
  const radius = width / 2 + 8;
  return {
    left: width / 2 + Math.cos(radians) * radius - CHAIR_WIDTH / 2,
    top: height / 2 + Math.sin(radians) * radius - CHAIR_HEIGHT / 2,
    rotate: angle + 90,
  };
}

function rectChairs(total: number): ChairPosition[] {
  const { width, height } = TABLE_SIZE.rect;
  const topCount = Math.ceil(total / 2);
  const bottomCount = total - topCount;
  const row = (count: number, top: number, rotate: number) => Array.from({ length: count }, (_, index) => ({
    left: ((index + 1) * width) / (count + 1) - CHAIR_WIDTH / 2,
    top,
    rotate,
  }));
  return [
    ...row(topCount, -CHAIR_HEIGHT - 3, 0),
    ...row(bottomCount, height + 3, 180),
  ];
}

export default function RestaurantTableChairs({ seats, shape }: { seats: number; shape: TableShape }) {
  const visibleCount = Math.min(MAX_VISIBLE_CHAIRS, Math.max(0, Math.floor(seats)));
  const positions = shape === "rect"
    ? rectChairs(visibleCount)
    : Array.from({ length: visibleCount }, (_, index) => roundChair(index, visibleCount));

  return <span className={styles.chairs} aria-hidden="true">
    {positions.map((position, index) => <span
      className={styles.chair}
      key={index}
      style={{
        left: position.left,
        top: position.top,
        transform: `rotate(${position.rotate}deg)`,
      } as CSSProperties}
    />)}
  </span>;
}
