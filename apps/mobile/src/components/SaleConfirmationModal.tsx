import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';
import {
  calculateCashChange,
  paymentMethodLabel,
  type MockPaymentInput,
} from '../lib/paymentMath';

interface Props {
  visible: boolean;
  subtotal: number;
  discountTotal: number;
  total: number;
  itemCount: number;
  payments: MockPaymentInput[];
  memberName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * ด่านยืนยันสุดท้ายของ mock checkout
 *
 * ตอนต่อ backend ปุ่มยืนยันต้องเรียก settlement เพียงครั้งเดียวด้วย idempotency key
 * และรอผลสำเร็จก่อนพาไปใบเสร็จ — modal นี้ยังไม่ใช่หลักฐานว่าขายสำเร็จ
 */
export function SaleConfirmationModal({
  visible,
  subtotal,
  discountTotal,
  total,
  itemCount,
  payments,
  memberName,
  onCancel,
  onConfirm,
}: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View
        style={[
          styles.overlay,
          {
            backgroundColor: colors.overlay,
            justifyContent: isTablet ? 'center' : 'flex-end',
            padding: isTablet ? spacing.xl : 0,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ปิดหน้าต่างยืนยันการขาย"
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
        />

        <View
          accessibilityViewIsModal
          accessibilityLabel="ยืนยันการขาย"
          style={[
            styles.card,
            {
              width: isTablet ? 520 : '100%',
              paddingHorizontal: isTablet ? spacing.xxl : spacing.xl,
              paddingTop: isTablet ? spacing.xxl : spacing.xl,
              paddingBottom: isTablet
                ? spacing.xxl
                : spacing.xl + insets.bottom,
              borderRadius: isTablet ? radius.lg : 0,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[styles.checkCircle, { backgroundColor: colors.successBg }]}
          >
            <Text style={[styles.check, { color: colors.success }]}>✓</Text>
          </View>

          <Text
            style={[
              typography.title,
              styles.centerText,
              { color: colors.text, marginTop: spacing.md },
            ]}
          >
            ยืนยันการขาย
          </Text>
          <Text
            style={[
              typography.body,
              styles.centerText,
              { color: colors.textMuted, marginTop: spacing.xs },
            ]}
          >
            ตรวจสอบข้อมูลก่อนบันทึกการขาย
          </Text>

          <View
            style={[
              styles.summary,
              {
                marginTop: spacing.xl,
                borderColor: colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            {discountTotal > 0 && (
              <>
                <SummaryRow
                  label="ยอดสินค้า"
                  value={`฿${subtotal.toFixed(2)}`}
                />
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
                <SummaryRow
                  label="ส่วนลดรวม"
                  value={`−฿${discountTotal.toFixed(2)}`}
                  valueColor={colors.success}
                />
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              </>
            )}
            <SummaryRow
              label="ยอดสุทธิ"
              value={`฿${total.toFixed(2)}`}
              strong
            />
            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />
            {payments.map((payment, index) => (
              <React.Fragment key={payment.id}>
                <SummaryRow
                  label={`ชำระ ${index + 1}`}
                  value={`${paymentMethodLabel(payment.method)} ฿${payment.amount.toFixed(2)}`}
                />
                {payment.method === 'cash' ? (
                  <SummaryRow
                    label="เงินทอน"
                    value={`฿${calculateCashChange(
                      payment.amount,
                      payment.tendered ?? 0,
                    ).toFixed(2)}`}
                  />
                ) : (
                  <SummaryRow
                    label="เลขอ้างอิง"
                    value={payment.reference?.trim() || '-'}
                  />
                )}
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              </React.Fragment>
            ))}
            {memberName && (
              <>
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
                <SummaryRow label="สมาชิก" value={memberName} />
              </>
            )}
            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />
            <SummaryRow label="จำนวน" value={`${itemCount} รายการ`} />
          </View>

          <View
            style={[
              styles.notice,
              {
                marginTop: spacing.lg,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.warningBg,
              },
            ]}
          >
            <Text
              style={[
                typography.captionStrong,
                { color: colors.warning, flex: 1 },
              ]}
            >
              เมื่อยืนยันแล้ว หากต้องแก้ไขต้องทำรายการคืน
            </Text>
          </View>

          <View
            style={[
              styles.actions,
              {
                flexDirection: isTablet ? 'row' : 'column',
                gap: spacing.md,
                marginTop: spacing.xl,
              },
            ]}
          >
            <Button
              label="กลับไปแก้ไข"
              variant="secondary"
              fullWidth
              style={isTablet ? styles.flexButton : undefined}
              onPress={onCancel}
            />
            <Button
              label="ยืนยันและออกใบเสร็จ"
              fullWidth
              style={isTablet ? styles.flexButton : undefined}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
  valueColor,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueColor?: string;
}) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={[styles.summaryRow, { padding: spacing.md }]}>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          strong ? typography.subtitle : typography.bodyStrong,
          { color: valueColor ?? colors.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
  },
  card: {
    maxWidth: 520,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
  centerText: {
    textAlign: 'center',
  },
  summary: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    alignItems: 'stretch',
  },
  flexButton: {
    flex: 1,
  },
});
