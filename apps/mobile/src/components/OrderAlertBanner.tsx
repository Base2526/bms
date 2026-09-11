import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { useOrderAlerts } from '../state/OrderAlertContext';
import { useIncomingOrders } from '../state/IncomingOrdersContext';

interface Props {
  /** พาไปจอคิวออร์เดอร์เข้า — แถบที่บอกว่ามีงานแต่ไปต่อไม่ได้คือแถบที่คนเรียนรู้ที่จะเมิน */
  onOpenQueue: () => void;
}

/**
 * แถบแจ้งเตือนบนสุดของทุกแท็บ
 *
 * ⚠️ นี่คือช่องทางที่ **การันตีได้** ของการแจ้งเตือน — เสียงต้องมี native module และ
 * แท็บเล็ตหน้าร้านส่วนใหญ่ไม่มีมอเตอร์สั่น ถ้าพึ่งสองอย่างนั้นอย่างเดียว ร้านจะมีออร์เดอร์
 * ที่ไม่มีใครรู้ว่าเข้ามา · แถบนี้จึงขึ้นตราบใดที่ยังมีใบที่ไม่มีใครรับ ไม่ว่าเสียงจะดังหรือไม่
 */
export function OrderAlertBanner({ onOpenQueue }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const { pendingCount } = useIncomingOrders();
  const { blockedNotice, acknowledged, acknowledge } = useOrderAlerts();

  if (pendingCount === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`มีออร์เดอร์เข้า ${pendingCount} ใบ แตะเพื่อเปิดคิว`}
      onPress={onOpenQueue}
      style={[
        styles.wrap,
        {
          backgroundColor: acknowledged ? colors.warningBg : colors.danger,
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.md,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            typography.bodyStrong,
            { color: acknowledged ? colors.warning : colors.primaryText },
          ]}
        >
          มีออร์เดอร์เข้า {pendingCount} ใบรอรับ
        </Text>
        {blockedNotice ? (
          <Text
            style={[
              typography.caption,
              { color: acknowledged ? colors.textMuted : colors.primaryText },
            ]}
          >
            {blockedNotice}
          </Text>
        ) : null}
      </View>
      {!acknowledged && (
        <Button
          label="รับทราบ"
          accessibilityLabel="รับทราบการแจ้งเตือน หยุดการย้ำซ้ำจนกว่าจะมีใบใหม่"
          variant="secondary"
          onPress={acknowledge}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
