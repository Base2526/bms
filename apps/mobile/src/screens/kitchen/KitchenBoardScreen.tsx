import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { StatusPill, StatusTone } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { padGrid, useResponsive } from '../../theme/useResponsive';
import {
  mockKitchenStations,
  mockKitchenTickets,
  TicketStatus,
} from '../../mocks/kitchenTickets';

const STATUS_LABEL: Record<TicketStatus, { label: string; tone: StatusTone }> =
  {
    NEW: { label: 'เข้าใหม่', tone: 'warning' },
    PREPARING: { label: 'กำลังทำ', tone: 'neutral' },
    READY: { label: 'พร้อมเสิร์ฟ', tone: 'success' },
    SERVED: { label: 'เสิร์ฟแล้ว', tone: 'neutral' },
  };

// จอครัว — โครงเฉย ๆ ยังไม่ poll/subscribe อะไรจริง (รอ WS subscription หลัง backend นิ่ง)
export default function KitchenBoardScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const { gridColumns } = useResponsive();
  const [station, setStation] = useState<string | null>(null);

  const tickets = useMemo(
    () => mockKitchenTickets.filter(t => !station || t.station === station),
    [station],
  );

  return (
    <ScreenContainer>
      <Text
        style={[
          typography.title,
          { color: colors.text, marginBottom: spacing.md },
        ]}
      >
        จอครัว
      </Text>

      <FlatList
        horizontal
        data={['ทั้งหมด', ...mockKitchenStations]}
        keyExtractor={s => s}
        showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        style={{ flexGrow: 0, marginBottom: spacing.lg }}
        renderItem={({ item }) => {
          const selected =
            item === 'ทั้งหมด' ? station === null : station === item;
          return (
            <Pressable
              onPress={() => setStation(item === 'ทั้งหมด' ? null : item)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.pill,
                backgroundColor: selected ? colors.primary : colors.surface2,
              }}
            >
              <Text
                style={[
                  typography.body,
                  { color: selected ? colors.primaryText : colors.text },
                ]}
              >
                {item}
              </Text>
            </Pressable>
          );
        }}
      />

      <FlatList
        key={`kitchen-grid-${gridColumns}`}
        data={padGrid(tickets, gridColumns)}
        keyExtractor={(t, i) => t?.id ?? `filler-${i}`}
        numColumns={gridColumns}
        columnWrapperStyle={{ gap: spacing.md, alignItems: 'stretch' }}
        contentContainerStyle={{ gap: spacing.md }}
        renderItem={({ item }) => {
          if (!item) return <View style={{ flex: 1 }} />;
          const status = STATUS_LABEL[item.status];
          return (
            <Card style={{ flex: 1 }}>
              <View style={styles.ticketHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.tableCode} · รอบ {item.roundNo}
                </Text>
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  {item.elapsedMinutes} น.
                </Text>
              </View>
              <Text
                style={[
                  typography.caption,
                  { color: colors.textMuted, marginBottom: spacing.sm },
                ]}
              >
                {item.station}
              </Text>
              {item.items.map((it, i) => (
                <Text key={i} style={[typography.body, { color: colors.text }]}>
                  {it.name} × {it.qty}
                </Text>
              ))}
              {item.note && (
                <Text
                  style={[
                    typography.caption,
                    { color: colors.warning, marginTop: spacing.xs },
                  ]}
                >
                  หมายเหตุ: {item.note}
                </Text>
              )}
              <View style={{ marginTop: spacing.sm }}>
                <StatusPill label={status.label} tone={status.tone} />
              </View>
            </Card>
          );
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
});
