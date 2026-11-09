import React, { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobilePosPickupQueueActionDocument,
  MobilePosPickupQueueDocument,
} from '../graphql/generated';
import { usePickupQueueEnabled } from '../lib/pickupQueuePreference';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

type QueueAction = 'call' | 'collect' | 'unready' | 'cancel';
const DONE: Record<QueueAction, string> = {
  call: 'เรียกคิว',
  collect: 'บันทึกรับแล้ว',
  unready: 'ย้ายกลับไปกำลังเตรียม',
  cancel: 'ยกเลิกคิว',
};

/**
 * Pickup queue numbers at the mobile register (`10.111`). Tap a number to open its actions:
 * preparing → เรียกคิว / รับแล้ว / ยกเลิก, ready → เรียกซ้ำ / รับแล้ว / ย้อน / ยกเลิก.
 * Same rules as the web till: cashier PIN + `pos.sell`, branch-scoped on the server, numbers only.
 * Cancel asks again because it takes the number off the customer screen for good.
 */
export function PickupQueueStrip() {
  const deviceEnabled = usePickupQueueEnabled();
  const { session } = useSession();
  const enabled = deviceEnabled || session?.branch.pickupQueue?.enabled === true;
  const { colors, spacing, typography } = useTheme();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const actionLock = useRef(false);
  const { data, loading, error, refetch } = useQuery(MobilePosPickupQueueDocument, {
    skip: !enabled,
    pollInterval: enabled ? 5000 : 0,
    fetchPolicy: 'network-only',
  });
  const [act] = useMutation(MobilePosPickupQueueActionDocument);

  if (!enabled) return null;
  const rows = data?.bmsPosPickupQueue ?? [];
  const preparing = rows.filter(row => row.status === 'PREPARING');
  const ready = rows.filter(row => row.status === 'READY');
  const selected = rows.find(row => row.id === selectedId) ?? null;
  const firstLoad = loading && !data;
  const feedUnavailable = Boolean(error);
  const actionsDisabled = busy || firstLoad || feedUnavailable;

  const run = async (entryId: string, label: string, action: QueueAction) => {
    if (actionLock.current || firstLoad || feedUnavailable) return;
    if (!session) {
      setNotice({ ok: false, text: 'เข้าสู่ระบบด้วยพนักงานและ PIN ก่อน' });
      return;
    }
    actionLock.current = true;
    setBusy(true);
    try {
      await act({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            action,
            entryId,
            orderId: null,
          },
        },
      });
      setNotice({ ok: true, text: `${DONE[action]} ${label} แล้ว` });
      setSelectedId(null);
      await refetch().catch(() => {
        setNotice({
          ok: true,
          text: `${DONE[action]} ${label} แล้ว · แต่โหลดสถานะล่าสุดไม่สำเร็จ`,
        });
      });
    } catch (cause) {
      setNotice({
        ok: false,
        text: cause instanceof Error ? cause.message : 'ทำรายการคิวไม่สำเร็จ',
      });
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const retryFeed = () => {
    setNotice(null);
    refetch().catch(() => undefined);
  };

  const confirmCancel = (entryId: string, label: string) =>
    Alert.alert(`ยกเลิกคิว ${label}?`, 'เลขจะหายจากจอเรียกคิวของลูกค้า', [
      { text: 'ไม่ยกเลิก', style: 'cancel' },
      {
        text: 'ยืนยันยกเลิก',
        style: 'destructive',
        onPress: () => {
          run(entryId, label, 'cancel').catch(() => undefined);
        },
      },
    ]);

  const chip = (row: (typeof rows)[number]) => {
    const isReady = row.status === 'READY';
    const isSelected = row.id === selectedId;
    return (
      <Pressable
        key={row.id}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: actionsDisabled }}
        accessibilityLabel={`คิว ${row.label} ${isReady ? 'พร้อมรับ' : 'กำลังเตรียม'}`}
        disabled={actionsDisabled}
        onPress={() => setSelectedId(isSelected ? null : row.id)}
        style={[
          styles.chip,
          {
            backgroundColor: isReady ? 'rgba(22, 163, 74, 0.12)' : colors.surface2,
            borderColor: isSelected ? colors.primary : colors.border,
            borderWidth: isSelected ? 2 : 1,
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        <Text style={[typography.bodyStrong, { color: colors.text }]}>
          {row.label} · {isReady ? 'พร้อมรับ' : 'กำลังเตรียม'}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.sm }} testID="pickup-queue-strip">
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {firstLoad
          ? 'คิวรับของ · กำลังตรวจสอบสถานะล่าสุด…'
          : feedUnavailable
          ? 'คิวรับของ · ตรวจสถานะล่าสุดไม่ได้'
          : rows.length === 0
          ? 'คิวรับของ · ยังไม่มีคิวที่รออยู่'
          : `คิวรับของ · กำลังเตรียม ${preparing.length} · พร้อมรับ ${ready.length} · แตะเลขเพื่อจัดการ`}
      </Text>
      {feedUnavailable ? (
        <View style={styles.feedWarning}>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.caption, { color: colors.danger }]}
          >
            ยังยืนยันรายการคิวปัจจุบันไม่ได้ ปุ่มจัดการคิวถูกพักไว้เพื่อป้องกันการกดซ้ำ
          </Text>
          <Button
            label={loading ? 'กำลังลองใหม่…' : 'ลองโหลดคิวใหม่'}
            variant="secondary"
            disabled={loading}
            onPress={retryFeed}
          />
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View style={styles.row}>
          {preparing.map(chip)}
          {ready.map(chip)}
        </View>
      ) : null}
      {selected ? (
        <View style={styles.row} testID="pickup-queue-actions">
          <Button
            label={selected.status === 'READY' ? `เรียกซ้ำ ${selected.label}` : `เรียกคิว ${selected.label}`}
            variant="primary"
            disabled={actionsDisabled}
            onPress={() => { run(selected.id, selected.label, 'call').catch(() => undefined); }}
          />
          <Button
            label="รับแล้ว"
            variant="secondary"
            disabled={actionsDisabled}
            onPress={() => { run(selected.id, selected.label, 'collect').catch(() => undefined); }}
          />
          {selected.status === 'READY' ? (
            <Button
              label="ย้อน"
              variant="secondary"
              disabled={actionsDisabled}
              onPress={() => { run(selected.id, selected.label, 'unready').catch(() => undefined); }}
            />
          ) : null}
          <Button
            label="ยกเลิกคิว"
            variant="danger"
            disabled={actionsDisabled}
            onPress={() => confirmCancel(selected.id, selected.label)}
          />
        </View>
      ) : null}
      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, { color: notice.ok ? colors.success : colors.danger }]}
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Receipt screen banner when a committed sale did not get its number: ask again for the same
 * bill. The server returns the existing number if one was issued meanwhile (one bill, one number).
 */
export function PickupQueueRetryBanner({
  orderId,
  reason,
  onIssued,
}: {
  orderId: string;
  reason: string;
  onIssued: () => void;
}) {
  const { session } = useSession();
  const { colors, spacing, typography } = useTheme();
  const [act] = useMutation(MobilePosPickupQueueActionDocument);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issueLock = useRef(false);
  const retry = async () => {
    if (issueLock.current) return;
    if (!session) {
      setError('เข้าสู่ระบบด้วยพนักงานและ PIN ก่อน');
      return;
    }
    issueLock.current = true;
    setBusy(true);
    try {
      await act({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            action: 'issue',
            entryId: null,
            orderId,
          },
        },
      });
      setError(null);
      onIssued();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ออกเลขคิวไม่สำเร็จ');
    } finally {
      issueLock.current = false;
      setBusy(false);
    }
  };
  return (
    <View
      testID="pickup-queue-retry"
      style={{
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.danger,
        backgroundColor: colors.dangerBg,
      }}
    >
      <Text style={[typography.bodyStrong, { color: colors.danger }]}>
        ขายสำเร็จแล้ว แต่ออกเลขคิวไม่ได้
      </Text>
      <Text style={[typography.caption, { color: colors.text }]}>{reason}</Text>
      <Button
        label={busy ? 'กำลังออกเลข…' : 'ออกเลขคิวใหม่'}
        variant="primary"
        disabled={busy}
        onPress={() => { retry().catch(() => undefined); }}
      />
      {error ? (
        <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 10, minHeight: 44, justifyContent: 'center' },
  feedWarning: { gap: 8, alignItems: 'flex-start' },
});
