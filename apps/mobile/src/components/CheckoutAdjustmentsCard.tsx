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
import { useMutation, useQuery } from '@apollo/client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from './Button';
import { Card } from './Card';
import {
  MobilePosMembersDocument,
  MobilePosEnrollMemberDocument,
  PosBootstrapDocument,
} from '../graphql/generated';
import { useCart } from '../state/CartContext';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';
import type { PosMember } from '../types/pos';

type Tool = 'member' | 'points' | 'coupon' | 'discount' | 'extra';
type Presentation = 'stacked' | 'horizontal' | 'collapsed';

type MemberSelection = {
  member: PosMember | null;
  setMember: (member: PosMember | null) => void;
  amount: number;
};
type BenefitsSelection = {
  coupon: { code: string } | null;
  setCoupon: (coupon: { code: string } | null) => void;
  pointsToRedeem: number;
  setPointsToRedeem: (points: number) => void;
  manualDiscount: {
    amount: number;
    reason: string;
    approverUserId: string;
    approverName: string;
    approverPin: string;
  } | null;
  setManualDiscount: (discount: BenefitsSelection['manualDiscount']) => void;
};

export function CheckoutAdjustmentsCard({
  memberOnly = false,
  hideExtra = false,
  memberSelection,
  benefitsSelection,
  amountOverride,
  pointsUsedOverride,
  previewLoadingOverride,
  previewErrorOverride,
  presentation = 'stacked',
}: {
  memberOnly?: boolean;
  hideExtra?: boolean;
  memberSelection?: MemberSelection;
  benefitsSelection?: BenefitsSelection;
  amountOverride?: number;
  pointsUsedOverride?: number;
  previewLoadingOverride?: boolean;
  previewErrorOverride?: string | null;
  presentation?: Presentation;
}) {
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
  const [memberPhone, setMemberPhone] = useState('');
  const [memberName, setMemberName] = useState('');
  const [points, setPoints] = useState('');
  const [extraLabel, setExtraLabel] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState(presentation === 'stacked');
  const [enrollMember] = useMutation(MobilePosEnrollMemberDocument);
  const selectedMember = memberSelection ? memberSelection.member : cart.member;
  const setSelectedMember = memberSelection
    ? memberSelection.setMember
    : cart.setMember;
  const coupon = benefitsSelection?.coupon ?? cart.coupon;
  const setCoupon = benefitsSelection?.setCoupon ?? cart.setCoupon;
  const pointsToRedeem = benefitsSelection?.pointsToRedeem ?? cart.pointsToRedeem;
  const setPointsToRedeem = benefitsSelection?.setPointsToRedeem ?? cart.setPointsToRedeem;
  const manualDiscount = benefitsSelection?.manualDiscount ?? cart.manualDiscount;
  const setManualDiscount = benefitsSelection?.setManualDiscount ?? cart.setManualDiscount;
  const memberAmount =
    amountOverride ??
    (memberSelection ? memberSelection.amount : cart.subtotal);
  const pointsUsed = pointsUsedOverride ?? cart.pointsUsed;
  const previewLoading = previewLoadingOverride ?? cart.previewLoading;
  const previewError =
    previewErrorOverride === undefined
      ? cart.previewError
      : previewErrorOverride;

  const members = useQuery(MobilePosMembersDocument, {
    variables: { q: search.trim() || null, amount: memberAmount },
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

  const rows = useMemo(() => {
    const allRows = [
      {
        key: 'member' as const,
        title: 'สมาชิก',
        value: selectedMember
          ? [selectedMember.name, selectedMember.memberNo]
              .filter(Boolean)
              .join(' · ')
          : 'ค้นหาชื่อ เบอร์ หรือเลขสมาชิก',
      },
      {
        key: 'points' as const,
        title: 'ใช้แต้ม',
        // ⚠️ ต้องบอก "แต้มที่หักจริง" ที่ server ตอบกลับมา ไม่ใช่ตัวเลขที่แคชเชียร์พิมพ์ —
        // เศษที่ไม่ครบหน่วยแลก/ต่ำกว่าขั้นต่ำ/ชนเพดานส่วนลด จะถูกตัดออกเงียบ ๆ แล้ว
        // ยอดที่จอโชว์กับจำนวนแต้มที่บอกลูกค้าจะไม่ใช่เรื่องเดียวกัน
        value: selectedMember
          ? pointsToRedeem > 0
            ? pointsUsed === pointsToRedeem
              ? `${pointsUsed} แต้ม`
              : `ขอ ${pointsToRedeem} · หักได้จริง ${pointsUsed} แต้ม`
            : `ใช้ได้ ${Math.floor(selectedMember.pointsUsable)} แต้ม`
          : 'เลือกสมาชิกก่อนใช้แต้ม',
      },
      {
        key: 'extra' as const,
        title: 'ค่าบริการ / ถุง',
        value: cart.extraLines.length
          ? `${cart.extraLines.length} รายการ · ฿${cart.extraTotal.toFixed(2)}`
          : 'เพิ่มรายการนอกสินค้า',
      },
      {
        key: 'coupon' as const,
        title: 'คูปอง',
        value: coupon?.code ?? 'กรอกรหัสคูปอง',
      },
      {
        key: 'discount' as const,
        title: 'ส่วนลดพิเศษ',
        value: manualDiscount
          ? `฿${manualDiscount.amount.toFixed(2)} · ${
              manualDiscount.reason
            }`
          : 'ต้องมีเหตุผลและผู้อนุมัติ',
      },
    ];
    if (memberOnly) return allRows.filter(row => row.key === 'member');
    return hideExtra ? allRows.filter(row => row.key !== 'extra') : allRows;
  }, [
    coupon?.code,
    cart.extraLines.length,
    cart.extraTotal,
    manualDiscount,
    pointsToRedeem,
    memberOnly,
    hideExtra,
    pointsUsed,
    selectedMember,
  ]);

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
    setCoupon({ code });
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
    setManualDiscount({
      amount: parsed,
      reason: reason.trim(),
      approverUserId: approver.id,
      approverName: approver.name ?? approver.id,
      approverPin,
    });
    close();
  };

  const openTool = (nextTool: Tool) => {
    setError('');
    setTool(nextTool);
    if (nextTool === 'coupon') {
      setCouponCode(coupon?.code ?? '');
    }
    if (nextTool === 'discount') {
      setAmount(manualDiscount?.amount.toString() ?? '');
      setReason(manualDiscount?.reason ?? '');
      setApproverId(
        manualDiscount?.approverUserId ??
          discountApprovers.find(item => item.hasPin)?.id ??
          '',
      );
    }
    if (nextTool === 'points') {
      setPoints(String(pointsToRedeem || 0));
    }
  };

  const activeAdjustmentCount = memberOnly
    ? Number(Boolean(selectedMember))
    : [
        selectedMember,
        pointsToRedeem > 0,
        !hideExtra && cart.extraLines.length > 0,
        coupon,
        manualDiscount,
      ].filter(Boolean).length;

  const visibleRows =
    presentation === 'horizontal'
      ? rows.filter(row => row.key !== 'extra')
      : rows;
  const rowButtons = visibleRows.map((row, index) => (
    <Pressable
      key={row.key}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}: ${row.value}`}
      onPress={() => openTool(row.key)}
      style={({ pressed }) => [
        presentation === 'horizontal' ? styles.horizontalTool : styles.toolRow,
        {
          minHeight: presentation === 'horizontal' ? 64 : 54,
          borderTopWidth:
            presentation === 'stacked' && index > 0
              ? StyleSheet.hairlineWidth
              : 0,
          borderTopColor: colors.border,
          backgroundColor:
            presentation === 'horizontal' && pressed
              ? colors.surface2
              : 'transparent',
          borderRadius: presentation === 'horizontal' ? radius.md : 0,
        },
      ]}
    >
      {presentation === 'horizontal' ? (
        <AdjustmentIcon tool={row.key} color={colors.primary} />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[typography.bodyStrong, { color: colors.text }]}
          numberOfLines={1}
        >
          {row.title}
        </Text>
        {presentation !== 'horizontal' ? (
          <Text
            style={[typography.caption, { color: colors.textMuted }]}
            numberOfLines={2}
          >
            {row.value}
          </Text>
        ) : null}
      </View>
      <Text style={[typography.subtitle, { color: colors.textMuted }]}>›</Text>
    </Pressable>
  ));

  return (
    <>
      <Card
        style={
          presentation === 'horizontal' ? styles.horizontalCard : undefined
        }
      >
        {presentation === 'collapsed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={
              memberOnly ? 'สมาชิกในบิล' : 'สิทธิประโยชน์และส่วนลด'
            }
            onPress={() => setExpanded(value => !value)}
            style={styles.collapsedHeader}
          >
            <View
              style={[
                styles.collapsedIcon,
                { backgroundColor: colors.surface2 },
              ]}
            >
              <AdjustmentIcon tool="coupon" color={colors.text} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {memberOnly ? 'สมาชิกในบิล' : 'สิทธิประโยชน์และส่วนลด'}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {previewLoading
                  ? 'กำลังตรวจสิทธิ์กับเซิร์ฟเวอร์…'
                  : activeAdjustmentCount > 0
                  ? `ใช้งานแล้ว ${activeAdjustmentCount} รายการ`
                  : 'ยังไม่ได้ใช้'}
              </Text>
            </View>
            <Text style={[typography.subtitle, { color: colors.textMuted }]}>
              {expanded ? '⌃' : '›'}
            </Text>
          </Pressable>
        ) : presentation === 'stacked' ? (
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            {memberOnly ? 'สมาชิกในบิล' : 'สิทธิประโยชน์และส่วนลด'}
          </Text>
        ) : null}
        {presentation === 'horizontal' ? (
          <View style={styles.horizontalTools}>
            {rowButtons}
            {!memberOnly && !hideExtra ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="ค่าบริการหรือถุง"
                onPress={() => openTool('extra')}
                style={({ pressed }) => [
                  styles.extraToolButton,
                  {
                    backgroundColor: pressed ? colors.surface2 : 'transparent',
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[typography.title, { color: colors.primary }]}>
                  +
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : presentation === 'stacked' || expanded ? (
          <View
            style={
              presentation === 'collapsed'
                ? [styles.expandedRows, { borderTopColor: colors.border }]
                : undefined
            }
          >
            {rowButtons}
          </View>
        ) : null}
        {!memberOnly && previewLoading && presentation !== 'collapsed' ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            กำลังตรวจสิทธิ์กับเซิร์ฟเวอร์…
          </Text>
        ) : !memberOnly && previewError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>
            {previewError}
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
                            setSelectedMember({
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
                  {selectedMember ? (
                    <Button
                      label="นำสมาชิกออกจากบิล"
                      variant="ghost"
                      fullWidth
                      style={{ marginTop: spacing.md }}
                      onPress={() => {
                        setSelectedMember(null);
                        close();
                      }}
                    />
                  ) : null}
                  <Text
                    style={[
                      typography.subtitle,
                      { color: colors.text, marginTop: spacing.lg },
                    ]}
                  >
                    สมัครสมาชิกใหม่
                  </Text>
                  <FormInput
                    value={memberPhone}
                    onChangeText={setMemberPhone}
                    placeholder="เบอร์โทรศัพท์"
                    keyboardType="phone-pad"
                  />
                  <FormInput
                    value={memberName}
                    onChangeText={setMemberName}
                    placeholder="ชื่อสมาชิก (ไม่บังคับ)"
                  />
                  <Button
                    label={working ? 'กำลังสมัคร…' : 'สมัครและเลือกสมาชิก'}
                    fullWidth
                    disabled={working || !memberPhone.trim()}
                    style={{ marginTop: spacing.md }}
                    onPress={async () => {
                      if (!session) return;
                      setWorking(true);
                      setError('');
                      try {
                        const response = await enrollMember({
                          variables: {
                            input: {
                              cashierUserId: session.credentials.cashierUserId,
                              pin: session.credentials.pin,
                              phone: memberPhone.trim(),
                              name: memberName.trim() || null,
                            },
                          },
                        });
                        const result = response.data?.bmsPosEnrollMember;
                        if (!result?.member) {
                          setError(
                            result?.reason ??
                              result?.error ??
                              result?.status ??
                              'สมัครสมาชิกไม่สำเร็จ',
                          );
                          return;
                        }
                        setSelectedMember({
                          id: result.member.customerId,
                          memberNo: result.member.memberNo,
                          name: result.member.name,
                          phone: result.member.phone,
                          tier: result.member.tier?.name ?? null,
                          tierDiscountPct:
                            result.member.tier?.discountType === 'PERCENT'
                              ? result.member.tier.discountValue
                              : 0,
                          points: result.member.pointsBalance,
                          pointsUsable: result.member.pointsUsable,
                        });
                        close();
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : 'สมัครสมาชิกไม่สำเร็จ',
                        );
                      } finally {
                        setWorking(false);
                      }
                    }}
                  />
                </>
              ) : null}

              {tool === 'points' ? (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ใช้แต้มสมาชิก
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    เซิร์ฟเวอร์จะจำกัดแต้มตามยอดและกติกาของร้านอีกครั้ง
                  </Text>
                  <FormInput
                    value={points}
                    onChangeText={setPoints}
                    placeholder="จำนวนแต้ม"
                    keyboardType="number-pad"
                  />
                  <Button
                    label="ใช้แต้ม"
                    fullWidth
                    disabled={!selectedMember}
                    onPress={() => {
                      const parsed = Math.max(
                        0,
                        Math.floor(Number(points) || 0),
                      );
                      setPointsToRedeem(parsed);
                      close();
                    }}
                  />
                  {pointsToRedeem > 0 ? (
                    <Button
                      label="ยกเลิกการใช้แต้ม"
                      variant="ghost"
                      fullWidth
                      onPress={() => {
                        setPointsToRedeem(0);
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
                  {coupon ? (
                    <Button
                      label="นำคูปองออก"
                      variant="ghost"
                      fullWidth
                      onPress={() => {
                        setCoupon(null);
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

              {tool === 'extra' ? (
                <>
                  <Text style={[typography.title, { color: colors.text }]}>
                    ค่าบริการ / ถุง
                  </Text>
                  {cart.extraLines.map(line => (
                    <View key={line.id} style={styles.extraRow}>
                      <Text
                        style={[
                          typography.body,
                          { color: colors.text, flex: 1 },
                        ]}
                      >
                        {line.label} · ฿
                        {(line.qty * line.unitAmount).toFixed(2)}
                      </Text>
                      <Button
                        label="ลบ"
                        variant="ghost"
                        onPress={() =>
                          cart.setExtraLines(
                            cart.extraLines.filter(item => item.id !== line.id),
                          )
                        }
                      />
                    </View>
                  ))}
                  <FormInput
                    value={extraLabel}
                    onChangeText={setExtraLabel}
                    placeholder="ชื่อรายการ"
                  />
                  <FormInput
                    value={extraAmount}
                    onChangeText={setExtraAmount}
                    placeholder="จำนวนเงิน"
                    keyboardType="decimal-pad"
                  />
                  <Button
                    label="เพิ่มรายการ"
                    fullWidth
                    onPress={() => {
                      const parsed = Number(extraAmount);
                      if (
                        !extraLabel.trim() ||
                        !Number.isFinite(parsed) ||
                        parsed <= 0
                      ) {
                        setError('กรอกชื่อและจำนวนเงินที่มากกว่า 0');
                        return;
                      }
                      cart.setExtraLines([
                        ...cart.extraLines,
                        {
                          id: `extra-${Date.now()}`,
                          label: extraLabel.trim(),
                          qty: 1,
                          unitAmount: parsed,
                        },
                      ]);
                      setExtraLabel('');
                      setExtraAmount('');
                      setError('');
                    }}
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

function AdjustmentIcon({ tool, color }: { tool: Tool; color: string }) {
  const paths: Record<Tool, string> = {
    member: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z',
    points:
      'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1-4.4-4.3 6.1-.9L12 3Z',
    coupon: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Zm8 0v10',
    discount:
      'M7 17 17 7M7.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    extra: 'M12 5v14M5 12h14',
  };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d={paths[tool]}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad';
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
  extraRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  horizontalCard: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  horizontalTools: {
    flexDirection: 'row',
    gap: 6,
  },
  horizontalTool: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 8,
  },
  extraToolButton: {
    width: 44,
    height: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  collapsedHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collapsedIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingTop: 4,
  },
});
