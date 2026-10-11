import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutRectangle,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { usePrinter } from '../../state/PrinterContext';
import { captureReceipt } from '../../lib/captureReceipt';

export default function PrinterSettingsScreen({
  navigation,
}: {
  navigation: { goBack: () => void };
}) {
  const { colors, typography } = useTheme();
  const printer = usePrinter();
  const [host, setHost] = useState(printer.saved?.host ?? '');
  const [port, setPort] = useState(String(printer.saved?.port ?? 9100));
  const [paperWidth, setPaperWidth] = useState<58 | 80>(
    printer.saved?.paperWidth ?? 80,
  );
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    if (printer.saved && !edited.current) {
      setHost(printer.saved.host);
      setPort(String(printer.saved.port));
      setPaperWidth(printer.saved.paperWidth);
    }
  }, [printer.saved]);
  const testPaper = useRef<React.ComponentRef<typeof View>>(null);
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const connected = printer.state.status === 'ready';
  const locked =
    busy ||
    printer.state.status === 'printing' ||
    printer.state.status === 'connecting';
  const change = (action: () => void) => {
    edited.current = true;
    printer.disconnect();
    action();
  };
  const connect = async () => {
    setBusy(true);
    try {
      await printer.connect({ host, port: Number(port), paperWidth });
    } catch (error) {
      Alert.alert(
        'เชื่อมต่อไม่ได้',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      await printer.print(config => captureReceipt(testPaper, layout, config));
      Alert.alert('ส่งงานทดสอบแล้ว', 'กรุณาตรวจข้อความภาษาไทยและ QR บนกระดาษ');
    } catch (error) {
      Alert.alert(
        'พิมพ์ไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setBusy(false);
    }
  };
  const inputStyle = [
    styles.input,
    typography.body,
    { borderColor: colors.border, color: colors.text },
  ];
  return (
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title="เครื่องพิมพ์ใบเสร็จ"
        onBack={() => navigation.goBack()}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={[typography.bodyStrong, { color: colors.text }]}>
            Wi-Fi / LAN · ESC/POS
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              typography.body,
              { color: connected ? colors.success : colors.textMuted },
            ]}
          >
            {printer.state.message}
          </Text>
          {printer.storageWarning ? (
            <Text style={[typography.caption, { color: colors.warning }]}>
              {printer.storageWarning}
            </Text>
          ) : null}
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            IP เครื่องพิมพ์
          </Text>
          <TextInput
            accessibilityLabel="IP เครื่องพิมพ์"
            value={host}
            onChangeText={text => change(() => setHost(text))}
            editable={!locked}
            keyboardType="decimal-pad"
            autoCorrect={false}
            autoCapitalize="none"
            placeholder="192.168.1.100"
            placeholderTextColor={colors.textSoft}
            style={inputStyle}
          />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            พอร์ต
          </Text>
          <TextInput
            accessibilityLabel="พอร์ตเครื่องพิมพ์"
            value={port}
            onChangeText={text => change(() => setPort(text))}
            editable={!locked}
            keyboardType="number-pad"
            style={inputStyle}
          />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            กระดาษ
          </Text>
          <View style={styles.segment} accessibilityRole="radiogroup">
            {([58, 80] as const).map(width => (
              <Pressable
                key={width}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: paperWidth === width,
                  disabled: locked,
                }}
                disabled={locked}
                onPress={() => change(() => setPaperWidth(width))}
                style={[
                  styles.option,
                  {
                    borderColor:
                      paperWidth === width ? colors.primary : colors.border,
                    backgroundColor:
                      paperWidth === width ? colors.surface2 : colors.bg,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {width} มม.
                </Text>
              </Pressable>
            ))}
          </View>
          <Button
            label={connected ? 'ยกเลิกการเชื่อมต่อ' : 'เชื่อมต่อเครื่องพิมพ์'}
            fullWidth
            disabled={locked}
            loading={printer.state.status === 'connecting'}
            onPress={connected ? printer.disconnect : connect}
          />
          <Button
            label="พิมพ์ทดสอบ"
            variant="secondary"
            fullWidth
            disabled={!connected || locked || !layout}
            onPress={test}
          />
          <View
            ref={testPaper}
            collapsable={false}
            onLayout={event => setLayout(event.nativeEvent.layout)}
            style={styles.testPaper}
          >
            <Text style={styles.testTitle}>BMS POS</Text>
            <Text style={styles.testText}>ทดสอบเครื่องพิมพ์</Text>
            <Text style={styles.testText}>ภาษาไทย · ABC 0123456789</Text>
            <Text style={styles.testText}>ไม่ใช่ใบเสร็จรับเงิน</Text>
            <QRCode value="BMS-PRINTER-TEST" size={128} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    gap: 12,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  segment: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 6,
  },
  testPaper: {
    backgroundColor: '#ffffff',
    padding: 20,
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 12,
  },
  testTitle: { fontSize: 22, fontWeight: '700', color: '#000000' },
  testText: { fontSize: 16, color: '#000000', textAlign: 'center' },
});
