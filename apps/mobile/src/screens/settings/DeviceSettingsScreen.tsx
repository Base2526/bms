import { LanguageSelector } from '../../components/LanguageSelector';
import { posText, usePosLanguage } from '../../i18n/language';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PairingScannerButton } from '../../components/PairingScannerButton';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useDevice } from '../../state/DeviceContext';
import { useStoreMode } from '../../state/StoreModeContext';
import { useSession } from '../../state/SessionContext';
import {
  displayHost,
  normalizeServerUrl,
  parsePairingInput,
} from '../../lib/pairing';
import { loadOfflineSales } from '../../lib/offlineSales';
import { useServerHealth } from '../../state/ServerHealthContext';
import { useRealtime } from '../../state/RealtimeContext';
import { exportPosDiagnostics, getPosDiagnosticSummary, retryPosDiagnosticUpload } from '../../lib/supportDiagnostics';
import { savePickupQueueEnabled, usePickupQueueEnabled } from '../../lib/pickupQueuePreference';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/**
 * เวลาแบบ 24 ชม. ตามเครื่อง — ตั้งใจโชว์ "วินาที" ด้วย
 *
 * เพราะคำถามที่ปุ่มทดสอบต้องตอบคือ "กดแล้วมันไปถามจริงไหม" ซึ่งการกดสองครั้งติดกันในนาทีเดียว
 * ต้องเห็นตัวเลขขยับ · ถ้าโชว์แค่ HH:MM การกดซ้ำจะยังอ่านว่าไม่มีอะไรเกิดขึ้นเหมือนเดิม
 */
function formatCheckedAt(at: number): string {
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return posText("{v0}:{v1}:{v2} น.", { v0: pad(time.getHours()), v1: pad(time.getMinutes()), v2: pad(
    time.getSeconds(),
  ) });
}

/** แผงขวาบนแท็บเล็ต — เท่ากับแผงตะกร้า/แผงบิลของหน้าอื่น ให้ความกว้างของแอปเป็นภาษาเดียวกัน */
const STATUS_PANEL_WIDTH = 360;

// หน้าตั้งค่าเครื่อง — ตอบคำถามเดียว: "ไอแพดเครื่องนี้เป็นของร้านไหน"
//
// ⚠️ คำตอบไม่ได้มาจากค่าที่กรอกที่นี่ — สิ่งที่กรอกคือ **token** ส่วนคำตอบว่าเป็นของร้าน/สาขาไหน
// มาจากเซิร์ฟเวอร์ตอนกด "ทดสอบการเชื่อมต่อ" เท่านั้น (`bmsPosSession`)
// ห้ามเพิ่มช่องให้เลือกร้าน/สาขาเองเด็ดขาด — เป็นกฎของทั้งระบบว่า tenant มาจาก token ฝั่ง server
export default function DeviceSettingsScreen({ route, navigation }: Props) {
  usePosLanguage();
  const { colors, spacing, typography, radius, minTouchTarget } = useTheme();
  const pickupQueueEnabled = usePickupQueueEnabled();
  const { session, signOut } = useSession();
  const branchPickupQueueEnabled = session?.branch.pickupQueue?.enabled === true;
  const { isTablet } = useResponsive();
  const {
    status,
    target,
    storeError,
    verify,
    lastCheckedAt,
    pair,
    unpair,
    runVerify,
  } = useDevice();
  const { mode } = useStoreMode();
  const health = useServerHealth();
  const realtime = useRealtime();
  const [diagnosticSummary, setDiagnosticSummary] = useState<Awaited<ReturnType<typeof getPosDiagnosticSummary>> | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticSummary(await getPosDiagnosticSummary(target));
  }, [target]);
  useEffect(() => { refreshDiagnostics().catch(() => undefined); }, [refreshDiagnostics, health.lastCheckedAt]);

  const [input, setInput] = useState('');
  const [serverInput, setServerInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  // ลิงก์ `bmspos://pair?t=...` ที่เปิดแอปขึ้นมา — react-navigation แกะ query ให้เป็น route params
  // **เติมลงช่องให้เฉย ๆ ไม่บันทึกเอง** โดยตั้งใจ: ลิงก์ที่ใครส่งมาก็ได้สามารถชี้เครื่องนี้ไป
  // เซิร์ฟเวอร์อื่นได้ คนกดต้องเห็นชื่อเซิร์ฟเวอร์ก่อนว่าใช่ของร้านตัวเองไหม แล้วค่อยกดบันทึก
  useEffect(() => {
    const t = route.params?.t;
    if (!t) return;
    const h = route.params?.h;
    setInput(
      `bmspos://pair?t=${encodeURIComponent(t)}${h ? `&h=${encodeURIComponent(h)}` : ''}`,
    );
  }, [route.params?.t, route.params?.h]);

  const parsed = useMemo(
    () => (input.trim() ? parsePairingInput(input) : null),
    [input],
  );
  const parsedServer = parsed?.ok ? parsed.serverUrl : null;
  // เซิร์ฟเวอร์ที่จะบันทึกจริง: เอาจากลิงก์ก่อน ถ้าลิงก์ไม่พกมาค่อยใช้ที่พิมพ์เอง
  const effectiveServer = parsedServer ?? normalizeServerUrl(serverInput);
  const canSave = Boolean(parsed?.ok && effectiveServer);

  async function onSave() {
    if (scanning || saving || !parsed?.ok || !effectiveServer) return;
    setSaving(true);
    try {
      await pair({ serverUrl: effectiveServer, token: parsed.token });
      setInput('');
      setServerInput('');
      // pair() ทดสอบ token ใหม่กับ server ให้เสร็จในตัว — จึงไม่เสี่ยงอ่าน target
      // รอบเก่าจาก React state และไม่ปล่อยให้คนเดินจากไปโดยคิดว่า token ใช้ได้แล้ว
    } catch (e: any) {
      Alert.alert(posText("บันทึกไม่สำเร็จ"), String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function onUnpair() {
    if (scanning || saving) return;
    try {
      // Keychain survives app upgrades/re-pairing. Any accepted-cash row on this physical device
      // must block unpair, including a legacy row from a previous target that the current UI cannot
      // display; otherwise the only credential capable of recovering it can be replaced silently.
      const pending = await loadOfflineSales();
      if (pending.length > 0) {
        Alert.alert(
          posText("ยังเลิกจับคู่ไม่ได้"),
          posText("มีรายการรับเงินออฟไลน์ค้าง {v0} รายการ กรุณาซิงก์หรือตรวจสอบให้เสร็จก่อน เพื่อไม่ให้ยอดขายหายจากเครื่องเดิม", { v0: pending.length }),
        );
        return;
      }
    } catch (error) {
      Alert.alert(
        posText("ยังเลิกจับคู่ไม่ได้"),
        error instanceof Error
          ? posText("{v0} · ต้องตรวจคิวให้ได้ก่อน", { v0: error.message })
          : posText("ตรวจคิวออฟไลน์ไม่ได้ กรุณาให้ผู้ดูแลตรวจสอบเครื่อง"),
      );
      return;
    }
    Alert.alert(
      posText("เลิกจับคู่เครื่องนี้?"),
      posText("เครื่องจะลืม token และใช้ขายไม่ได้จนกว่าจะจับคู่ใหม่ · token เดิมที่หน้าแอดมินยังใช้ได้อยู่ (ถ้ายังไม่ได้ออกใหม่)"),
      [
        { text: posText("ยกเลิก"), style: 'cancel' },
        {
          text: posText("เลิกจับคู่"),
          style: 'destructive',
          onPress: async () => {
            try {
              await unpair();
              signOut();
              // Leave Settings open for the next QR. Remove any signed-in register
              // beneath it so Android Back cannot return to an unpaired POS.
              navigation.reset({
                index: 1,
                routes: [{ name: 'Login' }, { name: 'Settings' }],
              });
            } catch (e: any) {
              Alert.alert(posText("เลิกจับคู่ไม่สำเร็จ"), String(e?.message ?? e));
            }
          },
        },
      ],
    );
  }

  const inputStyle = [
    typography.body,
    {
      minHeight: minTouchTarget,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
  ];

  // ---- แผงสถานะ: "ตอนนี้เครื่องนี้เป็นของใคร" -------------------------------
  const statusPanel = (
    <View style={{ gap: spacing.md }}>
      <Button
        label={posText("เครื่องพิมพ์ใบเสร็จ")}
        variant="secondary"
        fullWidth
        onPress={() => navigation.navigate('PrinterSettings')}
      />
      <Card>
        <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
          {posText("เลขคิวรับของ") + " "}</Text>
        <Text
          style={[
            typography.caption,
            { color: colors.textSoft, marginTop: spacing.xs, marginBottom: spacing.sm },
          ]}
        >
          {branchPickupQueueEnabled
            ? posText("สาขานี้เปิดออกเลขคิวทุกเครื่องจากหลังบ้านแล้ว จึงปิดจากโทรศัพท์เครื่องนี้ไม่ได้")
            : posText("ตั้งค่าเฉพาะเครื่องนี้ · บิลขายหน้าร้านและบิลกลับบ้านจะได้เลขคิว พิมพ์บนใบเสร็จ และขึ้นจอเรียกคิว")}
          {' '}{posText("(เปิดจอเรียกคิวจากเครื่องขายบนเว็บหรือแอปเดสก์ท็อป)") + " "}</Text>
        <Button
          label={branchPickupQueueEnabled
            ? posText("ออกเลขคิว: เปิดทั้งสาขา")
            : pickupQueueEnabled
            ? posText("ออกเลขคิวของเครื่องนี้: เปิด · กดเพื่อปิด")
            : posText("ออกเลขคิวของเครื่องนี้: ปิด · กดเพื่อเปิด")}
          variant={branchPickupQueueEnabled || pickupQueueEnabled ? 'primary' : 'secondary'}
          disabled={branchPickupQueueEnabled}
          fullWidth
          onPress={() => {
            savePickupQueueEnabled(!pickupQueueEnabled).catch(error =>
              Alert.alert(
                posText("บันทึกไม่สำเร็จ"),
                error instanceof Error ? error.message : posText("ลองใหม่อีกครั้ง"),
              ),
            );
          }}
        />
      </Card>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            {posText("ประเภทร้านจากเซิร์ฟเวอร์") + " "}</Text>
          <StatusPill
            label={
              mode === 'restaurant'
                ? posText("ร้านอาหาร")
                : mode === 'pharmacy'
                ? posText("ร้านขายยา")
                : posText("ร้านทั่วไป")
            }
            tone="success"
          />
        </View>
        <Text
          style={[
            typography.caption,
            { color: colors.textSoft, marginTop: spacing.xs },
          ]}
        >
          {posText("แอปอ่านค่านี้จากเครื่องที่จับคู่ไว้ ไม่รับ tenant สาขา หรือประเภทร้านจากผู้ใช้") + " "}</Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            {posText("สถานะเครื่อง") + " "}</Text>
          <StatusPill
            label={
              status === 'LOADING'
                ? posText("กำลังอ่าน")
                : status === 'PAIRED'
                ? posText("จับคู่แล้ว")
                : status === 'UNAVAILABLE'
                ? posText("อ่านค่าไม่ได้")
                : posText("ยังไม่จับคู่")
            }
            tone={
              status === 'PAIRED'
                ? 'success'
                : status === 'UNAVAILABLE'
                ? 'danger'
                : 'warning'
            }
          />
        </View>

        {status === 'UNAVAILABLE' && (
          <Text
            style={[
              typography.caption,
              { color: colors.danger, marginTop: spacing.sm },
            ]}
          >
            {posText("อ่านค่าจากที่เก็บปลอดภัยของเครื่องไม่ได้ (")}{storeError}{posText(") — ยังไม่ต้องสรุปว่าเครื่องไม่เคยจับคู่") + " "}</Text>
        )}

        {target ? (
          <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
            <FieldRow
              label={posText("เซิร์ฟเวอร์")}
              value={displayHost(target.serverUrl)}
            />
          </View>
        ) : (
          status !== 'LOADING' && (
            <Text
              style={[
                typography.body,
                { color: colors.textMuted, marginTop: spacing.sm },
              ]}
            >
              {posText("เครื่องนี้ยังไม่ได้ผูกกับร้านไหน — วางลิงก์จับคู่ทางขวาเพื่อเริ่ม") + " "}</Text>
          )
        )}
      </Card>

      {target && (
        <Card>
          <Text
            style={[
              typography.captionStrong,
              { color: colors.textMuted, marginBottom: spacing.sm },
            ]}
          >
            {posText("เครื่องนี้เป็นของร้านไหน") + " "}</Text>

          {verify.kind === 'IDLE' && (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {posText("ยังไม่ได้ถามเซิร์ฟเวอร์ — ค่าที่เก็บไว้บอกได้แค่ว่า “จะไปถามที่ไหน” ไม่ได้บอกว่า token ยังใช้ได้") + " "}</Text>
          )}
          {verify.kind === 'CHECKING' && (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {posText("กำลังถามเซิร์ฟเวอร์…") + " "}</Text>
          )}
          {verify.kind === 'OK' && (
            <View style={{ gap: spacing.xs }}>
              <FieldRow label={posText("สาขา")} value={verify.info.branchName ?? '—'} />
              <FieldRow
                label={posText("รหัสสาขา")}
                value={verify.info.branchCode ?? '—'}
              />
              <FieldRow
                label={posText("เครื่อง")}
                value={`${verify.info.deviceCode}${
                  verify.info.deviceName ? ` · ${verify.info.deviceName}` : ''
                }`}
              />
              <FieldRow
                label={posText("ประเภทจากเซิร์ฟเวอร์")}
                value={
                  verify.info.businessArchetype === 'pharmacy'
                    ? posText("ร้านขายยา")
                    : verify.info.surface === 'restaurant'
                    ? posText("ร้านอาหาร")
                    : posText("ร้านทั่วไป/ค้าปลีก")
                }
              />
              <FieldRow
                label={posText("กะที่เปิดอยู่")}
                value={verify.info.shiftOpen ? posText("มี") : posText("ยังไม่เปิดกะ")}
              />
              <FieldRow
                label={posText("ผู้ปฏิบัติงานที่ขายได้")}
                value={posText("{v0} คน", { v0: verify.info.cashierCount })}
              />
              {/* ชื่อร้าน (tenant) ไม่อยู่ใน bmsPosSession — payload มีแค่สาขา/เครื่อง/เลขผู้เสียภาษี
                  ถ้าอยากให้จอบอก "ร้านชื่ออะไร" ต้องเพิ่มฟิลด์ที่ route ฝั่งเว็บก่อน */}
              <Text
                style={[
                  typography.caption,
                  { color: colors.textSoft, marginTop: spacing.xs },
                ]}
              >
                {posText("(เซิร์ฟเวอร์ยังไม่ส่งชื่อร้านมาให้ — ระบุตัวร้านได้จากเซิร์ฟเวอร์ + สาขา)") + " "}</Text>
            </View>
          )}
          {verify.kind === 'REJECTED' && (
            <Text style={[typography.body, { color: colors.danger }]}>
              {verify.message}
            </Text>
          )}
          {verify.kind === 'SERVER_ERROR' && (
            <Text style={[typography.body, { color: colors.danger }]}>
              {verify.message}
            </Text>
          )}
          {verify.kind === 'OFFLINE' && (
            <Text style={[typography.body, { color: colors.warning }]}>
              {verify.message}
              {'\n'}
              <Text style={typography.caption}>
                {posText("ต่อไม่ได้ ≠ token ผิด — ยังไม่ต้องเลิกจับคู่") + " "}</Text>
            </Text>
          )}

          {/* คำตอบที่ผ่านแล้วหน้าตาเหมือนกันทุกตัวอักษรไม่ว่าจะถามเมื่อกี้หรือเมื่อเปิดแอป —
              ไม่มีบรรทัดนี้ การกด "ทดสอบการเชื่อมต่อ" ตอนทุกอย่างปกติจะอ่านไม่ออกว่าปุ่มทำงานไหม
              และคำตอบค้างจอจากเช้าก็อ่านว่าเป็นคำตอบสด */}
          {verify.kind !== 'IDLE' && lastCheckedAt != null && (
            <Text
              style={[
                typography.caption,
                { color: colors.textSoft, marginTop: spacing.sm },
              ]}
            >
              {verify.kind === 'CHECKING'
                ? posText("กำลังถามใหม่ · คำตอบก่อนหน้าเมื่อ {v0}", { v0: formatCheckedAt(
                    lastCheckedAt,
                  ) })
                : posText("ตรวจล่าสุด {v0}", { v0: formatCheckedAt(lastCheckedAt) })}
            </Text>
          )}

          <View
            style={{
              flexDirection: 'row',
              gap: spacing.sm,
              marginTop: spacing.md,
              flexWrap: 'wrap',
            }}
          >
            <Button
              label={posText("ทดสอบการเชื่อมต่อ")}
              variant="secondary"
              loading={verify.kind === 'CHECKING'}
              disabled={scanning || saving}
              onPress={runVerify}
            />
            <Button
              label={posText("เลิกจับคู่")}
              variant="danger"
              disabled={scanning || saving}
              onPress={onUnpair}
            />
          </View>
        </Card>
      )}
      <Card>
        <Text style={[typography.captionStrong, { color: colors.textMuted, marginBottom: spacing.sm }]}>
          {posText("หลักฐานการเชื่อมต่อเครื่องนี้")}
        </Text>
        <Text style={[typography.body, { color: colors.text }]}>
          {health.status === 'checking' ? posText("ยังไม่ได้ตรวจหรือกำลังตรวจ")
            : health.status === 'online' ? posText("เชื่อมต่อหลังบ้านปกติ")
            : posText("เชื่อมต่อหลังบ้านไม่ได้")}
          {health.lastCode ? ` · ${health.lastCode}` : ''}
          {health.lastHttpStatus ? ` · HTTP ${health.lastHttpStatus}` : ''}
        </Text>
        {health.status === 'online' && ['degraded', 'reconnecting', 'authentication_required'].includes(realtime.status)
          && <Text style={[typography.caption, { color: colors.warning, marginTop: spacing.xs }]}>
            {posText("HTTP ยังใช้งานได้ แต่ข้อมูลสดขัดข้อง ตรวจ WebSocket/proxy หรือสิทธิ์กับผู้ดูแล; ข้อมูลหลักยังอ่านผ่าน HTTP ได้")}
          </Text>}
        {health.lastCheckedAt && <Text style={[typography.caption, { color: colors.textSoft, marginTop: spacing.xs }]}>
          {posText("ตรวจล่าสุด {v0}", { v0: formatCheckedAt(health.lastCheckedAt) })}
        </Text>}
        {health.status === 'offline' && <Text style={[typography.caption, { color: colors.warning, marginTop: spacing.sm }]}>
          {health.lastCode === 'POS_AUTHENTICATION' ? posText("ให้ผู้ดูแลตรวจ token ของเครื่อง เก็บข้อมูลค้างไว้ก่อนเปลี่ยนการจับคู่")
            : health.lastCode === 'POS_PERMISSION' ? posText("ตรวจสิทธิ์เครื่องกับผู้ดูแล ไม่ต้องเลิกจับคู่")
            : health.lastCode === 'POS_RATE_LIMIT' ? posText("รอสักครู่ก่อนลองอีกครั้ง")
            : health.lastCode === 'POS_TIMEOUT' ? posText("หมดเวลารอคำตอบ ตรวจการเชื่อมต่อและสถานะเซิร์ฟเวอร์")
            : health.lastCode === 'POS_PROTOCOL' || health.lastCode === 'POS_VERSION' ? posText("ตรวจ URL และเวอร์ชันแอปกับหลังบ้าน")
            : health.lastCode === 'POS_SERVER' ? posText("แจ้งผู้ดูแลพร้อมเวลาและรหัสเหตุ")
            : posText("การเชื่อมต่อล้มเหลว ไม่ทราบสาเหตุย่อย ตรวจเครือข่าย URL และใบรับรอง HTTPS")}
        </Text>}
        <Text style={[typography.caption, { color: colors.textSoft, marginTop: spacing.sm }]}>
          {posText("ค้างส่ง {v0} · เซิร์ฟเวอร์ปฏิเสธ {v1} · หลักฐานขาดหาย {v2}", {
            v0: diagnosticSummary?.pending ?? 0, v1: diagnosticSummary?.rejected ?? 0,
            v2: diagnosticSummary?.gaps.reduce((sum, item) => sum + item.count, 0) ?? 0 })}
        </Text>
        {diagnosticSummary?.blockedReason && <Text style={[typography.caption, { color: colors.danger }]}>
          {posText("ส่งหลักฐานไม่ได้: {v0}", { v0: diagnosticSummary.blockedReason })}
        </Text>}
        {!!diagnosticSummary?.otherTargetCount && <Text style={[typography.caption, { color: colors.warning }]}>
          {posText("มีหลักฐานของการจับคู่อื่นอีก {v0} ชุด เก็บไว้ในเครื่องและส่งออกได้ แต่จะไม่ส่งด้วยการจับคู่ปัจจุบัน", {
            v0: diagnosticSummary.otherTargetCount })}
        </Text>}
        {diagnosticSummary?.storageError && <Text style={[typography.caption, { color: colors.danger }]}>
          {posText("บันทึกหลักฐานลงเครื่องไม่สำเร็จ กรุณาส่งออกข้อมูลทันที")}
        </Text>}
        {diagnosticSummary?.gaps.map((item, index) => <Text key={`${item.reason}-${index}`}
          style={[typography.caption, { color: colors.warning }]}>
          {`${item.reason} · ${item.count} · ${item.from} → ${item.to}`}
        </Text>)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label={posText("ส่งหลักฐานอีกครั้ง")} variant="secondary" loading={diagnosticBusy}
            disabled={!target || status !== 'PAIRED' || verify.kind !== 'OK'} onPress={async () => { setDiagnosticBusy(true);
              try { await retryPosDiagnosticUpload(target); await refreshDiagnostics(); }
              finally { setDiagnosticBusy(false); } }} />
          <Button label={posText("ส่งออกหลักฐานจากเครื่อง")} variant="secondary"
            onPress={async () => { try { await Share.share({ message: await exportPosDiagnostics(),
              title: 'BMS POS diagnostics' }); } catch { Alert.alert(posText("ส่งออกหลักฐานไม่สำเร็จ")); } }} />
        </View>
      </Card>
    </View>
  );

  // ---- แผงจับคู่: ช่องวางลิงก์ --------------------------------------------
  const pairPanel = (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
          {posText("ลิงก์จับคู่") + " "}</Text>
        <Text
          style={[
            typography.caption,
            { color: colors.textSoft, marginTop: spacing.xs },
          ]}
        >
          {posText("เอามาจากระบบหลังบ้าน → เครื่องขาย (POS) → ปุ่ม “ออก token” แล้วสแกน QR เพื่อเพิ่ม token อัตโนมัติ หรือคัดลอกลิงก์มาวาง") + " "}</Text>

        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={
            posText("bmspos://pair?t=pos_...\nหรือ https://ร้านของคุณ/pos?t=pos_...\nหรือวาง token ที่ขึ้นต้นด้วย pos_")
          }
          placeholderTextColor={colors.textSoft}
          multiline
          numberOfLines={3}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[
            ...inputStyle,
            { marginTop: spacing.md, textAlignVertical: 'top' },
          ]}
        />

        {/* บอกผลการแกะทันทีที่พิมพ์ — กด "บันทึก" แล้วค่อยรู้ว่าลิงก์ผิดคือการเสียเวลาเปล่า
            และคนจะไม่รู้ว่าผิดตรงไหนของลิงก์ */}
        {parsed && !parsed.ok && (
          <Text
            style={[
              typography.caption,
              { color: colors.danger, marginTop: spacing.sm },
            ]}
          >
            {parsed.error}
          </Text>
        )}
        {parsed?.ok && (
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <FieldRow
              label={posText("เซิร์ฟเวอร์จากลิงก์")}
              value={
                parsedServer
                  ? displayHost(parsedServer)
                  : posText("ลิงก์นี้ไม่ได้พกมา — กรอกด้านล่าง")
              }
            />
          </View>
        )}

        {/* ช่องเซิร์ฟเวอร์โผล่เฉพาะตอนลิงก์ไม่พก origin มาให้ — ช่องที่ต้องกรอกทั้งที่ระบบรู้อยู่แล้ว
            คือช่องที่คนกรอกผิด */}
        {parsed?.ok && !parsedServer && (
          <View style={{ marginTop: spacing.md }}>
            <Text
              style={[
                typography.captionStrong,
                { color: colors.textMuted, marginBottom: spacing.xs },
              ]}
            >
              {posText("ที่อยู่เซิร์ฟเวอร์") + " "}</Text>
            <TextInput
              value={serverInput}
              onChangeText={setServerInput}
              placeholder="bms.jachoei.com"
              placeholderTextColor={colors.textSoft}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="url"
              style={inputStyle}
            />
            <Text
              style={[
                typography.caption,
                { color: colors.textSoft, marginTop: spacing.xs },
              ]}
            >
              {posText("ไม่ต้องพิมพ์ https:// — เติมให้เอง (แอปไม่ยอมต่อแบบไม่เข้ารหัส เพราะ token วิ่งไปกับทุกคำขอ)") + " "}</Text>
          </View>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: spacing.sm,
            marginTop: spacing.lg,
          }}
        >
          <Button
            label={target ? posText("บันทึกและใช้ token ใหม่นี้") : posText("จับคู่เครื่อง")}
            fullWidth
            disabled={!canSave || scanning}
            loading={saving}
            style={{ flex: 1 }}
            onPress={onSave}
          />
          <PairingScannerButton
            target={target}
            disabled={saving || status === 'LOADING' || status === 'UNAVAILABLE'}
            pair={pair}
            onBusyChange={setScanning}
            onPaired={() => {
              setInput('');
              setServerInput('');
            }}
          />
        </View>
      </Card>

      <Card>
        <Text
          style={[
            typography.captionStrong,
            { color: colors.textMuted, marginBottom: spacing.sm },
          ]}
        >
          {posText("ข้อควรรู้") + " "}</Text>
        <Bullet>
          {posText("1 อุปกรณ์ = 1 เครื่องขายในระบบ · ห้ามใช้ token เดียวกันหลายเครื่อง เลขใบเสร็จรันต่อเครื่อง และเปิดกะค้างได้เครื่องละกะเดียว") + " "}</Bullet>
        <Bullet>
          {posText("ออก token ใหม่ที่หน้าแอดมินเมื่อไร ตัวเก่าใช้ไม่ได้ทันที — เป็นวิธีตัดเครื่องที่หายออกจากระบบ") + " "}</Bullet>
        <Bullet>
          {posText("สาขาเป็นของเครื่อง ไม่ใช่ของคน — เปลี่ยนสาขาต้องไปแก้ที่หน้าแอดมิน ไม่ใช่ที่เครื่อง") + " "}</Bullet>
        <Bullet>
          {posText("เครื่องจำ token ไว้จนกว่าจะกดเลิกจับคู่ ไม่ต้องใส่ใหม่ทุกวัน") + " "}</Bullet>
      </Card>
    </View>
  );

  return (
    <ScreenContainer>
      <ScreenHeader
        title={posText("ตั้งค่าเครื่อง")}
        subtitle={posText("ผูกอุปกรณ์เครื่องนี้เข้ากับร้าน/สาขาในระบบ")}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />
      <LanguageSelector />
      {isTablet ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: spacing.lg }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          >
            {pairPanel}
          </ScrollView>
          <ScrollView
            style={{ width: STATUS_PANEL_WIDTH }}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          >
            {statusPanel}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        >
          {statusPanel}
          {pairPanel}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.rowBetween}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          typography.bodyStrong,
          { color: colors.text, flexShrink: 1, textAlign: 'right' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={[typography.caption, { color: colors.textSoft }]}>•</Text>
      <Text
        style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
