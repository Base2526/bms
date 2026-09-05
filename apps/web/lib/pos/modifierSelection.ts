/**
 * กลุ่มตัวเลือกที่ยังเลือกไม่ครบขั้นต่ำ — ใช้กันไม่ให้จอส่งสิ่งที่ server ปฏิเสธแน่ ๆ
 *
 * เคสจริงจาก production (2026-09-05): ส้มตำมีกลุ่ม "เผ็ดกี่เม็ด" ที่ `min_select = 1` แต่ไม่มี
 * ตัวเลือกไหนตั้ง `default_selected` · จอโชว์กติกาไว้แต่ปุ่ม "เพิ่มในบิล" ยังกดได้ →
 * `addRestaurantCheckItem()` ปฏิเสธ แล้วคำตอบไปโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" (เพราะ
 * ตอนนั้นการปฏิเสธตามกฎยังตกไปเป็น 500 ที่ข้อความถูกลบทิ้งบน production) พนักงานจึงกดซ้ำ
 * 4 ครั้งใน 10 นาทีโดยไม่มีทางรู้ว่าต้องแตะชิปก่อน
 *
 * แยกเป็นโมดูล pure เพราะเป็น "กฎ" ไม่ใช่การเรนเดอร์ — เทสได้โดยไม่ต้องมี DOM/DB
 * (แนวเดียวกับ `loyaltyMath.ts` / `kitchenBoard.ts`) · เพดานสูงสุดไม่ต้องตรวจที่นี่:
 * ชิปที่เกินโควตาถูก disable ไปแล้วตั้งแต่ตอนเรนเดอร์
 */
export type ModifierGroupRule = {
  code: string;
  groupCode: string;
  groupName: string;
  minSelect: number;
};

export function unmetModifierGroups<T extends ModifierGroupRule>(
  modifiers: readonly T[],
  selected: readonly string[]
): string[] {
  const chosen = new Set(selected);
  const groups = new Map<string, { name: string; min: number; picked: number }>();
  for (const modifier of modifiers) {
    const current = groups.get(modifier.groupCode)
      ?? { name: modifier.groupName, min: Math.max(0, Math.trunc(modifier.minSelect || 0)), picked: 0 };
    if (chosen.has(modifier.code)) current.picked += 1;
    groups.set(modifier.groupCode, current);
  }
  const unmet: string[] = [];
  for (const group of groups.values()) {
    if (group.picked < group.min) unmet.push(group.name);
  }
  return unmet;
}

/** ข้อความบอกว่าต้องแตะอะไรก่อน — ชื่อกลุ่มเสมอ ไม่ใช่ "กรอกข้อมูลให้ครบ" ที่ไม่ชี้ว่าตรงไหน */
export function describeUnmetModifierGroups(names: readonly string[]): string {
  if (!names.length) return "";
  return `ยังต้องเลือก: ${names.join(" · ")}`;
}
