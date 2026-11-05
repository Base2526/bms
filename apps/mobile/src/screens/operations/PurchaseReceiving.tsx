import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useMutation } from '@apollo/client';
import { Button } from '../../components/Button';
import {
  MobilePosReceivePurchaseDocument,
  type MobilePosPurchaseOrdersQuery,
} from '../../graphql/generated';
import { createIdempotencyKey } from '../../lib/operation';
import {
  clearPendingPurchaseReceipt,
  loadPendingPurchaseReceipt,
  purchaseReceiptScope,
  savePendingPurchaseReceipt,
  type PendingPurchaseReceipt,
} from '../../lib/pendingPurchaseReceipt';
import { useDevice } from '../../state/DeviceContext';
import type { PosSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';

type Order =
  MobilePosPurchaseOrdersQuery['bmsPosPurchaseOrders']['orders'][number];
type Draft = Record<string, { qty: string; lotNo: string; expiryDate: string }>;
const lineKey = (sku: string, size: string) => JSON.stringify([sku, size]);
const rejections = new Set([
  'PO_NOT_FOUND',
  'LOCATION_NOT_FOUND',
  'INVALID_INPUT',
  'INVALID_STATE',
  'LINE_NOT_FOUND',
  'OVER_RECEIVE',
  'EMPTY',
]);

export function PurchaseReceiving({
  session,
  orders,
  refresh,
  loading,
  error,
}: {
  session: PosSession;
  orders: Order[];
  refresh: () => Promise<unknown>;
  loading: boolean;
  error?: unknown;
}) {
  const { target } = useDevice();
  const { colors, spacing, typography, radius } = useTheme();
  const scope = target
    ? purchaseReceiptScope(target.serverUrl, session.deviceId)
    : '';
  const [receive] = useMutation(MobilePosReceivePurchaseDocument);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<PendingPurchaseReceipt | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [readBlocked, setReadBlocked] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    let active = true;
    mounted.current = true;
    setReady(false);
    setPending(null);
    setDrafts({});
    setNotice('');
    if (scope)
      loadPendingPurchaseReceipt(scope)
        .then(saved => {
          if (!active) return;
          setPending(saved);
          setReady(true);
          if (saved)
            setNotice(
              'มีรายการรับที่ยังไม่ยืนยันผล กรุณาตรวจรายการเดิมก่อนรับครั้งใหม่',
            );
        })
        .catch(() => {
          if (active)
            setNotice(
              'อ่านรายการรับที่เก็บไว้ไม่ได้ กรุณาเปิดหน้ารับสินค้าอีกครั้งหรือติดต่อผู้ดูแล',
            );
        });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [scope]);

  async function reload(committed = false) {
    try {
      await refresh();
      setReadBlocked(false);
      setDrafts({});
      setNotice(
        committed
          ? 'บันทึกรับสินค้าแล้ว และโหลดข้อมูลล่าสุดแล้ว'
          : 'โหลดใบสั่งซื้อค้างรับล่าสุดแล้ว',
      );
    } catch {
      setReadBlocked(true);
      setNotice(
        committed
          ? 'บันทึกรับสินค้าแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้ กรุณาโหลดใบสั่งซื้อใหม่ก่อนรับครั้งถัดไป'
          : 'โหลดใบสั่งซื้อไม่ได้ กรุณาลองใหม่',
      );
    }
  }

  async function submit(order?: Order) {
    if (
      !ready ||
      !scope ||
      inFlight.current ||
      (!pending && (loading || error || readBlocked))
    )
      return;
    if (
      pending &&
      (pending.cashierUserId !== session.credentials.cashierUserId ||
        pending.branchId !== session.branch.id)
    ) {
      setNotice(
        'รายการค้างเป็นของผู้รับหรือสาขาเดิม กรุณาเข้าใช้งานด้วยผู้รับและสาขาเดิมเพื่อตรวจผล',
      );
      return;
    }
    let request = pending;
    if (!request && order) {
      const items = order.items.flatMap(item => {
        const draft = drafts[order.id]?.[lineKey(item.sku, item.size)];
        const qty = Number(draft?.qty ?? item.qtyOrdered - item.qtyReceived);
        return qty === 0
          ? []
          : [
              {
                sku: item.sku,
                size: item.size,
                qty,
                lotNo: draft?.lotNo.trim() || null,
                expiryDate: draft?.expiryDate.trim() || null,
              },
            ];
      });
      if (
        !items.length ||
        items.some(
          i => !Number.isInteger(i.qty) || i.qty <= 0 || i.qty > 2147483647,
        )
      ) {
        setNotice('กรุณาระบุจำนวนรับเป็นจำนวนเต็มมากกว่าศูนย์');
        return;
      }
      request = {
        poId: order.id,
        branchId: session.branch.id,
        cashierUserId: session.credentials.cashierUserId,
        idempotencyKey: createIdempotencyKey('po-receive'),
        items,
      };
    }
    if (!request) return;
    inFlight.current = true;
    setBusy(true);
    const receipt = request;
    let saved = false;
    try {
      await savePendingPurchaseReceipt(scope, receipt);
      saved = true;
      setPending(receipt);
      if (!mounted.current || currentScope.current !== scope) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await receive({
          variables: {
            input: {
              poId: receipt.poId,
              items: receipt.items,
              idempotencyKey: receipt.idempotencyKey,
              ...session.credentials,
            },
          },
          context: { fetchOptions: { signal: controller.signal } },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (currentScope.current !== scope) return;
      const result = response.data?.bmsPosReceivePurchase;
      if (result?.status === 'RECEIVED' || result?.status === 'PARTIAL') {
        // This result may be a replay. Only the fresh read describes current PO progress.
        setNotice('บันทึกรับสินค้าแล้ว');
        try {
          await clearPendingPurchaseReceipt(scope, receipt.idempotencyKey);
        } catch {
          setNotice(
            'บันทึกรับสินค้าแล้ว แต่ยังล้างรายการค้างไม่ได้ กรุณาตรวจรายการเดิมอีกครั้ง',
          );
          return;
        }
        setPending(null);
        setReadBlocked(true);
        setDrafts({});
        await reload(true);
      } else if (result && rejections.has(result.status)) {
        await clearPendingPurchaseReceipt(scope, receipt.idempotencyKey);
        setPending(null);
        setReadBlocked(true);
        setNotice(
          `${
            result.message || 'รับสินค้าไม่สำเร็จ กรุณาตรวจรายการ'
          } · โหลดใบสั่งซื้อใหม่ก่อนแก้ไข`,
        );
      } else {
        setNotice(
          'ยังยืนยันผลรับสินค้าไม่ได้ กรุณาตรวจรายการเดิมอีกครั้ง ระบบจะไม่เพิ่มสต็อกซ้ำ',
        );
      }
    } catch {
      if (currentScope.current !== scope) return;
      if (saved || pending)
        setNotice(
          'ยังยืนยันผลรับสินค้าไม่ได้ ตรวจการเชื่อมต่อและสิทธิ์ผู้รับ แล้วกดตรวจรายการเดิมอีกครั้ง',
        );
      else {
        setReady(false);
        setNotice(
          'เก็บรายการป้องกันรับซ้ำไม่ได้ กรุณาเปิดหน้ารับสินค้าอีกครั้งก่อนลองใหม่',
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const disabled =
    busy || !ready || !!pending || loading || !!error || readBlocked;
  const inputStyle = {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={[typography.title, { color: colors.text }]}>
        รับสินค้า PO
      </Text>
      {!!notice && (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {notice}
        </Text>
      )}
      {!!error && (
        <Text style={{ color: colors.danger }}>
          โหลดใบสั่งซื้อไม่สำเร็จ กรุณาโหลดใหม่
        </Text>
      )}
      {pending ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text }}>
            รายการรอตรวจผล · {pending.poId.slice(0, 8)}
          </Text>
          {pending.items.map((i, index) => (
            <Text key={index} style={{ color: colors.text }}>{`${i.sku}/${
              i.size
            } · ${i.qty} หน่วย${i.lotNo ? ` · ล็อต ${i.lotNo}` : ''}${
              i.expiryDate ? ` · หมดอายุ ${i.expiryDate}` : ''
            }`}</Text>
          ))}
          <Button
            label="ตรวจรายการเดิมอีกครั้ง"
            loading={busy}
            disabled={!ready}
            onPress={() => submit()}
          />
        </View>
      ) : (
        <Button
          label="โหลดใบสั่งซื้อค้างรับใหม่"
          disabled={busy || !ready || loading}
          onPress={() => reload()}
        />
      )}
      {!pending && !loading && !error && orders.length === 0 && (
        <Text style={{ color: colors.text }}>ไม่มีใบสั่งซื้อค้างรับ</Text>
      )}
      {orders.map(order => (
        <View
          key={order.id}
          style={{
            gap: spacing.sm,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingTop: spacing.md,
          }}
        >
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            {order.supplier?.name || 'ไม่ระบุผู้ขาย'} ·{' '}
            {order.status === 'PARTIAL'
              ? 'รับบางส่วน'
              : order.status === 'OPEN'
              ? 'รอรับของ'
              : 'รับเพิ่มไม่ได้'}
          </Text>
          <Text
            style={{ color: colors.text }}
          >{`รับแล้ว ${order.qtyReceived} จาก ${order.qtyOrdered} หน่วย`}</Text>
          {order.items
            .filter(i => i.qtyOrdered > i.qtyReceived)
            .map(item => {
              const key = lineKey(item.sku, item.size),
                draft = drafts[order.id]?.[key] ?? {
                  qty: String(item.qtyOrdered - item.qtyReceived),
                  lotNo: '',
                  expiryDate: '',
                };
              const patch = (values: Partial<typeof draft>) =>
                setDrafts(old => ({
                  ...old,
                  [order.id]: {
                    ...old[order.id],
                    [key]: { ...draft, ...values },
                  },
                }));
              return (
                <View key={key} style={{ gap: spacing.sm }}>
                  <Text style={{ color: colors.text }}>{`${item.sku}/${
                    item.size
                  } · ค้างรับ ${item.qtyOrdered - item.qtyReceived}`}</Text>
                  <TextInput
                    accessibilityLabel={`จำนวนรับ ${item.sku} ${item.size}`}
                    value={draft.qty}
                    keyboardType="number-pad"
                    editable={!disabled}
                    onChangeText={qty => patch({ qty })}
                    style={inputStyle}
                  />
                  <TextInput
                    accessibilityLabel={`เลขล็อต ${item.sku} ${item.size}`}
                    placeholder="เลขล็อตตามฉลาก (สินค้าติดตามล็อตต้องกรอก)"
                    placeholderTextColor={colors.textMuted}
                    value={draft.lotNo}
                    editable={!disabled}
                    maxLength={100}
                    onChangeText={lotNo => patch({ lotNo })}
                    style={inputStyle}
                  />
                  <TextInput
                    accessibilityLabel={`วันหมดอายุ ${item.sku} ${item.size}`}
                    placeholder="วันหมดอายุ YYYY-MM-DD (ถ้าติดตามวันหมดอายุ)"
                    placeholderTextColor={colors.textMuted}
                    value={draft.expiryDate}
                    editable={!disabled}
                    maxLength={10}
                    onChangeText={expiryDate => patch({ expiryDate })}
                    style={inputStyle}
                  />
                </View>
              );
            })}
          <Button
            label="ยืนยันรับสินค้าตามจำนวนที่ระบุ"
            disabled={disabled || !['OPEN', 'PARTIAL'].includes(order.status)}
            loading={busy && pending?.poId === order.id}
            onPress={() => submit(order)}
          />
        </View>
      ))}
    </View>
  );
}
