import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation } from '@apollo/client';
import { MobilePosSendReceiptDocument } from '../graphql/generated';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export function ReceiptDelivery({
  orderId,
  disabled = false,
  scrollRef,
}: {
  orderId: string;
  disabled?: boolean;
  scrollRef?: React.RefObject<React.ComponentRef<typeof ScrollView> | null>;
}) {
  const { colors, typography } = useTheme();
  const { session } = useSession();
  const [sendReceipt] = useMutation(MobilePosSendReceiptDocument);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const recipientInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const revealRecipient = useCallback(() => {
    const input = recipientInput.current;
    const scroll = scrollRef?.current;
    if (!input?.isFocused() || !scroll || !Keyboard.isVisible()) return;
    scroll.measureInWindow((_x, y, _width, viewportHeight) => {
      const keyboard = Keyboard.metrics();
      const visibleHeight = keyboard
        ? Math.min(viewportHeight, Math.max(0, keyboard.screenY - y))
        : viewportHeight;
      const content = scroll.getInnerViewRef();
      if (!content) return;
      input.measureLayout(content, (_left, top, _widthInput, height) => {
        if (input.isFocused()) {
          scroll.scrollTo({
            y: Math.max(0, top + height - visibleHeight + 16),
            animated: true,
          });
        }
      });
    });
  }, [scrollRef]);

  useEffect(() => {
    // Android adjustResize shrinks the viewport without revealing the focused field.
    const subscription = Keyboard.addListener(
      'keyboardDidShow',
      revealRecipient,
    );
    return () => subscription.remove();
  }, [revealRecipient]);

  const requestSend = (channel: 'email' | 'line') => {
    if (!session || disabled || inFlight.current) return;
    const to = channel === 'email' ? email.trim() || null : null;
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      Alert.alert('อีเมลไม่ถูกต้อง', 'กรุณาตรวจสอบอีเมลผู้รับ');
      return;
    }
    const credentials = session.credentials;
    inFlight.current = true;
    setBusy(true);
    const release = () => {
      inFlight.current = false;
      setBusy(false);
    };
    Alert.alert(
      'ยืนยันส่งสำเนาใบเสร็จ',
      channel === 'email'
        ? `ผู้รับ: ${to ?? 'อีเมลสมาชิกที่ผูกกับบิลนี้'}`
        : 'ผู้รับ: LINE สมาชิกที่ผูกกับบิลนี้',
      [
        { text: 'ยกเลิก', style: 'cancel', onPress: release },
        {
          text: 'ส่งใบเสร็จ',
          onPress: async () => {
            try {
              const response = await sendReceipt({
                variables: {
                  input: {
                    cashierUserId: credentials.cashierUserId,
                    pin: credentials.pin,
                    orderId,
                    channel,
                    to,
                  },
                },
              });
              const result = response.data?.bmsPosSendReceipt;
              if (result?.status !== 'SENT')
                throw new Error(result?.reason ?? 'ส่งใบเสร็จไม่สำเร็จ');
              Alert.alert(
                'ส่งแล้ว',
                `ส่งใบเสร็จทาง ${
                  channel === 'email' ? 'อีเมล' : 'LINE'
                } สำเร็จ`,
              );
            } catch (error) {
              Alert.alert(
                'ส่งใบเสร็จไม่สำเร็จ',
                error instanceof Error ? error.message : 'กรุณาลองใหม่',
              );
            } finally {
              release();
            }
          },
        },
      ],
      { cancelable: false },
    );
  };

  return (
    <View style={styles.root}>
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        ส่งสำเนาใบเสร็จ
      </Text>
      <TextInput
        ref={recipientInput}
        onFocus={revealRecipient}
        accessibilityLabel="อีเมลผู้รับใบเสร็จ"
        value={email}
        onChangeText={setEmail}
        placeholder="อีเมล หรือเว้นว่างเพื่อใช้ข้อมูลสมาชิก"
        placeholderTextColor={colors.textSoft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!busy && !disabled}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <Button
        label="ส่งอีเมล"
        variant="secondary"
        fullWidth
        disabled={disabled || busy || !session}
        onPress={() => requestSend('email')}
      />
      <Button
        label="ส่ง LINE สมาชิก"
        variant="secondary"
        fullWidth
        disabled={disabled || busy || !session}
        onPress={() => requestSend('line')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
});
