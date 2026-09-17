import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useMutation, useQuery } from '@apollo/client';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  TABLET_SIDEBAR_WIDTH,
  TabletMainNavigation,
  type TabletMainTab,
} from '../../components/TabletMainNavigation';
import {
  MobilePosAddBoardGameParticipantDocument,
  MobilePosAddBoardGameReservationDocument,
  MobilePosAddBoardGameWaitlistEntryDocument,
  MobilePosAcknowledgeBoardGameServiceCallDocument,
  MobilePosAddBoardGameTabItemDocument,
  MobilePosAdjustBoardGameTimingDocument,
  MobilePosBoardGameSessionDocument,
  MobilePosBoardGameWorkspaceDocument,
  MobilePosCancelBoardGameSessionDocument,
  MobilePosCallBoardGameWaitlistEntryDocument,
  MobilePosCheckInBoardGameReservationDocument,
  MobilePosCheckoutBoardGameCopyDocument,
  MobilePosCloseBoardGameBillingGroupDocument,
  MobilePosCloseBoardGameSessionDocument,
  MobilePosCompleteBoardGameServiceCallDocument,
  MobilePosCloseBoardGameWaitlistEntryDocument,
  MobilePosIssueBoardGameGuestAccessDocument,
  MobilePosLeaveBoardGameParticipantDocument,
  MobilePosMergeBoardGameSeatingDocument,
  MobilePosMembersDocument,
  MobilePosOpenBoardGameSessionDocument,
  MobilePosSeatBoardGameWaitlistEntryDocument,
  MobilePosMoveBoardGameSeatingDocument,
  MobilePosRemoveBoardGameTabItemDocument,
  MobilePosReleaseBoardGameIdentityHoldDocument,
  MobilePosReturnBoardGameCopyDocument,
  MobilePosTakeBoardGameIdentityHoldDocument,
  type MobilePosMembersQuery,
  type MobilePosBoardGameWorkspaceQuery,
} from '../../graphql/generated';
import {
  createIdempotencyKey,
  isDecidedRejection,
  isStaleOperationConflict,
} from '../../lib/operation';
import type {
  AppStackParamList,
  BoardGameStackParamList,
} from '../../navigation/types';
import { getAppNavigation } from '../../navigation/parentNavigation';
import { useSession } from '../../state/SessionContext';
import { useDevice } from '../../state/DeviceContext';
import { useBoardGameService } from '../../state/BoardGameServiceContext';
import { useShift } from '../../state/ShiftContext';
import { useTheme } from '../../theme/ThemeProvider';
import { supportsTabletLayout } from '../../theme/useResponsive';

type FloorProps = NativeStackScreenProps<BoardGameStackParamList, 'BoardGame'>;
type OpenProps = NativeStackScreenProps<AppStackParamList, 'BoardGameOpen'>;
type DetailProps = NativeStackScreenProps<AppStackParamList, 'BoardGameDetail'>;
type BoardGameView =
  | { kind: 'floor' }
  | { kind: 'open'; tableId: string; queueEntryId?: string }
  | { kind: 'detail'; sessionId: string };
type WorkspaceProps = {
  navigation: NativeStackNavigationProp<AppStackParamList>;
  view: BoardGameView;
};
type Table =
  MobilePosBoardGameWorkspaceQuery['bmsPosBoardGameWorkspace']['floor']['tables'][number];
type WorkspaceData =
  MobilePosBoardGameWorkspaceQuery['bmsPosBoardGameWorkspace'];
type FloorStatus = 'available' | 'playing' | 'ending' | 'overdue' | 'blocked';
type ParticipantDraft = {
  key: string;
  customerId: string | null;
  memberNo: string | null;
  displayName: string;
  rateId: string;
  participantType: string;
  billingGroupNo: number;
};
type Member = MobilePosMembersQuery['bmsPosMemberSearch']['members'][number];

const DURATION_PRESETS = [60, 90, 120, 180] as const;
const ALERT_PRESETS = [5, 10, 15, 30] as const;

function durationLabel(minutes: number) {
  if (minutes === 60) return '1 ชม.';
  if (minutes === 90) return '1.5 ชม.';
  if (minutes % 60 === 0) return `${minutes / 60} ชม.`;
  return `${minutes} นาที`;
}

function bahtLabel(amount: number) {
  return Number.isInteger(amount)
    ? amount.toLocaleString('th-TH')
    : amount.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

function rateLabel(name: string, pricePerHour: number) {
  // ร้านเก่าบางแห่งบันทึกราคาไว้ในชื่ออัตราแล้ว อย่าต่อราคาให้ซ้ำบนปุ่ม
  return /(?:฿|บาท)/.test(name)
    ? name
    : `${name} ฿${bahtLabel(pricePerHour)} / ชม.`;
}

/**
 * ป้ายชนิดเอกสาร (`9.93`) — ลิสต์เดียวกับ `BOARD_GAME_IDENTITY_KINDS` ของ service ·
 * ชนิดที่จอไม่รู้จักแสดงเป็นรหัสดิบแทนการซ่อน เพราะบัตรที่ไม่มีป้ายคือบัตรที่หาไม่เจอในลิ้นชัก
 */
const IDENTITY_KIND_ORDER = [
  'NATIONAL_ID',
  'STUDENT_ID',
  'DRIVER_LICENSE',
  'PASSPORT',
  'OTHER',
];
const IDENTITY_KIND_LABEL: Record<string, string> = {
  NATIONAL_ID: 'บัตรประชาชน',
  STUDENT_ID: 'บัตรนักเรียน/นักศึกษา',
  DRIVER_LICENSE: 'ใบขับขี่',
  PASSPORT: 'พาสปอร์ต',
  OTHER: 'อื่น ๆ',
};

function elapsedLabel(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return '-';
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 60000),
  );
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ชม. ${minutes % 60} นาที` : `${minutes} นาที`;
}

function elapsedClockLabel(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return '--:--';
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 60000),
  );
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`;
}

function tableTitle(table: Table) {
  const trailingNumber = table.code.match(/(?:^|[-_\s])(\d{1,3})$/)?.[1];
  return trailingNumber
    ? `โต๊ะ ${trailingNumber.padStart(2, '0')}`
    : table.code;
}

function branchDisplayLabel(branchName: string) {
  return branchName.replace(/^BOOM\s+/, 'BOOM · ');
}

function areaDisplayLabel(areaName: string) {
  return areaName
    .replace(/^FAKE\s+/, '')
    .replace(/\s+[A-Z0-9]{8}$/, '')
    .trim();
}

function floorStatus(table: Table): FloorStatus {
  if (table.blocked) return 'blocked';
  if (!table.openSession) return 'available';
  if (table.openSession.alertStatus === 'OVERDUE') return 'overdue';
  if (table.openSession.alertStatus === 'ENDING_SOON') return 'ending';
  return 'playing';
}

function alertLabel(status: string | null | undefined) {
  if (status === 'OVERDUE') return 'เกินเวลา';
  if (status === 'ENDING_SOON') return 'ใกล้หมดเวลา';
  if (status === 'CLOSING') return 'รอชำระ';
  return 'กำลังเล่น';
}

export default function BoardGameScreen({ navigation }: FloorProps) {
  const appNavigation = getAppNavigation(navigation);
  return (
    <BoardGameWorkspace navigation={appNavigation} view={{ kind: 'floor' }} />
  );
}

export function BoardGameOpenScreen({ navigation, route }: OpenProps) {
  return (
    <BoardGameWorkspace
      navigation={navigation}
      view={{ kind: 'open', tableId: route.params.tableId, queueEntryId: route.params.queueEntryId }}
    />
  );
}

export function BoardGameDetailScreen({ navigation, route }: DetailProps) {
  return (
    <BoardGameWorkspace
      navigation={navigation}
      view={{ kind: 'detail', sessionId: route.params.sessionId }}
    />
  );
}

type BoardGameFloorProps = {
  data?: WorkspaceData;
  loading: boolean;
  errorMessage?: string;
  branchName: string;
  now: number;
  onRetry: () => void;
  onOpen: (table: Table, queueEntryId?: string) => void;
  onOpenSession: (sessionId: string) => void;
  onNavigateTab: (tab: TabletMainTab) => void;
};

function BoardGameFloor({
  data,
  loading,
  errorMessage,
  branchName,
  now,
  onRetry,
  onOpen,
  onOpenSession,
  onNavigateTab,
}: BoardGameFloorProps) {
  const { colors, scheme, spacing, typography } = useTheme();
  const { session } = useSession();
  const { calls, pendingCount, refresh: refreshCalls } = useBoardGameService();
  const [callsOpen, setCallsOpen] = useState(false);
  const [workingCallId, setWorkingCallId] = useState('');
  const [queuePartySize, setQueuePartySize] = useState('2');
  const [queueGuestName, setQueueGuestName] = useState('');
  const [reservationPartySize, setReservationPartySize] = useState('2');
  const [reservationGuestName, setReservationGuestName] = useState('');
  const [reservationGuestPhone, setReservationGuestPhone] = useState('');
  const [reservationTime, setReservationTime] = useState('');
  const [reservationDuration, setReservationDuration] = useState('120');
  const [reservationTableId, setReservationTableId] = useState('');
  const [workingQueueId, setWorkingQueueId] = useState('');
  const callOperationKeys = useRef<Record<string, string>>({});
  const [acknowledgeCall] = useMutation(
    MobilePosAcknowledgeBoardGameServiceCallDocument,
  );
  const [completeCall] = useMutation(
    MobilePosCompleteBoardGameServiceCallDocument,
  );
  const [addWaitlistEntry] = useMutation(MobilePosAddBoardGameWaitlistEntryDocument);
  const [callWaitlistEntry] = useMutation(MobilePosCallBoardGameWaitlistEntryDocument);
  const [closeWaitlistEntry] = useMutation(MobilePosCloseBoardGameWaitlistEntryDocument);
  const [addReservation] = useMutation(MobilePosAddBoardGameReservationDocument);
  const [checkInReservation] = useMutation(MobilePosCheckInBoardGameReservationDocument);
  const { width, height } = useWindowDimensions();
  const isTablet = supportsTabletLayout(width, height, 760);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('all');
  const areas = data?.floor.areas ?? [];
  const tables = data?.floor.tables ?? [];
  const areaNameById = new Map(
    areas.map(area => [area.id, areaDisplayLabel(area.name)] as const),
  );
  const areaOrder = new Map(areas.map((area, index) => [area.id, index]));
  const visibleTables = (
    selectedAreaId === 'all'
      ? [...tables]
      : tables.filter(table => table.areaId === selectedAreaId)
  ).sort(
    (left, right) =>
      (areaOrder.get(left.areaId) ?? Number.MAX_SAFE_INTEGER) -
        (areaOrder.get(right.areaId) ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code, 'th'),
  );
  const counts = tables.reduce(
    (summary, table) => {
      const status = floorStatus(table);
      if (status !== 'blocked') summary[status] += 1;
      return summary;
    },
    { available: 0, playing: 0, ending: 0, overdue: 0 },
  );
  const primaryTint =
    scheme === 'dark' ? 'rgba(22, 119, 255, 0.18)' : '#eff6ff';
  const primaryTintStrong =
    scheme === 'dark' ? 'rgba(22, 119, 255, 0.28)' : '#dbeafe';
  const credentials = session?.credentials;
  const openQueue = (data?.waitlist.entries ?? []).filter(
    entry => entry.status === 'WAITING' || entry.status === 'CALLED',
  );
  const reservations = (data?.waitlist.entries ?? []).filter(
    entry => entry.kind === 'RESERVATION' && entry.status === 'CONFIRMED',
  );
  const runQueueAction = async (
    operationName: string,
    action: (idempotencyKey: string) => Promise<unknown>,
  ) => {
    if (!credentials || workingQueueId) return;
    const idempotencyKey = (callOperationKeys.current[operationName] ??=
      createIdempotencyKey(`board-queue-${operationName}`));
    setWorkingQueueId(operationName);
    try {
      await action(idempotencyKey);
      delete callOperationKeys.current[operationName];
      await onRetry();
      return true;
    } catch (cause) {
      if (isDecidedRejection(cause)) delete callOperationKeys.current[operationName];
      Alert.alert('อัปเดตคิวไม่สำเร็จ', cause instanceof Error ? cause.message : 'กรุณาลองใหม่');
      return false;
    } finally {
      setWorkingQueueId('');
    }
  };
  const callLabel = (code: string) =>
    ({
      GAME_HELP: 'ช่วยสอนเกม',
      GAME_ISSUE: 'ชิ้นส่วนขาด / เกมชำรุด',
      FOOD_DRINK: 'อาหารหรือเครื่องดื่ม',
      BILL: 'ขอคิดเงิน',
      EXTEND_TIME: 'ขอต่อเวลา',
      CLEANUP: 'น้ำหก / ทำความสะอาด',
      OTHER: 'อื่น ๆ',
    }[code] ?? code);
  const handleCall = async (callId: string, status: string) => {
    if (!credentials || workingCallId) return;
    const action = status === 'PENDING' ? 'acknowledge' : 'complete';
    const operationName = `${action}-${callId}`;
    const idempotencyKey = (callOperationKeys.current[operationName] ??=
      createIdempotencyKey(`board-call-${operationName}`));
    setWorkingCallId(callId);
    try {
      if (status === 'PENDING') {
        await acknowledgeCall({
          variables: { input: { ...credentials, callId, idempotencyKey } },
        });
      } else {
        await completeCall({
          variables: { input: { ...credentials, callId, idempotencyKey } },
        });
      }
      delete callOperationKeys.current[operationName];
      await refreshCalls();
    } catch (cause) {
      Alert.alert(
        'อัปเดตคำขอไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorkingCallId('');
    }
  };
  const callBell = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`คำเรียกจากโต๊ะ ${pendingCount} รายการ`}
      onPress={() => setCallsOpen(true)}
      style={({ pressed }) => [
        styles.callBell,
        {
          backgroundColor: pendingCount ? colors.dangerBg : colors.surface2,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={styles.callBellGlyph}>🔔</Text>
      {pendingCount > 0 ? (
        <View style={[styles.callBadge, { backgroundColor: colors.danger }]}>
          <Text style={styles.callBadgeText}>{pendingCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
  const callsModal = (
    <Modal
      transparent
      visible={callsOpen}
      animationType="fade"
      onRequestClose={() => setCallsOpen(false)}
    >
      <View style={[styles.callOverlay, { backgroundColor: colors.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setCallsOpen(false)}
        />
        <View
          style={[
            styles.callPanel,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.between}>
            <View>
              <Text style={[typography.title, { color: colors.text }]}>
                คำเรียกจากโต๊ะ
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                รับทราบก่อน แล้วปิดงานเมื่อดูแลเสร็จ
              </Text>
            </View>
            <Button
              label="ปิด"
              variant="ghost"
              onPress={() => setCallsOpen(false)}
            />
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
            {calls.length === 0 ? (
              <Text style={[typography.body, { color: colors.textMuted }]}>
                ไม่มีโต๊ะรอพนักงาน
              </Text>
            ) : (
              calls.map(call => (
                <Card key={call.id} style={{ gap: spacing.sm }}>
                  <View style={styles.between}>
                    <View style={styles.flex}>
                      <Text
                        style={[typography.subtitle, { color: colors.text }]}
                      >
                        {call.tableCode} · {callLabel(call.requestCode)}
                      </Text>
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.textMuted },
                        ]}
                      >
                        {call.requestNote ??
                          (call.status === 'PENDING'
                            ? 'ยังไม่มีพนักงานรับ'
                            : 'พนักงานรับทราบแล้ว')}
                      </Text>
                    </View>
                    <Text
                      style={[
                        typography.captionStrong,
                        {
                          color:
                            call.status === 'PENDING'
                              ? colors.danger
                              : colors.success,
                        },
                      ]}
                    >
                      {call.status === 'PENDING' ? 'รอรับ' : 'กำลังดูแล'}
                    </Text>
                  </View>
                  <View style={styles.wrap}>
                    <Button
                      label="เปิดโต๊ะ"
                      variant="secondary"
                      onPress={() => {
                        setCallsOpen(false);
                        onOpenSession(call.sessionId);
                      }}
                    />
                    <Button
                      label={
                        call.status === 'PENDING' ? 'รับทราบ' : 'เสร็จแล้ว'
                      }
                      loading={workingCallId === call.id}
                      onPress={() =>
                        handleCall(call.id, call.status).catch(() => undefined)
                      }
                    />
                  </View>
                </Card>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
  const statusVisual = (status: FloorStatus) => {
    switch (status) {
      case 'available':
        return {
          label: 'ว่าง',
          color: colors.success,
          backgroundColor: colors.successBg,
          badgeBackground: scheme === 'dark' ? colors.successBg : '#d1fae5',
          glyph: '●',
        };
      case 'ending':
        return {
          label: 'ใกล้ครบ',
          color: colors.warning,
          backgroundColor: colors.warningBg,
          badgeBackground: scheme === 'dark' ? colors.warningBg : '#fef3c7',
          glyph: '!',
        };
      case 'overdue':
        return {
          label: 'เกินเวลา',
          color: colors.danger,
          backgroundColor: colors.dangerBg,
          badgeBackground: scheme === 'dark' ? colors.dangerBg : '#fee2e2',
          glyph: '◷',
        };
      case 'blocked':
        return {
          label: 'ปิดใช้',
          color: colors.textMuted,
          backgroundColor: colors.surface2,
          badgeBackground: colors.surface3,
          glyph: '–',
        };
      default:
        return {
          label: 'กำลังเล่น',
          color: colors.primary,
          backgroundColor: primaryTint,
          badgeBackground: primaryTintStrong,
          glyph: '▶',
        };
    }
  };
  const summaryItems: Array<{
    key: Exclude<FloorStatus, 'blocked'>;
    label: string;
    count: number;
  }> = [
    { key: 'available', label: 'ว่าง', count: counts.available },
    { key: 'playing', label: 'กำลังเล่น', count: counts.playing },
    { key: 'ending', label: 'ใกล้ครบ', count: counts.ending },
    { key: 'overdue', label: 'เกินเวลา', count: counts.overdue },
  ];

  const zoneButton = (id: string, label: string) => {
    const selected = selectedAreaId === id;
    return (
      <Pressable
        key={id}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`แสดงโซน ${label}`}
        onPress={() => setSelectedAreaId(id)}
        style={({ pressed }) => [
          isTablet ? styles.tabletZoneButton : styles.phoneZoneButton,
          {
            backgroundColor: selected
              ? isTablet
                ? primaryTintStrong
                : colors.primary
              : isTablet
              ? 'transparent'
              : colors.surface2,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {isTablet ? (
          <View
            style={[
              styles.zoneBullet,
              {
                backgroundColor: selected ? colors.primary : colors.textSoft,
              },
            ]}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            isTablet ? typography.bodyStrong : typography.captionStrong,
            {
              color: selected
                ? isTablet
                  ? colors.primary
                  : colors.primaryText
                : colors.textSecondary,
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const summary = (
    <View style={styles.floorSummaryRow}>
      {summaryItems.map(item => {
        const visual = statusVisual(item.key);
        return (
          <View
            key={item.key}
            style={[
              styles.floorSummaryCard,
              {
                backgroundColor: visual.backgroundColor,
                padding: isTablet ? spacing.lg : spacing.sm,
              },
            ]}
          >
            <View style={styles.floorSummaryLabel}>
              <View
                style={[styles.statusGlyph, { backgroundColor: visual.color }]}
              >
                <Text style={styles.statusGlyphText}>{visual.glyph}</Text>
              </View>
              <Text
                numberOfLines={1}
                style={[
                  isTablet ? typography.bodyStrong : styles.summaryLabelPhone,
                  { color: visual.color },
                ]}
              >
                {item.label}
              </Text>
            </View>
            <Text
              style={[
                isTablet ? typography.numeric : styles.summaryCountPhone,
                { color: visual.color },
              ]}
            >
              {item.count}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const floorBody = (
    <>
      {loading && !data ? (
        <Card>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            กำลังโหลดผังโต๊ะ...
          </Text>
        </Card>
      ) : null}
      {errorMessage && !data ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>
            โหลดข้อมูล Board Game ไม่สำเร็จ
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {errorMessage}
          </Text>
          <Button label="ลองใหม่" variant="secondary" onPress={onRetry} />
        </Card>
      ) : null}
      {data && tables.length === 0 ? (
        <Card>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ยังไม่มีโต๊ะ Board Game ในสาขานี้ กรุณาตั้งค่าผังจาก Admin
          </Text>
        </Card>
      ) : null}
      {data && tables.length > 0 && visibleTables.length === 0 ? (
        <Card>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            โซนนี้ยังไม่มีโต๊ะ
          </Text>
        </Card>
      ) : null}
      {data ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={[typography.subtitle, { color: colors.text }]}>การจองล่วงหน้า</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>ยืนยันอยู่ {data.waitlist.confirmedReservationCount} รายการ</Text>
          <View style={styles.wrap}>
            <TextInput accessibilityLabel="วันเวลาจอง" value={reservationTime}
              onChangeText={setReservationTime} placeholder="2026-09-20T18:00"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 175, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
            <TextInput accessibilityLabel="ระยะเวลาจอง" keyboardType="number-pad"
              value={reservationDuration} onChangeText={setReservationDuration} placeholder="นาที"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 88, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
            <TextInput accessibilityLabel="จำนวนคนที่จอง" keyboardType="number-pad"
              value={reservationPartySize} onChangeText={setReservationPartySize} placeholder="จำนวนคน"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 96, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
            <TextInput accessibilityLabel="ชื่อลูกค้าที่จอง" value={reservationGuestName}
              onChangeText={setReservationGuestName} placeholder="ชื่อลูกค้า"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 135, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
            <TextInput accessibilityLabel="เบอร์โทรลูกค้าที่จอง" value={reservationGuestPhone}
              onChangeText={setReservationGuestPhone} placeholder="เบอร์โทร"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 135, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
          </View>
          <Text style={[typography.captionStrong, { color: colors.text }]}>เลือกโต๊ะ</Text>
          <View style={styles.wrap}>
            {tables.filter(table => !table.blocked).map(table => (
              <Button key={table.id} label={`${table.code} (${table.seats})`}
                variant={reservationTableId === table.id ? 'primary' : 'secondary'}
                onPress={() => setReservationTableId(table.id)} />
            ))}
          </View>
          <Button label="ยืนยันจอง" loading={workingQueueId === 'reservation-add'}
            onPress={() => {
              const partySize = Number(reservationPartySize);
              const durationMinutes = Number(reservationDuration);
              const instant = new Date(reservationTime);
              if (!reservationTableId || !reservationGuestName.trim() || !reservationGuestPhone.trim()
                || !Number.isInteger(partySize) || partySize < 1
                || !Number.isInteger(durationMinutes) || durationMinutes < 30
                || !Number.isFinite(instant.getTime())) {
                Alert.alert('ข้อมูลจองไม่ครบ', 'ระบุเวลา โต๊ะ ชื่อ เบอร์โทร จำนวนคน และระยะเวลาอย่างน้อย 30 นาที'); return;
              }
              runQueueAction('reservation-add', idempotencyKey => addReservation({ variables: { input: {
                ...credentials!, idempotencyKey, tableId: reservationTableId,
                reservedFor: instant.toISOString(), durationMinutes, partySize,
                guestName: reservationGuestName.trim(), guestPhone: reservationGuestPhone.trim(), note: null,
              } } })).then(success => {
                if (success) {
                  setReservationPartySize('2'); setReservationGuestName('');
                  setReservationGuestPhone(''); setReservationTime(''); setReservationTableId('');
                }
              }).catch(() => undefined);
            }} />
          {reservations.map(entry => {
            const table = tables.find(item => item.id === entry.reservedTableId);
            const reservedAt = entry.reservedFor ? Date.parse(entry.reservedFor) : Number.NaN;
            const currentTime = Date.now();
            const canArrive = Number.isFinite(reservedAt)
              && currentTime >= reservedAt - 2 * 60 * 60_000
              && currentTime <= reservedAt + 6 * 60 * 60_000;
            const canMarkNoShow = Number.isFinite(reservedAt) && currentTime >= reservedAt;
            return (
              <View key={entry.id} style={{ gap: spacing.xs }}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {entry.guestName || 'ไม่ระบุชื่อ'} · {entry.partySize} คน · {entry.reservedTableCode || '-'}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {entry.reservedFor ? new Date(entry.reservedFor).toLocaleString('th-TH') : '-'} · {entry.reservedDurationMinutes ?? 0} นาที
                </Text>
                <View style={styles.wrap}>
                  <Button label="เช็กอิน" variant="secondary"
                    disabled={!canArrive}
                    loading={workingQueueId === `reservation-checkin-${entry.id}`}
                    onPress={() => runQueueAction(`reservation-checkin-${entry.id}`, idempotencyKey =>
                      checkInReservation({ variables: { input: { ...credentials!, idempotencyKey, entryId: entry.id } } })
                    ).catch(() => undefined)} />
                  {canArrive && table && !table.blocked && !table.openSession && table.seats >= entry.partySize ? (
                    <Button label="นั่งโต๊ะ" onPress={() => onOpen(table, entry.id)} />
                  ) : null}
                  <Button label="ยกเลิก" variant="ghost"
                    loading={workingQueueId === `reservation-cancel-${entry.id}`}
                    onPress={() => runQueueAction(`reservation-cancel-${entry.id}`, idempotencyKey =>
                      closeWaitlistEntry({ variables: { input: {
                        ...credentials!, idempotencyKey, entryId: entry.id, status: 'CANCELLED', reason: null,
                      } } })
                    ).catch(() => undefined)} />
                  {canMarkNoShow ? (
                    <Button label="ไม่มา" variant="ghost"
                      loading={workingQueueId === `reservation-noshow-${entry.id}`}
                      onPress={() => runQueueAction(`reservation-noshow-${entry.id}`, idempotencyKey =>
                        closeWaitlistEntry({ variables: { input: {
                          ...credentials!, idempotencyKey, entryId: entry.id, status: 'NO_SHOW', reason: null,
                        } } })
                      ).catch(() => undefined)} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      {data ? (
        <Card style={{ gap: spacing.sm }}>
          <View style={styles.between}>
            <View style={styles.flex}>
              <Text style={[typography.subtitle, { color: colors.text }]}>คิวรอโต๊ะ</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                รอ {data.waitlist.waitingCount} กลุ่ม · {data.waitlist.waitingGuests} คน · นานสุด {data.waitlist.longestWaitMinutes} นาที
              </Text>
            </View>
          </View>
          <View style={styles.wrap}>
            <TextInput
              accessibilityLabel="จำนวนคนในคิว"
              keyboardType="number-pad"
              value={queuePartySize}
              onChangeText={setQueuePartySize}
              placeholder="จำนวนคน"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { minWidth: 96, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
            />
            <TextInput
              accessibilityLabel="ชื่อเรียกคิว"
              value={queueGuestName}
              onChangeText={setQueueGuestName}
              placeholder="ชื่อเรียก"
              placeholderTextColor={colors.textSoft}
              style={[styles.input, { flex: 1, minWidth: 140, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
            />
            <Button
              label="รับคิว"
              loading={workingQueueId === 'add'}
              onPress={() => {
                const partySize = Number(queuePartySize);
                if (!Number.isInteger(partySize) || partySize < 1 || partySize > 500) {
                  Alert.alert('จำนวนคนไม่ถูกต้อง', 'ระบุจำนวนคนระหว่าง 1–500'); return;
                }
                runQueueAction('add', key => addWaitlistEntry({ variables: { input: {
                  ...credentials!, idempotencyKey: key, partySize,
                  guestName: queueGuestName.trim() || null,
                  guestPhone: null, note: null, preferredAreaId: null,
                } } })).then(success => {
                  if (success) { setQueuePartySize('2'); setQueueGuestName(''); }
                }).catch(() => undefined);
              }}
            />
          </View>
          {openQueue.length === 0 ? (
            <Text style={[typography.body, { color: colors.textMuted }]}>ยังไม่มีคนรอ</Text>
          ) : openQueue.map(entry => {
            const fitting = tables.filter(table =>
              !table.blocked && !table.openSession && table.seats >= entry.partySize,
            );
            return (
              <View key={entry.id} style={{ gap: spacing.xs }}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>คิว {entry.queueNo} · {entry.guestName || 'ไม่ระบุชื่อ'} · {entry.partySize} คน</Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>รอ {elapsedLabel(entry.createdAt, now)}{entry.status === 'CALLED' ? ' · เรียกแล้ว' : ''}</Text>
                <View style={styles.wrap}>
                  {fitting.slice(0, 4).map(table => (
                    <Button key={table.id} label={`นั่ง ${table.code}`} variant="secondary"
                      onPress={() => onOpen(table, entry.id)} />
                  ))}
                  {entry.status === 'WAITING' ? (
                    <Button label="เรียก" variant="secondary" loading={workingQueueId === `call-${entry.id}`}
                      onPress={() => runQueueAction(`call-${entry.id}`, key => callWaitlistEntry({ variables: { input: {
                        ...credentials!, idempotencyKey: key, entryId: entry.id,
                      } } })).catch(() => undefined)} />
                  ) : null}
                  <Button label={entry.status === 'CALLED' ? 'ไม่มา' : 'ยกเลิก'} variant="ghost"
                    loading={workingQueueId === `close-${entry.id}`}
                    onPress={() => runQueueAction(`close-${entry.id}`, key => closeWaitlistEntry({ variables: { input: {
                      ...credentials!, idempotencyKey: key, entryId: entry.id,
                      status: entry.status === 'CALLED' ? 'NO_SHOW' : 'CANCELLED',
                      reason: null,
                    } } })).catch(() => undefined)} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      <View style={styles.floorTableGrid}>
        {visibleTables.map(table => {
          const status = floorStatus(table);
          const visual = statusVisual(status);
          const areaName = areaNameById.get(table.areaId);
          const statusLabel =
            table.openSession?.alertStatus === 'CLOSING'
              ? 'รอชำระ'
              : visual.label;
          const timer = table.openSession
            ? elapsedClockLabel(table.openSession.startedAt, now)
            : 'พร้อมใช้งาน';
          const tableCallCount = calls.filter(call =>
            table.openSession?.sessionIds?.includes(call.sessionId),
          ).length;
          return (
            <View
              key={table.id}
              style={[
                styles.floorTableCard,
                isTablet ? styles.floorTableCardTablet : null,
                {
                  backgroundColor: visual.backgroundColor,
                  borderColor: visual.badgeBackground,
                  width: isTablet ? '31.8%' : '100%',
                },
              ]}
            >
              <View style={styles.floorCardHeading}>
                <Text
                  numberOfLines={1}
                  style={[
                    isTablet ? typography.title : typography.subtitle,
                    styles.flex,
                    { color: colors.text },
                  ]}
                >
                  {tableTitle(table)}
                </Text>
                <View
                  style={[
                    styles.floorStatusBadge,
                    { backgroundColor: visual.badgeBackground },
                  ]}
                >
                  <Text
                    style={[styles.floorStatusDot, { color: visual.color }]}
                  >
                    {visual.glyph}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[typography.captionStrong, { color: visual.color }]}
                  >
                    {statusLabel}
                  </Text>
                </View>
                {tableCallCount > 0 ? (
                  <View
                    style={[
                      styles.tableCallBadge,
                      { backgroundColor: colors.danger },
                    ]}
                  >
                    <Text style={styles.tableCallBadgeText}>
                      🔔 {tableCallCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[typography.caption, { color: colors.textMuted }]}
              >
                {areaName ? `${areaName} · ` : ''}
                {table.seats} ที่นั่ง
              </Text>
              {isTablet && table.openSession?.startedAt ? (
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  เริ่มเล่น{' '}
                  {new Date(table.openSession.startedAt).toLocaleTimeString(
                    'th-TH',
                    { hour: '2-digit', minute: '2-digit' },
                  )}{' '}
                  น.
                </Text>
              ) : null}
              <View
                style={[
                  styles.floorCardFooter,
                  isTablet ? styles.floorCardFooterTablet : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    table.openSession
                      ? typography.numeric
                      : typography.bodyStrong,
                    { color: visual.color },
                  ]}
                >
                  {status === 'blocked' ? 'ไม่พร้อมใช้งาน' : timer}
                </Text>
                <Button
                  label={table.openSession ? 'ดูโต๊ะ' : 'เปิดโต๊ะ'}
                  variant={table.openSession ? 'secondary' : 'primary'}
                  disabled={table.blocked}
                  onPress={() => onOpen(table)}
                  fullWidth={isTablet}
                  style={isTablet ? undefined : styles.floorPhoneAction}
                />
              </View>
            </View>
          );
        })}
      </View>
    </>
  );

  if (!isTablet) {
    return (
      <ScreenContainer>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          <View>
            <View style={styles.between}>
              <Text style={[typography.title, { color: colors.text }]}>
                โต๊ะและเวลา
              </Text>
              {callBell}
            </View>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {branchDisplayLabel(branchName)}
            </Text>
          </View>
          {summary}
          <ScrollView
            horizontal
            style={{ flexGrow: 0 }}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.phoneZoneRow}
          >
            {zoneButton('all', 'ทั้งหมด')}
            {areas.map(area =>
              zoneButton(area.id, areaDisplayLabel(area.name)),
            )}
          </ScrollView>
          {floorBody}
        </ScrollView>
        {callsModal}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.floorTabletShell}>
        <View
          style={[
            styles.floorSidebar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.floorSidebarContent}>
            <Text style={[typography.title, { color: colors.text }]}>
              Board Game
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {branchDisplayLabel(branchName)}
            </Text>
            <View style={styles.floorSidebarZones}>
              {zoneButton('all', 'ทุกโซน')}
              {areas.map(area =>
                zoneButton(area.id, areaDisplayLabel(area.name)),
              )}
            </View>
            <View
              style={[
                styles.sidebarDivider,
                { backgroundColor: colors.border },
              ]}
            />
            <View style={styles.floorLegend}>
              {summaryItems.map(item => {
                const visual = statusVisual(item.key);
                return (
                  <View key={item.key} style={styles.floorLegendRow}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: visual.color },
                      ]}
                    />
                    <Text
                      style={[
                        typography.body,
                        styles.flex,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      {item.count}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
          <TabletMainNavigation
            activeTab="BoardGameTab"
            onNavigate={onNavigateTab}
          />
        </View>
        <ScrollView
          style={styles.floorTabletMain}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.lg,
            padding: spacing.xl,
            paddingBottom: spacing.xxl,
          }}
        >
          <View style={styles.floorTabletHeader}>
            <View style={styles.flex}>
              <Text style={[typography.title, { color: colors.text }]}>
                โต๊ะและเวลา
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {new Date(now).toLocaleDateString('th-TH', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                เวลา{' '}
                {new Date(now).toLocaleTimeString('th-TH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            {callBell}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="รีเฟรชผังโต๊ะ"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.floorRefresh,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.primary }]}>
                ↻ รีเฟรช
              </Text>
            </Pressable>
          </View>
          {summary}
          {floorBody}
        </ScrollView>
        {callsModal}
      </View>
    </ScreenContainer>
  );
}

function BoardGameWorkspace({ navigation, view }: WorkspaceProps) {
  const { colors, spacing, typography } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { target: deviceTarget } = useDevice();
  const { session } = useSession();
  const shift = useShift();
  const isFocused = useIsFocused();
  const credentials = session?.credentials;
  const inputCredentials = credentials ?? { cashierUserId: '', pin: '' };
  const [now, setNow] = useState(Date.now());
  const selectedSessionId = view.kind === 'detail' ? view.sessionId : '';
  const [billingMode, setBillingMode] = useState<
    'OPEN_ENDED' | 'FIXED_DURATION'
  >('OPEN_ENDED');
  const [durationMinutes, setDurationMinutes] = useState('120');
  const [alertBeforeMinutes, setAlertBeforeMinutes] = useState('15');
  const [sessionNote, setSessionNote] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantRateId, setParticipantRateId] = useState('');
  const [participantGroup, setParticipantGroup] = useState('1');
  const [participantCount, setParticipantCount] = useState(1);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [returnNote, setReturnNote] = useState('');
  const [guestAccess, setGuestAccess] = useState<{
    token: string;
    tableCode: string;
    tableName: string;
  } | null>(null);
  const [holderName, setHolderName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentKind, setDocumentKind] = useState('NATIONAL_ID');
  const [cancelReason, setCancelReason] = useState('');
  const [tabDrafts, setTabDrafts] = useState<
    Record<string, { sku: string; qty: string }>
  >({});
  const [working, setWorking] = useState('');
  const notified = useRef(new Set<string>());
  const operationKeys = useRef<Record<string, string>>({});

  const workspace = useQuery(MobilePosBoardGameWorkspaceDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials,
    pollInterval: 5000,
  });
  const sessionQuery = useQuery(MobilePosBoardGameSessionDocument, {
    variables: { credentials: inputCredentials, id: selectedSessionId },
    skip: !credentials || !selectedSessionId,
    pollInterval: 5000,
  });
  const members = useQuery(MobilePosMembersDocument, {
    variables: { q: memberSearch.trim(), amount: null },
    skip: !credentials || memberSearch.trim().length < 3,
  });
  const [openSession] = useMutation(MobilePosOpenBoardGameSessionDocument);
  const [seatWaitlistEntry] = useMutation(MobilePosSeatBoardGameWaitlistEntryDocument);
  const [addParticipant] = useMutation(
    MobilePosAddBoardGameParticipantDocument,
  );
  const [addTabItem] = useMutation(MobilePosAddBoardGameTabItemDocument);
  const [leaveParticipant] = useMutation(
    MobilePosLeaveBoardGameParticipantDocument,
  );
  const [adjustTiming] = useMutation(MobilePosAdjustBoardGameTimingDocument);
  const [closeBillingGroup] = useMutation(
    MobilePosCloseBoardGameBillingGroupDocument,
  );
  const [closeSession] = useMutation(MobilePosCloseBoardGameSessionDocument);
  const [moveSeating] = useMutation(MobilePosMoveBoardGameSeatingDocument);
  const [mergeSeating] = useMutation(MobilePosMergeBoardGameSeatingDocument);
  const [removeTabItem] = useMutation(MobilePosRemoveBoardGameTabItemDocument);
  const [cancelSession] = useMutation(MobilePosCancelBoardGameSessionDocument);
  const [checkoutCopy] = useMutation(MobilePosCheckoutBoardGameCopyDocument);
  const [returnCopy] = useMutation(MobilePosReturnBoardGameCopyDocument);
  const [takeIdentityHold] = useMutation(
    MobilePosTakeBoardGameIdentityHoldDocument,
  );
  const [releaseIdentityHold] = useMutation(
    MobilePosReleaseBoardGameIdentityHoldDocument,
  );
  const [issueGuestAccess, { loading: issuingGuestAccess }] = useMutation(
    MobilePosIssueBoardGameGuestAccessDocument,
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!credentials) return;
      workspace.refetch().catch(() => undefined);
      if (selectedSessionId) sessionQuery.refetch().catch(() => undefined);
    }, [credentials, selectedSessionId, sessionQuery, workspace]),
  );

  const data = workspace.data?.bmsPosBoardGameWorkspace;
  const openingTable =
    view.kind === 'open'
      ? data?.floor.tables.find(table => table.id === view.tableId) ?? null
      : null;
  const seatingQueueEntry = view.kind === 'open' && view.queueEntryId
    ? data?.waitlist.entries.find(entry => entry.id === view.queueEntryId) ?? null
    : null;
  const activeRates = useMemo(
    () => (data?.rates ?? []).filter(rate => rate.active),
    [data?.rates],
  );

  useEffect(() => {
    if (!participantRateId && activeRates[0]) {
      setParticipantRateId(activeRates[0].id);
    }
  }, [activeRates, participantRateId]);
  const selectedSession = sessionQuery.data?.bmsPosBoardGameSession;
  const selectedTable = data?.floor.tables.find(
    table => table.id === selectedSession?.tableId,
  );
  const seatingSessionIds =
    selectedTable?.openSession?.sessionIds ??
    (selectedSession ? [selectedSession.id] : []);
  // `9.91`: โต๊ะที่ถูกรวมไว้มีหลายชุดนั่งร่วมกัน — ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่กำลังดูอยู่
  // ปุ่มเดียวจึงมีสองความหมาย และจอต้องบอกก่อนกด ไม่ใช่ให้รู้ตอนอีกชุดหายไปจากโต๊ะ
  const sharedSeating = (selectedTable?.openSession?.sessionCount ?? 1) > 1;
  const relocateTargets = (data?.floor.tables ?? []).filter(
    table => !table.blocked && table.id !== selectedSession?.tableId,
  );
  const availableCopies = useMemo(
    () =>
      (data?.library ?? []).flatMap(title =>
        title.copies
          .filter(copy => copy.status === 'AVAILABLE')
          .map(copy => ({ ...copy, title: title.title })),
      ),
    [data?.library],
  );

  // Session ที่อีกเครื่องชำระ/ยกเลิกจบแล้วไม่ควรค้างเป็นจอ "กำลังเล่น" ที่กดทุกคำสั่งแล้วถูกปฏิเสธ
  // ข้อมูล authoritative ยังมาจาก server; เมื่อกลายเป็น terminal ให้กลับผังซึ่งสะท้อน seating ล่าสุด
  //
  // ครอบเฉพาะ "session ยังอยู่แต่จบแล้ว" · เคส "หา session ไม่เจอ" ไม่ต้องมีด่านที่นี่ เพราะ
  // `sessionAtScope()` โยน NOT_FOUND ไม่ได้คืน null และ Apollo ของแอปใช้ errorPolicy ปริยาย
  // (`none`) → `data` เป็น undefined ไม่ใช่ `{ bmsPosBoardGameSession: null }` · การ์ด
  // "เปิดรายละเอียดโต๊ะไม่สำเร็จ" พร้อมปุ่มย้อนกลับมาตรฐานบนหัวจอรับเคสนั้นอยู่แล้ว
  // และการเด้งกลับเองจะกลืนข้อความที่บอกว่าทำไมเปิดไม่ได้
  useEffect(() => {
    if (
      selectedSession &&
      !['OPEN', 'CLOSING'].includes(selectedSession.status)
    ) {
      navigation.popToTop();
      workspace.refetch().catch(() => undefined);
    }
  }, [navigation, selectedSession, workspace]);

  useEffect(() => {
    // route เปิด/รายละเอียดมี workspace ของตัวเองเพื่อให้ transition เป็น native stack จริง
    // แต่ alert เวลาเป็นหน้าที่ของผังเท่านั้น ไม่เช่นนั้นการ push หน้าจะเตือนชุดเดิมซ้ำทันที
    if (view.kind !== 'floor' || !isFocused) return;
    const pending: Array<{
      table: Table;
      sessionId: string;
      status: string;
    }> = [];
    for (const table of data?.floor.tables ?? []) {
      const current = table.openSession;
      if (
        !current?.id ||
        !['ENDING_SOON', 'OVERDUE'].includes(current.alertStatus ?? '')
      )
        continue;
      const key = `${current.id}:${current.alertStatus}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      pending.push({
        table,
        sessionId: current.id,
        status: current.alertStatus ?? '',
      });
    }

    if (pending.length === 0) return;

    const message = pending
      .map(
        item =>
          `${item.table.code} ${item.table.name} · ${alertLabel(item.status)}`,
      )
      .join('\n');
    if (pending.length === 1) {
      const item = pending[0];
      Alert.alert(
        item.status === 'OVERDUE' ? 'โต๊ะเกินเวลาแล้ว' : 'โต๊ะใกล้หมดเวลา',
        message,
        [
          { text: 'รับทราบ' },
          {
            text: 'เปิดโต๊ะ',
            onPress: () =>
              navigation.push('BoardGameDetail', {
                sessionId: item.sessionId,
              }),
          },
        ],
      );
      return;
    }

    const overdueCount = pending.filter(
      item => item.status === 'OVERDUE',
    ).length;
    const endingSoonCount = pending.length - overdueCount;
    const summary = [
      overdueCount > 0 ? `เกินเวลา ${overdueCount}` : '',
      endingSoonCount > 0 ? `ใกล้หมดเวลา ${endingSoonCount}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    Alert.alert(
      `แจ้งเตือนเวลา ${pending.length} โต๊ะ`,
      `${summary}\n\n${message}`,
      [
        { text: 'รับทราบ' },
        {
          text: 'ดูผังโต๊ะ',
          onPress: () => navigation.popToTop(),
        },
      ],
    );
  }, [data?.floor.tables, isFocused, navigation, view.kind]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (!credentials || working) return;
    setWorking(key);
    try {
      await action();
      delete operationKeys.current[key];
      await Promise.all([
        workspace.refetch(),
        selectedSessionId ? sessionQuery.refetch() : Promise.resolve(),
      ]).catch(() => undefined);
    } catch (cause) {
      // เก็บคีย์ไว้เฉพาะตอนยังไม่รู้ผล (เน็ตล้ม/500) เพื่อให้กดซ้ำแล้ว replay คำตอบเดิม
      // · คำขอที่เซิร์ฟเวอร์ตัดสินแล้วต้องออกคีย์ใหม่ ไม่งั้นแก้ตามที่ error บอกแล้วกดใหม่
      //   จะไปชนคีย์เดิมด้วยข้อมูลคนละชุด แล้วล้มซ้ำแบบที่หน้าจอพาออกไม่ได้
      const stale = isStaleOperationConflict(cause);
      if (isDecidedRejection(cause)) {
        delete operationKeys.current[key];
      }
      if (stale) {
        await Promise.all([
          workspace.refetch(),
          selectedSessionId ? sessionQuery.refetch() : Promise.resolve(),
        ]).catch(() => undefined);
      }
      Alert.alert(
        stale ? 'ข้อมูลเปลี่ยนไปแล้ว' : 'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking('');
    }
  };
  const retryKey = (key: string) =>
    (operationKeys.current[key] ??= createIdempotencyKey(`board-${key}`));

  const addDraftParticipant = () => {
    const rate = activeRates.find(item => item.id === participantRateId);
    const group = Number(participantGroup);
    if (!rate || !Number.isInteger(group) || group < 1 || group > 20) {
      Alert.alert('ข้อมูลผู้เล่นไม่ครบ', 'เลือกอัตราและระบุกลุ่มบิล 1-20');
      return;
    }
    const count = selectedMember ? 1 : participantCount;
    setParticipants(previous => {
      const startedAt = Date.now();
      const additions = Array.from({ length: count }, (_, index) => ({
        key: `${startedAt}-${previous.length + index}`,
        customerId: index === 0 ? selectedMember?.customerId ?? null : null,
        memberNo: index === 0 ? selectedMember?.memberNo ?? null : null,
        displayName: index === 0 ? participantName.trim() : '',
        rateId: rate.id,
        participantType: rate.customerType,
        billingGroupNo: group,
      }));
      return [...previous, ...additions];
    });
    setParticipantName('');
    setParticipantCount(1);
    setMemberSearch('');
    setSelectedMember(null);
  };

  const chooseMember = (member: Member) => {
    setSelectedMember(member);
    setParticipantCount(1);
    setParticipantName(member.name);
    setMemberSearch(member.memberNo ?? member.name);
    const memberRate = activeRates.find(rate => rate.customerType === 'MEMBER');
    if (memberRate) setParticipantRateId(memberRate.id);
  };

  const beginOpen = (table: Table, queueEntryId?: string) => {
    if (table.blocked) return;
    if (table.openSession?.id) {
      navigation.push('BoardGameDetail', {
        sessionId: table.openSession.id,
      });
      return;
    }
    navigation.push('BoardGameOpen', { tableId: table.id, queueEntryId });
  };

  const openBillingGroupCheckout = (billingGroupId: string) => {
    navigation.navigate('Checkout', {
      source: 'board_game',
      boardGameBillingGroupId: billingGroupId,
    });
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
    },
  ];

  const durationValue = Number(durationMinutes);
  const alertValue = Number(alertBeforeMinutes);
  const fixedDurationValid =
    durationMinutes.trim() !== '' &&
    Number.isInteger(durationValue) &&
    durationValue >= 1 &&
    durationValue <= 1440;
  const alertValid =
    alertBeforeMinutes.trim() !== '' &&
    Number.isInteger(alertValue) &&
    alertValue >= 0 &&
    alertValue <= 120;
  const selectedBillingGroup = Number(participantGroup);
  const draftBillingGroups = useMemo(() => {
    const counts = new Map<number, number>();
    for (const participant of participants) {
      counts.set(
        participant.billingGroupNo,
        (counts.get(participant.billingGroupNo) ?? 0) + 1,
      );
    }
    if (
      Number.isInteger(selectedBillingGroup) &&
      selectedBillingGroup >= 1 &&
      selectedBillingGroup <= 20 &&
      !counts.has(selectedBillingGroup)
    ) {
      counts.set(selectedBillingGroup, 0);
    }
    return [...counts.entries()].sort(([left], [right]) => left - right);
  }, [participants, selectedBillingGroup]);
  const nextBillingGroup =
    Math.max(0, ...draftBillingGroups.map(([group]) => group)) + 1;
  const hourlyTotal = participants.reduce((sum, participant) => {
    const rate = activeRates.find(item => item.id === participant.rateId);
    return sum + Number(rate?.pricePerHour ?? 0);
  }, 0);
  const expectedEndAt =
    billingMode === 'FIXED_DURATION' && fixedDurationValid
      ? new Date(now + durationValue * 60000)
      : null;
  const expectedEndLabel = expectedEndAt
    ? `${
        expectedEndAt.toDateString() === new Date(now).toDateString()
          ? ''
          : 'พรุ่งนี้ '
      }${expectedEndAt.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : null;
  const estimatedTotal =
    billingMode === 'FIXED_DURATION' && fixedDurationValid
      ? hourlyTotal * (durationValue / 60)
      : null;
  const openBlockReason = shift.loading
    ? 'กำลังตรวจสอบสถานะกะ...'
    : shift.error
    ? 'ตรวจสอบสถานะกะไม่สำเร็จ กรุณาลองใหม่'
    : !shift.isOpen
    ? 'ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนเริ่มจับเวลา'
    : activeRates.length === 0
    ? 'ยังไม่มีอัตราค่าเล่นที่เปิดใช้ กรุณาตั้งค่าจาก Admin ก่อน'
    : participants.length === 0
    ? 'เพิ่มผู้เล่นอย่างน้อย 1 คนก่อนเริ่มจับเวลา'
    : billingMode === 'FIXED_DURATION' && !fixedDurationValid
    ? 'ระบุเวลาที่ซื้อระหว่าง 1–1,440 นาที'
    : billingMode === 'FIXED_DURATION' && !alertValid
    ? 'ระบุเวลาแจ้งเตือนระหว่าง 0–120 นาที'
    : null;
  const wideOpenPanel = supportsTabletLayout(windowWidth, windowHeight, 760);

  const submitOpenSession = () => {
    if (!openingTable || openBlockReason) return;
    const operationName = seatingQueueEntry
      ? `waitlist-seat-${seatingQueueEntry.id}`
      : `open-${openingTable.id}`;
    run(operationName, async () => {
      const variables = {
        input: {
          ...inputCredentials,
          idempotencyKey: retryKey(operationName),
          tableId: openingTable.id,
          billingMode,
          expectedDurationMinutes:
            billingMode === 'FIXED_DURATION' ? durationValue : null,
          alertBeforeMinutes: alertValue,
          note: sessionNote.trim() || null,
          participants: participants.map(item => ({
            rateId: item.rateId,
            customerId: item.customerId,
            displayName: item.displayName || null,
            participantType: item.participantType,
            billingGroupNo: item.billingGroupNo,
          })),
        },
      };
      let id = '';
      if (seatingQueueEntry) {
        const response = await seatWaitlistEntry({
            variables: {
              input: { ...variables.input, entryId: seatingQueueEntry.id },
            },
          });
        const result = response.data?.bmsPosSeatBoardGameWaitlistEntry.session;
        id = result?.id ?? result?.sessionId ?? '';
      } else {
        const response = await openSession({ variables });
        const result = response.data?.bmsPosOpenBoardGameSession;
        id = result?.id ?? result?.sessionId ?? '';
      }
      if (!id) throw new Error('เปิดโต๊ะไม่สำเร็จ');
      navigation.replace('BoardGameDetail', { sessionId: id });
    }).catch(() => undefined);
  };

  if (view.kind === 'floor') {
    return (
      <BoardGameFloor
        data={data}
        loading={workspace.loading}
        errorMessage={workspace.error?.message}
        branchName={session?.branch.name ?? '-'}
        now={now}
        onRetry={() => {
          workspace.refetch().catch(() => undefined);
        }}
        onOpen={beginOpen}
        onOpenSession={sessionId =>
          navigation.push('BoardGameDetail', { sessionId })
        }
        onNavigateTab={tab => navigation.navigate('Tabs', { screen: tab })}
      />
    );
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={
          view.kind === 'open'
            ? openingTable
              ? seatingQueueEntry
                ? `พาคิว ${seatingQueueEntry.queueNo} ไปโต๊ะ ${openingTable.code}`
                : `เปิดโต๊ะ ${openingTable.code}`
              : 'เปิดโต๊ะ'
            : 'รายละเอียดโต๊ะ'
        }
        subtitle={`${session?.branch.name ?? '-'} · โต๊ะ เวลา ผู้เล่น และเกม`}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        {workspace.loading && !data ? (
          <Card>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              กำลังโหลดผังโต๊ะ...
            </Text>
          </Card>
        ) : null}
        {workspace.error && !data ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              โหลดข้อมูล Board Game ไม่สำเร็จ
            </Text>
            <Button
              label="ลองใหม่"
              variant="secondary"
              onPress={() => workspace.refetch()}
            />
          </Card>
        ) : null}
        {selectedSessionId && !selectedSession && sessionQuery.loading ? (
          <Card>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              กำลังโหลดรายละเอียดโต๊ะ...
            </Text>
          </Card>
        ) : null}
        {selectedSessionId && !selectedSession && sessionQuery.error ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              เปิดรายละเอียดโต๊ะไม่สำเร็จ
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {sessionQuery.error.message}
            </Text>
            <Button
              label="ลองใหม่"
              variant="primary"
              onPress={() => sessionQuery.refetch()}
            />
          </Card>
        ) : null}
        {openingTable ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  เปิดโต๊ะ {openingTable.code} · {openingTable.name}
                </Text>
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  {openingTable.seats} ที่นั่ง · ตั้งเวลา เพิ่มผู้เล่น
                  และตรวจสรุปก่อนเริ่ม
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.openPanel,
                wideOpenPanel ? styles.openPanelWide : null,
              ]}
            >
              <View style={styles.openForm}>
                <View style={styles.sectionHeading}>
                  <View
                    style={[
                      styles.stepBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.primaryText },
                      ]}
                    >
                      1
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      เวลา
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textSoft }]}
                    >
                      เลือกว่าจะคิดค่าเล่นของโต๊ะนี้แบบไหน
                    </Text>
                  </View>
                </View>

                <View style={styles.wrap}>
                  <Button
                    label="คิดตามเวลาจริง"
                    accessibilityLabel="คิดตามเวลาจริง เริ่มจับเวลาเลยและคิดเงินตอนปิดโต๊ะ"
                    variant={
                      billingMode === 'OPEN_ENDED' ? 'primary' : 'secondary'
                    }
                    onPress={() => setBillingMode('OPEN_ENDED')}
                  />
                  <Button
                    label="ซื้อเวลาไว้ก่อน"
                    accessibilityLabel="ซื้อเวลาไว้ก่อน ระบบเตือนก่อนหมดเวลา"
                    variant={
                      billingMode === 'FIXED_DURATION' ? 'primary' : 'secondary'
                    }
                    onPress={() => setBillingMode('FIXED_DURATION')}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {billingMode === 'OPEN_ENDED'
                    ? 'เริ่มจับเวลาเลย แล้วคิดเงินตามเวลาจริงตอนปิดบิล'
                    : 'กำหนดเวลาที่ซื้อไว้ ระบบจะแจ้งเตือนพนักงานก่อนหมดเวลา'}
                </Text>

                {billingMode === 'FIXED_DURATION' ? (
                  <>
                    <View style={styles.fieldBlock}>
                      <Text
                        style={[typography.bodyStrong, { color: colors.text }]}
                      >
                        เวลาที่ซื้อ
                      </Text>
                      <View style={styles.wrap}>
                        {DURATION_PRESETS.map(minutes => (
                          <Button
                            key={minutes}
                            label={durationLabel(minutes)}
                            variant={
                              durationValue === minutes
                                ? 'primary'
                                : 'secondary'
                            }
                            onPress={() => setDurationMinutes(String(minutes))}
                          />
                        ))}
                        <Button
                          label="กำหนดเอง"
                          variant={
                            DURATION_PRESETS.includes(
                              durationValue as (typeof DURATION_PRESETS)[number],
                            )
                              ? 'secondary'
                              : 'primary'
                          }
                          onPress={() => {
                            if (
                              DURATION_PRESETS.includes(
                                durationValue as (typeof DURATION_PRESETS)[number],
                              )
                            )
                              setDurationMinutes('');
                          }}
                        />
                      </View>
                      {!DURATION_PRESETS.includes(
                        durationValue as (typeof DURATION_PRESETS)[number],
                      ) ? (
                        <View style={styles.fieldBlock}>
                          <Text
                            style={[
                              typography.captionStrong,
                              { color: colors.text },
                            ]}
                          >
                            จำนวนนาที
                          </Text>
                          <TextInput
                            accessibilityLabel="จำนวนนาทีที่ซื้อ"
                            value={durationMinutes}
                            onChangeText={setDurationMinutes}
                            placeholder="เช่น 150"
                            placeholderTextColor={colors.textSoft}
                            keyboardType="number-pad"
                            style={inputStyle}
                          />
                        </View>
                      ) : null}
                      {expectedEndLabel ? (
                        <Text
                          style={[
                            typography.captionStrong,
                            { color: colors.success },
                          ]}
                        >
                          เริ่มตอนนี้ → หมดเวลาประมาณ {expectedEndLabel} น.
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text
                        style={[typography.bodyStrong, { color: colors.text }]}
                      >
                        เตือนก่อนหมดเวลา
                      </Text>
                      <Text
                        style={[typography.caption, { color: colors.textSoft }]}
                      >
                        ผังโต๊ะจะแจ้งเตือนพนักงานตามเวลาที่เลือก
                      </Text>
                      <View style={styles.wrap}>
                        {ALERT_PRESETS.map(minutes => (
                          <Button
                            key={minutes}
                            label={`${minutes} นาที`}
                            variant={
                              alertValue === minutes ? 'primary' : 'secondary'
                            }
                            onPress={() =>
                              setAlertBeforeMinutes(String(minutes))
                            }
                          />
                        ))}
                        <Button
                          label="กำหนดเอง"
                          variant={
                            ALERT_PRESETS.includes(
                              alertValue as (typeof ALERT_PRESETS)[number],
                            )
                              ? 'secondary'
                              : 'primary'
                          }
                          onPress={() => {
                            if (
                              ALERT_PRESETS.includes(
                                alertValue as (typeof ALERT_PRESETS)[number],
                              )
                            )
                              setAlertBeforeMinutes('');
                          }}
                        />
                      </View>
                      {!ALERT_PRESETS.includes(
                        alertValue as (typeof ALERT_PRESETS)[number],
                      ) ? (
                        <TextInput
                          accessibilityLabel="แจ้งเตือนล่วงหน้ากี่นาที"
                          value={alertBeforeMinutes}
                          onChangeText={setAlertBeforeMinutes}
                          placeholder="0–120 นาที"
                          placeholderTextColor={colors.textSoft}
                          keyboardType="number-pad"
                          style={inputStyle}
                        />
                      ) : null}
                    </View>
                  </>
                ) : null}

                <View style={styles.divider} />
                <View style={styles.sectionHeading}>
                  <View
                    style={[
                      styles.stepBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.primaryText },
                      ]}
                    >
                      2
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      ใครเล่นบ้าง
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textSoft }]}
                    >
                      ค่าเล่นคิดเป็นรายคน เลือกอัตราแล้วเพิ่มลงโต๊ะ
                    </Text>
                  </View>
                </View>

                <View style={styles.fieldBlock}>
                  <Text
                    style={[typography.captionStrong, { color: colors.text }]}
                  >
                    อัตราค่าเล่น
                  </Text>
                  <View style={styles.wrap}>
                    {activeRates.map(rate => (
                      <Button
                        key={rate.id}
                        label={rateLabel(rate.name, rate.pricePerHour)}
                        variant={
                          participantRateId === rate.id
                            ? 'primary'
                            : 'secondary'
                        }
                        onPress={() => setParticipantRateId(rate.id)}
                      />
                    ))}
                  </View>
                  {activeRates.length === 0 ? (
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.danger },
                      ]}
                    >
                      ยังไม่มีอัตราค่าบริการที่เปิดใช้ กรุณาตั้งค่าจาก Admin
                    </Text>
                  ) : null}
                </View>

                <View style={styles.fieldBlock}>
                  <Text
                    style={[typography.captionStrong, { color: colors.text }]}
                  >
                    ค้นสมาชิก (ไม่บังคับ)
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textSoft }]}
                  >
                    พิมพ์อย่างน้อย 3 ตัว
                    เลือกสมาชิกแล้วระบบจะใช้อัตราสมาชิกให้อัตโนมัติ
                  </Text>
                  <TextInput
                    accessibilityLabel="ค้นหาสมาชิกด้วยชื่อ เลขสมาชิก หรือเบอร์โทร"
                    value={memberSearch}
                    onChangeText={value => {
                      setMemberSearch(value);
                      setSelectedMember(null);
                    }}
                    placeholder="ชื่อ เลขสมาชิก หรือเบอร์โทร"
                    placeholderTextColor={colors.textSoft}
                    style={inputStyle}
                  />
                  {memberSearch.trim().length >= 3 && !selectedMember ? (
                    <View style={styles.wrap}>
                      {(members.data?.bmsPosMemberSearch.members ?? [])
                        .slice(0, 5)
                        .map(member => (
                          <Button
                            key={member.customerId}
                            label={`${member.name}${
                              member.memberNo ? ` · ${member.memberNo}` : ''
                            }`}
                            variant="secondary"
                            onPress={() => chooseMember(member)}
                          />
                        ))}
                    </View>
                  ) : null}
                  {selectedMember ? (
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.success },
                      ]}
                    >
                      เลือกแล้ว: {selectedMember.name}
                      {selectedMember.memberNo
                        ? ` · ${selectedMember.memberNo}`
                        : ''}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.fieldBlock}>
                  <Text
                    style={[typography.captionStrong, { color: colors.text }]}
                  >
                    ชื่อเรียก (ไม่บังคับ)
                  </Text>
                  <TextInput
                    accessibilityLabel="ชื่อเรียกผู้เล่น"
                    value={participantName}
                    onChangeText={setParticipantName}
                    placeholder="เช่น พี่นก"
                    placeholderTextColor={colors.textSoft}
                    style={inputStyle}
                  />
                </View>

                <View style={styles.fieldBlock}>
                  <Text
                    style={[typography.captionStrong, { color: colors.text }]}
                  >
                    จำนวนคน
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textSoft }]}
                  >
                    เพิ่มหลายคนพร้อมกันได้เมื่อไม่ได้เลือกสมาชิก
                  </Text>
                  <View style={styles.quantityControl}>
                    <Button
                      label="−"
                      accessibilityLabel="ลดจำนวนคน"
                      variant="secondary"
                      disabled={
                        Boolean(selectedMember) || participantCount <= 1
                      }
                      onPress={() =>
                        setParticipantCount(count => Math.max(1, count - 1))
                      }
                    />
                    <Text
                      accessibilityLabel={`จำนวน ${participantCount} คน`}
                      style={[
                        typography.subtitle,
                        styles.quantityValue,
                        { color: colors.text },
                      ]}
                    >
                      {participantCount}
                    </Text>
                    <Button
                      label="+"
                      accessibilityLabel="เพิ่มจำนวนคน"
                      variant="secondary"
                      disabled={
                        Boolean(selectedMember) || participantCount >= 20
                      }
                      onPress={() =>
                        setParticipantCount(count => Math.min(20, count + 1))
                      }
                    />
                  </View>
                </View>

                <View style={styles.fieldBlock}>
                  <Text
                    style={[typography.captionStrong, { color: colors.text }]}
                  >
                    ใส่ไว้บิลไหน
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textSoft }]}
                  >
                    คนที่จ่ายด้วยกันให้อยู่บิลเดียวกัน ถ้าแยกจ่ายให้เปิดบิลใหม่
                  </Text>
                  <View style={styles.wrap}>
                    {draftBillingGroups.map(([group, count]) => (
                      <Button
                        key={group}
                        label={`บิล ${group} · ${count} คน`}
                        variant={
                          selectedBillingGroup === group
                            ? 'primary'
                            : 'secondary'
                        }
                        onPress={() => setParticipantGroup(String(group))}
                      />
                    ))}
                    {nextBillingGroup <= 20 && participants.length > 0 ? (
                      <Button
                        label="เปิดบิลใหม่"
                        variant="secondary"
                        onPress={() =>
                          setParticipantGroup(String(nextBillingGroup))
                        }
                      />
                    ) : null}
                  </View>
                </View>

                <Button
                  label={
                    participantCount > 1 && !selectedMember
                      ? `เพิ่ม ${participantCount} คนลงโต๊ะ`
                      : 'เพิ่มลงโต๊ะ'
                  }
                  variant="secondary"
                  disabled={!participantRateId}
                  onPress={addDraftParticipant}
                />

                {participants.length > 0 ? (
                  <View style={styles.participantList}>
                    {participants.map((participant, index) => {
                      const rate = activeRates.find(
                        item => item.id === participant.rateId,
                      );
                      return (
                        <View
                          key={participant.key}
                          style={[
                            styles.participantRow,
                            { borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.flex}>
                            <Text
                              style={[
                                typography.bodyStrong,
                                { color: colors.text },
                              ]}
                            >
                              {participant.displayName ||
                                `ผู้เล่น ${index + 1}`}
                              {participant.memberNo
                                ? ` · ${participant.memberNo}`
                                : ''}
                            </Text>
                            <Text
                              style={[
                                typography.caption,
                                { color: colors.textMuted },
                              ]}
                            >
                              {rate
                                ? rateLabel(rate.name, rate.pricePerHour)
                                : '-'}{' '}
                              · บิล {participant.billingGroupNo}
                            </Text>
                          </View>
                          <Button
                            label="ลบ"
                            variant="ghost"
                            onPress={() =>
                              setParticipants(rows =>
                                rows.filter(
                                  item => item.key !== participant.key,
                                ),
                              )
                            }
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                <View style={styles.divider} />
                <View style={styles.sectionHeading}>
                  <View
                    style={[
                      styles.stepBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.primaryText },
                      ]}
                    >
                      3
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      หมายเหตุ
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textSoft }]}
                    >
                      ไม่บังคับ ใช้บอกข้อมูลที่พนักงานคนอื่นควรรู้
                    </Text>
                  </View>
                </View>
                <TextInput
                  accessibilityLabel="หมายเหตุโต๊ะ"
                  value={sessionNote}
                  onChangeText={setSessionNote}
                  placeholder="เช่น จองไว้ถึง 21:00 หรือขอโต๊ะเงียบ ๆ"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
              </View>

              <View
                style={[
                  styles.openSummary,
                  wideOpenPanel ? styles.openSummaryWide : null,
                  {
                    backgroundColor: colors.surface2,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  สรุปก่อนเริ่ม
                </Text>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {openingTable.code} · {openingTable.name}
                </Text>
                <View style={styles.summaryRows}>
                  <View style={styles.between}>
                    <Text
                      style={[typography.caption, { color: colors.textMuted }]}
                    >
                      เวลา
                    </Text>
                    <Text
                      style={[typography.captionStrong, { color: colors.text }]}
                    >
                      {billingMode === 'FIXED_DURATION' && fixedDurationValid
                        ? `ซื้อไว้ ${durationLabel(durationValue)}`
                        : billingMode === 'FIXED_DURATION'
                        ? 'ยังไม่ได้ระบุเวลา'
                        : 'คิดตามเวลาจริง'}
                    </Text>
                  </View>
                  {expectedEndLabel ? (
                    <View style={styles.between}>
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.textMuted },
                        ]}
                      >
                        หมดเวลาประมาณ
                      </Text>
                      <Text
                        style={[
                          typography.captionStrong,
                          { color: colors.text },
                        ]}
                      >
                        {expectedEndLabel} น.
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.between}>
                    <Text
                      style={[typography.caption, { color: colors.textMuted }]}
                    >
                      ผู้เล่น
                    </Text>
                    <Text
                      style={[typography.captionStrong, { color: colors.text }]}
                    >
                      {participants.length} คน ·{' '}
                      {
                        draftBillingGroups.filter(([, count]) => count > 0)
                          .length
                      }{' '}
                      บิล
                    </Text>
                  </View>
                </View>

                {participants.length > 0 ? (
                  <View style={styles.summaryParticipants}>
                    {participants.map((participant, index) => {
                      const rate = activeRates.find(
                        item => item.id === participant.rateId,
                      );
                      return (
                        <Text
                          key={participant.key}
                          style={[
                            typography.caption,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {participant.displayName || `ผู้เล่น ${index + 1}`} ·{' '}
                          {rate?.name ?? '-'} · บิล {participant.billingGroupNo}
                        </Text>
                      );
                    })}
                  </View>
                ) : (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ยังไม่มีผู้เล่นในโต๊ะนี้
                  </Text>
                )}

                <View
                  style={[styles.summaryTotal, { borderColor: colors.border }]}
                >
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ค่าเล่นรวม
                  </Text>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ฿{bahtLabel(hourlyTotal)} / ชม.
                  </Text>
                  {estimatedTotal != null && participants.length > 0 ? (
                    <Text
                      style={[typography.caption, { color: colors.textMuted }]}
                    >
                      {durationLabel(durationValue)} ≈ ฿
                      {bahtLabel(estimatedTotal)} · ยังไม่รวมของที่สั่งเข้าโต๊ะ
                    </Text>
                  ) : null}
                </View>

                <View
                  style={[
                    styles.readinessBox,
                    {
                      backgroundColor: openBlockReason
                        ? colors.warningBg
                        : colors.successBg,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.captionStrong,
                      {
                        color: openBlockReason
                          ? colors.warning
                          : colors.success,
                      },
                    ]}
                  >
                    {openBlockReason ?? 'ครบแล้ว พร้อมเริ่มจับเวลา'}
                  </Text>
                </View>
                <Button
                  label="เริ่มจับเวลา"
                  accessibilityLabel={
                    openBlockReason
                      ? `ยังเริ่มจับเวลาไม่ได้: ${openBlockReason}`
                      : 'เริ่มจับเวลา นาฬิกาจะเริ่มเดินทันที'
                  }
                  fullWidth
                  loading={working === `open-${openingTable.id}`}
                  disabled={Boolean(openBlockReason)}
                  onPress={submitOpenSession}
                />
                {!shift.loading && !shift.error && !shift.isOpen ? (
                  <Button
                    label="ไปเปิดกะ"
                    variant="secondary"
                    fullWidth
                    onPress={() =>
                      navigation.navigate('Tabs', { screen: 'ShiftTab' })
                    }
                  />
                ) : null}
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  กดแล้วนาฬิกาจะเริ่มเดินทันที
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {selectedSession ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  {selectedTable?.code ?? ''} ·{' '}
                  {selectedTable?.name ?? 'โต๊ะบอร์ดเกม'}
                </Text>
                <Text
                  style={[
                    typography.captionStrong,
                    {
                      color: ['OVERDUE', 'ENDING_SOON'].includes(
                        selectedSession.alertStatus,
                      )
                        ? colors.warning
                        : colors.success,
                    },
                  ]}
                >
                  {alertLabel(
                    selectedSession.status === 'CLOSING'
                      ? 'CLOSING'
                      : selectedSession.alertStatus,
                  )}{' '}
                  · {elapsedLabel(selectedSession.startedAt, now)}
                </Text>
              </View>
              {selectedSession.status === 'OPEN' ? (
                <Button
                  label="QR เรียกพนักงาน"
                  variant="secondary"
                  loading={issuingGuestAccess}
                  onPress={() => {
                    if (!credentials) return;
                    issueGuestAccess({
                      variables: {
                        input: {
                          ...credentials,
                          idempotencyKey: retryKey(
                            `guest-access-${selectedSession.id}`,
                          ),
                          sessionId: selectedSession.id,
                        },
                      },
                    })
                      .then(response => {
                        const access =
                          response.data?.bmsPosIssueBoardGameGuestAccess;
                        if (!access) throw new Error('สร้าง QR ไม่สำเร็จ');
                        setGuestAccess(access);
                      })
                      .catch(cause =>
                        Alert.alert(
                          'สร้าง QR ไม่สำเร็จ',
                          cause instanceof Error
                            ? cause.message
                            : 'กรุณาลองใหม่',
                        ),
                      );
                  }}
                />
              ) : null}
            </View>
            {selectedSession.expectedEndAt ? (
              <Text style={[typography.body, { color: colors.text }]}>
                หมดเวลา{' '}
                {new Date(selectedSession.expectedEndAt).toLocaleTimeString(
                  'th-TH',
                  { hour: '2-digit', minute: '2-digit' },
                )}{' '}
                · เตือนก่อน {selectedSession.alertBeforeMinutes} นาที
              </Text>
            ) : null}
            {seatingSessionIds.length > 1 ? (
              <>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  ชุดลูกค้าที่นั่งร่วมโต๊ะนี้
                </Text>
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  แต่ละชุดมีเวลา ผู้เล่น เกม และบิลของตัวเอง
                  เลือกชุดก่อนทำรายการ
                </Text>
                <ScrollView
                  horizontal
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={styles.horizontalList}
                >
                  {seatingSessionIds.map((id, index) => (
                    <Button
                      key={id}
                      label={`ชุด ${index + 1}${
                        id === selectedSession.id ? ' · กำลังดู' : ''
                      }`}
                      variant={
                        id === selectedSession.id ? 'primary' : 'secondary'
                      }
                      onPress={() =>
                        navigation.replace('BoardGameDetail', {
                          sessionId: id,
                        })
                      }
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ย้าย / รวมโต๊ะ
            </Text>
            <Text style={[typography.caption, { color: colors.textSoft }]}>
              {sharedSeating
                ? 'โต๊ะนี้มีหลายชุดนั่งร่วมกัน — ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดนี้ออกไป ส่วนรวมโต๊ะจะพาไปทั้งโต๊ะ'
                : 'เวลา บิล ของบน tab และเกมที่ยืมยังเป็นของเดิมทุกใบ เปลี่ยนแค่ว่านั่งโต๊ะไหน'}
            </Text>
            <ScrollView
              horizontal
              // ค่าปริยายของ RN คือ flexGrow: 1 — แถบชิปต้องประกาศเอง ไม่ใช่รอดเพราะพ่อบังเอิญไม่มีความสูงแน่นอน
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.horizontalList}
            >
              {relocateTargets.map(target => {
                const merging = Boolean(target.openSession);
                const busyKey = `seating-${target.id}`;
                return (
                  <Button
                    key={target.id}
                    label={`${target.code} · ${
                      merging
                        ? 'รวมโต๊ะ'
                        : sharedSeating
                        ? 'แยกมาที่นี่'
                        : 'ย้ายมาที่นี่'
                    }`}
                    variant="secondary"
                    loading={working === busyKey}
                    onPress={() =>
                      Alert.alert(
                        merging
                          ? `รวมกับโต๊ะ ${target.code}`
                          : `ย้ายไปโต๊ะ ${target.code}`,
                        merging
                          ? 'ทุกชุดที่โต๊ะนี้จะไปนั่งรวมกับโต๊ะปลายทาง โดยบิลและเวลาของแต่ละชุดยังแยกเดิม'
                          : sharedSeating
                          ? 'เฉพาะชุดที่กำลังดูอยู่จะย้ายไปโต๊ะนั้น ชุดอื่นยังอยู่โต๊ะเดิม'
                          : 'ทั้งโต๊ะจะย้ายไปโต๊ะนั้น โดยบิลและเวลายังเป็นของเดิม',
                        [
                          { text: 'กลับ' },
                          {
                            text: 'ยืนยัน',
                            onPress: () => {
                              run(busyKey, async () => {
                                const relocate = merging
                                  ? mergeSeating
                                  : moveSeating;
                                await relocate({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      idempotencyKey: retryKey(busyKey),
                                      sessionId: selectedSession.id,
                                      targetTableId: target.id,
                                    },
                                  },
                                });
                              });
                            },
                          },
                        ],
                      )
                    }
                  />
                );
              })}
            </ScrollView>
            {relocateTargets.length === 0 ? (
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                สาขานี้ไม่มีโต๊ะอื่นให้ย้ายไป
              </Text>
            ) : null}
            {selectedSession.status === 'CLOSING' ? (
              <>
                <Text style={[typography.numeric, { color: colors.text }]}>
                  ฿{selectedSession.amountDue.toFixed(2)}
                </Text>
                {selectedSession.billingGroups
                  .filter(group => group.status === 'CLOSING')
                  .map(group => (
                    <Button
                      key={group.id}
                      label={`ไปชำระกลุ่ม ${group.groupNo} · ฿${(
                        group.amountDue + group.tabAmount
                      ).toFixed(2)}`}
                      fullWidth
                      onPress={() => openBillingGroupCheckout(group.id)}
                    />
                  ))}
              </>
            ) : (
              <>
                {selectedSession.billingGroups.length > 1 ? (
                  <>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      กลุ่มบิล
                    </Text>
                    {selectedSession.billingGroups.map(group => (
                      <View key={group.id} style={styles.between}>
                        <Text
                          style={[
                            typography.body,
                            { color: colors.text, flex: 1 },
                          ]}
                        >
                          กลุ่ม {group.groupNo} ·{' '}
                          {group.status === 'OPEN'
                            ? 'กำลังเล่น'
                            : group.status === 'CLOSING'
                            ? 'รอชำระ'
                            : 'ชำระแล้ว'}
                          {' · '}฿
                          {(group.amountDue + group.tabAmount).toFixed(2)}
                        </Text>
                        {group.status === 'OPEN' ? (
                          <Button
                            label="ปิดบิล/เก็บเงิน"
                            variant="secondary"
                            loading={working === `close-group-${group.id}`}
                            onPress={() =>
                              Alert.alert(
                                `ปิดบิลกลุ่ม ${group.groupNo}`,
                                'ค่าเวลาของกลุ่มนี้จะหยุดตรงนี้ ส่วนกลุ่มอื่นยังเล่นต่อ',
                                [
                                  { text: 'กลับ' },
                                  {
                                    text: 'ยืนยัน',
                                    onPress: () => {
                                      run(
                                        `close-group-${group.id}`,
                                        async () => {
                                          const response =
                                            await closeBillingGroup({
                                              variables: {
                                                input: {
                                                  ...inputCredentials,
                                                  idempotencyKey: retryKey(
                                                    `close-group-${group.id}`,
                                                  ),
                                                  billingGroupId: group.id,
                                                },
                                              },
                                            });
                                          const closed =
                                            response.data
                                              ?.bmsPosCloseBoardGameBillingGroup
                                              .groups[0];
                                          if (!closed?.id)
                                            throw new Error('ปิดบิลไม่สำเร็จ');
                                          openBillingGroupCheckout(closed.id);
                                        },
                                      );
                                    },
                                  },
                                ],
                              )
                            }
                          />
                        ) : group.status === 'CLOSING' ? (
                          <Button
                            label="ไปชำระ"
                            onPress={() => openBillingGroupCheckout(group.id)}
                          />
                        ) : null}
                      </View>
                    ))}
                  </>
                ) : null}
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  ของที่สั่งเข้าบิล
                </Text>
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  ของที่ส่งให้ลูกค้าแล้วจะถูกจองสต็อกทันที
                  และรวมกับค่าเวลาเมื่อชำระ
                </Text>
                {selectedSession.billingGroups.map(group => {
                  const draft = tabDrafts[group.id] ?? { sku: '', qty: '1' };
                  return (
                    <View key={`tab-${group.id}`} style={{ gap: spacing.sm }}>
                      {selectedSession.billingGroups.length > 1 ? (
                        <Text
                          style={[
                            typography.captionStrong,
                            { color: colors.text },
                          ]}
                        >
                          กลุ่ม {group.groupNo} · ของบนบิล ฿
                          {group.tabAmount.toFixed(2)}
                        </Text>
                      ) : null}
                      {group.tabItems.length === 0 ? (
                        <Text
                          style={[
                            typography.caption,
                            { color: colors.textMuted },
                          ]}
                        >
                          ยังไม่มีสินค้าในบิลนี้
                        </Text>
                      ) : null}
                      {group.tabItems.map(item => (
                        <View key={item.id} style={styles.between}>
                          <Text
                            style={[
                              typography.body,
                              { color: colors.text, flex: 1 },
                            ]}
                          >
                            {item.productName} × {item.packQty}
                            {item.unitName ? ` ${item.unitName}` : ''}
                            {item.modifierNames.length
                              ? ` · ${item.modifierNames.join(', ')}`
                              : ''}
                          </Text>
                          {group.status === 'OPEN' ? (
                            <Button
                              label="เอาออก"
                              variant="danger"
                              loading={working === `tab-remove-${item.id}`}
                              onPress={() =>
                                run(`tab-remove-${item.id}`, async () => {
                                  await removeTabItem({
                                    variables: {
                                      input: {
                                        ...inputCredentials,
                                        idempotencyKey: retryKey(
                                          `tab-remove-${item.id}`,
                                        ),
                                        billingGroupId: group.id,
                                        itemId: item.id,
                                        reason: null,
                                      },
                                    },
                                  });
                                })
                              }
                            />
                          ) : null}
                        </View>
                      ))}
                      {group.status === 'OPEN' ? (
                        <View style={styles.row}>
                          <TextInput
                            value={draft.sku}
                            onChangeText={sku =>
                              setTabDrafts(previous => ({
                                ...previous,
                                [group.id]: { ...draft, sku },
                              }))
                            }
                            placeholder="บาร์โค้ด / SKU"
                            placeholderTextColor={colors.textSoft}
                            autoCapitalize="characters"
                            style={[inputStyle, styles.flex]}
                          />
                          <TextInput
                            value={draft.qty}
                            onChangeText={qty =>
                              setTabDrafts(previous => ({
                                ...previous,
                                [group.id]: { ...draft, qty },
                              }))
                            }
                            placeholder="จำนวน"
                            placeholderTextColor={colors.textSoft}
                            keyboardType="number-pad"
                            style={[inputStyle, styles.groupInput]}
                          />
                          <Button
                            label="เพิ่มเข้าบิล"
                            disabled={!draft.sku.trim()}
                            loading={working === `tab-add-${group.id}`}
                            onPress={() => {
                              const qty = Number(draft.qty);
                              if (
                                !Number.isInteger(qty) ||
                                qty < 1 ||
                                qty > 9999
                              ) {
                                Alert.alert(
                                  'จำนวนไม่ถูกต้อง',
                                  'ระบุจำนวนเต็มตั้งแต่ 1 ถึง 9,999',
                                );
                                return;
                              }
                              run(`tab-add-${group.id}`, async () => {
                                await addTabItem({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      idempotencyKey: retryKey(
                                        `tab-add-${group.id}`,
                                      ),
                                      billingGroupId: group.id,
                                      sku: draft.sku.trim(),
                                      size: null,
                                      packCode: null,
                                      packQty: qty,
                                      modifierCodes: [],
                                      note: null,
                                    },
                                  },
                                });
                                setTabDrafts(previous => ({
                                  ...previous,
                                  [group.id]: { sku: '', qty: '1' },
                                }));
                              });
                            }}
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  ผู้เล่น
                </Text>
                {selectedSession.participants.map((participant, index) => (
                  <View key={participant.id} style={styles.between}>
                    <Text
                      style={[
                        typography.body,
                        {
                          color: participant.leftAt
                            ? colors.textMuted
                            : colors.text,
                          flex: 1,
                        },
                      ]}
                    >
                      {participant.displayName || `ผู้เล่น ${index + 1}`} ·{' '}
                      {participant.participantType ?? '-'} · ฿
                      {(participant.hourlyRate ?? 0).toFixed(2)}/ชม. · บิล{' '}
                      {participant.billingGroupNo ?? 1}
                      {participant.leftAt ? ' · ออกแล้ว' : ''}
                    </Text>
                    {!participant.leftAt &&
                    participant.billingGroupStatus === 'OPEN' ? (
                      <Button
                        label="ออก"
                        variant="ghost"
                        loading={working === `leave-${participant.id}`}
                        onPress={() =>
                          run(`leave-${participant.id}`, async () => {
                            await leaveParticipant({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  idempotencyKey: retryKey(
                                    `leave-${participant.id}`,
                                  ),
                                  sessionId: selectedSession.id,
                                  participantId: participant.id,
                                },
                              },
                            });
                          })
                        }
                      />
                    ) : null}
                  </View>
                ))}
                <View style={styles.wrap}>
                  {activeRates.map(rate => (
                    <Button
                      key={rate.id}
                      label={rate.name}
                      variant={
                        participantRateId === rate.id ? 'primary' : 'secondary'
                      }
                      onPress={() => setParticipantRateId(rate.id)}
                    />
                  ))}
                </View>
                <TextInput
                  value={memberSearch}
                  onChangeText={value => {
                    setMemberSearch(value);
                    setSelectedMember(null);
                  }}
                  placeholder="ค้นหาสมาชิกด้วยชื่อ เลขสมาชิก หรือเบอร์โทร"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                {memberSearch.trim().length >= 3 && !selectedMember ? (
                  <View style={styles.wrap}>
                    {(members.data?.bmsPosMemberSearch.members ?? [])
                      .slice(0, 5)
                      .map(member => (
                        <Button
                          key={member.customerId}
                          label={`${member.name}${
                            member.memberNo ? ` · ${member.memberNo}` : ''
                          }`}
                          variant="secondary"
                          onPress={() => chooseMember(member)}
                        />
                      ))}
                  </View>
                ) : null}
                {selectedMember ? (
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.success },
                    ]}
                  >
                    สมาชิกที่เลือก: {selectedMember.name}
                    {selectedMember.memberNo
                      ? ` · ${selectedMember.memberNo}`
                      : ''}
                  </Text>
                ) : null}
                <View style={styles.row}>
                  <TextInput
                    value={participantName}
                    onChangeText={setParticipantName}
                    placeholder="ชื่อผู้เล่นเพิ่ม"
                    placeholderTextColor={colors.textSoft}
                    style={[inputStyle, styles.flex]}
                  />
                  <TextInput
                    value={participantGroup}
                    onChangeText={setParticipantGroup}
                    placeholder="กลุ่ม"
                    placeholderTextColor={colors.textSoft}
                    keyboardType="number-pad"
                    style={[inputStyle, styles.groupInput]}
                  />
                  <Button
                    label="เพิ่ม"
                    disabled={!participantRateId}
                    loading={
                      working === `add-participant-${selectedSession.id}`
                    }
                    onPress={() =>
                      run(`add-participant-${selectedSession.id}`, async () => {
                        const rate = activeRates.find(
                          item => item.id === participantRateId,
                        );
                        if (!rate) throw new Error('เลือกอัตราค่าบริการ');
                        await addParticipant({
                          variables: {
                            input: {
                              ...inputCredentials,
                              idempotencyKey: retryKey(
                                `add-participant-${selectedSession.id}`,
                              ),
                              sessionId: selectedSession.id,
                              rateId: rate.id,
                              customerId: selectedMember?.customerId ?? null,
                              displayName: participantName.trim() || null,
                              participantType: rate.customerType,
                              billingGroupNo: Number(participantGroup),
                            },
                          },
                        });
                        setParticipantName('');
                        setMemberSearch('');
                        setSelectedMember(null);
                      })
                    }
                  />
                </View>

                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  เกมที่ยืม
                </Text>
                {selectedSession.games
                  .filter(game => game.status === 'CHECKED_OUT')
                  .map(game => (
                    <View key={game.id} style={styles.between}>
                      <Text
                        style={[
                          typography.body,
                          { color: colors.text, flex: 1 },
                        ]}
                      >
                        {game.title} · {game.copyCode}
                      </Text>
                      <View style={styles.wrap}>
                        <Button
                          label="คืนปกติ"
                          variant="secondary"
                          loading={working === `return-${game.id}`}
                          onPress={() =>
                            run(`return-${game.id}`, async () => {
                              await returnCopy({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    idempotencyKey: retryKey(
                                      `return-${game.id}`,
                                    ),
                                    loanId: game.id,
                                    status: 'RETURNED',
                                    copyStatus: 'AVAILABLE',
                                    returnNote: returnNote.trim() || null,
                                  },
                                },
                              });
                              setReturnNote('');
                            })
                          }
                        />
                        <Button
                          label="มีปัญหา"
                          variant="danger"
                          onPress={() =>
                            run(`issue-${game.id}`, async () => {
                              await returnCopy({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    idempotencyKey: retryKey(
                                      `issue-${game.id}`,
                                    ),
                                    loanId: game.id,
                                    status: 'ISSUE',
                                    copyStatus: 'NEEDS_CHECK',
                                    returnNote:
                                      returnNote.trim() ||
                                      'พนักงานระบุว่าต้องตรวจกล่อง',
                                  },
                                },
                              });
                              setReturnNote('');
                            })
                          }
                        />
                      </View>
                    </View>
                  ))}
                <TextInput
                  value={returnNote}
                  onChangeText={setReturnNote}
                  placeholder="หมายเหตุสภาพเกมตอนคืน"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                <ScrollView
                  horizontal
                  // ค่าปริยายของ RN คือ flexGrow: 1 — วันนี้อยู่ใน ScrollView แนวตั้งจึงไม่มีที่ให้ขยาย
                  // แต่ประกาศไว้ให้ตรงกับเจตนา ไม่ใช่รอดเพราะบังเอิญ
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={styles.horizontalList}
                >
                  {availableCopies.map(copy => (
                    <Button
                      key={copy.id}
                      label={`${copy.title} · ${copy.copyCode}`}
                      variant="secondary"
                      loading={working === `loan-${copy.id}`}
                      onPress={() =>
                        run(`loan-${copy.id}`, async () => {
                          await checkoutCopy({
                            variables: {
                              input: {
                                ...inputCredentials,
                                idempotencyKey: retryKey(`loan-${copy.id}`),
                                sessionId: selectedSession.id,
                                copyId: copy.id,
                              },
                            },
                          });
                        })
                      }
                    />
                  ))}
                </ScrollView>
                {availableCopies.length === 0 ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ไม่มีกล่องเกมที่พร้อมยืมในสาขานี้
                  </Text>
                ) : null}

                {/* บัตรที่รับไว้ค้ำกล่องเกม (`9.93`)
                    อยู่ติดกับกล่องเกมเพราะเป็นการกระทำเดียวกันที่เคาน์เตอร์: ยื่นกล่อง รับบัตร ·
                    **จอนี้ไม่มีทางอ่านเลขเต็ม** — เครื่องขายเป็นจอที่แชร์กันและหันออกทางลูกค้า
                    การอ่านเลขอยู่หลังบ้านอย่างเดียว (board_game.identity.reveal) */}
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  บัตรที่รับไว้
                </Text>
                {selectedSession.identityHolds.filter(
                  hold => hold.status === 'HELD',
                ).length === 0 ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ไม่ได้ถือบัตรของโต๊ะนี้ไว้
                  </Text>
                ) : null}
                {selectedSession.identityHolds
                  .filter(hold => hold.status === 'HELD')
                  .map(hold => (
                    <View key={hold.id} style={styles.between}>
                      <Text
                        style={[
                          typography.body,
                          { color: colors.text, flex: 1 },
                        ]}
                      >
                        {hold.holderName ?? '-'} ·{' '}
                        {IDENTITY_KIND_LABEL[hold.documentKind] ??
                          hold.documentKind}
                        {hold.documentNumberTail
                          ? ` · ลงท้าย ${hold.documentNumberTail}`
                          : ' · ไม่ได้บันทึกเลข'}
                      </Text>
                      <Button
                        label="คืนบัตร"
                        variant="secondary"
                        loading={working === `id-release-${hold.id}`}
                        onPress={() =>
                          run(`id-release-${hold.id}`, async () => {
                            await releaseIdentityHold({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  idempotencyKey: retryKey(
                                    `id-release-${hold.id}`,
                                  ),
                                  holdId: hold.id,
                                  note: null,
                                },
                              },
                            });
                          })
                        }
                      />
                    </View>
                  ))}
                <ScrollView
                  horizontal
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={styles.horizontalList}
                >
                  {IDENTITY_KIND_ORDER.map(kind => (
                    <Button
                      key={kind}
                      label={IDENTITY_KIND_LABEL[kind]}
                      variant={documentKind === kind ? 'primary' : 'secondary'}
                      onPress={() => setDocumentKind(kind)}
                    />
                  ))}
                </ScrollView>
                <TextInput
                  value={holderName}
                  onChangeText={setHolderName}
                  placeholder="ชื่อบนบัตร"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                {/* เลขไม่บังคับ — ร้านที่เก็บแต่ตัวบัตรจริงก็ยังได้ด่านตอนปิดบิล */}
                <TextInput
                  value={documentNumber}
                  onChangeText={setDocumentNumber}
                  placeholder="เลขบัตร (ไม่บังคับ)"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                <Button
                  label="รับบัตรไว้"
                  variant="secondary"
                  disabled={!holderName.trim()}
                  loading={working === 'identity-hold'}
                  onPress={() =>
                    run('identity-hold', async () => {
                      await takeIdentityHold({
                        variables: {
                          input: {
                            ...inputCredentials,
                            idempotencyKey: retryKey('identity-hold'),
                            sessionId: selectedSession.id,
                            documentKind,
                            holderName: holderName.trim(),
                            documentNumber: documentNumber.trim() || null,
                            // ผูกกับกล่องเกมและสมาชิกทำที่หลังบ้าน — จอเครื่องขายเก็บแค่
                            // สิ่งที่คนหน้าเคาน์เตอร์เห็นอยู่ตรงหน้า
                            loanId: null,
                            customerId: null,
                            note: null,
                          },
                        },
                      });
                      setHolderName('');
                      setDocumentNumber('');
                    })
                  }
                />

                <TextInput
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="เหตุผลยกเลิก session (กรอกเมื่อต้องยกเลิก)"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />

                <View style={styles.wrap}>
                  {selectedSession.billingMode === 'FIXED_DURATION' ? (
                    <Button
                      label="เพิ่มเวลา 30 นาที"
                      variant="secondary"
                      loading={working === `extend-${selectedSession.id}`}
                      onPress={() =>
                        run(`extend-${selectedSession.id}`, async () => {
                          const start = new Date(
                            selectedSession.startedAt,
                          ).getTime();
                          const end = new Date(
                            selectedSession.expectedEndAt ??
                              selectedSession.startedAt,
                          ).getTime();
                          const currentMinutes = Math.max(
                            1,
                            Math.round((end - start) / 60000),
                          );
                          await adjustTiming({
                            variables: {
                              input: {
                                ...inputCredentials,
                                idempotencyKey: retryKey(
                                  `extend-${selectedSession.id}`,
                                ),
                                sessionId: selectedSession.id,
                                billingMode: 'FIXED_DURATION',
                                expectedDurationMinutes: currentMinutes + 30,
                                alertBeforeMinutes:
                                  selectedSession.alertBeforeMinutes,
                              },
                            },
                          });
                        })
                      }
                    />
                  ) : null}
                  <Button
                    label={
                      selectedSession.billingGroups.length > 1
                        ? 'ปิดเวลาทุกกลุ่ม'
                        : 'ปิดเวลา/คิดเงิน'
                    }
                    loading={working === `close-session-${selectedSession.id}`}
                    onPress={() =>
                      Alert.alert(
                        'ปิดเวลาและคิดเงิน',
                        'ระบบจะ freeze ค่าเวลาตามผู้เล่นและอัตราปัจจุบัน หลังจากนี้แก้รายการไม่ได้',
                        [
                          { text: 'กลับ' },
                          {
                            text: 'ยืนยัน',
                            onPress: () => {
                              run(
                                `close-session-${selectedSession.id}`,
                                async () => {
                                  const response = await closeSession({
                                    variables: {
                                      input: {
                                        ...inputCredentials,
                                        idempotencyKey: retryKey(
                                          `close-session-${selectedSession.id}`,
                                        ),
                                        sessionId: selectedSession.id,
                                        reason: null,
                                      },
                                    },
                                  });
                                  const bill =
                                    response.data?.bmsPosCloseBoardGameSession;
                                  if (
                                    !bill?.sessionId ||
                                    bill.groups.length === 0
                                  )
                                    throw new Error('ปิดเวลาไม่สำเร็จ');
                                  if (bill.groups.length === 1) {
                                    openBillingGroupCheckout(bill.groups[0].id);
                                  } else {
                                    Alert.alert(
                                      'ปิดเวลาทุกกลุ่มแล้ว',
                                      `มี ${bill.groups.length} บิลรอชำระ เลือกเก็บทีละกลุ่ม`,
                                    );
                                  }
                                },
                              );
                            },
                          },
                        ],
                      )
                    }
                  />
                  <Button
                    label="ยกเลิก session"
                    variant="danger"
                    disabled={!cancelReason.trim()}
                    onPress={() =>
                      Alert.alert('ยกเลิก session', cancelReason.trim(), [
                        { text: 'กลับ' },
                        {
                          text: 'ยืนยันยกเลิก',
                          style: 'destructive',
                          onPress: () => {
                            run(
                              `cancel-session-${selectedSession.id}`,
                              async () => {
                                await cancelSession({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      idempotencyKey: retryKey(
                                        `cancel-session-${selectedSession.id}`,
                                      ),
                                      sessionId: selectedSession.id,
                                      reason: cancelReason.trim(),
                                    },
                                  },
                                });
                                setCancelReason('');
                                navigation.popToTop();
                              },
                            );
                          },
                        },
                      ])
                    }
                  />
                </View>
              </>
            )}
          </Card>
        ) : null}
      </ScrollView>
      <Modal
        transparent
        visible={Boolean(guestAccess)}
        animationType="fade"
        onRequestClose={() => setGuestAccess(null)}
      >
        <View style={[styles.callOverlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setGuestAccess(null)}
          />
          {guestAccess && deviceTarget ? (
            <View
              style={[
                styles.qrPanel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[typography.title, { color: colors.text }]}>
                QR เรียกพนักงาน
              </Text>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                ให้ลูกค้าที่ {guestAccess.tableName || guestAccess.tableCode}{' '}
                สแกนจากเครื่องของตน
              </Text>
              <View style={styles.qrCanvas}>
                <QRCode
                  value={new URL(
                    `/bg/${guestAccess.token}`,
                    deviceTarget.serverUrl,
                  ).toString()}
                  size={220}
                  backgroundColor="#ffffff"
                  color="#0f172a"
                />
              </View>
              <Button
                label="แชร์ลิงก์"
                fullWidth
                onPress={() => {
                  const url = new URL(
                    `/bg/${guestAccess.token}`,
                    deviceTarget.serverUrl,
                  ).toString();
                  Share.share({ message: url }).catch(() => undefined);
                }}
              />
              <Button
                label="ปิด"
                variant="ghost"
                fullWidth
                onPress={() => setGuestAccess(null)}
              />
            </View>
          ) : null}
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  openPanel: { gap: 16 },
  openPanelWide: { flexDirection: 'row', alignItems: 'flex-start' },
  openForm: { flex: 1, minWidth: 0, gap: 12 },
  openSummary: {
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  openSummaryWide: { width: 292, flexShrink: 0 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fieldBlock: { gap: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#94a3b833' },
  quantityControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quantityValue: { minWidth: 48, textAlign: 'center' },
  participantList: { gap: 6 },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingLeft: 12,
  },
  summaryRows: { gap: 6 },
  summaryParticipants: { gap: 4 },
  summaryTotal: {
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  readinessBox: { borderRadius: 10, padding: 12 },
  groupInput: { width: 76 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  horizontalList: { gap: 8, paddingVertical: 4 },
  floorSummaryRow: { flexDirection: 'row', gap: 8 },
  floorSummaryCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    gap: 4,
  },
  floorSummaryLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryLabelPhone: { fontSize: 11, fontWeight: '700', lineHeight: 15 },
  summaryCountPhone: {
    fontSize: 25,
    fontWeight: '700',
    lineHeight: 29,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statusGlyph: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusGlyphText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  phoneZoneRow: { gap: 8, paddingRight: 16 },
  phoneZoneButton: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabletZoneButton: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  zoneBullet: { width: 8, height: 8, borderRadius: 4 },
  floorTableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  floorTableCard: {
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 7,
  },
  floorTableCardTablet: { minHeight: 208, padding: 16 },
  floorCardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floorStatusBadge: {
    maxWidth: '48%',
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  floorStatusDot: { fontSize: 12, fontWeight: '800', lineHeight: 16 },
  floorCardFooter: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  floorCardFooterTablet: {
    marginTop: 'auto',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  floorPhoneAction: { minWidth: 96, paddingHorizontal: 14 },
  floorTabletShell: { flex: 1, flexDirection: 'row' },
  floorSidebar: {
    width: TABLET_SIDEBAR_WIDTH,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  floorSidebarContent: { padding: 16 },
  floorSidebarZones: { marginTop: 24, gap: 6 },
  sidebarDivider: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  floorLegend: { gap: 12 },
  floorLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  floorTabletMain: { flex: 1 },
  floorTabletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  floorRefresh: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBellGlyph: { fontSize: 23 },
  callBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  tableCallBadge: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableCallBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  callOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  callPanel: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '82%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  qrPanel: {
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 20,
    gap: 14,
    alignItems: 'stretch',
  },
  qrCanvas: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
  },
});
