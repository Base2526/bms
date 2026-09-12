import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { SearchField } from '../../components/SearchField';
import { StatusPill } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { useSales } from '../../state/SalesContext';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'SalesHistory'>;

export default function SalesHistoryScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { sales } = useSales();
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

  return (
    <ScreenContainer>
      <ScreenHeader
        title="ประวัติการขาย"
        subtitle="ค้นหาใบเสร็จ ลูกค้า สมาชิก หรือ SKU จากข้อมูลบนเซิร์ฟเวอร์"
        onBack={() => navigation.goBack()}
      />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="ค้นหาเลขใบเสร็จ ลูกค้า สมาชิก SKU หรือ barcode"
      />
      <FlatList
        data={filtered}
        keyExtractor={sale => sale.id}
        contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.md }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ไม่พบประวัติการขาย
          </Text>
        }
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {item.receiptNo}
                </Text>
                {/* ⚠️ บิลที่ถูก void/คืนของแล้วต้องบอกตั้งแต่ในลิสต์ — ก่อนหน้านี้หน้าตาเหมือน
                    บิลปกติทุกประการ คนกดพิมพ์ซ้ำจึงไม่มีทางรู้ว่าใบนี้ไม่ใช่ยอดที่ร้านได้จริง
                    (บทเรียนเดียวกับใบเสร็จพิมพ์ซ้ำของฝั่งเว็บ) */}
                {item.voided ? (
                  <View style={{ marginTop: 4 }}>
                    <StatusPill label="ถูก void แล้ว" tone="danger" />
                  </View>
                ) : item.returns.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <StatusPill label="มีการคืนสินค้า" tone="warning" />
                  </View>
                ) : null}
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {item.source === 'restaurant'
                    ? `โต๊ะ ${item.tableCode}`
                    : item.member?.name ?? 'ลูกค้าทั่วไป'}
                </Text>
              </View>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ฿{item.total.toFixed(2)}
              </Text>
            </View>
            <Button
              label="เปิดใบเสร็จ"
              accessibilityLabel={`เปิดรายละเอียดใบเสร็จ ${item.receiptNo}`}
              fullWidth
              style={{ marginTop: spacing.md }}
              onPress={() =>
                navigation.navigate('SaleDetail', { saleId: item.id })
              }
            />
          </Card>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
