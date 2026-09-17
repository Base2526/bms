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
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { MenuGrid } from '../../components/MenuGrid';
import { QtyStepper } from '../../components/QtyStepper';
import { BarcodeScannerModal } from '../../components/BarcodeScannerModal';
import { OrderAlertBanner } from '../../components/OrderAlertBanner';
import { ProductOptionsModal } from '../../components/ProductOptionsModal';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { cartLineVariantLabel } from '../../lib/cartLine';
import { useCart } from '../../state/CartContext';
import { useCatalog } from '../../state/CatalogContext';
import { useStoreMode } from '../../state/StoreModeContext';
import type { SellStackParamList } from '../../navigation/types';
import {
  getAppNavigation,
  getTabNavigation,
} from '../../navigation/parentNavigation';
import type { PosMenuItem } from '../../types/pos';

type Props = NativeStackScreenProps<SellStackParamList, 'Menu'>;

type MenuActionKind = 'scan' | 'history';

function MenuActionGlyph({
  kind,
  color,
}: {
  kind: MenuActionKind;
  color: string;
}) {
  if (kind === 'scan') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Line x1={8} y1={8} x2={8} y2={16} stroke={color} strokeWidth={2} />
        <Line x1={11} y1={8} x2={11} y2={16} stroke={color} strokeWidth={1.5} />
        <Line x1={14} y1={8} x2={14} y2={16} stroke={color} strokeWidth={2} />
        <Line x1={17} y1={8} x2={17} y2={16} stroke={color} strokeWidth={1.5} />
      </Svg>
    );
  }

  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} />
      <Line
        x1={12}
        y1={7}
        x2={12}
        y2={12.5}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={12.5}
        x2={15.5}
        y2={14.5}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function MenuActionButton({
  kind,
  label,
  onPress,
}: {
  kind: MenuActionKind;
  label: string;
  onPress: () => void;
}) {
  const { colors, radius, minTouchTarget } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: minTouchTarget,
          height: minTouchTarget,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surface3 : colors.surface2,
        },
      ]}
    >
      <MenuActionGlyph kind={kind} color={colors.text} />
    </Pressable>
  );
}

function EmptyCartGlyph({ color }: { color: string }) {
  return (
    <Svg width={56} height={56} viewBox="0 0 56 56" fill="none">
      <Path
        d="M10 13h6l4.2 22.5h23.1l4.2-16.5H18"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={24} cy={43} r={2.8} fill={color} />
      <Circle cx={40} cy={43} r={2.8} fill={color} />
    </Svg>
  );
}

/** ความกว้างแผงตะกร้าบนแท็บเล็ต
 *  320 ไม่ใช่เลขสวย ๆ — วัดจากจอจริง: ไอแพดแนวตั้ง 1024pt ถ้าแผงกว้าง 360 จะเหลือที่ให้กริด 664
 *  ซึ่งตกเกณฑ์ 700 แล้วกริดหล่นเหลือ 2 คอลัมน์ (การ์ดใหญ่เกินจำเป็น เห็นเมนูได้น้อยลงกว่าเดิม)
 *  ที่ 320 เหลือ 704 → 3 คอลัมน์ และแผงยังกว้างพอให้ชื่อเมนูไทยอ่านจบคู่กับปุ่มเพิ่ม/ลด */
export const CART_PANEL_WIDTH = 320;

// แท็บ "เมนูอาหาร" = ขายที่ไม่ผูกโต๊ะ (กลับบ้าน/สั่งที่เคาน์เตอร์)
// การสั่งให้โต๊ะอยู่ที่แท็บ "ผังโต๊ะ" และเขียนเข้า restaurant check บน server
export default function MenuScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const {
    lines,
    addItem,
    decrementItem,
    decrementSku,
    total,
    parkedBills,
    parkCurrentBill,
    resumeParkedBill,
    deleteParkedBill,
  } = useCart();
  const { mode } = useStoreMode();
  const {
    catalog,
    loading: catalogLoading,
    error: catalogError,
    refetch,
    resolveScan,
    resolveVariant,
    setSearchQuery,
  } = useCatalog();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkName, setParkName] = useState('');
  const [parkNote, setParkNote] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [configuring, setConfiguring] = useState<PosMenuItem | null>(null);

  const screenTitle =
    mode === 'restaurant'
      ? 'เมนูอาหาร'
      : mode === 'pharmacy'
      ? 'ขายยาและสินค้า'
      : 'ขายสินค้า';

  // การ์ดใบเดียวแทนทุกไซซ์/หน่วยขายของ sku นั้น เลขบนการ์ดจึงต้องเป็น "ผลรวมของทุกบรรทัด"
  // ⚠️ เดิมเขียนทับด้วยบรรทัดสุดท้าย: ตะกร้ามี S/M/L อย่างละ 1 แล้วการ์ดโชว์ 1 ทั้งที่มี 3
  const qtyBySku = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.sku] = (map[l.sku] ?? 0) + l.qty;
    return map;
  }, [lines]);

  const cartCount = lines.reduce((n, l) => n + l.qty, 0);

  const grid = (
    <MenuGrid
      qtyBySku={qtyBySku}
      onAdd={setConfiguring}
      onDecrement={sku => decrementSku(sku)}
      areaWidth={isTablet ? width - CART_PANEL_WIDTH : width}
      artHeight={isTablet ? 116 : 88}
      compact={!isTablet}
      catalog={catalog}
      onSearchChange={mode === 'restaurant' ? undefined : setSearchQuery}
      header={
        <>
          <OrderAlertBanner
            onOpenQueue={() =>
              getTabNavigation(navigation).navigate('OrdersTab')
            }
          />
          <View style={styles.menuHeader}>
            <View style={{ flex: 1 }}>
              <Text
                style={[typography.title, { color: colors.text }]}
                numberOfLines={1}
              >
                {screenTitle}
              </Text>
              {catalogLoading ? (
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  กำลังโหลดรายการจากเซิร์ฟเวอร์…
                </Text>
              ) : catalogError ? (
                <Pressable onPress={() => refetch().catch(() => undefined)}>
                  <Text style={[typography.caption, { color: colors.danger }]}>
                    {catalogError} · แตะเพื่อลองใหม่
                  </Text>
                </Pressable>
              ) : null}
              {lastScanned ? (
                <Text
                  style={[typography.captionStrong, { color: colors.success }]}
                >
                  เพิ่มจากบาร์โค้ดแล้ว · {lastScanned}
                </Text>
              ) : null}
            </View>
            {isTablet ? (
              <>
                <Button
                  label="▥ สแกนบาร์โค้ด"
                  accessibilityLabel="เปิดหน้าต่างสแกนบาร์โค้ด"
                  variant="secondary"
                  onPress={() => setScannerOpen(true)}
                />
                <Button
                  label="ประวัติ"
                  accessibilityLabel="เปิดประวัติการขายล่าสุด"
                  variant="secondary"
                  onPress={() =>
                    getAppNavigation(navigation).navigate('SalesHistory')
                  }
                />
              </>
            ) : (
              <View style={styles.menuActions}>
                <MenuActionButton
                  kind="scan"
                  label="เปิดหน้าต่างสแกนบาร์โค้ด"
                  onPress={() => setScannerOpen(true)}
                />
                <MenuActionButton
                  kind="history"
                  label="เปิดประวัติการขายล่าสุด"
                  onPress={() =>
                    getAppNavigation(navigation).navigate('SalesHistory')
                  }
                />
              </View>
            )}
          </View>
        </>
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
        keyExtractor={l => l.key}
        contentContainerStyle={
          lines.length === 0 ? styles.emptyCartContent : undefined
        }
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
          <View style={styles.emptyCartState}>
            <EmptyCartGlyph color={colors.textSoft} />
            <Text style={[typography.bodyStrong, { color: colors.textMuted }]}>
              ยังไม่มีรายการ
            </Text>
            <Text
              style={[typography.caption, { color: colors.textSoft }]}
              numberOfLines={2}
            >
              เพิ่มสินค้าลงในตะกร้าเพื่อเริ่มขาย
            </Text>
          </View>
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
              <View style={{ flex: 1 }}>
                <Text
                  style={[typography.body, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                {/* บรรทัดที่เขียนแต่ชื่อสินค้าเหมือนกันหลายบรรทัด = อ่านแล้วไม่รู้ว่ากดผิดหรือเปล่า */}
                {cartLineVariantLabel(item) ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                    numberOfLines={2}
                  >
                    {cartLineVariantLabel(item)}
                  </Text>
                ) : null}
              </View>
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
                  addItem({
                    sku: item.sku,
                    name: item.name,
                    price: item.unitPrice,
                    // ราคาป้าย/ขั้นราคาส่ง/โปร ต้องเดินทางไปกับปุ่ม + ด้วย ไม่งั้นบรรทัดที่ถูก
                    // สร้างใหม่จากปุ่มนี้จะไม่มี snapshot แล้วยอดเพี้ยนจากที่ server คิด
                    basePrice: item.basePrice,
                    packBasePrice: item.packBasePrice,
                    modifierUnitPrice: item.modifierUnitPrice,
                    priceTiers: item.priceTiers,
                    promotion: item.promotion,
                    category: 'สินค้า',
                    station: 'สินค้า',
                    sellable: true,
                    imageUrl: item.imageUrl,
                    size: item.size,
                    packCode: item.packCode,
                    unitName: item.unitName,
                    baseQty: item.baseQty,
                    selectedModifierCodes: item.modifierCodes,
                  })
                }
                onDecrement={() => decrementItem(item.key)}
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
          onPress={() =>
            getAppNavigation(navigation).navigate('Checkout', {
              source: 'retail',
            })
          }
        />
        <Button
          label={`บิลพัก${
            parkedBills.length ? ` (${parkedBills.length})` : ''
          }`}
          accessibilityLabel="เปิดบิลพักหรือพักตะกร้าปัจจุบัน"
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
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`เปิดบิลพักหรือพักตะกร้าปัจจุบัน · ${cartCount} รายการ · ${total.toFixed(
                2,
              )} บาท`}
              disabled={cartCount === 0 && parkedBills.length === 0}
              hitSlop={8}
              onPress={() => setParkOpen(true)}
            >
              <Text
                style={[typography.subtitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {cartCount} รายการ · ฿{total.toFixed(2)}
              </Text>
            </Pressable>
            <Button
              label="ชำระเงิน"
              accessibilityLabel="ไปหน้าชำระเงินตะกร้าปัจจุบัน"
              disabled={cartCount === 0}
              onPress={() =>
                getAppNavigation(navigation).navigate('Checkout', {
                  source: 'retail',
                })
              }
            />
          </View>
        </>
      )}
      <BarcodeScannerModal
        visible={scannerOpen}
        resolveCode={resolveScan}
        onCancel={() => setScannerOpen(false)}
        onScanned={item => {
          setConfiguring(item);
          setLastScanned(item.name);
          setScannerOpen(false);
        }}
      />
      <ProductOptionsModal
        item={configuring}
        restaurant={mode === 'restaurant'}
        resolveVariant={resolveVariant}
        onClose={() => setConfiguring(null)}
        onConfirm={({ item, modifierCodes }) => {
          addItem({ ...item, selectedModifierCodes: modifierCodes });
          setConfiguring(null);
        }}
      />
      <Modal
        transparent
        visible={parkOpen}
        animationType="fade"
        onRequestClose={() => setParkOpen(false)}
      >
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
                พักบิล
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                เก็บบนเซิร์ฟเวอร์และเรียกต่อได้จากเครื่องขายที่ได้รับสิทธิ์
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
                    accessibilityLabel="ยืนยันพักบิล"
                    fullWidth
                    onPress={async () => {
                      const failure = await parkCurrentBill(parkName, parkNote);
                      if (failure) {
                        Alert.alert('พักบิลไม่สำเร็จ', failure);
                        return;
                      }
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
                        label={`${bill.name} · ${bill.lines.length} รายการ${
                          bill.pharmacyReview
                            ? ` · เคส ${bill.pharmacyReview.caseCode} ${
                                bill.pharmacyReview.canResume
                                  ? 'อนุมัติแล้ว'
                                  : bill.pharmacyReview.status ?? 'รอตรวจ'
                              }`
                            : ''
                        }`}
                        accessibilityLabel={`เรียกบิลพัก ${bill.name}`}
                        variant="secondary"
                        fullWidth
                        disabled={
                          Boolean(bill.pharmacyReview) &&
                          !bill.pharmacyReview?.canResume
                        }
                        onPress={async () => {
                          const failure = await resumeParkedBill(bill.id);
                          if (failure)
                            Alert.alert('เรียกบิลไม่สำเร็จ', failure);
                          else setParkOpen(false);
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
                              onPress: () => {
                                deleteParkedBill(bill.id).then(failure => {
                                  if (failure)
                                    Alert.alert('ลบบิลไม่สำเร็จ', failure);
                                });
                              },
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
  menuActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyCartContent: { flexGrow: 1, justifyContent: 'center' },
  emptyCartState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
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
