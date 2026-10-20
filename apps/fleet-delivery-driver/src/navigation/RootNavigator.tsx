import React from 'react';
import { NavigationContainer, useNavigation, type NavigationProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ActivationScreen } from '../screens/ActivationScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SyncCenterScreen } from '../screens/SyncCenterScreen';
import { DriverRuntimeProvider } from '../state/DriverRuntimeContext';
import { useDriverSession } from '../state/DriverSessionContext';
import { colors, spacing } from '../theme';
import { useI18n } from '../i18n';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function HeaderActions() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { t } = useI18n();
  return (
    <View style={styles.headerActions}>
      <Text accessibilityRole="button" onPress={() => navigation.navigate('SyncCenter')} style={styles.headerLink}>{t('sync')}</Text>
      <Text accessibilityRole="button" onPress={() => navigation.navigate('Settings')} style={styles.headerLink}>{t('settings')}</Text>
    </View>
  );
}

export function RootNavigator() {
  const { state } = useDriverSession();
  const { t } = useI18n();

  if (state.kind === 'LOADING') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }
  if (state.kind !== 'ACTIVE') return <ActivationScreen />;

  return (
    <DriverRuntimeProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: styles.headerTitle }}>
          <Stack.Screen name="Home" component={HomeScreen} options={{
            title: t('home'),
            headerRight: HeaderActions,
          }} />
          <Stack.Screen name="SyncCenter" component={SyncCenterScreen} options={{ title: t('sync') }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('settings') }} />
        </Stack.Navigator>
      </NavigationContainer>
    </DriverRuntimeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: spacing.md, justifyContent: 'center' },
  loadingText: { color: colors.muted },
  headerTitle: { fontWeight: '800' },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  headerLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
