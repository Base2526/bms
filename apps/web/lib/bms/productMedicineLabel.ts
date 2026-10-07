/** Shop-transcribed label facts only. These fields never establish suitability or equivalence. */
export type MedicineLabel = { activeIngredients: string[]; strength: string | null; dosageForm: string | null };
export function normalizeMedicineLabel(input: unknown): MedicineLabel | null {
  if (input === undefined) return null; // Omitted fields preserve existing label facts on other write paths.
  if (input === null) return { activeIngredients: [], strength: null, dosageForm: null };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("ข้อมูลฉลากยาต้องเป็น object");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["activeIngredients", "strength", "dosageForm"].includes(key))) {
    throw new Error("ข้อมูลฉลากยามี field ที่ไม่รองรับ");
  }
  const text = (v: unknown, max: number): string | null => {
    if (v == null || v === "") return null;
    if (typeof v !== "string" || v.trim().length > max) throw new Error("ข้อความฉลากยาไม่ถูกต้องหรือยาวเกินกำหนด");
    return v.trim() || null;
  };
  if (value.activeIngredients != null && (!Array.isArray(value.activeIngredients) || value.activeIngredients.length > 20)) {
    throw new Error("ส่วนประกอบสำคัญต้องเป็นรายการไม่เกิน 20 ค่า");
  }
  return {
    activeIngredients: [...new Set(((value.activeIngredients ?? []) as unknown[]).map((v) => text(v, 120)).filter((v): v is string => Boolean(v)))],
    strength: text(value.strength, 120), dosageForm: text(value.dosageForm, 120),
  };
}
