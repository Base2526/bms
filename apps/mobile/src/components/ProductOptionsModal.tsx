import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './Button';
import type { PosMenuItem, PosModifier } from '../types/pos';
import { useTheme } from '../theme/ThemeProvider';

export interface ConfiguredProduct {
  item: PosMenuItem;
  modifierCodes: string[];
  kitchenNote: string | null;
}

interface Props {
  item: PosMenuItem | null;
  restaurant?: boolean;
  resolveVariant: (
    code: string,
    size?: string | null,
    packCode?: string | null,
  ) => Promise<PosMenuItem>;
  onClose: () => void;
  onConfirm: (configured: ConfiguredProduct) => void;
}

export function ProductOptionsModal({
  item,
  restaurant = false,
  resolveVariant,
  onClose,
  onConfirm,
}: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const [resolved, setResolved] = useState<PosMenuItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    // การ์ด catalog มีไว้แสดงผลเร็วและยังไม่มี snapshot ราคาส่ง/โปร/ตัวเลือกครบ
    // แม้สินค้ามีไซซ์เดียวก็ต้อง resolve ก่อนเพิ่ม ไม่งั้นตอนกดยืนยันขายจะเป็นครั้งแรกที่ได้
    // snapshot เต็ม แล้วระบบเข้าใจผิดว่า "ราคาเปลี่ยน" ทุกบิล
    setResolved(null);
    setSelected([]);
    setNote('');
    setError('');
    const hasPricingSnapshot =
      item.basePrice != null &&
      item.packBasePrice != null &&
      item.priceTiers !== undefined &&
      item.promotion !== undefined &&
      item.modifiers !== undefined;
    if (hasPricingSnapshot) {
      setResolved(item);
      setSelected(
        item.modifiers
          ?.filter(modifier => modifier.defaultSelected)
          .map(modifier => modifier.code) ?? [],
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    resolveVariant(item.sku, item.size, item.packCode || null)
      .then(next => {
        if (cancelled) return;
        setResolved(next);
        setSelected(
          next.modifiers
            ?.filter(modifier => modifier.defaultSelected)
            .map(modifier => modifier.code) ?? [],
        );
      })
      .catch(cause => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : 'โหลดราคาล่าสุดไม่สำเร็จ',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, resolveVariant]);

  const groups = useMemo(() => {
    const map = new Map<string, PosModifier[]>();
    for (const modifier of resolved?.modifiers ?? []) {
      map.set(modifier.groupCode, [...(map.get(modifier.groupCode) ?? []), modifier]);
    }
    return [...map.values()];
  }, [resolved?.modifiers]);

  const chooseVariant = async (size: string, packCode: string | null) => {
    if (!item) return;
    setLoading(true);
    setError('');
    try {
      const next = await resolveVariant(item.sku, size, packCode);
      setResolved(next);
      setSelected(next.modifiers?.filter(modifier => modifier.defaultSelected).map(modifier => modifier.code) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โหลดตัวเลือกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const toggleModifier = (modifier: PosModifier) => {
    setSelected(previous => {
      const already = previous.includes(modifier.code);
      const groupCodes = new Set(
        (resolved?.modifiers ?? [])
          .filter(option => option.groupCode === modifier.groupCode)
          .map(option => option.code),
      );
      if (already) return previous.filter(code => code !== modifier.code);
      if (modifier.selectionType === 'SINGLE') {
        return [...previous.filter(code => !groupCodes.has(code)), modifier.code];
      }
      const selectedInGroup = previous.filter(code => groupCodes.has(code));
      if (modifier.maxSelect != null && selectedInGroup.length >= modifier.maxSelect) {
        return previous;
      }
      return [...previous, modifier.code];
    });
  };

  const validate = (): string | null => {
    for (const group of groups) {
      const count = group.filter(modifier => selected.includes(modifier.code)).length;
      if (count < group[0].minSelect) return `กรุณาเลือก ${group[0].groupName} อย่างน้อย ${group[0].minSelect}`;
      if (group[0].maxSelect != null && count > group[0].maxSelect) return `${group[0].groupName} เลือกได้ไม่เกิน ${group[0].maxSelect}`;
    }
    return null;
  };

  if (!item) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
            <Text style={[typography.title, { color: colors.text }]}>{item.name}</Text>
            {(item.availableSizes ?? []).length > 1 ? (
              <>
                <Text style={[typography.captionStrong, { color: colors.textMuted }]}>ขนาด</Text>
                <View style={styles.wrap}>
                  {item.availableSizes?.map(option => (
                    <Button
                      key={option.size}
                      label={`${option.size}${option.price != null ? ` · ฿${option.price.toFixed(2)}` : ''}`}
                      variant={resolved?.size === option.size ? 'primary' : 'secondary'}
                      disabled={loading || option.available <= 0}
                      onPress={() => chooseVariant(option.size, null)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            {(resolved?.packs ?? []).length > 1 ? (
              <>
                <Text style={[typography.captionStrong, { color: colors.textMuted }]}>หน่วยขาย</Text>
                <View style={styles.wrap}>
                  {resolved?.packs?.map(pack => (
                    <Button
                      key={pack.code}
                      label={`${pack.unitName} · ฿${pack.price.toFixed(2)}`}
                      variant={resolved.packCode === pack.code ? 'primary' : 'secondary'}
                      disabled={loading}
                      onPress={() => chooseVariant(resolved.size, pack.code)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            {groups.map(group => (
              <View key={group[0].groupCode} style={{ gap: spacing.sm }}>
                <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
                  {group[0].groupName} · เลือก {group[0].minSelect}
                  {group[0].maxSelect == null ? '+' : `-${group[0].maxSelect}`}
                </Text>
                <View style={styles.wrap}>
                  {group.map(modifier => (
                    <Button
                      key={modifier.code}
                      label={`${modifier.name}${modifier.priceDelta ? ` +฿${modifier.priceDelta.toFixed(2)}` : ''}`}
                      variant={selected.includes(modifier.code) ? 'primary' : 'secondary'}
                      onPress={() => toggleModifier(modifier)}
                    />
                  ))}
                </View>
              </View>
            ))}
            {restaurant ? (
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="หมายเหตุถึงครัว"
                placeholderTextColor={colors.textSoft}
                multiline
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              />
            ) : null}
            {error ? <Text style={[typography.captionStrong, { color: colors.danger }]}>{error}</Text> : null}
            <Button
              label={loading ? 'กำลังโหลด…' : 'เพิ่มรายการ'}
              fullWidth
              disabled={loading || !resolved}
              onPress={() => {
                const failure = validate();
                if (failure) {
                  setError(failure);
                  return;
                }
                if (!resolved) return;
                const surcharge = (resolved.modifiers ?? [])
                  .filter(modifier => selected.includes(modifier.code))
                  .reduce((sum, modifier) => sum + modifier.priceDelta, 0);
                // ⚠️ ราคาที่โชว์รวมตัวเลือกแล้ว แต่ต้องเก็บ "ราคาก่อนตัวเลือก" ไว้ด้วย
                // เพราะ createOrderInTx คิดราคาส่ง/โปรจากราคาป้าย แล้วค่อยบวกตัวเลือกท้ายสุด
                // ถ้ายุบเป็นราคาเดียว ตัวเลือกจะถูกลดตามโปรไปด้วย = ยอดไม่ตรงกับ server
                const packBasePrice = resolved.packBasePrice ?? resolved.price;
                onConfirm({
                  item: {
                    ...resolved,
                    price: packBasePrice + surcharge,
                    packBasePrice,
                    modifierUnitPrice: surcharge,
                  },
                  modifierCodes: selected,
                  kitchenNote: note.trim() || null,
                });
              }}
            />
            <Button label="ยกเลิก" variant="secondary" fullWidth onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { width: '92%', maxWidth: 560, maxHeight: '90%', borderWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12, textAlignVertical: 'top' },
});
