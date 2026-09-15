import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { MenuGrid } from '../../components/MenuGrid';
import { cartLineVariantLabel } from '../../lib/cartLine';
import {
  ProductOptionsModal,
  type ConfiguredProduct,
} from '../../components/ProductOptionsModal';
import {
  MobileRestaurantAddCheckItemDocument,
  MobileRestaurantCancelCheckDocument,
  MobileRestaurantCheckDocument,
  MobileRestaurantFloorDocument,
  MobileRestaurantMergeChecksDocument,
  MobileRestaurantMoveCheckDocument,
  MobileRestaurantOpenCheckDocument,
  MobileRestaurantRemoveCheckItemDocument,
  MobileRestaurantSendCheckDocument,
  MobileRestaurantSetGuestCountDocument,
  MobileRestaurantSplitCheckDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { useCatalog } from '../../state/CatalogContext';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { PosMenuItem } from '../../types/pos';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'CheckDetail'>;
type CheckAction = 'GUESTS' | 'MOVE' | 'SPLIT' | 'MERGE' | 'CANCEL';
type MobilePane = 'MENU' | 'ORDER';

export default function CheckDetailScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const { catalog, resolveVariant } = useCatalog();
  const { session } = useSession();
  const [working, setWorking] = useState(false);
  const [configuring, setConfiguring] = useState<PosMenuItem | null>(null);
  const [action, setAction] = useState<CheckAction | null>(null);
  const [guestCount, setGuestCount] = useState('1');
  const [targetId, setTargetId] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [mobilePane, setMobilePane] = useState<MobilePane>('MENU');
  const floor = useQuery(MobileRestaurantFloorDocument);
  const table = route.params.tableId
    ? floor.data?.bmsPosRestaurantFloor.tables.find(
        item => item.id === route.params.tableId,
      )
    : undefined;
  const serviceMode =
    route.params.serviceMode ?? (table ? 'DINE_IN' : 'TAKEAWAY');
  const checkId = route.params.checkId ?? table?.check?.id ?? null;
  const check = useQuery(MobileRestaurantCheckDocument, {
    variables: { id: checkId ?? '' },
    skip: !checkId,
    notifyOnNetworkStatusChange: true,
  });
  const [openCheck] = useMutation(MobileRestaurantOpenCheckDocument);
  const [addItem] = useMutation(MobileRestaurantAddCheckItemDocument);
  const [removeItem] = useMutation(MobileRestaurantRemoveCheckItemDocument);
  const [sendCheck] = useMutation(MobileRestaurantSendCheckDocument);
  const [setGuests] = useMutation(MobileRestaurantSetGuestCountDocument);
  const [moveCheck] = useMutation(MobileRestaurantMoveCheckDocument);
  const [splitCheck] = useMutation(MobileRestaurantSplitCheckDocument);
  const [mergeChecks] = useMutation(MobileRestaurantMergeChecksDocument);
  const [cancelCheck] = useMutation(MobileRestaurantCancelCheckDocument);
  const bootstrap = useQuery(PosBootstrapDocument);
  const current = check.data?.bmsPosRestaurantCheck;
  const checkIsEditable = !checkId || current?.status === 'OPEN';
  const openTables = (floor.data?.bmsPosRestaurantFloor.tables ?? []).filter(
    option =>
      option.active &&
      !option.blocked &&
      option.status === 'AVAILABLE' &&
      option.id !== current?.tableId,
  );
  const mergeCandidates = (floor.data?.bmsPosRestaurantFloor.tables ?? [])
    .flatMap(option => option.checks)
    .filter(option => option.id !== current?.id && option.status === 'OPEN');
  const voidApprovers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    person =>
      person.id !== session?.cashier.id &&
      person.hasPin &&
      person.approvals.includes('pos.void'),
  );
  const splittableItems = (current?.items ?? []).filter(
    item => item.status !== 'CANCELLED',
  );
  const cancelNeedsApproval = Boolean(
    current?.hasCurrentOrder ||
      current?.items.some(item => item.status === 'SENT'),
  );

  const qtyBySku = useMemo(() => {
    const quantities: Record<string, number> = {};
    for (const line of current?.items ?? []) {
      if (line.status === 'CANCELLED') continue;
      quantities[line.sku] = (quantities[line.sku] ?? 0) + line.packQty;
    }
    return quantities;
  }, [current?.items]);

  const credentials = session?.credentials;
  const refresh = async (id?: string) => {
    await floor.refetch();
    if (id ?? checkId) {
      await check.refetch({ id: id ?? checkId ?? '' });
    }
  };

  const ensureCheck = async (): Promise<string> => {
    if (checkId) return checkId;
    if (!credentials) throw new Error('กรุณาเข้าใช้งานใหม่');
    if (!route.params.tableId) {
      throw new Error('บิลกลับบ้านต้องเปิดจากหน้าผังโต๊ะก่อน');
    }
    const response = await openCheck({
      variables: {
        input: {
          serviceMode: 'DINE_IN',
          tableId: route.params.tableId,
          cashierUserId: credentials.cashierUserId,
          pin: credentials.pin,
          guestCount: 1,
          note: null,
        },
      },
    });
    const opened = response.data?.bmsPosRestaurantOpenCheck.check;
    if (!opened) throw new Error('เปิดบิลโต๊ะไม่สำเร็จ');
    await refresh(opened.id);
    return opened.id;
  };

  const onAdd = async ({
    item,
    modifierCodes,
    kitchenNote,
  }: ConfiguredProduct) => {
    if (!credentials || working) return;
    setWorking(true);
    try {
      const id = await ensureCheck();
      const response = await addItem({
        variables: {
          checkId: id,
          input: {
            cashierUserId: credentials.cashierUserId,
            pin: credentials.pin,
            sku: item.sku,
            size: item.size || null,
            packCode: item.packCode || null,
            packQty: 1,
            modifierCodes,
            kitchenNote,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantAddCheckItem;
      if (!result?.check) {
        throw new Error(
          result?.reason ?? result?.status ?? 'เพิ่มรายการไม่สำเร็จ',
        );
      }
      await refresh(id);
    } catch (error) {
      Alert.alert(
        'เพิ่มรายการไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const onRemove = async (sku: string) => {
    if (!credentials || !current || working) return;
    const line = [...current.items]
      .reverse()
      .find(item => item.sku === sku && item.status === 'NEW');
    if (!line) {
      Alert.alert(
        'ลบไม่ได้',
        'รายการที่ส่งครัวแล้วต้องจัดการผ่านขั้นตอนยกเลิก',
      );
      return;
    }
    setWorking(true);
    try {
      const response = await removeItem({
        variables: {
          checkId: current.id,
          itemId: line.id,
          credentials,
        },
      });
      const result = response.data?.bmsPosRestaurantRemoveCheckItem;
      if (!result?.check) {
        throw new Error(
          result?.reason ?? result?.status ?? 'ลบรายการไม่สำเร็จ',
        );
      }
      await refresh(current.id);
    } catch (error) {
      Alert.alert(
        'ลบรายการไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const onSend = async () => {
    if (!credentials || !current || working) return;
    setWorking(true);
    try {
      const response = await sendCheck({
        variables: { checkId: current.id, credentials },
      });
      const result = response.data?.bmsPosRestaurantSendCheckToKitchen;
      if (result?.status !== 'SENT') {
        throw new Error(result?.reason ?? result?.status ?? 'ส่งครัวไม่สำเร็จ');
      }
      await refresh(current.id);
      Alert.alert('ส่งครัวแล้ว', `${result.kitchenTickets ?? 0} ตั๋ว`);
    } catch (error) {
      Alert.alert(
        'ส่งครัวไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const runCheckAction = async () => {
    if (!credentials || !current || !action || working) return;
    setWorking(true);
    try {
      let result:
        | {
            status?: string | null;
            reason?: string | null;
            check?: {
              id: string;
              tableId?: string | null;
              serviceMode: string;
            } | null;
            target?: {
              id: string;
              tableId?: string | null;
              serviceMode: string;
            } | null;
          }
        | null
        | undefined;
      if (action === 'GUESTS') {
        const response = await setGuests({
          variables: {
            checkId: current.id,
            input: {
              ...credentials,
              guestCount: Math.max(1, Math.floor(Number(guestCount) || 1)),
            },
          },
        });
        result = response.data?.bmsPosRestaurantSetCheckGuestCount;
        if (!result?.check) throw new Error('แก้จำนวนลูกค้าไม่สำเร็จ');
      } else if (action === 'MOVE') {
        const response = await moveCheck({
          variables: {
            checkId: current.id,
            input: { ...credentials, targetTableId: targetId },
          },
        });
        result = response.data?.bmsPosRestaurantMoveCheck;
        if (!result?.check) throw new Error('ย้ายโต๊ะไม่สำเร็จ');
      } else if (action === 'SPLIT') {
        const response = await splitCheck({
          variables: {
            checkId: current.id,
            input: {
              ...credentials,
              itemIds: selectedItemIds,
              guestCount: Math.max(1, Math.floor(Number(guestCount) || 1)),
            },
          },
        });
        result = response.data?.bmsPosRestaurantSplitCheck;
        if (result?.status !== 'SPLIT' || !result.target) {
          throw new Error(
            result?.reason ?? result?.status ?? 'แยกบิลไม่สำเร็จ',
          );
        }
      } else if (action === 'MERGE') {
        const response = await mergeChecks({
          variables: {
            checkId: current.id,
            input: { ...credentials, targetCheckId: targetId },
          },
        });
        result = response.data?.bmsPosRestaurantMergeChecks;
        if (result?.status !== 'MERGED' || !result.target) {
          throw new Error(
            result?.reason ?? result?.status ?? 'รวมบิลไม่สำเร็จ',
          );
        }
      } else {
        const response = await cancelCheck({
          variables: {
            checkId: current.id,
            input: {
              ...credentials,
              reason: reason.trim(),
              approverUserId: approverId || null,
              approverPin: approverPin || null,
            },
          },
        });
        result = response.data?.bmsPosRestaurantCancelCheck;
        if (result?.status !== 'CANCELLED') {
          throw new Error(
            result?.reason ?? result?.status ?? 'ยกเลิกบิลไม่สำเร็จ',
          );
        }
      }
      if (!result || result.reason) {
        throw new Error(
          result?.reason ?? result?.status ?? 'ทำรายการไม่สำเร็จ',
        );
      }
      setAction(null);
      await floor.refetch();
      if (action === 'CANCEL') {
        navigation.goBack();
      } else if (
        (action === 'MOVE' && result.check) ||
        ((action === 'SPLIT' || action === 'MERGE') && result.target)
      ) {
        const destination = action === 'MOVE' ? result.check! : result.target!;
        navigation.replace('CheckDetail', {
          tableId: destination.tableId ?? undefined,
          checkId: destination.id,
          serviceMode:
            destination.serviceMode === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN',
        });
      } else {
        await check.refetch({ id: current.id });
      }
    } catch (cause) {
      Alert.alert(
        'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking(false);
    }
  };

  const orderPanel = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.subtitle, { color: colors.text }]}>
        {current?.tableName ?? table?.code ?? 'กลับบ้าน'} · ฿
        {(current?.amountDue ?? 0).toFixed(2)}
      </Text>
      <FlatList
        data={current?.items ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ยังไม่มีรายการ
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text }]}>
                {item.productName} × {item.packQty}
              </Text>
              {/* ไซซ์/ตัวเลือก — server ส่ง size กับ modifierNames มาให้อยู่แล้วแต่ไม่เคยถูกเขียนลงจอ
                  บิลที่มี "ชาเย็น × 1" สองบรรทัดโดยไม่บอกว่าหวานน้อย/หวานปกติ อ่านแล้วตอบไม่ได้ว่า
                  ครัวทำถูกไหม และเป็นบรรทัดที่พนักงานต้องตัดสินใจว่าจะลบอันไหน */}
              {cartLineVariantLabel(item) ? (
                <Text style={[typography.caption, { color: colors.text }]}>
                  {cartLineVariantLabel(item)}
                </Text>
              ) : null}
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {item.kitchenStatus ?? item.status}
              </Text>
            </View>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ฿
              {(
                item.lineAmount ?? (item.packPrice ?? 0) * item.packQty
              ).toFixed(2)}
            </Text>
          </View>
        )}
      />
      <Button
        label={
          working
            ? 'กำลังทำรายการ…'
            : current?.reservationLost
            ? 'สร้างการจองสต็อกใหม่'
            : 'ส่งรายการใหม่เข้าครัว'
        }
        fullWidth
        disabled={
          working ||
          current?.status !== 'OPEN' ||
          (!current?.reservationLost &&
            !current?.items.some(item => item.status === 'NEW'))
        }
        onPress={onSend}
      />
      {current ? (
        <View style={styles.actions}>
          <Button
            label="จำนวนลูกค้า"
            variant="secondary"
            disabled={current.status !== 'OPEN'}
            onPress={() => {
              setGuestCount(String(current.guestCount));
              setAction('GUESTS');
            }}
          />
          {current.serviceMode === 'DINE_IN' && current.status === 'OPEN' ? (
            <>
              <Button
                label="ย้ายโต๊ะ"
                variant="secondary"
                onPress={() => {
                  setTargetId('');
                  setAction('MOVE');
                }}
              />
              <Button
                label="แยกบิล"
                variant="secondary"
                disabled={splittableItems.length < 2}
                onPress={() => {
                  setSelectedItemIds([]);
                  setGuestCount('1');
                  setAction('SPLIT');
                }}
              />
              <Button
                label="รวมบิล"
                variant="secondary"
                onPress={() => {
                  setTargetId('');
                  setAction('MERGE');
                }}
              />
            </>
          ) : null}
          <Button
            label="ยกเลิกบิล"
            variant="danger"
            disabled={!['OPEN', 'CLOSING'].includes(current.status)}
            onPress={() => {
              setReason('');
              setApproverId('');
              setApproverPin('');
              setAction('CANCEL');
            }}
          />
        </View>
      ) : null}
      <Button
        label="ไปชำระเงิน"
        variant="secondary"
        fullWidth
        disabled={
          !current ||
          !['OPEN', 'CLOSING'].includes(current.status) ||
          splittableItems.length === 0 ||
          current.items.some(item => item.status === 'NEW')
        }
        onPress={() => {
          if (!current) return;
          navigation
            .getParent()
            ?.getParent<any>()
            ?.navigate('SellTab', {
              screen: 'Checkout',
              params: {
                source: 'restaurant',
                tableId: route.params.tableId,
                checkId: current.id,
              },
            });
        }}
      />
    </Card>
  );

  return (
    <ScreenContainer padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <ScreenHeader
          title={
            serviceMode === 'TAKEAWAY'
              ? `บิลกลับบ้าน ${current ? `#${current.id.slice(0, 8)}` : ''}`
              : table
              ? `บิลโต๊ะ ${table.code}`
              : 'บิลโต๊ะ'
          }
          subtitle={
            current ? `${splittableItems.length} รายการ` : 'พร้อมเปิดบิลใหม่'
          }
          onBack={() => navigation.goBack()}
        />
      </View>
      {isTablet ? (
        checkIsEditable ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <MenuGrid
              qtyBySku={qtyBySku}
              onAdd={setConfiguring}
              onDecrement={sku => {
                onRemove(sku).catch(() => undefined);
              }}
              areaWidth={width - 360}
              artHeight={92}
              catalog={catalog}
            />
            <View style={{ width: 360, padding: spacing.lg }}>
              {orderPanel}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, padding: spacing.lg }}>{orderPanel}</View>
        )
      ) : (
        <View style={{ flex: 1 }}>
          {checkIsEditable ? (
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.sm,
              }}
            >
              <Button
                label="เมนู"
                variant={mobilePane === 'MENU' ? 'primary' : 'secondary'}
                onPress={() => setMobilePane('MENU')}
              />
              <Button
                label={`บิล (${splittableItems.length})`}
                variant={mobilePane === 'ORDER' ? 'primary' : 'secondary'}
                onPress={() => setMobilePane('ORDER')}
              />
            </View>
          ) : null}
          {checkIsEditable && mobilePane === 'MENU' ? (
            <MenuGrid
              qtyBySku={qtyBySku}
              onAdd={setConfiguring}
              onDecrement={sku => {
                onRemove(sku).catch(() => undefined);
              }}
              areaWidth={width}
              artHeight={84}
              catalog={catalog}
            />
          ) : (
            <View style={{ flex: 1, padding: spacing.lg }}>{orderPanel}</View>
          )}
        </View>
      )}
      <ProductOptionsModal
        item={configuring}
        restaurant
        resolveVariant={resolveVariant}
        onClose={() => setConfiguring(null)}
        onConfirm={configured => {
          setConfiguring(null);
          onAdd(configured).catch(() => undefined);
        }}
      />
      <Modal
        transparent
        visible={action !== null}
        animationType="fade"
        onRequestClose={() => setAction(null)}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAction(null)}
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                padding: spacing.lg,
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={{ gap: spacing.md }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[typography.title, { color: colors.text }]}>
                {action === 'GUESTS'
                  ? 'จำนวนลูกค้า'
                  : action === 'MOVE'
                  ? 'ย้ายโต๊ะ'
                  : action === 'SPLIT'
                  ? 'แยกบิล'
                  : action === 'MERGE'
                  ? 'รวมบิล'
                  : 'ยกเลิกบิล'}
              </Text>
              {action === 'GUESTS' || action === 'SPLIT' ? (
                <TextInput
                  value={guestCount}
                  onChangeText={setGuestCount}
                  keyboardType="number-pad"
                  placeholder="จำนวนลูกค้า"
                  placeholderTextColor={colors.textSoft}
                  style={[
                    styles.input,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                />
              ) : null}
              {action === 'MOVE'
                ? openTables.map(option => (
                    <Button
                      key={option.id}
                      label={`${option.code} · ${option.name}`}
                      variant={targetId === option.id ? 'primary' : 'secondary'}
                      onPress={() => setTargetId(option.id)}
                    />
                  ))
                : null}
              {action === 'MERGE'
                ? mergeCandidates.map(option => (
                    <Button
                      key={option.id}
                      label={`บิล ${option.id.slice(
                        0,
                        8,
                      )} · ฿${option.amountDue.toFixed(2)}`}
                      variant={targetId === option.id ? 'primary' : 'secondary'}
                      onPress={() => setTargetId(option.id)}
                    />
                  ))
                : null}
              {action === 'SPLIT'
                ? splittableItems.map(item => (
                    <Button
                      key={item.id}
                      label={`${item.productName} × ${item.packQty}`}
                      variant={
                        selectedItemIds.includes(item.id)
                          ? 'primary'
                          : 'secondary'
                      }
                      onPress={() =>
                        setSelectedItemIds(previous =>
                          previous.includes(item.id)
                            ? previous.filter(id => id !== item.id)
                            : [...previous, item.id],
                        )
                      }
                    />
                  ))
                : null}
              {action === 'CANCEL' ? (
                <>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    placeholder="เหตุผลยกเลิก"
                    placeholderTextColor={colors.textSoft}
                    style={[
                      styles.input,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                  />
                  {cancelNeedsApproval ? (
                    <>
                      <Text
                        style={[
                          typography.captionStrong,
                          { color: colors.warning },
                        ]}
                      >
                        บิลที่ส่งครัวแล้วต้องให้ผู้อนุมัติคนที่สองกด PIN
                      </Text>
                      {voidApprovers.map(person => (
                        <Button
                          key={person.id}
                          label={person.name ?? person.id}
                          variant={
                            approverId === person.id ? 'primary' : 'secondary'
                          }
                          onPress={() => setApproverId(person.id)}
                        />
                      ))}
                      {approverId ? (
                        <TextInput
                          value={approverPin}
                          onChangeText={setApproverPin}
                          secureTextEntry
                          keyboardType="number-pad"
                          placeholder="PIN ผู้อนุมัติ"
                          placeholderTextColor={colors.textSoft}
                          style={[
                            styles.input,
                            { borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              <Button
                label={working ? 'กำลังบันทึก…' : 'ยืนยัน'}
                fullWidth
                loading={working}
                disabled={
                  working ||
                  ((action === 'MOVE' || action === 'MERGE') && !targetId) ||
                  (action === 'SPLIT' &&
                    (selectedItemIds.length === 0 ||
                      selectedItemIds.length >= splittableItems.length)) ||
                  (action === 'CANCEL' &&
                    (!reason.trim() ||
                      (cancelNeedsApproval && (!approverId || !approverPin))))
                }
                onPress={() => runCheckAction().catch(() => undefined)}
              />
              <Button
                label="ปิด"
                variant="secondary"
                fullWidth
                onPress={() => setAction(null)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 560,
    maxHeight: '88%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    textAlignVertical: 'top',
  },
});
