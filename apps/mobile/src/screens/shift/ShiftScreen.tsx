import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { AppColors } from '../../theme/colors';
import { typography as typographyTokens } from '../../theme/typography';
import { mockCashMovements, mockShift } from '../../mocks/shift';
import type {
  RootStackParamList,
  ShiftStackParamList,
} from '../../navigation/types';

type Props = NativeStackScreenProps<ShiftStackParamList, 'Shift'>;

export default function ShiftScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();

  const summaryCard = (
    <Card>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        สรุปกะ
      </Text>
      <Row label="เปิดกะเมื่อ" value={mockShift.openedAt} colors={colors} />
      <Row label="ผู้เปิดกะ" value={mockShift.openedByName} colors={colors} />
      <Row
        label="เงินทอนตั้งต้น"
        value={`฿${mockShift.openingFloat.toFixed(2)}`}
        colors={colors}
      />
      <Row
        label="ยอดขายเงินสด"
        value={`฿${mockShift.cashSales.toFixed(2)}`}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="เงินที่ควรมีในลิ้นชัก"
        value={`฿${mockShift.expectedCash.toFixed(2)}`}
        colors={colors}
        strong
      />
    </Card>
  );

  const movementsCard = (
    <Card style={{ flex: 1 }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        รายการเงินเข้า/ออก
      </Text>
      <FlatList
        data={mockCashMovements}
        keyExtractor={m => m.id}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text }]}>
                {item.reason}
              </Text>
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                {item.at}
              </Text>
            </View>
            <StatusPill
              label={
                item.type === 'IN' ? `+฿${item.amount}` : `-฿${item.amount}`
              }
              tone={item.type === 'IN' ? 'success' : 'danger'}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            กะนี้ยังไม่มีเงินเข้า/ออก
          </Text>
        }
      />
    </Card>
  );

  const actions = (
    <>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        <Button label="เงินเข้า" variant="secondary" style={{ flex: 1 }} />
        <Button label="เงินออก" variant="secondary" style={{ flex: 1 }} />
      </View>
      <Button label="ปิดกะ" variant="danger" fullWidth />
      <Button
        label="ตั้งค่าเครื่องและโหมดทดสอบ"
        variant="ghost"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() =>
          navigation
            .getParent()
            ?.getParent<NativeStackNavigationProp<RootStackParamList>>()
            ?.navigate('Settings')
        }
      />
    </>
  );

  return (
    <ScreenContainer>
      <Text
        style={[
          typography.title,
          { color: colors.text, marginBottom: spacing.lg },
        ]}
      >
        กะและลิ้นชัก
      </Text>

      {/* แท็บเล็ต: สรุปกะ+ปุ่มอยู่แผงซ้ายที่กว้างคงที่ · รายการเงินเข้า-ออกกินฝั่งกว้างเพราะมันคือ
          ส่วนที่ยาวขึ้นเรื่อย ๆ ระหว่างกะ · มือถือเรียงลงมาตามเดิม */}
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ width: 380, justifyContent: 'space-between' }}>
            {summaryCard}
            <View style={{ marginTop: spacing.lg }}>{actions}</View>
          </View>
          <View style={{ flex: 1 }}>{movementsCard}</View>
        </View>
      ) : (
        <>
          <View style={{ marginBottom: spacing.md }}>{summaryCard}</View>
          <View style={{ flex: 1, marginBottom: spacing.lg }}>
            {movementsCard}
          </View>
          {actions}
        </>
      )}
    </ScreenContainer>
  );
}

function Row({
  label,
  value,
  colors,
  strong,
}: {
  label: string;
  value: string;
  colors: AppColors;
  strong?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
      }}
    >
      <Text style={[typographyTokens.body, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          strong ? typographyTokens.bodyStrong : typographyTokens.body,
          { color: colors.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  panes: { flex: 1, flexDirection: 'row' },
});
