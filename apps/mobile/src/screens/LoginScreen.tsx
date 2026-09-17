import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { NumericKeypad } from '../components/NumericKeypad';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';
import { useDevice } from '../state/DeviceContext';
import { useSession } from '../state/SessionContext';
import { displayHost } from '../lib/pairing';
import {
  isPosPinLengthValid,
  POS_PIN_MAX_LENGTH,
  visiblePosPinSlots,
} from '../lib/posPin';
import {
  PosBootstrapDocument,
  VerifyPosCashierDocument,
} from '../graphql/generated';
import type {
  PosSessionBranch,
  PosSessionCashier,
} from '../state/SessionContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { status: pairStatus, verify } = useDevice();
  const { signIn } = useSession();
  const { data, loading, error, refetch } = useQuery(PosBootstrapDocument, {
    skip: pairStatus !== 'PAIRED' || verify.kind === 'REJECTED',
    notifyOnNetworkStatusChange: true,
  });
  const [verifyCashier, { loading: verifying }] = useMutation(
    VerifyPosCashierDocument,
  );
  const [cashierId, setCashierId] = useState<string | null>(null);
  const [cashierPickerOpen, setCashierPickerOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const branch = useMemo<PosSessionBranch | null>(() => {
    const location = data?.bmsPosSession.location;
    return location
      ? { id: location.id, name: location.name, code: location.branchCode }
      : null;
  }, [data]);
  const cashiers = useMemo<PosSessionCashier[]>(
    () =>
      (data?.bmsPosSession.cashiers ?? []).map(item => ({
        id: item.id,
        name: item.name ?? item.email ?? item.id,
        role: item.role ?? 'Cashier',
      })),
    [data],
  );
  const cashier = cashiers.find(item => item.id === cashierId) ?? cashiers[0];

  useEffect(() => {
    if (!cashierId && cashiers[0]) setCashierId(cashiers[0].id);
    if (cashierId && !cashiers.some(item => item.id === cashierId)) {
      setCashierId(cashiers[0]?.id ?? null);
    }
  }, [cashierId, cashiers]);

  const canSubmit =
    isPosPinLengthValid(pin) && !!branch && !!cashier && !loading && !verifying;

  const branchCard = (
    <Card
      style={{
        marginBottom: spacing.md,
        padding: isTablet ? spacing.xl : spacing.lg,
      }}
    >
      <View style={styles.fieldValueRow}>
        <View style={styles.fieldText}>
          <Text
            style={[
              typography.captionStrong,
              { color: colors.textMuted, marginBottom: spacing.sm },
            ]}
          >
            สาขา
          </Text>
          {branch ? (
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {branch.name}
            </Text>
          ) : (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {loading
                ? 'กำลังอ่านสาขาจากเครื่อง…'
                : 'ยังอ่านสาขาจากเครื่องไม่ได้'}
            </Text>
          )}
        </View>
        {branch ? (
          <View style={[styles.readOnlyHint, { gap: spacing.sm }]}>
            <LockIcon color={colors.textMuted} />
            <Text
              style={[typography.caption, { color: colors.textMuted }]}
              numberOfLines={2}
            >
              กำหนดจากเครื่องนี้
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );

  const cashierCard = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`เลือกผู้ปฏิบัติงาน${
        cashier ? ` ปัจจุบัน ${cashier.name}` : ''
      }`}
      accessibilityState={{ disabled: cashiers.length === 0 }}
      disabled={cashiers.length === 0}
      onPress={() => setCashierPickerOpen(true)}
      style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
    >
      <Card
        style={{
          marginBottom: spacing.md,
          padding: isTablet ? spacing.xl : spacing.lg,
        }}
      >
        <Text
          style={[
            typography.captionStrong,
            { color: colors.textMuted, marginBottom: spacing.sm },
          ]}
        >
          ผู้ปฏิบัติงาน
        </Text>
        <View style={styles.operatorRow}>
          <Text
            style={[
              typography.subtitle,
              { color: cashier ? colors.text : colors.textMuted, flex: 1 },
            ]}
            numberOfLines={1}
          >
            {cashier?.name ??
              (loading ? 'กำลังโหลดรายชื่อ…' : 'ยังไม่มีผู้ปฏิบัติงาน')}
          </Text>
          {cashiers.length > 0 ? <ChevronDownIcon color={colors.text} /> : null}
        </View>
        {cashiers.length > 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            แตะเพื่อเปลี่ยนผู้ปฏิบัติงาน
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );

  const pinCard = (
    // ให้การ์ดสูงตามเนื้อหาจริงทั้งมือถือและแท็บเล็ต การใส่ flex: 1 ใน ScrollView จะตัดแป้นตัวเลข
    // ส่วนล่างออกจาก content size ทำให้เห็น PIN แต่เลื่อนต่อไปถึงปุ่มเข้าใช้งานไม่ได้
    <Card>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        PIN 4–8 หลัก
      </Text>
      <View style={styles.pinRow}>
        {Array.from({ length: visiblePosPinSlots(pin) }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              {
                borderColor: colors.border,
                backgroundColor:
                  i < pin.length ? colors.primary : 'transparent',
              },
            ]}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing.lg, marginBottom: spacing.lg }}>
        <NumericKeypad
          onDigit={d =>
            setPin(p => (p.length < POS_PIN_MAX_LENGTH ? p + d : p))
          }
          onBackspace={() => setPin(p => p.slice(0, -1))}
          onClear={() => setPin('')}
        />
      </View>

      <Button
        label={verifying ? 'กำลังตรวจ PIN…' : 'เข้าใช้งาน'}
        fullWidth
        disabled={!canSubmit}
        onPress={async () => {
          if (!branch || !cashier) return;
          setLoginError(null);
          try {
            const result = await verifyCashier({
              variables: {
                input: { cashierUserId: cashier.id, pin },
              },
            });
            const verified = result.data?.bmsPosVerifyCashier;
            if (!verified) throw new Error('เซิร์ฟเวอร์ไม่คืนข้อมูลพนักงาน');
            signIn(
              branch,
              {
                id: verified.id,
                name: verified.name ?? verified.email ?? verified.id,
                role: verified.role ?? 'Cashier',
              },
              pin,
            );
            navigation.replace('Main');
          } catch (submitError) {
            setLoginError(
              submitError instanceof Error
                ? submitError.message
                : 'ตรวจ PIN ไม่สำเร็จ',
            );
          } finally {
            setPin('');
          }
        }}
      />
      {(loginError || error) && (
        <Pressable
          accessibilityRole="button"
          onPress={() => refetch().catch(() => undefined)}
        >
          <Text
            style={[
              typography.body,
              { color: colors.danger, marginTop: spacing.sm },
            ]}
          >
            {loginError ?? error?.message} · แตะเพื่อลองใหม่
          </Text>
        </Pressable>
      )}
    </Card>
  );

  const title = (
    <Text
      style={[
        isTablet ? typography.displayLg : typography.title,
        { color: colors.text, marginBottom: spacing.md },
      ]}
    >
      เข้าใช้งานเครื่องขาย
    </Text>
  );

  const deviceStrip = (
    <DeviceStrip onPress={() => navigation.navigate('Settings')} />
  );

  return (
    <ScreenContainer
      style={
        isTablet
          ? { paddingHorizontal: spacing.xxl, paddingVertical: spacing.xl }
          : undefined
      }
    >
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.xxl }]}>
          <View style={styles.identityPane}>
            {title}
            {deviceStrip}
            {branchCard}
            {cashierCard}
          </View>
          <View style={styles.pinPane}>{pinCard}</View>
        </View>
      ) : (
        <>
          {title}
          {deviceStrip}
          <ScrollView
            style={styles.phoneScroll}
            contentContainerStyle={styles.phoneScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {branchCard}
            {cashierCard}
            {pinCard}
          </ScrollView>
        </>
      )}

      <CashierPickerModal
        visible={cashierPickerOpen}
        cashiers={cashiers}
        selectedId={cashier?.id ?? null}
        onClose={() => setCashierPickerOpen(false)}
        onSelect={item => {
          setCashierId(item.id);
          setPin('');
          setLoginError(null);
          setCashierPickerOpen(false);
        }}
      />
    </ScreenContainer>
  );
}

// สรุปการจับคู่เครื่องแบบบรรทัดเดียว — สถานะมาจากผลถามเซิร์ฟเวอร์จริง ไม่ใช่จากค่าที่เก็บไว้
// (เก็บ token ไว้ ≠ token ยังใช้ได้ · ตัวที่บอกได้คือ GraphQL bmsPosSession เท่านั้น)
function DeviceStrip({ onPress }: { onPress: () => void }) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();
  const { isTablet } = useResponsive();
  const { status, target, verify } = useDevice();

  let label: string;
  let tone: 'ok' | 'warn' | 'bad';
  if (status === 'LOADING') {
    label = 'กำลังอ่านค่าเครื่อง…';
    tone = 'warn';
  } else if (!target) {
    label = 'ยังไม่ได้จับคู่เครื่องกับร้าน — แตะเพื่อตั้งค่า';
    tone = 'bad';
  } else if (verify.kind === 'OK') {
    label = 'จับคู่เครื่องแล้ว';
    tone = 'ok';
  } else if (verify.kind === 'REJECTED') {
    label = `token ถูกยกเลิก — แตะเพื่อจับคู่ใหม่ (${displayHost(
      target.serverUrl,
    )})`;
    tone = 'bad';
  } else if (verify.kind === 'CHECKING') {
    label = `กำลังตรวจกับ ${displayHost(target.serverUrl)}…`;
    tone = 'warn';
  } else if (verify.kind === 'OFFLINE') {
    // ต่อไม่ถึงเลย — ยังไม่มี response ให้พูดถึง คำตอบดิบของ URLSession คือเบาะแสเดียวที่มี
    label = `${displayHost(target.serverUrl)} · ต่อไม่ถึงเซิร์ฟเวอร์ (${
      verify.cause
    })`;
    tone = 'warn';
  } else if (verify.kind === 'SERVER_ERROR') {
    // ต่อถึงแล้วแต่คำตอบใช้ไม่ได้ — คนละเรื่องกับต่อไม่ถึง และพาไปทำคนละอย่าง
    label = `${displayHost(target.serverUrl)} · เซิร์ฟเวอร์ตอบผิดปกติ (${
      verify.cause
    })`;
    tone = 'bad';
  } else {
    // IDLE — ยังไม่เคยถามเลย ไม่ใช่ความล้ม · เหมารวมกับสองอันบนคือการบอกว่าพังทั้งที่ยังไม่ได้ลอง
    label = `${displayHost(
      target.serverUrl,
    )} · ยังไม่ได้ตรวจกับเซิร์ฟเวอร์ — แตะเพื่อทดสอบ`;
    tone = 'warn';
  }

  const fg =
    tone === 'ok'
      ? colors.success
      : tone === 'bad'
      ? colors.danger
      : colors.warning;
  const bg =
    tone === 'ok'
      ? colors.successBg
      : tone === 'bad'
      ? colors.dangerBg
      : colors.warningBg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`ตั้งค่าเครื่อง · ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.strip,
        {
          minHeight: Math.max(minTouchTarget, isTablet ? 64 : 52),
          borderRadius: radius.md,
          backgroundColor: bg,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.lg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {tone === 'ok' ? (
        <View style={[styles.checkCircle, { backgroundColor: fg }]}>
          <Text style={[styles.checkMark, { color: colors.primaryText }]}>
            ✓
          </Text>
        </View>
      ) : null}
      <Text
        style={[typography.captionStrong, { color: fg, flex: 1 }]}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text style={[typography.captionStrong, { color: fg }]}>ตั้งค่า</Text>
    </Pressable>
  );
}

function CashierPickerModal({
  visible,
  cashiers,
  selectedId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  cashiers: PosSessionCashier[];
  selectedId: string | null;
  onClose: () => void;
  onSelect: (cashier: PosSessionCashier) => void;
}) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();
  const { isTablet } = useResponsive();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.pickerOverlay,
          {
            backgroundColor: colors.overlay,
            justifyContent: isTablet ? 'center' : 'flex-end',
            padding: isTablet ? spacing.xl : 0,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ปิดรายการผู้ปฏิบัติงาน"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel="เลือกผู้ปฏิบัติงาน"
          style={[
            styles.pickerPanel,
            {
              width: isTablet ? 520 : '100%',
              maxHeight: isTablet ? '76%' : '72%',
              padding: spacing.xl,
              borderRadius: isTablet ? radius.lg : 0,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={styles.pickerHeader}>
            <View style={styles.pickerHeaderText}>
              <Text style={[typography.title, { color: colors.text }]}>
                เลือกผู้ปฏิบัติงาน
              </Text>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                เลือกชื่อของคุณ แล้วกรอก PIN เพื่อยืนยัน
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ปิด"
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  minWidth: minTouchTarget,
                  minHeight: minTouchTarget,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface2,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ×
              </Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ marginTop: spacing.lg }}
            contentContainerStyle={{ gap: spacing.sm }}
            showsVerticalScrollIndicator={false}
          >
            {cashiers.map(item => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${item.name} ${item.role}`}
                  onPress={() => onSelect(item)}
                  style={({ pressed }) => [
                    styles.cashierOption,
                    {
                      minHeight: Math.max(minTouchTarget, 60),
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      borderRadius: radius.md,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected
                        ? colors.surface2
                        : colors.surface,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View style={styles.fieldText}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textMuted }]}
                    >
                      {item.role}
                    </Text>
                  </View>
                  {selected ? (
                    <View
                      style={[
                        styles.optionCheck,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionCheckText,
                          { color: colors.primaryText },
                        ]}
                      >
                        ✓
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LockIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Path
        d="M5.5 7V5.5a3.5 3.5 0 0 1 7 0V7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Rect x={3.5} y={7} width={11} height={8.5} rx={2} fill={color} />
      <Path
        d="M9 10v2.4"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ChevronDownIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="m5.5 8 5.5 5.5L16.5 8"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  panes: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityPane: { flex: 0.92, minWidth: 0 },
  pinPane: { flex: 1.08, minWidth: 0 },
  fieldValueRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  fieldText: { flex: 1, minWidth: 0 },
  readOnlyHint: {
    maxWidth: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  operatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  phoneScroll: { flex: 1 },
  phoneScrollContent: { flexGrow: 1, paddingBottom: 24 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
  pickerOverlay: { flex: 1, alignItems: 'center' },
  pickerPanel: { borderWidth: StyleSheet.hairlineWidth },
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  pickerHeaderText: { flex: 1, gap: 4 },
  closeButton: { alignItems: 'center', justifyContent: 'center' },
  cashierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCheckText: { fontSize: 15, lineHeight: 18, fontWeight: '700' },
});
