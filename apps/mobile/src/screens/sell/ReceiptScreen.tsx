import React, { useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReceiptPaper } from '../../components/ReceiptPaper';
import { ReceiptDelivery } from '../../components/ReceiptDelivery';
import { Button } from '../../components/Button';
import { MobilePosReceiptPreviewDocument } from '../../graphql/generated';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import type { AppStackParamList } from '../../navigation/types';
import { usePrinter } from '../../state/PrinterContext';
import { captureReceipt } from '../../lib/captureReceipt';

type Props = NativeStackScreenProps<AppStackParamList, 'Receipt'>;

export default function ReceiptScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const deliveryScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const paperRef = useRef<React.ComponentRef<typeof View>>(null);
  const [paperLayout, setPaperLayout] = useState<LayoutRectangle | null>(null);
  const [printing, setPrinting] = useState(false);
  const printLock = useRef(false);
  const printer = usePrinter();
  const preview = route.params.mode === 'preview';
  const { data, loading, error, refetch } = useQuery(
    MobilePosReceiptPreviewDocument,
    {
      variables: { orderId: route.params.saleId },
      fetchPolicy: 'network-only',
      notifyOnNetworkStatusChange: true,
    },
  );
  // Search may return other matches. Never substitute another bill for this route's ID.
  const receipt = data?.bmsPosRecentSales.sales.find(
    sale => sale.orderId === route.params.saleId,
  );
  const leaveReceipt = () => {
    if (
      (preview || route.params.source === 'board_game') &&
      navigation.canGoBack()
    ) {
      navigation.goBack();
      return;
    }
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'Tabs',
          params: {
            screen:
              route.params.source === 'restaurant' ? 'FloorTab' : 'SellTab',
          },
        },
      ],
    });
  };
  const leaveLabel = preview
    ? 'ปิดตัวอย่าง'
    : route.params.source === 'board_game'
    ? 'กลับรายละเอียดโต๊ะ'
    : route.params.source === 'restaurant'
    ? 'กลับผังโต๊ะ'
    : 'ขายรายการใหม่';
  const retry = () => {
    refetch().catch(() => undefined);
  };
  const unavailable = !receipt || Boolean(error);
  const printReceipt = async () => {
    if (
      printLock.current ||
      unavailable ||
      !receipt ||
      printer.state.status !== 'ready'
    )
      return;
    printLock.current = true;
    setPrinting(true);
    try {
      await printer.print(config =>
        captureReceipt(paperRef, paperLayout, config),
      );
      Alert.alert('ส่งงานพิมพ์แล้ว', 'กรุณาตรวจใบเสร็จที่เครื่องพิมพ์');
    } catch (failure) {
      Alert.alert(
        'พิมพ์ไม่สำเร็จ',
        failure instanceof Error ? failure.message : 'กรุณาตรวจเครื่องพิมพ์',
      );
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  };

  const paper =
    !unavailable && receipt ? (
      <View
        testID="receipt-print-surface"
        ref={paperRef}
        collapsable={false}
        onLayout={event => setPaperLayout(event.nativeEvent.layout)}
        style={styles.paperCapture}
      >
        <ReceiptPaper receipt={receipt} />
      </View>
    ) : (
      <View style={styles.state}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors.text }]}
        >
          {loading
            ? 'กำลังโหลดใบเสร็จ…'
            : error
            ? 'โหลดใบเสร็จไม่สำเร็จ'
            : 'ไม่พบใบเสร็จ'}
        </Text>
        {!loading ? (
          <Button label="ลองใหม่" variant="secondary" onPress={retry} />
        ) : null}
      </View>
    );
  const paidSummary =
    !unavailable && receipt ? (
      <View
        style={[
          styles.paidSummary,
          {
            backgroundColor: colors.surface2,
            borderColor: colors.border,
            borderRadius: 16,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            เลขที่ใบเสร็จ
          </Text>
          <Text
            style={[
              typography.bodyStrong,
              styles.summaryValue,
              { color: colors.text },
            ]}
          >
            {receipt.receiptNo ?? receipt.billNo ?? receipt.orderId}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            รับเงิน
          </Text>
          <Text
            style={[
              typography.bodyStrong,
              styles.summaryValue,
              { color: colors.text },
            ]}
          >
            ฿{(receipt.cashTendered ?? receipt.total).toFixed(2)}
          </Text>
        </View>
        <View
          style={[
            styles.summaryRow,
            styles.summaryDivider,
            { borderTopColor: colors.border },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.textMuted }]}>
            เงินทอน
          </Text>
          <Text
            style={[
              typography.title,
              styles.summaryValue,
              { color: colors.success },
            ]}
          >
            ฿{(receipt.cashChange ?? 0).toFixed(2)}
          </Text>
        </View>
      </View>
    ) : null;
  const actions = (
    <View style={styles.actions}>
      <Text
        accessibilityLiveRegion="polite"
        style={[typography.caption, { color: colors.textMuted }]}
      >
        {printer.state.message}
      </Text>
      <Button
        label="พิมพ์ใบเสร็จ"
        fullWidth
        disabled={
          unavailable ||
          !paperLayout ||
          printing ||
          printer.state.status !== 'ready'
        }
        loading={printing}
        onPress={printReceipt}
      />
      <Button
        label="เชื่อมต่อเครื่องพิมพ์"
        variant="secondary"
        fullWidth
        disabled={printing || printer.state.status === 'printing'}
        onPress={() => navigation.navigate('PrinterSettings')}
      />
      {!unavailable && receipt ? (
        <ReceiptDelivery
          key={receipt.orderId}
          orderId={receipt.orderId}
          scrollRef={deliveryScroll}
          disabled={
            Boolean(receipt.voidedAt) ||
            receipt.orderStatus !== 'COMPLETED' ||
            receipt.returnEvents.length > 0
          }
        />
      ) : null}
      {!preview ? (
        <Button
          label="ดูประวัติ"
          variant="secondary"
          fullWidth
          onPress={() => navigation.navigate('SalesHistory')}
        />
      ) : null}
      <Button label={leaveLabel} fullWidth onPress={leaveReceipt} />
    </View>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.safeArea}
      pointerEvents="box-none"
    >
      <KeyboardAvoidingView
        style={[
          styles.overlay,
          {
            backgroundColor: colors.overlay,
            padding: spacing.lg,
            justifyContent: isTablet ? 'center' : 'flex-end',
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={[
            styles.dialog,
            isTablet ? styles.dialogTablet : styles.dialogPhone,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: isTablet ? 24 : 20,
            },
          ]}
        >
          <View
            style={[
              styles.dialogHeader,
              { borderBottomColor: colors.border, gap: spacing.md },
            ]}
          >
            {!preview ? (
              <View
                style={[
                  styles.successMark,
                  {
                    backgroundColor: colors.successBg,
                    borderColor: colors.success,
                  },
                ]}
              >
                <Text style={[styles.successText, { color: colors.success }]}>
                  ✓
                </Text>
              </View>
            ) : null}
            <View style={styles.headerText}>
              <Text style={[typography.captionStrong, { color: colors.primary }]}>
                {preview ? 'ตัวอย่างเอกสาร' : 'ชำระเงินสำเร็จ'}
              </Text>
              <Text style={[typography.title, { color: colors.text }]}>
                {preview ? 'ตัวอย่างใบเสร็จ' : `ขายสำเร็จ ฿${receipt?.total.toFixed(2) ?? '0.00'}`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={leaveLabel}
              onPress={leaveReceipt}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: pressed ? colors.surface2 : colors.surface,
                  borderColor: colors.border,
                  borderRadius: 12,
                },
              ]}
            >
              <Text style={[styles.closeText, { color: colors.textMuted }]}>
                ×
              </Text>
            </Pressable>
          </View>

          <View style={[styles.dialogBody, { gap: spacing.lg }]}>
            {isTablet ? (
              <View
                testID="receipt-panes"
                style={[styles.panes, { gap: spacing.lg }]}
              >
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={styles.previewScroll}
                >
                  {paper}
                </ScrollView>
                <ScrollView
                  testID="receipt-sidebar"
                  style={styles.sidebar}
                  ref={deliveryScroll}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scroll}
                >
                  {paidSummary}
                  {actions}
                </ScrollView>
              </View>
            ) : (
              <>
                {paidSummary}
                <ScrollView
                  ref={deliveryScroll}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scroll}
                >
                  {paper}
                  {actions}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  flex: { flex: 1 },
  overlay: {
    flex: 1,
  },
  dialog: {
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  dialogTablet: {
    width: '90%',
    maxWidth: 980,
    maxHeight: '94%',
  },
  dialogPhone: {
    width: '100%',
    maxHeight: '92%',
  },
  dialogHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  successMark: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 52,
    justifyContent: 'center',
    width: 52,
    borderRadius: 26,
  },
  successText: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  headerText: { flex: 1, minWidth: 0 },
  closeButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  closeText: {
    fontSize: 30,
    lineHeight: 32,
  },
  dialogBody: {
    padding: 20,
    flexShrink: 1,
  },
  paidSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 6,
  },
  // เลขที่ใบเสร็จตกไปใช้ orderId (UUID 36 ตัว) เมื่อไม่มีเลขบิล — ไม่ให้หดได้มันจะเลยขอบการ์ด ~89px
  // ทั้งบนมือถือและในคอลัมน์ขวา 300px ของแท็บเล็ต (วัดด้วย Yoga) จึงต้องหดแล้วตัดบรรทัดแทน
  summaryValue: { flexShrink: 1, textAlign: 'right' },
  summaryDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 10,
  },
  // ⚠️ ห้ามกลับไปใช้ `flex: 1` — กล่องใบเสร็จมีแค่ `maxHeight` (สูงตามเนื้อหา) ไม่มีความสูงแน่นอน
  // `flex: 1` ทำให้ flexBasis = 0 แล้ว Yoga ให้แผงนี้สูง 0 ทั้งแผง: บนแท็บเล็ตทั้งใบเสร็จและปุ่มพิมพ์
  // หายไป เหลือแต่หัวกล่อง (ยืนยันด้วย yoga-layout ทั้ง errata All และ None, 2026-10-14)
  // ใช้ basis อัตโนมัติ (สูงตามเนื้อหาที่สูงที่สุด) แล้วหดลงเมื่อเกิน maxHeight ให้ ScrollView เลื่อนแทน
  panes: { flexDirection: 'row', flexShrink: 1 },
  sidebar: { width: 300, flexGrow: 0, flexShrink: 0 },
  scroll: { gap: 24, paddingBottom: 12 },
  previewScroll: {
    alignItems: 'center',
    gap: 24,
    paddingBottom: 12,
  },
  state: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  actions: { gap: 16 },
  paperCapture: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
});
