import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  CustomerDeliveryClient,
} from '@bms/fleet-delivery-customer-core';
import type {
  CustomerDeliveryResponseV1,
  CustomerDeliveryStatusV1,
  CustomerMatchStageV1,
  CustomerQuoteResponseV1,
} from '@bms/fleet-delivery-contracts';
import { Button, Card, Field, Screen, textStyles } from '../components/Ui';
import { useCustomerSession } from '../state/CustomerSessionContext';
import { colors, spacing } from '../theme';

function thb(satang: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
}

export function parsePackageWeight(value: string): number {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < 0.1 || weight > 50) throw new Error('PACKAGE_WEIGHT_MUST_BE_0_1_TO_50_KG');
  return weight;
}

export function customerStageLabel(stage: CustomerMatchStageV1): string {
  return {
    PAYMENT_REQUIRED: 'รอยืนยันการชำระเงิน',
    MERCHANT_PREPARING: 'ร้านค้ากำลังเตรียมสินค้า',
    READY_FOR_SEARCH: 'พร้อมค้นหารถ',
    SEARCHING: 'กำลังค้นหารถ',
    DRIVER_OFFERED: 'ส่งงานให้คนขับแล้ว',
    DRIVER_ASSIGNED: 'จับคู่รถสำเร็จ',
    PICKUP_IN_PROGRESS: 'คนขับกำลังรับสินค้า',
    IN_TRANSIT: 'กำลังนำส่งสินค้า',
    ARRIVING: 'คนขับถึงจุดส่งแล้ว',
    DELIVERED: 'ส่งสินค้าสำเร็จ',
    COMPLETED: 'รายการเสร็จสมบูรณ์',
    DELIVERY_EXCEPTION: 'ส่งสินค้าไม่สำเร็จ',
    RETURNING: 'กำลังคืนสินค้าให้ร้าน',
    RETURNED: 'คืนสินค้าให้ร้านแล้ว',
    RETURN_REVIEW: 'อยู่ระหว่างตรวจสอบการคืนสินค้า',
    RETURN_RESOLVED: 'ดำเนินการคืนสินค้าเสร็จสมบูรณ์',
    MANUAL_REVIEW: 'รอเจ้าหน้าที่ช่วยค้นหา',
    CANCELLED: 'ยกเลิกรายการแล้ว',
  }[stage];
}

export function DeliverySearchScreen() {
  const { state, clear } = useCustomerSession();
  if (state.kind !== 'ACTIVE') throw new Error('ACTIVE_CUSTOMER_SESSION_REQUIRED');
  const client = useMemo(() => new CustomerDeliveryClient(state.session), [state.session]);
  const [packageWeight, setPackageWeight] = useState('12.5');
  const [quote, setQuote] = useState<CustomerQuoteResponseV1 | null>(null);
  const [delivery, setDelivery] = useState<CustomerDeliveryResponseV1 | null>(null);
  const [status, setStatus] = useState<CustomerDeliveryStatusV1 | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationPending = useRef(false);

  const refreshStatus = useCallback(async () => {
    setStatusPending(true);
    setError(null);
    try {
      setStatus(await client.getDeliveryStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStatusPending(false);
    }
  }, [client]);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
  }, [refreshStatus]);

  const search = async () => {
    if (mutationPending.current || !status || status.delivery || delivery) return;
    mutationPending.current = true;
    setPending(true);
    setQuote(null);
    setError(null);
    try {
      const weight = parsePackageWeight(packageWeight);
      const result = await client.quote({
        serviceType: 'ON_DEMAND',
        requiredVehicleType: 'MOTORCYCLE',
        requiredCapacityKg: Math.max(20, weight),
        packageWeightKg: weight,
        packageSizeClass: 'SMALL',
        specialHandling: [],
        requirementVersion: 'customer-mobile-motorcycle:v1',
      });
      setQuote(result);
      setDelivery(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      mutationPending.current = false;
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!quote || mutationPending.current || !status || status.delivery || delivery) return;
    mutationPending.current = true;
    setPending(true);
    setError(null);
    try {
      setDelivery(await client.createDelivery(quote.quoteId));
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      mutationPending.current = false;
      setPending(false);
    }
  };

  const current = status?.delivery ?? null;
  const hasDelivery = Boolean(delivery || current);

  const disconnect = () => Alert.alert('ล้างข้อมูลทดสอบ', 'Token จะถูกลบจาก OS keystore บนอุปกรณ์นี้', [
    { text: 'ยกเลิก', style: 'cancel' },
    { text: 'ล้างข้อมูล', style: 'destructive', onPress: () => clear() },
  ]);

  return (
    <Screen title="ค้นหารถส่งสินค้า" subtitle="Motorcycle · On demand · Synthetic only">
      <Card>
        <Text style={textStyles.sectionTitle}>รายละเอียดพัสดุ</Text>
        <Field
          editable={!pending && !hasDelivery}
          keyboardType="decimal-pad"
          label="น้ำหนักพัสดุ (กก.)"
          onChangeText={value => { setPackageWeight(value); setQuote(null); setDelivery(null); }}
          value={packageWeight}
        />
        <Text style={textStyles.muted}>รองรับพัสดุขนาดเล็ก 0.1–50 กก. และไม่มี special handling ในเฟสนี้</Text>
        <Button disabled={pending || hasDelivery || !status || statusPending} label={pending ? 'กำลังค้นหา…' : 'ค้นหาราคา'} onPress={search} />
      </Card>
      {quote ? (
        <Card>
          <Text style={textStyles.sectionTitle}>ราคาที่ค้นพบ</Text>
          <Text style={textStyles.money}>{thb(quote.customerContributionSatang)}</Text>
          <View style={styles.row}><Text style={textStyles.muted}>ค่าจัดส่งรวม</Text><Text style={textStyles.body}>{thb(quote.grossDeliveryFeeSatang)}</Text></View>
          <View style={styles.row}><Text style={textStyles.muted}>ร้านค้าช่วยจ่าย</Text><Text style={textStyles.body}>{thb(quote.merchantSubsidySatang)}</Text></View>
          <View style={styles.row}><Text style={textStyles.muted}>ระยะคิดราคา</Text><Text style={textStyles.body}>{quote.startedKilometres} กม.</Text></View>
          <Text style={textStyles.muted}>ราคาหมดอายุ {new Date(quote.expiresAt).toLocaleTimeString('th-TH')}</Text>
          {!hasDelivery ? <Button disabled={pending || !status || statusPending} label="ยืนยันใช้บริการ" onPress={confirm} /> : null}
        </Card>
      ) : null}
      {delivery ? (
        <Card>
          <Text style={textStyles.sectionTitle}>สร้างรายการสำเร็จ</Text>
          <Text style={styles.success}>{delivery.state}</Text>
          <Text selectable style={textStyles.muted}>Delivery {delivery.deliveryId}</Text>
          <Text style={textStyles.warning}>รายการทดสอบจำลอง ไม่มีการชำระเงินจริง รีเฟรชสถานะเพื่อติดตามการจับคู่รถและการส่งสินค้า</Text>
        </Card>
      ) : null}
      {current ? (
        <Card>
          <Text style={textStyles.sectionTitle}>สถานะบริการล่าสุด</Text>
          <Text style={styles.success}>{customerStageLabel(current.matchStage)}</Text>
          <View style={styles.row}><Text style={textStyles.muted}>สถานะระบบ</Text><Text style={textStyles.body}>{current.state}</Text></View>
          <View style={styles.row}><Text style={textStyles.muted}>ราคาที่ลูกค้าจ่าย</Text><Text style={textStyles.body}>{thb(current.customerContributionSatang)}</Text></View>
          <Text selectable style={textStyles.muted}>Delivery {current.deliveryId} · v{current.version}</Text>
          <Text style={textStyles.muted}>อัปเดต {new Date(current.updatedAt).toLocaleTimeString('th-TH')}</Text>
          <Button
            disabled={statusPending}
            label={statusPending ? 'กำลังรีเฟรช…' : 'รีเฟรชสถานะ'}
            onPress={refreshStatus}
            tone="secondary"
          />
        </Card>
      ) : (
        <Button
          disabled={statusPending}
          label={statusPending ? 'กำลังตรวจสอบ…' : 'ตรวจสอบรายการเดิม'}
          onPress={refreshStatus}
          tone="secondary"
        />
      )}
      {error ? <Card><Text accessibilityRole="alert" style={textStyles.error}>{error}</Text></Card> : null}
      <Button label="ล้างข้อมูลทดสอบจากเครื่อง" onPress={disconnect} tone="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  success: { color: colors.success, fontSize: 18, fontWeight: '800' },
});
