import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { MenuGrid } from '../../components/MenuGrid';
import { QtyStepper } from '../../components/QtyStepper';
import { BarcodeScannerModal } from '../../components/BarcodeScannerModal';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import { useStoreMode } from '../../state/StoreModeContext';
import {
  generalMockCatalog,
  pharmacyMockCatalog,
  restaurantMockCatalog,
} from '../../mocks/menu';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'Menu'>;

/** ความกว้างแผงตะกร้าบนแท็บเล็ต
 *  320 ไม่ใช่เลขสวย ๆ — วัดจากจอจริง: ไอแพดแนวตั้ง 1024pt ถ้าแผงกว้าง 360 จะเหลือที่ให้กริด 664
 *  ซึ่งตกเกณฑ์ 700 แล้วกริดหล่นเหลือ 2 คอลัมน์ (การ์ดใหญ่เกินจำเป็น เห็นเมนูได้น้อยลงกว่าเดิม)
 *  ที่ 320 เหลือ 704 → 3 คอลัมน์ และแผงยังกว้างพอให้ชื่อเมนูไทยอ่านจบคู่กับปุ่มเพิ่ม/ลด */
export const CART_PANEL_WIDTH = 320;

// แท็บ "เมนูอาหาร" = ขายที่ไม่ผูกโต๊ะ (กลับบ้าน/สั่งที่เคาน์เตอร์)
// การสั่งให้โต๊ะอยู่ที่แท็บ "ผังโต๊ะ" → เลือกโต๊ะ → สั่งอาหาร (บิลของโต๊ะอยู่ใน ChecksContext)
export default function MenuScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const {
    lines,
    addItem,
    decrementItem,
    total,
    parkedBills,
    parkCurrentBill,
    resumeParkedBill,
    deleteParkedBill,
  } = useCart();
  const { mode } = useStoreMode();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkName, setParkName] = useState('');
  const [parkNote, setParkNote] = useState('');
  const [lastScanned, setLastScanned] = useState('');

  const catalog =
    mode === 'restaurant'
      ? restaurantMockCatalog
      : mode === 'pharmacy'
      ? pharmacyMockCatalog
      : generalMockCatalog;
  const screenTitle =
    mode === 'restaurant'
      ? 'เมนูอาหาร'
      : mode === 'pharmacy'
      ? 'ขายยาและสินค้า'
      : 'ขายสินค้า';

  const qtyBySku = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.sku] = l.qty;
    return map;
  }, [lines]);

  const cartCount = lines.reduce((n, l) => n + l.qty, 0);

  const grid = (
    <MenuGrid
      qtyBySku={qtyBySku}
      onAdd={item => addItem(item.sku, item.name, item.price, item.barcode)}
      onDecrement={sku => decrementItem(sku)}
      areaWidth={isTablet ? width - CART_PANEL_WIDTH : width}
      artHeight={isTablet ? 116 : 96}
      catalog={catalog}
      header={
        <View style={styles.menuHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.title, { color: colors.text }]}>
              {screenTitle}
            </Text>
            {lastScanned ? (
              <Text
                style={[typography.captionStrong, { color: colors.success }]}
              >
                เพิ่มจากบาร์โค้ดแล้ว · {lastScanned}
              </Text>
            ) : null}
          </View>
          <Button
            label="▥ สแกนบาร์โค้ด"
            accessibilityLabel="เปิดหน้าต่างสแกนบาร์โค้ดทดสอบ"
            variant="secondary"
            onPress={() => setScannerOpen(true)}
          />
          <Button
            label="ประวัติ"
            accessibilityLabel="เปิดประวัติการขายล่าสุด"
            variant="secondary"
            onPress={() => navigation.navigate('SalesHistory')}
          />
        </View>
      }
    />
  );

  // แผงตะกร้าฝั่งขวาบนแท็บเล็ต — รูปเดียวกับแผงบิลของ /pos/restaurant บนเว็บ:
  // กริดเมนูอยู่ฝั่งกว้าง (แตะเลือกด้วยตา) · สิ่งที่ลูกค้าสั่งแล้วอยู่ในสายตาตลอดโดยไม่ต้องเปลี่ยนหน้า
  const cartPanel = (
    <View
      style={{
        width: CART_PANEL_WIDTH,
        backgroundColor: colors.surface,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: colors.border,
        padding: spacing.lg,
      }}
    >
      <Text
        style={[
          typography.subtitle,
          { color: colors.text, marginBottom: spacing.md },
        ]}
      >
        ตะกร้า {cartCount > 0 ? `· ${cartCount} รายการ` : ''}
      </Text>

      <FlatList
        data={lines}
        keyExtractor={l => l.sku}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginVertical: spacing.md,
            }}
          />
        )}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ยังไม่มีรายการ — แตะเมนูเพื่อเพิ่ม
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.sm,
              }}
            >
              <Text
                style={[typography.body, { color: colors.text, flex: 1 }]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <QtyStepper
                qty={item.qty}
                itemName={item.name}
                variant="outline"
                onIncrement={() =>
                  addItem(item.sku, item.name, item.unitPrice, item.barcode)
                }
                onDecrement={() => decrementItem(item.sku)}
              />
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                ฿{item.unitPrice.toFixed(2)} / หน่วย
              </Text>
            </View>
          </View>
        )}
      />

      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          paddingTop: spacing.md,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
          }}
        >
          <Text style={[typography.subtitle, { color: colors.text }]}>รวม</Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{total.toFixed(2)}
          </Text>
        </View>
        <Button
          label="ไปหน้าชำระเงิน"
          accessibilityLabel="ไปหน้าชำระเงินตะกร้าปัจจุบัน"
          fullWidth
          disabled={cartCount === 0}
          onPress={() => navigation.navigate('Checkout', { source: 'retail' })}
        />
        <Button
          label={`บิลพัก${
            parkedBills.length ? ` (${parkedBills.length})` : ''
          }`}
          accessibilityLabel="เปิดบิลพักหรือพักตะกร้าปัจจุบันไว้ในหน่วยความจำทดสอบ"
          variant="secondary"
          fullWidth
          disabled={cartCount === 0 && parkedBills.length === 0}
          style={{ marginTop: spacing.sm }}
          onPress={() => setParkOpen(true)}
        />
      </View>
    </View>
  );

  return (
    <ScreenContainer padded={false}>
      {isTablet ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {grid}
          {cartPanel}
        </View>
      ) : (
        <>
          {grid}
          {/* มือถือ: แถบสรุปล่างจอแทนแผงข้าง */}
          <View
            style={[
              styles.cartBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                padding: spacing.lg,
              },
            ]}
          >
            <View>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {cartCount} รายการ
              </Text>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ฿{total.toFixed(2)}
              </Text>
            </View>
            <Button
              label="ไปหน้าชำระเงิน"
              accessibilityLabel="ไปหน้าชำระเงินตะกร้าปัจจุบัน"
              disabled={cartCount === 0}
              onPress={() =>
                navigation.navigate('Checkout', { source: 'retail' })
              }
            />
          </View>
          <View
            style={{
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.md,
              gap: spacing.sm,
            }}
          >
            <Button
              label={`บิลพัก${
                parkedBills.length ? ` (${parkedBills.length})` : ''
              }`}
              accessibilityLabel="เปิดบิลพักหรือพักตะกร้าปัจจุบันไว้ในหน่วยความจำทดสอบ"
              variant="secondary"
              fullWidth
              disabled={cartCount === 0 && parkedBills.length === 0}
              onPress={() => setParkOpen(true)}
            />
            {/* ⚠️ ปุ่มนี้เคยชื่อ "บิลพัก/ประวัติ (N)" โดยที่ N คือจำนวนบิลพักของปุ่มข้างบน
                แต่กดแล้วไปหน้าประวัติการขายอย่างเดียว — ป้ายบอกงานที่ปุ่มไม่ได้ทำ */}
            <Button
              label="ประวัติการขาย"
              accessibilityLabel="เปิดประวัติการขายล่าสุด"
              variant="ghost"
              fullWidth
              onPress={() => navigation.navigate('SalesHistory')}
            />
          </View>
        </>
      )}
      <BarcodeScannerModal
        visible={scannerOpen}
        catalog={catalog}
        onCancel={() => setScannerOpen(false)}
        onScanned={item => {
          addItem(item.sku, item.name, item.price, item.barcode);
          setLastScanned(item.name);
          setScannerOpen(false);
        }}
      />
      <Modal transparent visible={parkOpen} animationType="fade">
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setParkOpen(false)}
          />
          <View
            style={[
              styles.parkModal,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                padding: spacing.lg,
              },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                พักบิล TEST
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                เก็บใน memory เท่านั้น และไม่เก็บ PIN ผู้อนุมัติส่วนลด
              </Text>
              {cartCount > 0 ? (
                <>
                  <TextInput
                    value={parkName}
                    onChangeText={setParkName}
                    placeholder="ชื่อบิล เช่น ลูกค้าเสื้อแดง"
                    placeholderTextColor={colors.textSoft}
                    style={[
                      styles.input,
                      { color: colors.text, borderColor: colors.border },
                    ]}
                  />
                  <TextInput
                    value={parkNote}
                    onChangeText={setParkNote}
                    placeholder="หมายเหตุ"
                    placeholderTextColor={colors.textSoft}
                    style={[
                      styles.input,
                      { color: colors.text, borderColor: colors.border },
                    ]}
                  />
                  <Button
                    label="ยืนยันพักบิล"
                    accessibilityLabel="ยืนยันพักบิลทดสอบ"
                    fullWidth
                    onPress={() => {
                      parkCurrentBill(parkName, parkNote);
                      setParkName('');
                      setParkNote('');
                    }}
                  />
                </>
              ) : (
                <Text
                  style={[
                    typography.captionStrong,
                    { color: colors.textMuted, marginTop: spacing.md },
                  ]}
                >
                  ตะกร้าว่าง — เลือกบิลพักด้านล่างเพื่อเรียกกลับ
                </Text>
              )}
              {parkedBills.length > 0 && (
                <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted },
                    ]}
                  >
                    เรียกบิลพัก
                  </Text>
                  {parkedBills.map(bill => (
                    <View key={bill.id} style={{ gap: spacing.xs }}>
                      <Button
                        label={`${bill.name} · ${bill.lines.length} รายการ`}
                        accessibilityLabel={`เรียกบิลพัก ${bill.name}`}
                        variant="secondary"
                        fullWidth
                        onPress={() => {
                          resumeParkedBill(bill.id);
                          setParkOpen(false);
                        }}
                      />
                      <Button
                        label="ลบบิลพัก"
                        accessibilityLabel={`ลบบิลพัก ${bill.name}`}
                        variant="danger"
                        fullWidth
                        onPress={() =>
                          Alert.alert('ยืนยันลบบิลพัก', bill.name, [
                            { text: 'ยกเลิก', style: 'cancel' },
                            {
                              text: 'ลบ',
                              style: 'destructive',
                              onPress: () => deleteParkedBill(bill.id),
                            },
                          ])
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
              <Button
                label="ปิด"
                variant="ghost"
                fullWidth
                style={{ marginTop: spacing.md }}
                onPress={() => setParkOpen(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  parkModal: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '84%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginVertical: 8,
  },
});
