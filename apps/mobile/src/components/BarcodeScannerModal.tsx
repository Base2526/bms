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
import type { MockMenuCatalog, MockMenuItem } from '../mocks/menu';
import { resolveMockBarcode } from '../lib/barcode';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';

interface Props {
  visible: boolean;
  catalog: MockMenuCatalog;
  onCancel: () => void;
  onScanned: (item: MockMenuItem) => void;
}

export function BarcodeScannerModal({
  visible,
  catalog,
  onCancel,
  onScanned,
}: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setCode('');
      setError('');
    }
  }, [visible]);

  const resolveCode = (rawCode: string) => {
    const result = resolveMockBarcode(catalog, rawCode);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onScanned(result.item);
  };

  const sample = catalog.items.find(item => item.sellable && item.barcode);

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
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, marginTop: spacing.xs },
            ]}
          >
            โหมดทดสอบ — ป้อนรหัสหรือยิงบาร์โค้ดตัวอย่าง ยังไม่เปิดกล้องจริง
          </Text>

          <View
            style={[
              styles.scanFrame,
              {
                marginTop: spacing.lg,
                borderColor: colors.primary,
                borderRadius: radius.lg,
                backgroundColor: colors.surface2,
              },
            ]}
          >
            <Text style={[styles.barcodeGlyph, { color: colors.text }]}>
              ▥ ▥ ▥ ▥ ▥
            </Text>
            <View
              style={[styles.scanLine, { backgroundColor: colors.primary }]}
            />
            <Text
              style={[typography.captionStrong, { color: colors.textMuted }]}
            >
              วางบาร์โค้ดให้อยู่ในกรอบ
            </Text>
          </View>

          <TextInput
            value={code}
            onChangeText={next => {
              setCode(next);
              setError('');
            }}
            onSubmitEditing={() => resolveCode(code)}
            placeholder="กรอกบาร์โค้ดหรือ SKU"
            placeholderTextColor={colors.textSoft}
            autoCapitalize="characters"
            autoCorrect={false}
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
              label="เพิ่มสินค้าจากรหัส"
              fullWidth
              disabled={!code.trim()}
              onPress={() => resolveCode(code)}
            />
            <Button
              label={`สแกนตัวอย่าง${sample ? ` · ${sample.barcode}` : ''}`}
              variant="secondary"
              fullWidth
              disabled={!sample}
              onPress={() =>
                sample && resolveCode(sample.barcode ?? sample.sku)
              }
            />
            <Button
              label="ยกเลิก"
              variant="ghost"
              fullWidth
              onPress={onCancel}
            />
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
  scanFrame: {
    height: 150,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    overflow: 'hidden',
  },
  barcodeGlyph: { fontSize: 34, fontWeight: '800', letterSpacing: 3 },
  scanLine: { position: 'absolute', left: 28, right: 28, height: 2 },
});
