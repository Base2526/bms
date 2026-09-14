import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import {
  MobilePosBlindReturnDocument,
  MobilePosArAccountDocument,
  MobilePosCollectArDocument,
  MobilePosDepositDocument,
  MobilePosDepositsDocument,
  MobilePosExpenseDocument,
  MobilePosExpensesDocument,
  MobilePosNoSaleDocument,
  MobilePosNoSalesDocument,
  MobilePosMembersDocument,
  MobilePosPurchaseOrdersDocument,
  MobilePosReceivePurchaseDocument,
  MobilePosStoreCreditDocument,
  MobileRestaurantAcceptQrSubmissionDocument,
  MobileRestaurantAcknowledgeServiceCallDocument,
  MobileRestaurantAddWaitlistEntryDocument,
  MobileRestaurantCallWaitlistEntryDocument,
  MobileRestaurantCancelRequestDocument,
  MobileRestaurantCancelWaitlistEntryDocument,
  MobileRestaurantCompleteServiceCallDocument,
  MobileRestaurantConfirmRequestDocument,
  MobileRestaurantContactRequestDocument,
  MobileRestaurantFloorSetupDocument,
  MobileRestaurantFloorDocument,
  MobileRestaurantNoShowWaitlistEntryDocument,
  MobileRestaurantMenuAvailabilityDocument,
  MobileRestaurantMenuDocument,
  MobileRestaurantRejectQrSubmissionDocument,
  MobileRestaurantRequestsDocument,
  MobileRestaurantSeatWaitlistEntryDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { createIdempotencyKey } from '../../lib/operation';
import { useSession } from '../../state/SessionContext';
import { useStoreMode } from '../../state/StoreModeContext';
import { useRestaurantOperations } from '../../state/RestaurantOperationsContext';
import { useTheme } from '../../theme/ThemeProvider';

type Section = 'REGISTER' | 'RESTAURANT' | 'SUPPORT';
type RestaurantView = 'OVERVIEW' | 'QUEUE' | 'QR' | 'CALLS' | 'REQUESTS';

class BusinessResultError extends Error {}

export default function OperationsScreen() {
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const { mode } = useStoreMode();
  const credentials = session?.credentials;
  const [section, setSection] = useState<Section>(
    mode === 'restaurant' ? 'RESTAURANT' : 'REGISTER',
  );
  const [restaurantView, setRestaurantView] =
    useState<RestaurantView>('OVERVIEW');
  const [working, setWorking] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [sku, setSku] = useState('');
  const [size, setSize] = useState('');
  const [qty, setQty] = useState('1');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [memberSearch, setMemberSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [storeCreditCode, setStoreCreditCode] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [tableCount, setTableCount] = useState('12');
  const [evidenceRef, setEvidenceRef] = useState('');
  const operationKeys = useRef<Record<string, string>>({});
  const {
    qrSubmissions,
    serviceCalls,
    waitlistEntries,
    pendingQrCount,
    pendingServiceCallCount,
    activeWaitlistCount,
    waitingGuests,
    refreshQr,
    refreshServiceCalls,
    refreshWaitlist,
  } = useRestaurantOperations();

  const bootstrap = useQuery(PosBootstrapDocument, { skip: !session });
  const noSales = useQuery(MobilePosNoSalesDocument, {
    skip: !session || section !== 'REGISTER',
  });
  const deposits = useQuery(MobilePosDepositsDocument, {
    variables: { q: null },
    skip: !session || section !== 'REGISTER',
  });
  const expenses = useQuery(MobilePosExpensesDocument, {
    variables: { credentials: credentials! },
    skip: !credentials || section !== 'REGISTER',
  });
  const purchaseOrders = useQuery(MobilePosPurchaseOrdersDocument, {
    variables: { credentials: credentials! },
    skip: !credentials || section !== 'REGISTER',
  });
  const requests = useQuery(MobileRestaurantRequestsDocument, {
    variables: { credentials: credentials! },
    skip: !credentials || section !== 'RESTAURANT',
  });
  const floor = useQuery(MobileRestaurantFloorDocument, {
    skip: !session || section !== 'RESTAURANT',
  });
  const restaurantMenu = useQuery(MobileRestaurantMenuDocument, {
    skip: !session || section !== 'RESTAURANT',
  });
  const members = useQuery(MobilePosMembersDocument, {
    variables: { q: memberSearch.trim() || null, amount: null },
    skip: !session || section !== 'REGISTER',
  });
  const arAccount = useQuery(MobilePosArAccountDocument, {
    variables: { credentials: credentials!, customerId },
    skip: !credentials || section !== 'REGISTER' || !customerId,
  });
  const storeCredit = useQuery(MobilePosStoreCreditDocument, {
    variables: { credentials: credentials!, code: storeCreditCode.trim() },
    skip: !credentials || section !== 'REGISTER' || !storeCreditCode.trim(),
  });

  const [recordNoSale] = useMutation(MobilePosNoSaleDocument);
  const [blindReturn] = useMutation(MobilePosBlindReturnDocument);
  const [depositAction] = useMutation(MobilePosDepositDocument);
  const [expenseAction] = useMutation(MobilePosExpenseDocument);
  const [receivePurchase] = useMutation(MobilePosReceivePurchaseDocument);
  const [collectAr] = useMutation(MobilePosCollectArDocument);
  const [acceptQr] = useMutation(MobileRestaurantAcceptQrSubmissionDocument);
  const [rejectQr] = useMutation(MobileRestaurantRejectQrSubmissionDocument);
  const [acknowledgeCall] = useMutation(
    MobileRestaurantAcknowledgeServiceCallDocument,
  );
  const [completeCall] = useMutation(
    MobileRestaurantCompleteServiceCallDocument,
  );
  const [addWaitlist] = useMutation(MobileRestaurantAddWaitlistEntryDocument);
  const [callWaitlist] = useMutation(MobileRestaurantCallWaitlistEntryDocument);
  const [cancelWaitlist] = useMutation(
    MobileRestaurantCancelWaitlistEntryDocument,
  );
  const [noShowWaitlist] = useMutation(
    MobileRestaurantNoShowWaitlistEntryDocument,
  );
  const [seatWaitlist] = useMutation(MobileRestaurantSeatWaitlistEntryDocument);
  const [contactRequest] = useMutation(MobileRestaurantContactRequestDocument);
  const [confirmRequest] = useMutation(MobileRestaurantConfirmRequestDocument);
  const [cancelRequest] = useMutation(MobileRestaurantCancelRequestDocument);
  const [setupFloor] = useMutation(MobileRestaurantFloorSetupDocument);
  const [setMenuAvailability] = useMutation(
    MobileRestaurantMenuAvailabilityDocument,
  );

  const inputCredentials = credentials ?? { cashierUserId: '', pin: '' };
  const approvers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    person => person.id !== session?.cashier.id && person.hasPin,
  );
  const freeTables = (floor.data?.bmsPosRestaurantFloor.tables ?? []).filter(
    table => table.active && !table.blocked && table.status === 'AVAILABLE',
  );

  useFocusEffect(
    useCallback(() => {
      if (mode !== 'restaurant') return;
      setSection('RESTAURANT');
      setRestaurantView(
        pendingServiceCallCount > 0
          ? 'CALLS'
          : pendingQrCount > 0
          ? 'QR'
          : activeWaitlistCount > 0
          ? 'QUEUE'
          : 'OVERVIEW',
      );
    }, [activeWaitlistCount, mode, pendingQrCount, pendingServiceCallCount]),
  );

  const ensure = (
    result:
      | {
          status?: string | null;
          reason?: string | null;
          message?: string | null;
        }
      | null
      | undefined,
    successStatuses?: string[],
  ) => {
    if (!result) throw new Error('ไม่ได้รับผลยืนยันจากเซิร์ฟเวอร์');
    if (
      result.reason ||
      (successStatuses && !successStatuses.includes(result.status ?? '')) ||
      /INVALID|FAILED|ERROR|NOT_FOUND|CONFLICT|INSUFFICIENT|OVER_/.test(
        result.status ?? '',
      )
    ) {
      throw new BusinessResultError(
        result.reason ?? result.message ?? result.status ?? 'ทำรายการไม่สำเร็จ',
      );
    }
  };
  const run = async (
    key: string,
    action: (idempotencyKey?: string) => Promise<void>,
    refresh?: () => Promise<unknown>,
    idempotencyPrefix?: string,
  ) => {
    if (!credentials || working) return;
    const idempotencyKey = idempotencyPrefix
      ? (operationKeys.current[key] ??= createIdempotencyKey(idempotencyPrefix))
      : undefined;
    setWorking(key);
    try {
      await action(idempotencyKey);
      if (idempotencyPrefix) delete operationKeys.current[key];
      if (refresh) await refresh();
    } catch (cause) {
      if (idempotencyPrefix && cause instanceof BusinessResultError) {
        delete operationKeys.current[key];
      }
      Alert.alert(
        'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking('');
    }
  };

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.text }]}>
        งานหน้าร้าน
      </Text>
      <View style={styles.wrap}>
        <Button
          label="เคาน์เตอร์"
          variant={section === 'REGISTER' ? 'primary' : 'secondary'}
          onPress={() => setSection('REGISTER')}
        />
        {mode === 'restaurant' ? (
          <Button
            label="ร้านอาหาร"
            variant={section === 'RESTAURANT' ? 'primary' : 'secondary'}
            onPress={() => setSection('RESTAURANT')}
          />
        ) : null}
        <Button
          label="สถานะระบบ"
          variant={section === 'SUPPORT' ? 'primary' : 'secondary'}
          onPress={() => setSection('SUPPORT')}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
      >
        {section === 'REGISTER' ? (
          <>
            <Card>
              <Heading text="เปิดลิ้นชักโดยไม่มีการขาย" />
              <Field
                value={reason}
                onChangeText={setReason}
                placeholder="เหตุผล"
              />
              <Button
                label="บันทึก No sale"
                disabled={!reason.trim()}
                loading={working === 'no-sale'}
                onPress={() =>
                  run(
                    'no-sale',
                    async () => {
                      const response = await recordNoSale({
                        variables: {
                          input: { ...inputCredentials, reason: reason.trim() },
                        },
                      });
                      ensure(response.data?.bmsPosNoSale);
                      setReason('');
                    },
                    () => noSales.refetch(),
                  )
                }
              />
              {(noSales.data?.bmsPosNoSales.noSales ?? [])
                .slice(0, 5)
                .map(item => (
                  <Info
                    key={item.id}
                    title={item.reason}
                    detail={
                      (item.actorName ?? '-') +
                      ' · ' +
                      new Date(item.createdAt).toLocaleString('th-TH')
                    }
                  />
                ))}
            </Card>
            <Card>
              <Heading text="คืนสินค้าไม่มีใบเสร็จ" />
              <Field
                value={sku}
                onChangeText={setSku}
                placeholder="SKU"
                autoCapitalize="characters"
              />
              <Field value={size} onChangeText={setSize} placeholder="ขนาด" />
              <Field
                value={qty}
                onChangeText={setQty}
                placeholder="จำนวน"
                keyboardType="number-pad"
              />
              <Field
                value={amount}
                onChangeText={setAmount}
                placeholder="ยอดคืนต่อหน่วย"
                keyboardType="decimal-pad"
              />
              <Field
                value={reason}
                onChangeText={setReason}
                placeholder="เหตุผล"
              />
              <Approvers
                people={approvers.filter(person =>
                  person.approvals.includes('pos.return.noreceipt'),
                )}
                selected={approverId}
                onSelect={setApproverId}
              />
              <Field
                value={approverPin}
                onChangeText={setApproverPin}
                placeholder="PIN ผู้อนุมัติ"
                secureTextEntry
                keyboardType="number-pad"
              />
              <Button
                label="ยืนยันคืนสินค้า"
                disabled={
                  !sku.trim() ||
                  !size.trim() ||
                  !reason.trim() ||
                  !approverId ||
                  !approverPin ||
                  !(Number(amount) > 0)
                }
                loading={working === 'blind-return'}
                onPress={() =>
                  run(
                    'blind-return',
                    async idempotencyKey => {
                      const response = await blindReturn({
                        variables: {
                          input: {
                            ...inputCredentials,
                            idempotencyKey: idempotencyKey!,
                            reason: reason.trim(),
                            customerId: null,
                            customerNote: null,
                            approverUserId: approverId,
                            approverPin,
                            lines: [
                              {
                                sku: sku.trim(),
                                size: size.trim(),
                                qty: Math.max(1, Number(qty) || 1),
                                unitRefund: Number(amount),
                              },
                            ],
                          },
                        },
                      });
                      ensure(response.data?.bmsPosBlindReturn, ['RETURNED']);
                    },
                    undefined,
                    'blind-return',
                  )
                }
              />
            </Card>
            <Card>
              <Heading text="มัดจำ / รับของ" />
              <Field
                value={amount}
                onChangeText={setAmount}
                placeholder="ยอดรับเพิ่ม"
                keyboardType="decimal-pad"
              />
              {(deposits.data?.bmsPosDeposits.deposits ?? []).map(item => (
                <View key={item.id} style={styles.block}>
                  <Info
                    title={
                      (item.customerName ?? 'ลูกค้า') +
                      ' · ฿' +
                      item.balanceDue.toFixed(2)
                    }
                    detail={item.status + (item.overdue ? ' · เกินกำหนด' : '')}
                  />
                  <View style={styles.wrap}>
                    <Button
                      label="รับเพิ่ม"
                      variant="secondary"
                      disabled={!(Number(amount) > 0)}
                      onPress={() =>
                        run(
                          'deposit-add-' + item.id,
                          async idempotencyKey => {
                            const response = await depositAction({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  action: 'add',
                                  orderId: item.orderId,
                                  amount: Number(amount),
                                  method: 'CASH',
                                  idempotencyKey: idempotencyKey!,
                                  payments: null,
                                  lines: null,
                                  outcome: null,
                                  reason: null,
                                  customerNote: null,
                                  dueAt: null,
                                },
                              },
                            });
                            ensure(response.data?.bmsPosDeposit, ['TAKEN']);
                          },
                          () => deposits.refetch(),
                          'deposit-add',
                        )
                      }
                    />
                    <Button
                      label="รับของและชำระ"
                      onPress={() =>
                        run(
                          'deposit-settle-' + item.id,
                          async () => {
                            const response = await depositAction({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  action: 'settle',
                                  orderId: item.orderId,
                                  amount: null,
                                  method: null,
                                  idempotencyKey: null,
                                  payments: [
                                    {
                                      method: 'CASH',
                                      amount: item.balanceDue,
                                      cashTendered: item.balanceDue,
                                      ref: null,
                                    },
                                  ],
                                  lines: [],
                                  outcome: null,
                                  reason: null,
                                  customerNote: null,
                                  dueAt: null,
                                },
                              },
                            });
                            ensure(response.data?.bmsPosDeposit, ['SOLD']);
                          },
                          () => deposits.refetch(),
                        )
                      }
                    />
                    <Button
                      label="ยกเลิก"
                      variant="danger"
                      onPress={() =>
                        run(
                          'deposit-close-' + item.id,
                          async () => {
                            const response = await depositAction({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  action: 'close',
                                  orderId: item.orderId,
                                  amount: null,
                                  method: null,
                                  idempotencyKey: null,
                                  payments: null,
                                  lines: null,
                                  outcome: 'CANCELLED',
                                  reason:
                                    reason.trim() || 'ยกเลิกจาก POS Mobile',
                                  customerNote: null,
                                  dueAt: null,
                                },
                              },
                            });
                            ensure(response.data?.bmsPosDeposit, [
                              'CANCELLED',
                              'FORFEITED',
                            ]);
                          },
                          () => deposits.refetch(),
                        )
                      }
                    />
                  </View>
                </View>
              ))}
            </Card>
            <Card>
              <Heading text="ค่าใช้จ่าย / เงินสดย่อย" />
              <Text style={[typography.body, { color: colors.text }]}>
                เงินสดย่อย ฿
                {(
                  expenses.data?.bmsPosExpenses.pettyCashWallet.balance ?? 0
                ).toFixed(2)}
              </Text>
              <Field
                value={reason}
                onChangeText={setReason}
                placeholder="รายละเอียด"
              />
              <Field
                value={amount}
                onChangeText={setAmount}
                placeholder="จำนวนเงิน"
                keyboardType="decimal-pad"
              />
              <Field
                value={evidenceRef}
                onChangeText={setEvidenceRef}
                placeholder="เลขที่ใบเสร็จ / หลักฐาน"
              />
              <Approvers
                people={approvers.filter(person =>
                  person.approvals.includes('pos.cash.movement'),
                )}
                selected={approverId}
                onSelect={setApproverId}
              />
              <Field
                value={approverPin}
                onChangeText={setApproverPin}
                placeholder="PIN ผู้อนุมัติ (เมื่อตัดลิ้นชัก)"
                secureTextEntry
                keyboardType="number-pad"
              />
              <View style={styles.wrap}>
                {(['DRAWER', 'PERSONAL', 'PETTY_CASH'] as const).map(source => (
                  <Button
                    key={source}
                    label={
                      source === 'DRAWER'
                        ? 'ลิ้นชัก'
                        : source === 'PERSONAL'
                        ? 'เงินส่วนตัว'
                        : 'เงินสดย่อย'
                    }
                    variant="secondary"
                    disabled={
                      !reason.trim() ||
                      !(Number(amount) > 0) ||
                      (source === 'DRAWER' && (!approverId || !approverPin)) ||
                      (source !== 'DRAWER' && !evidenceRef.trim())
                    }
                    onPress={() =>
                      run(
                        'expense-' + source,
                        async idempotencyKey => {
                          const response = await expenseAction({
                            variables: {
                              input: {
                                ...inputCredentials,
                                action: 'create',
                                idempotencyKey: idempotencyKey!,
                                source: null,
                                amount: Number(amount),
                                reason: null,
                                evidenceRef: null,
                                fundingSource: source,
                                approverUserId: approverId || null,
                                approverPin: approverPin || null,
                                kind: 'DIRECT',
                                category:
                                  expenses.data?.bmsPosExpenses.categories[0] ??
                                  'OTHER',
                                description: reason.trim(),
                                payee: null,
                                receiptRef:
                                  source === 'DRAWER'
                                    ? evidenceRef.trim() || null
                                    : evidenceRef.trim(),
                                expenseId: null,
                                actualAmount: null,
                              },
                            },
                          });
                          ensure(response.data?.bmsPosExpense, ['RECORDED']);
                        },
                        () => expenses.refetch(),
                        'expense',
                      )
                    }
                  />
                ))}
              </View>
              <Button
                label="สร้างเงินทดรอง"
                variant="secondary"
                disabled={
                  !reason.trim() ||
                  !(Number(amount) > 0) ||
                  !approverId ||
                  !approverPin
                }
                onPress={() =>
                  run(
                    'expense-advance',
                    async idempotencyKey => {
                      const response = await expenseAction({
                        variables: {
                          input: {
                            ...inputCredentials,
                            action: 'create',
                            idempotencyKey: idempotencyKey!,
                            source: null,
                            amount: Number(amount),
                            reason: null,
                            evidenceRef: null,
                            fundingSource: 'DRAWER',
                            approverUserId: approverId || null,
                            approverPin: approverPin || null,
                            kind: 'ADVANCE',
                            category:
                              expenses.data?.bmsPosExpenses.categories[0] ??
                              'OTHER',
                            description: reason.trim(),
                            payee: null,
                            receiptRef: evidenceRef.trim() || null,
                            expenseId: null,
                            actualAmount: null,
                          },
                        },
                      });
                      ensure(response.data?.bmsPosExpense, ['RECORDED']);
                    },
                    () => expenses.refetch(),
                    'expense-advance',
                  )
                }
              />
              {expenses.data?.bmsPosExpenses.canManagePettyCash ? (
                <View style={styles.wrap}>
                  <Button
                    label="เติมเงินสดย่อย: เจ้าของ"
                    variant="secondary"
                    disabled={
                      !reason.trim() ||
                      !evidenceRef.trim() ||
                      !(Number(amount) > 0)
                    }
                    onPress={() =>
                      run(
                        'petty-owner',
                        async idempotencyKey => {
                          const response = await expenseAction({
                            variables: {
                              input: {
                                ...inputCredentials,
                                action: 'fund',
                                idempotencyKey: idempotencyKey!,
                                source: 'OWNER_PERSONAL',
                                amount: Number(amount),
                                reason: reason.trim(),
                                evidenceRef: evidenceRef.trim(),
                                fundingSource: null,
                                approverUserId: null,
                                approverPin: null,
                                kind: null,
                                category: null,
                                description: null,
                                payee: null,
                                receiptRef: null,
                                expenseId: null,
                                actualAmount: null,
                              },
                            },
                          });
                          ensure(response.data?.bmsPosExpense, ['FUNDED']);
                        },
                        () => expenses.refetch(),
                        'petty-fund',
                      )
                    }
                  />
                  <Button
                    label="เติมเงินสดย่อย: บัญชีร้าน"
                    variant="secondary"
                    disabled={
                      !reason.trim() ||
                      !evidenceRef.trim() ||
                      !(Number(amount) > 0)
                    }
                    onPress={() =>
                      run(
                        'petty-business',
                        async idempotencyKey => {
                          const response = await expenseAction({
                            variables: {
                              input: {
                                ...inputCredentials,
                                action: 'fund',
                                idempotencyKey: idempotencyKey!,
                                source: 'BUSINESS_ACCOUNT',
                                amount: Number(amount),
                                reason: reason.trim(),
                                evidenceRef: evidenceRef.trim(),
                                fundingSource: null,
                                approverUserId: null,
                                approverPin: null,
                                kind: null,
                                category: null,
                                description: null,
                                payee: null,
                                receiptRef: null,
                                expenseId: null,
                                actualAmount: null,
                              },
                            },
                          });
                          ensure(response.data?.bmsPosExpense, ['FUNDED']);
                        },
                        () => expenses.refetch(),
                        'petty-fund',
                      )
                    }
                  />
                </View>
              ) : null}
              <Field
                value={actualAmount}
                onChangeText={setActualAmount}
                placeholder="ยอดใช้จริงสำหรับปิดเงินทดรอง"
                keyboardType="decimal-pad"
              />
              {(expenses.data?.bmsPosExpenses.expenses ?? [])
                .slice(0, 6)
                .map(item => (
                  <View key={item.id} style={styles.block}>
                    <Info
                      title={
                        item.description +
                        ' · ฿' +
                        item.advancedAmount.toFixed(2)
                      }
                      detail={item.fundingSource + ' · ' + item.status}
                    />
                    {item.kind === 'ADVANCE' && item.status !== 'SETTLED' ? (
                      <Button
                        label="ปิดเงินทดรอง"
                        variant="secondary"
                        disabled={
                          !(Number(actualAmount) >= 0) ||
                          actualAmount.trim() === '' ||
                          !approverId ||
                          !approverPin
                        }
                        onPress={() =>
                          run(
                            'expense-settle-' + item.id,
                            async idempotencyKey => {
                              const response = await expenseAction({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    action: 'settle',
                                    idempotencyKey: idempotencyKey!,
                                    source: null,
                                    amount: null,
                                    reason: null,
                                    evidenceRef: null,
                                    fundingSource: null,
                                    approverUserId: approverId || null,
                                    approverPin: approverPin || null,
                                    kind: null,
                                    category: null,
                                    description: null,
                                    payee: null,
                                    receiptRef: evidenceRef.trim() || null,
                                    expenseId: item.id,
                                    actualAmount: Number(actualAmount),
                                  },
                                },
                              });
                              ensure(response.data?.bmsPosExpense, ['SETTLED']);
                            },
                            () => expenses.refetch(),
                            'expense-settle',
                          )
                        }
                      />
                    ) : null}
                  </View>
                ))}
            </Card>
            <Card>
              <Heading text="ลูกหนี้ / เครดิตร้าน" />
              <Field
                value={memberSearch}
                onChangeText={setMemberSearch}
                placeholder="ค้นหาสมาชิก"
              />
              <View style={styles.wrap}>
                {(members.data?.bmsPosMemberSearch.members ?? [])
                  .slice(0, 8)
                  .map(member => (
                    <Button
                      key={member.customerId}
                      label={
                        member.name ?? member.memberNo ?? member.customerId
                      }
                      variant={
                        customerId === member.customerId
                          ? 'primary'
                          : 'secondary'
                      }
                      onPress={() => setCustomerId(member.customerId)}
                    />
                  ))}
              </View>
              {arAccount.data?.bmsPosArAccount.account ? (
                <>
                  <Info
                    title={
                      'วงเงินคงเหลือ ฿' +
                      arAccount.data.bmsPosArAccount.account.availableCredit.toFixed(
                        2,
                      )
                    }
                    detail={
                      'ยอดลูกหนี้ ฿' +
                      arAccount.data.bmsPosArAccount.account.balance.toFixed(2)
                    }
                  />
                  <Button
                    label="รับชำระลูกหนี้"
                    disabled={!(Number(amount) > 0) || !customerId}
                    onPress={() =>
                      run(
                        'ar-collect',
                        async idempotencyKey => {
                          const account =
                            arAccount.data?.bmsPosArAccount.account;
                          if (!account) return;
                          const response = await collectAr({
                            variables: {
                              input: {
                                ...inputCredentials,
                                accountId: account.id,
                                amount: Number(amount),
                                method: 'CASH',
                                reference: null,
                                note: reason.trim() || null,
                                idempotencyKey: idempotencyKey!,
                              },
                            },
                          });
                          ensure(response.data?.bmsPosCollectAr, ['RECEIVED']);
                        },
                        () => arAccount.refetch(),
                        'ar-collect',
                      )
                    }
                  />
                </>
              ) : null}
              <Field
                value={storeCreditCode}
                onChangeText={setStoreCreditCode}
                placeholder="รหัสเครดิตร้าน"
                autoCapitalize="characters"
              />
              {storeCredit.data?.bmsPosStoreCredit.credit ? (
                <Info
                  title={
                    'เครดิตร้าน ฿' +
                    storeCredit.data.bmsPosStoreCredit.credit.balance.toFixed(2)
                  }
                  detail={
                    (storeCredit.data.bmsPosStoreCredit.credit.customerName ??
                      '-') +
                    ' · ' +
                    storeCredit.data.bmsPosStoreCredit.credit.status
                  }
                />
              ) : null}
            </Card>
            <Card>
              <Heading text="รับสินค้า PO" />
              {(purchaseOrders.data?.bmsPosPurchaseOrders.orders ?? []).map(
                order => (
                  <View key={order.id} style={styles.block}>
                    <Info
                      title={
                        (order.supplier?.name ?? 'Supplier') +
                        ' · ' +
                        order.status
                      }
                      detail={
                        order.qtyReceived +
                        '/' +
                        order.qtyOrdered +
                        ' · ฿' +
                        order.total.toFixed(2)
                      }
                    />
                    <Button
                      label="รับจำนวนคงเหลือทั้งหมด"
                      onPress={() =>
                        run(
                          'po-' + order.id,
                          async idempotencyKey => {
                            const response = await receivePurchase({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  poId: order.id,
                                  idempotencyKey: idempotencyKey!,
                                  items: order.items.flatMap(item => {
                                    const remaining =
                                      item.qtyOrdered - item.qtyReceived;
                                    return remaining > 0
                                      ? [
                                          {
                                            sku: item.sku,
                                            size: item.size,
                                            qty: remaining,
                                            lotNo: null,
                                            expiryDate: null,
                                          },
                                        ]
                                      : [];
                                  }),
                                },
                              },
                            });
                            ensure(response.data?.bmsPosReceivePurchase, [
                              'RECEIVED',
                              'PARTIAL',
                            ]);
                          },
                          () => purchaseOrders.refetch(),
                          'po-receive',
                        )
                      }
                    />
                  </View>
                ),
              )}
            </Card>
          </>
        ) : null}

        {section === 'RESTAURANT' ? (
          <>
            <View style={styles.restaurantNav}>
              <Button
                label="ภาพรวม"
                variant={
                  restaurantView === 'OVERVIEW' ? 'primary' : 'secondary'
                }
                onPress={() => setRestaurantView('OVERVIEW')}
              />
              <Button
                label={`คิว ${activeWaitlistCount}`}
                variant={restaurantView === 'QUEUE' ? 'primary' : 'secondary'}
                onPress={() => setRestaurantView('QUEUE')}
              />
              <Button
                label={`QR ${pendingQrCount}`}
                variant={restaurantView === 'QR' ? 'primary' : 'secondary'}
                onPress={() => setRestaurantView('QR')}
              />
              <Button
                label={`เรียก ${pendingServiceCallCount}`}
                variant={restaurantView === 'CALLS' ? 'primary' : 'secondary'}
                onPress={() => setRestaurantView('CALLS')}
              />
              <Button
                label={`คำขอ ${
                  requests.data?.bmsPosRestaurantRequests.requests.length ?? 0
                }`}
                variant={
                  restaurantView === 'REQUESTS' ? 'primary' : 'secondary'
                }
                onPress={() => setRestaurantView('REQUESTS')}
              />
            </View>
            <Card
              style={{
                display: restaurantView === 'OVERVIEW' ? 'flex' : 'none',
              }}
            >
              <Heading text="ผังโต๊ะและสถานะเมนู" />
              <Info
                title={`${activeWaitlistCount} คิว · ${waitingGuests} คน`}
                detail={`${pendingQrCount} QR รอตรวจ · ${pendingServiceCallCount} คำเรียกค้าง`}
              />
              {!(floor.data?.bmsPosRestaurantFloor.tables.length ?? 0) ? (
                <>
                  <Field
                    value={tableCount}
                    onChangeText={setTableCount}
                    placeholder="จำนวนโต๊ะเริ่มต้น"
                    keyboardType="number-pad"
                  />
                  <Button
                    label="สร้างผังเริ่มต้น"
                    onPress={() =>
                      run(
                        'floor-setup',
                        async () => {
                          const response = await setupFloor({
                            variables: {
                              input: {
                                ...inputCredentials,
                                tableCount: Math.max(
                                  1,
                                  Number(tableCount) || 12,
                                ),
                              },
                            },
                          });
                          if (!response.data?.bmsPosRestaurantFloorSetup.tables)
                            throw new Error('สร้างผังไม่สำเร็จ');
                        },
                        () => floor.refetch(),
                      )
                    }
                  />
                </>
              ) : (
                <Info
                  title={
                    (floor.data?.bmsPosRestaurantFloor.tables.length ?? 0) +
                    ' โต๊ะ'
                  }
                  detail={
                    (floor.data?.bmsPosRestaurantFloor.areas.length ?? 0) +
                    ' โซน'
                  }
                />
              )}
              {(restaurantMenu.data?.bmsPosRestaurantMenu.items ?? [])
                .slice(0, 20)
                .map(item => (
                  <View key={item.sku} style={styles.block}>
                    <Info
                      title={item.name}
                      detail={item.unavailableReason ?? item.availability}
                    />
                    <Button
                      label={item.unavailableReason ? 'กลับมาขาย' : 'หมดวันนี้'}
                      variant={item.unavailableReason ? 'primary' : 'secondary'}
                      onPress={() =>
                        run(
                          'menu-' + item.sku,
                          async () => {
                            const response = await setMenuAvailability({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  productSku: item.sku,
                                  unavailable: !item.unavailableReason,
                                  reason: !item.unavailableReason
                                    ? reason.trim() || 'หมดวันนี้'
                                    : null,
                                },
                              },
                            });
                            ensure(
                              response.data?.bmsPosRestaurantMenuAvailability,
                            );
                          },
                          () => restaurantMenu.refetch(),
                        )
                      }
                    />
                  </View>
                ))}
            </Card>
            <Card
              style={{ display: restaurantView === 'QR' ? 'flex' : 'none' }}
            >
              <Heading text={'QR จากโต๊ะ (' + pendingQrCount + ')'} />
              {qrSubmissions.length === 0 ? (
                <Info
                  title="ไม่มีคำสั่งจาก QR รอตรวจ"
                  detail="ข้อมูลเป็นปัจจุบัน"
                />
              ) : null}
              {qrSubmissions.map(item => (
                <View key={item.id} style={styles.block}>
                  <Info
                    title={
                      item.tableCode + ' · ฿' + item.estimatedTotal.toFixed(2)
                    }
                    detail={item.items.length + ' รายการ · ' + item.status}
                  />
                  <View style={styles.wrap}>
                    <Button
                      label="รับและส่งครัว"
                      onPress={() =>
                        run(
                          'qr-a-' + item.id,
                          async () => {
                            const response = await acceptQr({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  submissionId: item.id,
                                },
                              },
                            });
                            ensure(
                              response.data?.bmsPosRestaurantAcceptQrSubmission,
                              ['ACCEPTED'],
                            );
                          },
                          refreshQr,
                        )
                      }
                    />
                    <Button
                      label="ปฏิเสธ"
                      variant="danger"
                      onPress={() =>
                        run(
                          'qr-r-' + item.id,
                          async () => {
                            const response = await rejectQr({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  submissionId: item.id,
                                  reason: reason.trim() || 'ปฏิเสธโดยพนักงาน',
                                },
                              },
                            });
                            ensure(
                              response.data?.bmsPosRestaurantRejectQrSubmission,
                              ['REJECTED'],
                            );
                          },
                          refreshQr,
                        )
                      }
                    />
                  </View>
                </View>
              ))}
            </Card>
            <Card
              style={{
                display: restaurantView === 'CALLS' ? 'flex' : 'none',
              }}
            >
              <Heading
                text={'เรียกพนักงาน (' + pendingServiceCallCount + ')'}
              />
              {serviceCalls.length === 0 ? (
                <Info
                  title="ไม่มีคำเรียกค้าง"
                  detail="ทุกโต๊ะได้รับการดูแลแล้ว"
                />
              ) : null}
              {serviceCalls.map(call => (
                <View key={call.id} style={styles.block}>
                  <Info
                    title={call.tableCode + ' · ' + call.requestCode}
                    detail={call.requestNote ?? call.status}
                  />
                  <Button
                    label={call.status === 'PENDING' ? 'รับทราบ' : 'เสร็จแล้ว'}
                    onPress={() =>
                      run(
                        'call-' + call.id,
                        async () => {
                          if (call.status === 'PENDING') {
                            const response = await acknowledgeCall({
                              variables: {
                                input: { ...inputCredentials, callId: call.id },
                              },
                            });
                            ensure(
                              response.data
                                ?.bmsPosRestaurantAcknowledgeServiceCall,
                              ['ACKNOWLEDGED'],
                            );
                          } else {
                            const response = await completeCall({
                              variables: {
                                input: { ...inputCredentials, callId: call.id },
                              },
                            });
                            ensure(
                              response.data
                                ?.bmsPosRestaurantCompleteServiceCall,
                              ['COMPLETED'],
                            );
                          }
                        },
                        refreshServiceCalls,
                      )
                    }
                  />
                </View>
              ))}
            </Card>
            <Card
              style={{
                display: restaurantView === 'QUEUE' ? 'flex' : 'none',
              }}
            >
              <Heading text={'คิว / จองโต๊ะ (' + activeWaitlistCount + ')'} />
              <Field
                value={guestName}
                onChangeText={setGuestName}
                placeholder="ชื่อลูกค้า"
              />
              <Field
                value={guestPhone}
                onChangeText={setGuestPhone}
                placeholder="เบอร์โทร"
                keyboardType="phone-pad"
              />
              <Field
                value={partySize}
                onChangeText={setPartySize}
                placeholder="จำนวนคน"
                keyboardType="number-pad"
              />
              <Button
                label="เพิ่มคิว"
                onPress={() =>
                  run(
                    'wait-add',
                    async () => {
                      const response = await addWaitlist({
                        variables: {
                          input: {
                            ...inputCredentials,
                            kind: 'WALK_IN',
                            partySize: Math.max(1, Number(partySize) || 1),
                            guestName: guestName.trim() || null,
                            guestPhone: guestPhone.trim() || null,
                            note: null,
                            preferredTableId: null,
                            reservedFor: null,
                          },
                        },
                      });
                      ensure(response.data?.bmsPosRestaurantAddWaitlistEntry);
                    },
                    refreshWaitlist,
                  )
                }
              />
              {waitlistEntries.length === 0 ? (
                <Info
                  title="ยังไม่มีคิวรอ"
                  detail="เพิ่มลูกค้าได้จากแบบฟอร์มด้านบน"
                />
              ) : null}
              {waitlistEntries.map(entry => (
                <View key={entry.id} style={styles.block}>
                  <Info
                    title={
                      '#' +
                      (entry.queueNo ?? '-') +
                      ' · ' +
                      (entry.guestName ?? 'ลูกค้า') +
                      ' · ' +
                      entry.partySize +
                      ' คน'
                    }
                    detail={entry.status}
                  />
                  <View style={styles.wrap}>
                    {entry.status === 'WAITING' ? (
                      <Button
                        label="เรียกคิว"
                        onPress={() =>
                          run(
                            'wait-call-' + entry.id,
                            async () => {
                              const response = await callWaitlist({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    entryId: entry.id,
                                  },
                                },
                              });
                              ensure(
                                response.data
                                  ?.bmsPosRestaurantCallWaitlistEntry,
                              );
                            },
                            refreshWaitlist,
                          )
                        }
                      />
                    ) : null}
                    {['WAITING', 'CALLED'].includes(entry.status) ? (
                      <>
                        <Button
                          label="ไม่มา"
                          variant="secondary"
                          onPress={() =>
                            run(
                              'wait-no-' + entry.id,
                              async () => {
                                const response = await noShowWaitlist({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      entryId: entry.id,
                                      reason: 'ไม่มาตามคิว',
                                    },
                                  },
                                });
                                ensure(
                                  response.data
                                    ?.bmsPosRestaurantNoShowWaitlistEntry,
                                );
                              },
                              refreshWaitlist,
                            )
                          }
                        />
                        <Button
                          label="ยกเลิก"
                          variant="danger"
                          onPress={() =>
                            run(
                              'wait-cancel-' + entry.id,
                              async () => {
                                const response = await cancelWaitlist({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      entryId: entry.id,
                                      reason: reason.trim() || 'ยกเลิกคิว',
                                    },
                                  },
                                });
                                ensure(
                                  response.data
                                    ?.bmsPosRestaurantCancelWaitlistEntry,
                                );
                              },
                              refreshWaitlist,
                            )
                          }
                        />
                      </>
                    ) : null}
                  </View>
                  {entry.status === 'CALLED' ? (
                    <View style={styles.wrap}>
                      {freeTables.map(table => (
                        <Button
                          key={table.id}
                          label={'นั่ง ' + table.code}
                          variant="secondary"
                          onPress={() =>
                            run(
                              'seat-' + entry.id + '-' + table.id,
                              async () => {
                                const response = await seatWaitlist({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      entryId: entry.id,
                                      tableId: table.id,
                                    },
                                  },
                                });
                                ensure(
                                  response.data
                                    ?.bmsPosRestaurantSeatWaitlistEntry,
                                  ['SEATED'],
                                );
                              },
                              async () => {
                                await Promise.all([
                                  refreshWaitlist(),
                                  floor.refetch(),
                                ]);
                              },
                            )
                          }
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </Card>
            <Card
              style={{
                display: restaurantView === 'REQUESTS' ? 'flex' : 'none',
              }}
            >
              <Heading
                text={
                  'คำขอร้านอาหาร (' +
                  (requests.data?.bmsPosRestaurantRequests.requests.length ??
                    0) +
                  ')'
                }
              />
              <Field
                value={reason}
                onChangeText={setReason}
                placeholder="บันทึกผลการตรวจ / ติดต่อ"
              />
              {(requests.data?.bmsPosRestaurantRequests.requests ?? []).map(
                item => (
                  <View key={item.id} style={styles.block}>
                    <Info
                      title={
                        (item.customerName ?? 'ลูกค้า') +
                        ' · ' +
                        item.fulfillmentType
                      }
                      detail={
                        item.status +
                        ' · ' +
                        item.items
                          .map(
                            line => (line.name ?? line.sku) + ' × ' + line.qty,
                          )
                          .join(', ')
                      }
                    />
                    <View style={styles.wrap}>
                      <Button
                        label="ติดต่อแล้ว"
                        variant="secondary"
                        disabled={!reason.trim()}
                        onPress={() =>
                          run(
                            'request-contact-' + item.id,
                            async () => {
                              const response = await contactRequest({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    id: item.id,
                                    version: item.version,
                                    quantities: item.items.map(
                                      line => line.qty,
                                    ),
                                    note: reason.trim(),
                                    kitchenNote: null,
                                    confirmed: true,
                                  },
                                },
                              });
                              ensure(
                                response.data?.bmsPosRestaurantContactRequest,
                                ['CONTACTING'],
                              );
                            },
                            () => requests.refetch(),
                          )
                        }
                      />
                      <Button
                        label="ยืนยัน"
                        disabled={!reason.trim()}
                        onPress={() =>
                          run(
                            'request-confirm-' + item.id,
                            async () => {
                              const response = await confirmRequest({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    id: item.id,
                                    version: item.version,
                                    quantities: item.items.map(
                                      line => line.qty,
                                    ),
                                    note: reason.trim(),
                                    kitchenNote: '',
                                    confirmed: true,
                                  },
                                },
                              });
                              ensure(
                                response.data?.bmsPosRestaurantConfirmRequest,
                                ['CONFIRMED'],
                              );
                            },
                            () => requests.refetch(),
                          )
                        }
                      />
                      <Button
                        label="ยกเลิก"
                        variant="danger"
                        onPress={() =>
                          run(
                            'request-cancel-' + item.id,
                            async () => {
                              const response = await cancelRequest({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    id: item.id,
                                    version: item.version,
                                    quantities: null,
                                    note: reason.trim() || 'ยกเลิกคำขอ',
                                    kitchenNote: null,
                                    confirmed: true,
                                  },
                                },
                              });
                              ensure(
                                response.data?.bmsPosRestaurantCancelRequest,
                                ['CANCELLED'],
                              );
                            },
                            () => requests.refetch(),
                          )
                        }
                      />
                    </View>
                  </View>
                ),
              )}
            </Card>
          </>
        ) : null}

        {section === 'SUPPORT' ? (
          <Card>
            <Heading text="สถานะเครื่องและการเชื่อมต่อ" />
            <Info
              title="Device"
              detail={
                bootstrap.data?.bmsPosSession.device.code ?? 'ยังไม่พร้อม'
              }
            />
            <Info
              title="สาขา"
              detail={
                bootstrap.data?.bmsPosSession.location?.name ?? 'ไม่พบสาขา'
              }
            />
            <Info
              title="กะ"
              detail={
                bootstrap.data?.bmsPosSession.shift?.status ?? 'ยังไม่เปิด'
              }
            />
            <Info
              title="โหมด"
              detail={
                bootstrap.data?.bmsPosSession.businessArchetype ?? 'retail'
              }
            />
            <Info
              title="VAT"
              detail={
                (bootstrap.data?.bmsPosSession.vat.registered
                  ? 'จด VAT'
                  : 'ไม่จด VAT') +
                ' · ' +
                (bootstrap.data?.bmsPosSession.vat.rate ?? 0) +
                '%'
              }
            />
            <Button label="ตรวจใหม่" onPress={() => bootstrap.refetch()} />
          </Card>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function Heading({ text }: { text: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.subtitle, { color: colors.text }]}>{text}</Text>
  );
}
function Info({ title, detail }: { title: string; detail: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.info}>
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {detail}
      </Text>
    </View>
  );
}
function Field(props: React.ComponentProps<typeof TextInput>) {
  const { colors, typography } = useTheme();
  return (
    <TextInput
      {...props}
      autoCorrect={false}
      placeholderTextColor={colors.textSoft}
      style={[
        typography.body,
        styles.input,
        { color: colors.text, borderColor: colors.border },
        props.style,
      ]}
    />
  );
}
function Approvers({
  people,
  selected,
  onSelect,
}: {
  people: Array<{ id: string; name?: string | null }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {people.map(person => (
        <Button
          key={person.id}
          label={person.name ?? person.id}
          variant={selected === person.id ? 'primary' : 'secondary'}
          onPress={() => onSelect(person.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  restaurantNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  block: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#80808055',
  },
  info: { gap: 2, paddingVertical: 4 },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginVertical: 4,
  },
});
