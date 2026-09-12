import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useDevice } from '../../state/DeviceContext';
import { useStoreMode } from '../../state/StoreModeContext';
import {
  displayHost,
  maskToken,
  normalizeServerUrl,
  parsePairingInput,
} from '../../lib/pairing';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/** แผงขวาบนแท็บเล็ต — เท่ากับแผงตะกร้า/แผงบิลของหน้าอื่น ให้ความกว้างของแอปเป็นภาษาเดียวกัน */
const STATUS_PANEL_WIDTH = 360;

// หน้าตั้งค่าเครื่อง — ตอบคำถามเดียว: "ไอแพดเครื่องนี้เป็นของร้านไหน"
//
// ⚠️ คำตอบไม่ได้มาจากค่าที่กรอกที่นี่ — สิ่งที่กรอกคือ **token** ส่วนคำตอบว่าเป็นของร้าน/สาขาไหน
// มาจากเซิร์ฟเวอร์ตอนกด "ทดสอบการเชื่อมต่อ" เท่านั้น (`bmsPosSession`)
// ห้ามเพิ่มช่องให้เลือกร้าน/สาขาเองเด็ดขาด — เป็นกฎของทั้งระบบว่า tenant มาจาก token ฝั่ง server
export default function DeviceSettingsScreen({ route, navigation }: Props) {
  const { colors, spacing, typography, radius, minTouchTarget } = useTheme();
  const { isTablet } = useResponsive();
  const { status, target, storeError, verify, pair, unpair, runVerify } =
    useDevice();
  const { mode } = useStoreMode();

  const [input, setInput] = useState('');
  const [serverInput, setServerInput] = useState('');
  const [saving, setSaving] = useState(false);

  // ลิงก์ `bmspos://pair?t=...` ที่เปิดแอปขึ้นมา — react-navigation แกะ query ให้เป็น route params
  // **เติมลงช่องให้เฉย ๆ ไม่บันทึกเอง** โดยตั้งใจ: ลิงก์ที่ใครส่งมาก็ได้สามารถชี้เครื่องนี้ไป
  // เซิร์ฟเวอร์อื่นได้ คนกดต้องเห็นชื่อเซิร์ฟเวอร์ก่อนว่าใช่ของร้านตัวเองไหม แล้วค่อยกดบันทึก
  useEffect(() => {
    const t = route.params?.t;
    if (!t) return;
    const h = route.params?.h;
    setInput(`bmspos://pair?t=${t}${h ? `&h=${h}` : ''}`);
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
    if (!parsed?.ok || !effectiveServer) return;
    setSaving(true);
    try {
      await pair({ serverUrl: effectiveServer, token: parsed.token });
      setInput('');
      setServerInput('');
      // pair() ทดสอบ token ใหม่กับ server ให้เสร็จในตัว — จึงไม่เสี่ยงอ่าน target
      // รอบเก่าจาก React state และไม่ปล่อยให้คนเดินจากไปโดยคิดว่า token ใช้ได้แล้ว
    } catch (e: any) {
      Alert.alert('บันทึกไม่สำเร็จ', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function onUnpair() {
    Alert.alert(
      'เลิกจับคู่เครื่องนี้?',
      'เครื่องจะลืม token และใช้ขายไม่ได้จนกว่าจะจับคู่ใหม่ · token เดิมที่หน้าแอดมินยังใช้ได้อยู่ (ถ้ายังไม่ได้ออกใหม่)',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'เลิกจับคู่',
          style: 'destructive',
          onPress: async () => {
            try {
              await unpair();
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            } catch (e: any) {
              Alert.alert('เลิกจับคู่ไม่สำเร็จ', String(e?.message ?? e));
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
      <Card>
        <View style={styles.rowBetween}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            ประเภทร้านจากเซิร์ฟเวอร์
          </Text>
          <StatusPill
            label={
              mode === 'restaurant'
                ? 'ร้านอาหาร'
                : mode === 'pharmacy'
                ? 'ร้านขายยา'
                : 'ร้านทั่วไป'
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
          แอปอ่านค่านี้จากเครื่องที่จับคู่ไว้ ไม่รับ tenant สาขา
          หรือประเภทร้านจากผู้ใช้
        </Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            สถานะเครื่อง
          </Text>
          <StatusPill
            label={
              status === 'LOADING'
                ? 'กำลังอ่าน'
                : status === 'PAIRED'
                ? 'จับคู่แล้ว'
                : status === 'UNAVAILABLE'
                ? 'อ่านค่าไม่ได้'
                : 'ยังไม่จับคู่'
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
            อ่านค่าจากที่เก็บปลอดภัยของเครื่องไม่ได้ ({storeError}) —
            ยังไม่ต้องสรุปว่าเครื่องไม่เคยจับคู่
          </Text>
        )}

        {target ? (
          <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
            <FieldRow
              label="เซิร์ฟเวอร์"
              value={displayHost(target.serverUrl)}
            />
            {/* ห้ามโชว์ token เต็มตัว — จอนี้อยู่กลางร้าน และ token ไม่มีวันหมดอายุ */}
            <FieldRow label="token" value={maskToken(target.token)} />
          </View>
        ) : (
          status !== 'LOADING' && (
            <Text
              style={[
                typography.body,
                { color: colors.textMuted, marginTop: spacing.sm },
              ]}
            >
              เครื่องนี้ยังไม่ได้ผูกกับร้านไหน — วางลิงก์จับคู่ทางขวาเพื่อเริ่ม
            </Text>
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
            เครื่องนี้เป็นของร้านไหน
          </Text>

          {verify.kind === 'IDLE' && (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              ยังไม่ได้ถามเซิร์ฟเวอร์ — ค่าที่เก็บไว้บอกได้แค่ว่า
              “จะไปถามที่ไหน” ไม่ได้บอกว่า token ยังใช้ได้
            </Text>
          )}
          {verify.kind === 'CHECKING' && (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              กำลังถามเซิร์ฟเวอร์…
            </Text>
          )}
          {verify.kind === 'OK' && (
            <View style={{ gap: spacing.xs }}>
              <FieldRow label="สาขา" value={verify.info.branchName ?? '—'} />
              <FieldRow
                label="รหัสสาขา"
                value={verify.info.branchCode ?? '—'}
              />
              <FieldRow
                label="เครื่อง"
                value={`${verify.info.deviceCode}${
                  verify.info.deviceName ? ` · ${verify.info.deviceName}` : ''
                }`}
              />
              <FieldRow
                label="ประเภทจากเซิร์ฟเวอร์"
                value={
                  verify.info.businessArchetype === 'pharmacy'
                    ? 'ร้านขายยา'
                    : verify.info.surface === 'restaurant'
                    ? 'ร้านอาหาร'
                    : 'ร้านทั่วไป/ค้าปลีก'
                }
              />
              <FieldRow
                label="กะที่เปิดอยู่"
                value={verify.info.shiftOpen ? 'มี' : 'ยังไม่เปิดกะ'}
              />
              <FieldRow
                label="ผู้ปฏิบัติงานที่ขายได้"
                value={`${verify.info.cashierCount} คน`}
              />
              {/* ชื่อร้าน (tenant) ไม่อยู่ใน bmsPosSession — payload มีแค่สาขา/เครื่อง/เลขผู้เสียภาษี
                  ถ้าอยากให้จอบอก "ร้านชื่ออะไร" ต้องเพิ่มฟิลด์ที่ route ฝั่งเว็บก่อน */}
              <Text
                style={[
                  typography.caption,
                  { color: colors.textSoft, marginTop: spacing.xs },
                ]}
              >
                (เซิร์ฟเวอร์ยังไม่ส่งชื่อร้านมาให้ —
                ระบุตัวร้านได้จากเซิร์ฟเวอร์ + สาขา)
              </Text>
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
                ต่อไม่ได้ ≠ token ผิด — ยังไม่ต้องเลิกจับคู่
              </Text>
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
              label="ทดสอบการเชื่อมต่อ"
              variant="secondary"
              loading={verify.kind === 'CHECKING'}
              onPress={runVerify}
            />
            <Button label="เลิกจับคู่" variant="danger" onPress={onUnpair} />
          </View>
        </Card>
      )}
    </View>
  );

  // ---- แผงจับคู่: ช่องวางลิงก์ --------------------------------------------
  const pairPanel = (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
          ลิงก์จับคู่
        </Text>
        <Text
          style={[
            typography.caption,
            { color: colors.textSoft, marginTop: spacing.xs },
          ]}
        >
          เอามาจากระบบหลังบ้าน → เครื่องขาย (POS) → ปุ่ม “ออก token”
          แล้วคัดลอกลิงก์
        </Text>

        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={
            'bmspos://pair?t=pos_...\nหรือ https://ร้านของคุณ/pos?t=pos_...\nหรือวาง token ที่ขึ้นต้นด้วย pos_'
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
              label="token ที่อ่านได้"
              value={maskToken(parsed.token)}
            />
            <FieldRow
              label="เซิร์ฟเวอร์จากลิงก์"
              value={
                parsedServer
                  ? displayHost(parsedServer)
                  : 'ลิงก์นี้ไม่ได้พกมา — กรอกด้านล่าง'
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
              ที่อยู่เซิร์ฟเวอร์
            </Text>
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
              ไม่ต้องพิมพ์ https:// — เติมให้เอง (แอปไม่ยอมต่อแบบไม่เข้ารหัส
              เพราะ token วิ่งไปกับทุกคำขอ)
            </Text>
          </View>
        )}

        <Button
          label={target ? 'บันทึกและใช้ token ใหม่นี้' : 'จับคู่เครื่อง'}
          fullWidth
          disabled={!canSave}
          loading={saving}
          style={{ marginTop: spacing.lg }}
          onPress={onSave}
        />
      </Card>

      <Card>
        <Text
          style={[
            typography.captionStrong,
            { color: colors.textMuted, marginBottom: spacing.sm },
          ]}
        >
          ข้อควรรู้
        </Text>
        <Bullet>
          1 ไอแพด = 1 เครื่องขายในระบบ · ห้ามใช้ token เดียวกันหลายเครื่อง
          เลขใบเสร็จรันต่อเครื่อง และเปิดกะค้างได้เครื่องละกะเดียว
        </Bullet>
        <Bullet>
          ออก token ใหม่ที่หน้าแอดมินเมื่อไร ตัวเก่าใช้ไม่ได้ทันที —
          เป็นวิธีตัดเครื่องที่หายออกจากระบบ
        </Bullet>
        <Bullet>
          สาขาเป็นของเครื่อง ไม่ใช่ของคน — เปลี่ยนสาขาต้องไปแก้ที่หน้าแอดมิน
          ไม่ใช่ที่เครื่อง
        </Bullet>
        <Bullet>
          เครื่องจำ token ไว้จนกว่าจะกดเลิกจับคู่ ไม่ต้องใส่ใหม่ทุกวัน
        </Bullet>
      </Card>
    </View>
  );

  return (
    <ScreenContainer>
      <ScreenHeader
        title="ตั้งค่าเครื่อง"
        subtitle="ผูกไอแพดเครื่องนี้เข้ากับร้าน/สาขาในระบบ"
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />
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
