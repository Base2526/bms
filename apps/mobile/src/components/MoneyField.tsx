import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  label: string;
  value: number;
  onChange: (value: number) => void;
  editable?: boolean;
}

/**
 * ช่องกรอกจำนวนเงิน
 *
 * ⚠️ ห้ามผูก `value` ของ TextInput กับตัวเลขตรง ๆ แล้วแปลงกลับทุกคีย์ที่พิมพ์
 * ของเดิมเขียน `value={String(number)}` + `onChangeText={t => onChange(Number(t) || 0)}`
 * ผลคือพิมพ์ "10." แล้ว `Number("10.")` = 10 → ช่องถูกเขียนทับกลับเป็น "10" ทันที
 * **จุดทศนิยมจึงพิมพ์ไม่ติด และกรอกยอดที่มีสตางค์ (10.50) ไม่ได้เลย** ส่วน "0" ก็หายเพราะ
 * `value ? ... : ''` — ทำให้กรอก "0.5" ไม่ได้ด้วย
 *
 * จึงเก็บ "ข้อความที่คนกำลังพิมพ์" ไว้ในตัวเอง แล้วรายงานออกไปเป็นตัวเลขเท่านั้น
 * และ sync กลับจาก prop เฉพาะตอนที่ค่าข้างนอกไม่ตรงกับสิ่งที่พิมพ์ไว้จริง ๆ
 */
export function MoneyField({ label, value, onChange, editable = true }: Props) {
  const { colors, typography } = useTheme();
  const [text, setText] = useState(() => (value ? String(value) : ''));

  useEffect(() => {
    // ระหว่างพิมพ์ ข้อความอาจยังไม่เป็นตัวเลขที่สมบูรณ์ ("10.", ".", "") — ถือว่าเป็นของคนพิมพ์
    // ตราบใดที่มันยัง "แปลงแล้วได้ค่าเดียวกับข้างนอก" จึงห้ามเขียนทับ
    const typed = text === '' || text === '.' ? 0 : Number(text);
    if (Number.isFinite(typed) && typed === value) return;
    setText(value ? String(value) : '');
  }, [text, value]);

  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      editable={editable}
      onChangeText={next => {
        // รับเฉพาะตัวเลขกับจุดเดียว — คีย์บอร์ด decimal-pad ของบางเครื่อง (และ hardware keyboard
        // ของ simulator) พิมพ์อย่างอื่นเข้ามาได้
        const cleaned = next.replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        const normalized =
          parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
        setText(normalized);
        const parsed = Number(normalized);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      placeholder={label}
      placeholderTextColor={colors.textSoft}
      keyboardType="decimal-pad"
      style={[
        styles.input,
        typography.body,
        { borderColor: colors.border, color: colors.text },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
});
