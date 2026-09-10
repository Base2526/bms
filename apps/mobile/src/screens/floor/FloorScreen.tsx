import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { StatusPill, StatusTone } from '../../components/StatusPill';
import { useTheme } from '../../theme/ThemeProvider';
import { padGrid, useResponsive } from '../../theme/useResponsive';
import { useChecks } from '../../state/ChecksContext';
import { mockTables, TableStatus } from '../../mocks/floor';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'Floor'>;

const STATUS_LABEL: Record<TableStatus, { label: string; tone: StatusTone }> = {
  EMPTY: { label: 'ว่าง', tone: 'neutral' },
  OCCUPIED: { label: 'มีลูกค้า', tone: 'warning' },
  CLOSING: { label: 'กำลังคิดเงิน', tone: 'danger' },
};

export default function FloorScreen({ navigation }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const { gridColumns } = useResponsive();
  const { summaryFor } = useChecks();

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.text }]}>ผังโต๊ะ</Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textMuted, marginBottom: spacing.lg },
        ]}
      >
        แตะโต๊ะเพื่อเปิดบิลและสั่งอาหาร
      </Text>
      <FlatList
        key={`floor-grid-${gridColumns}`}
        data={padGrid(mockTables, gridColumns)}
        keyExtractor={(t, i) => t?.id ?? `filler-${i}`}
        numColumns={gridColumns}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{ gap: spacing.md }}
        renderItem={({ item }) => {
          if (!item) return <View style={{ flex: 1 }} />;
          // สถานะ/ยอดมาจากบิลจริงใน ChecksContext ไม่ใช่ค่าคงที่ใน mock — สั่งอาหารเพิ่มแล้ว
          // การ์ดโต๊ะต้องขยับตาม ไม่งั้นผังโต๊ะกับหน้าบิลบอกคนละเรื่อง
          const {
            amountDue,
            dishCount,
            hasUnsent,
            status: tableStatus,
          } = summaryFor(item.id);
          const status = STATUS_LABEL[tableStatus];
          return (
            // alignSelf: stretch + Card flex:1 — โต๊ะว่างมีเนื้อหาน้อยกว่าโต๊ะที่มีบิล ถ้าไม่บังคับ
            // การ์ดในแถวเดียวกันจะสูงไม่เท่ากันแล้วขอบล่างไม่ตรง (เห็นจริงบนไอแพด)
            <Pressable
              style={{ flex: 1, alignSelf: 'stretch' }}
              onPress={() =>
                navigation.navigate('CheckDetail', { tableId: item.id })
              }
            >
              <Card
                style={{
                  flex: 1,
                  borderColor:
                    tableStatus === 'EMPTY' ? colors.border : colors.primary,
                  borderRadius: radius.lg,
                }}
              >
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  {item.code}
                </Text>
                <Text
                  style={[
                    typography.caption,
                    { color: colors.textMuted, marginBottom: spacing.sm },
                  ]}
                >
                  {item.seats} ที่นั่ง
                </Text>
                <StatusPill label={status.label} tone={status.tone} />
                {dishCount > 0 && (
                  <Text
                    style={[
                      typography.bodyStrong,
                      { color: colors.text, marginTop: spacing.sm },
                    ]}
                  >
                    ฿{amountDue.toFixed(2)}
                  </Text>
                )}
                {tableStatus !== 'EMPTY' && item.openMinutes != null && (
                  <Text
                    style={[typography.caption, { color: colors.textSoft }]}
                  >
                    เปิดมา {item.openMinutes} นาที
                  </Text>
                )}
                {/* บอกตั้งแต่บนผังว่าโต๊ะไหนมีของค้างยังไม่ส่งครัว — เป็นสิ่งที่ทำให้อาหารไม่ออก
                    ทั้งที่ลูกค้าสั่งไปแล้ว และเป็นเหตุผลที่คิดเงินไม่ได้ */}
                {hasUnsent && (
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.warning, marginTop: spacing.xs },
                    ]}
                  >
                    ยังไม่ส่งครัว
                  </Text>
                )}
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
