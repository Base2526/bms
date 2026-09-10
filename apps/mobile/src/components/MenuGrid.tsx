import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { DishArt } from './DishArt';
import { QtyStepper } from './QtyStepper';
import { SearchField } from './SearchField';
import { useTheme } from '../theme/ThemeProvider';
import { columnsForWidth, padGrid } from '../theme/useResponsive';
import {
  mockCategories,
  mockMenuItems,
  mockMenuStations,
  MockMenuItem,
} from '../mocks/menu';

interface Props {
  /** จำนวนที่อยู่ในตะกร้า/บิลแล้ว ต่อ SKU — ใช้แสดงปุ่มเพิ่ม/ลดบนการ์ด */
  qtyBySku: Record<string, number>;
  onAdd: (item: MockMenuItem) => void;
  onDecrement: (sku: string) => void;
  /** ความกว้างของพื้นที่กริดจริง (หักแผงข้างออกแล้ว) — ใช้คำนวณจำนวนคอลัมน์ */
  areaWidth: number;
  artHeight?: number;
  /** แถวข้อความ/ปุ่มที่วางเหนือช่องค้นหา เช่น ป้ายบอกว่ากำลังสั่งให้โต๊ะไหน */
  header?: React.ReactNode;
}

// กริดเมนู + ช่องค้นหา + ชิปหมวดหมู่ — ใช้ร่วมกันสองที่: แท็บ "เมนูอาหาร" (ขายกลับบ้าน)
// และการสั่งอาหารให้โต๊ะจากผังโต๊ะ · สองที่นี้ต่างกันแค่ "รายการที่เพิ่มเข้าไปไหน" เท่านั้น
// ถ้าก็อปกริดไปสองชุด วันหนึ่งเมนูจะแสดงไม่เหมือนกันระหว่างสองทางเข้า
export function MenuGrid({
  qtyBySku,
  onAdd,
  onDecrement,
  areaWidth,
  artHeight = 96,
  header,
}: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const [category, setCategory] = useState(mockCategories[0]);
  const [query, setQuery] = useState('');

  const trimmed = query.trim();

  // มีคำค้น = ค้นทั้งเมนู ไม่สนหมวดที่เลือกอยู่ — พิมพ์ "ชา" ตอนยืนอยู่หมวดอาหารจานหลัก
  // แล้วได้ผลลัพธ์ว่าง คือคำตอบที่ผิดสำหรับคนที่กำลังรีบหาเมนูให้ลูกค้า
  const items = useMemo(() => {
    if (trimmed) {
      const needle = trimmed.toLowerCase();
      return mockMenuItems.filter(
        m =>
          m.name.toLowerCase().includes(needle) ||
          m.sku.toLowerCase().includes(needle),
      );
    }
    return mockMenuItems.filter(
      m => category === mockCategories[0] || m.category === category,
    );
  }, [category, trimmed]);

  const gridColumns = columnsForWidth(areaWidth);

  const renderCard = (item: MockMenuItem) => {
    const inCart = qtyBySku[item.sku] ?? 0;
    const tintIndex = mockMenuStations.indexOf(item.station);

    return (
      <Pressable
        style={{ flex: 1, alignSelf: 'stretch' }}
        disabled={!item.sellable}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} ${item.price.toFixed(2)} บาท`}
        onPress={() => onAdd(item)}
      >
        <View
          style={[
            styles.card,
            {
              flex: 1,
              borderColor: colors.border,
              borderRadius: radius.lg,
              backgroundColor: item.sellable ? colors.surface : colors.surface2,
            },
          ]}
        >
          <DishArt
            name={item.name}
            tintIndex={tintIndex}
            imageUrl={item.imageUrl}
            height={artHeight}
            muted={!item.sellable}
          />

          {!item.sellable && (
            <View
              style={[
                styles.outChip,
                { backgroundColor: colors.danger, borderRadius: radius.sm },
              ]}
            >
              <Text
                style={[
                  typography.captionStrong,
                  { color: colors.primaryText },
                ]}
              >
                หมดวันนี้
              </Text>
            </View>
          )}

          {/* อยู่ในตะกร้าแล้ว = แสดงปุ่มเพิ่ม/ลด ไม่ใช่แค่ตัวเลข — กดเพิ่มได้อย่างเดียวแล้วลดไม่ได้
              คือสิ่งที่ผิดกับจังหวะจริงตอนลูกค้าเปลี่ยนใจหน้าเคาน์เตอร์ */}
          {inCart > 0 && (
            <View style={styles.stepperSlot}>
              <QtyStepper
                qty={inCart}
                itemName={item.name}
                onIncrement={() => onAdd(item)}
                onDecrement={() => onDecrement(item.sku)}
              />
            </View>
          )}

          {/* ช่องข้อความมีพื้นของตัวเอง + เส้นคั่น 1px — ไม่งั้นรูปกับข้อความกลืนเป็นผืนเดียว
              ตอนสีพื้นรูปเป็นสถานีกลาง (บทเรียนจากกริดเมนูของเว็บ) */}
          <View
            style={[
              styles.body,
              {
                backgroundColor: colors.surface2,
                borderTopColor: colors.border,
                padding: spacing.md,
              },
            ]}
          >
            <Text
              numberOfLines={item.sellable ? 2 : 1}
              style={[
                typography.bodyStrong,
                {
                  color: item.sellable ? colors.text : colors.textMuted,
                  minHeight: item.sellable ? 41 : 20,
                  marginBottom: 4,
                },
              ]}
            >
              {item.name}
            </Text>

            {!item.sellable && (
              <Text
                numberOfLines={1}
                style={[
                  typography.caption,
                  { color: colors.textSoft, marginBottom: 2 },
                ]}
              >
                {item.unavailableNote ?? 'ขายไม่ได้ตอนนี้'}
              </Text>
            )}

            {/* ราคาเป็นตัวเลขที่ใหญ่ที่สุดบนการ์ด — เป็นสิ่งที่คนกดตัดสินใจเร็วที่สุด */}
            <Text
              style={[
                styles.price,
                { color: item.sellable ? colors.text : colors.textMuted },
              ]}
            >
              ฿{item.price.toFixed(2)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg, paddingBottom: 0, gap: spacing.md }}>
        {header}

        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="ค้นหาเมนู หรือรหัสสินค้า"
        />

        {trimmed ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            ผลค้นหา “{trimmed}” · {items.length} เมนู (ค้นทุกหมวด)
          </Text>
        ) : (
          <FlatList
            horizontal
            data={mockCategories}
            keyExtractor={c => c}
            showsHorizontalScrollIndicator={false}
            ItemSeparatorComponent={() => (
              <View style={{ width: spacing.sm }} />
            )}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setCategory(item)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.pill,
                  backgroundColor:
                    category === item ? colors.primary : colors.surface2,
                }}
              >
                <Text
                  style={[
                    typography.body,
                    {
                      color:
                        category === item ? colors.primaryText : colors.text,
                    },
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>

      <FlatList
        // key เปลี่ยนตามจำนวนคอลัมน์ — FlatList ของ RN ไม่ยอมให้ numColumns เปลี่ยนสดโดยไม่ remount
        key={`menu-grid-${gridColumns}`}
        data={padGrid(items, gridColumns)}
        keyExtractor={(m, i) => m?.sku ?? `filler-${i}`}
        numColumns={gridColumns}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        columnWrapperStyle={{ gap: spacing.md, alignItems: 'stretch' }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item ? renderCard(item) : <View style={{ flex: 1 }} />
        }
        ListEmptyComponent={
          <View
            style={{
              paddingVertical: spacing.xl,
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <Text style={[typography.body, { color: colors.textMuted }]}>
              ไม่พบเมนูที่ตรงกับ “{trimmed}”
            </Text>
            <Button
              label="ล้างคำค้น"
              variant="secondary"
              onPress={() => setQuery('')}
            />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  body: { borderTopWidth: StyleSheet.hairlineWidth },
  price: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  outChip: {
    position: 'absolute',
    top: 7,
    left: 7,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stepperSlot: { position: 'absolute', top: 7, right: 7 },
});
