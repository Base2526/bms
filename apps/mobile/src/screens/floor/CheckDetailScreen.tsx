import React from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { MenuGrid } from '../../components/MenuGrid';
import { QtyStepper } from '../../components/QtyStepper';
import { StatusPill, StatusTone } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useChecks } from '../../state/ChecksContext';
import { useKitchen } from '../../state/KitchenContext';
import { mockTables } from '../../mocks/floor';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'CheckDetail'>;

/** แผงบิลฝั่งขวาบนแท็บเล็ต — เหตุผลของเลข 320 เหมือนแผงตะกร้าของแท็บเมนู (ดู MenuScreen) */
const CHECK_PANEL_WIDTH = 320;

/**
 * ที่ที่แผงบิลกินจริง = ความกว้างแผง + padding ซ้าย/ขวาของกล่องที่ห่อมันอยู่
 *
 * ⚠️ ต่างจากแผงตะกร้าของแท็บเมนู ตรงที่นั่น `width` กับ `padding` อยู่บน View ตัวเดียวกัน
 * (RN เป็น border-box จึงรวมกันแล้วเท่ากับ 320 พอดี) แต่ที่นี่ padding อยู่บนกล่องชั้นนอก
 * ถ้าหักแค่ 320 กริดจะคิดคอลัมน์จากพื้นที่ที่กว้างกว่าของจริงราว 32pt
 */
const CHECK_PANEL_GUTTER = 16 * 2;

const LINE_STATUS_TONE: Record<string, StatusTone> = {
  NEW: 'warning',
  SENT: 'neutral',
  SERVED: 'success',
};

// หน้าบิลโต๊ะ — แท็บเล็ต: เมนูอยู่ฝั่งกว้าง สั่งได้เลยจากหน้านี้ · มือถือ: กด "สั่งอาหาร" ไปหน้าเมนูของโต๊ะ
// ⚠️ ปุ่ม "ส่งครัว"/"คิดเงิน" ยังเป็นของจำลอง — ส่งครัวแค่เปลี่ยนสถานะบรรทัด NEW เป็น SENT
// (กฎจริงของฝั่งเว็บ เช่น การจองสต็อกและตั๋วครัว ค่อยพอร์ตตอนต่อ backend)
export default function CheckDetailScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const { summaryFor, addItem, decrementItem, sendRound } = useChecks();
  const { enqueueRound } = useKitchen();

  const tableId = route.params.tableId;
  const table = mockTables.find(t => t.id === tableId);
  const { lines, amountDue, dishCount, hasUnsent } = summaryFor(tableId);

  const qtyBySku: Record<string, number> = {};
  for (const l of lines) if (l.status === 'NEW') qtyBySku[l.sku] = l.qty;

  const onSendRound = () => {
    const sent = sendRound(tableId);
    if (sent.length === 0) return;
    // ⚠️ ตั๋วครัวเกิดฝั่ง client ล้วน ๆ ในโครงนี้ — ของจริงต้องออกตั๋วในทรานแซกชันเดียวกับ
    // การจองสต็อก (enqueueKitchenTicketsInTx ของฝั่งเว็บ) ที่นี่ทำเพื่อให้รอบที่ส่งไป
    // ไปโผล่บนจอครัวจริง ๆ ไม่ใช่กดแล้วไม่มีอะไรขยับทั้งแอป
    const ticketCount = enqueueRound(
      table?.code ?? tableId,
      sent.map(line => ({ sku: line.sku, name: line.name, qty: line.qty })),
    );
    const dishes = sent.reduce((n, line) => n + line.qty, 0);
    Alert.alert(
      'ส่งครัวแล้ว',
      `ส่ง ${dishes} จาน (${ticketCount} ตั๋ว) เข้าครัวของโต๊ะ ${
        table?.code ?? ''
      }`,
    );
  };

  const linesList = (
    <FlatList
      data={lines}
      keyExtractor={(l, i) => `${l.sku}-${l.status}-${i}`}
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
          โต๊ะนี้ยังไม่มีรายการ —{' '}
          {isTablet ? 'แตะเมนูทางซ้ายเพื่อสั่ง' : 'กด “สั่งอาหาร” เพื่อเริ่ม'}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.row}>
            <Text
              style={[typography.body, { color: colors.text, flex: 1 }]}
              numberOfLines={2}
            >
              {item.name} × {item.qty}
            </Text>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ฿{(item.qty * item.unitPrice).toFixed(2)}
            </Text>
          </View>
          <View style={styles.row}>
            {/* แก้จำนวนได้เฉพาะบรรทัดที่ยังไม่ส่งครัว — ที่ส่งไปแล้วครัวอาจทำเสร็จแล้ว
                การแก้ต้องผ่านการยกเลิกที่จอครัว ไม่ใช่ลบเงียบ ๆ จากบิล */}
            {item.status === 'NEW' ? (
              <QtyStepper
                qty={item.qty}
                itemName={item.name}
                variant="outline"
                onIncrement={() =>
                  addItem(tableId, {
                    sku: item.sku,
                    name: item.name,
                    unitPrice: item.unitPrice,
                  })
                }
                onDecrement={() => decrementItem(tableId, item.sku)}
              />
            ) : (
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                แก้ที่จอครัว
              </Text>
            )}
            <StatusPill
              label={item.status}
              tone={LINE_STATUS_TONE[item.status]}
            />
          </View>
        </View>
      )}
    />
  );

  const actions = (
    <>
      <Button
        label={`ส่งครัว${hasUnsent ? '' : ' (ไม่มีรายการใหม่)'}`}
        fullWidth
        disabled={!hasUnsent}
        onPress={onSendRound}
      />
      <Button
        label="คิดเงิน"
        accessibilityLabel={`คิดเงินโต๊ะ ${table?.code ?? ''}`}
        fullWidth
        variant="secondary"
        style={{ marginTop: 8 }}
        disabled={hasUnsent || lines.length === 0}
        onPress={() =>
          navigation.getParent<any>()?.navigate('SellTab', {
            screen: 'Checkout',
            params: { source: 'restaurant', tableId },
          })
        }
      />
      {hasUnsent && (
        <Text
          style={[
            typography.caption,
            { color: colors.warning, marginTop: spacing.sm },
          ]}
        >
          มีรายการที่ยังไม่ส่งครัว — ส่งครัวก่อนถึงจะคิดเงินได้
        </Text>
      )}
    </>
  );

  const checkPanel = (
    <View
      style={{
        width: isTablet ? CHECK_PANEL_WIDTH : undefined,
        flex: isTablet ? undefined : 1,
      }}
    >
      <Card style={isTablet ? { maxHeight: '70%' } : { flex: 1 }}>
        <Text
          style={[
            typography.captionStrong,
            { color: colors.textMuted, marginBottom: spacing.sm },
          ]}
        >
          รายการในบิล ({dishCount})
        </Text>
        {linesList}
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <View style={[styles.row, { marginBottom: spacing.md }]}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ยอดปัจจุบัน
          </Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{amountDue.toFixed(2)}
          </Text>
        </View>
        {actions}
      </View>
    </View>
  );

  return (
    <ScreenContainer padded={!isTablet}>
      <View
        style={
          isTablet
            ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
            : undefined
        }
      >
        <ScreenHeader
          title={`โต๊ะ ${table?.code ?? '-'}`}
          subtitle={`${
            table?.seats ?? 0
          } ที่นั่ง · ${dishCount} จาน · ฿${amountDue.toFixed(2)}`}
          onBack={() => navigation.goBack()}
        />
      </View>

      {isTablet ? (
        // แท็บเล็ต: สั่งอาหารได้จากหน้าบิลเลย ไม่ต้องเด้งไปอีกหน้า — เมนูฝั่งกว้าง บิลฝั่งขวา
        // (รูปเดียวกับจอสั่งอาหารของ /pos/restaurant บนเว็บ)
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <MenuGrid
            qtyBySku={qtyBySku}
            onAdd={item =>
              addItem(tableId, {
                sku: item.sku,
                name: item.name,
                unitPrice: item.price,
              })
            }
            onDecrement={sku => decrementItem(tableId, sku)}
            areaWidth={width - CHECK_PANEL_WIDTH - CHECK_PANEL_GUTTER}
            artHeight={116}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: colors.border,
              padding: spacing.lg,
            }}
          >
            {checkPanel}
          </View>
        </View>
      ) : (
        <>
          {checkPanel}
          <Button
            label="สั่งอาหาร"
            fullWidth
            style={{ marginTop: 8 }}
            onPress={() => navigation.navigate('TableMenu', { tableId })}
          />
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
