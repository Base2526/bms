import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Card } from './Card';
import {
  MOCK_DISCOUNT_APPROVER_PIN,
  mockCoupons,
  mockMembers,
} from '../mocks/checkout';
import {
  calculateMockDiscounts,
  couponEligibilityError,
} from '../lib/checkoutMath';
import { useCart } from '../state/CartContext';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';

type Tool = 'member' | 'coupon' | 'discount';

export function CheckoutAdjustmentsCard() {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const {
    subtotal,
    member,
    setMember,
    coupon,
    setCoupon,
    manualDiscount,
    setManualDiscount,
  } = useCart();
  const [tool, setTool] = useState<Tool | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (tool === 'coupon') setCouponCode(coupon?.code ?? '');
    if (tool === 'discount') {
      setAmount(manualDiscount?.amount.toString() ?? '');
      setReason(manualDiscount?.reason ?? '');
      setApproverPin('');
    }
  }, [coupon, manualDiscount, tool]);

  const close = () => setTool(null);

  const applyCoupon = () => {
    const found = mockCoupons.find(
      item => item.code === couponCode.trim().toUpperCase(),
    );
    if (!found) {
      setError('ไม่พบคูปองนี้ในข้อมูลทดสอบ');
      return;
    }
    const eligibilityError = couponEligibilityError(
      found,
      subtotal,
      Boolean(member),
    );
    if (eligibilityError) {
      setError(eligibilityError);
      return;
    }
    setCoupon(found);
    close();
  };

  const applyManualDiscount = () => {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('กรอกจำนวนส่วนลดที่มากกว่า 0');
      return;
    }
    if (!reason.trim()) {
      setError('ต้องระบุเหตุผลของส่วนลด');
      return;
    }
    if (approverPin !== MOCK_DISCOUNT_APPROVER_PIN) {
      setError('PIN ผู้อนุมัติไม่ถูกต้อง (โหมดทดสอบใช้ 9999)');
      return;
    }

    const proposed = {
      amount: parsedAmount,
      reason: reason.trim(),
      approverName: 'ผู้จัดการทดสอบ',
    };
    const preview = calculateMockDiscounts({
      subtotal,
      member,
      coupon,
      manualDiscount: proposed,
    });
    if (preview.manualDiscount !== parsedAmount) {
      setError(
        `ส่วนลดรวมเกินเพดานทดสอบ 30% — ใส่ส่วนลดพิเศษได้อีกไม่เกิน ฿${preview.manualDiscount.toFixed(
          2,
        )}`,
      );
      return;
    }
    setManualDiscount(proposed);
    setApproverPin('');
    close();
  };

  const rows: Array<{
    key: Tool;
    title: string;
    value: string;
    active: boolean;
  }> = [
    {
      key: 'member',
      title: 'สมาชิก',
      value: member
        ? `${member.name} · ${member.tier} ลด ${member.tierDiscountPct}%`
        : 'ค้นหาด้วยเบอร์หรือเลขสมาชิก',
      active: Boolean(member),
    },
    {
      key: 'coupon',
      title: 'คูปอง',
      value: coupon ? `${coupon.code} · ${coupon.label}` : 'กรอกรหัสคูปอง',
      active: Boolean(coupon),
    },
    {
      key: 'discount',
      title: 'ส่วนลดพิเศษ',
      value: manualDiscount
        ? `฿${manualDiscount.amount.toFixed(2)} · ${manualDiscount.reason}`
        : 'ต้องมีเหตุผลและ PIN ผู้อนุมัติ',
      active: Boolean(manualDiscount),
    },
  ];

  return (
    <>
      <Card>
        <View style={styles.cardHeader}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            สิทธิประโยชน์และส่วนลด
          </Text>
          <Text
            style={[
              typography.captionStrong,
              {
                color: colors.warning,
                backgroundColor: colors.warningBg,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
              },
            ]}
          >
            TEST
          </Text>
        </View>
        <View style={{ marginTop: spacing.sm }}>
          {rows.map((row, index) => (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`${row.title} ${row.value}`}
              onPress={() => setTool(row.key)}
              style={({ pressed }) => [
                styles.toolRow,
                {
                  minHeight: 54,
                  paddingVertical: spacing.sm,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    typography.bodyStrong,
                    { color: row.active ? colors.primary : colors.text },
                  ]}
                >
                  {row.active ? '✓ ' : '+ '}
                  {row.title}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[typography.caption, { color: colors.textMuted }]}
                >
                  {row.value}
                </Text>
              </View>
              <Text style={[typography.subtitle, { color: colors.textMuted }]}>
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Modal
        transparent
        visible={tool !== null}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={close}
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
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View
            accessibilityViewIsModal
            style={[
              styles.modalCard,
              {
                width: isTablet ? 520 : '100%',
                maxHeight: isTablet ? '82%' : '88%',
                paddingHorizontal: isTablet ? spacing.xxl : spacing.xl,
                paddingTop: isTablet ? spacing.xxl : spacing.xl,
                paddingBottom: isTablet
                  ? spacing.xxl
                  : spacing.xl + insets.bottom,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: isTablet ? radius.lg : 0,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
              },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              {tool === 'member' && (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    เลือกสมาชิก
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textMuted, marginTop: spacing.xs },
                    ]}
                  >
                    ข้อมูลจำลองสำหรับทดสอบ tier และคะแนน
                  </Text>
                  <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
                    {mockMembers.map(option => (
                      <Pressable
                        key={option.id}
                        onPress={() => {
                          setMember(option);
                          close();
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            padding: spacing.md,
                            borderRadius: radius.md,
                            borderColor:
                              member?.id === option.id
                                ? colors.primary
                                : colors.border,
                            backgroundColor: pressed
                              ? colors.surface2
                              : colors.surface,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            typography.bodyStrong,
                            { color: colors.text },
                          ]}
                        >
                          {option.name}
                        </Text>
                        <Text
                          style={[
                            typography.caption,
                            { color: colors.textMuted },
                          ]}
                        >
                          {option.memberNo} · {option.phone}
                        </Text>
                        <Text
                          style={[
                            typography.captionStrong,
                            { color: colors.primary, marginTop: spacing.xs },
                          ]}
                        >
                          {option.tier} · ลด {option.tierDiscountPct}% ·{' '}
                          {option.points.toLocaleString()} คะแนน
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {member && (
                    <Button
                      label="นำสมาชิกออกจากบิล"
                      variant="ghost"
                      fullWidth
                      style={{ marginTop: spacing.md }}
                      onPress={() => {
                        setMember(null);
                        if (coupon?.memberOnly) setCoupon(null);
                        close();
                      }}
                    />
                  )}
                </>
              )}

              {tool === 'coupon' && (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ใช้คูปอง
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textMuted, marginTop: spacing.xs },
                    ]}
                  >
                    ลองใช้ SAVE20 หรือ MEMBER10
                  </Text>
                  <FormInput
                    value={couponCode}
                    onChangeText={setCouponCode}
                    placeholder="รหัสคูปอง"
                    autoCapitalize="characters"
                  />
                  <Button
                    label="ตรวจสอบและใช้คูปอง"
                    fullWidth
                    style={{ marginTop: spacing.lg }}
                    onPress={applyCoupon}
                  />
                  {coupon && (
                    <Button
                      label="นำคูปองออก"
                      variant="ghost"
                      fullWidth
                      style={{ marginTop: spacing.sm }}
                      onPress={() => {
                        setCoupon(null);
                        close();
                      }}
                    />
                  )}
                </>
              )}

              {tool === 'discount' && (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ส่วนลดพิเศษ
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textMuted, marginTop: spacing.xs },
                    ]}
                  >
                    โหมดทดสอบใช้ PIN ผู้อนุมัติ 9999 · PIN จะไม่ถูกเก็บ
                  </Text>
                  <FormInput
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="จำนวนเงินส่วนลด"
                    keyboardType="decimal-pad"
                  />
                  <FormInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="เหตุผลส่วนลด"
                  />
                  <FormInput
                    value={approverPin}
                    onChangeText={setApproverPin}
                    placeholder="PIN ผู้อนุมัติ"
                    keyboardType="number-pad"
                    secureTextEntry
                  />
                  <Button
                    label="อนุมัติส่วนลด"
                    fullWidth
                    style={{ marginTop: spacing.lg }}
                    onPress={applyManualDiscount}
                  />
                  {manualDiscount && (
                    <Button
                      label="นำส่วนลดพิเศษออก"
                      variant="ghost"
                      fullWidth
                      style={{ marginTop: spacing.sm }}
                      onPress={() => {
                        setManualDiscount(null);
                        close();
                      }}
                    />
                  )}
                </>
              )}

              {error ? (
                <Text
                  style={[
                    typography.captionStrong,
                    { color: colors.danger, marginTop: spacing.md },
                  ]}
                >
                  {error}
                </Text>
              ) : null}
              <Button
                label="ปิด"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={close}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function FormInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'none',
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'characters';
}) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSoft}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      style={[
        typography.body,
        {
          minHeight: 48,
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          borderRadius: radius.md,
          color: colors.text,
          backgroundColor: colors.surface,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  overlay: { flex: 1, alignItems: 'center' },
  modalCard: {
    maxWidth: 520,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  option: { borderWidth: StyleSheet.hairlineWidth },
});
