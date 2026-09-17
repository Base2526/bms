import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SearchField } from '../../components/SearchField';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useSales } from '../../state/SalesContext';
import type { SaleSnapshot } from '../../state/SalesContext';
import type { AppStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'SalesHistory'>;

function formatSaleTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortReceipt(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function saleCustomerLabel(sale: SaleSnapshot): string {
  if (sale.source !== 'restaurant') {
    return sale.member?.name ?? 'ลูกค้าทั่วไป';
  }
  if (sale.restaurantServiceMode === 'TAKEAWAY') return 'กลับบ้าน';
  return sale.tableCode ? `โต๊ะ ${sale.tableCode}` : 'กินในร้าน';
}

function saleItemCount(sale: SaleSnapshot): number {
  return sale.lines.reduce((sum, line) => sum + line.qty, 0);
}

function saleProductSummary(sale: SaleSnapshot, limit: number): string {
  if (sale.lines.length === 0) return 'ไม่มีรายการสินค้า';
  const visible = sale.lines
    .slice(0, limit)
    .map(line => `${line.name} ×${line.qty}`)
    .join(' · ');
  const hidden = sale.lines.length - limit;
  return hidden > 0 ? `${visible} · +${hidden} รายการ` : visible;
}

function SaleStatus({ sale }: { sale: SaleSnapshot }) {
  if (sale.voided) return <StatusPill label="Void" tone="danger" />;
  if (sale.returns.length > 0) {
    return <StatusPill label="คืนสินค้า" tone="warning" />;
  }
  return <StatusPill label="ขายแล้ว" tone="success" />;
}

function ReceiptMetricIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={3}
        width={14}
        height={18}
        rx={2}
        stroke={color}
        strokeWidth={2}
      />
      <Line x1={8} y1={8} x2={16} y2={8} stroke={color} strokeWidth={2} />
      <Line x1={8} y1={12} x2={16} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={8} y1={16} x2={13} y2={16} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function TotalMetricIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 20V11M12 20V4M19 20V8"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function SalesHistoryScreen({ navigation }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const { isTablet } = useResponsive();
  const { sales, loading, error, refresh } = useSales();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(sale => {
      const haystack = [
        sale.receiptNo,
        sale.member?.name,
        sale.member?.memberNo,
        sale.tableCode,
        ...sale.lines.flatMap(line => [line.sku, line.name]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, sales]);

  const todayTotal = useMemo(
    () => filtered.reduce((sum, sale) => sum + sale.total, 0),
    [filtered],
  );

  const openSale = (sale: SaleSnapshot) => {
    navigation.navigate('SaleDetail', { saleId: sale.id });
  };

  return (
    <ScreenContainer padded={false}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <ScreenHeader
          title="ประวัติการขาย"
          subtitle="ใบเสร็จล่าสุดจากเซิร์ฟเวอร์"
          onBack={() => navigation.goBack()}
          roundBackButton={!isTablet}
        />
        <View style={[isTablet ? styles.tabletToolbar : styles.phoneToolbar]}>
          <View
            style={[
              styles.searchArea,
              isTablet && [
                styles.tabletSearchCard,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  padding: spacing.md,
                },
              ],
            ]}
          >
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="ค้นหาเลขใบเสร็จ ลูกค้า สมาชิก SKU หรือบาร์โค้ด"
              showSearchIcon
              soft={isTablet}
            />
          </View>
          {isTablet ? (
            <>
              <View
                style={[
                  styles.tabletMetricCard,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    paddingHorizontal: spacing.md,
                  },
                ]}
              >
                <View
                  style={[
                    styles.metricIcon,
                    { backgroundColor: `${colors.primary}14` },
                  ]}
                >
                  <ReceiptMetricIcon color={colors.primary} />
                </View>
                <View style={styles.metricCopy}>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    {filtered.length}
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ใบเสร็จ
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.tabletMetricCard,
                  styles.tabletTotalCard,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    paddingHorizontal: spacing.md,
                  },
                ]}
              >
                <View
                  style={[
                    styles.metricIcon,
                    { backgroundColor: `${colors.primary}14` },
                  ]}
                >
                  <TotalMetricIcon color={colors.primary} />
                </View>
                <View style={styles.metricCopy}>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ยอดรวม
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    ฿{formatAmount(todayTotal)}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <View
              style={[
                styles.phoneSummaryPanel,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                },
              ]}
            >
              <View style={styles.phoneMetric}>
                <Text style={[styles.phoneMetricValue, { color: colors.text }]}>
                  {filtered.length}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  ใบเสร็จ
                </Text>
              </View>
              <View
                style={[
                  styles.phoneMetricDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <View style={styles.phoneTotalMetric}>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  ยอดรวม
                </Text>
                <Text style={[styles.phoneTotalValue, { color: colors.text }]}>
                  ฿{formatAmount(todayTotal)}
                </Text>
              </View>
            </View>
          )}
        </View>
        {error ? (
          <Pressable
            onPress={() => refresh().catch(() => undefined)}
            style={{ marginTop: spacing.sm }}
          >
            <Text style={[typography.captionStrong, { color: colors.danger }]}>
              {error} · แตะเพื่อลองใหม่
            </Text>
          </Pressable>
        ) : loading ? (
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, marginTop: spacing.sm },
            ]}
          >
            กำลังโหลดประวัติการขาย…
          </Text>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={sale => sale.id}
          style={[
            styles.list,
            isTablet && {
              borderColor: colors.border,
              borderRadius: radius.lg,
              backgroundColor: colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              marginTop: spacing.md,
            },
          ]}
          contentContainerStyle={[
            isTablet ? styles.tabletListContent : styles.phoneListContent,
            { paddingBottom: spacing.lg },
          ]}
          ListHeaderComponent={
            isTablet && filtered.length > 0 ? (
              <View
                style={[
                  styles.tabletHeaderRow,
                  {
                    backgroundColor: colors.surface2,
                    borderBottomColor: colors.border,
                    paddingHorizontal: spacing.lg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabletReceiptCell,
                    typography.captionStrong,
                    { color: colors.textMuted },
                  ]}
                >
                  ใบเสร็จ
                </Text>
                <Text
                  style={[
                    styles.tabletCustomerCell,
                    typography.captionStrong,
                    { color: colors.textMuted },
                  ]}
                >
                  วันที่ / ลูกค้า
                </Text>
                <Text
                  style={[
                    styles.tabletProductsCell,
                    typography.captionStrong,
                    { color: colors.textMuted },
                  ]}
                >
                  รายการสินค้า
                </Text>
                <Text
                  style={[
                    styles.tabletTotalCell,
                    typography.captionStrong,
                    { color: colors.textMuted },
                  ]}
                >
                  ยอดรวม
                </Text>
                <Text
                  style={[
                    styles.tabletStatusCell,
                    typography.captionStrong,
                    { color: colors.textMuted },
                  ]}
                >
                  สถานะ
                </Text>
                <View style={styles.tabletChevronCell} />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <View
              style={[
                styles.empty,
                {
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ไม่พบประวัติการขาย
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ลองเปลี่ยนคำค้นหรือรีเฟรชรายการล่าสุด
              </Text>
            </View>
          }
          renderItem={({ item }) =>
            isTablet ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`เปิดรายละเอียดใบเสร็จ ${item.receiptNo}`}
                onPress={() => openSale(item)}
                style={({ pressed }) => [
                  styles.tabletSaleRow,
                  {
                    backgroundColor: pressed ? colors.surface2 : colors.surface,
                    borderBottomColor: colors.border,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                  },
                ]}
              >
                <View style={styles.tabletReceiptCell}>
                  <Text
                    style={[typography.bodyStrong, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {shortReceipt(item.receiptNo)}
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {saleItemCount(item)} รายการ
                  </Text>
                </View>
                <View style={styles.tabletCustomerCell}>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {formatSaleTime(item.createdAt)}
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {saleCustomerLabel(item)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.tabletProductsCell,
                    typography.caption,
                    { color: colors.textSoft },
                  ]}
                  numberOfLines={2}
                >
                  {saleProductSummary(item, 2)}
                </Text>
                <Text
                  style={[
                    styles.tabletTotalCell,
                    typography.bodyStrong,
                    { color: colors.text },
                  ]}
                  numberOfLines={1}
                >
                  ฿{formatAmount(item.total)}
                </Text>
                <View style={styles.tabletStatusCell}>
                  <SaleStatus sale={item} />
                </View>
                <Text
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[
                    styles.tabletChevronCell,
                    styles.chevron,
                    { color: colors.textMuted },
                  ]}
                >
                  ›
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`เปิดรายละเอียดใบเสร็จ ${item.receiptNo}`}
                onPress={() => openSale(item)}
                style={({ pressed }) => [
                  styles.phoneSaleRow,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    backgroundColor: pressed ? colors.surface2 : colors.surface,
                    padding: spacing.lg,
                  },
                ]}
              >
                <View style={styles.receiptLine}>
                  <Text
                    style={[
                      styles.phoneReceipt,
                      typography.bodyStrong,
                      { color: colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {shortReceipt(item.receiptNo)}
                  </Text>
                  <SaleStatus sale={item} />
                  <Text
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[styles.chevron, { color: colors.textMuted }]}
                  >
                    ›
                  </Text>
                </View>
                <Text
                  style={[typography.caption, { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {formatSaleTime(item.createdAt)} · {saleCustomerLabel(item)}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSoft }]}
                  numberOfLines={1}
                >
                  {saleProductSummary(item, 3)}
                </Text>
                <View style={styles.phoneSaleAside}>
                  <Text style={[typography.subtitle, { color: colors.text }]}>
                    ฿{formatAmount(item.total)}
                  </Text>
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {saleItemCount(item)} รายการ
                  </Text>
                </View>
              </Pressable>
            )
          }
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabletToolbar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  phoneToolbar: {
    gap: 12,
    // Thai glyphs can extend below their reported line box when Dynamic Type
    // is enabled. Keep the phone toolbar clear of the header subtitle.
    marginTop: 12,
  },
  searchArea: {
    flex: 1,
  },
  tabletSearchCard: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  tabletMetricCard: {
    width: 168,
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tabletTotalCard: {
    width: 214,
  },
  metricIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
  phoneSummaryPanel: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phoneMetric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  phoneMetricValue: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    fontVariant: ['tabular-nums'],
  },
  phoneMetricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 44,
    marginHorizontal: 12,
  },
  phoneTotalMetric: {
    flex: 1.2,
    alignItems: 'flex-end',
    gap: 2,
  },
  phoneTotalValue: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    fontVariant: ['tabular-nums'],
  },
  list: {
    flex: 1,
  },
  tabletListContent: {
    flexGrow: 1,
  },
  phoneListContent: {
    gap: 12,
    paddingTop: 16,
  },
  tabletHeaderRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabletSaleRow: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  phoneSaleRow: {
    minHeight: 124,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  tabletReceiptCell: {
    flex: 1.15,
    minWidth: 0,
    paddingRight: 16,
  },
  tabletCustomerCell: {
    flex: 1.2,
    minWidth: 0,
    paddingRight: 16,
  },
  tabletProductsCell: {
    flex: 2.2,
    minWidth: 0,
    paddingRight: 16,
  },
  tabletTotalCell: {
    width: 136,
    paddingRight: 16,
    textAlign: 'right',
  },
  tabletStatusCell: {
    width: 104,
    alignItems: 'center',
  },
  tabletChevronCell: {
    width: 28,
    textAlign: 'right',
  },
  receiptLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneReceipt: {
    flexShrink: 1,
    maxWidth: '62%',
    minWidth: 0,
  },
  phoneSaleAside: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  chevron: {
    fontSize: 28,
    lineHeight: 28,
    marginLeft: 'auto',
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
