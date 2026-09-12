import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@apollo/client';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { AppColors } from '../../theme/colors';
import { typography as typographyTokens } from '../../theme/typography';
import { useShift } from '../../state/ShiftContext';
import { useSession } from '../../state/SessionContext';
import { PosBootstrapDocument } from '../../graphql/generated';
import type { CashMovementType } from '../../lib/shiftMath';
import { createIdempotencyKey } from '../../lib/operation';
import type {
  RootStackParamList,
  ShiftStackParamList,
} from '../../navigation/types';

type Props = NativeStackScreenProps<ShiftStackParamList, 'Shift'>;

// ทุกยอดบนหน้านี้มาจาก shift report ของ server เพื่อให้ยอดขาย คืนเงิน และลิ้นชักตรงกัน
export default function ShiftScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const shift = useShift();
  const { session, signOut } = useSession();
  const bootstrap = useQuery(PosBootstrapDocument);
  const approvers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver =>
      approver.id !== session?.cashier.id &&
      approver.approvals.includes('pos.cash.movement'),
  );

  const [movementType, setMovementType] = useState<CashMovementType | null>(
    null,
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [opening, setOpening] = useState(false);
  const [openingFloat, setOpeningFloat] = useState('');
  const [error, setError] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [movementKey, setMovementKey] = useState('');

  const closeMovement = () => {
    setMovementType(null);
    setAmount('');
    setReason('');
    setApproverId('');
    setApproverPin('');
    setMovementKey('');
    setError('');
  };

  const submitMovement = async () => {
    if (!movementType) return;
    const failure = await shift.addMovement(
      movementType,
      amount,
      reason,
      {
        approverUserId: approverId || undefined,
        approverPin: approverPin || undefined,
      },
      movementKey,
    );
    if (failure) {
      setError(failure);
      return;
    }
    closeMovement();
  };

  const submitClose = async () => {
    const failure = await shift.closeShift(countedCash);
    if (failure) {
      setError(failure);
      return;
    }
    setClosing(false);
    setCountedCash('');
    setError('');
  };

  const submitOpen = async () => {
    const failure = await shift.reopenShift(Number(openingFloat));
    if (failure) {
      setError(failure);
      return;
    }
    setOpening(false);
    setOpeningFloat('');
    setError('');
  };

  const summaryCard = (
    <Card>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        สรุปกะ
      </Text>
      <Row label="เปิดกะเมื่อ" value={shift.openedAt} colors={colors} />
      <Row label="ผู้เปิดกะ" value={shift.openedByName} colors={colors} />
      <Row
        label="เงินทอนตั้งต้น"
        value={`฿${shift.openingFloat.toFixed(2)}`}
        colors={colors}
      />
      <Row
        label="ยอดขายเงินสด"
        value={`฿${shift.cashSales.toFixed(2)}`}
        colors={colors}
      />
      {shift.cashRefunds > 0 && (
        <Row
          label="คืนเงินสด"
          value={`−฿${shift.cashRefunds.toFixed(2)}`}
          colors={colors}
        />
      )}
      {shift.movementIn > 0 && (
        <Row
          label="เงินเข้าลิ้นชัก"
          value={`+฿${shift.movementIn.toFixed(2)}`}
          colors={colors}
        />
      )}
      {shift.movementOut > 0 && (
        <Row
          label="เงินออกจากลิ้นชัก"
          value={`−฿${shift.movementOut.toFixed(2)}`}
          colors={colors}
        />
      )}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="เงินที่ควรมีในลิ้นชัก"
        value={`฿${shift.expectedCash.toFixed(2)}`}
        colors={colors}
        strong
      />
      {/* การคืนทาง QR/บัตรไม่ได้เอาเงินออกจากลิ้นชัก — บอกไว้ตรงนี้เพราะไม่งั้นตัวเลข
          "คืนเงินสด" จะอ่านเหมือนไม่ครบเมื่อมีการคืนแบบไม่ใช่เงินสดปนอยู่ */}
      <Text
        style={[
          typography.caption,
          { color: colors.textSoft, marginTop: spacing.sm },
        ]}
      >
        นับเฉพาะเงินสด — QR/บัตร และการคืนที่ยังรอยืนยันไม่อยู่ในลิ้นชัก
      </Text>
    </Card>
  );

  const closedCard = shift.closeSummary && (
    <Card style={{ marginTop: spacing.md }}>
      <Text style={[typography.captionStrong, { color: colors.warning }]}>
        ปิดกะแล้ว · {shift.closeSummary.closedAt}
      </Text>
      <Row
        label="นับได้จริง"
        value={`฿${shift.closeSummary.countedCash.toFixed(2)}`}
        colors={colors}
      />
      <Row
        label="ควรมี"
        value={`฿${shift.closeSummary.expectedCash.toFixed(2)}`}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.varianceRow}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          ผลต่าง
        </Text>
        <StatusPill
          label={
            shift.closeSummary.variance === 0
              ? 'ตรงพอดี'
              : shift.closeSummary.variance > 0
              ? `เกิน ฿${shift.closeSummary.variance.toFixed(2)}`
              : `ขาด ฿${Math.abs(shift.closeSummary.variance).toFixed(2)}`
          }
          tone={shift.closeSummary.variance === 0 ? 'success' : 'danger'}
        />
      </View>
    </Card>
  );

  const movementsCard = (
    <Card style={{ flex: 1 }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        รายการเงินเข้า/ออก
      </Text>
      <FlatList
        data={shift.movements}
        keyExtractor={m => m.id}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text }]}>
                {item.reason}
              </Text>
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                {item.at}
              </Text>
            </View>
            <StatusPill
              label={
                item.type === 'IN'
                  ? `+฿${item.amount.toFixed(2)}`
                  : `-฿${item.amount.toFixed(2)}`
              }
              tone={item.type === 'IN' ? 'success' : 'danger'}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            กะนี้ยังไม่มีเงินเข้า/ออก
          </Text>
        }
      />
    </Card>
  );

  const actions = (
    <>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        <Button
          label="เงินเข้า"
          accessibilityLabel="บันทึกเงินเข้าลิ้นชัก"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!shift.isOpen}
          onPress={() => {
            setError('');
            setMovementType('IN');
            setMovementKey(createIdempotencyKey('cash'));
          }}
        />
        <Button
          label="เงินออก"
          accessibilityLabel="บันทึกเงินออกจากลิ้นชัก"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!shift.isOpen}
          onPress={() => {
            setError('');
            setMovementType('OUT');
            setMovementKey(createIdempotencyKey('cash'));
          }}
        />
      </View>
      {!shift.isOpen ? (
        <Button
          label="เปิดกะใหม่"
          accessibilityLabel="เปิดกะใหม่"
          fullWidth
          onPress={() => {
            setError('');
            setOpeningFloat(
              shift.closeSummary?.countedCash.toFixed(2) ?? '0.00',
            );
            setOpening(true);
          }}
        />
      ) : (
        <Button
          label="ปิดกะ"
          accessibilityLabel="ปิดกะและนับเงินในลิ้นชัก"
          variant="danger"
          fullWidth
          onPress={() => {
            setError('');
            setCountedCash('');
            setClosing(true);
          }}
        />
      )}
      <Button
        label="ตั้งค่าเครื่อง"
        variant="ghost"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() =>
          navigation
            .getParent()
            ?.getParent<NativeStackNavigationProp<RootStackParamList>>()
            ?.navigate('Settings')
        }
      />
      <Button
        label="เปลี่ยนผู้ปฏิบัติงาน"
        variant="secondary"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() => {
          signOut();
          navigation
            .getParent()
            ?.getParent<NativeStackNavigationProp<RootStackParamList>>()
            ?.reset({ index: 0, routes: [{ name: 'Login' }] });
        }}
      />
    </>
  );

  return (
    <ScreenContainer>
      <Text
        style={[
          typography.title,
          { color: colors.text, marginBottom: spacing.lg },
        ]}
      >
        กะและลิ้นชัก
      </Text>

      {/* แท็บเล็ต: สรุปกะ+ปุ่มอยู่แผงซ้ายที่กว้างคงที่ · รายการเงินเข้า-ออกกินฝั่งกว้างเพราะมันคือ
          ส่วนที่ยาวขึ้นเรื่อย ๆ ระหว่างกะ · มือถือเรียงลงมาตามเดิม */}
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ width: 380, justifyContent: 'space-between' }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {summaryCard}
              {closedCard}
            </ScrollView>
            <View style={{ marginTop: spacing.lg }}>{actions}</View>
          </View>
          <View style={{ flex: 1 }}>{movementsCard}</View>
        </View>
      ) : (
        <>
          <View style={{ marginBottom: spacing.md }}>
            {summaryCard}
            {closedCard}
          </View>
          <View style={{ flex: 1, marginBottom: spacing.lg }}>
            {movementsCard}
          </View>
          {actions}
        </>
      )}

      <Modal
        transparent
        visible={movementType !== null}
        animationType="fade"
        onRequestClose={closeMovement}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMovement} />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {movementType === 'IN'
                  ? 'เงินเข้าลิ้นชัก'
                  : 'เงินออกจากลิ้นชัก'}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                รายการจะบันทึกในลิ้นชักของกะปัจจุบันบนเซิร์ฟเวอร์
              </Text>
              <TextInput
                accessibilityLabel="จำนวนเงิน"
                value={amount}
                onChangeText={setAmount}
                placeholder="จำนวนเงิน"
                placeholderTextColor={colors.textSoft}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {movementType === 'OUT' ? (
                <>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted },
                    ]}
                  >
                    ผู้อนุมัติคนที่สอง
                  </Text>
                  <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                    {approvers.map(approver => (
                      <Button
                        key={approver.id}
                        label={`${approver.name ?? approver.id}${
                          approver.hasPin ? '' : ' · ยังไม่ได้ตั้ง PIN'
                        }`}
                        variant={
                          approverId === approver.id ? 'primary' : 'secondary'
                        }
                        fullWidth
                        disabled={!approver.hasPin}
                        onPress={() => setApproverId(approver.id)}
                      />
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel="PIN ผู้อนุมัติเงินออก"
                    value={approverPin}
                    onChangeText={setApproverPin}
                    placeholder="PIN ผู้อนุมัติ"
                    placeholderTextColor={colors.textSoft}
                    keyboardType="number-pad"
                    secureTextEntry
                    style={[
                      styles.input,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                  />
                </>
              ) : null}
              <TextInput
                accessibilityLabel="เหตุผล"
                value={reason}
                onChangeText={setReason}
                placeholder="เหตุผล เช่น เติมเงินทอน / ซื้อวัตถุดิบ"
                placeholderTextColor={colors.textSoft}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {error ? (
                <Text
                  style={[typography.captionStrong, { color: colors.danger }]}
                >
                  {error}
                </Text>
              ) : null}
              <Button
                label="บันทึก"
                accessibilityLabel="บันทึกรายการเงินเข้า/ออก"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={submitMovement}
              />
              <Button
                label="ยกเลิก"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={closeMovement}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={closing}
        animationType="fade"
        onRequestClose={() => setClosing(false)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setClosing(false)}
          />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ปิดกะ
              </Text>
              {/* ไม่บอก "ควรมีเท่าไร" ก่อนนับ — การนับแบบเห็นคำตอบก่อนไม่ใช่การนับ
                  (ฝั่งเว็บมีโหมดนับปิดตาด้วยเหตุผลเดียวกัน) */}
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                นับเงินในลิ้นชักแล้วกรอกยอดจริง ผลต่างจะแสดงหลังยืนยัน
              </Text>
              <TextInput
                accessibilityLabel="เงินสดที่นับได้"
                value={countedCash}
                onChangeText={setCountedCash}
                placeholder="เงินสดที่นับได้"
                placeholderTextColor={colors.textSoft}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              {error ? (
                <Text
                  style={[typography.captionStrong, { color: colors.danger }]}
                >
                  {error}
                </Text>
              ) : null}
              <Button
                label="ยืนยันปิดกะ"
                accessibilityLabel="ยืนยันปิดกะ"
                variant="danger"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={submitClose}
              />
              <Button
                label="ยกเลิก"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => setClosing(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={opening}
        animationType="fade"
        onRequestClose={() => setOpening(false)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpening(false)}
          />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[typography.subtitle, { color: colors.text }]}>
              เปิดกะ
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              ตรวจนับเงินทอนตั้งต้นก่อนเริ่มรับชำระ
            </Text>
            <TextInput
              accessibilityLabel="เงินทอนตั้งต้น"
              value={openingFloat}
              onChangeText={setOpeningFloat}
              placeholder="เงินทอนตั้งต้น"
              placeholderTextColor={colors.textSoft}
              keyboardType="decimal-pad"
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text },
              ]}
            />
            {error ? (
              <Text
                style={[typography.captionStrong, { color: colors.danger }]}
              >
                {error}
              </Text>
            ) : null}
            <Button
              label="ยืนยันเปิดกะ"
              fullWidth
              style={{ marginTop: spacing.md }}
              onPress={submitOpen}
            />
            <Button
              label="ยกเลิก"
              variant="secondary"
              fullWidth
              style={{ marginTop: spacing.sm }}
              onPress={() => setOpening(false)}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function Row({
  label,
  value,
  colors,
  strong,
}: {
  label: string;
  value: string;
  colors: AppColors;
  strong?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
      }}
    >
      <Text style={[typographyTokens.body, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          strong ? typographyTokens.bodyStrong : typographyTokens.body,
          { color: colors.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  panes: { flex: 1, flexDirection: 'row' },
  varianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '82%',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginVertical: 12,
  },
});
