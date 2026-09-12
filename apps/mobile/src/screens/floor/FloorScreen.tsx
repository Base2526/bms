import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { MobileRestaurantFloorDocument } from '../../graphql/generated';
import { useTheme } from '../../theme/ThemeProvider';
import { columnsForWidth, padGrid } from '../../theme/useResponsive';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'Floor'>;

function tableTone(status: string) {
  if (status === 'EMPTY') return 'success' as const;
  if (status === 'CLOSING') return 'warning' as const;
  return 'neutral' as const;
}

export default function FloorScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const query = useQuery(MobileRestaurantFloorDocument, {
    notifyOnNetworkStatusChange: true,
  });
  const tables = useMemo(
    () => query.data?.bmsPosRestaurantFloor.tables ?? [],
    [query.data?.bmsPosRestaurantFloor.tables],
  );
  const columns = columnsForWidth(900);
  const data = useMemo(() => padGrid(tables, columns), [columns, tables]);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <View>
          <Text style={[typography.title, { color: colors.text }]}>ผังโต๊ะ</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {query.loading ? 'กำลังโหลด…' : `${tables.length} โต๊ะในสาขานี้`}
          </Text>
        </View>
        {query.error ? (
          <Pressable onPress={() => query.refetch()}>
            <Text style={[typography.caption, { color: colors.danger }]}>
              {query.error.message} · แตะเพื่อลองใหม่
            </Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        key={`floor-${columns}`}
        data={data}
        numColumns={columns}
        keyExtractor={(table, index) => table?.id ?? `filler-${index}`}
        contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.md }}
        columnWrapperStyle={{ gap: spacing.md }}
        renderItem={({ item }) =>
          item ? (
            <Pressable
              style={{ flex: 1 }}
              disabled={!item.active || item.blocked}
              onPress={() =>
                navigation.navigate('CheckDetail', { tableId: item.id })
              }
            >
              <Card
                style={{
                  minHeight: 150,
                  opacity: !item.active || item.blocked ? 0.55 : 1,
                }}
              >
                <View style={styles.header}>
                  <Text style={[typography.subtitle, { color: colors.text }]}>
                    {item.code}
                  </Text>
                  <StatusPill
                    label={
                      item.blocked
                        ? 'ปิดใช้'
                        : item.status === 'EMPTY'
                        ? 'ว่าง'
                        : item.status === 'CLOSING'
                        ? 'กำลังคิดเงิน'
                        : 'มีลูกค้า'
                    }
                    tone={item.blocked ? 'danger' : tableTone(item.status)}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {item.name} · {item.seats} ที่นั่ง
                </Text>
                {item.check ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text }]}>
                      {item.check.itemCount} รายการ · ฿
                      {item.check.amountDue.toFixed(2)}
                    </Text>
                    {item.check.unsentCount > 0 ? (
                      <Text
                        style={[
                          typography.captionStrong,
                          { color: colors.warning },
                        ]}
                      >
                        ยังไม่ส่งครัว {item.check.unsentCount} รายการ
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            </Pressable>
          ) : (
            <View style={{ flex: 1 }} />
          )
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
