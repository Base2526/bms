import { posText, usePosLanguage, posLocale } from '../i18n/language';
import React, { useCallback } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  canRetryOfflineSale,
  type OfflineSaleRecord,
} from '../lib/offlineSales';
import { useOfflineSales } from '../state/OfflineSalesContext';
import { useServerHealth } from '../state/ServerHealthContext';
import { useShift } from '../state/ShiftContext';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Card } from './Card';
import { ScreenContainer } from './ScreenContainer';
import { ScreenHeader } from './ScreenHeader';
import { StatusPill, type StatusTone } from './StatusPill';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const STATE_LABEL: Record<
  OfflineSaleRecord['state'],
  { label: string; tone: StatusTone }
> = {
  STAGED: { get label() { return posText("เตรียมส่ง"); }, tone: 'warning' },
  UNKNOWN: { get label() { return posText("รอตรวจผล"); }, tone: 'warning' },
  SYNCING: { get label() { return posText("กำลังซิงก์"); }, tone: 'neutral' },
  NEEDS_REVIEW: { get label() { return posText("ต้องตรวจสอบ"); }, tone: 'danger' },
};

function reportFailure(error: unknown) {
  Alert.alert(
    posText("ซิงก์ไม่สำเร็จ"),
    error instanceof Error ? error.message : posText("กรุณาตรวจการเชื่อมต่อแล้วลองใหม่"),
  );
}

export function OfflineSyncCenter({ visible, onClose }: Props) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const health = useServerHealth();
  const shift = useShift();
  const queue = useOfflineSales();
  const offline = health.status === 'offline';
  const serverOnline = health.status === 'online';
  // Recovery by idempotency key is safe without an open shift. Only an unsold replay needs the
  // original shift; the provider stops before replay and sends that row to manager review.
  const canSync = serverOnline;

  const syncPending = useCallback(() => {
    queue.syncNow().catch(reportFailure);
  }, [queue]);

  const retryReview = useCallback(() => {
    queue.retryReview().catch(reportFailure);
  }, [queue]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <ScreenContainer edges={['top', 'bottom', 'left', 'right']}>
        <ScreenHeader
          title={posText("ศูนย์ซิงก์รายการออฟไลน์")}
          subtitle={posText("{v0} รายการที่ยังไม่จบ", { v0: queue.records.length })}
          onBack={onClose}
        />

        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.warningBg,
              borderColor: colors.warning,
              padding: spacing.md,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.warning }]}>
            {posText("เงินสดถูกรับที่หน้าร้านแล้ว แต่รายการรอซิงก์ยังไม่ใช่ใบเสร็จหรือเอกสารภาษี") + " "}</Text>
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, marginTop: spacing.xs },
            ]}
          >
            {posText("ระบบจะตรวจผลด้วยเลขอ้างอิงเดิมก่อนส่งซ้ำ และ Server จะตรวจราคา สต็อก ภาษี กะ และสิทธิ์อีกครั้ง") + " "}</Text>
        </View>

        {queue.storageError ? (
          <View
            style={[
              styles.notice,
              {
                backgroundColor: colors.dangerBg,
                borderColor: colors.danger,
                padding: spacing.md,
                marginBottom: spacing.md,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              {posText("เปิดคิวออฟไลน์ไม่ได้") + " "}</Text>
            <Text
              style={[
                typography.caption,
                { color: colors.textMuted, marginTop: spacing.xs },
              ]}
            >
              {queue.storageError}
            </Text>
          </View>
        ) : null}

        <View style={[styles.actions, { gap: spacing.sm }]}>
          <Button
            label={queue.syncing ? posText("กำลังซิงก์…") : posText("ซิงก์รายการรอส่ง")}
            onPress={syncPending}
            loading={queue.syncing}
            disabled={!canSync || queue.pendingCount === 0}
            fullWidth
            style={styles.action}
          />
          {queue.records.some(canRetryOfflineSale) ? (
            <Button
              label={posText("ลองใหม่เฉพาะรายการที่แก้สาเหตุได้")}
              onPress={retryReview}
              disabled={!canSync || queue.syncing}
              variant="secondary"
              fullWidth
              style={styles.action}
            />
          ) : null}
        </View>

        {!serverOnline || !shift.isOpen ? (
          <Text
            style={[
              typography.caption,
              {
                color: colors.warning,
                marginTop: spacing.sm,
                marginBottom: spacing.sm,
              },
            ]}
          >
            {!serverOnline
              ? offline
                ? posText("เครื่องยังออฟไลน์ — รายการจะอยู่ในคิวเข้ารหัสจนเชื่อมต่อได้")
                : posText("กำลังตรวจการเชื่อมต่อ — ระบบจะเปิดการซิงก์เมื่อ Server พร้อม")
              : posText("ตรวจผลรายการเดิมได้ แต่ถ้า Server ยังไม่มีบิล ระบบจะหยุดไว้ให้ผู้จัดการตรวจสอบและจะไม่ลงยอดเข้ากะใหม่")}
          </Text>
        ) : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={{
            gap: spacing.md,
            paddingVertical: spacing.md,
          }}
        >
          {queue.records.length === 0 ? (
            <Card elevated={false}>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                {posText("ไม่มีรายการออฟไลน์ค้างอยู่ในสาขานี้") + " "}</Text>
            </Card>
          ) : (
            queue.records.map(record => (
              <OfflineSaleCard
                key={record.id}
                record={record}
                retryDisabled={!canSync || queue.syncing}
                onRetry={() =>
                  queue.retryRecord(record.id).catch(reportFailure)
                }
              />
            ))
          )}
        </ScrollView>
      </ScreenContainer>
    </Modal>
  );
}

function OfflineSaleCard({
  record,
  retryDisabled,
  onRetry,
}: {
  record: OfflineSaleRecord;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const state = STATE_LABEL[record.state];
  const retryable = canRetryOfflineSale(record);
  const tenderedAt = new Date(record.tenderedAt);
  const tenderedLabel = Number.isFinite(tenderedAt.getTime())
    ? tenderedAt.toLocaleString(posLocale(), {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : record.tenderedAt;

  return (
    <Card>
      <View style={[styles.cardHeader, { gap: spacing.sm }]}>
        <View style={styles.cardTitle}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            {posText("฿")}{record.total.toFixed(2)}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {posText("อ้างอิง …")}{record.id.slice(-10)}
          </Text>
        </View>
        <StatusPill label={state.label} tone={state.tone} />
      </View>

      <Text
        style={[typography.body, { color: colors.text, marginTop: spacing.md }]}
      >
        {tenderedLabel} {" " + posText("· แคชเชียร์") + " "}{record.cashierName ?? posText("คนเดิม")}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textMuted, marginTop: spacing.xs },
        ]}
      >
        {record.payload.lines.length} {" " + posText("รายการสินค้า · ลองซิงก์แล้ว")}{' '}
        {record.attempts} {" " + posText("ครั้ง") + " "}</Text>

      {record.lastError ? (
        <View
          style={[
            styles.error,
            {
              backgroundColor: colors.dangerBg,
              padding: spacing.sm,
              marginTop: spacing.md,
            },
          ]}
        >
          <Text style={[typography.caption, { color: colors.danger }]}>
            {record.lastError}
          </Text>
        </View>
      ) : null}

      {retryable ? (
        <Button
          label={posText("แก้สาเหตุแล้ว ลองรายการนี้ใหม่")}
          onPress={onRetry}
          disabled={retryDisabled}
          variant="secondary"
          fullWidth
          style={{ marginTop: spacing.md }}
        />
      ) : record.state === 'NEEDS_REVIEW' ? (
        <Text
          style={[
            typography.captionStrong,
            { color: colors.danger, marginTop: spacing.md },
          ]}
        >
          {posText("Server ตัดสินรายการนี้แล้ว ห้ามส่งซ้ำหรือรับเงินซ้ำ กรุณาให้ผู้จัดการกระทบยอด") + " "}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { flexGrow: 1 },
  list: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { flex: 1 },
  error: { borderRadius: 8 },
});
