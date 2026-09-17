import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

type ScannerView = 'opening-camera' | 'manual';

const BARCODE_FORMATS = [
  'codabar',
  'code-128',
  'code-39',
  'code-93',
  'data-matrix',
  'ean-13',
  'ean-8',
  'itf',
  'pdf-417',
  'qr',
  'upc-a',
  'upc-e',
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scanWasCancelled(error: unknown): boolean {
  return /cancell?ed/i.test(errorMessage(error));
}

function scannerFailureMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/NitroModules|Turbo\/Native-Module|could not be found/i.test(message)) {
    return 'แอปที่ติดตั้งอยู่ยังไม่มีโมดูลกล้อง กรุณาติดตั้งแอปเวอร์ชันล่าสุด แล้วเปิดใหม่อีกครั้ง';
  }
  return 'เปิดกล้องสแกนไม่ได้ อุปกรณ์นี้อาจไม่รองรับกล้องสแกน หรือยังไม่ได้อนุญาตสิทธิ์กล้อง กรุณาตรวจสิทธิ์แล้วลองใหม่';
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
  const [view, setView] = useState<ScannerView>('opening-camera');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(visible);
  const startedForOpenRef = useRef(false);
  const attemptRef = useRef(0);
  const onCancelRef = useRef(onCancel);
  const onScannedRef = useRef(onScanned);
  const resolveCodeRef = useRef(resolveCode);

  visibleRef.current = visible;
  onCancelRef.current = onCancel;
  onScannedRef.current = onScanned;
  resolveCodeRef.current = resolveCode;

  const resolveScannedCode = useCallback(
    async (rawCode: string, attempt: number) => {
      const normalized = rawCode.trim();
      if (!normalized) return;

      setLoading(true);
      setError('');
      try {
        const item = await resolveCodeRef.current(normalized);
        if (!item.sellable) {
          throw new Error(item.unavailableNote ?? 'ขายสินค้านี้ไม่ได้ตอนนี้');
        }
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        onScannedRef.current(item);
      } catch (resolveError) {
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        setCode(normalized);
        setView('manual');
        setError(errorMessage(resolveError) || 'อ่านรหัสสินค้าไม่สำเร็จ');
      } finally {
        if (visibleRef.current && attempt === attemptRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const openCamera = useCallback(() => {
    const attempt = ++attemptRef.current;
    setView('opening-camera');
    setCode('');
    setError('');
    setLoading(false);

    // Lazy import is deliberate. During development or an OTA update, Metro can
    // deliver newer JS to an older installed binary. A top-level import would
    // crash the entire sale screen before we could offer the manual fallback.
    import('react-native-data-scanner')
      .then(({ DataScanner }) =>
        DataScanner.scanBarcode({
          targetFormats: [...BARCODE_FORMATS],
          qualityLevel: 'balanced',
          enableAutoZoom: true,
        }),
      )
      .then(result => {
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        return resolveScannedCode(result.value, attempt);
      })
      .catch(scanError => {
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        if (scanWasCancelled(scanError)) {
          onCancelRef.current();
          return;
        }
        setView('manual');
        setError(scannerFailureMessage(scanError));
      });
  }, [resolveScannedCode]);

  useEffect(() => {
    if (visible && !startedForOpenRef.current) {
      startedForOpenRef.current = true;
      openCamera();
    } else if (!visible) {
      startedForOpenRef.current = false;
      attemptRef.current += 1;
      setView('opening-camera');
      setCode('');
      setError('');
      setLoading(false);
    }
  }, [openCamera, visible]);

  const submitManualCode = () => {
    if (!code.trim() || loading) return;
    const attempt = ++attemptRef.current;
    resolveScannedCode(code, attempt).catch(() => undefined);
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
        {view === 'manual' ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        ) : null}
        <View
          accessibilityViewIsModal
          accessibilityLabel={
            view === 'opening-camera'
              ? 'กำลังเปิดกล้องสแกนบาร์โค้ด'
              : 'กรอกบาร์โค้ดหรือ SKU เอง'
          }
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
          {view === 'opening-camera' ? (
            <View style={styles.openingCamera}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[typography.title, { color: colors.text }]}>
                กำลังเปิดกล้อง…
              </Text>
              <Text
                style={[
                  typography.caption,
                  { color: colors.textMuted, textAlign: 'center' },
                ]}
              >
                หันกล้องไปที่บาร์โค้ด ระบบจะอ่านและตรวจสินค้าให้อัตโนมัติ
              </Text>
            </View>
          ) : (
            <>
              <Text style={[typography.title, { color: colors.text }]}>
                กรอกบาร์โค้ดหรือ SKU
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ใช้กรณีกล้องอ่านไม่ได้ หรือรับรหัสจากเครื่องสแกน USB/Bluetooth
              </Text>
              <TextInput
                value={code}
                onChangeText={next => {
                  setCode(next);
                  setError('');
                }}
                onSubmitEditing={submitManualCode}
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
                  accessibilityRole="alert"
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
                  loading={loading}
                  disabled={!code.trim() || loading}
                  onPress={submitManualCode}
                />
                <Button
                  label="เปิดกล้องอีกครั้ง"
                  variant="secondary"
                  fullWidth
                  disabled={loading}
                  onPress={openCamera}
                />
                <Button
                  label="ยกเลิก"
                  variant="ghost"
                  fullWidth
                  disabled={loading}
                  onPress={onCancel}
                />
              </View>
            </>
          )}
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
  openingCamera: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
});
