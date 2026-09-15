import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import type { PosMenuItem } from '../types/pos';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';

interface Props {
  visible: boolean;
  onCancel: () => void;
  resolveCode: (code: string) => Promise<PosMenuItem>;
  onScanned: (item: PosMenuItem) => void;
}

export function BarcodeScannerModal({
  visible,
  onCancel,
  resolveCode,
  onScanned,
}: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode('');
      setError('');
      setLoading(false);
    }
  }, [visible]);

  const submit = async () => {
    const normalized = code.trim();
    if (!normalized || loading) return;
    setLoading(true);
    setError('');
    try {
      const item = await resolveCode(normalized);
      if (!item.sellable) throw new Error(item.unavailableNote ?? 'ขายสินค้านี้ไม่ได้ตอนนี้');
      onScanned(item);
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : 'อ่านรหัสสินค้าไม่สำเร็จ',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View
        style={[
          styles.overlay,
          {
            backgroundColor: colors.overlay,
            justifyContent: isTablet ? 'center' : 'flex-end',
            padding: isTablet ? spacing.xl : 0,
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View
          accessibilityViewIsModal
          accessibilityLabel="สแกนบาร์โค้ด"
          style={[
            styles.card,
            {
              width: isTablet ? 500 : '100%',
              paddingHorizontal: isTablet ? spacing.xxl : spacing.xl,
              paddingTop: isTablet ? spacing.xxl : spacing.xl,
              paddingBottom: isTablet
                ? spacing.xxl
                : spacing.xl + insets.bottom,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: isTablet ? radius.lg : 0,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
            },
          ]}
        >
          <Text style={[typography.title, { color: colors.text }]}>
            สแกนบาร์โค้ด
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            ยิงบาร์โค้ดจากเครื่องสแกน หรือกรอก SKU แล้วให้เซิร์ฟเวอร์ตรวจสินค้าและสต็อก
          </Text>
          <TextInput
            value={code}
            onChangeText={next => {
              setCode(next);
              setError('');
            }}
            onSubmitEditing={submit}
            placeholder="บาร์โค้ดหรือ SKU"
            placeholderTextColor={colors.textSoft}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            style={[
              typography.body,
              {
                minHeight: 48,
                marginTop: spacing.lg,
                paddingHorizontal: spacing.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: error ? colors.danger : colors.border,
                borderRadius: radius.md,
                color: colors.text,
                backgroundColor: colors.surface,
              },
            ]}
          />
          {error ? (
            <Text
              style={[
                typography.captionStrong,
                { color: colors.danger, marginTop: spacing.sm },
              ]}
            >
              {error}
            </Text>
          ) : null}
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label={loading ? 'กำลังตรวจสินค้า…' : 'เพิ่มสินค้าจากรหัส'}
              fullWidth
              disabled={!code.trim() || loading}
              onPress={submit}
            />
            <Button label="ยกเลิก" variant="ghost" fullWidth onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center' },
  card: {
    maxWidth: 500,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
});
