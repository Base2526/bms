import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  const { status: pairStatus } = useDevice();
  const { signIn } = useSession();
  const { data, loading, error, refetch } = useQuery(PosBootstrapDocument, {
    skip: pairStatus !== 'PAIRED',
    notifyOnNetworkStatusChange: true,
  });
  const [verifyCashier, { loading: verifying }] = useMutation(
    VerifyPosCashierDocument,
  );
  const [cashierId, setCashierId] = useState<string | null>(null);
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
    isPosPinLengthValid(pin) &&
    !!branch &&
    !!cashier &&
    !loading &&
    !verifying;

  const branchCard = (
    <Card style={{ marginBottom: spacing.md }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        สาขา
      </Text>
      <View style={styles.chipWrap}>
        {branch ? (
          <Chip label={branch.name} selected onPress={() => undefined} />
        ) : (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {loading
              ? 'กำลังอ่านสาขาจากเครื่อง…'
              : 'ยังอ่านสาขาจากเครื่องไม่ได้'}
          </Text>
        )}
      </View>
    </Card>
  );

  const cashierCard = (
    <Card style={{ marginBottom: spacing.md }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        ผู้ปฏิบัติงาน
      </Text>
      <View style={styles.chipWrap}>
        {cashiers.map(item => (
          <Chip
            key={item.id}
            label={item.name}
            selected={item.id === cashier.id}
            onPress={() => {
              setCashierId(item.id);
              setPin('');
              setLoginError(null);
            }}
          />
        ))}
      </View>
    </Card>
  );

  const pinCard = (
    // บนแท็บเล็ตการ์ดหุ้มเนื้อหาพอดีแล้วจัดกลางแนวตั้ง — ถ้ายืดเต็มความสูง 1366pt จะได้ช่องว่าง
    // ก้อนใหญ่ระหว่างจุด PIN กับแป้นตัวเลข ซึ่งอ่านเหมือนหน้าจอโหลดไม่เสร็จ
    <Card style={isTablet ? undefined : { flex: 1 }}>
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

      {/* มือถือ: ดันแป้นลงล่างของการ์ด (นิ้วโป้งอยู่ครึ่งล่างของจอเสมอ) · แท็บเล็ต: ชิดเนื้อหาปกติ */}
      <View
        style={[
          { marginTop: spacing.lg, marginBottom: spacing.lg },
          !isTablet && { flex: 1, justifyContent: 'flex-end' },
        ]}
      >
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

  return (
    <ScreenContainer>
      <Text
        style={[
          typography.title,
          { color: colors.text, marginBottom: spacing.md },
        ]}
      >
        เข้าใช้งานเครื่องขาย
      </Text>

      {/* แถบนี้ตอบคำถาม "เครื่องนี้เป็นของร้านไหน" ตั้งแต่ก่อนใครกดอะไร และเป็นทางเดียว
          ที่เข้าหน้าตั้งค่าได้ — วางไว้ที่นี่เพราะการจับคู่เกิดครั้งเดียวตอนตั้งเครื่อง
          ไม่ใช่งานประจำวัน จึงไม่ควรกินที่บนแถบแท็บคู่กับ 4 จอที่ใช้ทุกวัน */}
      <DeviceStrip onPress={() => navigation.navigate('Settings')} />

      {/* แท็บเล็ต: เลือกสาขา/คนขายอยู่ซ้าย · แป้น PIN อยู่ขวา — ใช้ความกว้างจริงของจอแทนที่จะบีบ
          เป็นคอลัมน์ขนาดมือถือกลางจอแล้วเหลือที่ว่างครึ่งล่างทั้งแผ่น */}
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>
            {branchCard}
            {cashierCard}
            <Card>
              <Text
                style={[
                  typography.captionStrong,
                  { color: colors.textMuted, marginBottom: spacing.sm },
                ]}
              >
                กำลังจะเข้าใช้งาน
              </Text>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {cashier?.name ?? 'ยังไม่ได้เลือกพนักงาน'}
              </Text>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                {branch?.name ?? 'ไม่ทราบสาขา'} · {branch?.code ?? '—'} ·{' '}
                {cashier?.role ?? '—'}
              </Text>
            </Card>
          </View>
          <View style={{ width: 420 }}>{pinCard}</View>
        </View>
      ) : (
        <>
          {branchCard}
          {cashierCard}
          {pinCard}
        </>
      )}
    </ScreenContainer>
  );
}

// สรุปการจับคู่เครื่องแบบบรรทัดเดียว — สถานะมาจากผลถามเซิร์ฟเวอร์จริง ไม่ใช่จากค่าที่เก็บไว้
// (เก็บ token ไว้ ≠ token ยังใช้ได้ · ตัวที่บอกได้คือ GraphQL bmsPosSession เท่านั้น)
function DeviceStrip({ onPress }: { onPress: () => void }) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();
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
    const b = verify.info.branchName ?? 'ไม่ทราบสาขา';
    const storeType =
      verify.info.businessArchetype === 'restaurant'
        ? 'ร้านอาหาร'
        : verify.info.businessArchetype === 'pharmacy'
        ? 'ร้านขายยา'
        : 'ร้านทั่วไป';
    label = `${storeType} · ${b} · เครื่อง ${
      verify.info.deviceCode
    } · ${displayHost(
      target.serverUrl,
    )}`;
    tone = 'ok';
  } else if (verify.kind === 'REJECTED') {
    label = `token ถูกยกเลิก — แตะเพื่อจับคู่ใหม่ (${displayHost(
      target.serverUrl,
    )})`;
    tone = 'bad';
  } else if (verify.kind === 'CHECKING') {
    label = `กำลังตรวจกับ ${displayHost(target.serverUrl)}…`;
    tone = 'warn';
  } else {
    // OFFLINE / SERVER_ERROR / IDLE — เครื่องยังจับคู่อยู่ แค่ยังยืนยันไม่ได้ตอนนี้
    label = `${displayHost(target.serverUrl)} · ยังตรวจกับเซิร์ฟเวอร์ไม่ได้`;
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
          minHeight: minTouchTarget,
          borderRadius: radius.md,
          backgroundColor: bg,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.lg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[typography.captionStrong, { color: fg, flex: 1 }]}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text style={[typography.captionStrong, { color: fg }]}>ตั้งค่า ›</Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: minTouchTarget,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.primary : colors.surface2,
        borderWidth: selected ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Text
        style={[
          typography.body,
          { color: selected ? colors.primaryText : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // alignItems: center — ทั้งสองแผงหุ้มเนื้อหาแล้วอยู่กลางแนวตั้ง ไม่ยืดเต็มความสูงจอไอแพด
  panes: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // ห่อบรรทัดแทน FlatList แนวนอน — บนแท็บเล็ตมีที่พอให้เห็นทุกตัวเลือกพร้อมกัน
  // ไม่ต้องเลื่อนหาชื่อตัวเองตอนเข้ากะ
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
});
