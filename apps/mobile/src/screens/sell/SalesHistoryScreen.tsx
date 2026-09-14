import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { SearchField } from '../../components/SearchField';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useSales } from '../../state/SalesContext';
import type { SaleSnapshot } from '../../state/SalesContext';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'SalesHistory'>;

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
        />
        <View style={[isTablet ? styles.tabletToolbar : styles.phoneToolbar]}>
          <View style={{ flex: 1 }}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="ค้นหาเลขใบเสร็จ ลูกค้า สมาชิก SKU หรือ barcode"
            />
          </View>
          <View
            style={[
              styles.summaryPanel,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {filtered.length} ใบ
            </Text>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ฿{todayTotal.toFixed(2)}
            </Text>
          </View>
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
          contentContainerStyle={{
            gap: spacing.sm,
            paddingTop: spacing.md,
            paddingBottom: spacing.lg,
          }}
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
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`เปิดรายละเอียดใบเสร็จ ${item.receiptNo}`}
              onPress={() => openSale(item)}
              style={({ pressed }) => [
                styles.saleRow,
                {
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  backgroundColor: pressed ? colors.surface2 : colors.surface,
                  padding: isTablet ? spacing.md : spacing.lg,
                },
              ]}
            >
              <View style={styles.saleMain}>
                <View style={styles.receiptLine}>
                  <Text
                    style={[typography.bodyStrong, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {shortReceipt(item.receiptNo)}
                  </Text>
                  {item.voided ? (
                    <StatusPill label="Void" tone="danger" />
                  ) : item.returns.length > 0 ? (
                    <StatusPill label="คืนสินค้า" tone="warning" />
                  ) : (
                    <StatusPill label="ขายแล้ว" tone="success" />
                  )}
                </View>
                <Text
                  style={[typography.caption, { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {formatSaleTime(item.createdAt)} ·{' '}
                  {item.source === 'restaurant'
                    ? item.restaurantServiceMode === 'TAKEAWAY'
                      ? 'กลับบ้าน'
                      : item.tableCode
                        ? `โต๊ะ ${item.tableCode}`
                        : 'กินในร้าน'
                    : (item.member?.name ?? 'ลูกค้าทั่วไป')}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSoft }]}
                  numberOfLines={1}
                >
                  {item.lines
                    .slice(0, 3)
                    .map(line => `${line.name} ×${line.qty}`)
                    .join(' · ') || 'ไม่มีรายการสินค้า'}
                </Text>
              </View>
              <View style={styles.saleAside}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  ฿{item.total.toFixed(2)}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {item.lines.reduce((sum, line) => sum + line.qty, 0)} รายการ
                </Text>
                <Button
                  label="เปิด"
                  accessibilityLabel={`เปิดใบเสร็จ ${item.receiptNo}`}
                  variant="secondary"
                  onPress={() => openSale(item)}
                  style={{ marginTop: spacing.sm, minHeight: 38 }}
                />
              </View>
            </Pressable>
          )}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabletToolbar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  phoneToolbar: {
    gap: 12,
  },
  summaryPanel: {
    minWidth: 132,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  saleRow: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  saleMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  receiptLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saleAside: {
    alignItems: 'flex-end',
    minWidth: 126,
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
