import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
}

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
];

// แป้นตัวเลขสำหรับกรอก PIN — ตั้งใจใหญ่กว่าเป้าแตะปกติ เพราะกดด้วยนิ้วโป้งบนเครื่องขาย
// ยังไม่ผูก logic ยืนยันตัวตนใด ๆ (รอ backend/schema นิ่งก่อนตามแผน)
export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  disabled,
}: Props) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map(key => {
            const isAction = key === 'clear' || key === 'back';
            const label = key === 'clear' ? 'ล้าง' : key === 'back' ? '⌫' : key;
            return (
              <Pressable
                key={key}
                disabled={disabled}
                onPress={() => {
                  if (key === 'clear') onClear();
                  else if (key === 'back') onBackspace();
                  else onDigit(key);
                }}
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor: isAction
                      ? colors.surface2
                      : colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[typography.title, { color: colors.text }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  key: {
    flex: 1,
    aspectRatio: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
