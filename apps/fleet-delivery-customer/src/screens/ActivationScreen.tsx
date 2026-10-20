import React, { useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { z } from 'zod';
import { Button, Card, Field, Screen, textStyles } from '../components/Ui';
import { useCustomerSession } from '../state/CustomerSessionContext';
import { colors } from '../theme';

export function ActivationScreen() {
  const { state, activate, clear, reload } = useCustomerSession();
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:4100');
  const [accessToken, setAccessToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.kind === 'LOADING') {
    return (
      <Screen title="BMS Go" subtitle="กำลังเปิดที่เก็บข้อมูลปลอดภัย">
        <ActivityIndicator color={colors.primary} size="large" />
      </Screen>
    );
  }

  if (state.kind === 'UNAVAILABLE') {
    return (
      <Screen title="BMS Go" subtitle="รุ่นทดสอบภายใน">
        <Card>
          <Text style={textStyles.sectionTitle}>ไม่สามารถอ่าน OS keystore</Text>
          <Text accessibilityRole="alert" style={textStyles.error}>{state.error}</Text>
          <Button label="ลองใหม่" onPress={() => reload()} />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'LOCKED') {
    return (
      <Screen title="BMS Go" subtitle="Production lock">
        <Card>
          <Text style={textStyles.sectionTitle}>ปิดการเชื่อมต่อแบบ Synthetic</Text>
          <Text style={textStyles.warning}>
            Release build ไม่รับ token ทดสอบ ต้องใช้ production customer authentication ที่ผ่านการอนุมัติก่อน
          </Text>
        </Card>
      </Screen>
    );
  }

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await activate({ apiBaseUrl, accessToken, expiresAt, syntheticOnly: true });
    } catch (caught) {
      if (caught instanceof z.ZodError) setError(caught.issues[0]?.message ?? 'ข้อมูล activation ไม่ถูกต้อง');
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen title="BMS Go" subtitle="ค้นหารถส่งสินค้า · Synthetic Debug">
      <Card>
        <Text style={textStyles.sectionTitle}>Production lock ทำงานอยู่</Text>
        <Text style={textStyles.warning}>
          Activation ชั่วคราวใช้ได้เฉพาะ Debug build ไม่มี tenant, branch หรือ order ให้ผู้ใช้กำหนดเอง
        </Text>
      </Card>
      {state.kind === 'EXPIRED' ? (
        <Card>
          <Text accessibilityRole="alert" style={textStyles.error}>Session หมดอายุ กรุณาสร้าง customer-search scenario ใหม่</Text>
          <Button label="ล้าง session เดิม" onPress={() => clear()} tone="danger" />
        </Card>
      ) : (
        <Card>
          <Text style={textStyles.sectionTitle}>เชื่อมต่อระบบทดสอบ</Text>
          <Text style={textStyles.muted}>คัดลอกเฉพาะ customerActivation จากไฟล์ scenario ที่ป้องกันไว้</Text>
          <Field autoCapitalize="none" autoCorrect={false} label="API URL" onChangeText={setApiBaseUrl} value={apiBaseUrl} />
          <Field autoCapitalize="none" autoCorrect={false} label="Access token" onChangeText={setAccessToken} secureTextEntry value={accessToken} />
          <Field autoCapitalize="none" autoCorrect={false} label="Expires at (ISO-8601)" onChangeText={setExpiresAt} value={expiresAt} />
          {error ? <Text accessibilityRole="alert" style={textStyles.error}>{error}</Text> : null}
          <Button disabled={pending} label={pending ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'} onPress={submit} />
        </Card>
      )}
    </Screen>
  );
}
