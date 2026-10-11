import React, { useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
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
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={preview ? 'ตัวอย่างใบเสร็จ' : 'ขายสำเร็จ'}
        onBack={leaveReceipt}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {isTablet ? (
          <View style={[styles.panes, { gap: spacing.lg }]}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scroll}
            >
              {paper}
            </ScrollView>
            <ScrollView
              style={styles.sidebar}
              ref={deliveryScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scroll}
            >
              {actions}
            </ScrollView>
          </View>
        ) : (
          <ScrollView
            ref={deliveryScroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            {paper}
            {actions}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panes: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 300, flexGrow: 0 },
  scroll: { gap: 24, paddingBottom: 12 },
  state: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  actions: { gap: 16 },
  paperCapture: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
});
