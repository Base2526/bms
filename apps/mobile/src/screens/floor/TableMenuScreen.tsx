import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { MenuGrid } from '../../components/MenuGrid';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useChecks } from '../../state/ChecksContext';
import { mockTables } from '../../mocks/floor';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'TableMenu'>;

// จอสั่งอาหารให้โต๊ะ (เฉพาะมือถือ — แท็บเล็ตสั่งได้จากหน้าบิลเลยเพราะมีที่พอวางเมนูข้างบิล)
// ⚠️ หัวจอต้องบอกตลอดว่ากำลังสั่งให้โต๊ะไหน — จอที่หน้าตาเหมือนเมนูขายทั่วไปแต่รายการวิ่งเข้าโต๊ะ
// คือทางที่ของไปโผล่ผิดโต๊ะแล้วไม่มีใครรู้จนลูกค้าทัก
export default function TableMenuScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width } = useResponsive();
  const { summaryFor, addItem, decrementItem } = useChecks();

  const tableId = route.params.tableId;
  const table = mockTables.find(t => t.id === tableId);
  const { lines, amountDue, hasUnsent } = summaryFor(tableId);

  const qtyBySku: Record<string, number> = {};
  for (const l of lines) if (l.status === 'NEW') qtyBySku[l.sku] = l.qty;
  const newCount = lines
    .filter(l => l.status === 'NEW')
    .reduce((n, l) => n + l.qty, 0);

  return (
    <ScreenContainer padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <ScreenHeader
          title={`สั่งอาหาร · โต๊ะ ${table?.code ?? '-'}`}
          subtitle={`ยอดปัจจุบัน ฿${amountDue.toFixed(2)}`}
          onBack={() => navigation.goBack()}
        />
      </View>

      <MenuGrid
        qtyBySku={qtyBySku}
        onAdd={item =>
          addItem(tableId, {
            sku: item.sku,
            name: item.name,
            unitPrice: item.price,
          })
        }
        onDecrement={sku => decrementItem(tableId, sku)}
        areaWidth={width}
      />

      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            padding: spacing.lg,
          },
        ]}
      >
        <View>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {newCount > 0
              ? `${newCount} รายการใหม่ยังไม่ส่งครัว`
              : 'ยังไม่มีรายการใหม่'}
          </Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{amountDue.toFixed(2)}
          </Text>
        </View>
        {/* กลับไปหน้าบิลเพื่อส่งครัว — ตั้งใจไม่ใส่ปุ่มส่งครัวไว้สองที่ ให้การส่งครัวมีจุดเดียว
            คือหน้าบิล ซึ่งเป็นที่ที่เห็นทั้งบิลก่อนกด */}
        <Button
          label={hasUnsent ? 'ไปส่งครัว' : 'กลับไปที่บิล'}
          onPress={() => navigation.goBack()}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
