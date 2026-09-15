import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  MobilePosApplyStockCountDocument,
  MobilePosCancelStockCountDocument,
  MobilePosCancelStockTransferDocument,
  MobilePosCreateStockCountDocument,
  MobilePosCreateStockTransferDocument,
  MobilePosReceiveStockTransferDocument,
  MobilePosRecordStockCountItemDocument,
  MobilePosSendStockTransferDocument,
  MobilePosStockCountsDocument,
  MobilePosStockTransfersDocument,
  type MobilePosStockTransfersQuery,
} from '../../graphql/generated';
import {
  createIdempotencyKey,
  isDecidedRejection,
  isStaleOperationConflict,
} from '../../lib/operation';
import type { OperationsStackParamList } from '../../navigation/types';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';

type ViewMode = 'TRANSFER' | 'COUNT';
type DraftLine = { sku: string; size: string; qty: string };
type Transfer =
  MobilePosStockTransfersQuery['bmsPosStockTransfers']['transfers'][number];
type ReceiptDraft = {
  itemId: number;
  sku: string;
  size: string;
  sent: number;
  qty: string;
  damagedQty: string;
  reason: string;
  note: string;
};

const emptyLine = (): DraftLine => ({ sku: '', size: '', qty: '1' });
class BusinessResultError extends Error {}
/**
 * บนแท็บเล็ตจอนี้เป็นปลายทางของรางด้านซ้าย (ไม่ได้ถูก push มา) — ปุ่มย้อนกลับจึงไม่มีที่ให้กลับ
 * ปุ่มที่กดแล้วไม่เกิดอะไรคือปุ่มที่สอนให้คนเลิกเชื่อปุ่มอื่นบนจอเดียวกัน
 */
type Props = NativeStackScreenProps<OperationsStackParamList, 'Inventory'> & {
  asTabRoot?: boolean;
};

const discrepancyReasons = [
  { code: 'LOST_IN_TRANSIT', label: 'สูญหายระหว่างทาง' },
  { code: 'SOURCE_SHORT_SHIP', label: 'ต้นทางส่งขาด' },
  { code: 'COUNT_ERROR', label: 'นับผิด' },
  { code: 'DAMAGED', label: 'เสียหาย' },
  { code: 'OTHER', label: 'อื่นๆ' },
] as const;

function hasDiscrepancy(row: ReceiptDraft): boolean {
  const received = Number(row.qty);
  const damaged = Number(row.damagedQty);
  return (
    Number.isFinite(received) &&
    Number.isFinite(damaged) &&
    (damaged > 0 || received + damaged < row.sent)
  );
}

function resultError(
  result:
    | {
        status?: string | null;
        reason?: string | null;
        current?: string | null;
        sku?: string | null;
        size?: string | null;
        available?: number | null;
        requested?: number | null;
        reserved?: number | null;
        wouldBe?: number | null;
      }
    | null
    | undefined,
): string | null {
  if (!result) return 'ไม่ได้รับผลยืนยันจากเซิร์ฟเวอร์';
  if (result.reason) return result.reason;
  if (['OK', 'CREATED', 'APPLIED'].includes(result.status ?? '')) return null;
  if (result.status === 'INSUFFICIENT') {
    return `${result.sku}/${result.size} มีพร้อมโอน ${
      result.available ?? 0
    } แต่ขอ ${result.requested ?? 0}`;
  }
  if (result.status === 'WOULD_BREAK_RESERVED') {
    return `${result.sku}/${result.size} จะเหลือ ${
      result.wouldBe ?? 0
    } ต่ำกว่ายอดจอง ${result.reserved ?? 0}`;
  }
  if (result.status === 'WRONG_STATE') {
    return `สถานะปัจจุบัน ${result.current ?? '-'}`;
  }
  return result.status ?? 'ทำรายการไม่สำเร็จ';
}

export default function InventoryScreen({ navigation, asTabRoot }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const credentials = session?.credentials;
  const [mode, setMode] = useState<ViewMode>('TRANSFER');
  const [working, setWorking] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [line, setLine] = useState<DraftLine>(emptyLine);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [receiptRows, setReceiptRows] = useState<ReceiptDraft[]>([]);
  const [receivingNote, setReceivingNote] = useState('');
  const [countNote, setCountNote] = useState('');
  const [selectedCountId, setSelectedCountId] = useState('');
  const [countSku, setCountSku] = useState('');
  const [countSize, setCountSize] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [countItemNote, setCountItemNote] = useState('');
  const operationKeys = useRef<Record<string, string>>({});

  const inputCredentials = credentials ?? { cashierUserId: '', pin: '' };
  const transfers = useQuery(MobilePosStockTransfersDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials || mode !== 'TRANSFER',
  });
  const counts = useQuery(MobilePosStockCountsDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials || mode !== 'COUNT',
  });
  const [createTransfer] = useMutation(MobilePosCreateStockTransferDocument);
  const [sendTransfer] = useMutation(MobilePosSendStockTransferDocument);
  const [receiveTransfer] = useMutation(MobilePosReceiveStockTransferDocument);
  const [cancelTransfer] = useMutation(MobilePosCancelStockTransferDocument);
  const [createCount] = useMutation(MobilePosCreateStockCountDocument);
  const [recordCountItem] = useMutation(MobilePosRecordStockCountItemDocument);
  const [applyCount] = useMutation(MobilePosApplyStockCountDocument);
  const [cancelCount] = useMutation(MobilePosCancelStockCountDocument);
  const refetchTransfers = transfers.refetch;
  const refetchCounts = counts.refetch;

  useFocusEffect(
    useCallback(() => {
      if (!credentials) return;
      const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
      refetch().catch(() => undefined);
    }, [credentials, mode, refetchCounts, refetchTransfers]),
  );

  const transferData = transfers.data?.bmsPosStockTransfers;
  const countData = counts.data?.bmsPosStockCounts;
  const selectedCount = countData?.counts.find(
    item => item.id === selectedCountId,
  );
  const pendingTransfers = useMemo(
    () =>
      (transferData?.transfers ?? []).filter(item =>
        ['DRAFT', 'IN_TRANSIT'].includes(item.status),
      ),
    [transferData?.transfers],
  );

  const run = async (key: string, action: () => Promise<string | null>) => {
    if (!credentials || working) return false;
    setWorking(key);
    try {
      const error = await action();
      if (error) throw new BusinessResultError(error);
      delete operationKeys.current[key];
      const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
      await refetch().catch(() => undefined);
      return true;
    } catch (cause) {
      // คีย์ถูกเก็บไว้เฉพาะตอน "ไม่รู้ผล" เท่านั้น เพื่อให้กดซ้ำแล้ว replay คำตอบเดิม
      // · ผลที่รู้แล้ว (ธุรกิจปฏิเสธ) และ CONFLICT (คีย์นี้ผูกกับคำขอเก่าไปแล้ว) ต้องทิ้งคีย์
      //   ไม่งั้นคนหน้าเครื่องแก้ข้อมูลแล้วกดใหม่จะชนคีย์เดิมและล้มแบบเดิมไปตลอด
      const stale = isStaleOperationConflict(cause);
      if (cause instanceof BusinessResultError || isDecidedRejection(cause)) {
        delete operationKeys.current[key];
      }
      if (stale) {
        const refetch = mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
        await refetch().catch(() => undefined);
      }
      Alert.alert(
        stale ? 'ข้อมูลเปลี่ยนไปแล้ว' : 'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
      return false;
    } finally {
      setWorking('');
    }
  };
  const retryKey = (key: string) =>
    (operationKeys.current[key] ??= createIdempotencyKey(`inventory-${key}`));

  const addDraftLine = () => {
    const qty = Number(line.qty);
    if (
      !line.sku.trim() ||
      !line.size.trim() ||
      !Number.isInteger(qty) ||
      qty <= 0
    ) {
      Alert.alert('รายการไม่ครบ', 'ระบุ SKU, ขนาด และจำนวนเต็มที่มากกว่า 0');
      return;
    }
    setDraftLines(previous => [
      ...previous,
      {
        sku: line.sku.trim(),
        size: line.size.trim().toUpperCase(),
        qty: String(qty),
      },
    ]);
    setLine(emptyLine());
  };

  const beginReceive = (transfer: Transfer) => {
    setReceiving(transfer);
    setReceivingNote('');
    setReceiptRows(
      transfer.items.map(item => ({
        itemId: item.id,
        sku: item.sku,
        size: item.size,
        sent: item.qty,
        qty: String(item.qty),
        damagedQty: '0',
        reason: '',
        note: '',
      })),
    );
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
    },
  ];

  return (
    <ScreenContainer>
      <ScreenHeader
        title="สต็อกสาขา"
        subtitle={`${session?.branch.name ?? '-'} · โอนและนับจากสาขาของเครื่อง`}
        onBack={asTabRoot ? undefined : () => navigation.goBack()}
      />
      <View style={[styles.segment, { gap: spacing.sm }]}>
        <Button
          label="โอนสินค้า"
          variant={mode === 'TRANSFER' ? 'primary' : 'secondary'}
          onPress={() => setMode('TRANSFER')}
          style={styles.segmentButton}
        />
        <Button
          label="นับสต็อก"
          variant={mode === 'COUNT' ? 'primary' : 'secondary'}
          onPress={() => setMode('COUNT')}
          style={styles.segmentButton}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        {(mode === 'TRANSFER' ? transfers.error : counts.error) ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              โหลดข้อมูลงานสต็อกไม่สำเร็จ
            </Text>
            <Button
              label="ลองใหม่"
              variant="secondary"
              onPress={() => {
                const refetch =
                  mode === 'TRANSFER' ? refetchTransfers : refetchCounts;
                refetch().catch(() => undefined);
              }}
            />
          </Card>
        ) : null}
        {mode === 'TRANSFER' ? (
          <>
            <Card style={{ gap: spacing.md }}>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                สร้างใบโอน
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ต้นทางถูกกำหนดจากสาขาของเครื่อง เลือกเฉพาะปลายทาง
              </Text>
              <View style={styles.wrap}>
                {(transferData?.destinations ?? []).map(location => (
                  <Button
                    key={location.id}
                    label={location.name}
                    variant={
                      destinationId === location.id ? 'primary' : 'secondary'
                    }
                    onPress={() => setDestinationId(location.id)}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <TextInput
                  value={line.sku}
                  onChangeText={sku =>
                    setLine(previous => ({ ...previous, sku }))
                  }
                  placeholder="SKU"
                  placeholderTextColor={colors.textSoft}
                  autoCapitalize="characters"
                  style={[inputStyle, styles.flex]}
                />
                <TextInput
                  value={line.size}
                  onChangeText={size =>
                    setLine(previous => ({ ...previous, size }))
                  }
                  placeholder="ขนาด"
                  placeholderTextColor={colors.textSoft}
                  autoCapitalize="characters"
                  style={[inputStyle, styles.smallInput]}
                />
                <TextInput
                  value={line.qty}
                  onChangeText={qty =>
                    setLine(previous => ({ ...previous, qty }))
                  }
                  placeholder="จำนวน"
                  placeholderTextColor={colors.textSoft}
                  keyboardType="number-pad"
                  style={[inputStyle, styles.smallInput]}
                />
              </View>
              <Button
                label="เพิ่มรายการ"
                variant="secondary"
                onPress={addDraftLine}
              />
              {draftLines.map((item, index) => (
                <View
                  key={`${item.sku}-${item.size}-${index}`}
                  style={styles.between}
                >
                  <Text
                    style={[typography.body, { color: colors.text, flex: 1 }]}
                  >
                    {item.sku} / {item.size} × {item.qty}
                  </Text>
                  <Button
                    label="ลบ"
                    variant="ghost"
                    onPress={() =>
                      setDraftLines(rows =>
                        rows.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  />
                </View>
              ))}
              <TextInput
                value={transferNote}
                onChangeText={setTransferNote}
                placeholder="หมายเหตุใบโอน"
                placeholderTextColor={colors.textSoft}
                style={inputStyle}
              />
              <Button
                label="บันทึกใบโอน"
                fullWidth
                loading={working === 'create-transfer'}
                disabled={!destinationId || draftLines.length === 0}
                onPress={() =>
                  run('create-transfer', async () => {
                    const response = await createTransfer({
                      variables: {
                        input: {
                          ...inputCredentials,
                          idempotencyKey: retryKey('create-transfer'),
                          destinationId,
                          note: transferNote.trim() || null,
                          items: draftLines.map(item => ({
                            sku: item.sku,
                            size: item.size,
                            qty: Number(item.qty),
                          })),
                        },
                      },
                    });
                    const result = response.data?.bmsPosCreateStockTransfer;
                    const error = resultError(result);
                    if (!error) {
                      setDraftLines([]);
                      setDestinationId('');
                      setTransferNote('');
                    }
                    return error;
                  })
                }
              />
            </Card>

            {receiving ? (
              <Card style={{ gap: spacing.md }}>
                <View style={styles.between}>
                  <Text style={[typography.subtitle, { color: colors.text }]}>
                    รับ {receiving.transferNo}
                  </Text>
                  <Button
                    label="ปิด"
                    variant="ghost"
                    onPress={() => setReceiving(null)}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  จำนวนรับดี + เสียหาย ต้องไม่เกินจำนวนที่ส่ง
                  หากขาดหรือเสียหายต้องระบุเหตุผลและหมายเหตุ
                </Text>
                {receiptRows.map((row, index) => (
                  <View
                    key={row.itemId}
                    style={[styles.receiptLine, { borderColor: colors.border }]}
                  >
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      {row.sku} / {row.size} · ส่ง {row.sent}
                    </Text>
                    <View style={styles.row}>
                      <TextInput
                        value={row.qty}
                        onChangeText={qty =>
                          setReceiptRows(items =>
                            items.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, qty } : item,
                            ),
                          )
                        }
                        placeholder="รับดี"
                        placeholderTextColor={colors.textSoft}
                        keyboardType="number-pad"
                        style={[inputStyle, styles.flex]}
                      />
                      <TextInput
                        value={row.damagedQty}
                        onChangeText={damagedQty =>
                          setReceiptRows(items =>
                            items.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, damagedQty }
                                : item,
                            ),
                          )
                        }
                        placeholder="เสียหาย"
                        placeholderTextColor={colors.textSoft}
                        keyboardType="number-pad"
                        style={[inputStyle, styles.flex]}
                      />
                    </View>
                    {hasDiscrepancy(row) ? (
                      <>
                        <View style={styles.wrap}>
                          {discrepancyReasons.map(reason => (
                            <Button
                              key={reason.code}
                              label={reason.label}
                              variant={
                                row.reason === reason.code
                                  ? 'primary'
                                  : 'secondary'
                              }
                              onPress={() =>
                                setReceiptRows(items =>
                                  items.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, reason: reason.code }
                                      : item,
                                  ),
                                )
                              }
                            />
                          ))}
                        </View>
                        <TextInput
                          value={row.note}
                          onChangeText={note =>
                            setReceiptRows(items =>
                              items.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, note } : item,
                              ),
                            )
                          }
                          placeholder="อธิบายส่วนต่าง (จำเป็น)"
                          placeholderTextColor={colors.textSoft}
                          style={inputStyle}
                        />
                      </>
                    ) : (
                      <Text
                        style={[typography.caption, { color: colors.success }]}
                      >
                        รับครบตามจำนวนส่ง
                      </Text>
                    )}
                  </View>
                ))}
                <TextInput
                  value={receivingNote}
                  onChangeText={setReceivingNote}
                  placeholder="หมายเหตุการรับ"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                <Button
                  label="ยืนยันรับสินค้า"
                  fullWidth
                  loading={working === `receive-${receiving.id}`}
                  onPress={() =>
                    run(`receive-${receiving.id}`, async () => {
                      const response = await receiveTransfer({
                        variables: {
                          input: {
                            ...inputCredentials,
                            idempotencyKey: retryKey(`receive-${receiving.id}`),
                            transferId: receiving.id,
                            receivingNote: receivingNote.trim() || null,
                            received: receiptRows.map(item => ({
                              itemId: item.itemId,
                              qty: Number(item.qty),
                              damagedQty: Number(item.damagedQty),
                              reason: item.reason.trim() || null,
                              note: item.note.trim() || null,
                            })),
                          },
                        },
                      });
                      const error = resultError(
                        response.data?.bmsPosReceiveStockTransfer,
                      );
                      if (!error) setReceiving(null);
                      return error;
                    })
                  }
                />
              </Card>
            ) : null}

            {pendingTransfers.map(transfer => {
              const isSource =
                transfer.fromLocationId === transferData?.deviceLocationId;
              return (
                <Card key={transfer.id} style={{ gap: spacing.sm }}>
                  <View style={styles.between}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      {transfer.transferNo}
                    </Text>
                    <Text
                      style={[
                        typography.captionStrong,
                        {
                          color:
                            transfer.status === 'IN_TRANSIT'
                              ? colors.warning
                              : colors.primary,
                        },
                      ]}
                    >
                      {transfer.status}
                    </Text>
                  </View>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {transfer.fromLocationName ?? '-'} →{' '}
                    {transfer.toLocationName ?? '-'}
                  </Text>
                  {transfer.items.map(item => (
                    <Text
                      key={item.id}
                      style={[typography.body, { color: colors.text }]}
                    >
                      {item.productName ?? item.sku} · {item.size} × {item.qty}
                    </Text>
                  ))}
                  <View style={styles.wrap}>
                    {transfer.status === 'DRAFT' && isSource ? (
                      <Button
                        label="ส่งสินค้า"
                        loading={working === `send-${transfer.id}`}
                        onPress={() =>
                          Alert.alert(
                            'ยืนยันส่งสินค้า',
                            'สต็อกจะถูกตัดจากสาขาต้นทางทันที',
                            [
                              { text: 'กลับ' },
                              {
                                text: 'ยืนยัน',
                                onPress: () => {
                                  run(`send-${transfer.id}`, async () => {
                                    const response = await sendTransfer({
                                      variables: {
                                        input: {
                                          ...inputCredentials,
                                          idempotencyKey: retryKey(
                                            `send-${transfer.id}`,
                                          ),
                                          transferId: transfer.id,
                                        },
                                      },
                                    });
                                    return resultError(
                                      response.data?.bmsPosSendStockTransfer,
                                    );
                                  });
                                },
                              },
                            ],
                          )
                        }
                      />
                    ) : null}
                    {transfer.status === 'DRAFT' && isSource ? (
                      <Button
                        label="ยกเลิก"
                        variant="danger"
                        onPress={() =>
                          run(`cancel-${transfer.id}`, async () => {
                            const response = await cancelTransfer({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  idempotencyKey: retryKey(
                                    `cancel-${transfer.id}`,
                                  ),
                                  transferId: transfer.id,
                                },
                              },
                            });
                            return resultError(
                              response.data?.bmsPosCancelStockTransfer,
                            );
                          })
                        }
                      />
                    ) : null}
                    {transfer.status === 'IN_TRANSIT' && !isSource ? (
                      <Button
                        label="รับสินค้า"
                        onPress={() => beginReceive(transfer)}
                      />
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </>
        ) : (
          <>
            <Card style={{ gap: spacing.md }}>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                เริ่มใบนับใหม่
              </Text>
              <TextInput
                value={countNote}
                onChangeText={setCountNote}
                placeholder="ขอบเขตหรือหมายเหตุการนับ"
                placeholderTextColor={colors.textSoft}
                style={inputStyle}
              />
              <Button
                label="สร้างใบนับ"
                loading={working === 'create-count'}
                onPress={() =>
                  run('create-count', async () => {
                    const response = await createCount({
                      variables: {
                        input: {
                          ...inputCredentials,
                          idempotencyKey: retryKey('create-count'),
                          note: countNote.trim() || null,
                        },
                      },
                    });
                    const result = response.data?.bmsPosCreateStockCount;
                    const error = resultError(result);
                    if (!error) {
                      setCountNote('');
                      setSelectedCountId(result?.countId ?? '');
                    }
                    return error;
                  })
                }
              />
            </Card>

            {(countData?.counts ?? [])
              .filter(count => count.status === 'DRAFT')
              .map(count => (
                <Card key={count.id} style={{ gap: spacing.sm }}>
                  <View style={styles.between}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      {count.countNo}
                    </Text>
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.primary },
                      ]}
                    >
                      {count.items.length} รายการ · ต่าง {count.varianceUnits}
                    </Text>
                  </View>
                  <Button
                    label={
                      selectedCountId === count.id
                        ? 'กำลังกรอกใบนี้'
                        : 'เปิดใบนับ'
                    }
                    variant={
                      selectedCountId === count.id ? 'primary' : 'secondary'
                    }
                    onPress={() => setSelectedCountId(count.id)}
                  />
                </Card>
              ))}

            {selectedCount ? (
              <Card style={{ gap: spacing.md }}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  กรอก {selectedCount.countNo}
                </Text>
                <View style={styles.row}>
                  <TextInput
                    value={countSku}
                    onChangeText={setCountSku}
                    placeholder="SKU"
                    placeholderTextColor={colors.textSoft}
                    autoCapitalize="characters"
                    style={[inputStyle, styles.flex]}
                  />
                  <TextInput
                    value={countSize}
                    onChangeText={setCountSize}
                    placeholder="ขนาด"
                    placeholderTextColor={colors.textSoft}
                    autoCapitalize="characters"
                    style={[inputStyle, styles.smallInput]}
                  />
                  <TextInput
                    value={countedQty}
                    onChangeText={setCountedQty}
                    placeholder="นับได้"
                    placeholderTextColor={colors.textSoft}
                    keyboardType="number-pad"
                    style={[inputStyle, styles.smallInput]}
                  />
                </View>
                <TextInput
                  value={countItemNote}
                  onChangeText={setCountItemNote}
                  placeholder="หมายเหตุรายการ"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                <Button
                  label="บันทึกรายการ"
                  loading={working === `count-item-${selectedCount.id}`}
                  disabled={
                    !countSku.trim() || !countSize.trim() || countedQty === ''
                  }
                  onPress={() =>
                    run(`count-item-${selectedCount.id}`, async () => {
                      const response = await recordCountItem({
                        variables: {
                          input: {
                            ...inputCredentials,
                            idempotencyKey: retryKey(
                              `count-item-${selectedCount.id}`,
                            ),
                            countId: selectedCount.id,
                            sku: countSku.trim(),
                            size: countSize.trim(),
                            countedQty: Number(countedQty),
                            note: countItemNote.trim() || null,
                          },
                        },
                      });
                      const error = resultError(
                        response.data?.bmsPosRecordStockCountItem,
                      );
                      if (!error) {
                        setCountSku('');
                        setCountSize('');
                        setCountedQty('');
                        setCountItemNote('');
                      }
                      return error;
                    })
                  }
                />
                {selectedCount.items.map(item => (
                  <View key={item.id} style={styles.between}>
                    <Text
                      style={[typography.body, { color: colors.text, flex: 1 }]}
                    >
                      {item.productName ?? item.sku} / {item.size}
                    </Text>
                    <Text
                      style={[
                        typography.captionStrong,
                        {
                          color:
                            item.variance === 0
                              ? colors.success
                              : colors.warning,
                        },
                      ]}
                    >
                      ระบบ {item.snapshotQty} · นับ {item.countedQty} · ต่าง{' '}
                      {item.variance}
                    </Text>
                  </View>
                ))}
                <View style={styles.wrap}>
                  <Button
                    label="ยืนยันปรับสต็อก"
                    loading={working === `apply-count-${selectedCount.id}`}
                    disabled={selectedCount.items.length === 0}
                    onPress={() =>
                      Alert.alert(
                        'ยืนยันผลนับ',
                        'ระบบจะปรับสต็อกด้วยผลต่างจาก snapshot แรก',
                        [
                          { text: 'กลับ' },
                          {
                            text: 'ยืนยัน',
                            onPress: () => {
                              run(
                                `apply-count-${selectedCount.id}`,
                                async () => {
                                  const response = await applyCount({
                                    variables: {
                                      input: {
                                        ...inputCredentials,
                                        idempotencyKey: retryKey(
                                          `apply-count-${selectedCount.id}`,
                                        ),
                                        countId: selectedCount.id,
                                      },
                                    },
                                  });
                                  const error = resultError(
                                    response.data?.bmsPosApplyStockCount,
                                  );
                                  if (!error) setSelectedCountId('');
                                  return error;
                                },
                              );
                            },
                          },
                        ],
                      )
                    }
                  />
                  <Button
                    label="ยกเลิกใบนับ"
                    variant="danger"
                    onPress={() =>
                      run(`cancel-count-${selectedCount.id}`, async () => {
                        const response = await cancelCount({
                          variables: {
                            input: {
                              ...inputCredentials,
                              idempotencyKey: retryKey(
                                `cancel-count-${selectedCount.id}`,
                              ),
                              countId: selectedCount.id,
                            },
                          },
                        });
                        const error = resultError(
                          response.data?.bmsPosCancelStockCount,
                        );
                        if (!error) setSelectedCountId('');
                        return error;
                      })
                    }
                  />
                </View>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginBottom: 12 },
  segmentButton: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  smallInput: { width: 88 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  receiptLine: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
});
