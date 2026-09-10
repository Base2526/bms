import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { NumericKeypad } from '../components/NumericKeypad';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';
import { useDevice } from '../state/DeviceContext';
import { displayHost } from '../lib/pairing';
import {
  mockBranches,
  mockCashiers,
  MockBranch,
  MockCashier,
} from '../mocks/devices';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const PIN_LENGTH = 6;

// ⚠️ หน้าจอนี้เป็น "เปลือก" เท่านั้น (กลุ่ม A) — ไม่มีการยืนยันตัวตนจริงใด ๆ
// รอปิด schema/auth (login แบบ session ต่อคน, idle-timeout, สลับผู้ใช้) ให้นิ่งก่อน
// ถึงจะต่อ mutation จริงตรงนี้ — ดูการวิเคราะห์ที่คุยกันไว้ก่อนเริ่มงานนี้
export default function LoginScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const [branch, setBranch] = useState<MockBranch>(mockBranches[0]);
  const [cashier, setCashier] = useState<MockCashier>(mockCashiers[0]);
  const [pin, setPin] = useState('');

  const canSubmit = pin.length >= 4;

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
        {mockBranches.map(item => (
          <Chip
            key={item.id}
            label={item.name}
            selected={item.id === branch.id}
            onPress={() => setBranch(item)}
          />
        ))}
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
        {mockCashiers.map(item => (
          <Chip
            key={item.id}
            label={item.name}
            selected={item.id === cashier.id}
            onPress={() => setCashier(item)}
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
        PIN
      </Text>
      <View style={styles.pinRow}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
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
          onDigit={d => setPin(p => (p.length < PIN_LENGTH ? p + d : p))}
          onBackspace={() => setPin(p => p.slice(0, -1))}
          onClear={() => setPin('')}
        />
      </View>

      <Button
        label="เข้าใช้งาน"
        fullWidth
        disabled={!canSubmit}
        onPress={() => navigation.replace('Main')}
      />
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
                {cashier.name}
              </Text>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                {branch.name} · {branch.code} · {cashier.role}
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
// (เก็บ token ไว้ ≠ token ยังใช้ได้ · ตัวที่บอกได้คือ /api/pos/session เท่านั้น)
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
    label = `${b} · เครื่อง ${verify.info.deviceCode} · ${displayHost(
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
