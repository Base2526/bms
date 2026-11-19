import { posText, usePosLanguage } from '../../i18n/language';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import { OrderAlertSettingsModal } from '../../components/OrderAlertSettingsModal';
import { OrdersIcon } from '../../components/icons/TabIcons';
import { useOfflineStatusBannerState } from '../../components/OfflineStatusBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useIncomingOrders } from '../../state/IncomingOrdersContext';
import { useOrderAlerts } from '../../state/OrderAlertContext';
import { describeAgo } from '../../lib/orderAlert';
import type { PosIncomingOrder } from '../../types/pos';
import {
  MobileRestaurantCancelOrderLinesDocument,
  MobileRestaurantSetOrderingPausedDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { createIdempotencyKey, isDecidedRejection } from '../../lib/operation';
import { useSession } from '../../state/SessionContext';
import { useRestaurantOperations } from '../../state/RestaurantOperationsContext';
import type { OrdersStackParamList } from '../../navigation/types';
import { getAppNavigation } from '../../navigation/parentNavigation';

const CHANNEL_LABEL: Record<string, string> = {
  LINE: 'LINE',
  FACEBOOK: 'Facebook',
  get WEB() { return posText("เว็บไซต์"); },
  get QR_TABLE() { return posText("QR ที่โต๊ะ"); },
};

type Props = NativeStackScreenProps<OrdersStackParamList, 'IncomingOrders'>;

export default function IncomingOrdersScreen({ navigation }: Props) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { visible: offlineBannerVisible } = useOfflineStatusBannerState();
  const {
    orders,
    pending,
    loading,
    error,
    orderingPaused,
    acceptOrder,
    refresh,
  } = useIncomingOrders();
  const { session } = useSession();
  const bootstrap = useQuery(PosBootstrapDocument);
  const [setPaused] = useMutation(MobileRestaurantSetOrderingPausedDocument);
  const [cancelLines] = useMutation(MobileRestaurantCancelOrderLinesDocument);
  const { settings, soundAvailable, acknowledge } = useOrderAlerts();
  const { activeWaitlistCount, pendingQrCount, pendingServiceCallCount } =
    useRestaurantOperations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const operationInFlight = useRef(false);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const cancelKeys = useRef<Record<string, string>>({});
  const managers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver =>
      approver.id !== session?.cashier.id &&
      approver.hasPin &&
      approver.approvals.includes('restaurant.floor.manage'),
  );

  const togglePaused = async () => {
    if (!session || operationInFlight.current) return;
    operationInFlight.current = true;
    setWorkingId('pause');
    try {
      const response = await setPaused({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            paused: !orderingPaused,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantSetOrderingPaused;
      if (!result || result.reason)
        throw new Error(result?.reason ?? posText("เปลี่ยนสถานะรับออร์เดอร์ไม่สำเร็จ"));
      await refresh().catch(() => undefined);
    } catch (cause) {
      Alert.alert(
        posText("ทำรายการไม่สำเร็จ"),
        cause instanceof Error ? cause.message : posText("กรุณาลองใหม่"),
      );
    } finally {
      operationInFlight.current = false;
      setWorkingId(null);
    }
  };

  const cancelLine = async (
    order: PosIncomingOrder,
    orderItemId: number,
    qty: number,
  ) => {
    if (!session || operationInFlight.current) return;
    operationInFlight.current = true;
    const intent = `${order.id}:${orderItemId}`;
    const idempotencyKey =
      cancelKeys.current[intent] ??
      (cancelKeys.current[intent] = createIdempotencyKey(
        'restaurant-cancel-line',
      ));
    setWorkingId(`cancel-${orderItemId}`);
    try {
      const response = await cancelLines({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            orderId: order.id,
            idempotencyKey,
            lines: [
              {
                orderItemId,
                packQty: Math.max(1, Math.trunc(qty)),
                cause: 'MERCHANT_OUT_OF_STOCK',
              },
            ],
            managerUserId: managerId || null,
            managerPin: managerPin || null,
            note: cancelNote.trim() || null,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantCancelOrderLines;
      if (!result || typeof result.status !== 'string' || !result.status.trim()) {
        throw new Error(posText("ยังไม่ได้รับผลยืนยันการยกเลิก กรุณาตรวจสถานะก่อนทำซ้ำ"));
      }
      if (
        result.reason ||
        !['RETURNED', 'CANCELLED', 'COMPLETED'].includes(result.status ?? '')
      ) {
        delete cancelKeys.current[intent];
        throw new Error(
          result?.reason ?? result?.status ?? posText("ยกเลิกรายการไม่สำเร็จ"),
        );
      }
      delete cancelKeys.current[intent];
      await refresh().catch(() => undefined);
    } catch (cause) {
      if (isDecidedRejection(cause)) delete cancelKeys.current[intent];
      Alert.alert(
        posText("ยกเลิกรายการไม่สำเร็จ"),
        cause instanceof Error ? cause.message : posText("กรุณาลองใหม่"),
      );
    } finally {
      operationInFlight.current = false;
      setWorkingId(null);
    }
  };

  const onAccept = async (order: PosIncomingOrder) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setWorkingId(order.id);
    try {
      const result = await acceptOrder(order.id);
      if (typeof result === 'string') {
        Alert.alert(posText("รับออร์เดอร์ไม่สำเร็จ"), result);
        return;
      }
      acknowledge();
      Alert.alert(posText("รับออร์เดอร์แล้ว"), posText("ส่งเข้าครัว {v0} ตั๋ว", { v0: result.ticketsCreated }));
    } finally {
      operationInFlight.current = false;
      setWorkingId(null);
    }
  };

  return (
    <ScreenContainer>
      <View
        style={[
          styles.header,
          {
            marginBottom: spacing.md,
            paddingTop: offlineBannerVisible ? 52 : 0,
          },
        ]}
      >
        <View style={styles.headerText}>
          <Text style={[typography.title, { color: colors.text }]}>
            {posText("ออร์เดอร์เข้า") + " "}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {loading
              ? posText("กำลังโหลด…")
              : posText("รอรับ {v0} ใบ · ทั้งหมด {v1} ใบ", { v0: pending.length, v1: orders.length })}
          </Text>
        </View>
        <View style={styles.headerTools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              settings.enabled ? posText("ตั้งค่าการแจ้งเตือน") : posText("เปิดการแจ้งเตือน")
            }
            onPress={() => setSettingsOpen(true)}
            style={({ pressed }) => [
              styles.alertControl,
              {
                backgroundColor: colors.surface2,
                borderColor: settings.enabled ? colors.primary : colors.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <OrdersIcon
              color={settings.enabled ? colors.primary : colors.textMuted}
              size={22}
            />
            <Text style={[styles.toolLabel, { color: colors.text }]}>
              {posText("แจ้งเตือน") + " "}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={posText("พักรับออร์เดอร์ออนไลน์")}
            accessibilityState={{
              checked: orderingPaused,
              disabled: Boolean(workingId),
            }}
            disabled={Boolean(workingId)}
            onPress={() => {
              togglePaused().catch(() => undefined);
            }}
            style={({ pressed }) => [
              styles.pauseControl,
              {
                borderColor: orderingPaused ? colors.primary : colors.border,
                backgroundColor: colors.surface2,
                opacity: workingId ? 0.5 : pressed ? 0.82 : 1,
              },
            ]}
          >
            {workingId === 'pause' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                pointerEvents="none"
                value={orderingPaused}
                trackColor={{
                  false: colors.surface3,
                  true: colors.primary,
                }}
                thumbColor={colors.primaryText}
                ios_backgroundColor={colors.surface3}
              />
            )}
            <Text style={[styles.toolLabel, { color: colors.text }]}>
              {posText("พักรับออนไลน์") + " "}</Text>
          </Pressable>
        </View>
      </View>
      {orderingPaused ? (
        <Text style={[typography.captionStrong, { color: colors.warning }]}>
          {posText("หยุดรับออร์เดอร์ออนไลน์ชั่วคราว") + " "}</Text>
      ) : null}
      {/* คิว · QR · เรียกพนักงาน · คำขอจากแชท เป็นงานชนิดเดียวกับออร์เดอร์เข้า — "มีคนรอเราตอบ"
          จึงอยู่ใต้แท็บเดียวกัน · เลขบนปุ่มคือเลขเดียวกับที่รวมเป็น badge บนแถบล่าง
          ถ้าเลขบนแถบกับที่นี่ไม่ตรงกัน แปลว่ามีถังที่ badge นับแต่กดเข้าไปไม่ถึง */}
      <View
        style={[
          styles.segmented,
          { borderColor: colors.border, marginBottom: spacing.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'QUEUE',
            })
          }
          style={({ pressed }) => [
            styles.segment,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            {posText("คิว") + " "}{activeWaitlistCount}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'QR',
            })
          }
          style={({ pressed }) => [
            styles.segment,
            styles.segmentDivider,
            {
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surface2 : 'transparent',
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            QR {pendingQrCount}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'CALLS',
            })
          }
          style={({ pressed }) => [
            styles.segment,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            {posText("คำขอเรียกพนักงาน") + " "}{pendingServiceCallCount}
          </Text>
        </Pressable>
      </View>
      <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
        <TextInput
          value={cancelNote}
          onChangeText={setCancelNote}
          placeholder={posText("หมายเหตุกรณียกเลิกรายการออนไลน์")}
          placeholderTextColor={colors.textSoft}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
        <View style={styles.managerRow}>
          {managers.map(manager => (
            <Button
              key={manager.id}
              label={manager.name ?? manager.id}
              variant={managerId === manager.id ? 'primary' : 'secondary'}
              onPress={() => setManagerId(manager.id)}
            />
          ))}
        </View>
        {managerId ? (
          <TextInput
            value={managerPin}
            onChangeText={setManagerPin}
            placeholder={posText("PIN ผู้จัดการ")}
            keyboardType="number-pad"
            secureTextEntry
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
        ) : null}
      </View>
      {error ? (
        <Button
          label={posText("{v0} · ลองใหม่", { v0: error })}
          variant="danger"
          fullWidth
          onPress={() => refresh()}
        />
      ) : null}
      {!soundAvailable && settings.sound ? (
        <Text style={[typography.caption, { color: colors.warning }]}>
          {posText("เครื่องนี้แจ้งเตือนด้วยการสั่นและแถบบนจอ") + " "}</Text>
      ) : null}
      <FlatList
        data={orders}
        keyExtractor={order => order.id}
        contentContainerStyle={{
          flexGrow: 1,
          gap: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: spacing.lg,
        }}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: spacing.md } : undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <OrdersIcon color={colors.textMuted} size={46} />
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {posText("ไม่มีออร์เดอร์ออนไลน์ในคิว") + " "}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {posText("รายการใหม่จะแสดงที่นี่") + " "}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ flex: 1 }}>
            <View style={styles.row}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {item.customerName}
              </Text>
              <StatusPill
                label={item.status === 'PAID' ? posText("รอรับ") : item.status}
                tone={item.status === 'PAID' ? 'warning' : 'success'}
              />
            </View>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {CHANNEL_LABEL[item.channel] ?? item.channel} ·{' '}
              {item.fulfillmentType} ·{' '}
              {describeAgo(Date.now() - Date.parse(item.receivedAt))}
            </Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {item.lines.map(line => (
                <View key={line.orderItemId} style={styles.row}>
                  <Text
                    style={[typography.body, { color: colors.text, flex: 1 }]}
                  >
                    {line.name} × {line.qty}
                  </Text>
                  {item.status !== 'PAID' ? (
                    <Button
                      label={posText("หมด / ยกเลิก")}
                      variant="danger"
                      loading={workingId === `cancel-${line.orderItemId}`}
                      onPress={() =>
                        cancelLine(item, line.orderItemId, line.qty)
                      }
                    />
                  ) : null}
                </View>
              ))}
            </View>
            <View
              style={[
                styles.row,
                {
                  marginTop: spacing.sm,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  paddingTop: spacing.sm,
                },
              ]}
            >
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {posText("฿")}{item.amountDue.toFixed(2)}
              </Text>
            </View>
            {item.status === 'PAID' ? (
              <Button
                label={
                  workingId === item.id ? posText("กำลังรับ…") : posText("รับออร์เดอร์และส่งครัว")
                }
                fullWidth
                disabled={Boolean(workingId)}
                style={{ marginTop: spacing.md }}
                onPress={() => onAccept(item)}
              />
            ) : null}
          </Card>
        )}
      />
      <OrderAlertSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerText: { flexGrow: 1, flexShrink: 1, minWidth: 116 },
  headerTools: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  alertControl: {
    minWidth: 64,
    minHeight: 64,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pauseControl: {
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  toolLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  segmented: {
    minHeight: 52,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  emptyState: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  managerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
});
