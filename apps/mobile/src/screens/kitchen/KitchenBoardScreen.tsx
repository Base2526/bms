import { posLocale, posText, usePosLanguage } from '../../i18n/language';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill, StatusTone } from '../../components/StatusPill';
import { OrderAlertBanner } from '../../components/OrderAlertBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { padGrid, useResponsive } from '../../theme/useResponsive';
import { useKitchen } from '../../state/KitchenContext';
import {
  elapsedMinutes,
  nextTicketStatus,
  previousTicketStatus,
  stationFilters,
  ticketUrgency,
  type TicketStatus,
} from '../../lib/kitchenBoard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { KitchenStackParamList } from '../../navigation/types';
import { getTabNavigation } from '../../navigation/parentNavigation';

const STATUS_LABEL: Record<TicketStatus, { label: string; tone: StatusTone }> =
  {
    NEW: { get label() { return posText("เข้าใหม่"); }, tone: 'warning' },
    PREPARING: { get label() { return posText("กำลังทำ"); }, tone: 'neutral' },
    READY: { get label() { return posText("พร้อมเสิร์ฟ"); }, tone: 'success' },
    SERVED: { get label() { return posText("เสิร์ฟแล้ว"); }, tone: 'neutral' },
  };

const NEXT_ACTION: Record<TicketStatus, string> = {
  get NEW() { return posText("เริ่มทำ"); },
  get PREPARING() { return posText("พร้อมเสิร์ฟ"); },
  get READY() { return posText("เสิร์ฟแล้ว"); },
  SERVED: '',
};

// จอครัวอ่าน snapshot จาก GraphQL และ named subscription จะสั่ง refetch เมื่อเครื่องอื่นเปลี่ยนงาน
type Props = NativeStackScreenProps<KitchenStackParamList, 'KitchenBoard'>;

export default function KitchenBoardScreen({ navigation }: Props) {
  usePosLanguage();
  const ALL = posText("ทั้งหมด");
  const { colors, spacing, typography, radius } = useTheme();
  const { gridColumns } = useResponsive();
  const {
    tickets,
    stations,
    loading,
    error,
    generatedAt,
    stationSlas,
    advanceTicket,
    rollbackTicket,
    setTicketsStatus,
    refresh,
  } = useKitchen();
  const [station, setStation] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bulkWorking, setBulkWorking] = useState(false);

  // นาฬิกาเดินเอง — "รอมากี่นาที" ที่ค้างอยู่กับที่คือตัวเลขที่ครัวใช้ตัดสินใจไม่ได้
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => refresh().catch(() => undefined), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const filters = useMemo(
    () => stationFilters(stations, tickets),
    [stations, tickets],
  );

  const visible = useMemo(
    () => tickets.filter(t => !station || t.station === station),
    [station, tickets],
  );

  const openCount = useMemo(
    () => visible.filter(t => t.status !== 'SERVED').length,
    [visible],
  );

  // ตัวกรองที่ค้างอยู่กับสถานีที่ไม่มีตั๋วแล้ว = กระดานว่างเปล่าที่อ่านเหมือนระบบพัง
  // (กติกาเดียวกับจอครัวของฝั่งเว็บ) — ปลดให้เองเมื่อสถานีนั้นหมดงาน
  useEffect(() => {
    if (station && !tickets.some(t => t.station === station)) setStation(null);
  }, [station, tickets]);

  return (
    <ScreenContainer>
      <OrderAlertBanner
        onOpenQueue={() => getTabNavigation(navigation).navigate('OrdersTab')}
      />
      <View style={styles.headRow}>
        <Text style={[typography.title, { color: colors.text }]}>{posText("จอครัว")}</Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {posText("ค้างอยู่") + " "}{openCount} {" " + posText("ใบ · จาก") + " "}{visible.length} {" " + posText("ใบบนกระดาน") + " "}</Text>
      </View>
      <Text
        style={[
          typography.caption,
          { color: error ? colors.danger : colors.textMuted },
        ]}
      >
        {error
          ? posText("เชื่อมต่อครัวมีปัญหา: {v0}", { v0: error })
          : loading
          ? posText("กำลังอัปเดตงานครัว…")
          : generatedAt
          ? posText("อัปเดตล่าสุด {v0}", { v0: new Date(generatedAt).toLocaleTimeString(posLocale()) })
          : posText("รอข้อมูลล่าสุดจากเซิร์ฟเวอร์")}
      </Text>

      <FlatList
        horizontal
        data={[ALL, ...filters]}
        keyExtractor={s => s}
        showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        style={{ flexGrow: 0, marginVertical: spacing.md }}
        renderItem={({ item }) => {
          const selected = item === ALL ? station === null : station === item;
          const count =
            item === ALL
              ? tickets.filter(t => t.status !== 'SERVED').length
              : tickets.filter(t => t.station === item && t.status !== 'SERVED')
                  .length;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={posText("กรองสถานี {v0} ค้าง {v1} ใบ", { v0: item, v1: count })}
              onPress={() => setStation(item === ALL ? null : item)}
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
                {item} {count > 0 ? `· ${count}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />
      <View style={[styles.bulkRow, { marginBottom: spacing.md }]}>
        {(
          [
            ['NEW', 'PREPARING', posText("เริ่มทั้งหมด")],
            ['PREPARING', 'READY', posText("พร้อมทั้งหมด")],
            ['READY', 'SERVED', posText("เสิร์ฟทั้งหมด")],
          ] as const
        ).map(([from, to, label]) => {
          const ids = visible
            .filter(ticket => ticket.status === from)
            .map(ticket => ticket.id);
          return (
            <Button
              key={from}
              label={`${label}${ids.length ? ` (${ids.length})` : ''}`}
              variant="secondary"
              disabled={!ids.length || bulkWorking}
              loading={bulkWorking && ids.length > 0}
              onPress={async () => {
                setBulkWorking(true);
                const failure = await setTicketsStatus(ids, to);
                setBulkWorking(false);
                if (failure) Alert.alert(posText("เปลี่ยนสถานะไม่สำเร็จ"), failure);
              }}
            />
          );
        })}
      </View>

      <FlatList
        key={`kitchen-grid-${gridColumns}`}
        data={padGrid(visible, gridColumns)}
        keyExtractor={(t, i) => t?.id ?? `filler-${i}`}
        numColumns={gridColumns}
        columnWrapperStyle={{ gap: spacing.md, alignItems: 'stretch' }}
        contentContainerStyle={{ gap: spacing.md }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {posText("ยังไม่มีตั๋วบนกระดาน — กดส่งครัวจากบิลโต๊ะแล้วรอบนั้นจะมาที่นี่") + " "}</Text>
        }
        renderItem={({ item }) => {
          if (!item) return <View style={{ flex: 1 }} />;
          const status = STATUS_LABEL[item.status];
          const minutes = elapsedMinutes(item.createdAt, now);
          const sla =
            stationSlas[item.stationId ?? item.station] ??
            stationSlas[item.station];
          const urgency = ticketUrgency(
            minutes,
            item.status,
            sla?.warnMinutes,
            sla?.lateMinutes,
          );
          const forward = nextTicketStatus(item.status);
          const back = previousTicketStatus(item.status);
          const clockColor =
            urgency === 'late'
              ? colors.danger
              : urgency === 'warn'
              ? colors.warning
              : colors.textSoft;
          return (
            <Card
              style={{
                flex: 1,
                borderColor: urgency === 'late' ? colors.danger : colors.border,
              }}
            >
              <View style={styles.ticketHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.tableCode} {" " + posText("· รอบ") + " "}{item.roundNo}
                </Text>
                <Text style={[typography.captionStrong, { color: clockColor }]}>
                  {minutes} {" " + posText("น.") + " "}</Text>
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
                <View key={i}>
                  <Text style={[typography.body, { color: colors.text }]}>
                    {it.name}{it.size && it.size !== '-' ? ` · ${it.size}` : ''} × {it.qty}
                  </Text>
                  {it.modifierCodes?.length ? (
                    <Text style={[typography.caption, { color: colors.text }]}>
                      {posText("ตัวเลือก:") + " "}{it.modifierCodes.join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ))}
              {item.note && (
                <Text
                  style={[
                    typography.caption,
                    { color: colors.warning, marginTop: spacing.xs },
                  ]}
                >
                  {posText("หมายเหตุ:") + " "}{item.note}
                </Text>
              )}
              <View style={{ marginTop: spacing.sm }}>
                <StatusPill label={status.label} tone={status.tone} />
              </View>
              <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
                {forward && (
                  <Button
                    label={NEXT_ACTION[item.status]}
                    accessibilityLabel={posText("{v0} {v1} รอบ {v2} {v3}", { v0: NEXT_ACTION[item.status], v1: item.tableCode, v2: item.roundNo, v3: item.station })}
                    fullWidth
                    onPress={() => {
                      advanceTicket(item.id).then(failure => {
                        if (failure)
                          Alert.alert(posText("เปลี่ยนสถานะไม่สำเร็จ"), failure);
                      });
                    }}
                  />
                )}
                {back && (
                  <Button
                    label={posText("ย้อนสถานะ")}
                    accessibilityLabel={posText("ย้อนสถานะตั๋ว {v0} รอบ {v1} {v2}", { v0: item.tableCode, v1: item.roundNo, v2: item.station })}
                    variant="ghost"
                    fullWidth
                    onPress={() => {
                      rollbackTicket(item.id).then(failure => {
                        if (failure) Alert.alert(posText("ย้อนสถานะไม่สำเร็จ"), failure);
                      });
                    }}
                  />
                )}
              </View>
            </Card>
          );
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bulkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
