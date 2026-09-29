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
import { containsThaiCharacters } from '../lib/scannerInput';
import {
  loadScannerInputMode,
  saveScannerInputMode,
  type ScannerInputMode,
} from '../lib/scannerPreference';
import type { PosMenuItem } from '../types/pos';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../theme/useResponsive';

interface Props {
  visible: boolean;
  onCancel: () => void;
  resolveCode: (code: string) => Promise<PosMenuItem>;
  onScanned: (item: PosMenuItem, inputMode: ScannerInputMode) => void;
  completedHardwareScan: { sequence: number; name: string } | null;
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
  completedHardwareScan,
}: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<ScannerView>('opening-camera');
  const [inputMode, setInputMode] = useState<ScannerInputMode>('camera');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [lastAdded, setLastAdded] = useState('');
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const visibleRef = useRef(visible);
  const startedForOpenRef = useRef(false);
  const attemptRef = useRef(0);
  const submittingRef = useRef(false);
  const codeRef = useRef('');
  const inputModeRef = useRef<ScannerInputMode>('camera');
  const completedSequenceRef = useRef(0);
  const manualInputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const onCancelRef = useRef(onCancel);
  const onScannedRef = useRef(onScanned);
  const resolveCodeRef = useRef(resolveCode);

  visibleRef.current = visible;
  inputModeRef.current = inputMode;
  onCancelRef.current = onCancel;
  onScannedRef.current = onScanned;
  resolveCodeRef.current = resolveCode;

  const resolveScannedCode = useCallback(
    async (
      rawCode: string,
      attempt: number,
      source: ScannerInputMode,
    ) => {
      const normalized = rawCode.trim();
      if (!normalized) return;
      if (source === 'hardware' && containsThaiCharacters(normalized)) {
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        codeRef.current = normalized;
        setCode(normalized);
        setView('manual');
        setSelection({ start: 0, end: normalized.length });
        setError(
          'รหัสมีอักษรไทย กรุณาเปลี่ยนคีย์บอร์ดฮาร์ดแวร์เป็น English (US) ที่ ตั้งค่า > ทั่วไป > คีย์บอร์ด',
        );
        requestAnimationFrame(() => manualInputRef.current?.focus());
        return;
      }

      setLoading(true);
      setError('');
      try {
        const item = await resolveCodeRef.current(normalized);
        if (!item.sellable) {
          throw new Error(item.unavailableNote ?? 'ขายสินค้านี้ไม่ได้ตอนนี้');
        }
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        onScannedRef.current(item, source);
        if (source === 'hardware') {
          // consume รหัสทันทีแม้สินค้าต้องเปิดตัวเลือกต่อ เพื่อให้ CR+LF ไม่ resolve ซ้ำสองรอบ
          codeRef.current = '';
          manualInputRef.current?.clear();
          setCode('');
          setSelection(undefined);
        }
      } catch (resolveError) {
        if (!visibleRef.current || attempt !== attemptRef.current) return;
        codeRef.current = normalized;
        setCode(normalized);
        setView('manual');
        setSelection({ start: 0, end: normalized.length });
        setError(errorMessage(resolveError) || 'อ่านรหัสสินค้าไม่สำเร็จ');
        requestAnimationFrame(() => manualInputRef.current?.focus());
      } finally {
        if (visibleRef.current && attempt === attemptRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const openCamera = useCallback((remember = true) => {
    const attempt = ++attemptRef.current;
    inputModeRef.current = 'camera';
    setInputMode('camera');
    setView('opening-camera');
    codeRef.current = '';
    setCode('');
    setError('');
    setLastAdded('');
    setSelection(undefined);
    setLoading(false);
    submittingRef.current = false;
    if (remember) {
      saveScannerInputMode('camera').catch(() => undefined);
    }

    // Lazy import is deliberate. During development or an OTA update, Metro can
    // deliver newer JS to an older installed binary. A top-level import would
    // crash the entire sale screen before we could offer the manual fallback.
    import('react-native-data-scanner')
      .then(({ DataScanner }) => {
        if (!visibleRef.current || attempt !== attemptRef.current) return null;
        return DataScanner.scanBarcode({
          targetFormats: [...BARCODE_FORMATS],
          qualityLevel: 'balanced',
          enableAutoZoom: true,
        });
      })
      .then(result => {
        if (
          !result ||
          !visibleRef.current ||
          attempt !== attemptRef.current
        )
          return;
        return resolveScannedCode(result.value, attempt, 'camera');
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

  const enterHardwareScannerMode = useCallback((remember = true) => {
    ++attemptRef.current;
    inputModeRef.current = 'hardware';
    setInputMode('hardware');
    setView('manual');
    codeRef.current = '';
    setCode('');
    setError('');
    setLastAdded('');
    setSelection(undefined);
    setLoading(false);
    submittingRef.current = false;
    if (remember) {
      saveScannerInputMode('hardware').catch(() => undefined);
    }
    requestAnimationFrame(() => manualInputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (visible && !startedForOpenRef.current) {
      startedForOpenRef.current = true;
      const attempt = ++attemptRef.current;
      loadScannerInputMode()
        .then(preferredMode => {
          if (!visibleRef.current || attempt !== attemptRef.current) return;
          if (preferredMode === 'hardware') enterHardwareScannerMode(false);
          else openCamera(false);
        })
        .catch(() => {
          if (visibleRef.current && attempt === attemptRef.current) {
            openCamera(false);
          }
        });
    } else if (!visible) {
      startedForOpenRef.current = false;
      attemptRef.current += 1;
      submittingRef.current = false;
      inputModeRef.current = 'camera';
      setView('opening-camera');
      setInputMode('camera');
      codeRef.current = '';
      setCode('');
      setError('');
      setLastAdded('');
      setSelection(undefined);
      setLoading(false);
    }
  }, [enterHardwareScannerMode, openCamera, visible]);

  useEffect(() => {
    if (
      !visible ||
      inputMode !== 'hardware' ||
      !completedHardwareScan ||
      completedHardwareScan.sequence === completedSequenceRef.current
    )
      return;
    completedSequenceRef.current = completedHardwareScan.sequence;
    // ล้างทั้ง ref และ native buffer ทันที: LF ตัวที่สองอาจมาก่อน React commit ค่า code รอบนี้
    codeRef.current = '';
    manualInputRef.current?.clear();
    setCode('');
    setError('');
    setSelection(undefined);
    setLastAdded(completedHardwareScan.name);
    requestAnimationFrame(() => {
      if (visibleRef.current) manualInputRef.current?.focus();
    });
  }, [completedHardwareScan, inputMode, visible]);

  const submitManualCode = () => {
    const currentCode = codeRef.current;
    if (!currentCode.trim() || loading || submittingRef.current) return;
    submittingRef.current = true;
    setLastAdded('');
    const attempt = ++attemptRef.current;
    resolveScannedCode(currentCode, attempt, inputModeRef.current)
      .catch(() => undefined)
      .finally(() => {
        if (attempt === attemptRef.current) submittingRef.current = false;
      });
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
              <Button
                label="ใช้เครื่องสแกน"
                variant="secondary"
                fullWidth
                onPress={() => enterHardwareScannerMode()}
              />
            </View>
          ) : (
            <>
              <Text style={[typography.title, { color: colors.text }]}>
                {inputMode === 'hardware'
                  ? 'สแกนด้วยเครื่องสแกน'
                  : 'กรอกบาร์โค้ดหรือ SKU'}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ใช้กรณีกล้องอ่านไม่ได้ หรือรับรหัสจากเครื่องสแกน USB/Bluetooth
              </Text>
              <TextInput
                ref={manualInputRef}
                value={code}
                onChangeText={next => {
                  codeRef.current = next;
                  setCode(next);
                  setError('');
                  setSelection(undefined);
                }}
                onSubmitEditing={submitManualCode}
                selection={selection}
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
              {lastAdded ? (
                <Text
                  accessibilityRole="alert"
                  style={[
                    typography.captionStrong,
                    { color: colors.success, marginTop: spacing.sm },
                  ]}
                >
                  เพิ่มแล้ว · {lastAdded}
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
                  label="ใช้เครื่องสแกน"
                  variant={
                    inputMode === 'hardware' ? 'primary' : 'secondary'
                  }
                  fullWidth
                  disabled={loading}
                  onPress={() => enterHardwareScannerMode()}
                />
                <Button
                  label="เปิดกล้องอีกครั้ง"
                  variant="secondary"
                  fullWidth
                  disabled={loading}
                  onPress={() => openCamera()}
                />
                <Button
                  label={inputMode === 'hardware' ? 'เสร็จ' : 'ยกเลิก'}
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
