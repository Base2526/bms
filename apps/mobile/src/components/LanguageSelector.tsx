import React, { useRef } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { setPosLanguage, usePosLanguage } from '../i18n/language';
import { useTheme } from '../theme/ThemeProvider';

/** Available before pairing/sign-in; changing copy never remounts the register. */
export function LanguageSelector() {
  const language = usePosLanguage();
  const selection = useRef(0);
  const { colors, typography } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Language / ภาษา"
      style={{
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      {(['th', 'en'] as const).map(value => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityState={{ checked: language === value }}
          accessibilityLabel={value === 'th' ? 'ภาษาไทย' : 'English'}
          onPress={() => {
            const selectedRevision = ++selection.current;
            setPosLanguage(value).catch(() => {
              if (selection.current !== selectedRevision) return;
              Alert.alert(
                value === 'en'
                  ? 'Language changed for this session'
                  : 'เปลี่ยนภาษาสำหรับรอบนี้แล้ว',
                value === 'en'
                  ? 'Could not save the preference. Select it again after restarting.'
                  : 'บันทึกภาษาไม่ได้ กรุณาเลือกใหม่หลังเปิดแอปอีกครั้ง',
              );
            });
          }}
          style={{
            paddingHorizontal: 16,
            minHeight: 44,
            justifyContent: 'center',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor:
              language === value ? colors.primary : colors.surface,
          }}
        >
          <Text
            style={[
              typography.bodyStrong,
              { color: language === value ? '#ffffff' : colors.text },
            ]}
          >
            {value === 'th' ? 'ไทย' : 'English'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
