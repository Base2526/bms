import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@apollo/client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Card } from './Card';
import {
  MobilePosMembersDocument,
  PosBootstrapDocument,
} from '../graphql/generated';
import { useCart } from '../state/CartContext';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';

type Tool = 'member' | 'coupon' | 'discount';

export function CheckoutAdjustmentsCard() {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { session } = useSession();
  const [tool, setTool] = useState<Tool | null>(null);
  const [search, setSearch] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [error, setError] = useState('');

  const members = useQuery(MobilePosMembersDocument, {
    variables: { q: search.trim() || null, amount: cart.subtotal },
    skip: tool !== 'member',
  });
  const bootstrap = useQuery(PosBootstrapDocument);
  const approvers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    item => item.id !== session?.cashier.id,
  );
  const discountApprovers = approvers.filter(item =>
    item.approvals.includes('pos.discount.approve'),
  );
  const approver =
    discountApprovers.find(item => item.id === approverId && item.hasPin) ??
    discountApprovers.find(item => item.hasPin) ??
    null;

  const rows = useMemo(
    () => [
      {
        key: 'member' as const,
        title: 'สมาชิก',
        value: cart.member
          ? [cart.member.name, cart.member.memberNo].filter(Boolean).join(' · ')
          : 'ค้นหาชื่อ เบอร์ หรือเลขสมาชิก',
      },
      {
        key: 'coupon' as const,
        title: 'คูปอง',
        value: cart.coupon?.code ?? 'กรอกรหัสคูปอง',
      },
      {
        key: 'discount' as const,
        title: 'ส่วนลดพิเศษ',
        value: cart.manualDiscount
          ? `฿${cart.manualDiscount.amount.toFixed(2)} · ${
              cart.manualDiscount.reason
            }`
          : 'ต้องมีเหตุผลและผู้อนุมัติ',
      },
    ],
    [cart.coupon?.code, cart.manualDiscount, cart.member],
  );

  const close = () => {
    setTool(null);
    setError('');
    setApproverPin('');
  };

  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setError('กรอกรหัสคูปอง');
      return;
    }
    cart.setCoupon({ code });
    close();
  };

  const applyDiscount = () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('กรอกจำนวนส่วนลดที่มากกว่า 0');
      return;
    }
    if (!reason.trim()) {
      setError('ต้องระบุเหตุผลของส่วนลด');
      return;
    }
    if (!approver || !approverPin) {
      setError('เลือกผู้อนุมัติและกรอก PIN');
      return;
    }
    cart.setManualDiscount({
      amount: parsed,
      reason: reason.trim(),
      approverUserId: approver.id,
      approverName: approver.name ?? approver.id,
      approverPin,
    });
    close();
  };

  return (
    <>
      <Card>
        <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
          สิทธิประโยชน์และส่วนลด
        </Text>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            onPress={() => {
              setError('');
              setTool(row.key);
              if (row.key === 'coupon') {
                setCouponCode(cart.coupon?.code ?? '');
              }
              if (row.key === 'discount') {
                setAmount(cart.manualDiscount?.amount.toString() ?? '');
                setReason(cart.manualDiscount?.reason ?? '');
                setApproverId(
                  cart.manualDiscount?.approverUserId ??
                    discountApprovers.find(item => item.hasPin)?.id ??
                    '',
                );
              }
            }}
            style={[
              styles.toolRow,
              {
                minHeight: 54,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {row.title}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {row.value}
              </Text>
            </View>
            <Text style={[typography.subtitle, { color: colors.textMuted }]}>
              ›
            </Text>
          </Pressable>
        ))}
        {cart.previewLoading ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            กำลังตรวจสิทธิ์กับเซิร์ฟเวอร์…
          </Text>
        ) : cart.previewError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>
            {cart.previewError}
          </Text>
        ) : null}
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
                maxHeight: '88%',
                paddingHorizontal: spacing.xl,
                paddingTop: spacing.xl,
                paddingBottom: spacing.xl + (isTablet ? 0 : insets.bottom),
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: isTablet ? radius.lg : 0,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
              },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              {tool === 'member' ? (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    เลือกสมาชิก
                  </Text>
                  <FormInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="ชื่อ เบอร์ หรือเลขสมาชิก"
                  />
                  <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    {(members.data?.bmsPosMemberSearch.members ?? []).map(
                      option => (
                        <Button
                          key={option.customerId}
                          label={[option.name, option.memberNo]
                            .filter(Boolean)
                            .join(' · ')}
                          variant="secondary"
                          fullWidth
                          onPress={() => {
                            cart.setMember({
                              id: option.customerId,
                              memberNo: option.memberNo,
                              name: option.name,
                              phone: option.phone,
                              tier: option.tier?.name ?? null,
                              tierDiscountPct:
                                option.tier?.discountType === 'PERCENT'
                                  ? option.tier.discountValue
                                  : 0,
                              points: option.pointsBalance,
                              pointsUsable: option.pointsUsable,
                            });
                            close();
                          }}
                        />
                      ),
                    )}
                  </View>
                  {cart.member ? (
                    <Button
                      label="นำสมาชิกออกจากบิล"
                      variant="ghost"
                      fullWidth
                      style={{ marginTop: spacing.md }}
                      onPress={() => {
                        cart.setMember(null);
                        close();
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              {tool === 'coupon' ? (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ใช้คูปอง
                  </Text>
                  <FormInput
                    value={couponCode}
                    onChangeText={setCouponCode}
                    placeholder="รหัสคูปอง"
                    autoCapitalize="characters"
                  />
                  <Button
                    label="ตรวจสอบกับเซิร์ฟเวอร์"
                    fullWidth
                    style={{ marginTop: spacing.md }}
                    onPress={applyCoupon}
                  />
                  {cart.coupon ? (
                    <Button
                      label="นำคูปองออก"
                      variant="ghost"
                      fullWidth
                      onPress={() => {
                        cart.setCoupon(null);
                        close();
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              {tool === 'discount' ? (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ส่วนลดพิเศษ
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
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted, marginTop: spacing.md },
                    ]}
                  >
                    ผู้อนุมัติ
                  </Text>
                  <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                    {discountApprovers.map(option => (
                      <Button
                        key={option.id}
                        label={`${option.name ?? option.id}${
                          option.hasPin ? '' : ' · ยังไม่ได้ตั้ง PIN'
                        }`}
                        variant={
                          approver?.id === option.id ? 'primary' : 'secondary'
                        }
                        fullWidth
                        disabled={!option.hasPin}
                        onPress={() => setApproverId(option.id)}
                      />
                    ))}
                  </View>
                  <FormInput
                    value={approverPin}
                    onChangeText={setApproverPin}
                    placeholder="PIN ผู้อนุมัติ"
                    keyboardType="number-pad"
                    secureTextEntry
                  />
                  <Button
                    label="ใช้ส่วนลด"
                    fullWidth
                    style={{ marginTop: spacing.md }}
                    onPress={applyDiscount}
                  />
                </>
              ) : null}

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
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
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
});
