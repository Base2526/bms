import { posText, usePosLanguage } from '../i18n/language';
import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Product discounts are already included here; bill-level discounts remain in the summary. */
export function CartLineAmount({ listAmount, amount }: { listAmount: number; amount: number }) {
  usePosLanguage();
  const { colors, typography } = useTheme();
  const discounted = Math.round(listAmount * 100) > Math.round(amount * 100);
  return (
    <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
      {discounted ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {posText("ก่อนโปร ฿")}{listAmount.toFixed(2)}
        </Text>
      ) : null}
      <Text style={[typography.bodyStrong, { color: colors.text }]}>
        {discounted ? posText("หลังโปร ") : ''}{posText("฿")}{amount.toFixed(2)}
      </Text>
    </View>
  );
}
