import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  TABLET_SIDEBAR_WIDTH,
  TabletMainNavigation,
} from '../../components/TabletMainNavigation';
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
  type MobilePosDepositsQuery,
  type MobilePosExpensesQuery,
  type MobilePosPurchaseOrdersQuery,
} from '../../graphql/generated';
import { createIdempotencyKey } from '../../lib/operation';
import { useSession } from '../../state/SessionContext';
import { useStoreMode } from '../../state/StoreModeContext';
import { useRestaurantOperations } from '../../state/RestaurantOperationsContext';
import { useTheme } from '../../theme/ThemeProvider';
import type { OperationsStackParamList } from '../../navigation/types';
import { getAppNavigation } from '../../navigation/parentNavigation';

type Section = 'OVERVIEW' | 'REGISTER' | 'RESTAURANT' | 'SUPPORT';
type RestaurantView = 'OVERVIEW' | 'QUEUE' | 'QR' | 'CALLS' | 'REQUESTS';
type RegisterView =
  | 'MENU'
  | 'NO_SALE'
  | 'BLIND_RETURN'
  | 'DEPOSITS'
  | 'EXPENSES'
  | 'AR'
  | 'PURCHASES';

const LOCKED_TITLE: Record<Section, string> = {
  OVERVIEW: 'งานหน้าร้าน',
  RESTAURANT: 'งานเข้า',
  REGISTER: 'เคาน์เตอร์',
  SUPPORT: 'สถานะระบบ',
};

class BusinessResultError extends Error {}

/**
 * จอนี้ถูกใช้สองที่โดยตั้งใจ ไม่ใช่เพราะขี้เกียจแยกไฟล์:
 *
 *  - รายละเอียดจากแท็บ "งานเข้า" → `section="RESTAURANT"` + `locked` = เห็นเฉพาะคิว/QR/เรียก/คำขอ
 *  - แท็บ "งาน" → ไม่ส่งอะไร = dashboard งานหน้าร้าน เคาน์เตอร์ และสถานะระบบ
 *
 * แยกด้วย props เพราะจอเดียวกันเป็นทั้ง tab root และรายละเอียดเหนือแท็บ ปุ่มที่ใช้ navigation
 * ของ "เพิ่มเติม" (สต็อกสาขา/กะ) จึงถูกซ่อนเมื่อเปิดเป็นรายละเอียด `locked`
 */
type Props = {
  /** ส่วนที่เปิดค้างไว้ตอนเข้าจอ */
  section?: Section;
  /** ซ่อนตัวสลับส่วน — แท็บที่พามาที่นี่ตั้งใจให้เห็นส่วนเดียว */
  locked?: boolean;
  initialRestaurantView?: RestaurantView;
  onBack?: () => void;
};

export default function OperationsScreen({
  section: initialSection,
  locked = false,
  initialRestaurantView,
  onBack,
}: Props) {
  const navigation =
    useNavigation<NativeStackNavigationProp<OperationsStackParamList>>();
  const { colors, spacing, typography } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width >= 760;
  const { session } = useSession();
  const { mode } = useStoreMode();
  const credentials = session?.credentials;
  const [section, setSection] = useState<Section>(
    initialSection ?? (mode === 'restaurant' ? 'RESTAURANT' : 'OVERVIEW'),
  );
  const [registerView, setRegisterView] = useState<RegisterView>('MENU');
  const [restaurantView, setRestaurantView] = useState<RestaurantView>(
    initialRestaurantView ?? 'OVERVIEW',
  );
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

  const registerDataVisible = section === 'OVERVIEW' || section === 'REGISTER';
  const bootstrap = useQuery(PosBootstrapDocument, { skip: !session });
  const noSales = useQuery(MobilePosNoSalesDocument, {
    skip: !session || section !== 'REGISTER' || registerView !== 'NO_SALE',
  });
  const deposits = useQuery(MobilePosDepositsDocument, {
    variables: { q: null },
    skip: !session || !registerDataVisible,
  });
  const expenses = useQuery(MobilePosExpensesDocument, {
    variables: { credentials: credentials! },
    skip: !credentials || !registerDataVisible,
  });
  const purchaseOrders = useQuery(MobilePosPurchaseOrdersDocument, {
    variables: { credentials: credentials! },
    skip: !credentials || !registerDataVisible,
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
    skip: !session || section !== 'REGISTER' || registerView !== 'AR',
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
      if (initialRestaurantView) {
        setRestaurantView(initialRestaurantView);
        return;
      }
      setRestaurantView(
        pendingServiceCallCount > 0
          ? 'CALLS'
          : pendingQrCount > 0
          ? 'QR'
          : activeWaitlistCount > 0
          ? 'QUEUE'
          : 'OVERVIEW',
      );
    }, [
      activeWaitlistCount,
      initialRestaurantView,
      mode,
      pendingQrCount,
      pendingServiceCallCount,
    ]),
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

  const depositRows = deposits.data?.bmsPosDeposits.deposits ?? [];
  const expenseRows = expenses.data?.bmsPosExpenses.expenses ?? [];
  const openAdvances = expenseRows.filter(
    item => item.kind === 'ADVANCE' && item.status !== 'SETTLED',
  );
  const receivableOrders = (
    purchaseOrders.data?.bmsPosPurchaseOrders.orders ?? []
  ).filter(order => order.qtyReceived < order.qtyOrdered);
  const pendingWorkCount =
    depositRows.length + openAdvances.length + receivableOrders.length;
  const systemReady = Boolean(
    bootstrap.data?.bmsPosSession.device.code &&
      bootstrap.data?.bmsPosSession.location?.name &&
      !bootstrap.error,
  );
  const branchName = session?.branch.name ?? 'ไม่พบสาขา';
  const branchLabel = branchName.replace(/^BOOM\s+/, 'BOOM · ');
  const pettyCashBalance =
    expenses.data?.bmsPosExpenses.pettyCashWallet.balance ?? 0;

  const openRegister = (view: RegisterView) => {
    setRegisterView(view);
    setSection('REGISTER');
  };
  const openInventory = () =>
    getAppNavigation(navigation).navigate('InventoryDetail');
  const refreshOverview = async () => {
    await Promise.all([
      bootstrap.refetch(),
      deposits.refetch(),
      expenses.refetch(),
      purchaseOrders.refetch(),
    ]);
  };

  const sectionNavigation = (
    <View style={styles.phoneSectionNav}>
      <SectionTab
        label="ภาพรวม"
        selected={section === 'OVERVIEW'}
        onPress={() => setSection('OVERVIEW')}
      />
      <SectionTab
        label="เคาน์เตอร์"
        selected={section === 'REGISTER'}
        onPress={() => openRegister('MENU')}
      />
      <SectionTab
        label="สถานะระบบ"
        selected={section === 'SUPPORT'}
        onPress={() => setSection('SUPPORT')}
      />
    </View>
  );

  const body = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {section === 'OVERVIEW' ? (
        <OperationsOverview
          isTablet={isTablet}
          pendingWorkCount={pendingWorkCount}
          approvalCount={openAdvances.length}
          pettyCashBalance={pettyCashBalance}
          systemReady={systemReady}
          deposits={depositRows}
          advances={openAdvances}
          purchaseOrders={receivableOrders}
          onOpenRegister={openRegister}
          onOpenSupport={() => setSection('SUPPORT')}
          navigation={isTablet ? undefined : sectionNavigation}
        />
      ) : null}
      {section === 'REGISTER' ? (
        <>
          {registerView === 'MENU' ? (
            <CounterActionMenu onOpen={openRegister} />
          ) : (
            <View style={styles.workflowBack}>
              <Button
                label="← งานเคาน์เตอร์"
                variant="secondary"
                onPress={() => setRegisterView('MENU')}
              />
            </View>
          )}
          <Card
            style={{
              display: registerView === 'NO_SALE' ? 'flex' : 'none',
            }}
          >
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
          <Card
            style={{
              display: registerView === 'BLIND_RETURN' ? 'flex' : 'none',
            }}
          >
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
          <Card
            style={{
              display: registerView === 'DEPOSITS' ? 'flex' : 'none',
            }}
          >
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
                                reason: reason.trim() || 'ยกเลิกจาก POS Mobile',
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
          <Card
            style={{
              display: registerView === 'EXPENSES' ? 'flex' : 'none',
            }}
          >
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
                      item.description + ' · ฿' + item.advancedAmount.toFixed(2)
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
          <Card style={{ display: registerView === 'AR' ? 'flex' : 'none' }}>
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
                    label={member.name ?? member.memberNo ?? member.customerId}
                    variant={
                      customerId === member.customerId ? 'primary' : 'secondary'
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
                        const account = arAccount.data?.bmsPosArAccount.account;
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
          <Card
            style={{
              display: registerView === 'PURCHASES' ? 'flex' : 'none',
            }}
          >
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
              variant={restaurantView === 'OVERVIEW' ? 'primary' : 'secondary'}
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
              variant={restaurantView === 'REQUESTS' ? 'primary' : 'secondary'}
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
                              tableCount: Math.max(1, Number(tableCount) || 12),
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
                  (floor.data?.bmsPosRestaurantFloor.areas.length ?? 0) + ' โซน'
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
          <Card style={{ display: restaurantView === 'QR' ? 'flex' : 'none' }}>
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
            <Heading text={'เรียกพนักงาน (' + pendingServiceCallCount + ')'} />
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
                            response.data?.bmsPosRestaurantCompleteServiceCall,
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
                              response.data?.bmsPosRestaurantCallWaitlistEntry,
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
                (requests.data?.bmsPosRestaurantRequests.requests.length ?? 0) +
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
                        .map(line => (line.name ?? line.sku) + ' × ' + line.qty)
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
                                  quantities: item.items.map(line => line.qty),
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
                                  quantities: item.items.map(line => line.qty),
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
            detail={bootstrap.data?.bmsPosSession.device.code ?? 'ยังไม่พร้อม'}
          />
          <Info
            title="สาขา"
            detail={bootstrap.data?.bmsPosSession.location?.name ?? 'ไม่พบสาขา'}
          />
          <Info
            title="กะ"
            detail={bootstrap.data?.bmsPosSession.shift?.status ?? 'ยังไม่เปิด'}
          />
          <Info
            title="โหมด"
            detail={bootstrap.data?.bmsPosSession.businessArchetype ?? 'retail'}
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
  );

  // ร้านอาหารและจอที่เปิดเป็นรายละเอียดใช้โครงเดิม เพราะมีชุดคิว/QR ของตัวเอง
  // ส่วนร้านค้าทั่วไปใช้ dashboard ใหม่ที่ตำแหน่งเดียวกันทั้ง iPhone และ iPad
  if (locked || mode === 'restaurant') {
    return (
      <ScreenContainer>
        {onBack ? (
          <ScreenHeader title={LOCKED_TITLE[section]} onBack={onBack} />
        ) : (
          <ScreenHeader title="เพิ่มเติม" subtitle={branchLabel} />
        )}
        {locked ? null : (
          <View style={styles.wrap}>
            <Button
              label="เคาน์เตอร์"
              variant={section === 'REGISTER' ? 'primary' : 'secondary'}
              onPress={() => openRegister('MENU')}
            />
            <Button
              label="สถานะระบบ"
              variant={section === 'SUPPORT' ? 'primary' : 'secondary'}
              onPress={() => setSection('SUPPORT')}
            />
            <Button
              label="สต็อกสาขา"
              variant="secondary"
              onPress={openInventory}
            />
            <Button
              label="กะ/ลิ้นชัก"
              variant="secondary"
              onPress={() =>
                getAppNavigation(navigation).navigate('ShiftDetail')
              }
            />
          </View>
        )}
        {body}
      </ScreenContainer>
    );
  }

  if (!isTablet) {
    return (
      <ScreenContainer>
        <OperationsPageHeader title="งานหน้าร้าน" subtitle={branchLabel} />
        {section === 'OVERVIEW' ? null : sectionNavigation}
        {body}
      </ScreenContainer>
    );
  }

  const tabletTitle =
    section === 'OVERVIEW' ? 'ภาพรวมงานหน้าร้าน' : LOCKED_TITLE[section];

  return (
    <ScreenContainer padded={false}>
      <View style={styles.tabletShell}>
        <View
          style={[
            styles.tabletSidebar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.sidebarHeader}>
            <Text style={[typography.title, { color: colors.text }]}>
              งานหน้าร้าน
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {branchLabel}
            </Text>
          </View>

          <View style={styles.sidebarSections}>
            {[
              { key: 'OVERVIEW' as const, glyph: '▦', label: 'ภาพรวม' },
              { key: 'REGISTER' as const, glyph: '▣', label: 'เคาน์เตอร์' },
              { key: 'SUPPORT' as const, glyph: '◉', label: 'สถานะระบบ' },
            ].map(item => (
              <SidebarSectionButton
                key={item.key}
                glyph={item.glyph}
                label={item.label}
                selected={section === item.key}
                onPress={() =>
                  item.key === 'REGISTER'
                    ? openRegister('MENU')
                    : setSection(item.key)
                }
              />
            ))}
            <SidebarSectionButton
              glyph="◇"
              label="สต็อกสาขา"
              selected={false}
              onPress={() =>
                getAppNavigation(navigation).navigate('Tabs', {
                  screen: 'InventoryTab',
                })
              }
            />
          </View>

          <View
            style={[styles.sidebarDivider, { borderColor: colors.border }]}
          />
          <View style={styles.sidebarStatus}>
            <Text
              style={[typography.captionStrong, { color: colors.textSoft }]}
            >
              สถานะงาน
            </Text>
            <SidebarStatus
              label="งานค้าง"
              value={pendingWorkCount}
              color={colors.danger}
            />
            <SidebarStatus
              label="รออนุมัติ"
              value={openAdvances.length}
              color={colors.warning}
            />
            <SidebarStatus
              label="กำลังดำเนินการ"
              value={0}
              color={colors.primary}
            />
            <SidebarStatus
              label="เสร็จสิ้นวันนี้"
              value={0}
              color={colors.success}
            />
          </View>

          <TabletMainNavigation
            activeTab="OperationsTab"
            showBoardGame={mode === 'board_game_cafe'}
            onNavigate={tab =>
              getAppNavigation(navigation).navigate('Tabs', { screen: tab })
            }
          />
        </View>

        <View style={[styles.tabletMain, { backgroundColor: colors.bg }]}>
          <OperationsPageHeader
            title={tabletTitle}
            subtitle={
              section === 'OVERVIEW'
                ? `${branchLabel} · ${new Date().toLocaleString('th-TH', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}`
                : branchLabel
            }
            right={
              section === 'OVERVIEW' ? (
                <Button
                  label="↻ รีเฟรช"
                  variant="secondary"
                  onPress={refreshOverview}
                />
              ) : undefined
            }
          />
          {body}
        </View>
      </View>
    </ScreenContainer>
  );
}

function OperationsPageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const isTablet = width >= 760;
  return (
    <View style={styles.operationsHeader}>
      <View style={styles.operationsHeaderTitles}>
        <Text
          style={[
            isTablet ? typography.displayLg : styles.operationsPhoneTitle,
            { color: colors.text },
          ]}
        >
          {title}
        </Text>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {subtitle}
        </Text>
      </View>
      {right}
    </View>
  );
}

type RegisterAction = {
  key: Exclude<RegisterView, 'MENU'>;
  glyph: string;
  title: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger';
};

const REGISTER_ACTIONS: RegisterAction[] = [
  {
    key: 'NO_SALE',
    glyph: '▤',
    title: 'เปิดลิ้นชัก',
    detail: 'บันทึกเหตุผลโดยไม่มีการขาย',
    tone: 'primary',
  },
  {
    key: 'BLIND_RETURN',
    glyph: '↩',
    title: 'คืนสินค้าไม่มีใบเสร็จ',
    detail: 'ต้องใช้ผู้อนุมัติและ PIN คนที่สอง',
    tone: 'danger',
  },
  {
    key: 'DEPOSITS',
    glyph: '▣',
    title: 'มัดจำ / รับของ',
    detail: 'รับเพิ่ม ส่งมอบ หรือปิดรายการ',
    tone: 'success',
  },
  {
    key: 'EXPENSES',
    glyph: '฿',
    title: 'ค่าใช้จ่าย / เงินสดย่อย',
    detail: 'บันทึกจ่าย เติมเงิน และปิดเงินทดรอง',
    tone: 'warning',
  },
  {
    key: 'AR',
    glyph: '◎',
    title: 'ลูกหนี้ / เครดิตร้าน',
    detail: 'ค้นหาสมาชิกและรับชำระยอดค้าง',
    tone: 'primary',
  },
  {
    key: 'PURCHASES',
    glyph: '⇥',
    title: 'รับสินค้า PO',
    detail: 'ตรวจรับจำนวนคงเหลือเข้าสต็อกสาขา',
    tone: 'success',
  },
];

type OperationsOverviewProps = {
  isTablet: boolean;
  pendingWorkCount: number;
  approvalCount: number;
  pettyCashBalance: number;
  systemReady: boolean;
  deposits: MobilePosDepositsQuery['bmsPosDeposits']['deposits'];
  advances: MobilePosExpensesQuery['bmsPosExpenses']['expenses'];
  purchaseOrders: MobilePosPurchaseOrdersQuery['bmsPosPurchaseOrders']['orders'];
  onOpenRegister: (view: RegisterView) => void;
  onOpenSupport: () => void;
  navigation?: React.ReactNode;
};

type OverviewTask = {
  key: string;
  glyph: string;
  title: string;
  detail: string;
  timestamp: string;
  badge: string;
  tone: 'primary' | 'warning' | 'danger';
  actionLabel: string;
  action: () => void;
};

function OperationsOverview({
  isTablet,
  pendingWorkCount,
  approvalCount,
  pettyCashBalance,
  systemReady,
  deposits,
  advances,
  purchaseOrders,
  onOpenRegister,
  onOpenSupport,
  navigation,
}: OperationsOverviewProps) {
  const { colors, spacing, typography } = useTheme();
  const summaries = [
    {
      label: 'งานค้าง',
      value: String(pendingWorkCount),
      note: 'รายการที่ต้องดำเนินการ',
      glyph: '▣',
      ink: colors.danger,
      background: colors.dangerBg,
    },
    {
      label: 'รออนุมัติ',
      value: String(approvalCount),
      note: 'รายการรอการอนุมัติ',
      glyph: '◷',
      ink: colors.warning,
      background: colors.warningBg,
    },
    {
      label: 'เงินสดย่อย',
      value: `฿${pettyCashBalance.toLocaleString('th-TH', {
        maximumFractionDigits: 2,
      })}`,
      note: 'ยอดคงเหลือปัจจุบัน',
      glyph: '▰',
      ink: colors.primary,
      background: `${colors.primary}0e`,
    },
    {
      label: 'สถานะระบบ',
      value: systemReady ? 'ปกติ' : 'ตรวจสอบ',
      note: systemReady ? 'ทุกระบบใช้งานได้' : 'มีรายการที่ต้องตรวจสอบ',
      glyph: '✓',
      ink: systemReady ? colors.success : colors.danger,
      background: systemReady ? colors.successBg : colors.dangerBg,
    },
  ];
  const tasks: OverviewTask[] = [
    ...deposits.map(item => ({
      key: `deposit-${item.id}`,
      glyph: '↓',
      title: item.customerName
        ? `มัดจำ / รับของ · ${item.customerName}`
        : 'มัดจำ / รับของ',
      detail: `${
        item.itemQty
      } รายการ · คงเหลือ ฿${item.balanceDue.toLocaleString('th-TH')}`,
      timestamp: item.createdAt,
      badge: item.overdue ? 'เกินกำหนด' : 'รอดำเนินการ',
      tone: item.overdue ? ('danger' as const) : ('warning' as const),
      actionLabel: 'ทำรายการ',
      action: () => onOpenRegister('DEPOSITS'),
    })),
    ...advances.map(item => ({
      key: `advance-${item.id}`,
      glyph: '฿',
      title: 'ปิดเงินทดรอง',
      detail: `${item.description} · ฿${item.advancedAmount.toLocaleString(
        'th-TH',
      )}`,
      timestamp: item.createdAt,
      badge: 'รอปิดยอด',
      tone: 'warning' as const,
      actionLabel: 'ทำรายการ',
      action: () => onOpenRegister('EXPENSES'),
    })),
    ...purchaseOrders.map(order => ({
      key: `purchase-${order.id}`,
      glyph: '◇',
      title: 'รับสินค้าเข้า',
      detail: `${order.supplier?.name ?? 'Supplier'} · ${
        order.qtyOrdered - order.qtyReceived
      } ชิ้นรอตรวจรับ`,
      timestamp: order.createdAt,
      badge: 'พร้อมทำ',
      tone: 'primary' as const,
      actionLabel: 'ไปสต็อก',
      action: () => onOpenRegister('PURCHASES'),
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() -
        new Date(left.timestamp).getTime(),
    )
    .slice(0, 3);

  return (
    <View style={{ gap: isTablet ? spacing.lg : spacing.md }}>
      <View style={[styles.summaryGrid, isTablet && styles.summaryGridTablet]}>
        {summaries.map(item => (
          <View
            key={item.label}
            style={[
              styles.summaryCard,
              isTablet && styles.summaryCardTablet,
              {
                backgroundColor: item.background,
                borderColor: `${item.ink}20`,
              },
            ]}
          >
            <View
              style={[styles.summaryIcon, { backgroundColor: `${item.ink}15` }]}
            >
              <Text style={[styles.summaryGlyph, { color: item.ink }]}>
                {item.glyph}
              </Text>
            </View>
            <View style={styles.summaryText}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {item.label}
              </Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {item.value}
              </Text>
              <Text
                style={[styles.summaryNote, { color: colors.textMuted }]}
                numberOfLines={1}
              >
                {item.note}
              </Text>
            </View>
            <Text style={[styles.summaryChevron, { color: item.ink }]}>›</Text>
          </View>
        ))}
      </View>

      {navigation}

      <View
        style={[styles.dashboardColumns, !isTablet && styles.dashboardStack]}
      >
        <Card style={styles.dashboardPrimaryCard}>
          <View style={styles.panelHeading}>
            <Text
              style={[typography.subtitle, { color: colors.text, flex: 1 }]}
            >
              งานที่ต้องทำ
            </Text>
            <Text style={[typography.bodyStrong, { color: colors.primary }]}>
              ดูทั้งหมด ›
            </Text>
          </View>
          {tasks.length ? (
            tasks.map(item => (
              <OverviewTaskRow key={item.key} item={item} isTablet={isTablet} />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyGlyph, { color: colors.success }]}>
                ✓
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ไม่มีงานค้างในขณะนี้
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                งานใหม่จากมัดจำ เงินทดรอง และ PO จะขึ้นที่นี่
              </Text>
            </View>
          )}
        </Card>

        <Card style={styles.dashboardSecondaryCard}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ทางลัดเคาน์เตอร์
          </Text>
          <CounterShortcuts onOpen={onOpenRegister} />
          <Pressable
            accessibilityRole="button"
            onPress={onOpenSupport}
            style={({ pressed }) => [
              styles.systemReadyCard,
              {
                backgroundColor: pressed ? colors.surface3 : colors.successBg,
              },
            ]}
          >
            <View
              style={[
                styles.systemReadyIcon,
                { backgroundColor: colors.success },
              ]}
            >
              <Text style={styles.systemReadyIconText}>✓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.success }]}>
                {systemReady ? 'ระบบพร้อมใช้งาน' : 'ตรวจสอบระบบ'}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {systemReady
                  ? 'อุปกรณ์และการเชื่อมต่อปกติ'
                  : 'แตะเพื่อดูรายละเอียดสถานะ'}
              </Text>
            </View>
          </Pressable>
        </Card>
      </View>
    </View>
  );
}

function OverviewTaskRow({
  item,
  isTablet,
}: {
  item: OverviewTask;
  isTablet: boolean;
}) {
  const { colors, typography } = useTheme();
  const ink =
    item.tone === 'danger'
      ? colors.danger
      : item.tone === 'warning'
      ? colors.warning
      : colors.primary;
  return (
    <View
      style={[
        styles.overviewTask,
        !isTablet && styles.overviewTaskPhone,
        { borderColor: colors.border },
      ]}
    >
      <View style={styles.overviewTaskMain}>
        <View style={[styles.taskIcon, { backgroundColor: `${ink}14` }]}>
          <Text style={[styles.taskGlyph, { color: ink }]}>{item.glyph}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.taskTitleRow}>
            <Text
              style={[typography.bodyStrong, { color: colors.text, flex: 1 }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {!isTablet ? (
              <View style={[styles.taskBadge, { backgroundColor: `${ink}14` }]}>
                <Text style={[typography.captionStrong, { color: ink }]}>
                  {item.badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {item.detail}
          </Text>
          <Text style={[typography.caption, { color: colors.textSoft }]}>
            ◷{' '}
            {new Date(item.timestamp).toLocaleString('th-TH', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
      {isTablet ? (
        <View style={styles.taskActions}>
          <View style={[styles.taskBadge, { backgroundColor: `${ink}14` }]}>
            <Text style={[typography.captionStrong, { color: ink }]}>
              {item.badge}
            </Text>
          </View>
          <Button label={item.actionLabel} onPress={item.action} />
        </View>
      ) : (
        <Button
          label={item.actionLabel}
          onPress={item.action}
          fullWidth
          style={styles.taskPhoneButton}
        />
      )}
    </View>
  );
}

function CounterShortcuts({
  onOpen,
}: {
  onOpen: (view: RegisterView) => void;
}) {
  const { colors, radius, typography } = useTheme();
  const shortcuts = [
    {
      key: 'deposit',
      glyph: '↓',
      title: 'มัดจำ / รับของ',
      detail: 'รับมัดจำและส่งมอบสินค้า',
      action: () => onOpen('DEPOSITS'),
    },
    {
      key: 'expense',
      glyph: '▤',
      title: 'ค่าใช้จ่าย',
      detail: 'บันทึกค่าใช้จ่ายต่าง ๆ',
      action: () => onOpen('EXPENSES'),
    },
    {
      key: 'petty',
      glyph: '฿',
      title: 'เงินสดย่อย',
      detail: 'จัดการเงินสดย่อย',
      action: () => onOpen('EXPENSES'),
    },
  ];
  return (
    <View style={styles.shortcutList}>
      {shortcuts.map(item => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          onPress={item.action}
          style={({ pressed }) => [
            styles.shortcutRow,
            {
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: pressed ? colors.surface2 : colors.surface,
            },
          ]}
        >
          <View
            style={[
              styles.shortcutIcon,
              { backgroundColor: `${colors.primary}10` },
            ]}
          >
            <Text style={[styles.shortcutGlyph, { color: colors.primary }]}>
              {item.glyph}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              {item.title}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {item.detail}
            </Text>
          </View>
          <Text style={[styles.chevron, { color: colors.textSoft }]}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CounterActionMenu({
  onOpen,
}: {
  onOpen: (view: RegisterView) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={{ gap: 2 }}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          งานเคาน์เตอร์
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          เปิดทีละงานเพื่อลดความผิดพลาดและไม่ต้องเลื่อนผ่านแบบฟอร์มที่ไม่เกี่ยวข้อง
        </Text>
      </View>
      <ActionGrid onOpen={onOpen} />
    </Card>
  );
}

function ActionGrid({
  onOpen,
  compact = false,
}: {
  onOpen: (view: RegisterView) => void;
  compact?: boolean;
}) {
  const { colors, spacing, radius, typography } = useTheme();
  const toneColor = (tone: RegisterAction['tone']) =>
    tone === 'success'
      ? colors.success
      : tone === 'warning'
      ? colors.warning
      : tone === 'danger'
      ? colors.danger
      : colors.primary;
  return (
    <View style={styles.actionGrid}>
      {REGISTER_ACTIONS.map(action => {
        const ink = toneColor(action.tone);
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.title}
            onPress={() => onOpen(action.key)}
            style={({ pressed }) => [
              styles.actionTile,
              compact && styles.actionTileCompact,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.surface2 : colors.surface,
                padding: compact ? spacing.md : spacing.lg,
              },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: `${ink}16` }]}>
              <Text style={[styles.actionGlyph, { color: ink }]}>
                {action.glyph}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {action.title}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textMuted }]}
                numberOfLines={compact ? 1 : 2}
              >
                {action.detail}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textSoft }]}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionTab,
        {
          borderRadius: radius.md,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected
            ? colors.primary
            : pressed
            ? colors.surface3
            : colors.surface2,
        },
      ]}
    >
      <Text
        style={[
          typography.bodyStrong,
          { color: selected ? colors.primaryText : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SidebarSectionButton({
  glyph,
  label,
  selected,
  onPress,
}: {
  glyph: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sidebarButton,
        {
          backgroundColor: selected
            ? `${colors.primary}18`
            : pressed
            ? colors.surface2
            : 'transparent',
        },
      ]}
    >
      <Text
        style={[
          styles.sidebarGlyph,
          { color: selected ? colors.primary : colors.textMuted },
        ]}
      >
        {glyph}
      </Text>
      <Text
        style={[
          typography.bodyStrong,
          { color: selected ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SidebarStatus({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.sidebarStatusRow}>
      <View style={styles.sidebarStatusLabel}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {label}
        </Text>
      </View>
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        {value}
      </Text>
    </View>
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
  operationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  operationsHeaderTitles: { flex: 1, minWidth: 0, gap: 2 },
  operationsPhoneTitle: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  workflowBack: { alignItems: 'flex-start' },
  phoneSectionNav: {
    flexDirection: 'row',
    gap: 0,
  },
  sectionTab: {
    minHeight: 44,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 0,
  },
  tabletShell: { flex: 1, flexDirection: 'row' },
  tabletSidebar: {
    width: TABLET_SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  tabletMain: { flex: 1, minWidth: 0, padding: 24 },
  sidebarHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  sidebarSections: { paddingHorizontal: 12, gap: 3 },
  sidebarButton: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sidebarGlyph: { width: 24, textAlign: 'center', fontSize: 18 },
  sidebarDivider: {
    marginHorizontal: 16,
    marginVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sidebarStatus: { paddingHorizontal: 16, gap: 10 },
  sidebarStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 22,
  },
  sidebarStatusLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 999 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryGridTablet: { flexWrap: 'nowrap', gap: 16 },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 106,
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  summaryCardTablet: {
    flex: 1,
    flexBasis: 0,
    minHeight: 126,
    padding: 16,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: { flex: 1, minWidth: 0, gap: 1 },
  summaryGlyph: { fontSize: 19, fontWeight: '700' },
  summaryValue: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryNote: { fontSize: 9, lineHeight: 12, fontWeight: '400' },
  summaryChevron: { fontSize: 24, lineHeight: 28, alignSelf: 'center' },
  dashboardColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  dashboardStack: { flexDirection: 'column' },
  dashboardPrimaryCard: { flex: 1.8, width: '100%', gap: 12 },
  dashboardSecondaryCard: { flex: 0.9, width: '100%', gap: 12 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overviewTask: {
    minHeight: 98,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  overviewTaskPhone: { flexDirection: 'column', alignItems: 'stretch' },
  overviewTaskMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taskIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskGlyph: { fontSize: 22, fontWeight: '700' },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  taskPhoneButton: { minHeight: 40 },
  taskBadge: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyGlyph: { fontSize: 30, fontWeight: '700', marginBottom: 4 },
  shortcutList: { gap: 10 },
  shortcutRow: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shortcutIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutGlyph: { fontSize: 20, fontWeight: '700' },
  systemReadyCard: {
    minHeight: 78,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  systemReadyIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemReadyIconText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 86,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionTileCompact: { flexBasis: '100%', minHeight: 68 },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGlyph: { fontSize: 20, fontWeight: '700' },
  chevron: { fontSize: 25, lineHeight: 28 },
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
